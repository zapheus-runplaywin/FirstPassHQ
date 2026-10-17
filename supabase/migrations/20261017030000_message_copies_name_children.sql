-- A parent or guardian's copy of a message now says which of their children
-- it's for (Matt, 17 October 2026). A parent with two children in the same
-- team still gets one copy, naming both. A copy sent because their child
-- sent the message (as a captain) names that child.
--
-- Adds two nullable columns to message_recipients and replaces
-- send_group_message. Existing rows are not changed; their columns stay
-- empty, and the app shows them as before.

begin;

alter table public.message_recipients
  add column if not exists for_children uuid[],
  add column if not exists for_child_names text[];

comment on column public.message_recipients.for_children is
  'For a guardian''s copy: the children it was sent for. Null when the message is the recipient''s own.';
comment on column public.message_recipients.for_child_names is
  'The names of for_children when the message was sent, in the same order.';

CREATE OR REPLACE FUNCTION public.send_group_message(p_body text, p_audience message_audience, p_role app_role DEFAULT NULL::app_role, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if not (public.is_committee() or public.is_club_captain()) then
      raise exception 'Only admins, the committee and club captains can message the whole club';
    end if;
  elsif p_audience = 'role' then
    if not public.is_admin() then
      raise exception 'Only admins can message a role';
    end if;
    if p_role is null then
      raise exception 'Choose a role to message';
    end if;
    if p_role in ('guest', 'volunteer') then
      raise exception 'Guests and temporary helpers don''t get messages';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach, manage or captain';
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
    select p.id, p.role, p.extra_roles, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and p.role not in ('guest', 'volunteer')
      and (not public.is_view_only_member(p.role, p.extra_roles)
        or p_audience = 'role'
        or p_audience = 'group'
        or (p_audience = 'club' and public.physios_get_club_messages()))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role or p_role = any (p.extra_roles)
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
        )
      end
  )
  -- A guardian's copy names the children it's for. A member who is in the
  -- audience themselves has no children named, since the message is theirs.
  insert into public.message_recipients (message_id, profile_id, for_children, for_child_names)
  select
    v_message_id,
    r.id,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_id order by r.child_name, r.child_id) end,
    case when bool_or(r.child_id is null) then null
      else array_agg(r.child_name order by r.child_name, r.child_id) end
  from (
    select a.id, null::uuid as child_id, null::text as child_name from audience a
    union all
    -- Guardians of children who received it.
    select g.guardian_id, a.id, public.member_display_name(a.id)
    from audience a
    join public.guardianships g on g.athlete_id = a.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where (a.role = 'athlete' or 'athlete' = any (a.extra_roles))
      and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id
  group by r.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Guardians of a child who sends a message (a captain or junior coach) get a copy too.
  if (v_sender.role = 'athlete' or 'athlete' = any (v_sender.extra_roles))
     and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
    insert into public.message_recipients (message_id, profile_id, for_children, for_child_names)
    select v_message_id, g.guardian_id, array[v_sender.id], array[public.member_display_name(v_sender.id)]
    from public.guardianships g
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where g.athlete_id = v_sender.id
    on conflict (message_id, profile_id) do update
      set for_children = public.message_recipients.for_children || excluded.for_children,
          for_child_names = public.message_recipients.for_child_names || excluded.for_child_names
      -- A guardian who got it in their own right keeps no children named, and
      -- a child already named isn't named twice.
      where public.message_recipients.for_children is not null
        and not (v_sender.id = any (public.message_recipients.for_children));
  end if;

  return v_message_id;
end;
$function$;

revoke execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid) from public, anon;
grant execute on function public.send_group_message(text, public.message_audience, public.app_role, uuid) to authenticated;

commit;
