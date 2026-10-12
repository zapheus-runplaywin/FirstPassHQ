-- Team physios and the Head Physio.
--
-- Matt (2026-10-12): "Allow physio to be assigned to teams also. Some clubs
-- have a Physio per team (one or more or all teams). Allow the ability to
-- identify a head Physio will oversee all teams regardless of whether they
-- are in a team or not."
--
-- - Admins can place physios in squads and teams, like coaches and managers.
--   They show on the roster as Physio.
-- - A physio placed in squads or teams looks after the athletes in them: they
--   see those athletes' injuries and endorse (or send back) their clearances.
-- - A Head Physio looks after every athlete, in a team or not. Admins mark a
--   physio as Head Physio on their member page.
-- - A physio who isn't in any squad or team keeps looking after every athlete,
--   as before, so clubs with one physio don't need to change anything.
-- - Physios in a squad or team get messages sent to it.
--
-- Additive only: one new column (default off), new functions and replaced
-- functions. No rows change.

begin;

alter table public.profiles
  add column if not exists head_physio boolean not null default false;

-- True for a signed-in physio marked as Head Physio.
create or replace function public.is_head_physio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_physio() and exists (
    select 1 from public.profiles where id = auth.uid() and head_physio
  );
$$;
revoke execute on function public.is_head_physio() from public, anon;
grant execute on function public.is_head_physio() to authenticated;

