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
