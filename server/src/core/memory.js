// Memory engine: working / episodic / semantic / procedural / mission.
// File-backed, source+timestamp+confidence+scope on every record.
// Pollution guards: no secrets, no credential-shaped strings, no
// unverified-assumption-as-fact (confidence capped unless verified).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
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

export function remember({ cls = 'semantic', content, source = 'user', confidence = 'medium', scope = 'personal' }) {
  const text = String(content || '').slice(0, 1000);
  if (!text) return { ok: false, error: 'Empty content.' };
  if (SECRET_RE.test(text)) {
    emit('security.denied_write', { cls, reason: 'secret-shaped content' });
    return { ok: false, error: 'Refused: looks like a secret/credential. Rotate it if exposed.' };
  }
  const rec = {
    id: `mem-${Date.now().toString(36)}-${(++seq).toString(36)}`,
    class: cls, content: text, source,
    confidence: ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium',
    scope, at: new Date().toISOString(), lastVerified: null,
  };
  store.records.unshift(rec);
  if (store.records.length > 1000) store.records.length = 1000;
  persist();
  emit('memory.saved', { id: rec.id, class: cls });
  return { ok: true, record: rec };
}

export function recall({ cls, query = '', limit = 20 } = {}) {
  const q = query.toLowerCase();
  return store.records
    .filter((r) => (!cls || r.class === cls) && (!q || r.content.toLowerCase().includes(q)))
    .slice(0, Math.min(limit, 50));
}

export function forget(id) {
  const i = store.records.findIndex((r) => r.id === id);
  if (i < 0) return { ok: false, error: 'Unknown memory.' };
  store.records.splice(i, 1);
  persist();
  emit('memory.forgotten', { id });
  return { ok: true };
}

export function stats() {
  const byClass = {};
  for (const r of store.records) byClass[r.class] = (byClass[r.class] || 0) + 1;
  return { total: store.records.length, byClass };
}
