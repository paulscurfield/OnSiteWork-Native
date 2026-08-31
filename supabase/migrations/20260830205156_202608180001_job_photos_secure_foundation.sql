-- Harden Site Photo storage/table access and add secure worker/admin RPCs.
-- This does not read, copy, import, seed, backfill, or migrate Base44 data.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-photos', 'job-photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.parse_job_photo_path(p_object_name text)
returns table(company_id uuid, job_id uuid, worker_id uuid, file_name text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_parts text[];
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_file_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$';
begin
  v_parts := string_to_array(coalesce(p_object_name, ''), '/');

  if coalesce(array_length(v_parts, 1), 0) <> 7 then
    return;
  end if;

  if v_parts[1] <> 'company'
    or v_parts[3] <> 'jobs'
    or v_parts[5] <> 'workers'
  then
    return;
  end if;

  if v_parts[2] !~ v_uuid_pattern
    or v_parts[4] !~ v_uuid_pattern
    or v_parts[6] !~ v_uuid_pattern
    or v_parts[7] !~ v_file_pattern
  then
    return;
  end if;

  company_id := v_parts[2]::uuid;
  job_id := v_parts[4]::uuid;
  worker_id := v_parts[6]::uuid;
  file_name := v_parts[7];
  return next;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.job_photos as photo
    where not exists (
      select 1
      from public.parse_job_photo_path(photo.photo_path) as path
      where path.company_id = photo.company_id
        and path.job_id = photo.job_id
        and path.worker_id = photo.worker_id
    )
  ) then
    raise exception 'Existing job_photos rows contain non-canonical or mismatched photo_path values; manual review required before applying secure Site Photo policies';
  end if;

  if exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'job-photos'
      and not exists (
        select 1
        from public.parse_job_photo_path(object.name)
      )
  ) then
    raise exception 'Existing job-photos storage objects contain non-canonical paths; manual review required before applying secure Site Photo policies';
  end if;

  if exists (
    select 1
    from public.job_photos as photo
    group by photo.photo_path
    having count(*) > 1
  ) then
    raise exception 'Existing job_photos rows contain duplicate photo_path values; manual review required before applying unique Site Photo path ownership';
  end if;
end;
$$;

create unique index if not exists job_photos_photo_path_unique
on public.job_photos(photo_path);

create or replace function public.is_company_site_photo_viewer(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members as member
    where member.company_id = p_company_id
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin', 'supervisor')
  );
$$;

create or replace function public.can_insert_job_photo_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.parse_job_photo_path(p_object_name) as path
    join public.jobs as job
      on job.id = path.job_id
      and job.company_id = path.company_id
    where path.worker_id = auth.uid()
      and public.is_company_member(path.company_id)
  );
$$;

create or replace function public.can_read_job_photo_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.parse_job_photo_path(p_object_name) as path
    join public.job_photos as photo
      on photo.photo_path = p_object_name
      and photo.company_id = path.company_id
    where (
      photo.worker_id = auth.uid()
      and public.is_company_member(photo.company_id)
    )
    or public.is_company_site_photo_viewer(photo.company_id)
  );
$$;

create or replace function public.can_delete_job_photo_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.parse_job_photo_path(p_object_name) as path
    where public.is_company_admin(path.company_id)
  );
$$;

create or replace function public.validate_job_photo_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_path record;
  v_photo_path text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if new.company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if new.job_id is null then
    raise exception 'job_id is required for Site Photo creation' using errcode = '23502';
  end if;

  if new.date is null then
    raise exception 'date is required for Site Photo creation' using errcode = '23502';
  end if;

  v_photo_path := nullif(btrim(new.photo_path), '');
  if v_photo_path is null then
    raise exception 'photo_path is required for Site Photo creation' using errcode = '23502';
  end if;

  if not public.is_company_member(new.company_id) then
    raise exception 'Only company members can create Site Photos' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'Authenticated profile was not found' using errcode = 'P0002';
  end if;

  select *
  into v_job
  from public.jobs
  where id = new.job_id
    and company_id = new.company_id;

  if not found then
    raise exception 'job_id must belong to company_id' using errcode = '23503';
  end if;

  select *
  into v_path
  from public.parse_job_photo_path(v_photo_path);

  if not found then
    raise exception 'photo_path must be a canonical Site Photo path' using errcode = '23514';
  end if;

  if v_path.company_id <> new.company_id
    or v_path.job_id <> new.job_id
    or v_path.worker_id <> v_actor_id
  then
    raise exception 'photo_path must match the Site Photo company, job, and worker identity'
      using errcode = '23514';
  end if;

  new.worker_id := v_actor_id;
  new.worker_email := v_profile.email;
  new.worker_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email);
  new.job_id := v_job.id;
  new.job_name := v_job.job_name;
  new.job_number := v_job.job_number;
  new.photo_path := v_photo_path;
  new.notes := nullif(btrim(new.notes), '');

  return new;
end;
$$;

drop trigger if exists validate_job_photo_insert on public.job_photos;
create trigger validate_job_photo_insert
before insert on public.job_photos
for each row
execute function public.validate_job_photo_insert();

