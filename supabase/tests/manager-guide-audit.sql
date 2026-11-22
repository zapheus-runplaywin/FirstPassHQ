-- Tests for 20261017070000_manager_guide_audit.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

-- Seed: Casey (11) coaches the squad (a1) and team (a2); Drew (12) is an
-- assistant coach in the squad with a card that expired yesterday; Emery (13)
-- manages the squad; Jordan (31) is an athlete in both. A game for the team.
insert into public.games (id, team_id, config) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', '{}'::jsonb);
insert into public.team_members (team_id, profile_id, team_role)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000012', 'coach'),
       ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000013', 'manager');

-- 1. A paused coach is no longer a team member at the database.
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach is not a team member', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);
select pg_temp.ok('lapsed coach sees no roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-0000000000a1')) = 0, true);
select pg_temp.ok('lapsed coach cannot view the game', public.may_view_game('00000000-0000-0000-0000-0000000000f1'), false);
select pg_temp.ok('lapsed coach sees no team captains', (select count(*) from public.team_captains where team_id = '00000000-0000-0000-0000-0000000000a2') = 0, true);

-- 2. A cleared manager is, and loses it the day after the card expires.
select pg_temp.as_member('13');
select pg_temp.ok('cleared manager is a team member', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('cleared manager sees the roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-0000000000a1')) > 0, true);
select pg_temp.ok('cleared manager can view the game', public.may_view_game('00000000-0000-0000-0000-0000000000f1'), true);
update public.profiles set wwcc_expires_on = public.club_today() where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.ok('manager is a member on the expiry date', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), true);
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.ok('paused manager is not a team member', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);
select pg_temp.ok('paused manager cannot view the game', public.may_view_game('00000000-0000-0000-0000-0000000000f1'), false);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.ok('manager is back once the card is', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), true);

-- 3. Athletes, admins and the cleared coach are unchanged.
select pg_temp.as_member('31');
select pg_temp.ok('athlete is a team member', public.is_team_member('00000000-0000-0000-0000-0000000000a2'), true);
select pg_temp.as_member('11');
select pg_temp.ok('cleared coach is a team member', public.is_team_member('00000000-0000-0000-0000-0000000000a2'), true);
select pg_temp.ok('cleared coach can view the game', public.may_view_game('00000000-0000-0000-0000-0000000000f1'), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees the roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-0000000000a1')) > 0, true);

-- 4. Conduct acceptances and KPI sheets outlive the account. The committee
-- sets Emery an OKR and a review point, writes the review; Emery accepts the
-- code of conduct, then deletes their account.
create temp table ids (name text, id uuid);
select pg_temp.as_member('01');
update public.safeguarding_settings set code_of_conduct_url = 'https://example.com/conduct', policy_version = '2026-1' where id;
select pg_temp.works('admin turns the code of conduct on', $$select public.admin_set_conduct_each_season(true)$$);
insert into ids select 'point', public.admin_save_kpi_review_point(null, (select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1'), 'Mid-season', public.club_today() - 1);
select pg_temp.as_member('22');
insert into ids select 'okr', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-0000000000a1', 'okr', 'Run smooth game days', null,
  '[{"title":"Rosters in by Thursday","kind":"yes_no"}]');
select pg_temp.works('committee writes the review', $$select public.save_kpi_review('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'point'), 'Going well')$$);
select pg_temp.as_member('13');
select pg_temp.works('manager accepts the code of conduct', $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000013')$$);
select pg_temp.ok('manager is on the admin KPI report before leaving', exists (
  select 1 from (select pg_temp.as_member('01')) s, public.season_kpi_report((select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1')) r
  where r.profile_id = '00000000-0000-0000-0000-000000000013' and r.left_at is null), true);
select pg_temp.as_member('13');
select pg_temp.works('manager deletes their account', $$select public.delete_my_account()$$);
select pg_temp.ok('profile is gone', exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000013'), false);
select pg_temp.ok('conduct acceptance kept with the name', exists (
  select 1 from public.conduct_acceptances where profile_id = '00000000-0000-0000-0000-000000000013'
    and member_name = 'Emery Manager' and member_left_at is not null), true);
select pg_temp.ok('KPI kept with the name', exists (
  select 1 from public.season_kpis where profile_id = '00000000-0000-0000-0000-000000000013'
    and person_name = 'Emery Manager' and person_left_at is not null), true);
select pg_temp.ok('KPI measures kept', exists (
  select 1 from public.season_kpi_measures where kpi_id = (select id from ids where name = 'okr')), true);
select pg_temp.ok('KPI review kept with the name', exists (
  select 1 from public.season_kpi_reviews r
  join public.season_kpi_review_notes n using (profile_id, team_id, point_id)
  where r.profile_id = '00000000-0000-0000-0000-000000000013'
    and r.person_name = 'Emery Manager' and r.person_left_at is not null and n.note = 'Going well'), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin KPI report lists the former manager with when they left', exists (
  select 1 from public.season_kpi_report((select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1')) r
  where r.profile_id = '00000000-0000-0000-0000-000000000013' and r.full_name = 'Emery Manager'
    and r.left_at is not null and r.title = 'Run smooth game days'
    and (r.reviews->0->>'written')::boolean), true);
select pg_temp.ok('admin KPI report lists each former person once', (
  select count(*) from public.season_kpi_report((select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1')) r
  where r.profile_id = '00000000-0000-0000-0000-000000000013') = 1, true);
select pg_temp.ok('current coaches are still on the report', exists (
  select 1 from public.season_kpi_report((select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1')) r
  where r.profile_id = '00000000-0000-0000-0000-000000000011' and r.left_at is null), true);
select pg_temp.ok('a non-admin gets no report', (
  select count(*) from (select pg_temp.as_member('11')) s, public.season_kpi_report((select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1'))) = 0, true);
