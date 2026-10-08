-- Committee members can send a message to the whole club.
--
-- Only admins can still message a single role. Committee members who also
-- coach or manage a squad or team can message it, as before.
--
-- Additive only: send_group_message is replaced. No rows are changed.

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
