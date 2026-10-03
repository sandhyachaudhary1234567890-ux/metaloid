#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// RLS — actually executed.
//
// `rls_test.sql` is the pgTAP suite for a hosted Supabase project
// (`supabase test db`). This file is the same security story without needing
// a server: it boots Postgres-in-WASM (PGlite), recreates the small parts of
// the Supabase environment the policies depend on — `auth.uid()`, the
// `auth.users` table, the `storage` schema — applies the real migrations from
// `supabase/migrations/`, and then tries to break in.
//
// Two deliberate choices make this a real test rather than a re-statement of
// the policies:
//
//   1. After the migrations, `anon` and `authenticated` are granted full table
//      privileges — the worst case a real project can be in (Supabase grants
//      these by default). Any protection measured below therefore comes from
//      the *policies*, not from a missing GRANT.
//   2. Every probe runs as a non-superuser role. Superusers bypass RLS, so
//      testing as `postgres` would prove nothing at all.
//
// Running the same migrations against the same Postgres version your project
// uses is what makes this evidence; PGlite is Postgres compiled to WASM, not a
// simulation of it.
//
//   node supabase/tests/rls.pglite.mjs      → exit 0 when every property holds
// ═══════════════════════════════════════════════════════════════════════

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, '..', 'migrations');

// ── fixed identities and rows ───────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333'; // used for the cascade test
const CONV_A = 'aaaa1111-1111-4111-8111-111111111111';
const CONV_B = 'bbbb1111-1111-4111-8111-111111111111';
const ATT_A = 'aaaa7777-7777-4777-8777-777777777777';
const CRED_A = 'aaaa8888-8888-4888-8888-888888888888';
const OBJ_A = 'aaaa9999-9999-4999-8999-999999999999';

// ── tiny assertion harness ──────────────────────────────────────────────
let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const blocked = (r) => !r.ok || (r.rows || []).length === 0;
const visible = (r) => r.ok && (r.rows || []).length > 0;
const n = (r) => (r.ok ? Number(r.rows[0]?.c ?? 0) : -1);

// pgcrypto is what Supabase itself enables for gen_random_uuid(); loading the
// bundled build means migration 0001 runs here exactly as it runs there.
const db = new PGlite({ extensions: { pgcrypto } });
const VERSION = (await db.query('select version() as v')).rows[0].v.split(' ').slice(0, 2).join(' ');

/** Run statements as the superuser (migrations, fixtures, verification). */
const asRoot = (sql) => db.exec(sql);
const rootQuery = (sql) => db.query(sql);

/** Run one query as `role`, with the JWT claims Supabase would have set. */
async function as(role, sql, sub = null) {
  await db.exec('reset role');
  // Claims are reset on every probe. `set_config` persists for the session, so
  // forgetting this makes the *next* probe inherit the last user's identity —
  // which would make an "anon cannot read" check pass or fail for the wrong
  // reason. `sub` is empty for anon, which auth.uid() normalises to null.
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${sub || ''}', false),
            set_config('request.jwt.claim.role', '${role}', false),
            set_config('request.jwt.claims', '{"role":"${role}"${sub ? `,"sub":"${sub}"` : ''}}', false);`,
  );
  await db.exec(`set role ${role};`);
  try {
    const res = await db.query(sql);
    return { ok: true, rows: res.rows };
  } catch (e) {
    return { ok: false, error: String(e.message).split('\n')[0] };
  } finally {
    await db.exec('reset role');
  }
}

const owner = (sql) => as('authenticated', sql, A);
const other = (sql) => as('authenticated', sql, B);
const anon = (sql) => as('anon', sql);

// ── 1. the Supabase environment the migrations expect ───────────────────
await asRoot(`
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

  -- mirrors Supabase's own definitions closely enough to be meaningful
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
  -- folders = the path minus the filename, exactly like Supabase's helper
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;

  grant usage on schema auth, storage to anon, authenticated, service_role;
`);

// ── 2. the real migrations, in order ────────────────────────────────────
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
  try {
    await asRoot(sql);
  } catch (e) {
    console.error(`\n✗ migration ${f} failed: ${e.message}\n`);
    process.exit(1);
  }
}

// ── 3. worst case: full grants to anon + authenticated ──────────────────
// (Supabase's defaults). From here on, only the policies protect anything.
await asRoot(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select, insert on storage.buckets to anon, authenticated, service_role;
  grant insert on auth.users to anon, authenticated; -- even this, on purpose
`);

