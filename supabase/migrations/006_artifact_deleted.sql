-- 006: artifact tombstones (parity with file-mode `deleted` flag).
-- STATUS: pending apply.
alter table if exists artifacts add column if not exists deleted boolean not null default false;
create index if not exists artifacts_live_idx on artifacts (user_id, updated_at desc) where deleted = false;
