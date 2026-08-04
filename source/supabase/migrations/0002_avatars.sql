-- ===========================================================================
-- Profile pictures for the Settings page.
--
-- Run once in the Supabase SQL editor, after 0001_omniroute_workspace.sql.
--
-- Files live at avatars/<user-id>/<filename>. The policies below key off the
-- FIRST PATH SEGMENT, so a user can only write inside a folder named after
-- their own uid — that is what stops one account overwriting another's picture.
-- ===========================================================================

-- Public read: an avatar is shown in the app chrome, and a public bucket means
-- an <img src> just works without minting signed URLs on every render. Nothing
-- private belongs in here. Writes are still restricted per-user below.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- storage.foldername(name) splits the object path; [1] is the top-level folder.
-- Comparing it to auth.uid() scopes every write to the caller's own folder.
drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar update own folder" on storage.objects;
create policy "avatar update own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read for this bucket only. Without an explicit select policy the
-- bucket's public flag alone is enough for the CDN path, but this keeps the
-- direct API consistent with it.
drop policy if exists "avatar public read" on storage.objects;
create policy "avatar public read"
  on storage.objects for select to public
  using (bucket_id = 'avatars');
