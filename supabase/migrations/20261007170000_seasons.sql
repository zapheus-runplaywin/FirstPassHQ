-- Seasons.
--
-- The club year runs May to May, with the competition at Easter. Season 2026
-- is shown as 2026–27. Each May an admin starts the next season, which
-- creates its squads with the same names as this season's, empty. Admins
-- place returning members into them; new people still send a join request.
-- Last season's squads and teams keep running alongside until an admin
-- archives that season, about 4–6 weeks after Easter.
--
-- Archiving hides a season's squads and teams from everyday screens and
-- coaches' to-dos. Nothing is deleted: memberships, attendance, injuries and
-- check-ins are kept, and an admin can bring the season back.
--
-- Additive only: new functions, and admin_save_member replaced so that saving
-- a member no longer removes them from past seasons' squads and teams.

-- Same as before, except that only this season's squads and teams (ones that
-- aren't archived) are replaced. Past seasons' memberships are history and
-- stay as they are.
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
  v_under_17 boolean := p_role = 'athlete' and coalesce(p_under_17, false);
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_profile_id = auth.uid() and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 17 have guardians';
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

  -- Teams are named from a squad, so a member of a team must be in its squad.
  if exists (
    select 1
    from jsonb_array_elements(p_teams) as t
    join public.teams g on g.id = (t ->> 'team_id')::uuid
    where g.kind = 'team'
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

-- Starts p_season: creates its squads with the same names and order as the
-- latest season's squads, and gives them the same squad calendars. Returns how
-- many squads were created.
create or replace function public.admin_start_season(p_season int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from int;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can start a season';
  end if;
  select max(season) into v_from from public.teams where kind = 'squad' and not archived;
  if v_from is null then
    raise exception 'There are no squads to copy';
  end if;
  if p_season is distinct from v_from + 1 then
    raise exception 'The next season is %', v_from + 1;
  end if;

  insert into public.teams (name, sort_order, kind, season)
  select name, sort_order, 'squad', p_season
  from public.teams
  where season = v_from and kind = 'squad' and not archived
  on conflict (season, name) do nothing;
  get diagnostics v_count = row_count;

  insert into public.calendars (name, url, team_id, committee_only, color)
  select c.name, c.url, new_squad.id, false, c.color
  from public.calendars c
  join public.teams old_squad on old_squad.id = c.team_id
    and old_squad.season = v_from and old_squad.kind = 'squad'
  join public.teams new_squad on new_squad.season = p_season
    and new_squad.kind = 'squad' and new_squad.name = old_squad.name
  where not exists (
    select 1 from public.calendars e where e.team_id = new_squad.id and e.url = c.url
  );

  return v_count;
end;
$$;

revoke execute on function public.admin_start_season(int) from public, anon;
grant execute on function public.admin_start_season(int) to authenticated;

-- Members from the season before p_squad_id's who aren't in any of its
-- season's squads yet, with the squad they were in. For placing returning
-- members. Admins only.
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
    select season from public.teams where id = p_squad_id and kind = 'squad'
  )
  select distinct on (p.id)
    p.id, coalesce(nullif(p.full_name, ''), p.email), p.role, old_squad.id, old_squad.name
  from target
  join public.teams old_squad on old_squad.season = target.season - 1 and old_squad.kind = 'squad'
  join public.team_members m on m.team_id = old_squad.id
  join public.profiles p on p.id = m.profile_id and p.status = 'approved'
    and p.role in ('coach', 'manager', 'athlete', 'guardian')
  where public.is_admin()
    and not exists (
      select 1 from public.team_members now_in
      join public.teams s on s.id = now_in.team_id
      where now_in.profile_id = p.id and s.season = target.season and s.kind = 'squad'
    )
  order by p.id, old_squad.sort_order;
$$;

revoke execute on function public.returning_members(uuid) from public, anon;
grant execute on function public.returning_members(uuid) to authenticated;

-- Places returning members in a squad, in the role they have in the club.
-- Coaches keep the title they had last season. Returns how many were added.
create or replace function public.admin_place_members(p_squad_id uuid, p_profile_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can place members';
  end if;
  select season into v_season
  from public.teams where id = p_squad_id and kind = 'squad' and not archived;
  if v_season is null then
    raise exception 'Squad not found';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title)
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
    ), 'head_coach') end
  from public.profiles p
  where p.id = any (coalesce(p_profile_ids, '{}'))
    and p.status = 'approved'
    and p.role in ('coach', 'manager', 'athlete', 'guardian')
  on conflict (team_id, profile_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.admin_place_members(uuid, uuid[]) from public, anon;
grant execute on function public.admin_place_members(uuid, uuid[]) to authenticated;

-- Archives a season's squads and teams, or brings them back. Only a season
-- with a newer one running can be archived, so the club always has a current
-- season.
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
    select 1 from public.teams where season > p_season and kind = 'squad' and not archived
  ) then
    raise exception 'Start the next season before archiving this one';
  end if;

  update public.teams set archived = p_archived where season = p_season;
end;
$$;

revoke execute on function public.admin_set_season_archived(int, boolean) from public, anon;
grant execute on function public.admin_set_season_archived(int, boolean) to authenticated;

-- Every season with its squad count, newest first, for the admin Seasons
-- screen. Archived seasons are included.
create or replace function public.season_list()
returns table (season int, archived boolean, squad_count int, team_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.season,
    bool_and(t.archived),
    (count(*) filter (where t.kind = 'squad'))::int,
    (count(*) filter (where t.kind = 'team'))::int
  from public.teams t
  where public.is_admin()
  group by t.season
  order by t.season desc;
$$;

revoke execute on function public.season_list() from public, anon;
grant execute on function public.season_list() to authenticated;
