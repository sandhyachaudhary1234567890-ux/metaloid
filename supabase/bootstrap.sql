-- ═══════════════════════════════════════════════════════════════════════
-- METALOID — complete database bootstrap (GENERATED — DO NOT EDIT)
--
-- Built by `node supabase/build-bootstrap.mjs` from supabase/migrations/,
-- which is the only source of truth. Edit a migration and re-run the script;
-- never edit this file, or it becomes the second description of the schema
-- that this project already had to delete once.
--
-- How to use it
--
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--   It is written to be re-runnable, so running it twice is harmless.
--
-- This runs on a real Supabase project, where the roles `anon`,
-- `authenticated` and `service_role`, the `auth.uid()` function and the
-- `storage` schema already exist (migration 0002 and 0003 depend on them).
--
-- It contains no secrets and no data — only DDL, grants and policies.
--
-- Verified automatically: supabase/tests/bootstrap.pglite.mjs applies this
-- exact text to a real PostgreSQL engine and fails if it does not apply
-- cleanly, so a broken bundle cannot reach a project.
--
-- Contents (11 migrations, in order):
--    1. 0001_core_schema.sql
--    2. 0002_rls_and_grants.sql
--    3. 0003_storage.sql
--    4. 001_credential_audit.sql
--    5. 002_text_user_ids.sql
--    6. 003_credential_rotation.sql
--    7. 004_remaining_domains.sql
--    8. 005_pairing_codes.sql
--    9. 006_artifact_deleted.sql
--   10. 007_gateway_columns.sql
--   11. 008_signup_trigger_never_fails.sql
-- ═══════════════════════════════════════════════════════════════════════



-- ──────────────────────────────────────────────────────────────────────────
-- ── 0001_core_schema.sql
-- ──────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════
-- 0001 — METALOID core schema
--
-- Identity, conversations, messages, memories, provider config, usage,
-- agent tasks and attachments. Everything a browser or Android client
-- needs, owned by a Supabase Auth user.
--
-- Design rules enforced here:
--   * every user-data table carries user_id → auth.users(id), on delete cascade
--   * UUID primary keys (client-visible ids never leak sequence order)
--   * timestamptz everywhere, with created_at/updated_at defaults
--   * RLS is enabled in 0002 and is NOT optional
--   * no secrets are ever stored in plaintext (see user_provider_credentials)
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── shared: updated_at maintenance ─────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ───────────────────────────────────────────────────────────
-- Public identity only. NEVER authentication data (no password, no tokens).
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  display_name         text check (char_length(display_name) <= 80),
  avatar_url           text,
  onboarding_completed boolean not null default false,
  -- onboarding preferences live with the profile so a new device restores them
  preferred_provider   text,
  preferred_model      text,
  theme                text not null default 'obsidian',
  voice_preference     text not null default 'natural',
  memory_preference    text not null default 'on',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile row automatically for every new auth user, so the
-- application never has to race a signup confirmation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── conversations ──────────────────────────────────────────────────────
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'New conversation' check (char_length(title) <= 200),
  model      text,
  provider   text,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- list view: newest first, per user (cursor pagination on (updated_at, id))
create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc, id desc);
create index if not exists conversations_user_created_idx
  on public.conversations (user_id, created_at desc);

drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- ── messages ───────────────────────────────────────────────────────────
-- status reflects reality: 'streaming' while tokens arrive, 'complete',
-- 'cancelled' if the client aborted, 'error' if the provider failed.
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content         text not null default '',
  model           text,
  provider        text,
  status          text not null default 'complete'
                    check (status in ('streaming', 'complete', 'cancelled', 'error')),
  error_code      text,
  tokens          integer check (tokens is null or tokens >= 0),
  latency_ms      integer check (latency_ms is null or latency_ms >= 0),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at asc, id asc);
create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);
-- one in-flight assistant message per conversation (streaming recovery)
create unique index if not exists messages_one_streaming_per_conversation
  on public.messages (conversation_id) where status = 'streaming';

-- ── memories ───────────────────────────────────────────────────────────
create table if not exists public.memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  category   text not null default 'Personal',
  kind       text not null default 'explicit'
               check (kind in ('explicit', 'project', 'conversation', 'preference', 'inferred')),
  source_conversation_id uuid references public.conversations(id) on delete set null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_updated_idx
  on public.memories (user_id, updated_at desc, id desc);