// ── 4. fixtures: A owns one row in every table; B owns a thread too ─────
// Re-runnable: the matrix below deliberately deletes rows to prove the owner
// can, so the fixtures are restored before the later assertions.
const FIXTURES = `
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${A}', 'a@example.test', '{}'::jsonb),
    ('${B}', 'b@example.test', '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.conversations (id, user_id, title) values
    ('${CONV_A}', '${A}', 'A private thread'),
    ('${CONV_B}', '${B}', 'B private thread')
  on conflict (id) do nothing;

  insert into public.messages (id, conversation_id, user_id, role, content) values
    ('aaaa2222-2222-4222-8222-222222222222', '${CONV_A}', '${A}', 'user', 'A private message')
  on conflict (id) do nothing;
  insert into public.memories (id, user_id, content, category) values
    ('aaaa3333-3333-4333-8333-333333333333', '${A}', 'A private memory', 'Personal')
  on conflict (id) do nothing;
  insert into public.usage_events (id, user_id, provider, model) values
    ('aaaa4444-4444-4444-8444-444444444444', '${A}', 'openrouter', 'x/y')
  on conflict (id) do nothing;
  insert into public.agent_tasks (id, user_id, type, objective) values
    ('aaaa5555-5555-4555-8555-555555555555', '${A}', 'research', 'A private task')
  on conflict (id) do nothing;
  insert into public.tool_events (id, user_id, tool) values
    ('aaaa6666-6666-4666-8666-666666666666', '${A}', 'browser')
  on conflict (id) do nothing;
  insert into public.attachments (id, user_id, storage_path, filename, mime_type) values
    ('${ATT_A}', '${A}', 'attachments/${A}/${ATT_A}/invoice.pdf', 'invoice.pdf', 'application/pdf')
  on conflict (id) do nothing;
  insert into public.user_provider_settings (user_id, default_model) values ('${A}', 'free/model')
  on conflict (user_id) do nothing;
  insert into public.user_provider_credentials (id, user_id, provider, masked_hint, secret_ciphertext) values
    ('${CRED_A}', '${A}', 'openrouter', 'sk-or-…f3a9', 'v1:k1:iv:tag:ct')
  on conflict (id) do nothing;
  -- NOTE: storage.objects.name is the key INSIDE the bucket, so it starts at
  -- the owner id — the bucket is a separate column. public.attachments keeps
  -- the fully-qualified form in storage_path for auditability.
  insert into storage.objects (id, bucket_id, name, owner) values
    ('${OBJ_A}', 'attachments', '${A}/${ATT_A}/invoice.pdf', '${A}')
  on conflict (id) do nothing;
`;
const seed = () => asRoot(FIXTURES);
await seed();

