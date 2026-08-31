-- Authenticated table privileges for the Supabase-backed app surface.
-- RLS policies remain authoritative; this migration only grants the minimum
-- table privileges required by the current browser adapter.

grant select on public.profiles to authenticated;
grant select on public.companies to authenticated;
grant select on public.company_members to authenticated;
grant select on public.jobs to authenticated;
grant select on public.time_entries to authenticated;
grant select on public.equipment to authenticated;
grant select on public.equipment_logs to authenticated;
grant select on public.pre_starts to authenticated;
grant select on public.job_photos to authenticated;
grant select on public.leave_requests to authenticated;
grant select on public.invitations to authenticated;
grant select on public.job_schedules to authenticated;
grant select on public.job_schedule_assignments to authenticated;

grant insert (
  company_id,
  job_name,
  job_number,
  location_address,
  latitude,
  longitude,
  notes,
  status
) on public.jobs to authenticated;

grant update (
  job_name,
  job_number,
  location_address,
  latitude,
  longitude,
  notes,
  status
) on public.jobs to authenticated;

grant delete on public.jobs to authenticated;

grant insert (
  company_id,
  name,
  equipment_id,
  category,
  status,
  notes
) on public.equipment to authenticated;

grant update (
  name,
  equipment_id,
  category,
  status,
  notes
) on public.equipment to authenticated;

grant delete on public.equipment to authenticated;

grant delete on public.job_schedules to authenticated;
