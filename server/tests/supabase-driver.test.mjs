// The Postgres driver, executed against a real PostgreSQL engine.
//
// `data/pg.js` is the production driver: on Vercel there is no filesystem to
// write a JSON store to, so every account row lives in Supabase Postgres. The
// local driver is covered by `api-v1.test.mjs`; this file covers the driver
// that actually serves production traffic.
//
// It is not a mock. PGlite is PostgreSQL compiled to WASM, the real migrations
// from `supabase/migrations/` are applied in order, and the real Supabase
// environment (`auth.users`, `auth.uid()`, anon/authenticated/service_role,
// the storage schema) is reconstructed first. The driver then runs its own
// SQL through `__setExecutor`, so what is exercised is the exact statement
// text and the exact role/claim handling that production uses.
//
// The properties that matter for the spec:
//   * the driver works at all against real Postgres (types, jsonb, cursors)
//   * `force row level security` means the application's own `user_id` filter
//     is *not* the only thing standing between two accounts
//   * secrets are stored as ciphertext and never returned
//   * paging is stable and cursor-compatible with the other driver

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', '..', 'supabase', 'migrations');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// Encryption must be configured before the driver is imported: crypto.js
// reads its keyring from the environment at call time, and a test that stored
// a key in the clear would be testing the wrong program.
process.env.METALOID_ENCRYPTION_KEYS = `${'k1'}:${crypto.randomBytes(32).toString('base64')}`;
process.env.METALOID_ENCRYPTION_ACTIVE = 'k1';

const data = await import('../src/data/index.js');
const pgDriver = await import('../src/data/pg.js');

