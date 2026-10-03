#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// The pgTAP suite, executed.
//
// `supabase/tests/rls_test.sql` is what you run against a hosted project
// (`supabase test db`). Nothing about it can be checked on a machine without a
// database — until now: this file boots PGlite with a Supabase-shaped
// `auth.users`, installs a **minimal pgTAP implementation** (plan / is /
// throws_ok / lives_ok / finish, where a failing assertion raises), and runs
// that exact .sql file, unmodified.
//
// So the file you are told to run in CI is a file that has actually been run.
//
//   node supabase/tests/rls_pgtap.pglite.mjs
// ═══════════════════════════════════════════════════════════════════════

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const SUITE = path.join(HERE, 'rls_test.sql');
const MIGRATIONS_DIR = path.join(HERE, '..', 'migrations');

const db = new PGlite({ extensions: { pgcrypto } });
const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

// ── a Supabase-shaped environment ───────────────────────────────────────
// auth.users here carries the columns the pgTAP fixtures insert, so the file
// runs exactly as it would against a hosted project.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id                 uuid primary key,
    instance_id        uuid,
    aud                text,
    role               text,
    email              text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb,
    created_at         timestamptz,
    updated_at         timestamptz
  );

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ), '')::uuid $$;

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

// ── migrations ──────────────────────────────────────────────────────────
for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  } catch (e) {
    fail(`migration ${f} failed: ${e.message}`);
  }
}

// ── Supabase's default grants ───────────────────────────────────────────
// A hosted project grants `anon` and `authenticated` table privileges by
// default, so the suite asserts "no rows", not "permission denied". Granting
// the same here means the policies are what is under test.
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select, insert on storage.buckets to anon, authenticated, service_role;
  grant insert on auth.users to anon, authenticated;
`);

// ── the smallest pgTAP that can still fail ──────────────────────────────
// Not a re-implementation of pgTAP: just enough that a wrong row count or a
// statement that should have been rejected turns into an error.
await db.exec(`
  create function public.plan(n int) returns text language sql as $$ select '1..' || n $$;

  create function public.finish() returns text language sql as $$ select 'finished' $$;

  create function public.is(got anyelement, want anyelement, msg text) returns text
  language plpgsql as $$
  begin
    if got is distinct from want then
      raise exception 'not ok — % (got %, wanted %)', msg, got, want using errcode = 'P0001';
    end if;
    return 'ok';
  end $$;

  create function public.throws_ok(stmt text, code text, expected_msg text, msg text) returns text
  language plpgsql as $$
  declare raised boolean := false;
  begin
    begin
      execute stmt;
    exception when others then
      if code is null or sqlstate = code then
        raised := true;
      else
        raise exception 'not ok — % (raised % %, wanted %)', msg, sqlstate, sqlerrm, code
          using errcode = 'P0001';
      end if;
    end;
    if not raised then
      raise exception 'not ok — % (statement was allowed)', msg using errcode = 'P0001';
    end if;
    return 'ok';
  end $$;

  create function public.lives_ok(stmt text, msg text) returns text
  language plpgsql as $$
  begin
    begin
      execute stmt;
    exception when others then
      raise exception 'not ok — % (raised % %)', msg, sqlstate, sqlerrm using errcode = 'P0001';
    end;
    return 'ok';
  end $$;
`);

// ── run the real suite ──────────────────────────────────────────────────
const sql = fs.readFileSync(SUITE, 'utf8');
const plan = Number((sql.match(/select plan\((\d+)\)/) || [])[1] || 0);
const assertions = (sql.match(/^select (is|throws_ok|lives_ok)\(/gm) || []).length;

try {
  await db.exec(sql);
} catch (e) {
  await db.close();
  fail(`rls_test.sql failed:\n    ${e.message}`);
}

// The file is `begin; … rollback;` — pglite returns the last statement's
// result, so a successful exec means every assertion held.
await db.close();

if (assertions !== plan) {
  fail(`plan(${plan}) but ${assertions} assertions found — the suite would not balance under real pgTAP`);
}

console.log(`\npgTAP suite executed against PGlite — ${plan} assertions, 0 failures\n`);
console.log('  ✓ supabase/tests/rls_test.sql runs, balances its plan, and passes');
console.log('  ✓ anonymous, owner and non-owner paths behave as the policies claim');
console.log('  ✓ run the same file on your project with: supabase test db\n');
