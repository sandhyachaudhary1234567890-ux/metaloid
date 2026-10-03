-- ═══════════════════════════════════════════════════════════════════════
-- 0003 — Storage buckets + object policies
--
-- All three buckets are PRIVATE. Nothing here is served from a public URL:
-- clients receive short-lived signed URLs minted by the gateway after it
-- has checked ownership in Postgres.
--
-- Path convention (enforced by policy, not by convention alone):
--     {bucket}/{user_id}/{file_id}/{filename}
-- e.g. attachments/6f1c…-…/b2a9…-…/invoice.pdf
--
-- `public.attachments.storage_path` stores exactly that full path, so the
-- database row and the object key can never drift apart.
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 52428800, null),   -- 50 MB
  ('generated',   'generated',   false, 52428800, null),
  ('avatars',     'avatars',     false, 5242880,          -- 5 MB
     array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects is on by default in a hosted project, but the
-- migration states it explicitly: a policy set that is only enforced because
-- of platform defaults is one dashboard toggle away from not being enforced.
alter table storage.objects enable row level security;
alter table storage.objects force row level security;

-- ── object policies ────────────────────────────────────────────────────
-- (storage.foldername(name))[1] is the first path segment = the owner's uuid.
-- A user can therefore never read, overwrite or delete another user's object,
-- even with a guessed path.

drop policy if exists metaloid_storage_read_own on storage.objects;
create policy metaloid_storage_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists metaloid_storage_insert_own on storage.objects;
create policy metaloid_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists metaloid_storage_update_own on storage.objects;
create policy metaloid_storage_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists metaloid_storage_delete_own on storage.objects;
create policy metaloid_storage_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('attachments', 'generated', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No policy grants `anon` anything on storage.objects, so an unauthenticated
-- caller sees an empty bucket list regardless of what it guesses.