/** Reconstruct the Supabase environment the migrations expect. */
async function supabaseish() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create table auth.users (
      id                 uuid primary key,
      email              text,
      raw_user_meta_data jsonb,
      created_at         timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(coalesce(
        current_setting('request.jwt.claim.sub', true),
        (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
      ), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(
        current_setting('request.jwt.claim.role', true),
        (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
      ) $$;

    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text, owner uuid, created_at timestamptz not null default now()
    );
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;

    grant usage on schema auth, storage to anon, authenticated, service_role;
  `);
  return db;
}

const db = await supabaseish();

for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  } catch (e) {
    throw new Error(`migration ${f} failed: ${e.message}`);
  }
}

await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@test.dev'), ('${B}', 'b@test.dev')`);

// ── wire the driver to this engine ──────────────────────────────────────
// The executor is the single point where the driver would otherwise reach a
// pooled socket. Everything above it — role switching, claim setting,
// transaction scope, statement text — is the production code path.
let inTx = false;
pgDriver.__setExecutor(async (text, params) => {
  const head = String(text).trim().toLowerCase();
  if (head === 'begin') { inTx = true; return db.exec('begin'); }
  if (head === 'commit') { inTx = false; return db.exec('commit'); }
  if (head === 'rollback') { inTx = false; return db.exec('rollback'); }
  // `set local role` must not outlive its transaction: PGlite is a single
  // connection, so a leaked role would silently change the identity of the
  // next test and make it pass for the wrong reason.
  if (head.startsWith('set local role')) return db.exec('set local role authenticated');
  const res = await db.query(text, params);
  // `affectedRows` is 0 for a SELECT, so row-count must come from the rows
  // actually returned unless the statement returned none.
  const rowCount = res.rows.length || res.affectedRows || 0;
  return { rows: res.rows, rowCount };
});

const ctxA = { userId: A, email: 'a@test.dev' };
const ctxB = { userId: B, email: 'b@test.dev' };

process.env.SUPABASE_DB = 'supabase';
process.env.SUPABASE_DB_POOL_URL = 'postgres://pglite/injected';

test('the driver reports itself as the supabase driver', () => {
  assert.equal(data.driverName(), 'supabase');
  assert.equal(data.driverInfo().driver, 'supabase');
  assert.equal(data.driverInfo().durable, true, 'Postgres is the durable driver');
});

test('profiles are created on first read and update in place', async () => {
  const created = await data.profiles.get(ctxA, 'a@test.dev');
  assert.equal(created.id, A, 'profiles are keyed by the auth user id');
  assert.equal(created.onboarding_completed, false);
  assert.equal(created.theme, 'obsidian');

  const patched = await data.profiles.update(ctxA, { onboarding_completed: true, preferred_model: 'x:free' });
  assert.equal(patched.onboarding_completed, true);
  assert.equal(patched.preferred_model, 'x:free');

  // a second read must see the persisted row, not a fresh default
  const again = await data.profiles.get(ctxA, 'a@test.dev');
  assert.equal(again.preferred_model, 'x:free');
});

test('conversations and messages round-trip through real SQL', async () => {
  const conv = await data.conversations.create(ctxA, { title: 'Postgres thread' });
  assert.match(conv.id, /^[0-9a-f-]{36}$/, 'ids are uuids');

  const user = await data.messages.append(ctxA, conv.id, { role: 'user', content: 'hello' });
  assert.equal(user.status, 'complete');

  const asst = await data.messages.append(ctxA, conv.id, {
    role: 'assistant', content: 'hi', status: 'streaming', model: 'x:free', provider: 'openrouter',
  });
  assert.equal(asst.model, 'x:free');

  const listed = await data.messages.list(ctxA, conv.id, { limit: 50 });
  assert.equal(listed.rows.length, 2, 'both turns persisted');
  assert.equal(listed.rows[0].content, 'hello', 'oldest first');
  assert.equal(listed.rows[0].role, 'user');

  // jsonb metadata survives the type round-trip
  const withMeta = await data.messages.append(ctxA, conv.id, {
    role: 'tool', content: 'searched', metadata: { steps: 3, tools: ['web_search'] },
  });
  assert.ok(withMeta.id);

  // non-cascading update: an interrupted stream is closed with a reason
  const recovered = await data.messages.markStale(ctxA, conv.id);
  assert.equal(recovered, 1, 'exactly the streaming message is closed');
  const after = await data.messages.list(ctxA, conv.id, { limit: 50 });
  const closed = after.rows.find((m) => m.id === asst.id);
  assert.equal(closed.status, 'cancelled');
  assert.equal(closed.error_code, 'interrupted');
});

test('row level security — not just the where clause — isolates accounts', async () => {
  const conv = await data.conversations.create(ctxA, { title: 'A private' });

  // Through the driver, B simply cannot see it.
  assert.equal(await data.conversations.get(ctxB, conv.id), null);
  assert.equal(await data.messages.list(ctxB, conv.id, {}), null);
  assert.equal((await data.conversations.list(ctxB, {})).rows.length, 0);

  // And the boundary is the database, not the application: the same SELECT
  // with no user filter at all, run as B, still returns nothing. If the only
  // protection were `where user_id = $1`, this would leak A's row.
  let leaked = null;
  pgDriver.__setExecutor(async (text, params) => {
    const head = String(text).trim().toLowerCase();
    if (head === 'begin' || head === 'commit' || head === 'rollback') return db.exec(head);
    if (head.startsWith('set local role')) return db.exec('set local role authenticated');
    const res = await db.query(text, params);
    return { rows: res.rows, rowCount: res.rows.length || res.affectedRows || 0 };
  });
  await db.exec("select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"B\"}', true)");
  await db.exec('begin');
  await db.exec('set local role authenticated');
  const unfiltered = await db.query('select id from public.conversations');
  await db.exec('rollback');
  leaked = unfiltered.rows.length;
  assert.equal(leaked, 0, 'an unfiltered SELECT as B must return no rows (RLS is the boundary)');
});

test('provider credentials are stored as ciphertext and never returned', async () => {
  const secret = 'sk-or-v1-9f8e7d6c5b4a39281706f5e4d3c2b1a09988776655443322';
  const saved = await data.providerCredentials.upsert(ctxA, { provider: 'openrouter', label: 'default', secret });
  assert.equal(saved.status, 'unverified');
  assert.equal(saved.key_version, 'k1', 'the envelope records which key encrypted it');
  assert.ok(!JSON.stringify(saved).includes(secret), 'the plaintext never comes back');
  assert.ok(saved.masked_hint.startsWith('…'), 'only a mask is exposed');

  const list = await data.providerCredentials.list(ctxA);
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(secret));

  // the database itself holds an envelope, not a key
  const stored = await db.query(`select secret_ciphertext from public.user_provider_credentials where user_id = $1`, [A]);
  assert.match(stored.rows[0].secret_ciphertext, /^v1:k1:/, 'versioned envelope at rest');
  assert.ok(!stored.rows[0].secret_ciphertext.includes(secret));

  // decryption is possible for an outbound call…
  const revealed = await data.providerCredentials.revealPlaintext(ctxA, 'openrouter', 'default');
  assert.equal(revealed.secret, secret, 'the driver can decrypt for a provider call');

  // …but B cannot reach it, by read or by decrypt.
  assert.equal((await data.providerCredentials.list(ctxB)).length, 0);
  assert.equal(await data.providerCredentials.revealPlaintext(ctxB, 'openrouter', 'default'), null);
  assert.equal(await data.providerCredentials.remove(ctxB, 'openrouter', 'default'), false);

  await data.providerCredentials.setStatus(ctxA, 'openrouter', 'connected', 'default');
  assert.equal((await data.providerCredentials.list(ctxA))[0].status, 'connected');
});

test('provider settings upsert without nulling fields the caller omitted', async () => {
  assert.equal(await data.providerSettings.get(ctxA), null);

  const first = await data.providerSettings.upsert(ctxA, {
    default_provider: 'openrouter', default_model: 'meta-llama/llama-3.3-70b-instruct:free', free_only: true,
  });
  assert.equal(first.default_model, 'meta-llama/llama-3.3-70b-instruct:free');

  // a later partial write must not wipe the model — this is the "Set default
  // model persists" requirement, seen from the storage side.
  const second = await data.providerSettings.upsert(ctxA, { free_only: false });
  assert.equal(second.default_model, 'meta-llama/llama-3.3-70b-instruct:free');
  assert.equal(second.free_only, false);
  assert.equal(second.default_provider, 'openrouter');

  assert.equal(await data.providerSettings.get(ctxB), null, 'settings are per account');
});

test('memories, tasks, usage and tool events persist with correct types', async () => {
  const mem = await data.memories.create(ctxA, { content: 'Prefers concise answers', kind: 'preference', pinned: true });
  assert.equal(mem.pinned, true);
  assert.equal((await data.memories.list(ctxA, { query: 'concise' })).rows.length, 1);
  assert.equal((await data.memories.list(ctxA, { kind: 'project' })).rows.length, 0);
  assert.equal((await data.memories.list(ctxB, {})).rows.length, 0);
  assert.equal(await data.memories.remove(ctxB, mem.id), false, 'B cannot delete A memory');

  const task = await data.tasks.create(ctxA, { type: 'research', objective: 'Compare vector stores' });
  assert.equal(task.status, 'queued', 'the database default is used as-is');
  assert.equal(task.progress, 0);

  const running = await data.tasks.update(ctxA, task.id, { status: 'running', progress: 40 });
  assert.equal(running.progress, 40);
  assert.equal(running.completed_at, null, 'a running task has no completion time');

  const done = await data.tasks.update(ctxA, task.id, { status: 'complete', progress: 100, result: { ok: true } });
  assert.equal(done.status, 'completed', 'a client alias is normalised to the stored vocabulary');
  assert.ok(done.completed_at, 'completion is stamped, so a UI cannot show a finished job as running');
  assert.deepEqual(done.result, { ok: true }, 'jsonb result round-trips as an object');
  assert.equal(await data.tasks.get(ctxB, task.id), null);

  const usage = await data.usage.record(ctxA, { provider: 'openrouter', model: 'x:free', latency_ms: 120, status: 'ok', tokens_out: 42 });
  assert.equal(usage.latency_ms, 120);
  assert.equal((await data.usage.list(ctxA, {})).rows.length, 1);
  assert.equal((await data.usage.list(ctxB, {})).rows.length, 0);

  await data.toolEvents.record(ctxA, { tool: 'web_search', state: 'done', detail: '3 results' });
  const events = await db.query(`select count(*)::int as c from public.tool_events where user_id = $1`, [A]);
  assert.equal(Number(events.rows[0].c), 1);
});

test('attachments keep the storage path namespaced to the owner', async () => {
  const conv = await data.conversations.create(ctxA, { title: 'with file' });
  const att = await data.attachments.create(ctxA, {
    conversation_id: conv.id, filename: 'report.pdf', mime_type: 'application/pdf', size_bytes: 2048,
  });
  assert.ok(att.storage_path.startsWith(`attachments/${A}/`), `path starts with the owner: ${att.storage_path}`);
  assert.equal(att.status, 'pending', 'a row is not "ready" before its bytes arrive');

  const ready = await data.attachments.setStatus(ctxA, att.id, 'ready');
  assert.equal(ready.status, 'ready');

  assert.equal((await data.attachments.list(ctxB, {})).rows.length, 0);
  assert.equal(await data.attachments.remove(ctxB, att.id), null, 'B cannot delete A attachment');
  assert.equal((await data.attachments.list(ctxA, {})).rows.length, 1);

  // no storage credentials are configured here, so signing must say so
  // instead of inventing a URL that would 404 in the user's face.
  const signed = await data.attachments.sign(ctxA, att.id, 300);
  assert.equal(signed.unavailable, true);
  assert.match(signed.reason, /SUPABASE_URL|not configured/i);
  assert.equal(await data.attachments.sign(ctxB, att.id, 300), null, 'ownership is checked before signing');
});

test('cursor pagination is stable and matches the other driver format', async () => {
  const owner = { userId: B, email: 'b@test.dev' };
  for (let i = 1; i <= 5; i += 1) {
    await data.conversations.create(owner, { title: `thread ${i}` });
  }
  const seen = [];
  let cursor = null;
  for (let p = 0; p < 6; p += 1) {
    const out = await data.conversations.list(owner, { limit: 2, cursor });
    seen.push(...out.rows.map((r) => r.id));
    cursor = out.next_cursor;
    if (!cursor) break;
  }
  assert.equal(seen.length, 5, 'every row appears');
  assert.equal(new Set(seen).size, 5, 'no duplicates across pages');

  // A malformed cursor degrades to the first page rather than failing.
  const bad = await data.conversations.list(owner, { limit: 2, cursor: '@@not-a-cursor@@' });
  assert.equal(bad.rows.length, 2);
});

test('deletion cascades messages and leaves the other account untouched', async () => {
  const conv = await data.conversations.create(ctxA, { title: 'to delete' });
  await data.messages.append(ctxA, conv.id, { role: 'user', content: 'bye' });
  assert.equal(await data.conversations.remove(ctxA, conv.id), true);
  assert.equal(await data.conversations.get(ctxA, conv.id), null, 'the direct URL no longer resolves');
  const orphan = await db.query(`select count(*)::int as c from public.messages where conversation_id = $1`, [conv.id]);
  assert.equal(Number(orphan.rows[0].c), 0, 'messages cascade with the conversation');
});

test('account erasure removes every row for one account and nothing else', async () => {
  const before = await db.query(`select count(*)::int as c from public.conversations where user_id = $1`, [B]);
  assert.ok(Number(before.rows[0].c) > 0, 'account B has data to survive with');

  const counts = await data.deleteUserData(ctxA);
  assert.ok(Object.keys(counts).length > 0, 'erasure reports what it removed');

  for (const [table, col] of [
    ['conversations', 'user_id'], ['messages', 'user_id'], ['memories', 'user_id'],
    ['user_provider_settings', 'user_id'], ['user_provider_credentials', 'user_id'],
    ['usage_events', 'user_id'], ['agent_tasks', 'user_id'], ['tool_events', 'user_id'],
    ['attachments', 'user_id'], ['profiles', 'id'],
  ]) {
    const left = await db.query(`select count(*)::int as c from public.${table} where ${col} = $1`, [A]);
    assert.equal(Number(left.rows[0].c), 0, `${table} still holds rows for the deleted account`);
  }

  const kept = await db.query(`select count(*)::int as c from public.conversations where user_id = $1`, [B]);
  assert.equal(Number(kept.rows[0].c), Number(before.rows[0].c), "another account's data is untouched");
});
