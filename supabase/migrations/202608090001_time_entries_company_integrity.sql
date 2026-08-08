-- Harden time entry tenant relationships without migrating or rewriting data.
-- Existing RLS remains responsible for who may read, create, update, or delete rows.

create or replace function public.validate_time_entries_company_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'time_entries.company_id cannot be changed after creation'
      using errcode = '42501';
  end if;

  if new.worker_id is null then
    raise exception 'time_entries.worker_id is required'
      using errcode = '23502';
  end if;

  if not exists (
    select 1
    from public.company_members as member
    where member.company_id = new.company_id
      and member.user_id = new.worker_id
  ) then
    raise exception 'time_entries.worker_id must belong to time_entries.company_id'
      using errcode = '23503';
  end if;

  if new.job_id is not null and not exists (
    select 1
    from public.jobs as job
    where job.id = new.job_id
      and job.company_id = new.company_id
  ) then
    raise exception 'time_entries.job_id must belong to time_entries.company_id'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_time_entries_company_integrity() from public;
revoke all on function public.validate_time_entries_company_integrity() from anon;
revoke all on function public.validate_time_entries_company_integrity() from authenticated;

drop trigger if exists validate_time_entries_company_integrity on public.time_entries;
create trigger validate_time_entries_company_integrity
before insert or update of company_id, worker_id, job_id on public.time_entries
for each row
execute function public.validate_time_entries_company_integrity();
