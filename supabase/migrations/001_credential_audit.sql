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
