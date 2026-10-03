-- METALOID Supabase schema (PostgreSQL). STATUS: NOT APPLIED — no Supabase
-- project is connected. Review + `supabase db push` after creating one.
-- Mirrors the current file-store shapes so migration is mechanical.
-- Conventions: UUID ids, owner user_id everywhere, created_at/updated_at,
-- soft delete (deleted_at) for user content, metadata JSONB, no blobs in rows.

create extension if not exists "pgcrypto";

-- profiles (1:1 with auth.users)
create table if not exists profiles (
  user_id text primary key,
  display_name text not null default '',
  language text not null default 'auto',
  timezone text not null default '',
  tone text not null default 'neutral',
  verbosity text not null default 'balanced',
  voice text not null default 'Natural English',
  autonomy text not null default 'assisted'
    check (autonomy in ('passive','assisted','proactive','autonomous')),
  theme text not null default 'obsidian',
  interests text[] not null default '{}',
  goals text[] not null default '{}',
  default_provider text,
  fallback_providers text[] not null default '{}',
  favorite_models text[] not null default '{}',
  onboarding_done boolean not null default false,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- conversations + messages (cursor pagination by created_at/id)
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null default 'New conversation',
  model text not null default 'auto',
  language text not null default 'auto',
  pinned boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_updated_idx
  on conversations (user_id, updated_at desc) where deleted_at is null;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  artifact_id uuid,
  error boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_created_idx
  on messages (conversation_id, created_at desc, id desc);

-- attachments (bytes live in Storage, rows hold references only)
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message_id uuid references messages(id) on delete set null,
  storage_path text not null,
  mime text not null,
  byte_size int not null check (byte_size >= 0),
  created_at timestamptz not null default now()
);
create index if not exists attachments_user_idx on attachments (user_id, created_at desc);

-- provider configs (status only; secrets live in Vault table below)
create table if not exists providers (
  provider_id text primary key,
  name text not null,
  category text not null,
  adapter_available boolean not null default false,
  docs_url text, key_url text
);
create table if not exists user_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  provider_id text not null references providers(provider_id),
  encrypted_secret text not null,
  masked_hint text not null default '',
  is_active boolean not null default true,
  last_tested_at timestamptz, last_test_status text,
  last_rotated_at timestamptz, rotation_count int not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id)
);
create table if not exists user_provider_settings (
  user_id text primary key,
  default_provider text, fallback_providers text[] not null default '{}',
  favorite_models text[] not null default '{}', default_model text not null default 'auto',
  updated_at timestamptz not null default now()
);
create table if not exists models (
  provider_id text not null references providers(provider_id),
  model_id text not null,
  display_name text not null,
  capabilities text[] not null default '{}',
  context_limit int, live boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (provider_id, model_id)
);

-- memories (selective retrieval: scope/confidence/recency, never full dump)
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  class text not null default 'semantic',
  content text not null,
  source text not null default 'user',
  confidence text not null default 'medium',
  scope text not null default 'personal',
  workspace_id text, project_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists memories_user_class_idx
  on memories (user_id, class, created_at desc) where deleted_at is null;

-- agent tasks (bounded: budgets enforced by API, mirrored here)
create table if not exists agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  objective text not null,
  status text not null default 'QUEUED',
  skill_ids text[] not null default '{}',
  max_steps int not null default 25, max_ms int not null default 120000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_tasks_user_status_idx
  on agent_tasks (user_id, status, updated_at desc);

create table if not exists tool_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references agent_tasks(id) on delete cascade,
  user_id text not null,
  tool text not null, ok boolean not null,
  ms int not null default 0, error text,
  created_at timestamptz not null default now()
);
create index if not exists tool_events_task_idx on tool_events (task_id, created_at);

-- usage events (metered actions; aggregates computed, never edited)
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  kind text not null,
  provider_id text, tokens int not null default 0, ms int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_kind_day_idx
  on usage_events (user_id, kind, created_at desc);

-- settings (namespaced key/values per user)
create table if not exists settings (
  user_id text not null,
  key text not null, value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ================= Row Level Security =================
-- Deny-by-default: every row access requires ownership. Service role
-- bypasses RLS for admin/cleanup jobs only; the API uses the user's JWT.

alter table profiles enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table attachments enable row level security;
alter table user_provider_credentials enable row level security;
alter table user_provider_settings enable row level security;
alter table memories enable row level security;
alter table agent_tasks enable row level security;
alter table tool_events enable row level security;
alter table usage_events enable row level security;
alter table settings enable row level security;

-- owner-only policies (service_role bypasses for jobs/maintenance)
create policy owner_all on profiles for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on conversations for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on messages for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on attachments for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on user_provider_credentials for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on user_provider_settings for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on memories for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on agent_tasks for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on tool_events for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on usage_events for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy owner_all on settings for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

-- public read-only catalog (no user data)
alter table providers enable row level security;
create policy catalog_read on providers for select using (true);
alter table models enable row level security;
create policy catalog_read on models for select using (true);
