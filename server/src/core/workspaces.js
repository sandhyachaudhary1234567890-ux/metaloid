// Workspaces + devices — user-scoped spaces and paired hardware.
// Workspace context NEVER leaks across workspaces automatically; callers
// pass an explicit workspaceId to read/write scoped memories/files.
// Devices require explicit pairing; control is authorized per
// (user, device, capability, session) — never from browser state alone.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const WS_FILE = path.join(DIR, 'workspaces.json');
const DEV_FILE = path.join(DIR, 'devices.json');

function load(file, fallback) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* start empty */ }
  return fallback;
}
function save(file, obj, cap = 2_000_000) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 1).slice(0, cap));
  } catch { /* ignore */ }
}

let workspaces = load(WS_FILE, { items: [] });
let devices = load(DEV_FILE, { items: [], pairing: [] });

const persistWS = () => save(WS_FILE, workspaces);
const persistDev = () => save(DEV_FILE, devices, 1_000_000);

const wid = () => `wsp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const did = () => `dev-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

const SYSTEM_WORKSPACES = ['Personal', 'School', 'Work', 'Coding', 'Research', 'Content', 'Business'];

async function supa() {
  const m = await import('./supadb.js');
  return m.dbMode() ? m : null;
}

function needUser(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
}

// ---------- workspaces ----------

export async function listWorkspaces(userId) {
  needUser(userId);
  const db = await supa();
  if (db) return db.wsList(userId);
  return workspaces.items.filter((w) => w.userId === userId);
}

export async function getWorkspace(userId, id) {
  needUser(userId);
  const db = await supa();
  if (db) return db.wsGet(userId, id);
  const w = workspaces.items.find((x) => x.id === id);
  return w && w.userId === userId ? w : null;
}

export async function createWorkspace(userId, { name, kind = 'custom', instructions = '' } = {}) {
  needUser(userId);
  const db = await supa();
  if (db) {
    const r = await db.wsCreate(userId, { name, kind, instructions });
    if (r.ok) emit('workspace.created', { user: userId, id: r.workspace.id });
    return r;
  }
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return { ok: false, error: 'Workspace name required.' };
  if (listWorkspaces(userId).length >= 50) return { ok: false, error: 'Workspace limit reached.' };
  const w = {
    id: wid(), userId, name: n, kind: SYSTEM_WORKSPACES.includes(n) ? 'system' : String(kind).slice(0, 20),
    instructions: String(instructions || '').slice(0, 2000),
    files: [], // {id,name,size,type,at} — bytes stay client-side in V1
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  workspaces.items.push(w);
  persistWS();
  emit('workspace.created', { user: userId, id: w.id });
  return { ok: true, workspace: w };
}

export async function updateWorkspace(userId, id, patch = {}) {
  needUser(userId);
  const db = await supa();
  if (db) return db.wsUpdate(userId, id, patch);
  const w = getWorkspace(userId, id);
  if (!w) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim().slice(0, 60);
  if (typeof patch.instructions === 'string') w.instructions = patch.instructions.slice(0, 2000);
  w.updatedAt = new Date().toISOString();
  persistWS();
  return w;
}

export async function deleteWorkspace(userId, id) {
  needUser(userId);
  const db = await supa();
  if (db) {
    const ok = await db.wsDelete(userId, id);
    if (ok) emit('workspace.deleted', { user: userId, id });
    return ok;
  }
  const i = workspaces.items.findIndex((x) => x.id === id && x.userId === userId);
  if (i < 0) return false;
  workspaces.items.splice(i, 1);
  persistWS();
  emit('workspace.deleted', { user: userId, id });
  return true;
}

export async function deleteUserWorkspaces(userId) {
  const db = await supa();
  if (db) return db.wsDeleteUser(userId);
  workspaces.items = workspaces.items.filter((w) => w.userId !== userId);
  persistWS();
}

// ---------- devices ----------

/** Step 1: device asks for a short pairing code (shown to the signed-in user). */
export async function requestPairing(userId, { deviceName = '', capabilities = [] } = {}) {
  needUser(userId);
  const db = await supa();
  if (db) return db.devPairRequest(userId, { deviceName, capabilities });
  const code = String(crypto.randomInt(100000, 999999));
  devices.pairing.push({
    code, userId,
    deviceName: String(deviceName).slice(0, 80),
    capabilities: Array.isArray(capabilities) ? capabilities.map(String).slice(0, 20) : [],
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  persistDev();
  return { code, expiresInSec: 600 };
}

/** Step 2: signed-in user confirms the code → device becomes authorized. */
export async function confirmPairing(userId, code, { deviceId = null } = {}) {
  needUser(userId);
  const db = await supa();
  if (db) {
    const r = await db.devPairConfirm(userId, code, { deviceId });
    if (r.ok) emit('device.paired', { user: userId, device: r.device.id });
    return r;
  }
  const i = devices.pairing.findIndex(
    (p) => p.code === String(code) && p.userId === userId && p.expiresAt > Date.now()
  );
  if (i < 0) return { ok: false, error: 'Invalid or expired pairing code.' };
  const p = devices.pairing.splice(i, 1)[0];
  const d = {
    id: typeof deviceId === 'string' && deviceId ? deviceId.slice(0, 80) : did(),
    userId, name: p.deviceName || 'Unnamed device',
    capabilities: p.capabilities,
    pairedAt: new Date().toISOString(), lastSeenAt: null, revoked: false,
  };
  devices.items.push(d);
  persistDev();
  emit('device.paired', { user: userId, device: d.id });
  return { ok: true, device: d };
}

export async function listDevices(userId) {
  needUser(userId);
  const db = await supa();
  if (db) return db.devList(userId);
  return devices.items.filter((d) => d.userId === userId && !d.revoked);
}

export async function revokeDevice(userId, id) {
  needUser(userId);
  const db = await supa();
  if (db) {
    const ok = await db.devRevoke(userId, id);
    if (ok) emit('device.revoked', { user: userId, device: id });
    return ok;
  }
  const d = devices.items.find((x) => x.id === id && x.userId === userId);
  if (!d) return false;
  d.revoked = true;
  persistDev();
  emit('device.revoked', { user: userId, device: id });
  return true;
}

/** Control-plane gate: (user, device, capability) must all check out. */
export async function authorizeDevice(userId, deviceId, capability) {
  needUser(userId);
  const db = await supa();
  if (db) return db.devAuthorize(userId, deviceId, capability);
  const d = devices.items.find((x) => x.id === deviceId && x.userId === userId && !x.revoked);
  if (!d) return { ok: false, error: 'Unknown or unpaired device.' };
  if (d.capabilities.length && !d.capabilities.includes(capability)) {
    return { ok: false, error: `Device not authorized for "${capability}".` };
  }
  d.lastSeenAt = new Date().toISOString();
  persistDev();
  return { ok: true, device: { id: d.id, name: d.name } };
}

export async function deleteUserDevices(userId) {
  const db = await supa();
  if (db) return db.devDeleteUser(userId);
  devices.items = devices.items.filter((d) => d.userId !== userId);
  devices.pairing = devices.pairing.filter((p) => p.userId !== userId);
  persistDev();
}
