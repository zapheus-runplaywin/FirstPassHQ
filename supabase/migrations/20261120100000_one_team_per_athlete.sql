-- One team per athlete, captains per team (Matt, 20 November 2026).
--
-- 1. An athlete is in at most one current team and at most one current squad
--    in a season. Naming a team used to list everyone in the squad on every
--    team's screen, so the same athletes could be picked for each team. The
--    rule is now checked on every save, whichever screen or function saves.
--    Rows already in the database are left as they are (the data checks found
--    none on the live or test projects on 20 November 2026); saving such a
--    person again is refused until they are in one team.
-- 2. Picking an athlete for a team on the team screen moves them there from
--    another of the season's teams, and the screen says so before saving.
-- 3. Captains and vice captains are chosen for teams, not squads. Squad
--    captains already chosen are kept but no longer count.
-- Coaches, managers and physios may still be in more than one team.
--
-- Nothing here deletes or changes existing rows when the migration runs.

begin;

-- ---------------------------------------------------------------------------
-- 1. The rule, on every save to team_members
-- ---------------------------------------------------------------------------

-- The other current group of the same kind and season an athlete is in, if
-- any. Archived groups (past seasons, removed groups) don't count.
create or replace function public.athlete_other_group(
  p_profile_id uuid,
  p_team_id uuid
)
returns public.teams
language sql
stable
security definer
set search_path = ''
as $$
  select o.*
  from public.teams g
  join public.team_members m on m.profile_id = p_profile_id and m.team_role = 'athlete'
  join public.teams o on o.id = m.team_id
  where g.id = p_team_id
    and o.id <> g.id
    and o.kind = g.kind
    and o.season = g.season
    and not o.archived
  order by o.sort_order, o.name
  limit 1;
$$;

revoke execute on function public.athlete_other_group(uuid, uuid) from public, anon, authenticated;

create or replace function public.check_one_group_per_athlete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.teams;
  v_other public.teams;
  v_name text;
begin
  if new.team_role <> 'athlete' then
    return null;
  end if;
  select * into v_group from public.teams where id = new.team_id;
  if v_group.archived then
    return null;
  end if;
  -- Two saves at once for the same athlete take turns, so both can't pass.
  perform pg_advisory_xact_lock(hashtext('one_group_per_athlete'), hashtext(new.profile_id::text));
  v_other := public.athlete_other_group(new.profile_id, new.team_id);
  if v_other.id is not null then
    select coalesce(nullif(preferred_name, ''), full_name, email, 'This athlete')
    into v_name from public.profiles where id = new.profile_id;
    raise exception '% is already in %. An athlete can be in only one % at a time.',
      v_name, v_other.name, v_group.kind
      using errcode = '23505';
  end if;
  return null;
end;
$$;

revoke execute on function public.check_one_group_per_athlete() from public, anon, authenticated;

drop trigger if exists team_members_one_group_per_athlete on public.team_members;
-- After the row is written, so access rules refuse a member who may not
-- save it before this check says anything about who is in which group.
create trigger team_members_one_group_per_athlete
  after insert or update of team_id, profile_id, team_role on public.team_members
  for each row execute function public.check_one_group_per_athlete();

-- Bringing back a removed group, or moving a group to another season, can't
-- give its athletes a second current group either.
create or replace function public.check_one_group_per_athlete_on_restore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_other public.teams;
  v_name text;
begin
  if new.archived or not (old.archived or new.season <> old.season or new.kind <> old.kind) then
    return new;
  end if;
  for v_profile in
    select profile_id from public.team_members where team_id = new.id and team_role = 'athlete'
  loop
    select o.* into v_other
    from public.team_members m
    join public.teams o on o.id = m.team_id
    where m.profile_id = v_profile and m.team_role = 'athlete'
      and o.id <> new.id and o.kind = new.kind and o.season = new.season and not o.archived
    limit 1;
    if v_other.id is not null then
      select coalesce(nullif(preferred_name, ''), full_name, email, 'An athlete')
      into v_name from public.profiles where id = v_profile;
      raise exception '% is in % now. Take them out of one of them first: an athlete can be in only one % at a time.',
        v_name, v_other.name, new.kind
        using errcode = '23505';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.check_one_group_per_athlete_on_restore() from public, anon, authenticated;

