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
