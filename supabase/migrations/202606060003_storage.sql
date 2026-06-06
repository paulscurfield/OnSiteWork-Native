-- Storage bucket setup and policies for OnSiteWork Native.
-- Buckets are private; application code should request signed URLs for display.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('job-photos', 'job-photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp']),
  ('equipment-photos', 'equipment-photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp']),
  ('exports', 'exports', false, 10485760, array['text/csv', 'application/pdf', 'application/json']),
  ('message-attachments', 'message-attachments', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_company_id(object_name text)
returns uuid
language sql
stable
as $$
  select nullif(split_part(object_name, '/', 2), '')::uuid
  where split_part(object_name, '/', 1) = 'company';
$$;

drop policy if exists "avatars owner read" on storage.objects;
create policy "avatars owner read" on storage.objects
for select using (bucket_id = 'avatars' and split_part(name, '/', 2) = auth.uid()::text);

drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write" on storage.objects
for insert with check (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = 'user'
  and split_part(name, '/', 2) = auth.uid()::text
);

drop policy if exists "job photos company read" on storage.objects;
create policy "job photos company read" on storage.objects
for select using (bucket_id = 'job-photos' and public.is_company_member(public.storage_company_id(name)));

drop policy if exists "job photos company write" on storage.objects;
create policy "job photos company write" on storage.objects
for insert with check (bucket_id = 'job-photos' and public.is_company_member(public.storage_company_id(name)));

drop policy if exists "equipment photos company read" on storage.objects;
create policy "equipment photos company read" on storage.objects
for select using (bucket_id = 'equipment-photos' and public.is_company_member(public.storage_company_id(name)));

drop policy if exists "equipment photos company write" on storage.objects;
create policy "equipment photos company write" on storage.objects
for insert with check (bucket_id = 'equipment-photos' and public.is_company_member(public.storage_company_id(name)));

drop policy if exists "exports admins read" on storage.objects;
create policy "exports admins read" on storage.objects
for select using (bucket_id = 'exports' and public.is_company_admin(public.storage_company_id(name)));

drop policy if exists "exports admins write" on storage.objects;
create policy "exports admins write" on storage.objects
for insert with check (bucket_id = 'exports' and public.is_company_admin(public.storage_company_id(name)));

drop policy if exists "message attachments company read" on storage.objects;
create policy "message attachments company read" on storage.objects
for select using (bucket_id = 'message-attachments' and public.is_company_member(public.storage_company_id(name)));

drop policy if exists "message attachments company write" on storage.objects;
create policy "message attachments company write" on storage.objects
for insert with check (bucket_id = 'message-attachments' and public.is_company_member(public.storage_company_id(name)));
