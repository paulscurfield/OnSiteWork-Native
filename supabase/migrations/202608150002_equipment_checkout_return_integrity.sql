-- Harden Equipment checkout/log integrity and add atomic checkout/return RPCs.
-- This does not read, copy, import, seed, backfill, or migrate Base44 data.

drop function if exists public.checkout_equipment(uuid, uuid);
drop function if exists public.return_equipment(uuid, uuid);

create or replace function public.validate_equipment_company_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context text := current_setting('onsite.equipment_write_context', true);
  v_profile public.profiles%rowtype;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'equipment.company_id cannot be changed after creation'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'checked_out'::public.equipment_status then
      raise exception 'Equipment cannot be created already checked out'
        using errcode = '23514';
    end if;

    if new.status not in ('available'::public.equipment_status, 'maintenance'::public.equipment_status) then
      raise exception 'Invalid initial equipment status'
        using errcode = '23514';
    end if;

    if new.checked_out_by_id is not null
      or new.checked_out_by_email is not null
      or new.checked_out_by_name is not null
      or new.checked_out_at is not null then
      raise exception 'Checkout fields must be empty when Equipment is created'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status <> 'checked_out'::public.equipment_status
    and new.status = 'checked_out'::public.equipment_status then
    if coalesce(v_context, '') <> 'checkout' then
      raise exception 'Equipment checkout must use checkout_equipment()'
        using errcode = '42501';
    end if;

    if new.checked_out_by_id is null then
      raise exception 'checked_out_by_id is required for checked-out Equipment'
        using errcode = '23514';
    end if;

    select *
    into v_profile
    from public.profiles
    where id = new.checked_out_by_id;

    if not found then
      raise exception 'Checked-out worker profile was not found'
        using errcode = 'P0002';
    end if;

    if not exists (
      select 1
      from public.company_members as member
      where member.company_id = new.company_id
        and member.user_id = new.checked_out_by_id
    ) then
      raise exception 'checked_out_by_id must belong to equipment.company_id'
        using errcode = '23503';
    end if;

    if new.checked_out_at is null then
      raise exception 'checked_out_at is required for checked-out Equipment'
        using errcode = '23514';
    end if;

    new.checked_out_by_email := v_profile.email;
    new.checked_out_by_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email);

    return new;
  end if;

  if old.status = 'checked_out'::public.equipment_status
    and new.status <> 'checked_out'::public.equipment_status then
    if not (
      coalesce(v_context, '') = 'return'
      and new.status = 'available'::public.equipment_status
    ) then
      raise exception 'Checked-out Equipment must be returned with return_equipment()'
        using errcode = '42501';
    end if;

    new.checked_out_by_id := null;
    new.checked_out_by_email := null;
    new.checked_out_by_name := null;
    new.checked_out_at := null;

    return new;
  end if;

  if new.status = 'checked_out'::public.equipment_status then
    if new.checked_out_by_id is distinct from old.checked_out_by_id then
      if not (
        old.checked_out_by_id is not null
        and new.checked_out_by_id is null
        and not exists (
          select 1
          from public.profiles as profile
          where profile.id = old.checked_out_by_id
        )
      ) then
        raise exception 'checked_out_by_id cannot be changed outside checkout/return'
          using errcode = '42501';
      end if;
    end if;

    if new.checked_out_by_id is not null then
      select *
      into v_profile
      from public.profiles
      where id = new.checked_out_by_id;

      if not found then
        raise exception 'Checked-out worker profile was not found'
          using errcode = 'P0002';
      end if;

      if not exists (
        select 1
        from public.company_members as member
        where member.company_id = new.company_id
          and member.user_id = new.checked_out_by_id
      ) then
        raise exception 'checked_out_by_id must belong to equipment.company_id'
          using errcode = '23503';
      end if;
    end if;

    new.checked_out_by_email := old.checked_out_by_email;
    new.checked_out_by_name := old.checked_out_by_name;
    new.checked_out_at := old.checked_out_at;

    if new.checked_out_by_email is null or new.checked_out_at is null then
      raise exception 'Checked-out Equipment must preserve checkout snapshots'
        using errcode = '23514';
    end if;

    return new;
  end if;

  new.checked_out_by_id := null;
  new.checked_out_by_email := null;
  new.checked_out_by_name := null;
  new.checked_out_at := null;

  return new;
end;
$$;

revoke all on function public.validate_equipment_company_integrity() from public;
revoke all on function public.validate_equipment_company_integrity() from anon;
revoke all on function public.validate_equipment_company_integrity() from authenticated;

