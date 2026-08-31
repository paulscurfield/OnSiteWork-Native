-- Harden PreStart tenant relationships and add the secure worker create RPC.
-- This does not read, copy, import, seed, backfill, or migrate Base44 data.

drop function if exists public.create_pre_start(uuid, uuid, uuid, date, jsonb, text, boolean);

create or replace function public.validate_pre_starts_company_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_equipment public.equipment%rowtype;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'pre_starts.company_id cannot be changed after creation'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if v_actor_id is null then
      raise exception 'Authentication required' using errcode = '28000';
    end if;

    if new.job_id is null then
      raise exception 'job_id is required for PreStart creation' using errcode = '23502';
    end if;

    select *
    into v_profile
    from public.profiles
    where id = v_actor_id;

    if not found then
      raise exception 'Authenticated profile was not found' using errcode = 'P0002';
    end if;

    new.worker_id := v_actor_id;
    new.worker_email := v_profile.email;
    new.worker_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email);
  else
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
        raise exception 'pre_starts.worker_id cannot be changed after creation'
          using errcode = '42501';
      end if;
    end if;

    new.worker_email := old.worker_email;
    new.worker_name := old.worker_name;
  end if;

  if new.worker_id is not null and not exists (
    select 1
    from public.company_members as member
    where member.company_id = new.company_id
      and member.user_id = new.worker_id
  ) then
    raise exception 'pre_starts.worker_id must belong to pre_starts.company_id'
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and new.job_id is not distinct from old.job_id then
    if new.job_id is not null and not exists (
      select 1
      from public.jobs as job
      where job.id = new.job_id
        and job.company_id = new.company_id
    ) then
      raise exception 'pre_starts.job_id must belong to pre_starts.company_id'
        using errcode = '23503';
    end if;

    new.job_name := old.job_name;
    new.job_number := old.job_number;
  elsif tg_op = 'UPDATE' and new.job_id is null then
    if old.job_id is not null and exists (
      select 1
      from public.jobs as job
      where job.id = old.job_id
    ) then
      raise exception 'pre_starts.job_id cannot be cleared while the referenced job exists'
        using errcode = '42501';
    end if;

    new.job_name := old.job_name;
    new.job_number := old.job_number;
  elsif new.job_id is not null then
    select *
    into v_job
    from public.jobs as job
    where job.id = new.job_id
      and job.company_id = new.company_id;

    if not found then
      raise exception 'pre_starts.job_id must belong to pre_starts.company_id'
        using errcode = '23503';
    end if;

    new.job_name := v_job.job_name;
    new.job_number := v_job.job_number;
  end if;

  if tg_op = 'UPDATE' and new.equipment_id is not distinct from old.equipment_id then
    if new.equipment_id is not null and not exists (
      select 1
      from public.equipment as equipment
      where equipment.id = new.equipment_id
        and equipment.company_id = new.company_id
    ) then
      raise exception 'pre_starts.equipment_id must belong to pre_starts.company_id'
        using errcode = '23503';
    end if;

    new.equipment_name := old.equipment_name;
  elsif tg_op = 'UPDATE' and new.equipment_id is null then
    if old.equipment_id is not null and exists (
      select 1
      from public.equipment as equipment
      where equipment.id = old.equipment_id
    ) then
      raise exception 'pre_starts.equipment_id cannot be cleared while the referenced equipment exists'
        using errcode = '42501';
    end if;

    new.equipment_name := old.equipment_name;
  elsif new.equipment_id is not null then
    select *
    into v_equipment
    from public.equipment as equipment
    where equipment.id = new.equipment_id
      and equipment.company_id = new.company_id;

    if not found then
      raise exception 'pre_starts.equipment_id must belong to pre_starts.company_id'
        using errcode = '23503';
    end if;

    new.equipment_name := v_equipment.name;
  end if;

  new.has_faults := coalesce(new.has_faults, false);
  new.status := case when new.has_faults then 'fault'::public.pre_start_status else 'pass'::public.pre_start_status end;

  return new;
end;
$$;

revoke all on function public.validate_pre_starts_company_integrity() from public;
revoke all on function public.validate_pre_starts_company_integrity() from anon;
revoke all on function public.validate_pre_starts_company_integrity() from authenticated;

drop trigger if exists validate_pre_starts_company_integrity on public.pre_starts;
create trigger validate_pre_starts_company_integrity
before insert or update on public.pre_starts
for each row
execute function public.validate_pre_starts_company_integrity();

create or replace function public.create_pre_start(
  p_company_id uuid,
  p_job_id uuid,
  p_equipment_id uuid,
  p_date date,
  p_answers jsonb,
  p_general_comments text default null,
  p_has_faults boolean default false
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
  v_equipment public.equipment%rowtype;
  v_pre_start public.pre_starts%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_date is null then
    raise exception 'date is required' using errcode = '23502';
  end if;

  if p_job_id is null then
    raise exception 'job_id is required for PreStart creation' using errcode = '23502';
  end if;

  if p_answers is null then
    raise exception 'answers is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can create PreStarts' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'Authenticated profile was not found' using errcode = 'P0002';
  end if;

  if p_job_id is not null then
    select *
    into v_job
    from public.jobs
    where id = p_job_id
      and company_id = p_company_id;

    if not found then
      raise exception 'job_id must belong to company_id' using errcode = '23503';
    end if;
  end if;

  if p_equipment_id is not null then
    select *
    into v_equipment
    from public.equipment
    where id = p_equipment_id
      and company_id = p_company_id;

    if not found then
      raise exception 'equipment_id must belong to company_id' using errcode = '23503';
    end if;
  end if;

  insert into public.pre_starts (
    company_id,
    equipment_id,
    equipment_name,
    worker_id,
    worker_email,
    worker_name,
    job_id,
    job_name,
    job_number,
    date,
    answers,
    general_comments,
    has_faults,
    status
  )
  values (
    p_company_id,
    p_equipment_id,
    case when p_equipment_id is null then null else v_equipment.name end,
    v_actor_id,
    v_profile.email,
    coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
    p_job_id,
    case when p_job_id is null then null else v_job.job_name end,
    case when p_job_id is null then null else v_job.job_number end,
    p_date,
    p_answers,
    nullif(btrim(p_general_comments), ''),
    coalesce(p_has_faults, false),
    case when coalesce(p_has_faults, false) then 'fault'::public.pre_start_status else 'pass'::public.pre_start_status end
  )
  returning * into v_pre_start;

  return jsonb_build_object('pre_start', to_jsonb(v_pre_start));
end;
$$;

revoke all on function public.create_pre_start(uuid, uuid, uuid, date, jsonb, text, boolean) from public;
revoke all on function public.create_pre_start(uuid, uuid, uuid, date, jsonb, text, boolean) from anon;
revoke all on function public.create_pre_start(uuid, uuid, uuid, date, jsonb, text, boolean) from authenticated;
grant execute on function public.create_pre_start(uuid, uuid, uuid, date, jsonb, text, boolean) to authenticated;
