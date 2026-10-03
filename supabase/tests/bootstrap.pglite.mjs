// Proves `supabase/bootstrap.sql` applies cleanly before anyone pastes it.
//
// The bundle is what an operator runs against a real project, so the bundle is
// what gets tested — not the migrations it was generated from. If the
// generator drops a file, reorders one, or mangles a statement boundary, this
// fails here instead of in the SQL editor.
//
// The Supabase environment is reconstructed first, exactly as the RLS suite
// does it: the roles, `auth.users`, `auth.uid()`, and the `storage` schema are
// present in a real hosted project, so they must be present for the bundle to
// be exercised under the conditions it will actually run in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, '..', 'bootstrap.sql');
const MIGRATIONS = path.join(HERE, '..', 'migrations');

const SQL = fs.readFileSync(BUNDLE, 'utf8');

/** The parts of a hosted Supabase project the migrations rely on. */
const SUPABASE_ENV = `
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
`;

test('the generated bundle matches the migrations it claims to contain', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 9, `expected the full migration set, found ${files.length}`);

  for (const f of files) {
    assert.ok(SQL.includes(`-- ── ${f}`), `bundle is missing a section for ${f}`);
    // The body must actually be present, not just the banner.
    const body = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').trimEnd();
    assert.ok(SQL.includes(body), `bundle's ${f} section is truncated or altered`);
  }
  // Order matters: later migrations alter what earlier ones create.
  const positions = files.map((f) => SQL.indexOf(`-- ── ${f}`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'sections are out of order');
});

test('the bundle carries no secrets and no data', () => {
  // DDL only: a bootstrap must never ship a key, a token, or a row.
  assert.ok(!/service_role[^\n]*eyJ[A-Za-z0-9_-]{10,}/.test(SQL), 'a JWT appears in the bundle');
  assert.ok(!/sb_secret_|sb_publishable_/.test(SQL), 'a Supabase API key appears in the bundle');
  assert.ok(!/sk-or-v1-|nvapi-/.test(SQL), 'a provider key appears in the bundle');
  assert.ok(!/\bcopy\s+[a-z_" ]+\s+from\b/i.test(SQL), 'the bundle loads data with COPY');

  // Statements that actually execute at apply time: function bodies are
  // removed first, because the signup trigger legitimately inserts a profile
  // into public.profiles when a user is created — that is schema behaviour,
  // not seeded data. Same for the bucket definitions, which are configuration.
  const executable = SQL
    .replace(/\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$/gi, ' /* function body */ ')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  const inserts = [...executable.matchAll(/\binsert\s+into\s+([a-z_."]+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(
    [...new Set(inserts)].sort(),
    ['storage.buckets'],
    'the only statement the bundle may execute is bucket configuration'
  );

  // And nothing that would rewrite a user's data on a live project.
  for (const forbidden of ['delete from', 'truncate', 'drop table', 'drop schema']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`, 'i').test(executable), `the bundle runs "${forbidden}"`);
  }
});

test('the bundle applies cleanly to a real PostgreSQL engine', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(SUPABASE_ENV);
    // The whole point: one paste, no partial failure.
    await db.exec(SQL);

    // The tables the gateway queries must exist with the columns its SQL names.
    const expected = {
      profiles: ['id', 'display_name', 'avatar_url', 'onboarding_completed', 'preferred_provider', 'preferred_model', 'theme', 'voice_preference', 'memory_preference', 'updated_at'],
      conversations: ['id', 'user_id', 'title', 'model', 'provider', 'archived', 'updated_at'],
      messages: ['id', 'conversation_id', 'user_id', 'role', 'content', 'model', 'provider', 'status', 'error_code', 'tokens', 'latency_ms', 'metadata'],
      memories: ['id', 'user_id', 'content', 'category', 'kind', 'pinned', 'updated_at'],
      user_provider_settings: ['user_id', 'default_provider', 'default_model', 'fallback_enabled', 'free_only'],
      user_provider_credentials: ['id', 'user_id', 'provider', 'label', 'masked_hint', 'secret_ciphertext', 'key_version', 'status', 'last_checked_at'],
      usage_events: ['id', 'user_id', 'provider', 'model', 'request_id', 'task', 'tokens_in', 'tokens_out', 'latency_ms', 'status'],
      agent_tasks: ['id', 'user_id', 'conversation_id', 'type', 'objective', 'status', 'progress', 'result', 'error', 'completed_at'],
      tool_events: ['id', 'user_id', 'conversation_id', 'task_id', 'tool', 'state', 'detail'],
      attachments: ['id', 'user_id', 'conversation_id', 'bucket', 'storage_path', 'filename', 'mime_type', 'size_bytes', 'status'],
    };

    for (const [table, columns] of Object.entries(expected)) {
      const r = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [table]
      );
      const have = new Set(r.rows.map((x) => x.column_name));
      assert.ok(have.size > 0, `table ${table} was not created`);
      for (const c of columns) {
        assert.ok(have.has(c), `${table}.${c} is missing — the gateway's SQL names it`);
      }
    }

    // The four storage buckets the app expects, all private.
    const buckets = await db.query(`select id, public from storage.buckets`);
    const ids = buckets.rows.map((b) => b.id).sort();
    assert.deepEqual(ids, ['artifacts', 'attachments', 'avatars', 'generated']);
    assert.ok(buckets.rows.every((b) => b.public === false), 'every bucket must be private');

    // RLS must be on AND forced — that is what makes the gateway's
    // `set local role authenticated` the real boundary.
    const rls = await db.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)
    `, [Object.keys(expected)]);
    assert.equal(rls.rows.length, Object.keys(expected).length);
    for (const row of rls.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname}: RLS not enabled`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname}: RLS not FORCED`);
    }

    // A profile row appears for a new auth user (the signup trigger).
    const U = '11111111-1111-4111-8111-111111111111';
    await db.exec(`insert into auth.users (id, email) values ('${U}', 'u@example.test')`);
    const prof = await db.query(`select count(*)::int as c from public.profiles where id = '${U}'`);
    assert.equal(Number(prof.rows[0].c), 1, 'signup must create a profile');
  } finally {
    await db.close();
  }
});

test('the bundle is re-runnable (a second run changes nothing and does not fail)', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(SUPABASE_ENV);
    await db.exec(SQL);
    // Operators re-run things. An "already exists" error here would be a trap.
    await db.exec(SQL);
    const t = await db.query(`select count(*)::int as c from information_schema.tables where table_schema='public' and table_name='conversations'`);
    assert.equal(Number(t.rows[0].c), 1, 'exactly one conversations table');
  } finally {
    await db.close();
  }
});
