// World model: USER → GOALS → PROJECTS → TASKS → TOOLS → RESULTS → LEARNING.
// Entities + relationships with confidence; resolution never merges below MATCHED.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DIR, 'world.json');

async function supa() {
  const m = await import('./supadb.js');
  return m.dbMode() ? m : null;
}

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

function needUser(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
}

export async function upsertEntity({ userId, type, name, aliases = [], source = 'unknown', confidence = 'medium' }) {
  needUser(userId);
  const db = await supa();
  if (db) return db.worldUpsert(userId, { type, name, aliases, source, confidence });
  const norm = normalizeName(name);
  let ent = store.entities.find((e) => e.userId === userId && e.type === type && normalizeName(e.name) === norm);
  const now = new Date().toISOString();
  if (ent) {
    for (const a of aliases) if (!ent.aliases.includes(a)) ent.aliases.push(a);
    ent.lastVerified = now;
  } else {
    ent = {
      id: nid(), userId, type, name, aliases, sources: [source],
      confidence, firstSeen: now, lastVerified: now, timeline: [],
    };
    store.entities.push(ent);
  }
  if (!ent.sources.includes(source)) ent.sources.push(source);
  persist();
  return ent;
}

export async function relate(userId, fromId, toId, rel, { source = 'unknown', confidence = 'medium', evidence = '' } = {}) {
  needUser(userId);
  const db = await supa();
  if (db) return db.worldRelate(userId, fromId, toId, rel, { source, confidence, evidence });
  const from = store.entities.find((e) => e.id === fromId && e.userId === userId);
  const to = store.entities.find((e) => e.id === toId && e.userId === userId);
  if (!from || !to) return { ok: false, error: 'Unknown entity.' };
  const edge = { from: fromId, to: toId, rel, userId, source, confidence, evidence: String(evidence).slice(0, 300), at: new Date().toISOString() };
  store.relations.push(edge);
  persist();
  emit('world.related', { rel, from: from.name, to: to.name });
  return { ok: true, edge };
}

export async function neighbors(userId, id, depth = 1) {
  needUser(userId);
  const db = await supa();
  if (db) return db.worldNeighbors(userId, id, depth);
  const root = store.entities.find((e) => e.id === id && e.userId === userId);
  if (!root) return { entities: [], relations: [] };
  const seen = new Set([id]);
  let frontier = [id];
  const edges = [];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const e of store.relations) {
      if (e.userId !== userId) continue;
      if (frontier.includes(e.from) && !seen.has(e.to)) { seen.add(e.to); next.push(e.to); edges.push(e); }
      else if (frontier.includes(e.to) && !seen.has(e.from)) { seen.add(e.from); next.push(e.from); edges.push(e); }
    }
    frontier = next;
  }
  return {
    entities: store.entities.filter((e) => e.userId === userId && seen.has(e.id)),
    relations: edges,
  };
}

export async function worldStats(userId) {
  needUser(userId);
  const db = await supa();
  if (db) return db.worldStats(userId);
  return {
    entities: store.entities.filter((e) => e.userId === userId).length,
    relations: store.relations.filter((e) => e.userId === userId).length,
  };
}

export async function findEntities(userId, query = '', type) {
  needUser(userId);
  const db = await supa();
  if (db) return db.worldFind(userId, query, type);
  const q = String(query || '').toLowerCase();
  return store.entities
    .filter((e) => e.userId === userId)
    .filter((e) => (!type || e.type === type) && (!q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))))
    .slice(0, 50);
}

/** Single-user upgrade: adopt pre-multi-user entities into the first account. */
export function adoptLegacyWorld(userId) {
  let n = 0;
  for (const e of [...store.entities, ...store.relations]) {
    if (!e.userId) {
      e.userId = userId;
      n += 1;
    }
  }
  if (n) persist();
  return n;
}

export async function deleteUserWorld(userId) {
  const db = await supa();
  if (db) return db.worldDeleteUser(userId);
  const before = store.entities.length + store.relations.length;
  store.entities = store.entities.filter((e) => e.userId !== userId);
  store.relations = store.relations.filter((e) => e.userId !== userId);
  persist();
  return before - (store.entities.length + store.relations.length);
}
