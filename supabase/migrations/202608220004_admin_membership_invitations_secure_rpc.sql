-- Secure Admin company membership and invitation write paths.
-- This migration intentionally does not create Auth users, send email, or migrate Base44 data.

drop policy if exists "members manage admins" on public.company_members;
revoke insert, update, delete on public.company_members from public;
revoke insert, update, delete on public.company_members from anon;
revoke insert, update, delete on public.company_members from authenticated;

drop policy if exists "invitations manage admins" on public.invitations;
drop policy if exists "invitations read admins" on public.invitations;
create policy "invitations read admins" on public.invitations
for select using (public.is_company_admin(company_id));

revoke insert, update, delete on public.invitations from public;
revoke insert, update, delete on public.invitations from anon;
revoke insert, update, delete on public.invitations from authenticated;

drop function if exists public.change_company_member_role_admin(uuid, uuid, public.app_role);
drop function if exists public.remove_company_member_admin(uuid, uuid);
drop function if exists public.create_company_invitation_admin(uuid, text, public.app_role);
drop function if exists public.revoke_company_invitation_admin(uuid, uuid);

create function public.change_company_member_role_admin(
  p_company_id uuid,
  p_user_id uuid,
  p_role public.app_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.company_members%rowtype;
  v_target public.company_members%rowtype;
  v_updated public.company_members%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required' using errcode = '23502';
  end if;

  if p_role is null then
    raise exception 'role is required' using errcode = '23502';
  end if;

  if p_role = 'owner'::public.app_role then
    raise exception 'Owner role changes require a dedicated owner-transfer flow' using errcode = '42501';
  end if;

  select *
    into v_actor
    from public.company_members
   where company_id = p_company_id
     and user_id = v_actor_id;

  if not found or v_actor.role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    raise exception 'Only company owners and admins can manage members' using errcode = '42501';
  end if;

  select *
    into v_target
    from public.company_members
   where company_id = p_company_id
     and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Company member not found' using errcode = '42501';
  end if;

  if v_target.user_id = v_actor_id then
    raise exception 'Members cannot change their own role' using errcode = '42501';
  end if;

  if v_target.role = 'owner'::public.app_role then
    raise exception 'Owner memberships cannot be changed through this operation' using errcode = '42501';
  end if;

  if v_actor.role = 'admin'::public.app_role then
    if v_target.role = 'admin'::public.app_role then
      raise exception 'Admins cannot modify other admins' using errcode = '42501';
    end if;
    if p_role = 'admin'::public.app_role then
      raise exception 'Admins cannot grant the admin role' using errcode = '42501';
    end if;
  end if;

  update public.company_members
     set role = p_role
   where id = v_target.id
     and company_id = p_company_id
     and user_id = p_user_id
  returning * into v_updated;

  if not found or v_updated.company_id <> p_company_id or v_updated.user_id <> p_user_id then
    raise exception 'Failed to update company membership safely' using errcode = '40001';
  end if;

  return jsonb_build_object('membership', to_jsonb(v_updated));
end;
$$;

create function public.remove_company_member_admin(
  p_company_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.company_members%rowtype;
  v_target public.company_members%rowtype;
  v_removed public.company_members%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required' using errcode = '23502';
  end if;

  select *
    into v_actor
    from public.company_members
   where company_id = p_company_id
     and user_id = v_actor_id;

  if not found or v_actor.role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    raise exception 'Only company owners and admins can remove members' using errcode = '42501';
  end if;

  select *
    into v_target
    from public.company_members
   where company_id = p_company_id
     and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Company member not found' using errcode = '42501';
  end if;

  if v_target.user_id = v_actor_id then
    raise exception 'Members cannot remove themselves' using errcode = '42501';
  end if;

  if v_target.role = 'owner'::public.app_role then
    raise exception 'Owner memberships cannot be removed through this operation' using errcode = '42501';
  end if;

  if v_actor.role = 'admin'::public.app_role and v_target.role = 'admin'::public.app_role then
    raise exception 'Admins cannot remove other admins' using errcode = '42501';
  end if;

  delete from public.company_members
   where id = v_target.id
     and company_id = p_company_id
     and user_id = p_user_id
  returning * into v_removed;

  if not found or v_removed.company_id <> p_company_id or v_removed.user_id <> p_user_id then
    raise exception 'Failed to remove company membership safely' using errcode = '40001';
  end if;

  return jsonb_build_object('membership', to_jsonb(v_removed));
end;
$$;

create function public.create_company_invitation_admin(
  p_company_id uuid,
  p_email text,
  p_role public.app_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.company_members%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_invitation public.invitations%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_role is null then
    raise exception 'role is required' using errcode = '23502';
  end if;

  if p_role = 'owner'::public.app_role then
    raise exception 'Owner invitations require a dedicated owner-transfer flow' using errcode = '42501';
  end if;

  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  select *
    into v_actor
    from public.company_members
   where company_id = p_company_id
     and user_id = v_actor_id;

  if not found or v_actor.role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    raise exception 'Only company owners and admins can create invitations' using errcode = '42501';
  end if;

  if v_actor.role = 'admin'::public.app_role and p_role = 'admin'::public.app_role then
    raise exception 'Admins cannot invite admins' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text || ':' || v_email, 0)
  );

  update public.invitations
     set status = 'expired'::public.invitation_status
   where company_id = p_company_id
     and lower(email) = v_email
     and status = 'pending'::public.invitation_status
     and expires_at <= now();

  if exists (
    select 1
      from public.company_members as member
      join public.profiles as profile
        on profile.id = member.user_id
     where member.company_id = p_company_id
       and lower(profile.email) = v_email
  ) then
    raise exception 'This email is already a company member' using errcode = '23505';
  end if;

  if exists (
    select 1
      from public.invitations
     where company_id = p_company_id
       and lower(email) = v_email
       and status = 'pending'::public.invitation_status
       and expires_at > now()
  ) then
    raise exception 'A pending invitation already exists for this email' using errcode = '23505';
  end if;

  insert into public.invitations (
    company_id,
    email,
    role,
    token,
    status,
    invited_by,
    expires_at
  )
  values (
    p_company_id,
    v_email,
    p_role,
    encode(public.gen_random_bytes(24), 'hex'),
    'pending'::public.invitation_status,
    v_actor_id,
    now() + interval '14 days'
  )
  returning * into v_invitation;

  return jsonb_build_object('invitation', to_jsonb(v_invitation) - 'token');
end;
$$;

create function public.revoke_company_invitation_admin(
  p_company_id uuid,
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.company_members%rowtype;
  v_invitation public.invitations%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '23502';
  end if;

  if p_invitation_id is null then
    raise exception 'invitation_id is required' using errcode = '23502';
  end if;

  select *
    into v_actor
    from public.company_members
   where company_id = p_company_id
     and user_id = v_actor_id;

  if not found or v_actor.role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    raise exception 'Only company owners and admins can revoke invitations' using errcode = '42501';
  end if;

  select *
    into v_invitation
    from public.invitations
   where id = p_invitation_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;

  if v_invitation.status <> 'pending'::public.invitation_status then
    raise exception 'Only pending invitations can be revoked' using errcode = '42501';
  end if;

  update public.invitations
     set status = 'revoked'::public.invitation_status
   where id = v_invitation.id
     and company_id = p_company_id
     and status = 'pending'::public.invitation_status
  returning * into v_invitation;

  if not found or v_invitation.company_id <> p_company_id then
    raise exception 'Failed to revoke invitation safely' using errcode = '40001';
  end if;

  return jsonb_build_object('invitation', to_jsonb(v_invitation) - 'token');
end;
$$;

revoke all on function public.change_company_member_role_admin(uuid, uuid, public.app_role) from public;
revoke all on function public.change_company_member_role_admin(uuid, uuid, public.app_role) from anon;
revoke all on function public.change_company_member_role_admin(uuid, uuid, public.app_role) from authenticated;
grant execute on function public.change_company_member_role_admin(uuid, uuid, public.app_role) to authenticated;

revoke all on function public.remove_company_member_admin(uuid, uuid) from public;
revoke all on function public.remove_company_member_admin(uuid, uuid) from anon;
revoke all on function public.remove_company_member_admin(uuid, uuid) from authenticated;
grant execute on function public.remove_company_member_admin(uuid, uuid) to authenticated;

revoke all on function public.create_company_invitation_admin(uuid, text, public.app_role) from public;
revoke all on function public.create_company_invitation_admin(uuid, text, public.app_role) from anon;
revoke all on function public.create_company_invitation_admin(uuid, text, public.app_role) from authenticated;
grant execute on function public.create_company_invitation_admin(uuid, text, public.app_role) to authenticated;

revoke all on function public.revoke_company_invitation_admin(uuid, uuid) from public;
revoke all on function public.revoke_company_invitation_admin(uuid, uuid) from anon;
revoke all on function public.revoke_company_invitation_admin(uuid, uuid) from authenticated;
grant execute on function public.revoke_company_invitation_admin(uuid, uuid) to authenticated;
