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
