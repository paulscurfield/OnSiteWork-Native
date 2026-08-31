-- Secure TimeEntry RPC layer.
-- These functions intentionally do not read, copy, import, seed, backfill, or migrate Base44 data.

drop function if exists public.get_my_active_time_entry(uuid);
drop function if exists public.clock_in_time_entry(uuid, uuid, date, timestamptz, numeric, numeric, text);
drop function if exists public.clock_out_time_entry(uuid, timestamptz, numeric);
drop function if exists public.create_manual_time_entry(uuid, uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text);
drop function if exists public.update_manual_time_entry(uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text);
drop function if exists public.delete_time_entry(uuid);

create unique index if not exists idx_time_entries_one_active_per_worker_company
on public.time_entries(company_id, worker_id)
where status = 'active' and worker_id is not null;

create or replace function public.get_my_active_time_entry(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_entry public.time_entries%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Time entries are only available to company members' using errcode = '42501';
  end if;

  select *
  into v_entry
  from public.time_entries
  where company_id = p_company_id
    and worker_id = v_actor_id
    and status = 'active'
  order by start_time desc, created_at desc, id desc
  limit 1;

  return jsonb_build_object('time_entry', to_jsonb(v_entry));
end;
$$;

create or replace function public.clock_in_time_entry(
  p_company_id uuid,
  p_job_id uuid,
  p_date date,
  p_start_time timestamptz,
  p_worker_lat numeric default null,
  p_worker_lng numeric default null,
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
  v_entry public.time_entries%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_job_id is null then
    raise exception 'job_id is required for clock-in' using errcode = '23502';
  end if;

  if p_date is null or p_start_time is null then
    raise exception 'date and start_time are required for clock-in' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can clock in' using errcode = '42501';
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

  if exists (
    select 1
    from public.time_entries
    where company_id = p_company_id
      and worker_id = v_actor_id
      and status = 'active'
  ) then
    raise exception 'Worker already has an active TimeEntry for this company' using errcode = '23505';
  end if;

  begin
    insert into public.time_entries (
      company_id,
      worker_id,
      worker_email,
      worker_name,
      job_id,
      job_name,
      job_number,
      date,
      start_time,
      finish_time,
      lunch_break_mins,
      total_hours,
      status,
      notes,
      worker_lat,
      worker_lng
    )
    values (
      p_company_id,
      v_actor_id,
      v_profile.email,
      coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
      v_job.id,
      v_job.job_name,
      v_job.job_number,
      p_date,
      p_start_time,
      null,
      0,
      null,
      'active',
      nullif(btrim(p_notes), ''),
      p_worker_lat,
      p_worker_lng
    )
    returning * into v_entry;
  exception
    when unique_violation then
      raise exception 'Worker already has an active TimeEntry for this company' using errcode = '23505';
  end;

  return jsonb_build_object('time_entry', to_jsonb(v_entry));
end;
$$;

create or replace function public.clock_out_time_entry(
  p_time_entry_id uuid,
  p_finish_time timestamptz,
  p_lunch_break_mins numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_entry public.time_entries%rowtype;
  v_elapsed_minutes numeric;
  v_total_hours numeric;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_time_entry_id is null then
    raise exception 'time_entry_id is required' using errcode = '23502';
  end if;

  if p_finish_time is null then
    raise exception 'finish_time is required' using errcode = '23502';
  end if;

  select *
  into v_entry
  from public.time_entries
  where id = p_time_entry_id
  for update;

  if not found then
    raise exception 'TimeEntry not found' using errcode = 'P0002';
  end if;

  if v_entry.worker_id is distinct from v_actor_id then
    raise exception 'Workers can only clock out their own active TimeEntry' using errcode = '42501';
  end if;

  if not public.is_company_member(v_entry.company_id) then
    raise exception 'Only current company members can clock out this TimeEntry' using errcode = '42501';
  end if;

  if v_entry.status <> 'active' then
    raise exception 'Only active TimeEntries can be clocked out' using errcode = '23514';
  end if;

  if coalesce(p_lunch_break_mins, 0) < 0 then
    raise exception 'lunch_break_mins cannot be negative' using errcode = '23514';
  end if;

  if p_finish_time < v_entry.start_time then
    raise exception 'finish_time cannot be before start_time' using errcode = '23514';
  end if;

  v_elapsed_minutes := extract(epoch from (p_finish_time - v_entry.start_time)) / 60;

  if coalesce(p_lunch_break_mins, 0) > v_elapsed_minutes then
    raise exception 'lunch_break_mins cannot exceed elapsed shift duration' using errcode = '23514';
  end if;

  v_total_hours := round(
    ((extract(epoch from (p_finish_time - v_entry.start_time)) / 3600) - (coalesce(p_lunch_break_mins, 0) / 60))::numeric,
    2
  );

  if v_total_hours < 0 then
    raise exception 'total_hours cannot be negative' using errcode = '23514';
  end if;

  update public.time_entries
  set
    finish_time = p_finish_time,
    lunch_break_mins = coalesce(p_lunch_break_mins, 0),
    total_hours = v_total_hours,
    status = 'completed',
    worker_lat = null,
    worker_lng = null
  where id = v_entry.id
  returning * into v_entry;

  return jsonb_build_object('time_entry', to_jsonb(v_entry));
end;
$$;

create or replace function public.create_manual_time_entry(
  p_company_id uuid,
  p_worker_id uuid,
  p_job_id uuid,
  p_date date,
  p_start_time timestamptz,
  p_finish_time timestamptz default null,
  p_lunch_break_mins numeric default 0,
  p_job_name text default null,
  p_job_number text default null,
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
  v_entry public.time_entries%rowtype;
  v_job_name text;
  v_job_number text;
  v_elapsed_minutes numeric;
  v_total_hours numeric := 0;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_worker_id is null then
    raise exception 'worker_id is required' using errcode = '23502';
  end if;

  if p_date is null or p_start_time is null then
    raise exception 'date and start_time are required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can create TimeEntries' using errcode = '42501';
  end if;

  if p_worker_id is distinct from v_actor_id and not public.is_company_admin(p_company_id) then
    raise exception 'Only company owners and admins can create TimeEntries for another worker' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.company_members
    where company_id = p_company_id
      and user_id = p_worker_id
  ) then
    raise exception 'worker_id must belong to company_id' using errcode = '23503';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_worker_id;

  if not found then
    raise exception 'Worker profile was not found' using errcode = 'P0002';
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

    v_job_name := v_job.job_name;
    v_job_number := v_job.job_number;
  else
    v_job_name := nullif(btrim(p_job_name), '');
    v_job_number := nullif(btrim(p_job_number), '');
  end if;

  if coalesce(p_lunch_break_mins, 0) < 0 then
    raise exception 'lunch_break_mins cannot be negative' using errcode = '23514';
  end if;

  if p_finish_time is not null then
    if p_finish_time < p_start_time then
      raise exception 'finish_time cannot be before start_time' using errcode = '23514';
    end if;

    v_elapsed_minutes := extract(epoch from (p_finish_time - p_start_time)) / 60;

    if coalesce(p_lunch_break_mins, 0) > v_elapsed_minutes then
      raise exception 'lunch_break_mins cannot exceed elapsed shift duration' using errcode = '23514';
    end if;

    v_total_hours := round(
      ((extract(epoch from (p_finish_time - p_start_time)) / 3600) - (coalesce(p_lunch_break_mins, 0) / 60))::numeric,
      2
    );

    if v_total_hours < 0 then
      raise exception 'total_hours cannot be negative' using errcode = '23514';
    end if;
  end if;

  insert into public.time_entries (
    company_id,
    worker_id,
    worker_email,
    worker_name,
    job_id,
    job_name,
    job_number,
    date,
    start_time,
    finish_time,
    lunch_break_mins,
    total_hours,
    status,
    notes,
    worker_lat,
    worker_lng
  )
  values (
    p_company_id,
    p_worker_id,
    v_profile.email,
    coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
    p_job_id,
    v_job_name,
    v_job_number,
    p_date,
    p_start_time,
    p_finish_time,
    coalesce(p_lunch_break_mins, 0),
    v_total_hours,
    'manual',
    nullif(btrim(p_notes), ''),
    null,
    null
  )
  returning * into v_entry;

  return jsonb_build_object('time_entry', to_jsonb(v_entry));
end;
$$;

create or replace function public.update_manual_time_entry(
  p_time_entry_id uuid,
  p_job_id uuid,
  p_date date,
  p_start_time timestamptz,
  p_finish_time timestamptz default null,
  p_lunch_break_mins numeric default 0,
  p_job_name text default null,
  p_job_number text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_entry public.time_entries%rowtype;
  v_job public.jobs%rowtype;
  v_job_name text;
  v_job_number text;
  v_elapsed_minutes numeric;
  v_total_hours numeric := 0;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_time_entry_id is null then
    raise exception 'time_entry_id is required' using errcode = '23502';
  end if;

  if p_date is null or p_start_time is null then
    raise exception 'date and start_time are required' using errcode = '23502';
  end if;

  select *
  into v_entry
  from public.time_entries
  where id = p_time_entry_id
  for update;

  if not found then
    raise exception 'TimeEntry not found' using errcode = 'P0002';
  end if;

  if v_entry.worker_id is distinct from v_actor_id then
    if not public.is_company_admin(v_entry.company_id) then
      raise exception 'Only the worker or a company admin can update this TimeEntry' using errcode = '42501';
    end if;
  elsif not public.is_company_member(v_entry.company_id) then
    raise exception 'Only current company members can update this TimeEntry' using errcode = '42501';
  end if;

  if v_entry.status = 'active' then
    raise exception 'Active TimeEntries must be clocked out before manual editing' using errcode = '23514';
  end if;

  if p_job_id is not null then
    select *
    into v_job
    from public.jobs
    where id = p_job_id
      and company_id = v_entry.company_id;

    if not found then
      raise exception 'job_id must belong to the TimeEntry company' using errcode = '23503';
    end if;

    v_job_name := v_job.job_name;
    v_job_number := v_job.job_number;
  else
    v_job_name := nullif(btrim(p_job_name), '');
    v_job_number := nullif(btrim(p_job_number), '');
  end if;

  if coalesce(p_lunch_break_mins, 0) < 0 then
    raise exception 'lunch_break_mins cannot be negative' using errcode = '23514';
  end if;

  if p_finish_time is not null then
    if p_finish_time < p_start_time then
      raise exception 'finish_time cannot be before start_time' using errcode = '23514';
    end if;

    v_elapsed_minutes := extract(epoch from (p_finish_time - p_start_time)) / 60;

    if coalesce(p_lunch_break_mins, 0) > v_elapsed_minutes then
      raise exception 'lunch_break_mins cannot exceed elapsed shift duration' using errcode = '23514';
    end if;

    v_total_hours := round(
      ((extract(epoch from (p_finish_time - p_start_time)) / 3600) - (coalesce(p_lunch_break_mins, 0) / 60))::numeric,
      2
    );

    if v_total_hours < 0 then
      raise exception 'total_hours cannot be negative' using errcode = '23514';
    end if;
  end if;

  update public.time_entries
  set
    job_id = p_job_id,
    job_name = v_job_name,
    job_number = v_job_number,
    date = p_date,
    start_time = p_start_time,
    finish_time = p_finish_time,
    lunch_break_mins = coalesce(p_lunch_break_mins, 0),
    total_hours = v_total_hours,
    notes = nullif(btrim(p_notes), '')
  where id = v_entry.id
  returning * into v_entry;

  return jsonb_build_object('time_entry', to_jsonb(v_entry));
end;
$$;

create or replace function public.delete_time_entry(p_time_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_entry public.time_entries%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_time_entry_id is null then
    raise exception 'time_entry_id is required' using errcode = '23502';
  end if;

  select *
  into v_entry
  from public.time_entries
  where id = p_time_entry_id
  for update;

  if not found then
    raise exception 'TimeEntry not found' using errcode = 'P0002';
  end if;

  if public.is_company_admin(v_entry.company_id) then
    delete from public.time_entries
    where id = v_entry.id;

    return jsonb_build_object('deleted', true, 'id', v_entry.id);
  end if;

  if v_entry.worker_id is distinct from v_actor_id then
    raise exception 'Only the worker or a company admin can delete this TimeEntry' using errcode = '42501';
  end if;

  if not public.is_company_member(v_entry.company_id) then
    raise exception 'Only current company members can delete this TimeEntry' using errcode = '42501';
  end if;

  if v_entry.status = 'active' then
    raise exception 'Active TimeEntries cannot be deleted by workers' using errcode = '42501';
  end if;

  delete from public.time_entries
  where id = v_entry.id;

  return jsonb_build_object('deleted', true, 'id', v_entry.id);
end;
$$;

revoke all on function public.get_my_active_time_entry(uuid) from public;
revoke all on function public.get_my_active_time_entry(uuid) from anon;
revoke all on function public.get_my_active_time_entry(uuid) from authenticated;
grant execute on function public.get_my_active_time_entry(uuid) to authenticated;

revoke all on function public.clock_in_time_entry(uuid, uuid, date, timestamptz, numeric, numeric, text) from public;
revoke all on function public.clock_in_time_entry(uuid, uuid, date, timestamptz, numeric, numeric, text) from anon;
revoke all on function public.clock_in_time_entry(uuid, uuid, date, timestamptz, numeric, numeric, text) from authenticated;
grant execute on function public.clock_in_time_entry(uuid, uuid, date, timestamptz, numeric, numeric, text) to authenticated;

revoke all on function public.clock_out_time_entry(uuid, timestamptz, numeric) from public;
revoke all on function public.clock_out_time_entry(uuid, timestamptz, numeric) from anon;
revoke all on function public.clock_out_time_entry(uuid, timestamptz, numeric) from authenticated;
grant execute on function public.clock_out_time_entry(uuid, timestamptz, numeric) to authenticated;

revoke all on function public.create_manual_time_entry(uuid, uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) from public;
revoke all on function public.create_manual_time_entry(uuid, uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) from anon;
revoke all on function public.create_manual_time_entry(uuid, uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) from authenticated;
grant execute on function public.create_manual_time_entry(uuid, uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) to authenticated;

revoke all on function public.update_manual_time_entry(uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) from public;
revoke all on function public.update_manual_time_entry(uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) from anon;
revoke all on function public.update_manual_time_entry(uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) from authenticated;
grant execute on function public.update_manual_time_entry(uuid, uuid, date, timestamptz, timestamptz, numeric, text, text, text) to authenticated;

revoke all on function public.delete_time_entry(uuid) from public;
revoke all on function public.delete_time_entry(uuid) from anon;
revoke all on function public.delete_time_entry(uuid) from authenticated;
grant execute on function public.delete_time_entry(uuid) to authenticated;