drop trigger if exists validate_equipment_company_integrity on public.equipment;
create trigger validate_equipment_company_integrity
before insert or update on public.equipment
for each row
execute function public.validate_equipment_company_integrity();

create or replace function public.validate_equipment_logs_company_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context text := current_setting('onsite.equipment_write_context', true);
  v_equipment public.equipment%rowtype;
  v_profile public.profiles%rowtype;
begin
  if tg_op = 'INSERT' then
    if coalesce(v_context, '') not in ('checkout', 'return') then
      raise exception 'Equipment logs must be created by checkout_equipment() or return_equipment()'
        using errcode = '42501';
    end if;

    if new.equipment_id is null then
      raise exception 'equipment_id is required for EquipmentLog creation'
        using errcode = '23502';
    end if;

    if new.worker_id is null then
      raise exception 'worker_id is required for EquipmentLog creation'
        using errcode = '23502';
    end if;

    select *
    into v_equipment
    from public.equipment
    where id = new.equipment_id
      and company_id = new.company_id;

    if not found then
      raise exception 'equipment_logs.equipment_id must belong to equipment_logs.company_id'
        using errcode = '23503';
    end if;

    select *
    into v_profile
    from public.profiles
    where id = new.worker_id;

    if not found then
      raise exception 'EquipmentLog worker profile was not found'
        using errcode = 'P0002';
    end if;

    if not exists (
      select 1
      from public.company_members as member
      where member.company_id = new.company_id
        and member.user_id = new.worker_id
    ) then
      raise exception 'equipment_logs.worker_id must belong to equipment_logs.company_id'
        using errcode = '23503';
    end if;

    new.equipment_name := v_equipment.name;
    new.worker_email := v_profile.email;
    new.worker_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email);
    new.timestamp := coalesce(new.timestamp, now());

    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'equipment_logs.company_id cannot be changed after creation'
      using errcode = '42501';
  end if;

  if new.action is distinct from old.action then
    raise exception 'equipment_logs.action cannot be changed after creation'
      using errcode = '42501';
  end if;

  if new."timestamp" is distinct from old."timestamp" then
    raise exception 'equipment_logs.timestamp cannot be changed after creation'
      using errcode = '42501';
  end if;

  if new.equipment_id is distinct from old.equipment_id then
    if not (
      old.equipment_id is not null
      and new.equipment_id is null
      and not exists (
        select 1
        from public.equipment as equipment
        where equipment.id = old.equipment_id
      )
    ) then
      raise exception 'equipment_logs.equipment_id cannot be changed after creation'
        using errcode = '42501';
    end if;
  elsif new.equipment_id is not null and not exists (
    select 1
    from public.equipment as equipment
    where equipment.id = new.equipment_id
      and equipment.company_id = new.company_id
  ) then
    raise exception 'equipment_logs.equipment_id must belong to equipment_logs.company_id'
      using errcode = '23503';
  end if;

  if new.worker_id is distinct from old.worker_id then
    if not (
      old.worker_id is not null
      and new.worker_id is null
      and not exists (
        select 1
        from public.profiles as profile
        where profile.id = old.worker_id
      )
    ) then
      raise exception 'equipment_logs.worker_id cannot be changed after creation'
        using errcode = '42501';
    end if;
  elsif new.worker_id is not null and not exists (
    select 1
    from public.company_members as member
    where member.company_id = new.company_id
      and member.user_id = new.worker_id
  ) then
    raise exception 'equipment_logs.worker_id must belong to equipment_logs.company_id'
      using errcode = '23503';
  end if;

  new.equipment_name := old.equipment_name;
  new.worker_email := old.worker_email;
  new.worker_name := old.worker_name;

  return new;
end;
$$;

revoke all on function public.validate_equipment_logs_company_integrity() from public;
revoke all on function public.validate_equipment_logs_company_integrity() from anon;
revoke all on function public.validate_equipment_logs_company_integrity() from authenticated;

drop trigger if exists validate_equipment_logs_company_integrity on public.equipment_logs;
create trigger validate_equipment_logs_company_integrity
before insert or update on public.equipment_logs
for each row
execute function public.validate_equipment_logs_company_integrity();

drop policy if exists "equipment checkout members" on public.equipment;
drop policy if exists "equipment update admins" on public.equipment;
create policy "equipment update admins" on public.equipment
for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists "equipment logs create members" on public.equipment_logs;

