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
