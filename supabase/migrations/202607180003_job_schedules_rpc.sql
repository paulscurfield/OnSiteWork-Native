-- Transactional RPC functions for calendar schedule writes.
-- These functions keep schedule rows and normalized assignment rows consistent.

drop function if exists public.create_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
);

drop function if exists public.create_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
);

drop function if exists public.update_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
);

drop function if exists public.update_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
);

create or replace function public.create_job_schedule_with_assignments(
  p_company_id uuid,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_job_id text,
  p_leave_request_id text,
  p_job_name text,
  p_job_number text,
  p_color text,
  p_notes text,
  p_source_type text,
  p_legacy_base44_id text,
  p_assigned_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_job_id uuid;
  v_leave_request_id uuid;
  v_assigned_user_ids uuid[];
  v_schedule public.job_schedules%rowtype;
  v_assignments jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.is_company_admin(p_company_id) then
    raise exception 'Only company owners and admins can create job schedules' using errcode = '42501';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Schedule start_date and end_date are required' using errcode = '23502';
  end if;

  if p_end_date < p_start_date then
    raise exception 'Schedule end_date cannot be before start_date' using errcode = '23514';
  end if;

  begin
    v_job_id := nullif(btrim(p_job_id), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'Invalid job_id UUID' using errcode = '22P02';
  end;

  begin
    v_leave_request_id := nullif(btrim(p_leave_request_id), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'Invalid leave_request_id UUID' using errcode = '22P02';
  end;

  if v_job_id is not null and not exists (
    select 1
    from public.jobs
    where id = v_job_id
      and company_id = p_company_id
  ) then
    raise exception 'Linked job does not belong to the company' using errcode = '23503';
  end if;

  if v_leave_request_id is not null and not exists (
    select 1
    from public.leave_requests
    where id = v_leave_request_id
      and company_id = p_company_id
  ) then
    raise exception 'Linked leave request does not belong to the company' using errcode = '23503';
  end if;

  select coalesce(array_agg(distinct assigned.user_id), '{}'::uuid[])
  into v_assigned_user_ids
  from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) as assigned(user_id)
  where assigned.user_id is not null;

  if exists (
    select 1
    from unnest(v_assigned_user_ids) as assigned(user_id)
    where not exists (
      select 1
      from public.company_members
      where company_id = p_company_id
        and user_id = assigned.user_id
    )
  ) then
    raise exception 'Assigned users must belong to the company' using errcode = '23503';
  end if;

  insert into public.job_schedules (
    company_id,
    job_id,
    leave_request_id,
    title,
    job_name,
    job_number,
    start_date,
    end_date,
    color,
    notes,
    source_type,
    legacy_base44_id,
    created_by
  )
  values (
    p_company_id,
    v_job_id,
    v_leave_request_id,
    p_title,
    p_job_name,
    p_job_number,
    p_start_date,
    p_end_date,
    coalesce(nullif(btrim(p_color), ''), '#10B981'),
    p_notes,
    coalesce(nullif(btrim(p_source_type), ''), 'manual'),
    p_legacy_base44_id,
    v_actor_id
  )
  returning * into v_schedule;

  insert into public.job_schedule_assignments (
    schedule_id,
    company_id,
    user_id,
    assigned_by
  )
  select
    v_schedule.id,
    v_schedule.company_id,
    assigned.user_id,
    v_actor_id
  from unnest(v_assigned_user_ids) as assigned(user_id);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
  into v_assignments
  from public.job_schedule_assignments as a
  where a.schedule_id = v_schedule.id;

  return jsonb_build_object(
    'schedule', to_jsonb(v_schedule),
    'assignments', v_assignments
  );
end;
$$;

create or replace function public.update_job_schedule_with_assignments(
  p_schedule_id uuid,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_job_id text,
  p_leave_request_id text,
  p_job_name text,
  p_job_number text,
  p_color text,
  p_notes text,
  p_source_type text,
  p_legacy_base44_id text,
  p_assigned_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_job_id uuid;
  v_leave_request_id uuid;
  v_assigned_user_ids uuid[];
  v_schedule public.job_schedules%rowtype;
  v_assignments jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select *
  into v_schedule
  from public.job_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Job schedule not found' using errcode = 'P0002';
  end if;

  if not public.is_company_admin(v_schedule.company_id) then
    raise exception 'Only company owners and admins can update job schedules' using errcode = '42501';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Schedule start_date and end_date are required' using errcode = '23502';
  end if;

  if p_end_date < p_start_date then
    raise exception 'Schedule end_date cannot be before start_date' using errcode = '23514';
  end if;

  begin
    v_job_id := nullif(btrim(p_job_id), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'Invalid job_id UUID' using errcode = '22P02';
  end;

  begin
    v_leave_request_id := nullif(btrim(p_leave_request_id), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'Invalid leave_request_id UUID' using errcode = '22P02';
  end;

  if v_job_id is not null and not exists (
    select 1
    from public.jobs
    where id = v_job_id
      and company_id = v_schedule.company_id
  ) then
    raise exception 'Linked job does not belong to the company' using errcode = '23503';
  end if;

  if v_leave_request_id is not null and not exists (
    select 1
    from public.leave_requests
    where id = v_leave_request_id
      and company_id = v_schedule.company_id
  ) then
    raise exception 'Linked leave request does not belong to the company' using errcode = '23503';
  end if;

  select coalesce(array_agg(distinct assigned.user_id), '{}'::uuid[])
  into v_assigned_user_ids
  from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) as assigned(user_id)
  where assigned.user_id is not null;

  if exists (
    select 1
    from unnest(v_assigned_user_ids) as assigned(user_id)
    where not exists (
      select 1
      from public.company_members
      where company_id = v_schedule.company_id
        and user_id = assigned.user_id
    )
  ) then
    raise exception 'Assigned users must belong to the company' using errcode = '23503';
  end if;

  update public.job_schedules
  set
    job_id = v_job_id,
    leave_request_id = v_leave_request_id,
    title = p_title,
    job_name = p_job_name,
    job_number = p_job_number,
    start_date = p_start_date,
    end_date = p_end_date,
    color = coalesce(nullif(btrim(p_color), ''), '#10B981'),
    notes = p_notes,
    source_type = coalesce(nullif(btrim(p_source_type), ''), 'manual'),
    legacy_base44_id = p_legacy_base44_id
  where id = v_schedule.id
  returning * into v_schedule;

  delete from public.job_schedule_assignments
  where schedule_id = v_schedule.id
    and company_id = v_schedule.company_id
    and not (user_id = any(v_assigned_user_ids));

  insert into public.job_schedule_assignments (
    schedule_id,
    company_id,
    user_id,
    assigned_by
  )
  select
    v_schedule.id,
    v_schedule.company_id,
    assigned.user_id,
    v_actor_id
  from unnest(v_assigned_user_ids) as assigned(user_id)
  where not exists (
    select 1
    from public.job_schedule_assignments
    where schedule_id = v_schedule.id
      and user_id = assigned.user_id
  );

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
  into v_assignments
  from public.job_schedule_assignments as a
  where a.schedule_id = v_schedule.id;

  return jsonb_build_object(
    'schedule', to_jsonb(v_schedule),
    'assignments', v_assignments
  );
end;
$$;

revoke all on function public.create_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) from public;

revoke all on function public.create_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) from anon;

revoke all on function public.create_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) from authenticated;

revoke all on function public.update_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) from public;

revoke all on function public.update_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) from anon;

revoke all on function public.update_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) from authenticated;

grant execute on function public.create_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) to authenticated;

grant execute on function public.update_job_schedule_with_assignments(
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid[]
) to authenticated;
