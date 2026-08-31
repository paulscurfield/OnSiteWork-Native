-- Secure Profile update and avatar storage foundation.
-- This is a forward-only hardening migration; it does not rewrite existing
-- profile rows or move/delete existing avatar objects.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profiles update own" on public.profiles;
revoke update on public.profiles from public;
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;

create or replace function public.is_own_avatar_path(p_avatar_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_segments text[];
  v_filename text;
begin
  if v_actor_id is null then
    return false;
  end if;

  if p_avatar_path is null then
    return false;
  end if;

  if btrim(p_avatar_path) <> p_avatar_path or p_avatar_path <> lower(p_avatar_path) then
    return false;
  end if;

  if position('..' in p_avatar_path) > 0 then
    return false;
  end if;

  v_segments := string_to_array(p_avatar_path, '/');
  if array_length(v_segments, 1) <> 3 then
    return false;
  end if;

  if v_segments[1] <> 'user' or v_segments[2] <> v_actor_id::text then
    return false;
  end if;

  v_filename := v_segments[3];
  if v_filename is null or v_filename = '' then
    return false;
  end if;

  return v_filename ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$';
end;
$$;

create or replace function public.update_my_profile(
  p_full_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.profiles
  set
    full_name = nullif(btrim(p_full_name), ''),
    phone = nullif(btrim(p_phone), ''),
    updated_at = now()
  where id = v_actor_id
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('profile', to_jsonb(v_profile));
end;
$$;

create or replace function public.set_my_avatar_path(p_avatar_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_avatar_path is null or btrim(p_avatar_path) = '' then
    raise exception 'avatar_path is required' using errcode = '23502';
  end if;

  if not public.is_own_avatar_path(p_avatar_path) then
    raise exception 'Invalid avatar path' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'avatars'
      and object.name = p_avatar_path
  ) then
    raise exception 'Avatar object not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set
    avatar_path = p_avatar_path,
    updated_at = now()
  where id = v_actor_id
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('profile', to_jsonb(v_profile));
end;
$$;

drop policy if exists "avatars owner read" on storage.objects;
drop policy if exists "avatars owner write" on storage.objects;
drop policy if exists "avatars insert own canonical" on storage.objects;
drop policy if exists "avatars read own canonical" on storage.objects;
drop policy if exists "avatars delete own canonical" on storage.objects;

create policy "avatars insert own canonical"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and public.is_own_avatar_path(name)
);

create policy "avatars read own canonical"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.is_own_avatar_path(name)
);

create policy "avatars delete own canonical"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and public.is_own_avatar_path(name)
);

revoke all on function public.is_own_avatar_path(text) from public;
revoke all on function public.is_own_avatar_path(text) from anon;
revoke all on function public.is_own_avatar_path(text) from authenticated;
grant execute on function public.is_own_avatar_path(text) to authenticated;

revoke all on function public.update_my_profile(text, text) from public;
revoke all on function public.update_my_profile(text, text) from anon;
revoke all on function public.update_my_profile(text, text) from authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;

revoke all on function public.set_my_avatar_path(text) from public;
revoke all on function public.set_my_avatar_path(text) from anon;
revoke all on function public.set_my_avatar_path(text) from authenticated;
grant execute on function public.set_my_avatar_path(text) to authenticated;
