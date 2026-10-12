-- Starting setups for squads and teams.
--
-- A new club used to start with West Coast Thunder's squads, because the
-- first migration seeds them. Now a new club starts with no squads or teams,
-- and the admin picks one of three starting setups the first time they open
-- Squads and teams:
--
--   ammna_state_teams  AMMNA State Teams: Thunder's five squads, squads on
--   wanl               WA Netball League: Mens, Opens, 21 & Under and
--                      Futures teams, squads off
--   blank              nothing; the admin adds their own
--
-- The choice is kept in club_settings.team_template. Clubs that already have
-- squads or teams (West Coast Thunder, live and test) are left as they are and
-- never see the choice.
--
-- DATA LOSS (approved by Matt, 2026-10-12, as no club is in production): in a
-- database where nobody has used the seeded squads yet, they are deleted so the
-- club starts blank. That only happens when no squad or team has a member,
-- join request, calendar, message, attendance session, fixture, award,
-- training requirement or captain, and the admin hasn't added any of their
-- own. Thunder's databases have members, so nothing is deleted there.

begin;

-- ---------------------------------------------------------------------------
-- The chosen starting setup
-- ---------------------------------------------------------------------------

alter table public.club_settings
  add column if not exists team_template text;

alter table public.club_settings drop constraint if exists club_settings_team_template_check;
alter table public.club_settings add constraint club_settings_team_template_check
  check (team_template is null or team_template in ('ammna_state_teams', 'wanl', 'blank'));

-- ---------------------------------------------------------------------------
-- A fresh club starts with no squads or teams
-- ---------------------------------------------------------------------------

delete from public.teams t
where t.season = 2026
  and t.kind = 'squad'
  and t.name in (
    'Mixed Open Squad', 'Open Squad', '20 & Under Squad', '17 & Under Squad', 'Lightning Academy'
  )
  -- Only the five seeded squads exist, so the admin hasn't added anything.
  and not exists (
    select 1 from public.teams o
    where o.season <> 2026
      or o.kind <> 'squad'
      or o.name not in (
        'Mixed Open Squad', 'Open Squad', '20 & Under Squad', '17 & Under Squad',
        'Lightning Academy'
      )
  )
  -- Nothing anywhere points at a squad or team.
  and not exists (select 1 from public.team_members)
  and not exists (select 1 from public.profiles where requested_team_id is not null)
  and not exists (select 1 from public.calendars where team_id is not null)
  and not exists (select 1 from public.messages where team_id is not null)
  and not exists (select 1 from public.attendance_sessions where team_id is not null)
  and not exists (select 1 from public.playhq_teams where team_id is not null)
  and not exists (select 1 from public.fixtures where team_id is not null)
  and not exists (select 1 from public.award_groups)
  and not exists (select 1 from public.award_ballots where team_id is not null)
  and not exists (select 1 from public.training_requirement_teams)
  and not exists (select 1 from public.team_captains);

-- ---------------------------------------------------------------------------
-- Reading and applying a starting setup
-- ---------------------------------------------------------------------------

-- The starting setup the admin chose, or null if they haven't yet.
create or replace function public.club_team_template()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.team_template from public.club_settings s limit 1;
$$;

revoke execute on function public.club_team_template() from public, anon;
grant execute on function public.club_team_template() to authenticated;

-- Creates the chosen setup's squads or teams in the current club year (May to
-- May, Perth time) and turns squads on or off to match. Only while the club has
-- no current squads or teams, so nothing that is in use is ever replaced.
create or replace function public.admin_apply_team_template(p_template text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Australia/Perth')::date;
  v_season int := case
    when extract(month from v_today) >= 5 then extract(year from v_today)::int
    else extract(year from v_today)::int - 1
  end;
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose a starting setup';
  end if;
  if p_template is null or p_template not in ('ammna_state_teams', 'wanl', 'blank') then
    raise exception 'Choose AMMNA State Teams, WA Netball League or Blank';
  end if;
  if exists (select 1 from public.teams where not archived) then
    raise exception 'Your club already has squads or teams. Add, rename or remove them instead.';
  end if;

  if p_template = 'ammna_state_teams' then
    insert into public.teams (name, kind, season, sort_order) values
      ('Mixed Open Squad', 'squad', v_season, 1),
      ('Open Squad', 'squad', v_season, 2),
      ('20 & Under Squad', 'squad', v_season, 3),
      ('17 & Under Squad', 'squad', v_season, 4),
      ('Lightning Academy', 'squad', v_season, 5);
    update public.club_settings
    set features = coalesce(features, '{}'::jsonb) - 'squads', updated_at = now()
    where id;
  elsif p_template = 'wanl' then
    insert into public.teams (name, kind, season, sort_order) values
      ('Mens Team', 'team', v_season, 1),
      ('Opens Team', 'team', v_season, 2),
      ('21 & Under Team', 'team', v_season, 3),
      ('Futures Team', 'team', v_season, 4);
    update public.club_settings
    set features = coalesce(features, '{}'::jsonb) || '{"squads": false}'::jsonb,
        updated_at = now()
    where id;
  end if;

  update public.club_settings set team_template = p_template where id;
end;
$$;

revoke execute on function public.admin_apply_team_template(text) from public, anon;
grant execute on function public.admin_apply_team_template(text) to authenticated;

commit;
