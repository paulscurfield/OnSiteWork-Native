-- Company worker directory RPC for Calendar assignment UI.
-- Exposes only same-company member identity fields needed for worker selection.

drop function if exists public.list_company_worker_directory(uuid);

create function public.list_company_worker_directory(p_company_id uuid)
returns table (
  user_id uuid,
  role public.app_role,
  full_name text,
  email text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Company worker directory is only available to company members' using errcode = '42501';
  end if;

  return query
  with directory as (
    select
      member.user_id,
      member.role,
      nullif(btrim(profile.full_name), '') as full_name,
      nullif(btrim(profile.email), '') as email
    from public.company_members as member
    join public.profiles as profile
      on profile.id = member.user_id
    where member.company_id = p_company_id
  )
  select
    directory.user_id,
    directory.role,
    directory.full_name,
    directory.email,
    coalesce(
      directory.full_name,
      directory.email,
      'Worker • ' || left(directory.user_id::text, 8)
    ) as display_name
  from directory
  order by
    lower(coalesce(directory.full_name, directory.email, 'Worker • ' || left(directory.user_id::text, 8))),
    directory.user_id;
end;
$$;

revoke all on function public.list_company_worker_directory(uuid) from public;
revoke all on function public.list_company_worker_directory(uuid) from anon;
revoke all on function public.list_company_worker_directory(uuid) from authenticated;

grant execute on function public.list_company_worker_directory(uuid) to authenticated;
