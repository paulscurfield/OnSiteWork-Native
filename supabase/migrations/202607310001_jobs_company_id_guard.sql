-- Prevent jobs from being moved between companies after creation.
-- This hardens tenant ownership alongside the existing jobs RLS policies.

create or replace function public.prevent_jobs_company_id_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'jobs.company_id cannot be changed after creation'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_jobs_company_id_change on public.jobs;
create trigger prevent_jobs_company_id_change
before update of company_id on public.jobs
for each row
execute function public.prevent_jobs_company_id_change();