create index if not exists memories_user_kind_idx
  on public.memories (user_id, kind);

drop trigger if exists memories_updated_at on public.memories;
create trigger memories_updated_at before update on public.memories
  for each row execute function public.set_updated_at();

-- ── provider settings (no secrets here) ────────────────────────────────
create table if not exists public.user_provider_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  default_provider text,
  default_model    text,
  fallback_enabled boolean not null default true,
  free_only        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists provider_settings_updated_at on public.user_provider_settings;
create trigger provider_settings_updated_at before update on public.user_provider_settings
  for each row execute function public.set_updated_at();

-- ── provider credentials (ciphertext only) ─────────────────────────────
-- `secret_ciphertext` holds the versioned AES-256-GCM envelope produced by
-- the gateway (see server/src/crypto.js). The plaintext key NEVER reaches
-- this table, the logs, or any API response.
create table if not exists public.user_provider_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  provider          text not null,
  label             text,
  -- last 4 characters only, for "sk-or-…f3a9" style display
  masked_hint       text,
  secret_ciphertext text not null,
  key_version       text not null default 'v1',
  status            text not null default 'unverified'
                      check (status in ('unverified', 'connected', 'invalid')),
  last_checked_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider, label)
);

create index if not exists provider_credentials_user_idx
  on public.user_provider_credentials (user_id, provider);

drop trigger if exists provider_credentials_updated_at on public.user_provider_credentials;
create trigger provider_credentials_updated_at before update on public.user_provider_credentials
  for each row execute function public.set_updated_at();

-- ── usage events ───────────────────────────────────────────────────────
-- Analytics only: no prompts, no responses, no keys.
create table if not exists public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text,
  model      text,
  request_id text,
  task       text,
  tokens_in  integer,
  tokens_out integer,
  latency_ms integer,
  status     text not null default 'ok' check (status in ('ok', 'error', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc, id desc);

-- ── agent tasks (long-running work, shared by web + Android) ───────────
create table if not exists public.agent_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  type         text not null,
  objective    text not null default '',
  status       text not null default 'queued'
                 check (status in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  progress     integer not null default 0 check (progress between 0 and 100),
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists agent_tasks_user_status_idx
  on public.agent_tasks (user_id, status, created_at desc);

drop trigger if exists agent_tasks_updated_at on public.agent_tasks;
create trigger agent_tasks_updated_at before update on public.agent_tasks
  for each row execute function public.set_updated_at();

-- ── tool events (audit trail of tool/skill execution) ──────────────────
create table if not exists public.tool_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  task_id         uuid references public.agent_tasks(id) on delete set null,
  tool            text not null,
  state           text not null default 'done' check (state in ('running', 'done', 'error')),
  detail          text,
  created_at      timestamptz not null default now()
);

create index if not exists tool_events_user_created_idx
  on public.tool_events (user_id, created_at desc);

-- ── attachments (metadata only; bytes live in Storage) ─────────────────
create table if not exists public.attachments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete set null,
  bucket          text not null default 'attachments',
  storage_path    text not null,
  filename        text not null,
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null default 0 check (size_bytes >= 0),
  status          text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  created_at      timestamptz not null default now()
);

create index if not exists attachments_user_created_idx
  on public.attachments (user_id, created_at desc);
create index if not exists attachments_conversation_idx
  on public.attachments (conversation_id);
-- a path can only ever be claimed once, by one user
create unique index if not exists attachments_path_unique on public.attachments (storage_path);


