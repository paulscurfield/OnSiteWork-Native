-- Calendar schedule schema for OnSiteWork Native.
-- Adds date-only schedule tables. RLS policies are intentionally added in a later migration.

alter table public.jobs
  add constraint jobs_id_company_id_unique unique (id, company_id);

alter table public.leave_requests
  add constraint leave_requests_id_company_id_unique unique (id, company_id);

create table public.job_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid,
  leave_request_id uuid,
  title text not null,
  job_name text,
  job_number text,
  start_date date not null,
  end_date date not null,
  color text not null default '#10B981',
  notes text,
  source_type text not null default 'manual',
  legacy_base44_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_schedules_company_job_fk
    foreign key (job_id, company_id)
    references public.jobs(id, company_id)
    on delete set null (job_id),
  constraint job_schedules_company_leave_request_fk
    foreign key (leave_request_id, company_id)
    references public.leave_requests(id, company_id)
    on delete set null (leave_request_id),
  constraint job_schedules_id_company_id_unique unique (id, company_id),
  constraint job_schedules_company_legacy_base44_id_unique unique (company_id, legacy_base44_id),
  constraint job_schedules_leave_request_id_unique unique (leave_request_id),
  constraint job_schedules_valid_date_range check (end_date >= start_date),
  constraint job_schedules_title_not_blank check (length(btrim(title)) > 0),
  constraint job_schedules_valid_color check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint job_schedules_valid_source_type check (source_type in ('manual', 'job', 'leave'))
);

create table public.job_schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint job_schedule_assignments_schedule_company_fk
    foreign key (schedule_id, company_id)
    references public.job_schedules(id, company_id)
    on delete cascade,
  constraint job_schedule_assignments_company_user_fk
    foreign key (company_id, user_id)
    references public.company_members(company_id, user_id)
    on delete cascade,
  constraint job_schedule_assignments_schedule_user_unique unique (schedule_id, user_id)
);

create index idx_job_schedules_company_date_range
  on public.job_schedules(company_id, start_date, end_date);

create index idx_job_schedules_company_job
  on public.job_schedules(company_id, job_id)
  where job_id is not null;

create index idx_job_schedules_company_leave_request
  on public.job_schedules(company_id, leave_request_id)
  where leave_request_id is not null;

create index idx_job_schedules_company_source_type
  on public.job_schedules(company_id, source_type);

create index idx_job_schedule_assignments_company_user
  on public.job_schedule_assignments(company_id, user_id);

create index idx_job_schedule_assignments_schedule
  on public.job_schedule_assignments(schedule_id);

drop trigger if exists set_job_schedules_updated_at on public.job_schedules;
create trigger set_job_schedules_updated_at
before update on public.job_schedules
for each row execute function public.set_updated_at();
