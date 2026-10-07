-- Squads now, teams later.
--
-- Each season, members are first placed in a squad (for example the Mixed Open
-- Squad of 18 athletes). When selections are made, teams are named inside a
-- squad and athletes are picked as touring athletes or training partners.
-- People stay in their squad after being named in a team, so squad calendars
-- and rosters still reach them.
--
-- Squads and teams share the `teams` table so memberships, rosters and
-- calendars work the same for both.

create type public.group_kind as enum ('squad', 'team');

-- How an athlete was picked for a team.
create type public.team_selection as enum ('touring', 'training_partner');

-- ---------------------------------------------------------------------------
-- Squads and teams
-- ---------------------------------------------------------------------------

alter table public.teams
  add column kind public.group_kind not null default 'squad',
  add column season int not null default extract(year from now())::int,
  -- The squad a team was named from. Squads have none.
  add column squad_id uuid references public.teams (id) on delete cascade,
  -- Past seasons are archived rather than deleted, so history is kept.
  add column archived boolean not null default false,
  add constraint teams_belong_to_a_squad
    check ((kind = 'team') = (squad_id is not null));

-- Names repeat every season, so they only need to be unique within one.
alter table public.teams drop constraint teams_name_key;
alter table public.teams add constraint teams_season_name_key unique (season, name);

create index teams_squad_id_idx on public.teams (squad_id);

-- The six seeded groups become this season's squads. Open A and Open are one
-- squad until the two teams are named, so their members are combined.
update public.teams set season = 2026;

update public.teams set name = 'Mixed Open Squad', sort_order = 1 where name = 'Open Mixed';
update public.teams set name = 'Open Squad', sort_order = 2 where name = 'Open';
update public.teams set name = '20 & Under Squad', sort_order = 3 where name = '20 & Under';
update public.teams set name = '17 & Under Squad', sort_order = 4 where name = '17 & Under';
update public.teams set sort_order = 5 where name = 'Lightning Academy';

insert into public.team_members (team_id, profile_id, team_role, coach_title)
select (select id from public.teams where name = 'Open Squad'), profile_id, team_role, coach_title
from public.team_members
where team_id = (select id from public.teams where name = 'Open A')
on conflict (team_id, profile_id) do nothing;

update public.calendars
set team_id = (select id from public.teams where name = 'Open Squad')
where team_id = (select id from public.teams where name = 'Open A');

update public.profiles
set requested_team_id = (select id from public.teams where name = 'Open Squad')
where requested_team_id = (select id from public.teams where name = 'Open A');

delete from public.teams where name = 'Open A';

-- ---------------------------------------------------------------------------
-- Team selections
-- ---------------------------------------------------------------------------

alter table public.team_members
  add column selection public.team_selection,
  add constraint selection_only_for_athletes
    check (selection is null or team_role = 'athlete');

-- Only teams have touring athletes and training partners.
create function public.check_team_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.selection is not null
     and (select kind from public.teams where id = new.team_id) <> 'team' then
    raise exception 'Touring and training partner selections only apply to teams';
  end if;
  return new;
end;
$$;

create trigger team_members_check_selection
  before insert or update on public.team_members
  for each row execute function public.check_team_selection();

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------

-- Same as before, plus a selection for athletes in teams. p_teams is a JSON
-- array of {"team_id", "coach_title", "selection"}; teams default athletes to
-- touring.
create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
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

  update public.profiles
  set role = p_role, status = p_status
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  delete from public.team_members where profile_id = p_profile_id;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;
  if p_role not in ('coach', 'manager', 'athlete') then
    raise exception 'Only coaches, managers and athletes can be added to a squad or team';
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
    case when v_team_role = 'coach'
      then coalesce((t ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when v_team_role = 'athlete' and g.kind = 'team'
      then coalesce((t ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;
end;
$$;

-- Names a team from its squad in one go. p_members is a JSON array of
-- {"profile_id", "selection", "coach_title"}; anyone left out is removed from
-- the team (but stays in the squad). Everyone must already be in the squad.
create function public.admin_set_team_members(p_team_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_squad_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can name teams';
  end if;
  select squad_id into v_squad_id from public.teams where id = p_team_id and kind = 'team';
  if v_squad_id is null then
    raise exception 'Team not found';
  end if;
  if jsonb_typeof(p_members) <> 'array' then
    raise exception 'p_members must be a JSON array';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where not exists (
      select 1 from public.team_members sm
      where sm.team_id = v_squad_id and sm.profile_id = (m ->> 'profile_id')::uuid
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
    on sm.team_id = v_squad_id and sm.profile_id = (m ->> 'profile_id')::uuid;
end;
$$;

revoke execute on function public.admin_set_team_members(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_team_members(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Rosters show touring athletes before training partners
-- ---------------------------------------------------------------------------

drop function public.team_roster(uuid);

create function public.team_roster(p_team_id uuid)
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
    and (public.is_team_member(p_team_id) or public.is_admin())
  order by
    case tm.team_role when 'coach' then 0 when 'manager' then 1 else 2 end,
    case tm.coach_title when 'head_coach' then 0 else 1 end,
    case tm.selection when 'touring' then 0 when 'training_partner' then 1 else 2 end,
    p.full_name;
$$;

revoke execute on function public.team_roster(uuid) from public, anon;
grant execute on function public.team_roster(uuid) to authenticated;
