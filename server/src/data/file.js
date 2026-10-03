// Local-store driver for the account-data layer.
//
// One JSON document — `${METALOID_DATA_DIR}/local-store.json` — holding every
// collection. This is the LOCAL/self-host driver: it exists so the gateway
// boots and behaves identically with no database, which is what developers and
// self-hosters run. Production uses the Postgres driver (SUPABASE_DB=supabase,
// see ./pg.js). Both drivers return byte-identical shapes, so the contract
// cannot drift between them.
//
// Guarantees enforced here rather than by convention:
//   * ids are UUIDs (the v1 contract validates them with a UUID regex)
//   * every read filters by owner, every write stamps the owner from the
//     verified session — a caller can never address another account's rows
//   * writes are atomic (tmp file + rename), so a crash cannot truncate the
//     store into unparseable JSON
//   * secrets arrive already encrypted by crypto.js and only ever leave as an
//     envelope plus a mask; no plaintext key is written by this module

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.METALOID_DATA_DIR || path.join(HERE, '..', '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'local-store.json');

const COLLECTIONS = [
  'conversations', 'messages', 'memories', 'profiles',
  'provider_settings', 'provider_credentials', 'usage_events',
  'agent_tasks', 'tool_events', 'attachments',
];

let doc = null;

function blank() {
  const d = {};
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

function load() {
  if (doc) return doc;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    doc = { ...blank(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    for (const c of COLLECTIONS) if (!Array.isArray(doc[c])) doc[c] = [];
  } catch {
    doc = blank();
  }
  return doc;
}

/** The rows of one collection, created on demand so throwaway collections
 *  (a health probe's `__ping`) behave exactly like declared ones. */
function rows(name) {
  const d = load();
  if (!Array.isArray(d[name])) d[name] = [];
  return d[name];
}

let writeSeq = 0;
function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const rows = load();
    // Unique scratch name: two concurrent saves must not share one tmp file.
    const tmp = `${STORE_FILE}.${process.pid}.${++writeSeq}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch (e) {
    // Disk full / permissions. The in-memory view stays correct for this
    // process and the failure is surfaced rather than swallowed: silently
    // dropping a user's message would be worse than a visible error.
    const err = new Error(`Could not persist the local store: ${e.message}`);
    err.code = 'db_error';
    err.status = 500;
    throw err;
  }
}

/** Drop cached state (tests, or after an external edit). */
export function reload() {
  doc = null;
}

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

// ── cursor pagination ───────────────────────────────────────────────────
// Opaque to clients: base64url of `<sortKey>|<id>`. The Postgres driver uses
// the identical encoding, so a cursor minted by one remains meaningful to the
// other and neither leaks row internals.
export function encodeCursor(sortKey, id) {
  return Buffer.from(`${sortKey}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx <= 0) return null;
    return { sortKey: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

/**
 * Sort by `keyOf` (then id), page from `cursor`, and report whether more
 * remain. A cursor naming a row that no longer exists restarts from the top
 * rather than throwing — a deleted row must not brick a client's pagination.
 */
export function page(list, { limit = 50, cursor = null } = {}, { keyOf, tieOf, desc = true }) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const sorted = [...list].sort((a, b) => {
    const ka = String(keyOf(a)); const kb = String(keyOf(b));
    if (ka === kb) {
      const ta = tieOf(a); const tb = tieOf(b);
      return desc ? (ta < tb ? 1 : ta > tb ? -1 : 0) : (ta < tb ? -1 : ta > tb ? 1 : 0);
    }
    return desc ? (ka < kb ? 1 : -1) : (ka > kb ? 1 : -1);
  });

  let start = 0;
  const mark = decodeCursor(cursor);
  if (mark) {
    const at = sorted.findIndex((r) => tieOf(r) === mark.id);
    start = at >= 0 ? at + 1 : 0;
  }

  const slice = sorted.slice(start, start + capped);
  const last = slice[slice.length - 1];
  const more = start + capped < sorted.length;
  return {
    rows: slice,
    next_cursor: more && last ? encodeCursor(keyOf(last), tieOf(last)) : null,
  };
}

// ── collection access ───────────────────────────────────────────────────
/**
 * Rows are addressed by an `ownerField`: `user_id` for every account table,
 * `id` for `profiles` (which is 1:1 with the auth user and keyed by it).
 */
export const collection = (name) => ({
  all: () => rows(name),
  mine: (owner, ownerField = 'user_id') => rows(name).filter((r) => r[ownerField] === owner),
  find: (owner, id, ownerField = 'user_id') =>
    rows(name).find((r) => r[ownerField] === owner && r.id === id) || null,
  insert: (row) => {
    rows(name).unshift(row);
    persist();
    return row;
  },
  patch: (owner, id, patch, ownerField = 'user_id') => {
    const list = rows(name);
    const at = list.findIndex((r) => r[ownerField] === owner && r.id === id);
    if (at === -1) return null;
    const next = { ...list[at], ...patch, id };
    next[ownerField] = owner;
    list[at] = next;
    persist();
    return list[at];
  },
  remove: (owner, id, ownerField = 'user_id') => {
    const list = rows(name);
    const at = list.findIndex((r) => r[ownerField] === owner && r.id === id);
    if (at === -1) return false;
    list.splice(at, 1);
    persist();
    return true;
  },
  dropOwner: (owner, ownerField = 'user_id') => {
    const list = rows(name);
    const kept = list.filter((r) => r[ownerField] !== owner);
    const n = list.length - kept.length;
    if (n) {
      load()[name] = kept;
      persist();
    }
    return n;
  },
});
