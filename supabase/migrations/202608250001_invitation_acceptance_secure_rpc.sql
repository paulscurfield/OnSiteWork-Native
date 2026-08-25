-- Secure invitation acceptance and profile bootstrap.
-- This migration intentionally does not send email, create Auth users, or migrate Base44 data.

drop policy if exists "profiles insert own" on public.profiles;
revoke insert on public.profiles from public;
revoke insert on public.profiles from anon;
revoke insert on public.profiles from authenticated;

drop function if exists public.accept_company_invitation(uuid, text);

create function public.accept_company_invitation(
  p_invitation_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_auth_email text;
  v_auth_metadata jsonb;
  v_profile_name text;
  v_token text := btrim(coalesce(p_token, ''));
  v_invitation public.invitations%rowtype;
  v_profile public.profiles%rowtype;
  v_membership public.company_members%rowtype;
  v_membership_count integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_invitation_id is null then
    raise exception 'invitation_id is required' using errcode = '23502';
  end if;

  if v_token = '' or v_token !~ '^[0-9a-f]{48}$' then
    raise exception 'Invalid invitation token' using errcode = '22023';
  end if;

  select
    lower(btrim(coalesce(auth_user.email, ''))),
    coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
    into v_auth_email, v_auth_metadata
    from auth.users as auth_user
   where auth_user.id = v_actor_id;

  if not found or v_auth_email = '' or v_auth_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Authenticated email is required' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text, 0));

  select *
    into v_invitation
    from public.invitations
   where id = p_invitation_id
   for update;

  if not found then
    raise exception 'Invitation not found or unavailable' using errcode = '42501';
  end if;

  if v_invitation.token <> v_token then
    raise exception 'Invitation not found or unavailable' using errcode = '42501';
  end if;

  if lower(btrim(coalesce(v_invitation.email, ''))) <> v_auth_email then
    raise exception 'Invitation not found or unavailable' using errcode = '42501';
  end if;

  if v_invitation.status = 'accepted'::public.invitation_status then
    if v_invitation.accepted_by is distinct from v_actor_id then
      raise exception 'Invitation not found or unavailable' using errcode = '42501';
    end if;

    select *
      into v_membership
      from public.company_members
     where company_id = v_invitation.company_id
       and user_id = v_actor_id
     for update;

    if not found then
      raise exception 'Invitation has already been accepted and access is no longer active' using errcode = '42501';
    end if;

    if v_membership.role <> v_invitation.role then
      raise exception 'Invitation has already been accepted and membership no longer matches' using errcode = '42501';
    end if;

    select *
      into v_profile
      from public.profiles
     where id = v_actor_id
     for update;

    if not found or lower(btrim(coalesce(v_profile.email, ''))) <> v_auth_email then
      raise exception 'Authenticated profile could not be verified' using errcode = '42501';
    end if;

    return jsonb_build_object(
      'invitation', to_jsonb(v_invitation) - 'token',
      'membership', to_jsonb(v_membership),
      'profile', to_jsonb(v_profile)
    );
  end if;

  if v_invitation.status <> 'pending'::public.invitation_status then
    raise exception 'Invitation not found or unavailable' using errcode = '42501';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'Invitation has expired' using errcode = '42501';
  end if;

  select *
    into v_profile
    from public.profiles
   where id = v_actor_id
   for update;

  if found then
    if lower(btrim(coalesce(v_profile.email, ''))) <> v_auth_email then
      raise exception 'Authenticated profile email does not match Auth email' using errcode = '42501';
    end if;
  else
    v_profile_name := nullif(btrim(coalesce(
      v_auth_metadata ->> 'full_name',
      v_auth_metadata ->> 'name',
      ''
    )), '');

    insert into public.profiles (
      id,
      email,
      full_name
    )
    values (
      v_actor_id,
      v_auth_email,
      v_profile_name
    )
    returning * into v_profile;
  end if;

  perform 1
    from public.company_members
   where user_id = v_actor_id
   for update;

  select count(*)
    into v_membership_count
    from public.company_members
   where user_id = v_actor_id;

  if v_membership_count > 1 then
    raise exception 'Multiple company memberships require company selection before accepting invitations' using errcode = '42501';
  end if;

  if v_membership_count = 1 then
    select *
      into v_membership
      from public.company_members
     where user_id = v_actor_id
     for update;

    if v_membership.company_id <> v_invitation.company_id then
      raise exception 'This account is already connected to another company' using errcode = '42501';
    end if;

    if v_membership.role <> v_invitation.role then
      raise exception 'Existing membership role does not match invitation' using errcode = '42501';
    end if;
  else
    insert into public.company_members (
      company_id,
      user_id,
      role,
      created_by
    )
    values (
      v_invitation.company_id,
      v_actor_id,
      v_invitation.role,
      v_invitation.invited_by
    )
    returning * into v_membership;
  end if;

  update public.invitations
     set status = 'accepted'::public.invitation_status,
         accepted_by = v_actor_id,
         accepted_at = now()
   where id = v_invitation.id
     and status = 'pending'::public.invitation_status
     and expires_at > now()
  returning * into v_invitation;

  if not found then
    raise exception 'Invitation could not be accepted safely' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'invitation', to_jsonb(v_invitation) - 'token',
    'membership', to_jsonb(v_membership),
    'profile', to_jsonb(v_profile)
  );
end;
$$;

revoke all on function public.accept_company_invitation(uuid, text) from public;
revoke all on function public.accept_company_invitation(uuid, text) from anon;
revoke all on function public.accept_company_invitation(uuid, text) from authenticated;
grant execute on function public.accept_company_invitation(uuid, text) to authenticated;
