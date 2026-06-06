-- OnSiteWork Native Supabase foundation schema.
-- Apply this before RLS/storage migrations.

create extension if not exists "pgcrypto";

do $$ begin
  create type app_role as enum ('owner', 'admin', 'supervisor', 'worker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type company_subscription_status as enum ('trial', 'active', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('active', 'completed', 'on_hold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type time_entry_status as enum ('active', 'completed', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_category as enum ('machinery', 'tools', 'vehicle', 'safety', 'electrical', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_status as enum ('available', 'checked_out', 'maintenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_log_action as enum ('checked_out', 'returned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pre_start_status as enum ('pass', 'fault');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_type as enum ('annual', 'sick', 'personal', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_status as enum ('pending', 'approved', 'declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_type as enum ('direct', 'broadcast');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  phone text,
  worker_id text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_email text,
  industry text,
  phone text,
  address text,
  subscription_status company_subscription_status not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role app_role not null default 'worker',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_name text not null,
  job_number text not null,
  location_address text,
  latitude numeric,
  longitude numeric,
  notes text,
  status job_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, job_number)
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_id uuid references public.profiles(id) on delete set null,
  worker_email text not null,
  worker_name text,
  job_id uuid references public.jobs(id) on delete set null,
  job_name text,
  job_number text,
  date date not null,
  start_time timestamptz not null,
  finish_time timestamptz,
  lunch_break_mins numeric not null default 0,
  total_hours numeric,
  status time_entry_status not null default 'active',
  notes text,
  worker_lat numeric,
  worker_lng numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  equipment_id text not null,
  category equipment_category not null default 'tools',
  status equipment_status not null default 'available',
  photo_path text,
  checked_out_by_id uuid references public.profiles(id) on delete set null,
  checked_out_by_email text,
  checked_out_by_name text,
  checked_out_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, equipment_id)
);

create table if not exists public.equipment_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  equipment_name text,
  worker_id uuid references public.profiles(id) on delete set null,
  worker_email text not null,
  worker_name text,
  action equipment_log_action not null,
  timestamp timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.pre_starts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  equipment_name text,
  worker_id uuid references public.profiles(id) on delete set null,
  worker_email text not null,
  worker_name text,
  job_id uuid references public.jobs(id) on delete set null,
  job_name text,
  job_number text,
  date date not null,
  answers jsonb not null default '{}',
  general_comments text,
  has_faults boolean not null default false,
  status pre_start_status not null default 'pass',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_id uuid references public.profiles(id) on delete set null,
  worker_email text not null,
  worker_name text,
  job_id uuid references public.jobs(id) on delete set null,
  job_name text,
  job_number text,
  photo_path text not null,
  date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_id uuid references public.profiles(id) on delete set null,
  worker_email text not null,
  worker_name text,
  leave_type leave_type not null default 'annual',
  start_date date not null,
  end_date date not null,
  notes text,
  status leave_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_email text not null,
  sender_name text,
  recipient_id uuid references public.profiles(id) on delete set null,
  recipient_email text,
  recipient_name text,
  subject text,
  body text not null,
  message_type message_type not null default 'direct',
  created_at timestamptz not null default now()
);

create table if not exists public.message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role app_role not null default 'worker',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status invitation_status not null default 'pending',
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.file_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  bucket text not null,
  path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_company_members_company_id on public.company_members(company_id);
create index if not exists idx_company_members_user_id on public.company_members(user_id);
create index if not exists idx_jobs_company_status on public.jobs(company_id, status);
create index if not exists idx_time_entries_company_date on public.time_entries(company_id, date);
create index if not exists idx_time_entries_worker_date on public.time_entries(worker_id, date);
create index if not exists idx_time_entries_active on public.time_entries(company_id, status) where status = 'active';
create index if not exists idx_equipment_company_status on public.equipment(company_id, status);
create index if not exists idx_equipment_logs_company_timestamp on public.equipment_logs(company_id, timestamp desc);
create index if not exists idx_pre_starts_company_date on public.pre_starts(company_id, date desc);
create index if not exists idx_job_photos_company_date on public.job_photos(company_id, date desc);
create index if not exists idx_leave_company_status on public.leave_requests(company_id, status);
create index if not exists idx_messages_company_created on public.messages(company_id, created_at desc);
create index if not exists idx_invitations_token on public.invitations(token);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_time_entries_updated_at on public.time_entries;
create trigger set_time_entries_updated_at
before update on public.time_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_equipment_updated_at on public.equipment;
create trigger set_equipment_updated_at
before update on public.equipment
for each row execute function public.set_updated_at();

drop trigger if exists set_pre_starts_updated_at on public.pre_starts;
create trigger set_pre_starts_updated_at
before update on public.pre_starts
for each row execute function public.set_updated_at();

drop trigger if exists set_leave_requests_updated_at on public.leave_requests;
create trigger set_leave_requests_updated_at
before update on public.leave_requests
for each row execute function public.set_updated_at();