create or replace function public.create_job_photo(
  p_company_id uuid,
  p_job_id uuid,
  p_photo_path text,
  p_date date,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_path record;
  v_photo_path text;
  v_job_photo public.job_photos%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_job_id is null then
    raise exception 'job_id is required' using errcode = '23502';
  end if;

  if p_date is null then
    raise exception 'date is required' using errcode = '23502';
  end if;

  v_photo_path := nullif(btrim(p_photo_path), '');
  if v_photo_path is null then
    raise exception 'photo_path is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can create Site Photos' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'Authenticated profile was not found' using errcode = 'P0002';
  end if;

  select *
  into v_job
  from public.jobs
  where id = p_job_id
    and company_id = p_company_id;

  if not found then
    raise exception 'job_id must belong to company_id' using errcode = '23503';
  end if;

  select *
  into v_path
  from public.parse_job_photo_path(v_photo_path);

  if not found then
    raise exception 'photo_path must be a canonical Site Photo path' using errcode = '23514';
  end if;

  if v_path.company_id <> p_company_id
    or v_path.job_id <> p_job_id
    or v_path.worker_id <> v_actor_id
  then
    raise exception 'photo_path must match the Site Photo company, job, and worker identity'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'job-photos'
      and object.name = v_photo_path
  ) then
    raise exception 'Site Photo storage object was not found' using errcode = '23503';
  end if;

  insert into public.job_photos (
    company_id,
    worker_id,
    job_id,
    photo_path,
    date,
    notes
  )
  values (
    p_company_id,
    v_actor_id,
    v_job.id,
    v_photo_path,
    p_date,
    nullif(btrim(p_notes), '')
  )
  returning * into v_job_photo;

  return jsonb_build_object('job_photo', to_jsonb(v_job_photo));
end;
$$;

create or replace function public.delete_job_photo_admin(p_job_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_job_photo public.job_photos%rowtype;
  v_deleted public.job_photos%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_job_photo_id is null then
    raise exception 'job_photo_id is required' using errcode = '23502';
  end if;

  select *
  into v_job_photo
  from public.job_photos
  where id = p_job_photo_id;

  if not found or not public.is_company_admin(v_job_photo.company_id) then
    raise exception 'Site Photo not found or access denied' using errcode = '42501';
  end if;

  delete from public.job_photos
  where id = v_job_photo.id
  returning * into v_deleted;

  return jsonb_build_object(
    'deleted', true,
    'id', v_deleted.id,
    'company_id', v_deleted.company_id,
    'job_id', v_deleted.job_id,
    'photo_path', v_deleted.photo_path
  );
end;
$$;

drop policy if exists "job photos read company" on public.job_photos;
drop policy if exists "job photos create own" on public.job_photos;
drop policy if exists "job photos delete admins" on public.job_photos;
drop policy if exists "job photos read own or managers" on public.job_photos;

create policy "job photos read own or managers" on public.job_photos
for select
to authenticated
using (
  (
    worker_id = auth.uid()
    and public.is_company_member(company_id)
  )
  or public.is_company_site_photo_viewer(company_id)
);

drop policy if exists "job photos company read" on storage.objects;
drop policy if exists "job photos company write" on storage.objects;
drop policy if exists "job photos insert own canonical" on storage.objects;
drop policy if exists "job photos read own or managers" on storage.objects;
drop policy if exists "job photos delete admins" on storage.objects;

create policy "job photos insert own canonical" on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-photos'
  and public.can_insert_job_photo_object(name)
);

create policy "job photos read own or managers" on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-photos'
  and public.can_read_job_photo_object(name)
);

create policy "job photos delete admins" on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-photos'
  and public.can_delete_job_photo_object(name)
);

revoke all on function public.parse_job_photo_path(text) from public;
revoke all on function public.parse_job_photo_path(text) from anon;
revoke all on function public.parse_job_photo_path(text) from authenticated;

revoke all on function public.is_company_site_photo_viewer(uuid) from public;
revoke all on function public.is_company_site_photo_viewer(uuid) from anon;
revoke all on function public.is_company_site_photo_viewer(uuid) from authenticated;
grant execute on function public.is_company_site_photo_viewer(uuid) to authenticated;

revoke all on function public.can_insert_job_photo_object(text) from public;
revoke all on function public.can_insert_job_photo_object(text) from anon;
revoke all on function public.can_insert_job_photo_object(text) from authenticated;
grant execute on function public.can_insert_job_photo_object(text) to authenticated;

revoke all on function public.can_read_job_photo_object(text) from public;
revoke all on function public.can_read_job_photo_object(text) from anon;
revoke all on function public.can_read_job_photo_object(text) from authenticated;
grant execute on function public.can_read_job_photo_object(text) to authenticated;

revoke all on function public.can_delete_job_photo_object(text) from public;
revoke all on function public.can_delete_job_photo_object(text) from anon;
revoke all on function public.can_delete_job_photo_object(text) from authenticated;
grant execute on function public.can_delete_job_photo_object(text) to authenticated;

revoke all on function public.validate_job_photo_insert() from public;
revoke all on function public.validate_job_photo_insert() from anon;
revoke all on function public.validate_job_photo_insert() from authenticated;

revoke all on function public.create_job_photo(uuid, uuid, text, date, text) from public;
revoke all on function public.create_job_photo(uuid, uuid, text, date, text) from anon;
revoke all on function public.create_job_photo(uuid, uuid, text, date, text) from authenticated;
grant execute on function public.create_job_photo(uuid, uuid, text, date, text) to authenticated;

revoke all on function public.delete_job_photo_admin(uuid) from public;
revoke all on function public.delete_job_photo_admin(uuid) from anon;
revoke all on function public.delete_job_photo_admin(uuid) from authenticated;
grant execute on function public.delete_job_photo_admin(uuid) to authenticated;

revoke all on public.job_photos from anon;
revoke insert, update, delete on public.job_photos from authenticated;
grant select on public.job_photos to authenticated;
