-- Secure Messages RPC foundation.
-- Keeps existing Supabase message rows intact while removing direct client writes.

drop function if exists public.create_message_member(uuid, text, uuid, text, text);
drop function if exists public.get_message_mailbox(uuid);
drop function if exists public.mark_message_read(uuid, uuid);
drop function if exists public.get_unread_message_count(uuid);

drop policy if exists "messages create member" on public.messages;

revoke insert, update, delete on public.messages from anon;
revoke insert, update, delete on public.messages from authenticated;

drop policy if exists "message reads own" on public.message_reads;
create policy "message reads own select" on public.message_reads
for select using (user_id = auth.uid());

revoke insert, update, delete on public.message_reads from anon;
revoke insert, update, delete on public.message_reads from authenticated;

create or replace function public.create_message_member(
  p_company_id uuid,
  p_message_type text,
  p_recipient_id uuid,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_message_type text := lower(trim(coalesce(p_message_type, '')));
  v_subject text := nullif(trim(coalesce(p_subject, '')), '');
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_sender public.profiles%rowtype;
  v_recipient public.profiles%rowtype;
  v_message public.messages%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Company membership required';
  end if;

  if v_message_type not in ('direct', 'broadcast') then
    raise exception 'message_type must be direct or broadcast';
  end if;

  if v_body is null then
    raise exception 'body is required';
  end if;

  select *
  into v_sender
  from public.profiles
  where id = v_actor_id;

  if not found or nullif(trim(v_sender.email), '') is null then
    raise exception 'Sender profile is unavailable';
  end if;

  if v_message_type = 'direct' then
    if p_recipient_id is null then
      raise exception 'recipient_id is required for direct messages';
    end if;

    if p_recipient_id = v_actor_id then
      raise exception 'Cannot send a direct message to yourself';
    end if;

    select profile.*
    into v_recipient
    from public.profiles as profile
    inner join public.company_members as member
      on member.user_id = profile.id
     and member.company_id = p_company_id
    where profile.id = p_recipient_id;

    if not found or nullif(trim(v_recipient.email), '') is null then
      raise exception 'Recipient is unavailable';
    end if;

    insert into public.messages (
      company_id,
      sender_id,
      sender_email,
      sender_name,
      recipient_id,
      recipient_email,
      recipient_name,
      subject,
      body,
      message_type
    )
    values (
      p_company_id,
      v_actor_id,
      trim(v_sender.email),
      coalesce(nullif(trim(coalesce(v_sender.full_name, '')), ''), trim(v_sender.email)),
      v_recipient.id,
      trim(v_recipient.email),
      coalesce(nullif(trim(coalesce(v_recipient.full_name, '')), ''), trim(v_recipient.email)),
      v_subject,
      v_body,
      'direct'::public.message_type
    )
    returning * into v_message;
  else
    if p_recipient_id is not null then
      raise exception 'recipient_id must be null for broadcast messages';
    end if;

    insert into public.messages (
      company_id,
      sender_id,
      sender_email,
      sender_name,
      recipient_id,
      recipient_email,
      recipient_name,
      subject,
      body,
      message_type
    )
    values (
      p_company_id,
      v_actor_id,
      trim(v_sender.email),
      coalesce(nullif(trim(coalesce(v_sender.full_name, '')), ''), trim(v_sender.email)),
      null,
      'all',
      'All Workers',
      v_subject,
      v_body,
      'broadcast'::public.message_type
    )
    returning * into v_message;
  end if;

  return jsonb_build_object('message', to_jsonb(v_message));
end;
$$;

create or replace function public.get_message_mailbox(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_messages jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Company membership required';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(message_row)
      || jsonb_build_object(
        'is_read',
        exists (
          select 1
          from public.message_reads as receipt
          where receipt.message_id = message_row.id
            and receipt.user_id = v_actor_id
        )
      )
      order by message_row.created_at desc
    ),
    '[]'::jsonb
  )
  into v_messages
  from public.messages as message_row
  where message_row.company_id = p_company_id
    and (
      message_row.sender_id = v_actor_id
      or message_row.recipient_id = v_actor_id
      or message_row.message_type = 'broadcast'::public.message_type
    );

  return jsonb_build_object('messages', v_messages);
end;
$$;

create or replace function public.mark_message_read(
  p_company_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_message public.messages%rowtype;
  v_receipt public.message_reads%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_message_id is null then
    raise exception 'message_id is required';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Company membership required';
  end if;

  select *
  into v_message
  from public.messages
  where id = p_message_id
    and company_id = p_company_id;

  if not found then
    raise exception 'Message is unavailable';
  end if;

  if v_message.message_type = 'direct'::public.message_type then
    if v_message.recipient_id is distinct from v_actor_id then
      raise exception 'Message is not readable by this user';
    end if;
  elsif v_message.message_type = 'broadcast'::public.message_type then
    null;
  else
    raise exception 'Message is not readable by this user';
  end if;

  insert into public.message_reads (
    message_id,
    user_id
  )
  values (
    p_message_id,
    v_actor_id
  )
  on conflict (message_id, user_id) do update
    set read_at = public.message_reads.read_at
  returning * into v_receipt;

  return jsonb_build_object('message_read', to_jsonb(v_receipt));
end;
$$;

create or replace function public.get_unread_message_count(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_unread_count bigint;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Company membership required';
  end if;

  select count(*)
  into v_unread_count
  from public.messages as message_row
  where message_row.company_id = p_company_id
    and (
      message_row.recipient_id = v_actor_id
      or message_row.message_type = 'broadcast'::public.message_type
    )
    and not exists (
      select 1
      from public.message_reads as receipt
      where receipt.message_id = message_row.id
        and receipt.user_id = v_actor_id
    );

  return jsonb_build_object('unread_count', v_unread_count);
end;
$$;

revoke all on function public.create_message_member(uuid, text, uuid, text, text) from public;
revoke all on function public.create_message_member(uuid, text, uuid, text, text) from anon;
revoke all on function public.create_message_member(uuid, text, uuid, text, text) from authenticated;
grant execute on function public.create_message_member(uuid, text, uuid, text, text) to authenticated;

revoke all on function public.get_message_mailbox(uuid) from public;
revoke all on function public.get_message_mailbox(uuid) from anon;
revoke all on function public.get_message_mailbox(uuid) from authenticated;
grant execute on function public.get_message_mailbox(uuid) to authenticated;

revoke all on function public.mark_message_read(uuid, uuid) from public;
revoke all on function public.mark_message_read(uuid, uuid) from anon;
revoke all on function public.mark_message_read(uuid, uuid) from authenticated;
grant execute on function public.mark_message_read(uuid, uuid) to authenticated;

revoke all on function public.get_unread_message_count(uuid) from public;
revoke all on function public.get_unread_message_count(uuid) from anon;
revoke all on function public.get_unread_message_count(uuid) from authenticated;
grant execute on function public.get_unread_message_count(uuid) to authenticated;
