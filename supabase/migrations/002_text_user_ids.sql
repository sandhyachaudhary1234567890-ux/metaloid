-- 002: user_id widening — OPT-IN, for deployments that mix local `usr-…` ids
-- with Supabase `sb:<uuid>` ids in the same tables.
--
-- Production MetaIoid is Supabase-auth shaped: user_id is uuid, it references
-- auth.users(id) on delete cascade, and RLS compares auth.uid() = user_id.
-- That is the shape the security suite asserts (cascade delete, cross-user
-- isolation), so this migration changes nothing unless it is asked to:
--
--   set metaloid.widen_user_ids = 'on';   -- mixed local-id deployment only
--
-- With the flag on it drops the auth.users FKs, widens every user_id/owner_id
-- column to text and rebuilds one owner-only policy per such table. Local users
-- do not exist in auth.users, so cascade is replaced by application-level
-- ownership checks (documented in DEPLOY.md); RLS stays as the second layer.
--
-- STATUS: not required for the Supabase-shaped production schema, where it is a
-- no-op. It has NOT been applied to any remote project from this checkout, so
-- confirm the target project's schema (user_id type, auth.users FKs) before
-- running it; the widening branch exists only for a mixed-id deployment.

do $$
declare p record;
declare r record;
begin
  if coalesce(current_setting('metaloid.widen_user_ids', true), 'off') <> 'on' then
    raise notice '002_text_user_ids: skipped (production schema keeps uuid ids + auth.users cascades). Set metaloid.widen_user_ids = on only for a mixed local-id deployment.';
    return;
  end if;

  -- every policy in public goes first: a column used in a policy definition
  -- cannot change type, and the policies are recreated below from one rule
  for p in (select tablename, policyname from pg_policies where schemaname = 'public') loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;

  -- drop FKs pointing at auth.users from OUR tables (never auth.* itself)
  begin
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
  exception when undefined_table then null;   -- bare Postgres without auth.users
  end;

  -- widen every existing user_id / owner_id column to text
  for r in (
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name in ('user_id', 'owner_id')
      and t.table_type = 'BASE TABLE'
      and c.data_type in ('uuid', 'character varying', 'character')
  ) loop
    begin
      execute format('alter table public.%I alter column %I type text', r.table_name, r.column_name);
    exception when others then
      raise notice 'widening %.% skipped: %', r.table_name, r.column_name, sqlerrm;
    end;
  end loop;

  -- a primary key declared on user_id keeps working as text; add one only where
  -- the table has a user_id column and no primary key at all
  for r in (
    select t.table_name
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'user_id'
      )
      and not exists (
        select 1 from pg_constraint pc
        join pg_class cl on cl.oid = pc.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and cl.relname = t.table_name and pc.contype = 'p'
      )
  ) loop
    begin
      execute format('alter table public.%I add primary key (user_id)', r.table_name);
    exception when others then null;
    end;
  end loop;

  -- RLS: compare as text so both id families work
  for r in (
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
  ) loop
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('drop policy if exists owner_all on public.%I', r.table_name);
    execute format(
      'create policy owner_all on public.%I for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id)',
      r.table_name
    );
  end loop;
end $$;