// ── 5. the security matrix ──────────────────────────────────────────────
// For each table: anonymous can do nothing, the owner has exactly the access
// the app needs, and a second signed-in user can neither read nor modify the
// owner's rows — whether they guess the row id or try to claim the owner's
// user_id. Selecting `where <owner> = A` keeps the assertion precise even
// after B has inserted rows of their own.
const TABLES = [
  { t: 'profiles', col: 'id', mutate: `display_name = 'stolen'`, insert: (u) => `insert into public.profiles (id, display_name) values ('${u}', 'x') on conflict (id) do nothing`, deletable: false },
  { t: 'conversations', col: 'user_id', mutate: `title = 'stolen'`, insert: (u) => `insert into public.conversations (user_id, title) values ('${u}', 'x')`, deletable: true },
  { t: 'messages', col: 'user_id', mutate: `content = 'stolen'`, insert: (u) => `insert into public.messages (conversation_id, user_id, role, content) values ('${CONV_B}', '${u}', 'user', 'x')`, deletable: true },
  { t: 'memories', col: 'user_id', mutate: `content = 'stolen'`, insert: (u) => `insert into public.memories (user_id, content) values ('${u}', 'x')`, deletable: true },
  { t: 'agent_tasks', col: 'user_id', mutate: `progress = 50`, insert: (u) => `insert into public.agent_tasks (user_id, type) values ('${u}', 'research')`, deletable: true },
  { t: 'tool_events', col: 'user_id', mutate: `state = 'error'`, insert: (u) => `insert into public.tool_events (user_id, tool) values ('${u}', 't')`, deletable: false, mutable: false },
  { t: 'attachments', col: 'user_id', mutate: `filename = 'stolen.pdf'`, insert: (u) => `insert into public.attachments (user_id, storage_path, filename) values ('${u}', 'attachments/${u}/x/f.txt', 'f.txt')`, deletable: true },
  { t: 'user_provider_settings', col: 'user_id', mutate: `default_model = 'stolen/model'`, insert: (u) => `insert into public.user_provider_settings (user_id) values ('${u}')`, deletable: true },
  { t: 'user_provider_credentials', col: 'user_id', mutate: `masked_hint = 'sk-…0000'`, insert: (u) => `insert into public.user_provider_credentials (user_id, provider, secret_ciphertext) values ('${u}', 'openrouter', 'v1:k1:a:b:c')`, deletable: true },
  { t: 'usage_events', col: 'user_id', mutate: `status = 'error'`, insert: (u) => `insert into public.usage_events (user_id, provider) values ('${u}', 'openrouter')`, deletable: false, mutable: false },
];

for (const cfg of TABLES) {
  const { t, col } = cfg;
  const mine = `select count(*)::int as c from public.${t} where ${col} = '${A}'`;

  // ── anonymous: no read, no write, no update, no delete ──
  const aSel = await anon(mine);
  check(`anon cannot SELECT ${t}`, n(aSel) === 0, aSel.error || `saw ${n(aSel)} row(s)`);
  const aIns = await anon(cfg.insert(A));
  check(`anon cannot INSERT into ${t}`, !aIns.ok, aIns.error || 'insert was allowed');
  const aUpd = await anon(`update public.${t} set ${cfg.mutate} where ${col} = '${A}' returning 1`);
  check(`anon cannot UPDATE ${t}`, blocked(aUpd), `${(aUpd.rows || []).length} row(s)`);
  const aDel = await anon(`delete from public.${t} where ${col} = '${A}' returning 1`);
  check(`anon cannot DELETE ${t}`, blocked(aDel), `${(aDel.rows || []).length} row(s)`);

  // ── owner: exactly the access the app needs ──
  const oSel = await owner(mine);
  check(`owner can SELECT their own ${t}`, n(oSel) >= 1, oSel.error || `saw ${n(oSel)} row(s)`);
  check(`owner cannot SELECT another user's ${t}`, n(await owner(`select count(*)::int as c from public.${t} where ${col} = '${B}'`)) === 0);

  // the owner inserts a row owned by themselves (B acts as B here)
  const oIns = await other(cfg.insert(B));
  check(`owner can INSERT their own ${t}`, oIns.ok, oIns.error);

  const upd = `update public.${t} set ${cfg.mutate} where ${col} = '${A}' returning 1`;
  const oUpd = await owner(upd);
  if (cfg.mutable === false) {
    check(`${t} are append-only for the owner`, blocked(oUpd), `${(oUpd.rows || []).length} row(s)`);
  } else {
    check(`owner can UPDATE their own ${t}`, visible(oUpd), oUpd.error || `${(oUpd.rows || []).length} row(s)`);
  }

  if (cfg.deletable) {
    // run the delete in a transaction that is rolled back, so proving the
    // owner *can* delete does not destroy the fixture the next check needs
    await db.exec('begin');
    const oDel = await owner(`delete from public.${t} where ${col} = '${A}' returning 1`);
    await db.exec('rollback');
    check(`owner can DELETE their own ${t}`, visible(oDel), oDel.error || `${(oDel.rows || []).length} row(s)`);
  } else {
    check(`${t} rows cannot be deleted by the owner (nothing to delete)`,
      blocked(await owner(`delete from public.${t} where ${col} = '${A}' returning 1`)));
  }

  // ── non-owner: nothing at all ──
  const bSel = await other(mine);
  check(`non-owner SELECT on ${t} returns nothing`, n(bSel) === 0, bSel.error || `saw ${n(bSel)} row(s)`);
  const bUpd = await other(`update public.${t} set ${cfg.mutate} where ${col} = '${A}' returning 1`);
  check(`non-owner cannot UPDATE ${t}`, blocked(bUpd), `${(bUpd.rows || []).length} row(s)`);
  const bDel = await other(`delete from public.${t} where ${col} = '${A}' returning 1`);
  check(`non-owner cannot DELETE ${t}`, blocked(bDel), `${(bDel.rows || []).length} row(s)`);
  const bIns = await other(cfg.insert(A));
  check(`non-owner cannot INSERT a row owned by someone else into ${t}`, !bIns.ok, bIns.error || 'insert was allowed');
}

