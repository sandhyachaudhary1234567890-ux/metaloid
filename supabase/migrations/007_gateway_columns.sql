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