create or replace function public.checkout_equipment(
  p_company_id uuid,
  p_equipment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_equipment public.equipment%rowtype;
  v_log public.equipment_logs%rowtype;
  v_event_time timestamptz := now();
  v_worker_name text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_equipment_id is null then
    raise exception 'equipment_id is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can check out Equipment' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'Authenticated profile was not found' using errcode = 'P0002';
  end if;

  v_worker_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email);

  select *
  into v_equipment
  from public.equipment
  where id = p_equipment_id
  for update;

  if not found then
    raise exception 'Equipment not found' using errcode = 'P0002';
  end if;

  if v_equipment.company_id is distinct from p_company_id then
    raise exception 'equipment_id must belong to company_id' using errcode = '23503';
  end if;

  if v_equipment.status <> 'available'::public.equipment_status then
    raise exception 'Only available Equipment can be checked out' using errcode = '23514';
  end if;

  perform set_config('onsite.equipment_write_context', 'checkout', true);

  update public.equipment
  set
    status = 'checked_out'::public.equipment_status,
    checked_out_by_id = v_actor_id,
    checked_out_by_email = v_profile.email,
    checked_out_by_name = v_worker_name,
    checked_out_at = v_event_time
  where id = v_equipment.id
  returning * into v_equipment;

  insert into public.equipment_logs (
    company_id,
    equipment_id,
    equipment_name,
    worker_id,
    worker_email,
    worker_name,
    action,
    timestamp
  )
  values (
    p_company_id,
    v_equipment.id,
    v_equipment.name,
    v_actor_id,
    v_profile.email,
    v_worker_name,
    'checked_out'::public.equipment_log_action,
    v_event_time
  )
  returning * into v_log;

  perform set_config('onsite.equipment_write_context', '', true);

  return jsonb_build_object(
    'equipment', to_jsonb(v_equipment),
    'log', to_jsonb(v_log)
  );
end;
$$;

create or replace function public.return_equipment(
  p_company_id uuid,
  p_equipment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_equipment public.equipment%rowtype;
  v_log public.equipment_logs%rowtype;
  v_event_time timestamptz := now();
  v_worker_name text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_equipment_id is null then
    raise exception 'equipment_id is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can return Equipment' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'Authenticated profile was not found' using errcode = 'P0002';
  end if;

  v_worker_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email);

  select *
  into v_equipment
  from public.equipment
  where id = p_equipment_id
  for update;

  if not found then
    raise exception 'Equipment not found' using errcode = 'P0002';
  end if;

  if v_equipment.company_id is distinct from p_company_id then
    raise exception 'equipment_id must belong to company_id' using errcode = '23503';
  end if;

  if v_equipment.status <> 'checked_out'::public.equipment_status then
    raise exception 'Only checked-out Equipment can be returned' using errcode = '23514';
  end if;

  if v_equipment.checked_out_by_id is distinct from v_actor_id then
    raise exception 'Only the worker who checked out this Equipment can return it'
      using errcode = '42501';
  end if;

  perform set_config('onsite.equipment_write_context', 'return', true);

  insert into public.equipment_logs (
    company_id,
    equipment_id,
    equipment_name,
    worker_id,
    worker_email,
    worker_name,
    action,
    timestamp
  )
  values (
    p_company_id,
    v_equipment.id,
    v_equipment.name,
    v_actor_id,
    v_profile.email,
    v_worker_name,
    'returned'::public.equipment_log_action,
    v_event_time
  )
  returning * into v_log;

  update public.equipment
  set
    status = 'available'::public.equipment_status,
    checked_out_by_id = null,
    checked_out_by_email = null,
    checked_out_by_name = null,
    checked_out_at = null
  where id = v_equipment.id
  returning * into v_equipment;

  perform set_config('onsite.equipment_write_context', '', true);

  return jsonb_build_object(
    'equipment', to_jsonb(v_equipment),
    'log', to_jsonb(v_log)
  );
end;
$$;

revoke all on function public.checkout_equipment(uuid, uuid) from public;
revoke all on function public.checkout_equipment(uuid, uuid) from anon;
revoke all on function public.checkout_equipment(uuid, uuid) from authenticated;
grant execute on function public.checkout_equipment(uuid, uuid) to authenticated;

revoke all on function public.return_equipment(uuid, uuid) from public;
revoke all on function public.return_equipment(uuid, uuid) from anon;
revoke all on function public.return_equipment(uuid, uuid) from authenticated;
grant execute on function public.return_equipment(uuid, uuid) to authenticated;