-- True when the signed-in physio looks after this current athlete: a Head
-- Physio or a physio in no squad or team looks after everyone, and any other
-- physio looks after the athletes in their squads and teams.
create or replace function public.physio_looks_after(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_physio()
    and exists (select 1 from public.profiles where id = p_athlete_id)
    and (
      public.is_head_physio()
      or not exists (
        select 1 from public.team_members me
        join public.teams t on t.id = me.team_id
        where me.profile_id = auth.uid() and me.team_role = 'physio' and not t.archived
      )
      or exists (
        select 1 from public.team_members me
        join public.teams t on t.id = me.team_id
        join public.team_members a on a.team_id = me.team_id
        where me.profile_id = auth.uid() and me.team_role = 'physio' and not t.archived
          and a.profile_id = p_athlete_id and a.team_role = 'athlete'
      )
    );
$$;
revoke execute on function public.physio_looks_after(uuid) from public, anon;
grant execute on function public.physio_looks_after(uuid) to authenticated;

-- Admins mark a physio as Head Physio, or take it away.
create or replace function public.admin_set_head_physio(p_profile_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if coalesce(p_on, false)
     and not 'physio' = any (public.roles_of(v_member.role, v_member.extra_roles)) then
    raise exception 'Only physios can be Head Physio';
  end if;
  update public.profiles set head_physio = coalesce(p_on, false) where id = p_profile_id;
end;
$$;
revoke execute on function public.admin_set_head_physio(uuid, boolean) from public, anon;
grant execute on function public.admin_set_head_physio(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The functions below are as before, with physios in squads and teams.
-- ---------------------------------------------------------------------------

create or replace function public.can_view_athlete_injuries(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or public.coaches_athlete(p_athlete_id)
    or public.is_committee()
    -- Physios see current athletes they look after; records kept after
    -- someone leaves stay with the committee and admins.
    or public.physio_looks_after(p_athlete_id)
  );
$$;

create or replace function public.endorse_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null
    or not (public.coaches_athlete(v_injury.athlete_id)
      or public.physio_looks_after(v_injury.athlete_id)) then
    raise exception 'Only the athlete’s coaches or a physio can endorse clearance';
  end if;
  if v_injury.status <> 'clearance_requested' then
    raise exception 'This injury isn’t waiting for a coach or physio';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t endorse your own clearance';
  end if;
  if public.is_guardian_of(v_injury.athlete_id) then
    raise exception 'You can’t endorse your own child’s clearance. Ask another coach or a physio.';
  end if;

  update public.injuries
  set status = 'coach_endorsed', coach_endorsed_by = auth.uid(), coach_endorsed_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'coach_endorsed', nullif(trim(p_notes), '')
  );
end;
$$;

create or replace function public.send_back_clearance(p_injury_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null then
    raise exception 'Injury not found';
  end if;
  if not (
    (v_injury.status = 'clearance_requested'
      and (public.coaches_athlete(v_injury.athlete_id) or public.is_committee()
        or public.physio_looks_after(v_injury.athlete_id)))
    or (v_injury.status = 'coach_endorsed' and public.is_committee())
  ) then
    raise exception 'You can’t send this back';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t send back your own clearance';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Say why it’s being sent back';
  end if;

  update public.injuries
  set status = 'injured', coach_endorsed_by = null, coach_endorsed_at = null
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (p_injury_id, auth.uid(), public.my_display_name(), 'sent_back', trim(p_notes));
end;
$$;

create or replace function public.visible_injuries(
  p_include_cleared boolean default false,
  p_injury_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text,
  description text,
  injured_on date,
  restrictions text,
  expected_return date,
  status public.injury_status,
  coach_endorsed_by uuid,
  cleared_at timestamptz,
  created_at timestamptz,
  last_update_at timestamptz,
  can_report boolean,
  waiting_for_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.athlete_id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    i.body_area,
    i.description, i.injured_on, i.restrictions, i.expected_return, i.status,
    i.coach_endorsed_by, i.cleared_at, i.created_at,
    (select max(u.created_at) from public.injury_updates u where u.injury_id = i.id),
    public.can_report_for(i.athlete_id),
    i.athlete_left_at is null and i.athlete_id <> auth.uid()
      and not public.is_guardian_of(i.athlete_id) and (
      (i.status = 'clearance_requested'
        and (public.coaches_athlete(i.athlete_id) or public.physio_looks_after(i.athlete_id)))
      or (i.status = 'coach_endorsed' and public.is_committee()
        and i.coach_endorsed_by is distinct from auth.uid())
    )
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  where public.can_view_athlete_injuries(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_include_cleared or i.athlete_left_at is null or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;

create or replace function public.team_roster(p_team_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  team_role public.team_role,
  coach_title public.coach_title,
  selection public.team_selection
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id, p.full_name, tm.team_role, tm.coach_title, tm.selection
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
    and p.status = 'approved'
    and tm.team_role::text <> 'guardian'
    and (public.is_team_member(p_team_id) or public.is_admin())
  order by
    case tm.team_role::text when 'coach' then 0 when 'manager' then 1 when 'physio' then 2 else 3 end,
    case tm.coach_title when 'head_coach' then 0 else 1 end,
    case tm.selection when 'touring' then 0 when 'training_partner' then 1 else 2 end,
    p.full_name;
$$;

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
    -- Guests never see messages, including ones from before. Members who are
    -- only physios see messages to their role, and whole-club messages only
    -- while admins send them those.
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'guest' or (
        public.is_view_only_member(role, extra_roles)
        and not public.physios_get_club_messages()
        and not exists (
          select 1 from public.messages m
          where m.id = p_message_id
            and ((m.audience = 'role' and m.audience_role = 'physio')
              -- Physios in a squad or team get its messages.
              or m.audience = 'group')
        )
      ))
  );
$$;

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
    if p_role = 'guest' then
      raise exception 'Guests don''t get messages';
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
      and p.role <> 'guest'
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
    where (a.role = 'athlete' or 'athlete' = any (a.extra_roles))
      and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Guardians of a child who sends a message (a captain or junior coach) get a copy too.
  if (v_sender.role = 'athlete' or 'athlete' = any (v_sender.extra_roles))
     and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
    insert into public.message_recipients (message_id, profile_id)
    select v_message_id, g.guardian_id
    from public.guardianships g
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where g.athlete_id = v_sender.id
    on conflict (message_id, profile_id) do nothing;
  end if;

  return v_message_id;
end;
$$;

create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null,
  p_extra_roles public.app_role[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles public.app_role[] := public.roles_of(p_role, coalesce(p_extra_roles, '{}'));
  v_extra public.app_role[];
  v_default_team_role public.team_role;
  v_placements jsonb;
  v_date_of_birth date;
  v_under_17 boolean;
  v_problem text;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
  v_was_committee boolean;
  v_exempt_reason text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  v_extra := v_roles[2:];
  select
    date_of_birth,
    status = 'approved' and 'committee' = any (public.roles_of(role, extra_roles)),
    wwcc_exempt_reason
  into v_date_of_birth, v_was_committee, v_exempt_reason
  from public.profiles where id = p_profile_id;
  v_under_17 := 'athlete' = any (v_roles) and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (not 'admin' = any (v_roles) or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  v_problem := public.role_combination_problem(v_roles, v_date_of_birth, p_under_17);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 18 have guardians';
  end if;
  if p_profile_id = any (v_guardian_ids) then
    raise exception 'A member cannot be their own guardian';
  end if;
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    where not exists (
      select 1 from public.profiles p
      where p.id = g.id and p.status = 'approved'
        and (p.role = 'guardian' or 'guardian' = any (p.extra_roles))
    )
  ) then
    raise exception 'Guardians must be approved members with the Guardian role';
  end if;
  -- Links that already exist are kept; new ones need a verified guardian.
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    join public.profiles p on p.id = g.id
    where p.verified_at is null
      and not exists (
        select 1 from public.guardianships l
        where l.guardian_id = g.id and l.athlete_id = p_profile_id
      )
  ) then
    raise exception 'Verify a guardian (code in person, or checked against PlayHQ) before linking them to a child';
  end if;
  if p_status = 'approved' and v_under_17 and cardinality(v_guardian_ids) = 0 then
    raise exception 'Link at least one verified guardian before approving an athlete under 18';
  end if;
  if p_status = 'approved' and v_roles && array['coach', 'manager', 'physio']::public.app_role[]
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check before approving a coach, manager or physio';
  end if;
  -- Committee members approved before checks were needed keep their access;
  -- the admin's to-do list asks for their check instead.
  if p_status = 'approved' and 'committee' = any (v_roles) and not coalesce(v_was_committee, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check, or exempt them with a reason, before making them a committee member';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_teams) as t
    where not exists (
      select 1 from public.teams g where g.id = (t ->> 'team_id')::uuid and not g.archived
    )
  ) then
    raise exception 'Members can only be added to this season''s squads and teams';
  end if;

  update public.profiles
  set role = p_role,
      extra_roles = v_extra,
      status = p_status,
      under_17 = v_under_17,
      rejection_reason = case when p_status = 'rejected' then p_rejection_reason end
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Guardian links: replace this athlete's guardians, and drop links from
  -- anyone who is no longer an approved guardian.
  delete from public.guardianships where athlete_id = p_profile_id;
  if not 'guardian' = any (v_roles) or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  if p_status = 'approved' then
    insert into public.guardianships (guardian_id, athlete_id)
    select distinct g.id, p_profile_id from unnest(v_guardian_ids) as g (id);
  end if;

  delete from public.team_members m
  using public.teams g
  where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;

  select r::text::public.team_role into v_default_team_role
  from unnest(v_roles) with ordinality as x (r, n)
  where r in ('coach', 'manager', 'athlete', 'guardian', 'physio')
  order by n
  limit 1;
  if v_default_team_role is null then
    raise exception 'Only coaches, managers, physios, athletes and guardians can be added to a squad or team';
  end if;

  -- Each placement with its group's kind and squad, and the role it's in.
  select coalesce(jsonb_agg(t || jsonb_build_object(
    'team_role', coalesce(t ->> 'team_role', v_default_team_role::text),
    'kind', g.kind,
    'squad_id', g.squad_id
  )), '[]'::jsonb)
  into v_placements
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;

  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where not (p ->> 'team_role')::public.app_role = any (v_roles)
       or p ->> 'team_role' not in ('coach', 'manager', 'athlete', 'guardian', 'physio')
  ) then
    raise exception 'Give them that role before adding them to a squad or team with it';
  end if;

  -- A team named from a squad needs its members in the squad too, in the same role.
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where p ->> 'squad_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_placements) as s
        where s ->> 'team_id' = p ->> 'squad_id'
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    join jsonb_array_elements(v_placements) as s on s ->> 'team_id' = p ->> 'squad_id'
    where p ->> 'team_role' <> s ->> 'team_role'
  ) then
    raise exception 'Their role in a team must match their role in its squad';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    (p ->> 'team_id')::uuid,
    p_profile_id,
    (p ->> 'team_role')::public.team_role,
    case when p ->> 'team_role' = 'coach'
      then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
      then coalesce((p ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(v_placements) as p;
end;
$$;

create or replace function public.admin_place_members(p_squad_id uuid, p_profile_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.teams;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can place members';
  end if;
  select * into v_group
  from public.teams where id = p_squad_id and squad_id is null and not archived;
  if v_group.id is null then
    raise exception 'Squad or team not found';
  end if;

  with people as (
    select
      p.id,
      -- The role they had last season, or their main role.
      coalesce((
        select m.team_role from public.team_members m
        join public.teams t on t.id = m.team_id
        where m.profile_id = p.id
          and m.team_role::text::public.app_role = any (public.roles_of(p.role, p.extra_roles))
        order by t.season desc, (m.team_role = 'athlete') desc
        limit 1
      ), case when p.role in ('coach', 'manager', 'athlete', 'guardian', 'physio')
        then p.role::text::public.team_role end) as team_role
    from public.profiles p
    where p.id = any (coalesce(p_profile_ids, '{}'))
      and p.status = 'approved'
  )
  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    p_squad_id,
    pp.id,
    pp.team_role,
    case when pp.team_role = 'coach' then coalesce((
      select m.coach_title from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.profile_id = pp.id and m.coach_title is not null
      order by t.season desc
      limit 1
    ), 'head_coach') end,
    case when pp.team_role = 'athlete' and v_group.kind = 'team' then coalesce((
      select m.selection from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.profile_id = pp.id and m.selection is not null
      order by t.season desc
      limit 1
    ), 'touring') end
  from people pp
  where pp.team_role is not null
  on conflict (team_id, profile_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_set_team_members(p_team_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_picks jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can name teams';
  end if;
  select * into v_team from public.teams where id = p_team_id and kind = 'team';
  if v_team.id is null then
    raise exception 'Team not found';
  end if;
  if jsonb_typeof(p_members) <> 'array' then
    raise exception 'p_members must be a JSON array';
  end if;

  if v_team.squad_id is null then
    if v_team.archived then
      raise exception 'Team not found';
    end if;

    -- Each pick with the role they're in the team as: the one asked for, or
    -- their first role that belongs in a team.
    select coalesce(jsonb_agg(m || jsonb_build_object(
      'team_role', coalesce(m ->> 'team_role', (
        select r::text
        from unnest(public.roles_of(p.role, p.extra_roles)) with ordinality as x (r, n)
        where r in ('coach', 'manager', 'athlete', 'physio')
        order by n
        limit 1
      )),
      'roles', to_jsonb(public.roles_of(p.role, p.extra_roles)),
      'approved', p.status = 'approved'
    )), '[]'::jsonb)
    into v_picks
    from jsonb_array_elements(p_members) as m
    left join public.profiles p on p.id = (m ->> 'profile_id')::uuid;

    if exists (
      select 1 from jsonb_array_elements(v_picks) as k
      where not coalesce((k ->> 'approved')::boolean, false)
        or coalesce(k ->> 'team_role', '') not in ('coach', 'manager', 'athlete', 'physio')
        or not (k -> 'roles') ? (k ->> 'team_role')
    ) then
      raise exception 'Only approved coaches, managers, physios and athletes can be in a team';
    end if;

    delete from public.team_members where team_id = p_team_id and team_role <> 'guardian';

    insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
    select
      p_team_id,
      (k ->> 'profile_id')::uuid,
      (k ->> 'team_role')::public.team_role,
      case when k ->> 'team_role' = 'coach'
        then coalesce((k ->> 'coach_title')::public.coach_title, 'head_coach')
      end,
      case when k ->> 'team_role' = 'athlete'
        then coalesce((k ->> 'selection')::public.team_selection, 'touring')
      end
    from jsonb_array_elements(v_picks) as k
    on conflict (team_id, profile_id) do nothing;
    return;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where not exists (
      select 1 from public.team_members sm
      where sm.team_id = v_team.squad_id and sm.profile_id = (m ->> 'profile_id')::uuid
    )
  ) then
    raise exception 'Everyone in a team must be in its squad';
  end if;

  delete from public.team_members where team_id = p_team_id;

  -- Their role in the team is the same as in the squad.
  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    p_team_id,
    sm.profile_id,
    sm.team_role,
    case when sm.team_role = 'coach'
      then coalesce((m ->> 'coach_title')::public.coach_title, sm.coach_title, 'head_coach')
    end,
    case when sm.team_role = 'athlete'
      then coalesce((m ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_members) as m
  join public.team_members sm
    on sm.team_id = v_team.squad_id and sm.profile_id = (m ->> 'profile_id')::uuid;
end;
$$;

commit;
