-- Squads are optional.
--
-- Some clubs select straight into teams, with final team athletes and
-- training partners from the start. Club settings now has a Squads switch,
-- stored like the feature switches: `club_settings.features` gets
-- "squads": false when a club doesn't use them. Clubs that already use squads
-- see no change.
--
-- Without squads, teams stand on their own (no squad_id). Members join a
-- team, admins pick its athletes from the whole club, and each new season
-- copies the teams. Nothing here changes or removes existing rows.

begin;

-- ---------------------------------------------------------------------------
-- Whether the club uses squads
-- ---------------------------------------------------------------------------

create or replace function public.club_uses_squads()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (s.features ->> 'squads')::boolean is distinct from false
    from public.club_settings s
    limit 1
  ), true);
$$;

revoke execute on function public.club_uses_squads() from public, anon;
grant execute on function public.club_uses_squads() to authenticated;

-- ---------------------------------------------------------------------------
-- Teams no longer need a squad. Squads still can't belong to one.
-- ---------------------------------------------------------------------------

alter table public.teams drop constraint if exists teams_belong_to_a_squad;
alter table public.teams drop constraint if exists teams_squad_parent;
alter table public.teams add constraint teams_squad_parent
  check (kind = 'team' or squad_id is null);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

-- Same as before, except a team without a squad can be joined directly.
create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
  v_date_of_birth date;
  v_under_17 boolean;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  select date_of_birth into v_date_of_birth from public.profiles where id = p_profile_id;
  v_under_17 := p_role = 'athlete' and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
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
      where p.id = g.id and p.role = 'guardian' and p.status = 'approved'
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
  if p_status = 'approved' and p_role in ('coach', 'manager', 'physio')
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check before approving a coach, manager or physio';
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
  if p_role <> 'guardian' or p_status <> 'approved' then
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
  if p_role not in ('coach', 'manager', 'athlete', 'guardian') then
    raise exception 'Only coaches, managers, athletes and guardians can be added to a squad or team';
  end if;
  v_team_role := p_role::text::public.team_role;

  -- A team named from a squad needs its members in the squad too.
  if exists (
    select 1
    from jsonb_array_elements(p_teams) as t
    join public.teams g on g.id = (t ->> 'team_id')::uuid
    where g.squad_id is not null
      and not exists (
        select 1 from jsonb_array_elements(p_teams) as s
        where (s ->> 'team_id')::uuid = g.squad_id
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    g.id,
    p_profile_id,
    v_team_role,
    case when p_role = 'coach'
      then coalesce((t ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p_role = 'athlete' and g.kind = 'team'
      then coalesce((t ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;
end;
$$;

-- Naming a team. A team from a squad picks from the squad as before; a team
-- without one picks its coaches, managers and athletes from the whole club.
-- Guardians are added from their member page, so saving keeps them.
create or replace function public.admin_set_team_members(p_team_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
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
    if exists (
      select 1 from jsonb_array_elements(p_members) as m
      where not exists (
        select 1 from public.profiles p
        where p.id = (m ->> 'profile_id')::uuid
          and p.status = 'approved'
          and p.role in ('coach', 'manager', 'athlete')
      )
    ) then
      raise exception 'Only approved coaches, managers and athletes can be in a team';
    end if;

    delete from public.team_members where team_id = p_team_id and team_role <> 'guardian';

    insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
    select
      p_team_id,
      p.id,
      p.role::text::public.team_role,
      case when p.role = 'coach'
        then coalesce((m ->> 'coach_title')::public.coach_title, 'head_coach')
      end,
      case when p.role = 'athlete'
        then coalesce((m ->> 'selection')::public.team_selection, 'touring')
      end
    from jsonb_array_elements(p_members) as m
    join public.profiles p on p.id = (m ->> 'profile_id')::uuid
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

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

-- A new season copies last season's squads (and any teams without a squad),
-- or, for a club without squads, all of last season's teams. Teams named
-- from a squad are still named again at selections.
create or replace function public.admin_start_season(p_season int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from int;
  v_count int;
  v_squads boolean := public.club_uses_squads();
begin
  if not public.is_admin() then
    raise exception 'Only admins can start a season';
  end if;
  select max(season) into v_from from public.teams where not archived;
  if v_from is null then
    raise exception 'There are no squads or teams to copy';
  end if;
  if p_season is distinct from v_from + 1 then
    raise exception 'The next season is %', v_from + 1;
  end if;

  insert into public.teams (name, sort_order, kind, season)
  select name, sort_order, case when v_squads then kind else 'team' end, p_season
  from public.teams
  where season = v_from and not archived
    and (case when v_squads then squad_id is null else kind = 'team' end)
  on conflict (season, name) do nothing;
  get diagnostics v_count = row_count;

  insert into public.calendars (name, url, team_id, committee_only, color)
  select c.name, c.url, new_group.id, false, c.color
  from public.calendars c
  join public.teams old_group on old_group.id = c.team_id
    and old_group.season = v_from and not old_group.archived
    and (case when v_squads then old_group.squad_id is null else old_group.kind = 'team' end)
  join public.teams new_group on new_group.season = p_season
    and new_group.squad_id is null and new_group.name = old_group.name
  where not exists (
    select 1 from public.calendars e where e.team_id = new_group.id and e.url = c.url
  );

  return v_count;
end;
$$;

-- Last season's members not yet in one of the new season's squads (or teams
-- without a squad). Each is shown once, under a group of the same kind as the
-- one being filled when they had one.
create or replace function public.returning_members(p_squad_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  role public.app_role,
  last_squad_id uuid,
  last_squad_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select season, kind from public.teams where id = p_squad_id and squad_id is null
  )
  select distinct on (p.id)
    p.id, coalesce(nullif(p.full_name, ''), p.email), p.role, old_group.id, old_group.name
  from target
  join public.teams old_group on old_group.season = target.season - 1
  join public.team_members m on m.team_id = old_group.id
  join public.profiles p on p.id = m.profile_id and p.status = 'approved'
    and p.role in ('coach', 'manager', 'athlete', 'guardian')
  where public.is_admin()
    and not exists (
      select 1 from public.team_members now_in
      join public.teams s on s.id = now_in.team_id
      where now_in.profile_id = p.id and s.season = target.season and s.squad_id is null
    )
  order by p.id, (old_group.kind = target.kind) desc, old_group.sort_order;
$$;

-- Places returning members in a squad, or in a team without a squad. Athletes
-- placed in a team keep how they were selected last time (final team unless
-- they were a training partner).
create or replace function public.admin_place_members(p_squad_id uuid, p_profile_ids uuid[])
returns int
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

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    p_squad_id,
    p.id,
    p.role::text::public.team_role,
    case when p.role = 'coach' then coalesce((
      select m.coach_title from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.profile_id = p.id and m.coach_title is not null
      order by t.season desc
      limit 1
    ), 'head_coach') end,
    case when p.role = 'athlete' and v_group.kind = 'team' then coalesce((
      select m.selection from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.profile_id = p.id and m.selection is not null
      order by t.season desc
      limit 1
    ), 'touring') end
  from public.profiles p
  where p.id = any (coalesce(p_profile_ids, '{}'))
    and p.status = 'approved'
    and p.role in ('coach', 'manager', 'athlete', 'guardian')
  on conflict (team_id, profile_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_set_season_archived(p_season int, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can archive a season';
  end if;
  if p_archived and not exists (
    select 1 from public.teams where season > p_season and squad_id is null and not archived
  ) then
    raise exception 'Start the next season before archiving this one';
  end if;

  update public.teams set archived = p_archived where season = p_season;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance and check-ins
-- ---------------------------------------------------------------------------

-- Attendance takers can take attendance for a whole squad, or for a team
-- without a squad.
create or replace function public.can_take_attendance(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.leads_group(p_team_id)
    or exists (
      select 1 from public.teams t
      where t.id = p_team_id
        and not t.archived
        and (public.is_admin() or (t.squad_id is null and public.is_attendance_taker()))
    );
$$;

-- Teams without a squad show in the committee's overview from the start.
create or replace function public.check_in_overview(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  season int,
  athlete_count int,
  checked_in_count int,
  -- Null when fewer than 3 athletes have checked in.
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with groups as (
    select t.id, t.name, t.kind, t.season, t.sort_order, coalesce(s.sort_order, t.sort_order) as squad_order
    from public.teams t
    left join public.teams s on s.id = t.squad_id
    where not t.archived
      and (
        (t.kind = 'squad' and t.selections_completed_at is null)
        or (t.kind = 'team' and (t.squad_id is null or s.selections_completed_at is not null))
      )
  ),
  scores as (
    select
      g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order,
      count(a.profile_id)::int as athletes,
      count(c.id)::int as checked_in,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from groups g
    left join public.team_members a on a.team_id = g.id and a.team_role = 'athlete'
      and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
    left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
    group by g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order
  )
  select
    id, name, kind::text, season, athletes, checked_in,
    case when checked_in >= 3 then flagged end,
    case when checked_in >= 3 then round(sleep, 1) end,
    case when checked_in >= 3 then round(soreness, 1) end,
    case when checked_in >= 3 then round(stress, 1) end,
    case when checked_in >= 3 then round(mood, 1) end
  from scores
  where public.is_committee() or public.is_physio()
  order by season desc, squad_order, kind, sort_order, name;
$$;

-- ---------------------------------------------------------------------------
-- Putting a team into a squad
-- ---------------------------------------------------------------------------

-- For a club that turns squads on after it has teams: the team joins a squad
-- of the same season, and its members are added to the squad too (a member of
-- a team must be in its squad). Nobody is removed.
create or replace function public.admin_put_team_in_squad(p_team_id uuid, p_squad_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_squad public.teams;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change teams';
  end if;
  select * into v_team from public.teams
  where id = p_team_id and kind = 'team' and squad_id is null and not archived;
  if v_team.id is null then
    raise exception 'Choose a team that isn''t in a squad yet';
  end if;
  select * into v_squad from public.teams
  where id = p_squad_id and kind = 'squad' and not archived;
  if v_squad.id is null or v_squad.season <> v_team.season then
    raise exception 'Choose a squad from the same season';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select p_squad_id, m.profile_id, m.team_role, m.coach_title
  from public.team_members m
  where m.team_id = p_team_id
  on conflict (team_id, profile_id) do nothing;

  update public.teams set squad_id = p_squad_id where id = p_team_id;
end;
$$;

revoke execute on function public.admin_put_team_in_squad(uuid, uuid) from public, anon;
grant execute on function public.admin_put_team_in_squad(uuid, uuid) to authenticated;

commit;
