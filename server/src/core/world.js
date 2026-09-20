// World model: USER → GOALS → PROJECTS → TASKS → TOOLS → RESULTS → LEARNING.
// Entities + relationships with confidence; resolution never merges below MATCHED.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'world.json');

let store = { entities: [], relations: [] };
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch { /* start empty */ }

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 1).slice(0, 2_000_000));
  } catch { /* ignore */ }
}

let seq = 0;
const nid = () => `ent-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/[,.\s]+(inc|llc|ltd|pvt|corp|co|gmbh)\.?$/i, '')
    .replace(/[^a-z0-9.-]/g, '').trim();
}

/** MATCHED | PROBABLE | POSSIBLE | UNRELATED — merge only on MATCHED. */
export function resolveLevel(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 'UNRELATED';
  if (na === nb) return 'MATCHED';
  if (na.includes(nb) || nb.includes(na)) return 'PROBABLE';
  const ta = new Set(na.split(/[.-]/).filter((x) => x.length > 2));
  const tb = new Set(nb.split(/[.-]/).filter((x) => x.length > 2));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  if (overlap >= 2 || (overlap === 1 && Math.min(ta.size, tb.size) === 1)) return 'POSSIBLE';
  return 'UNRELATED';
}

export function upsertEntity({ type, name, aliases = [], source = 'unknown', confidence = 'medium' }) {
  const norm = normalizeName(name);
  let ent = store.entities.find((e) => e.type === type && normalizeName(e.name) === norm);
  const now = new Date().toISOString();
  if (ent) {
    for (const a of aliases) if (!ent.aliases.includes(a)) ent.aliases.push(a);
    ent.lastVerified = now;
  } else {
    ent = {
      id: nid(), type, name, aliases, sources: [source],
      confidence, firstSeen: now, lastVerified: now, timeline: [],
    };
    store.entities.push(ent);
  }
  if (!ent.sources.includes(source)) ent.sources.push(source);
  persist();
  return ent;
}

export function relate(fromId, toId, rel, { source = 'unknown', confidence = 'medium', evidence = '' } = {}) {
  const from = store.entities.find((e) => e.id === fromId);
  const to = store.entities.find((e) => e.id === toId);
  if (!from || !to) return { ok: false, error: 'Unknown entity.' };
  const edge = { from: fromId, to: toId, rel, source, confidence, evidence: String(evidence).slice(0, 300), at: new Date().toISOString() };
  store.relations.push(edge);
  persist();
  emit('world.related', { rel, from: from.name, to: to.name });
  return { ok: true, edge };
}

export function neighbors(id, depth = 1) {
  const seen = new Set([id]);
  let frontier = [id];
  const edges = [];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const e of store.relations) {
      if (frontier.includes(e.from) && !seen.has(e.to)) { seen.add(e.to); next.push(e.to); edges.push(e); }
      else if (frontier.includes(e.to) && !seen.has(e.from)) { seen.add(e.from); next.push(e.from); edges.push(e); }
    }
    frontier = next;
  }
  return {
    entities: store.entities.filter((e) => seen.has(e.id)),
    relations: edges,
  };
}

export function worldStats() {
  return { entities: store.entities.length, relations: store.relations.length };
}

export function findEntities(query = '', type) {
  const q = query.toLowerCase();
  return store.entities
    .filter((e) => (!type || e.type === type) && (!q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))))
    .slice(0, 50);
}