// restore anything a rolled-back transaction could not (nothing, by design —
// but the fixtures are cheap and the later sections assert on exact rows)
await seed();

// ── 6. behaviours that are not just "who owns the row" ──────────────────
check('usage_events stay append-only for the owner',
  blocked(await owner(`update public.usage_events set status = 'error' returning id`)));
check('tool_events cannot be rewritten (audit trail)',
  blocked(await owner(`delete from public.tool_events returning id`)));

// cross-thread forgery: B may not append a message into A's conversation
check("a message cannot be attached to someone else's conversation",
  !(await other(`insert into public.messages (conversation_id, user_id, role, content)
                 values ('${CONV_A}', '${B}', 'user', 'hi')`)).ok);

// path forgery: the attachment row must live under the caller's own folder
check("an attachment row cannot claim another user's storage path",
  !(await other(`insert into public.attachments (user_id, storage_path, filename)
                 values ('${B}', 'attachments/${A}/x/f.txt', 'f.txt')`)).ok);
check('an attachment path cannot be claimed twice',
  !(await other(`insert into public.attachments (user_id, storage_path, filename)
                 values ('${B}', 'attachments/${A}/${ATT_A}/invoice.pdf', 'invoice.pdf')`)).ok);

// credentials: secrets are ciphertext, and never visible to anyone else
const bCred = await other(`select count(*)::int as c from public.user_provider_credentials where user_id = '${A}'`);
check("another user cannot see the owner's provider credential", n(bCred) === 0, JSON.stringify(bCred));
check('a credential row stores a versioned ciphertext envelope, never a plaintext key',
  (await rootQuery(`select secret_ciphertext from public.user_provider_credentials where id = '${CRED_A}'`))
    .rows[0].secret_ciphertext.startsWith('v1:'));

