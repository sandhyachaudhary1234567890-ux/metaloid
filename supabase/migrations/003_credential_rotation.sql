-- 003: credential rotation/test columns (mirror file-mode vault fields).
-- STATUS: applied 2026-10-03 via pooler.
alter table if exists user_provider_credentials add column if not exists last_rotated_at timestamptz;
alter table if exists user_provider_credentials add column if not exists rotation_count int not null default 0;
alter table if exists user_provider_credentials add column if not exists metadata jsonb not null default '{}';
