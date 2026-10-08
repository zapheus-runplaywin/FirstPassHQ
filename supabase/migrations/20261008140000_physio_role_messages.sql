-- Physios get messages sent to the Physio role.
--
-- Matt (2026-10-08): "physios are a role, so they should get messages sent
-- to their role." Admins can message all physios, and physios always see
-- those. Messages to the whole club still reach physios only when an admin
-- turns on "Physios get club messages". Guests still get no messages.
--
-- Additive only: two replaced functions. No rows change.

begin;

-- Same as before, plus messages to the Physio role reach physios.
create or replace function public.send_group_message(
  p_body text,
  p_audience public.message_audience,
  p_role public.app_role default null,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_sender public.profiles;
  v_team public.teams;
  v_message_id uuid;
  v_count int;
begin
  select * into v_sender from public.profiles where id = auth.uid();
  if v_sender.id is null or v_sender.status <> 'approved' then
    raise exception 'Only approved members can send messages';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Messages can be up to 4000 characters';
  end if;

  if p_audience = 'club' then
    -- is_committee() is true for admins too.
    if not public.is_committee() then
      raise exception 'Only admins and the committee can message the whole club';
    end if;
  elsif p_audience = 'role' then
    if not public.is_admin() then
      raise exception 'Only admins can message a role';
    end if;
    if p_role is null then
      raise exception 'Choose a role to message';
    end if;
    if p_role = 'guest' then
      raise exception 'Guests don''t get messages';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach or manage';
    end if;
  end if;

  insert into public.messages (
    sender_id, sender_name, body, audience, audience_role, team_id, audience_label
  )
  values (
    v_sender.id,
    coalesce(nullif(v_sender.full_name, ''), v_sender.email),
    v_body,
    p_audience,
    case when p_audience = 'role' then p_role end,
    v_team.id,
    v_team.name
  )
  returning id into v_message_id;

  with audience as (
    select p.id, p.role, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and (not public.is_view_only_role(p.role)
        or (p.role = 'physio' and (p_audience = 'role'
          or (p_audience = 'club' and public.physios_get_club_messages()))))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
        )
      end
  )
  insert into public.message_recipients (message_id, profile_id)
  select v_message_id, r.id
  from (
    select a.id from audience a
    union
    -- Guardians of children who received it.
    select g.guardian_id
    from audience a
    join public.guardianships g on g.athlete_id = a.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where a.role = 'athlete' and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  return v_message_id;
end;
$$;

revoke execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  from public, anon;
grant execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid)
  to authenticated;

-- Same as before: physios also see messages sent to their role.
create or replace function public.is_message_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.message_recipients
    where message_id = p_message_id and profile_id = auth.uid()
  ) and not exists (
    -- Guests never see messages, including ones from before. Physios see
    -- messages to their role, and whole-club messages only while admins send
    -- them those.
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'guest' or (
        role = 'physio'
        and not public.physios_get_club_messages()
        and not exists (
          select 1 from public.messages m
          where m.id = p_message_id and m.audience = 'role' and m.audience_role = 'physio'
        )
      ))
  );
$$;

revoke execute on function public.is_message_recipient(uuid) from public, anon;
grant execute on function public.is_message_recipient(uuid) to authenticated;

commit;
