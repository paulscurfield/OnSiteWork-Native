-- Harden Equipment photo storage writes and require a trusted path for photo_path changes.

update storage.buckets
set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'equipment-photos';

drop policy if exists "equipment photos company read" on storage.objects;
drop policy if exists "equipment photos company write" on storage.objects;
drop policy if exists "equipment photos admins insert" on storage.objects;
drop policy if exists "equipment photos admins delete" on storage.objects;
drop policy if exists "equipment photos admins update" on storage.objects;

create policy "equipment photos company read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'equipment-photos'
  and case
    when name ~* '^company/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
      then public.is_company_member(split_part(name, '/', 2)::uuid)
    else false
  end
);

create policy "equipment photos admins insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'equipment-photos'
  and case
    when name ~* '^company/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/equipment/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then public.is_company_admin(split_part(name, '/', 2)::uuid)
        and exists (
          select 1
          from public.equipment
          where id = split_part(name, '/', 4)::uuid
            and company_id = split_part(name, '/', 2)::uuid
        )
    else false
  end
);

create policy "equipment photos admins delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'equipment-photos'
  and case
    when name ~* '^company/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/equipment/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then public.is_company_admin(split_part(name, '/', 2)::uuid)
    else false
  end
);

create or replace function public.validate_equipment_photo_path_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.photo_path is not null then
      raise exception 'Equipment photo_path must be attached with set_equipment_photo_admin()';
    end if;

    return new;
  end if;

  if new.photo_path is not distinct from old.photo_path then
    return new;
  end if;

  if current_setting('onsite.equipment_photo_write_context', true) <> 'set_photo' then
    raise exception 'Equipment photo_path must be changed with set_equipment_photo_admin()';
  end if;

  if new.photo_path is not null then
    if left(
      new.photo_path,
      length('company/' || new.company_id::text || '/equipment/' || new.id::text || '/')
    ) <> 'company/' || new.company_id::text || '/equipment/' || new.id::text || '/'
      or length(new.photo_path) <= length('company/' || new.company_id::text || '/equipment/' || new.id::text || '/')
      or position('/' in substring(
        new.photo_path
        from length('company/' || new.company_id::text || '/equipment/' || new.id::text || '/') + 1
      )) > 0 then
      raise exception 'Equipment photo_path must match the equipment company and row identity';
    end if;

    if not exists (
      select 1
      from storage.objects
      where bucket_id = 'equipment-photos'
        and name = new.photo_path
    ) then
      raise exception 'Equipment photo object does not exist';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_equipment_photo_path_integrity() from public;
revoke all on function public.validate_equipment_photo_path_integrity() from anon;
revoke all on function public.validate_equipment_photo_path_integrity() from authenticated;

drop trigger if exists validate_equipment_photo_path_integrity on public.equipment;

create trigger validate_equipment_photo_path_integrity
before insert or update of photo_path on public.equipment
for each row
execute function public.validate_equipment_photo_path_integrity();

drop function if exists public.set_equipment_photo_admin(uuid, uuid, text);

create function public.set_equipment_photo_admin(
  p_company_id uuid,
  p_equipment_id uuid,
  p_photo_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_equipment public.equipment%rowtype;
  v_updated_equipment public.equipment%rowtype;
  v_previous_photo_path text;
  v_photo_path text := p_photo_path;
  v_expected_prefix text;
  v_file_name text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_equipment_id is null then
    raise exception 'equipment_id is required';
  end if;

  if not public.is_company_admin(p_company_id) then
    raise exception 'Not authorized to manage equipment photos for this company';
  end if;

  select *
  into v_equipment
  from public.equipment
  where id = p_equipment_id
  for update;

  if not found then
    raise exception 'Equipment not found';
  end if;

  if v_equipment.company_id <> p_company_id then
    raise exception 'Equipment does not belong to the supplied company';
  end if;

  v_previous_photo_path := v_equipment.photo_path;

  if v_photo_path is not null then
    v_photo_path := btrim(v_photo_path);

    if v_photo_path = '' then
      raise exception 'photo_path cannot be blank';
    end if;

    v_expected_prefix := 'company/' || v_equipment.company_id::text || '/equipment/' || v_equipment.id::text || '/';
    v_file_name := substring(v_photo_path from length(v_expected_prefix) + 1);

    if left(v_photo_path, length(v_expected_prefix)) <> v_expected_prefix
      or v_file_name = ''
      or position('/' in v_file_name) > 0 then
      raise exception 'photo_path must match the equipment company and row identity';
    end if;

    if not exists (
      select 1
      from storage.objects
      where bucket_id = 'equipment-photos'
        and name = v_photo_path
    ) then
      raise exception 'Equipment photo object does not exist';
    end if;
  end if;

  perform set_config('onsite.equipment_photo_write_context', 'set_photo', true);

  update public.equipment
  set photo_path = v_photo_path
  where id = v_equipment.id
  returning *
  into v_updated_equipment;

  perform set_config('onsite.equipment_photo_write_context', '', true);

  return jsonb_build_object(
    'equipment', to_jsonb(v_updated_equipment),
    'previous_photo_path', v_previous_photo_path
  );
end;
$$;

revoke all on function public.set_equipment_photo_admin(uuid, uuid, text) from public;
revoke all on function public.set_equipment_photo_admin(uuid, uuid, text) from anon;
revoke all on function public.set_equipment_photo_admin(uuid, uuid, text) from authenticated;
grant execute on function public.set_equipment_photo_admin(uuid, uuid, text) to authenticated;
