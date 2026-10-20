-- Admin guide audit (docs/user-guide-audits/admin-guide-audit-2026-10-19.md),
-- Matt's decisions of 20 October 2026:
--
-- 1. Naming a team from its squad no longer wipes the team: it only changes
--    the athletes, coaches, managers and physios it was given. Athletes,
--    coaches and managers stay in the squad; a physio picked into the team
--    moves out of the squad (and back into it when picked for none of the
--    squad's teams), so a physio left in the squad keeps looking after the
--    athletes in its teams. A physio can be in several of a squad's teams,
--    and in other squads and teams. Guardians are never picked here.
--    The hierarchy holds after the squad's phase is complete too: a squad
--    physio keeps looking after the squad's athletes, so physio_looks_after
--    no longer ignores a squad whose phase is complete (this replaces the
--    19 October rule, physio audit A4; the Head Physio is unchanged).
-- 2. Guardians move with their athlete: when an athlete under 18 joins a
--    team, their approved guardians are placed in it too (as guardians), and
--    when the athlete leaves the team, or the guardian link ends, the
--    guardian's placement goes unless another of their children is still in
--    it. Squads are untouched: a guardian picks their child's squad at Join.
-- 3. Admins read every team's goals and comments: admin_team_games lists the
--    next and last game of every current squad and team for them, the way
--    coach_team_games does for coaches. Only coaches set, review or comment.
-- 4. Because guardians now sit in their child's team, a placement as a
--    guardian no longer puts someone in a group message's audience in their
--    own right: they get the one copy that names their child, as they do for
--    surveys (Matt, 19 October). Everyone else's copies are unchanged.
--
-- No rows are deleted or changed by this migration itself.

begin;

-- ---------------------------------------------------------------------------
-- 2. Guardians follow their athlete into and out of a team.
-- ---------------------------------------------------------------------------

-- Places the approved guardians of an athlete under 18 in a team alongside
-- them. A guardian already in the team in another role (a coach-parent) keeps
-- that role.
create or replace function public.place_guardians_with_athlete(p_team_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.kind = 'team') then
    return;
  end if;
  insert into public.team_members (team_id, profile_id, team_role)
  select p_team_id, g.guardian_id, 'guardian'
  from public.guardianships g
  join public.profiles child on child.id = g.athlete_id
  join public.profiles guardian on guardian.id = g.guardian_id
  where g.athlete_id = p_athlete_id
    and public.is_minor(child.date_of_birth, child.under_17)
    and guardian.status = 'approved'
    and 'guardian' = any (public.roles_of(guardian.role, guardian.extra_roles))
  on conflict (team_id, profile_id) do nothing;
end;
$$;
revoke execute on function public.place_guardians_with_athlete(uuid, uuid) from public, anon, authenticated;

-- Removes a guardian's placement in a team once none of their children is an
-- athlete in it. Only placements as a guardian go.
create or replace function public.remove_guardians_left_behind(p_team_id uuid, p_guardian_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_members m
  where m.team_id = p_team_id
    and m.team_role = 'guardian'
    and m.profile_id = any (p_guardian_ids)
    and not exists (
      select 1
      from public.guardianships g
      join public.team_members child on child.team_id = m.team_id
        and child.profile_id = g.athlete_id and child.team_role = 'athlete'
      where g.guardian_id = m.profile_id
    );
end;
$$;
revoke execute on function public.remove_guardians_left_behind(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.sync_guardian_team_placements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'team_members' then
    if tg_op = 'INSERT' and new.team_role = 'athlete' then
      perform public.place_guardians_with_athlete(new.team_id, new.profile_id);
    elsif tg_op = 'DELETE' and old.team_role = 'athlete' then
      perform public.remove_guardians_left_behind(
        old.team_id,
        (select coalesce(array_agg(guardian_id), '{}') from public.guardianships where athlete_id = old.profile_id)
      );
    elsif tg_op = 'DELETE' and old.team_role <> 'guardian' then
      -- A coach-parent taken off the team as a coach stays with their child
      -- as a guardian. Removing a guardian placement itself is left alone.
      perform public.place_guardians_with_athlete(old.team_id, g.athlete_id)
      from public.guardianships g
      join public.team_members child on child.team_id = old.team_id
        and child.profile_id = g.athlete_id and child.team_role = 'athlete'
      where g.guardian_id = old.profile_id;
    end if;
  elsif tg_table_name = 'guardianships' then
    if tg_op = 'INSERT' then
      perform public.place_guardians_with_athlete(m.team_id, new.athlete_id)
      from public.team_members m
      join public.teams t on t.id = m.team_id and t.kind = 'team' and not t.archived
      where m.profile_id = new.athlete_id and m.team_role = 'athlete';
    elsif tg_op = 'DELETE' then
      perform public.remove_guardians_left_behind(m.team_id, array[old.guardian_id])
      from public.team_members m
      join public.teams t on t.id = m.team_id and t.kind = 'team'
      where m.profile_id = old.athlete_id and m.team_role = 'athlete';
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.sync_guardian_team_placements() from public, anon, authenticated;

drop trigger if exists team_members_guardians_follow on public.team_members;
create trigger team_members_guardians_follow
  after insert or delete on public.team_members
  for each row execute function public.sync_guardian_team_placements();

drop trigger if exists guardianships_place_in_teams on public.guardianships;
create trigger guardianships_place_in_teams
  after insert or delete on public.guardianships
  for each row execute function public.sync_guardian_team_placements();

-- Guardians of the athletes already in this season's teams are placed with
-- them now, so every team starts under the rule. Nothing is removed.
select public.place_guardians_with_athlete(m.team_id, m.profile_id)
from public.team_members m
join public.teams t on t.id = m.team_id and t.kind = 'team' and not t.archived
where m.team_role = 'athlete';

-- ---------------------------------------------------------------------------
-- 1. Naming a team only touches the people it is given.
-- ---------------------------------------------------------------------------

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

    -- Guardians are placed with their athlete, never picked here.
    delete from public.team_members
    where team_id = p_team_id
      and team_role <> 'guardian'
      and not (profile_id::text in (select k ->> 'profile_id' from jsonb_array_elements(v_picks) as k));

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
    on conflict (team_id, profile_id) do update set
      team_role = excluded.team_role,
      coach_title = excluded.coach_title,
      selection = excluded.selection;
    return;
  end if;

  -- Everyone picked is in the squad, or a physio already moved into one of
  -- the squad's teams.
  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where not exists (
      select 1 from public.team_members sm
      join public.teams st on st.id = sm.team_id
      where sm.profile_id = (m ->> 'profile_id')::uuid
        and (sm.team_id = v_team.squad_id
          or (st.squad_id = v_team.squad_id and not st.archived and sm.team_role = 'physio'))
    )
  ) then
    raise exception 'Everyone in a team must be in its squad';
  end if;

  -- A physio no longer picked for any of the squad's teams goes back to the
  -- squad (Matt, 20 October: the squad placement only stays while they
  -- aren't moved into a team).
  insert into public.team_members (team_id, profile_id, team_role)
  select v_team.squad_id, tm.profile_id, 'physio'
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.team_role = 'physio'
    and not (tm.profile_id::text in (select m ->> 'profile_id' from jsonb_array_elements(p_members) as m))
    and not exists (
      select 1 from public.team_members o
      join public.teams ot on ot.id = o.team_id
      where o.profile_id = tm.profile_id and o.team_role = 'physio'
        and ot.squad_id = v_team.squad_id and not ot.archived and o.team_id <> p_team_id
    )
  on conflict (team_id, profile_id) do nothing;

  -- Athletes, coaches, managers and physios not picked leave the team.
  -- Guardians follow their athlete.
  delete from public.team_members
  where team_id = p_team_id
    and team_role in ('athlete', 'coach', 'manager', 'physio')
    and not (profile_id::text in (select m ->> 'profile_id' from jsonb_array_elements(p_members) as m));

  -- Their role in the team is the same as in the squad (or, for a physio
  -- moved in earlier, the one they already have).
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
  join lateral (
    select sm.profile_id, sm.team_role, sm.coach_title
    from public.team_members sm
    join public.teams st on st.id = sm.team_id
    where sm.profile_id = (m ->> 'profile_id')::uuid
      and (sm.team_id = v_team.squad_id
        or (st.squad_id = v_team.squad_id and not st.archived and sm.team_role = 'physio'))
    order by sm.team_id = v_team.squad_id desc
    limit 1
  ) sm on true
  where sm.team_role in ('athlete', 'coach', 'manager', 'physio')
  on conflict (team_id, profile_id) do update set
    team_role = excluded.team_role,
    coach_title = excluded.coach_title,
    selection = excluded.selection;

  -- A physio picked into the team moves out of the squad.
  delete from public.team_members sq
  where sq.team_id = v_team.squad_id
    and sq.team_role = 'physio'
    and exists (
      select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.profile_id = sq.profile_id and tm.team_role = 'physio'
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Admins read every team's goals.
-- ---------------------------------------------------------------------------

create or replace function public.admin_team_games()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  fixture_id uuid,
  is_next boolean,
  round_name text,
  opponent text,
  starts_at timestamptz,
  time_tbc boolean,
  goals_close_at timestamptz,
  played_at timestamptz,
  goal_count int,
  reviewed_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.kind::text, g.id, g.is_next, g.round_name, g.opponent, g.starts_at,
    g.time_tbc, public.fixture_goals_close_at(g.f), public.fixture_played_at(g.f),
    (select count(*)::int from public.team_game_goals x where x.fixture_id = g.id),
    (select count(*)::int from public.team_game_goals x
      where x.fixture_id = g.id and (x.outcome is not null or x.review is not null))
  from public.teams t
  cross join lateral (
    (select f, f.id, true as is_next, f.round_name, f.opponent, f.starts_at, f.time_tbc
     from public.fixtures f
     where f.team_id = t.id and f.opponent is not null
       and public.fixture_played_at(f) > now() and f.starts_at <= now() + interval '7 days'
     order by f.starts_at limit 1)
    union all
    (select f, f.id, false, f.round_name, f.opponent, f.starts_at, f.time_tbc
     from public.fixtures f
     where f.team_id = t.id and f.opponent is not null and public.fixture_played_at(f) <= now()
     order by f.starts_at desc limit 1)
  ) g
  where not t.archived
    and public.is_admin()
  order by t.kind, t.sort_order, t.name, g.is_next desc;
$$;
revoke execute on function public.admin_team_games() from public, anon;
grant execute on function public.admin_team_games() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A guardian's copy of a group message still names their child.
-- ---------------------------------------------------------------------------

create or replace function public.send_group_message(p_body text, p_audience public.message_audience, p_role public.app_role default null::public.app_role, p_team_id uuid default null::uuid)
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
        -- A placement as a guardian doesn't put someone in the audience in
        -- their own right: they get the copy that names their child, as for
        -- surveys (admin guide audit, 20 October: guardians are placed in a
        -- team with their athlete).
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
            and tm.team_role::text <> 'guardian'
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


-- ---------------------------------------------------------------------------
-- 5. A physio in a squad looks after its athletes whatever the squad's phase
--    (Matt, 20 October: "hierarchy"). Same signature as 20261019000000.
-- ---------------------------------------------------------------------------

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
      or exists (
        select 1 from public.team_members me
        join public.teams t on t.id = me.team_id
        join public.team_members a on a.team_id = me.team_id
        where me.profile_id = auth.uid() and me.team_role = 'physio' and not t.archived
          and a.profile_id = p_athlete_id and a.team_role = 'athlete'
      )
    );
$$;

commit;