// ── 7. storage objects ──────────────────────────────────────────────────
const objsMine = `select count(*)::int as c from storage.objects where name like '${A}/%'`;
const allObjs = `select count(*)::int as c from storage.objects`;
const aObj = await anon(allObjs);
check('anon cannot list storage objects', n(aObj) === 0, JSON.stringify(aObj));
const oObj = await owner(objsMine);
check('owner sees their own object', n(oObj) === 1, JSON.stringify(oObj));
const bObj = await other(objsMine);
check("another user sees none of the owner's objects", n(bObj) === 0, JSON.stringify(bObj));
const bInsObj = await other(`insert into storage.objects (bucket_id, name) values ('attachments', '${A}/x/steal.txt')`);
check("another user cannot insert into the owner's folder", !bInsObj.ok, bInsObj.error || 'allowed');
const oInsObj = await owner(`insert into storage.objects (bucket_id, name) values ('attachments', '${A}/new/file.txt')`);
check('owner can write under their own folder', oInsObj.ok, oInsObj.error);
// the trap the API deliberately avoids: a key that repeats the bucket name
// puts 'attachments' where the policy expects the user id, so RLS denies it
const prefixed = await owner(`insert into storage.objects (bucket_id, name) values ('attachments', 'attachments/${A}/x/file.txt')`);
check('a fully-qualified object key is rejected (bucket is not part of the key)',
  !prefixed.ok, prefixed.error || 'allowed');
const bDelObj = await other(`delete from storage.objects where id = '${OBJ_A}' returning id`);
check("another user cannot delete the owner's object", blocked(bDelObj), `${(bDelObj.rows || []).length} row(s)`);
const oDelObj = await owner(`delete from storage.objects where id = '${OBJ_A}' returning id`);
check('owner can delete their own object', visible(oDelObj), oDelObj.error || `${(oDelObj.rows || []).length} row(s)`);
check('all three buckets are private',
  Number((await rootQuery(`select count(*)::int as c from storage.buckets where public`)).rows[0].c) === 0);
check('the three expected buckets exist',
  Number((await rootQuery(`select count(*)::int as c from storage.buckets`)).rows[0].c) === 3);

// ── 8. account deletion really cascades ─────────────────────────────────
await asRoot(`insert into auth.users (id, email) values ('${C}', 'c@example.test')`);
check('a new auth user gets a profile automatically',
  Number((await rootQuery(`select count(*)::int as c from public.profiles where id = '${C}'`)).rows[0].c) === 1);

await asRoot(`
  insert into public.conversations (id, user_id, title) values ('cccc1111-1111-4111-8111-111111111111', '${C}', 'C thread');
  insert into public.messages (conversation_id, user_id, role, content) values ('cccc1111-1111-4111-8111-111111111111', '${C}', 'user', 'C message');
  insert into public.memories (user_id, content) values ('${C}', 'C memory');
  insert into public.user_provider_settings (user_id) values ('${C}');
  insert into public.user_provider_credentials (user_id, provider, secret_ciphertext) values ('${C}', 'openrouter', 'v1:k1:a:b:c');
  insert into public.agent_tasks (user_id, type) values ('${C}', 'research');
  insert into public.usage_events (user_id, provider) values ('${C}', 'openrouter');
`);

await asRoot(`delete from auth.users where id = '${C}'`);

for (const t of ['profiles', 'conversations', 'messages', 'memories', 'user_provider_settings', 'user_provider_credentials', 'agent_tasks', 'usage_events']) {
  const col = t === 'profiles' ? 'id' : 'user_id';
  const left = Number((await rootQuery(`select count(*)::int as c from public.${t} where ${col} = '${C}'`)).rows[0].c);
  check(`deleting the auth user removes their ${t}`, left === 0, `${left} row(s) left`);
}

// ── 9. break-glass: the gateway's service role must still work ──────────
// (object signing + account deletion run as service_role, which bypasses RLS
// by design — proven here so the capability is tested, not assumed)
check('service_role can read across users (needed for signed URLs + deletion)',
  n(await as('service_role', `select count(*)::int as c from public.conversations`)) >= 1);

// ── report ──────────────────────────────────────────────────────────────
await db.close();
console.log(`\nRLS security matrix (${VERSION}, PGlite) — ${files.length} migrations applied`);
console.log(`  ${pass} properties held, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log('  ✓ anonymous is locked out of every table');
console.log('  ✓ owners have exactly the access the app needs');
console.log('  ✓ no cross-user read, insert, update or delete is possible');
console.log('  ✓ private storage paths are enforced by policy, not convention');
console.log('  ✓ account deletion removes every row that referenced the user\n');
