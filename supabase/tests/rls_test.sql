-- ═══════════════════════════════════════════════════════════════════════
-- RLS security matrix — the cross-user isolation proof.
--
-- Run with the Supabase CLI (pgTAP is supported out of the box):
--     supabase test db
-- or against any Postgres with pgTAP installed:
--     psql "$DATABASE_URL" -f supabase/tests/rls_test.sql
--
-- What this file does NOT do is trust that "the SQL ran". Every assertion
-- below switches role and sets auth.uid() the way PostgREST does, then
-- counts rows. If a policy is missing or wrong, the counts change and the
-- suite fails.
--
-- Assertion style: a data-modifying statement is run on its own line and the
-- result is then inspected. PostgreSQL refuses a data-modifying CTE inside a
-- function argument ("must be at the top level"), so `is((with … ) …)` is not
-- usable — every DML probe here is a plain statement followed by a check.
--
--   anon            → sees nothing, writes nothing
--   owner (A)       → full DML on A's rows
--   non-owner (B)   → zero rows, zero successful updates/deletes
-- ═══════════════════════════════════════════════════════════════════════

begin;
select plan(49);

-- ── fixtures: two auth users and one row each ──────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.test', 'x', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.test', 'x', now(), now(), now())
on conflict (id) do nothing;

-- profiles are created by the on_auth_user_created trigger; be explicit anyway
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'User A'),
  ('22222222-2222-2222-2222-222222222222', 'User B')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.conversations (id, user_id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A private thread'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B private thread')
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, user_id, role, content) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user', 'A secret'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'user', 'B secret')
on conflict (id) do nothing;

insert into public.memories (id, user_id, content) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'A memory'),
  ('bbbbbbbb-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'B memory')
on conflict (id) do nothing;

insert into public.user_provider_credentials (id, user_id, provider, masked_hint, secret_ciphertext) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'openrouter', '…aaaa', 'v1:iv:tag:ct-a'),
  ('bbbbbbbb-0000-0000-0000-0000000000d1', '22222222-2222-2222-2222-222222222222', 'openrouter', '…bbbb', 'v1:iv:tag:ct-b')
on conflict (id) do nothing;

insert into public.agent_tasks (id, user_id, type, objective) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'research', 'A task'),
  ('bbbbbbbb-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'research', 'B task')
on conflict (id) do nothing;

insert into public.usage_events (id, user_id, provider, model) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'openrouter', 'fake/alpha:free'),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'openrouter', 'fake/beta:free')
on conflict (id) do nothing;

insert into public.attachments (id, user_id, conversation_id, bucket, storage_path, filename) values
  ('aaaaaaaa-0000-0000-0000-0000000000aa', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'attachments', 'attachments/11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000aa/a.txt', 'a.txt'),
  ('bbbbbbbb-0000-0000-0000-0000000000aa', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'attachments', 'attachments/22222222-2222-2222-2222-222222222222/bbbbbbbb-0000-0000-0000-0000000000aa/b.txt', 'b.txt')
on conflict (id) do nothing;

-- ── private storage fixtures ───────────────────────────────────────────
-- storage.objects.name is the key INSIDE the bucket (the bucket is a separate
-- column), so it starts at the owner id. public.attachments.storage_path keeps
-- the fully-qualified form.
insert into storage.objects (id, bucket_id, name, owner) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'attachments',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000aa/a.txt',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'attachments',
   '22222222-2222-2222-2222-222222222222/bbbbbbbb-0000-0000-0000-0000000000aa/b.txt',
   '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- ── helpers that mimic PostgREST ───────────────────────────────────────
-- These switch the *actual* role, not just the `role` GUC: a superuser (and a
-- table owner, without FORCE RLS) bypasses row level security entirely, so a
-- helper that only sets a GUC would make every assertion below meaningless.
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

-- returns the session to the connecting role, so an assertion can inspect what
-- a probe under `anon` / `authenticated` actually did
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ══════════════════════ ANON: nothing at all ══════════════════════════
select pg_temp.as_anon();

select is((select count(*) from public.conversations), 0::bigint,
  'anon: conversations SELECT returns no rows');
