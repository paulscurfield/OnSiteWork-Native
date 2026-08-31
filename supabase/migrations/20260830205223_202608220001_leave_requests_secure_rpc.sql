-- Secure LeaveRequest worker create and admin review RPCs.
-- This does not read, copy, import, seed, backfill, or migrate Base44 data.

drop function if exists public.create_leave_request_worker(uuid, text, date, date, text);
drop function if exists public.review_leave_request_admin(uuid, uuid, text);

drop policy if exists "leave create own" on public.leave_requests;
drop policy if exists "leave update own pending or admin" on public.leave_requests;

revoke insert, update on public.leave_requests from anon, authenticated;
grant select, delete on public.leave_requests to authenticated;

create or replace function public.create_leave_request_worker(
  p_company_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
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
  v_leave_type public.leave_type;
  v_leave_request public.leave_requests%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_start_date is null then
    raise exception 'start_date is required' using errcode = '23502';
  end if;

  if p_end_date is null then
    raise exception 'end_date is required' using errcode = '23502';
  end if;

  if p_end_date < p_start_date then
    raise exception 'end_date cannot be before start_date' using errcode = '22007';
  end if;

  if lower(btrim(coalesce(p_leave_type, ''))) not in ('annual', 'sick', 'personal', 'other') then
    raise exception 'leave_type must be annual, sick, personal, or other' using errcode = '22P02';
  end if;
  v_leave_type := lower(btrim(p_leave_type))::public.leave_type;

  if not public.is_company_member(p_company_id) then
    raise exception 'Only company members can create LeaveRequests' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'Authenticated profile was not found' using errcode = 'P0002';
  end if;

  if nullif(btrim(v_profile.email), '') is null then
    raise exception 'Authenticated profile email was not found' using errcode = 'P0002';
  end if;

  insert into public.leave_requests (
    company_id,
    worker_id,
    worker_email,
    worker_name,
    leave_type,
    start_date,
    end_date,
    notes,
    status,
    reviewed_by,
    reviewed_at
  )
  values (
    p_company_id,
    v_actor_id,
    btrim(v_profile.email),
    coalesce(nullif(btrim(v_profile.full_name), ''), btrim(v_profile.email)),
    v_leave_type,
    p_start_date,
    p_end_date,
    nullif(btrim(p_notes), ''),
    'pending'::public.leave_status,
    null,
    null
  )
  returning * into v_leave_request;

  return jsonb_build_object('leave_request', to_jsonb(v_leave_request));
end;
$$;

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
end;
$$;

revoke all on function public.create_leave_request_worker(uuid, text, date, date, text) from public;
revoke all on function public.create_leave_request_worker(uuid, text, date, date, text) from anon;
revoke all on function public.create_leave_request_worker(uuid, text, date, date, text) from authenticated;
grant execute on function public.create_leave_request_worker(uuid, text, date, date, text) to authenticated;

revoke all on function public.review_leave_request_admin(uuid, uuid, text) from public;
revoke all on function public.review_leave_request_admin(uuid, uuid, text) from anon;
revoke all on function public.review_leave_request_admin(uuid, uuid, text) from authenticated;
grant execute on function public.review_leave_request_admin(uuid, uuid, text) to authenticated;
