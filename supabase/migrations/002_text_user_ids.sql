-- 002: user_id as TEXT (local `usr-…` AND Supabase `sb:<uuid>` ids share
-- these tables). Drops FKs to auth.users (local users don't exist there).
-- Enforcement stays in app code (ownership checks per request, as before);
-- RLS remains as defense-in-depth for direct/anon access.
-- STATUS: applied 2026-10-03 via pooler.

-- STEP 0: drop policies FIRST (a column used in a policy cannot change type)
drop policy if exists owner_all on profiles;
drop policy if exists owner_all on conversations;
drop policy if exists owner_all on messages;
drop policy if exists owner_all on attachments;
drop policy if exists owner_all on user_provider_credentials;
drop policy if exists owner_all on user_provider_settings;
drop policy if exists owner_all on memories;
drop policy if exists owner_all on agent_tasks;
drop policy if exists owner_all on tool_events;
drop policy if exists owner_all on usage_events;
drop policy if exists owner_all on settings;
drop policy if exists owner_all on credential_audit;

-- drop FK constraints to auth.users on OUR tables only (never auth.* itself)
do $$ declare r record; begin
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
end $$;

-- widen user_id columns to text
alter table if exists profiles alter column user_id type text;
alter table if exists conversations alter column user_id type text;
alter table if exists messages alter column user_id type text;
alter table if exists attachments alter column user_id type text;
alter table if exists user_provider_credentials alter column user_id type text;
alter table if exists user_provider_settings alter column user_id type text;
alter table if exists memories alter column user_id type text;
alter table if exists agent_tasks alter column user_id type text;
alter table if exists tool_events alter column user_id type text;
alter table if exists usage_events alter column user_id type text;
alter table if exists settings alter column user_id type text;
alter table if exists credential_audit alter column user_id type text;
alter table if exists credential_audit alter column user_id type text;

-- profiles PK stays valid as text; re-add primary key where needed
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pkey') then
    alter table profiles add primary key (user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_provider_settings_pkey') then
    alter table user_provider_settings add primary key (user_id);
  end if;
exception when others then null;
end $$;

-- RLS: compare as text so both id families work (policies recreated)
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
create policy owner_all on credential_audit for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
