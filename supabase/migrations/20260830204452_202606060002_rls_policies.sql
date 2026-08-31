-- Row Level Security for the OnSiteWork Native Supabase foundation.
-- Assumes 202606060001_initial_schema.sql has already been applied.

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_company_admin(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_company_owner(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.jobs enable row level security;
alter table public.time_entries enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_logs enable row level security;
alter table public.pre_starts enable row level security;
alter table public.job_photos enable row level security;
alter table public.leave_requests enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.invitations enable row level security;
alter table public.file_uploads enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "companies members read" on public.companies;
create policy "companies members read" on public.companies
for select using (public.is_company_member(id));

drop policy if exists "companies owners create" on public.companies;
create policy "companies owners create" on public.companies
for insert with check (owner_id = auth.uid());

drop policy if exists "companies admins update" on public.companies;
create policy "companies admins update" on public.companies
for update using (public.is_company_admin(id)) with check (public.is_company_admin(id));

drop policy if exists "members read company" on public.company_members;
create policy "members read company" on public.company_members
for select using (public.is_company_member(company_id));

drop policy if exists "members manage admins" on public.company_members;
create policy "members manage admins" on public.company_members
for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists "jobs read company" on public.jobs;
create policy "jobs read company" on public.jobs
for select using (public.is_company_member(company_id));

drop policy if exists "jobs manage admins" on public.jobs;
create policy "jobs manage admins" on public.jobs
for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists "time read own or admin" on public.time_entries;
create policy "time read own or admin" on public.time_entries
for select using (worker_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists "time insert own" on public.time_entries;
create policy "time insert own" on public.time_entries
for insert with check (worker_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists "time update own or admin" on public.time_entries;
create policy "time update own or admin" on public.time_entries
for update using (worker_id = auth.uid() or public.is_company_admin(company_id))
with check (worker_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists "time delete admins" on public.time_entries;
create policy "time delete admins" on public.time_entries
for delete using (public.is_company_admin(company_id));

drop policy if exists "equipment read company" on public.equipment;
create policy "equipment read company" on public.equipment
for select using (public.is_company_member(company_id));

drop policy if exists "equipment checkout members" on public.equipment;
create policy "equipment checkout members" on public.equipment
for update using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

drop policy if exists "equipment create admins" on public.equipment;
create policy "equipment create admins" on public.equipment
for insert with check (public.is_company_admin(company_id));

drop policy if exists "equipment delete admins" on public.equipment;
create policy "equipment delete admins" on public.equipment
for delete using (public.is_company_admin(company_id));

drop policy if exists "equipment logs read company" on public.equipment_logs;
create policy "equipment logs read company" on public.equipment_logs
for select using (public.is_company_member(company_id));

drop policy if exists "equipment logs create members" on public.equipment_logs;
create policy "equipment logs create members" on public.equipment_logs
for insert with check (public.is_company_member(company_id));

drop policy if exists "prestarts read own or admin" on public.pre_starts;
create policy "prestarts read own or admin" on public.pre_starts
for select using (worker_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists "prestarts create own" on public.pre_starts;
create policy "prestarts create own" on public.pre_starts
for insert with check (worker_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists "prestarts manage admins" on public.pre_starts;
create policy "prestarts manage admins" on public.pre_starts
for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists "job photos read company" on public.job_photos;
create policy "job photos read company" on public.job_photos
for select using (public.is_company_member(company_id));

drop policy if exists "job photos create own" on public.job_photos;
create policy "job photos create own" on public.job_photos
for insert with check (worker_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists "job photos delete admins" on public.job_photos;
create policy "job photos delete admins" on public.job_photos
for delete using (public.is_company_admin(company_id));

drop policy if exists "leave read own or admin" on public.leave_requests;
create policy "leave read own or admin" on public.leave_requests
for select using (worker_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists "leave create own" on public.leave_requests;
create policy "leave create own" on public.leave_requests
for insert with check (worker_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists "leave update own pending or admin" on public.leave_requests;
create policy "leave update own pending or admin" on public.leave_requests
for update using (public.is_company_admin(company_id) or (worker_id = auth.uid() and status = 'pending'))
with check (public.is_company_admin(company_id) or (worker_id = auth.uid() and status = 'pending'));

drop policy if exists "leave delete own pending or admin" on public.leave_requests;
create policy "leave delete own pending or admin" on public.leave_requests
for delete using (public.is_company_admin(company_id) or (worker_id = auth.uid() and status = 'pending'));

drop policy if exists "messages read participant" on public.messages;
create policy "messages read participant" on public.messages
for select using (
  public.is_company_member(company_id)
  and (sender_id = auth.uid() or recipient_id = auth.uid() or message_type = 'broadcast')
);

drop policy if exists "messages create member" on public.messages;
create policy "messages create member" on public.messages
for insert with check (sender_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists "message reads own" on public.message_reads;
create policy "message reads own" on public.message_reads
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "invitations read admins" on public.invitations;
create policy "invitations read admins" on public.invitations
for select using (public.is_company_admin(company_id));

drop policy if exists "invitations manage admins" on public.invitations;
create policy "invitations manage admins" on public.invitations
for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists "file uploads read company" on public.file_uploads;
create policy "file uploads read company" on public.file_uploads
for select using (company_id is null or public.is_company_member(company_id));

drop policy if exists "file uploads create own" on public.file_uploads;
create policy "file uploads create own" on public.file_uploads
for insert with check (uploaded_by = auth.uid());

drop policy if exists "audit read admins" on public.audit_events;
create policy "audit read admins" on public.audit_events
for select using (public.is_company_admin(company_id));

drop policy if exists "audit create service" on public.audit_events;
create policy "audit create service" on public.audit_events
for insert with check (actor_id = auth.uid() or actor_id is null);