select is((select count(*) from public.messages), 0::bigint,
  'anon: messages SELECT returns no rows');
select is((select count(*) from public.memories), 0::bigint,
  'anon: memories SELECT returns no rows');
select is((select count(*) from public.profiles), 0::bigint,
  'anon: profiles SELECT returns no rows');
select is((select count(*) from public.user_provider_credentials), 0::bigint,
  'anon: provider credentials SELECT returns no rows');

select throws_ok(
  $$ insert into public.conversations (user_id, title)
     values ('11111111-1111-1111-1111-111111111111', 'anon insert') $$,
  '42501', null, 'anon: conversations INSERT is denied');

select throws_ok(
  $$ insert into public.memories (user_id, content)
     values ('11111111-1111-1111-1111-111111111111', 'anon memory') $$,
  '42501', null, 'anon: memories INSERT is denied');

select pg_temp.as_anon();
update public.conversations set title = 'hacked';
select pg_temp.as_admin();
select is((select count(*) from public.conversations where title = 'hacked'), 0::bigint,
  'anon: conversations UPDATE touches no rows');
select pg_temp.as_anon();

select is((select count(*) from storage.objects), 0::bigint,
  'anon: private storage objects are invisible');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('attachments', '11111111-1111-1111-1111-111111111111/x/y.txt') $$,
  '42501', null, 'anon: cannot write into private storage');
select is((select count(*) from storage.buckets where public), 0::bigint,
  'anon: no bucket is public');

delete from public.messages;
select pg_temp.as_admin();
select is((select count(*) from public.messages), 2::bigint,
  'anon: messages DELETE touches no rows');
select pg_temp.as_anon();

-- ══════════════════════ OWNER (A): full access to A ═══════════════════
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select is((select count(*) from public.conversations), 1::bigint,
  'owner: sees exactly their own conversation');
select is((select count(*) from public.messages), 1::bigint,
  'owner: sees exactly their own message');
select is((select count(*) from public.memories), 1::bigint,
  'owner: sees exactly their own memory');
select is((select count(*) from public.profiles), 1::bigint,
  'owner: sees exactly their own profile');
select is((select count(*) from public.attachments), 1::bigint,
  'owner: sees exactly their own attachment');
select is((select count(*) from storage.objects
           where name like '11111111-1111-1111-1111-111111111111/%'), 1::bigint,
  'owner: sees exactly their own stored object');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('attachments', '11111111-1111-1111-1111-111111111111/new/file.txt') $$,
  'owner: can write under their own folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('attachments', 'attachments/11111111-1111-1111-1111-111111111111/x/y.txt') $$,
  '42501', null,
  'owner: a key that repeats the bucket name is rejected (bucket is not part of the key)');
select is((select count(*) from public.agent_tasks), 1::bigint,
  'owner: sees exactly their own agent task');
select is((select count(*) from public.usage_events), 1::bigint,
  'owner: sees exactly their own usage event');
select is((select count(*) from public.user_provider_credentials), 1::bigint,
  'owner: sees exactly their own credential row');

select lives_ok(
  $$ insert into public.conversations (user_id, title)
     values ('11111111-1111-1111-1111-111111111111', 'A new thread') $$,
  'owner: can insert their own conversation');

select lives_ok(
  $$ insert into public.messages (conversation_id, user_id, role, content)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', 'assistant', 'reply') $$,
  'owner: can insert a message into their own conversation');

select lives_ok(
  $$ update public.conversations set title = 'renamed'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'owner: can rename their own conversation');

select lives_ok(
  $$ delete from public.messages
     where id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$,
  'owner: can delete their own message');

-- claiming someone else's id is refused by WITH CHECK, not silently rewritten
select throws_ok(
  $$ insert into public.conversations (user_id, title)
     values ('22222222-2222-2222-2222-222222222222', 'forged owner') $$,
  '42501', null, 'owner: cannot insert a row owned by another user');

-- ══════════════════════ NON-OWNER (B): zero rows ══════════════════════
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');