-- ──────────────────────────────────────────────────────────────────────────
-- ── 0002_rls_and_grants.sql
-- ──────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════
-- 0002 — Row Level Security + explicit grants
--
-- RLS is mandatory here. The gateway prefers talking to Postgres *as the
-- user* (their JWT), so these policies are the real access control — not a
-- second line of defence behind application checks.
--
-- Model, for every user-data table:
--   select / insert / update / delete are allowed only for rows where
--   user_id = auth.uid(). There is no "shared" or "public" row anywhere.
--
-- Grants are separate from policies (per Supabase's current guidance):
--   * `anon` gets NOTHING on user data
--   * `authenticated` gets DML, then RLS filters it to their own rows
--   * `service_role` bypasses RLS but only ever runs server-side
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles                  enable row level security;
alter table public.conversations             enable row level security;
alter table public.messages                  enable row level security;
alter table public.memories                  enable row level security;
alter table public.user_provider_settings    enable row level security;
alter table public.user_provider_credentials enable row level security;
alter table public.usage_events              enable row level security;
alter table public.agent_tasks               enable row level security;
alter table public.tool_events               enable row level security;
alter table public.attachments               enable row level security;

-- Force RLS for table owners too: a stray `postgres`-role query in a
-- migration must not quietly read other people's rows.
alter table public.profiles                  force row level security;
alter table public.conversations             force row level security;
alter table public.messages                  force row level security;
alter table public.memories                  force row level security;
alter table public.user_provider_settings    force row level security;
alter table public.user_provider_credentials force row level security;
alter table public.usage_events              force row level security;
alter table public.agent_tasks               force row level security;
alter table public.tool_events               force row level security;
alter table public.attachments               force row level security;

-- ── grants: explicit, minimal ──────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles                  to authenticated;
grant select, insert, update, delete on public.conversations             to authenticated;
grant select, insert, update, delete on public.messages                  to authenticated;
grant select, insert, update, delete on public.memories                  to authenticated;
grant select, insert, update, delete on public.user_provider_settings    to authenticated;
grant select, insert, update, delete on public.user_provider_credentials to authenticated;
grant select, insert, update, delete on public.agent_tasks               to authenticated;
grant select, insert, update, delete on public.tool_events               to authenticated;
grant select, insert, update, delete on public.attachments               to authenticated;
-- usage is append-only from the client's perspective: insert + read, no
-- update/delete, so an analytics trail cannot be silently rewritten
grant select, insert on public.usage_events to authenticated;

-- ── profiles ───────────────────────────────────────────────────────────
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- no delete policy: account deletion goes through the admin API (cascade)

-- ── conversations ──────────────────────────────────────────────────────
drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists conversations_delete_own on public.conversations;
create policy conversations_delete_own on public.conversations
  for delete to authenticated using (user_id = auth.uid());

-- ── messages ───────────────────────────────────────────────────────────
-- A message must belong to the caller AND to a conversation the caller
-- owns. Without the second half, a user could inject messages into someone
-- else's thread by guessing its id.
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated using (user_id = auth.uid());

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete to authenticated using (user_id = auth.uid());

-- ── memories ───────────────────────────────────────────────────────────
drop policy if exists memories_select_own on public.memories;
create policy memories_select_own on public.memories
  for select to authenticated using (user_id = auth.uid());

drop policy if exists memories_insert_own on public.memories;
create policy memories_insert_own on public.memories
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists memories_update_own on public.memories;
create policy memories_update_own on public.memories
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists memories_delete_own on public.memories;
create policy memories_delete_own on public.memories
  for delete to authenticated using (user_id = auth.uid());

-- ── provider settings ──────────────────────────────────────────────────
drop policy if exists provider_settings_select_own on public.user_provider_settings;
create policy provider_settings_select_own on public.user_provider_settings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists provider_settings_insert_own on public.user_provider_settings;
create policy provider_settings_insert_own on public.user_provider_settings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists provider_settings_update_own on public.user_provider_settings;
create policy provider_settings_update_own on public.user_provider_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists provider_settings_delete_own on public.user_provider_settings;
create policy provider_settings_delete_own on public.user_provider_settings
  for delete to authenticated using (user_id = auth.uid());

-- ── provider credentials ───────────────────────────────────────────────
-- The ciphertext column is readable only by its owner; the API additionally
-- never selects it. A second account sees zero rows.
drop policy if exists provider_credentials_select_own on public.user_provider_credentials;
create policy provider_credentials_select_own on public.user_provider_credentials
  for select to authenticated using (user_id = auth.uid());

drop policy if exists provider_credentials_insert_own on public.user_provider_credentials;
create policy provider_credentials_insert_own on public.user_provider_credentials
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists provider_credentials_update_own on public.user_provider_credentials;
create policy provider_credentials_update_own on public.user_provider_credentials
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists provider_credentials_delete_own on public.user_provider_credentials;
create policy provider_credentials_delete_own on public.user_provider_credentials
  for delete to authenticated using (user_id = auth.uid());

-- ── usage events ───────────────────────────────────────────────────────
drop policy if exists usage_select_own on public.usage_events;
create policy usage_select_own on public.usage_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists usage_insert_own on public.usage_events;
create policy usage_insert_own on public.usage_events
  for insert to authenticated with check (user_id = auth.uid());

-- ── agent tasks ────────────────────────────────────────────────────────
drop policy if exists agent_tasks_select_own on public.agent_tasks;
create policy agent_tasks_select_own on public.agent_tasks
  for select to authenticated using (user_id = auth.uid());

drop policy if exists agent_tasks_insert_own on public.agent_tasks;
create policy agent_tasks_insert_own on public.agent_tasks
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists agent_tasks_update_own on public.agent_tasks;
create policy agent_tasks_update_own on public.agent_tasks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists agent_tasks_delete_own on public.agent_tasks;
create policy agent_tasks_delete_own on public.agent_tasks
  for delete to authenticated using (user_id = auth.uid());

-- ── tool events ────────────────────────────────────────────────────────
drop policy if exists tool_events_select_own on public.tool_events;
create policy tool_events_select_own on public.tool_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists tool_events_insert_own on public.tool_events;
create policy tool_events_insert_own on public.tool_events
  for insert to authenticated with check (user_id = auth.uid());

-- ── attachments ────────────────────────────────────────────────────────
drop policy if exists attachments_select_own on public.attachments;
create policy attachments_select_own on public.attachments
  for select to authenticated using (user_id = auth.uid());

drop policy if exists attachments_insert_own on public.attachments;
create policy attachments_insert_own on public.attachments
  for insert to authenticated with check (
    user_id = auth.uid()
    -- the storage path must be namespaced under the caller's own id:
    -- attachments/{user_id}/{file_id}/{filename}
    and storage_path like ('attachments/' || auth.uid()::text || '/%')
  );

drop policy if exists attachments_update_own on public.attachments;
create policy attachments_update_own on public.attachments
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists attachments_delete_own on public.attachments;
create policy attachments_delete_own on public.attachments
  for delete to authenticated using (user_id = auth.uid());


-- ──────────────────────────────────────────────────────────────────────────
-- ── 0003_storage.sql
-- ──────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════
-- 0003 — Storage buckets + object policies
--
-- All three buckets are PRIVATE. Nothing here is served from a public URL:
-- clients receive short-lived signed URLs minted by the gateway after it
-- has checked ownership in Postgres.
--
-- Path convention (enforced by policy, not by convention alone):
--     {bucket}/{user_id}/{file_id}/{filename}
-- e.g. attachments/6f1c…-…/b2a9…-…/invoice.pdf
--
-- `public.attachments.storage_path` stores exactly that full path, so the
-- database row and the object key can never drift apart.
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 52428800, null),   -- 50 MB
  ('generated',   'generated',   false, 52428800, null),
  ('avatars',     'avatars',     false, 5242880,          -- 5 MB
     array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects is on by default in a hosted project, but the
-- migration states it explicitly: a policy set that is only enforced because
-- of platform defaults is one dashboard toggle away from not being enforced.
alter table storage.objects enable row level security;
alter table storage.objects force row level security;

-- ── object policies ────────────────────────────────────────────────────
-- (storage.foldername(name))[1] is the first path segment = the owner's uuid.
-- A user can therefore never read, overwrite or delete another user's object,
-- even with a guessed path.

drop policy if exists metaloid_storage_read_own on storage.objects;
create policy metaloid_storage_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists metaloid_storage_insert_own on storage.objects;
create policy metaloid_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists metaloid_storage_update_own on storage.objects;
create policy metaloid_storage_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists metaloid_storage_delete_own on storage.objects;
create policy metaloid_storage_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No policy grants `anon` anything on storage.objects, so an unauthenticated
-- caller sees an empty bucket list regardless of what it guesses.


-- ──────────────────────────────────────────────────────────────────────────
-- ── 001_credential_audit.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 001: credential audit trail (mirrors file-mode credential_audit.json).
-- STATUS: applied 2026-10-03 via pooler.
create table if not exists credential_audit (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  provider_id text,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists credential_audit_user_idx on credential_audit (user_id, created_at desc);
alter table credential_audit enable row level security;
drop policy if exists owner_all on credential_audit;
create policy owner_all on credential_audit for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);


-- ──────────────────────────────────────────────────────────────────────────
-- ── 002_text_user_ids.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 002: user_id widening — OPT-IN, for deployments that mix local `usr-…` ids
-- with Supabase `sb:<uuid>` ids in the same tables.
--
-- Production MetaIoid is Supabase-auth shaped: user_id is uuid, it references
-- auth.users(id) on delete cascade, and RLS compares auth.uid() = user_id.
-- That is the shape the security suite asserts (cascade delete, cross-user
-- isolation), so this migration changes nothing unless it is asked to:
--
--   set metaloid.widen_user_ids = 'on';   -- mixed local-id deployment only
--
-- With the flag on it drops the auth.users FKs, widens every user_id/owner_id
-- column to text and rebuilds one owner-only policy per such table. Local users
-- do not exist in auth.users, so cascade is replaced by application-level
-- ownership checks (documented in DEPLOY.md); RLS stays as the second layer.
--
-- STATUS: not required for the Supabase-shaped production schema, where it is a
-- no-op. It has NOT been applied to any remote project from this checkout, so
-- confirm the target project's schema (user_id type, auth.users FKs) before
-- running it; the widening branch exists only for a mixed-id deployment.

do $$
declare p record;
declare r record;
begin
  if coalesce(current_setting('metaloid.widen_user_ids', true), 'off') <> 'on' then
    raise notice '002_text_user_ids: skipped (production schema keeps uuid ids + auth.users cascades). Set metaloid.widen_user_ids = on only for a mixed local-id deployment.';
    return;
  end if;

  -- every policy in public goes first: a column used in a policy definition
  -- cannot change type, and the policies are recreated below from one rule
  for p in (select tablename, policyname from pg_policies where schemaname = 'public') loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;

  -- drop FKs pointing at auth.users from OUR tables (never auth.* itself)
  begin
    for r in (
      select c.conname, (n.nspname || '.' || cl.relname) as tbl
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where c.confrelid = 'auth.users'::regclass and c.contype = 'f'
        and n.nspname = 'public'
    ) loop
      execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    end loop;
  exception when undefined_table then null;   -- bare Postgres without auth.users
  end;

  -- widen every existing user_id / owner_id column to text
  for r in (
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name in ('user_id', 'owner_id')
      and t.table_type = 'BASE TABLE'
      and c.data_type in ('uuid', 'character varying', 'character')
  ) loop
    begin
      execute format('alter table public.%I alter column %I type text', r.table_name, r.column_name);
    exception when others then
      raise notice 'widening %.% skipped: %', r.table_name, r.column_name, sqlerrm;
    end;
  end loop;

  -- a primary key declared on user_id keeps working as text; add one only where
  -- the table has a user_id column and no primary key at all
  for r in (
    select t.table_name
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'user_id'
      )
      and not exists (
        select 1 from pg_constraint pc
        join pg_class cl on cl.oid = pc.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and cl.relname = t.table_name and pc.contype = 'p'
      )
  ) loop
    begin
      execute format('alter table public.%I add primary key (user_id)', r.table_name);
    exception when others then null;
    end;
  end loop;

  -- RLS: compare as text so both id families work
  for r in (
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
  ) loop
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('drop policy if exists owner_all on public.%I', r.table_name);
    execute format(
      'create policy owner_all on public.%I for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id)',
      r.table_name
    );
  end loop;
