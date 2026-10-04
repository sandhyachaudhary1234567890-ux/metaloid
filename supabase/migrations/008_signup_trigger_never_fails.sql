-- 008: signup trigger that can never fail a signup.
--
-- Supabase Auth reports any failure inside on_auth_user_created as the opaque
-- "Database error saving new user", with the real cause hidden. A profile row
-- is bookkeeping: if its insert errors for any reason (a half-applied schema,
-- a future column change), the user row must still commit. The application
-- backfills a missing profile on first read (see server/src/data/pg.js
-- profiles.get and core/supadb.js profileUpsert), so swallowing here loses
-- nothing and can never lock a user out of signing up.
--
-- Re-runnable: create or replace + drop-if-exists. Touches only public
-- objects owned through the normal editor role — no storage tables involved.
-- STATUS: pending apply.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never veto identity creation over profile bookkeeping.
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
