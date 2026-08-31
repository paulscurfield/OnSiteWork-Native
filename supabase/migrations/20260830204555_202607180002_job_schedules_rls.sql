-- Row Level Security for calendar schedules.
-- Assumes 202607180001_job_schedules_schema.sql has already been applied.

alter table public.job_schedules enable row level security;
alter table public.job_schedule_assignments enable row level security;

-- Preserve tenant and audit ownership on updates from browser roles.
-- RLS controls which rows can be changed; column grants control which fields can be changed.
revoke update on public.job_schedules from anon, authenticated;
grant update (
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
  legacy_base44_id
) on public.job_schedules to authenticated;

revoke update on public.job_schedule_assignments from anon, authenticated;
grant update (
  schedule_id,
  user_id
) on public.job_schedule_assignments to authenticated;

drop policy if exists "job schedules read company" on public.job_schedules;
create policy "job schedules read company" on public.job_schedules
for select using (public.is_company_member(company_id));

drop policy if exists "job schedules create admins" on public.job_schedules;
create policy "job schedules create admins" on public.job_schedules
for insert with check (
  public.is_company_admin(company_id)
  and created_by = auth.uid()
);

drop policy if exists "job schedules update admins" on public.job_schedules;
create policy "job schedules update admins" on public.job_schedules
for update using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "job schedules delete admins" on public.job_schedules;
create policy "job schedules delete admins" on public.job_schedules
for delete using (public.is_company_admin(company_id));

drop policy if exists "job schedule assignments read company" on public.job_schedule_assignments;
create policy "job schedule assignments read company" on public.job_schedule_assignments
for select using (public.is_company_member(company_id));

drop policy if exists "job schedule assignments create admins" on public.job_schedule_assignments;
create policy "job schedule assignments create admins" on public.job_schedule_assignments
for insert with check (
  public.is_company_admin(company_id)
  and assigned_by = auth.uid()
);

drop policy if exists "job schedule assignments update admins" on public.job_schedule_assignments;
create policy "job schedule assignments update admins" on public.job_schedule_assignments
for update using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "job schedule assignments delete admins" on public.job_schedule_assignments;
create policy "job schedule assignments delete admins" on public.job_schedule_assignments
for delete using (public.is_company_admin(company_id));