end $$;


-- ──────────────────────────────────────────────────────────────────────────
-- ── 003_credential_rotation.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 003: credential rotation/test columns (mirror file-mode vault fields).
-- STATUS: applied 2026-10-03 via pooler.
alter table if exists user_provider_credentials add column if not exists last_rotated_at timestamptz;
alter table if exists user_provider_credentials add column if not exists rotation_count int not null default 0;
alter table if exists user_provider_credentials add column if not exists metadata jsonb not null default '{}';


-- ──────────────────────────────────────────────────────────────────────────
-- ── 004_remaining_domains.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 004: remaining domains (profiles/plans already exist).
-- File ids are TEXT (`msn-…`, `ent-…`, `skl-…`, `art-…`, `wsp-…`, `dev-…`);
-- PKs are text to preserve id shapes across modes. Full objects live in
-- `data jsonb` where the file shape is a graph (missions/skills); indexed
-- columns carry the fields queries filter on. Artifact BYTES go to Storage
-- (bucket `artifacts`), rows hold metadata only.
-- STATUS: pending apply.

-- missions (full task graph in data; status/objective indexed)
create table if not exists missions (
  id text primary key,
  user_id text not null,
  objective text not null default '',
  status text not null default 'QUEUED',
  skill_ids text[] not null default '{}',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists missions_user_status_idx on missions (user_id, status, updated_at desc);

-- world entities + relations
create table if not exists world_entities (
  id text primary key,
  user_id text not null,
  type text not null,
  name text not null,
  aliases text[] not null default '{}',
  sources text[] not null default '{}',
  confidence text not null default 'medium',
  first_seen timestamptz, last_verified timestamptz,
  timeline jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists world_entities_user_idx on world_entities (user_id, type);
create table if not exists world_relations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  from_id text not null, to_id text not null, rel text not null,
  source text not null default 'unknown', confidence text not null default 'medium',
  evidence text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists world_relations_user_idx on world_relations (user_id, from_id, to_id);

-- skill packages (full package in data; scope/context indexed)
create table if not exists skills (
  id text primary key,
  user_id text not null,
  scope text not null default 'user',
  workspace_id text, project_id text,
  source text not null default 'imported',
  status text not null default 'enabled',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz, use_count int not null default 0
);
create index if not exists skills_user_idx on skills (user_id, scope, status);

-- artifacts metadata (bytes in Storage bucket `artifacts`)
create table if not exists artifacts (
  id text primary key,
  user_id text not null,
  kind text not null,
  name text not null,
  project_id text, workspace_id text, task_id text, conversation_id text,
  status text not null default 'CREATED',
  version int not null default 1,
  verification jsonb, renders jsonb not null default '[]',
  timeline jsonb not null default '[]',
  versions jsonb not null default '[]',
  repairs int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists artifacts_user_idx on artifacts (user_id, updated_at desc);
create index if not exists artifacts_project_idx on artifacts (user_id, project_id) where project_id is not null;

-- workspaces + devices
create table if not exists workspaces (
  id text primary key,
  user_id text not null,
  name text not null,
  kind text not null default 'custom',
  instructions text not null default '',
  files jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_user_idx on workspaces (user_id);
create table if not exists devices (
  id text primary key,
  user_id text not null,
  name text not null,
  capabilities text[] not null default '{}',
  paired_at timestamptz, last_seen_at timestamptz,
  revoked boolean not null default false
);
create index if not exists devices_user_idx on devices (user_id) where revoked = false;

-- background jobs (shared queue for multi-instance correctness)
create table if not exists jobs (
  id text primary key,
  user_id text not null,
  kind text not null,
  label text not null default '',
  status text not null default 'queued',
  result jsonb, error text,
  created_at timestamptz not null default now(),
  started_at timestamptz, ended_at timestamptz
);
create index if not exists jobs_user_idx on jobs (user_id, created_at desc);
create index if not exists jobs_queue_idx on jobs (status, created_at) where status = 'queued';

-- rate counters (atomic incr; in-process maps stay for files mode)
create table if not exists rate_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

-- RLS (owner-only, text ids; service_role bypasses for gateway/admin)
alter table missions enable row level security;
alter table world_entities enable row level security;
alter table world_relations enable row level security;
alter table skills enable row level security;
alter table artifacts enable row level security;
alter table workspaces enable row level security;
alter table devices enable row level security;
alter table jobs enable row level security;
alter table rate_counters enable row level security;

drop policy if exists owner_all on missions;
drop policy if exists owner_all on world_entities;
drop policy if exists owner_all on world_relations;
drop policy if exists owner_all on skills;
drop policy if exists owner_all on artifacts;
drop policy if exists owner_all on workspaces;
drop policy if exists owner_all on devices;
drop policy if exists owner_all on jobs;
create policy owner_all on missions for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on world_entities for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on world_relations for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on skills for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on artifacts for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on workspaces for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on devices for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on jobs for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
-- rate_counters: gateway-owned via service_role only (no direct user policy)

-- Storage bucket for artifact bytes (PRIVATE, no public policies).
-- The gateway reads/writes with the service_role key (bypasses RLS) and
-- enforces per-user ownership in code before streaming bytes. Never add a
-- permissive storage policy here — that would expose every user's files.
insert into storage.buckets (id, name, public) values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- ── 005_pairing_codes.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 005: pairing codes table (10-minute interactive flow; must survive
-- multi-instance, so NOT in-memory).
-- STATUS: pending apply.
create table if not exists pairing_codes (
  code text not null,
  user_id text not null,
  device_name text not null default '',
  capabilities text[] not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);
create index if not exists pairing_codes_expiry_idx on pairing_codes (expires_at);
alter table pairing_codes enable row level security;
drop policy if exists owner_all on pairing_codes;
create policy owner_all on pairing_codes for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);


-- ──────────────────────────────────────────────────────────────────────────
-- ── 006_artifact_deleted.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 006: artifact tombstones (parity with file-mode `deleted` flag).
-- STATUS: pending apply.
alter table if exists artifacts add column if not exists deleted boolean not null default false;
create index if not exists artifacts_live_idx on artifacts (user_id, updated_at desc) where deleted = false;


-- ──────────────────────────────────────────────────────────────────────────
-- ── 007_gateway_columns.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 007: gateway columns — the SQL the gateway issues
-- (server/src/core/supadb.js: profiles, agent memories, credential tests)
-- names columns the 0001-era tables do not have, so in Supabase mode every
-- profile save, memory save, credential-test write and budget read fails
-- with 42703 "undefined column" (surfaced as "database error saving user",
-- and it also blocks /api/chat through the budget gate).
--
-- Additive only: every statement is ADD COLUMN IF NOT EXISTS with a safe
-- default, so a second run changes nothing and existing rows are untouched.
-- Table-level grants and row-level policies already cover whole tables, so no
-- grant or policy change is needed for new columns.
--
-- Apply it alone in the SQL editor, or re-paste the regenerated
-- supabase/bootstrap.sql (preferred: it also repairs any trigger, function
-- or policy an earlier partial apply missed).
-- STATUS: pending apply.

-- profiles: the gateway's profile shape (mirrors profiles.js DEFAULTS).
alter table public.profiles add column if not exists language text;
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists tone text;
alter table public.profiles add column if not exists verbosity text;
alter table public.profiles add column if not exists voice text;
alter table public.profiles add column if not exists voice_speed double precision not null default 1;
alter table public.profiles add column if not exists proactivity text;
alter table public.profiles add column if not exists autonomy text;
alter table public.profiles add column if not exists interests text[] not null default '{}';
alter table public.profiles add column if not exists goals text[] not null default '{}';
alter table public.profiles add column if not exists default_provider text;
alter table public.profiles add column if not exists fallback_providers text[] not null default '{}';
alter table public.profiles add column if not exists favorite_models text[] not null default '{}';
alter table public.profiles add column if not exists onboarding_done boolean not null default false;
alter table public.profiles add column if not exists onboarded_at timestamptz;
alter table public.profiles add column if not exists plan text not null default 'free';

-- memories (agent vault): scoping, confidence, soft-delete and verification
-- timestamps the agent-memory contract reads and writes. The account-level
-- memory model (category/kind/pinned) is untouched.
alter table public.memories add column if not exists class text not null default 'semantic';
alter table public.memories add column if not exists source text not null default 'user';
alter table public.memories add column if not exists confidence text not null default 'medium';
alter table public.memories add column if not exists scope text not null default 'personal';
alter table public.memories add column if not exists workspace_id text;
alter table public.memories add column if not exists project_id text;
alter table public.memories add column if not exists deleted_at timestamptz;
alter table public.memories add column if not exists last_verified_at timestamptz;
alter table public.memories add column if not exists last_used_at timestamptz;

-- credentials: test-write columns (rotation/audit columns already exist).
alter table public.user_provider_credentials add column if not exists last_tested_at timestamptz;
alter table public.user_provider_credentials add column if not exists last_test_status text;


-- ──────────────────────────────────────────────────────────────────────────
-- ── 008_signup_trigger_never_fails.sql
-- ──────────────────────────────────────────────────────────────────────────

-- 008: signup trigger that can never fail a signup.
--
-- Supabase Auth reports any failure inside on_auth_user_created as the opaque
-- "Database error saving new user", with the real cause hidden. A profile row
-- is bookkeeping: if its insert errors for any reason (a half-applied schema,
-- a future column change), the user row must still commit. The application
-- backfills a missing profile on first read (see server/src/data/pg.js
-- profiles.get and core/supadb.js profileUpsert), so swallowing here loses
-- nothing and can never lock a user out of signing up.
--
-- Re-runnable: create or replace + drop-if-exists. Touches only public
-- objects owned through the normal editor role — no storage tables involved.
-- STATUS: pending apply.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never veto identity creation over profile bookkeeping.
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

