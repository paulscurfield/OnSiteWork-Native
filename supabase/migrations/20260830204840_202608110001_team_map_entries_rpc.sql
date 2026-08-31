-- Least-privilege Team Map read RPC.
-- Exposes only limited live same-company active TimeEntry display data.

drop function if exists public.get_team_map_entries(uuid, text);
drop function if exists public.get_team_map_entries(uuid);

create or replace function public.get_team_map_entries(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_entries jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Team Map entries are only available to company members'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', entry.id,
        'worker_name', entry.worker_name,
        'job_name', entry.job_name,
        'job_number', entry.job_number,
        'status', entry.status,
        'start_time', entry.start_time,
        'worker_lat', entry.worker_lat,
        'worker_lng', entry.worker_lng
      )
      order by entry.start_time asc, entry.id asc
    ),
    '[]'::jsonb
  )
  into v_entries
  from public.time_entries as entry
  where entry.company_id = p_company_id
    and entry.status = 'active'::public.time_entry_status
    and entry.start_time >= now() - interval '24 hours'
    and entry.start_time <= now();

  return jsonb_build_object('entries', v_entries);
end;
$$;

revoke all on function public.get_team_map_entries(uuid) from public;
revoke all on function public.get_team_map_entries(uuid) from anon;
revoke all on function public.get_team_map_entries(uuid) from authenticated;
grant execute on function public.get_team_map_entries(uuid) to authenticated;