select is((select count(*) from public.conversations
           where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
  'non-owner: cannot SELECT user A conversation (the critical test)');
select is((select count(*) from public.messages
           where conversation_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
  'non-owner: cannot SELECT user A messages');
select is((select count(*) from public.memories
           where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
  'non-owner: cannot SELECT user A memories');
select is((select count(*) from public.user_provider_credentials
           where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
  'non-owner: cannot SELECT user A provider credentials (the critical test)');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
update public.conversations set title = 'pwned'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.as_admin();
select is((select count(*) from public.conversations where title = 'pwned'), 0::bigint,
  'non-owner: cannot UPDATE user A conversation');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
update public.memories set content = 'pwned'
  where user_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.as_admin();
select is((select count(*) from public.memories where content = 'pwned'), 0::bigint,
  'non-owner: cannot UPDATE user A memories');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
delete from public.conversations where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.as_admin();
select is((select count(*) from public.conversations
           where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1::bigint,
  'non-owner: cannot DELETE user A conversation');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');

delete from public.messages where user_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.as_admin();
select is((select count(*) from public.messages
           where user_id = '11111111-1111-1111-1111-111111111111'), 1::bigint,
  'non-owner: cannot DELETE user A messages');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.messages (conversation_id, user_id, role, content)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             '22222222-2222-2222-2222-222222222222', 'user', 'injected') $$,
  '42501', null, 'non-owner: cannot inject a message into user A conversation');

-- path forgery: B tries to register an object under a path belonging to A
select throws_ok(
  $$ insert into public.attachments (user_id, bucket, storage_path, filename)
     values ('22222222-2222-2222-2222-222222222222', 'attachments',
             'attachments/11111111-1111-1111-1111-111111111111/forged/x.txt', 'x.txt') $$,
  '42501', null, 'non-owner: cannot register an attachment path under another user');

-- and the reverse claim: a path in A's namespace, row owned by B
select throws_ok(
  $$ insert into public.attachments (user_id, bucket, storage_path, filename)
     values ('22222222-2222-2222-2222-222222222222', 'attachments',
             'attachments/11111111-1111-1111-1111-111111111111/forged2/y.txt', 'y.txt') $$,
  '42501', null, 'path isolation: storage_path must start with the caller id');

select is((select count(*) from storage.objects
           where name like '11111111-1111-1111-1111-111111111111/%'), 0::bigint,
  'non-owner: cannot see any of user A stored objects');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('attachments', '11111111-1111-1111-1111-111111111111/x/steal.txt') $$,
  '42501', null, 'non-owner: cannot write into user A folder');
delete from storage.objects where name like '11111111-1111-1111-1111-111111111111/%';
select pg_temp.as_admin();
select is((select count(*) from storage.objects
           where id = 'aaaaaaaa-0000-0000-0000-0000000000f1'), 1::bigint,
  'non-owner: cannot delete user A stored object');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');

select is((select count(*) from public.conversations), 1::bigint,
  'non-owner: sees exactly their own one conversation');
-- The merged feature set declares four private buckets (attachments,
-- generated, avatars for account surfaces; artifacts for agent output).
select is((select count(*) from storage.buckets), 4::bigint,
  'exactly the four expected private buckets exist');
select is((select count(*) from storage.buckets where id in ('attachments','generated','avatars','artifacts')), 4::bigint,
  'the buckets are the ones the migrations declare');

-- ── account deletion cascades ──────────────────────────────────────────
-- (run last: it destroys user A's rows on purpose, inside this transaction.
-- Account deletion is a server-side operation, so it runs as the connecting
-- role — the gateway does it with the service role, never with a user token.)
select pg_temp.as_admin();
select lives_ok(
  $$ delete from auth.users where id = '11111111-1111-1111-1111-111111111111' $$,
  'deleting an auth user is allowed');
select is((select count(*) from public.profiles
           where id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
  'deletion: the profile is gone');
select is((select count(*) from public.conversations
           where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
  'deletion: conversations cascade away');
select is((select count(*) from public.user_provider_credentials
           where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
  'deletion: stored provider credentials cascade away');

select * from finish();
rollback;
