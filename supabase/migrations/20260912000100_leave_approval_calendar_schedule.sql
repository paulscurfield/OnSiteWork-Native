-- Create the calendar schedule entry atomically when approving LeaveRequests.
-- This does not read, copy, import, seed, backfill, or migrate Base44 data.

create or replace function public.delete_leave_calendar_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.job_schedules
  where company_id = old.company_id
    and leave_request_id = old.id
    and source_type = 'leave';

  return old;
end;
$$;

revoke all on function public.delete_leave_calendar_schedule() from public;
revoke all on function public.delete_leave_calendar_schedule() from anon;
revoke all on function public.delete_leave_calendar_schedule() from authenticated;

drop trigger if exists delete_leave_calendar_schedule_before_delete on public.leave_requests;
create trigger delete_leave_calendar_schedule_before_delete
before delete on public.leave_requests
for each row execute function public.delete_leave_calendar_schedule();

create or replace function public.review_leave_request_admin(
  p_company_id uuid,
  p_leave_request_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_leave_request public.leave_requests%rowtype;
  v_review_status public.leave_status;
  v_schedule public.job_schedules%rowtype;
  v_leave_color text;
  v_leave_label text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_leave_request_id is null then
    raise exception 'leave_request_id is required' using errcode = '23502';
  end if;

  if lower(btrim(coalesce(p_status, ''))) not in ('approved', 'declined') then
    raise exception 'review status must be approved or declined' using errcode = '22P02';
  end if;
  v_review_status := lower(btrim(p_status))::public.leave_status;

  if not public.is_company_admin(p_company_id) then
    raise exception 'Only company admins can review LeaveRequests' using errcode = '42501';
  end if;

  select *
  into v_leave_request
  from public.leave_requests
  where id = p_leave_request_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'LeaveRequest not found' using errcode = 'P0002';
  end if;

  if v_review_status = 'declined'::public.leave_status then
    if v_leave_request.status is distinct from 'pending'::public.leave_status then
      raise exception 'Only pending LeaveRequests can be reviewed' using errcode = '42501';
    end if;

    update public.leave_requests
    set
      status = v_review_status,
      reviewed_by = v_actor_id,
      reviewed_at = now()
    where id = v_leave_request.id
      and company_id = p_company_id
      and status = 'pending'::public.leave_status
    returning * into v_leave_request;

    if not found then
      raise exception 'Only pending LeaveRequests can be reviewed' using errcode = '42501';
    end if;

    return jsonb_build_object('leave_request', to_jsonb(v_leave_request));
  end if;

  if v_leave_request.status = 'pending'::public.leave_status then
    update public.leave_requests
    set
      status = v_review_status,
      reviewed_by = v_actor_id,
      reviewed_at = now()
    where id = v_leave_request.id
      and company_id = p_company_id
      and status = 'pending'::public.leave_status
    returning * into v_leave_request;

    if not found then
      raise exception 'Only pending LeaveRequests can be reviewed' using errcode = '42501';
    end if;
  elsif v_leave_request.status is distinct from 'approved'::public.leave_status then
    raise exception 'Only pending LeaveRequests can be reviewed' using errcode = '42501';
  end if;

  if v_leave_request.worker_id is null then
    raise exception 'LeaveRequest worker is required to create a calendar schedule' using errcode = '23502';
  end if;

  if not exists (
    select 1
    from public.company_members
    where company_id = v_leave_request.company_id
      and user_id = v_leave_request.worker_id
  ) then
    raise exception 'LeaveRequest worker must be a current company member to create a calendar schedule'
      using errcode = '23503';
  end if;

  v_leave_label := initcap(v_leave_request.leave_type::text);
  v_leave_color := case v_leave_request.leave_type
    when 'annual'::public.leave_type then '#3B82F6'
    when 'sick'::public.leave_type then '#EF4444'
    when 'personal'::public.leave_type then '#8B5CF6'
    else '#6B7280'
  end;

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
    v_leave_request.company_id,
    null,
    v_leave_request.id,
    coalesce(nullif(btrim(v_leave_request.worker_name), ''), v_leave_request.worker_email) || ' - ' || lower(v_leave_label) || ' leave',
    v_leave_label || ' Leave',
    null,
    v_leave_request.start_date,
    v_leave_request.end_date,
    v_leave_color,
    v_leave_request.notes,
    'leave',
    null,
    v_actor_id
  )
  on conflict on constraint job_schedules_leave_request_id_unique
  do update
  set
    company_id = excluded.company_id,
    job_id = null,
    title = excluded.title,
    job_name = excluded.job_name,
    job_number = null,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    color = excluded.color,
    notes = excluded.notes,
    source_type = 'leave',
    legacy_base44_id = null
  returning * into v_schedule;

  delete from public.job_schedule_assignments
  where schedule_id = v_schedule.id
    and company_id = v_leave_request.company_id
    and user_id is distinct from v_leave_request.worker_id;

  insert into public.job_schedule_assignments (
    schedule_id,
    company_id,
    user_id,
    assigned_by
  )
  values (
    v_schedule.id,
    v_leave_request.company_id,
    v_leave_request.worker_id,
    v_actor_id
  )
  on conflict on constraint job_schedule_assignments_schedule_user_unique
  do nothing;

  return jsonb_build_object('leave_request', to_jsonb(v_leave_request));
end;
$$;

revoke all on function public.review_leave_request_admin(uuid, uuid, text) from public;
revoke all on function public.review_leave_request_admin(uuid, uuid, text) from anon;
revoke all on function public.review_leave_request_admin(uuid, uuid, text) from authenticated;
grant execute on function public.review_leave_request_admin(uuid, uuid, text) to authenticated;
