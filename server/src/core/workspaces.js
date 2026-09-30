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

// ---------- workspaces ----------

export function listWorkspaces(userId) {
  return workspaces.items.filter((w) => w.userId === userId);
}

export function getWorkspace(userId, id) {
  const w = workspaces.items.find((x) => x.id === id);
  return w && w.userId === userId ? w : null;
}

export function createWorkspace(userId, { name, kind = 'custom', instructions = '' }) {
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

export function updateWorkspace(userId, id, patch = {}) {
  const w = getWorkspace(userId, id);
  if (!w) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim().slice(0, 60);
  if (typeof patch.instructions === 'string') w.instructions = patch.instructions.slice(0, 2000);
  w.updatedAt = new Date().toISOString();
  persistWS();
  return w;
}

export function deleteWorkspace(userId, id) {
  const i = workspaces.items.findIndex((x) => x.id === id && x.userId === userId);
  if (i < 0) return false;
  workspaces.items.splice(i, 1);
  persistWS();
  emit('workspace.deleted', { user: userId, id });
  return true;
}

export function deleteUserWorkspaces(userId) {
  workspaces.items = workspaces.items.filter((w) => w.userId !== userId);
  persistWS();
}

// ---------- devices ----------

/** Step 1: device asks for a short pairing code (shown to the signed-in user). */
export function requestPairing(userId, { deviceName = '', capabilities = [] } = {}) {
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
export function confirmPairing(userId, code, { deviceId = null } = {}) {
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

export function listDevices(userId) {
  return devices.items.filter((d) => d.userId === userId && !d.revoked);
}

export function revokeDevice(userId, id) {
  const d = devices.items.find((x) => x.id === id && x.userId === userId);
  if (!d) return false;
  d.revoked = true;
  persistDev();
  emit('device.revoked', { user: userId, device: id });
  return true;
}

/** Control-plane gate: (user, device, capability) must all check out. */
export function authorizeDevice(userId, deviceId, capability) {
  const d = devices.items.find((x) => x.id === deviceId && x.userId === userId && !x.revoked);
  if (!d) return { ok: false, error: 'Unknown or unpaired device.' };
  if (d.capabilities.length && !d.capabilities.includes(capability)) {
    return { ok: false, error: `Device not authorized for "${capability}".` };
  }
  d.lastSeenAt = new Date().toISOString();
  persistDev();
  return { ok: true, device: { id: d.id, name: d.name } };
}

export function deleteUserDevices(userId) {
  devices.items = devices.items.filter((d) => d.userId !== userId);
  devices.pairing = devices.pairing.filter((p) => p.userId !== userId);
  persistDev();
}
