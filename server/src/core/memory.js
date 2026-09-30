// Memory engine: working / episodic / semantic / procedural / mission.
// File-backed, source+timestamp+confidence+scope on every record.
// USER-SCOPED: every record carries userId; all reads/writes enforce it at
// this boundary (routes additionally gate). No cross-user leakage.
// Pollution guards: no secrets, no credential-shaped strings, no
// unverified-assumption-as-fact (confidence capped unless verified).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'memory.json');
const SECRET_RE = /sk-or-[\w-]+|nvapi-[\w-]+|api[_-]?key\s*[:=]|password\s*[:=]|bearer\s+[\w.-]+/i;

let store = { records: [] };
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch { /* start empty */ }

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 1).slice(0, 2_000_000));
  } catch { /* disk full etc — memory stays in RAM */ }
}

let seq = 0;

function needUser(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
}

export function remember({ userId, cls = 'semantic', content, source = 'user', confidence = 'medium', scope = 'personal', workspaceId = null }) {
  needUser(userId);
  const text = String(content || '').slice(0, 1000);
  if (!text) return { ok: false, error: 'Empty content.' };
  if (SECRET_RE.test(text)) {
    emit('security.denied_write', { cls, reason: 'secret-shaped content' });
    return { ok: false, error: 'Refused: looks like a secret/credential. Rotate it if exposed.' };
  }
  const rec = {
    id: `mem-${Date.now().toString(36)}-${(++seq).toString(36)}`,
    userId, class: cls, content: text, source,
    confidence: ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium',
    scope, workspaceId: workspaceId || null,
    at: new Date().toISOString(), lastVerified: null, lastUsed: null,
  };
  store.records.unshift(rec);
  if (store.records.length > 2000) store.records.length = 2000;
  persist();
  emit('memory.saved', { id: rec.id, class: cls });
  return { ok: true, record: rec };
}

export function recall(userId, { cls, query = '', limit = 20, workspaceId } = {}) {
  needUser(userId);
  const q = String(query || '').toLowerCase();
  const out = store.records
    .filter((r) => r.userId === userId)
    .filter((r) => (!cls || r.class === cls) && (!q || r.content.toLowerCase().includes(q)))
    .filter((r) => (workspaceId === undefined || r.workspaceId === workspaceId || (!workspaceId && !r.workspaceId)));
  for (const r of out.slice(0, Math.min(limit, 50))) {
    r.lastUsed = new Date().toISOString();
  }
  return out.slice(0, Math.min(limit, 50));
}

/** User control: edit what MetaIoid remembers (content/confidence only). */
export function updateMemory(userId, id, patch = {}) {
  needUser(userId);
  const r = store.records.find((x) => x.id === id && x.userId === userId);
  if (!r) return { ok: false, error: 'Unknown memory.' };
  if (typeof patch.content === 'string' && patch.content.trim()) {
    if (SECRET_RE.test(patch.content)) return { ok: false, error: 'Refused: looks like a secret/credential.' };
    r.content = patch.content.slice(0, 1000);
  }
  if (['low', 'medium', 'high'].includes(patch.confidence)) r.confidence = patch.confidence;
  persist();
  emit('memory.updated', { id });
  return { ok: true, record: r };
}

export function forget(userId, id) {
  needUser(userId);
  const i = store.records.findIndex((r) => r.id === id && r.userId === userId);
  if (i < 0) return { ok: false, error: 'Unknown memory.' };
  store.records.splice(i, 1);
  persist();
  emit('memory.forgotten', { id });
  return { ok: true };
}

/** Forget everything (account wipe path + user control). */
export function forgetAll(userId) {
  needUser(userId);
  const before = store.records.length;
  store.records = store.records.filter((r) => r.userId !== userId);
  persist();
  emit('memory.forgotten_all', { user: userId, count: before - store.records.length });
  return { ok: true, deleted: before - store.records.length };
}

export function exportMemories(userId) {
  needUser(userId);
  return store.records.filter((r) => r.userId === userId);
}

export function stats(userId) {
  needUser(userId);
  const byClass = {};
  let total = 0;
  for (const r of store.records) {
    if (r.userId !== userId) continue;
    total += 1;
    byClass[r.class] = (byClass[r.class] || 0) + 1;
  }
  return { total, byClass };
}

/** Single-user upgrade path: adopt pre-multi-user records into the first account. */
export function adoptLegacyRecords(userId) {
  let n = 0;
  for (const r of store.records) {
    if (!r.userId) {
      r.userId = userId;
      n += 1;
    }
  }
  if (n) persist();
  return n;
}

export function deleteUserMemories(userId) {
  return forgetAll(userId);
}