drop trigger if exists teams_one_group_per_athlete on public.teams;
create trigger teams_one_group_per_athlete
  before update of archived, season, kind on public.teams
  for each row execute function public.check_one_group_per_athlete_on_restore();

-- ---------------------------------------------------------------------------
-- 2. Naming a team moves the athletes picked for it
-- ---------------------------------------------------------------------------

-- For the team screen: the season's other current team each athlete is in.
create or replace function public.athletes_in_other_teams(p_team_id uuid)
returns table (profile_id uuid, team_id uuid, team_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id, o.id, o.name
  from public.teams g
  join public.teams o
    on o.kind = 'team' and o.season = g.season and not o.archived and o.id <> g.id
  join public.team_members m on m.team_id = o.id and m.team_role = 'athlete'
  where g.id = p_team_id and g.kind = 'team'
    and public.is_admin();
$$;

revoke execute on function public.athletes_in_other_teams(uuid) from public, anon;
grant execute on function public.athletes_in_other_teams(uuid) to authenticated;

-- Same as before (20261020000000_admin_guide_audit.sql), but an athlete
-- picked here first leaves any other team of the season, with their
-- captaincy there.
create or replace function public.admin_set_team_members(p_team_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_picks jsonb;
  v_athletes uuid[];
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
  if v_team.archived then
    raise exception 'Team not found';
  end if;

  -- Athletes picked here leave the season's other teams first, with any
  -- captaincy there. In a squad's team, they are the squad's athletes;
  -- without a squad, people picked as athletes.
  select coalesce(array_agg(distinct p.id), '{}') into v_athletes
  from jsonb_array_elements(p_members) as x
  join public.profiles p on p.id::text = x ->> 'profile_id'
  where case
    when v_team.squad_id is not null then exists (
      select 1 from public.team_members sm
      where sm.team_id = v_team.squad_id and sm.profile_id = p.id and sm.team_role = 'athlete'
    )
    else coalesce(x ->> 'team_role', (
      select r::text
      from unnest(public.roles_of(p.role, p.extra_roles)) with ordinality as y (r, n)
      where r in ('coach', 'manager', 'athlete', 'physio')
      order by n
      limit 1
    )) = 'athlete'
  end;

  delete from public.team_captains c
  using public.teams o
  where o.id = c.team_id and o.kind = 'team' and o.season = v_team.season
    and not o.archived and o.id <> p_team_id
    and c.profile_id = any (v_athletes);
  delete from public.team_members m
  using public.teams o
  where o.id = m.team_id and o.kind = 'team' and o.season = v_team.season
    and not o.archived and o.id <> p_team_id
    and m.team_role = 'athlete'
    and m.profile_id = any (v_athletes);

  if v_team.squad_id is null then
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

revoke execute on function public.admin_set_team_members(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_team_members(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Captains are chosen for teams
-- ---------------------------------------------------------------------------

create or replace function public.check_captains_in_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.teams where id = new.team_id and kind = 'squad') then
    raise exception 'Captains are chosen for a team, not a squad. Choose them from the team''s page.';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_captains_in_teams() from public, anon, authenticated;

drop trigger if exists team_captains_in_teams on public.team_captains;
create trigger team_captains_in_teams
  before insert or update of team_id on public.team_captains
  for each row execute function public.check_captains_in_teams();

-- Same as 20261101000000_parent_link_codes.sql, plus: only a team's captains
-- count. A squad captain chosen before today keeps the row but not the role.
create or replace function public.is_group_captain(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_captains tc
    join public.team_members tm
      on tm.team_id = tc.team_id and tm.profile_id = tc.profile_id and tm.team_role = 'athlete'
    join public.profiles p on p.id = tc.profile_id
    join public.teams t on t.id = tc.team_id
    where tc.team_id = p_team_id
      and tc.profile_id = auth.uid()
      and p.status = 'approved'
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
      and not t.archived
      and t.kind = 'team'
  );
$$;

commit;
