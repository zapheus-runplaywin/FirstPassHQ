-- Tests for 20261017040000_coach_guide_audit.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

-- Six adult athletes join the squad (51-56), so the squad has 7 athletes plus
-- Junior (31, under 18, no consent yet). Check-ins: three the day before
-- yesterday, two yesterday, one today, so no single day reaches 5 but the
-- three days together do. Junior's seeded check-in is today.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'athlete' || n || '@example.test', now()
from unnest(array['51', '52', '53', '54', '55', '56']) n;
update public.profiles set status = 'approved', role = 'athlete', full_name = 'Athlete ' || right(id::text, 2),
  date_of_birth = public.club_today() - interval '25 years', verified_at = now()
where right(id::text, 2) in ('51', '52', '53', '54', '55', '56');
insert into public.team_members (team_id, profile_id, team_role)
select '00000000-0000-0000-0000-0000000000a1', ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'athlete'
from unnest(array['51', '52', '53', '54', '55', '56']) n;
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood) values
  ('00000000-0000-0000-0000-000000000051', public.club_today() - 2, 4, 4, 4, 4),
  ('00000000-0000-0000-0000-000000000052', public.club_today() - 2, 4, 4, 4, 4),
  ('00000000-0000-0000-0000-000000000053', public.club_today() - 2, 2, 4, 4, 4),
  ('00000000-0000-0000-0000-000000000054', public.club_today() - 1, 4, 4, 4, 4),
  ('00000000-0000-0000-0000-000000000055', public.club_today() - 1, 4, 4, 4, 4),
  ('00000000-0000-0000-0000-000000000056', public.club_today(), 4, 4, 4, 4);

-- 1. Trends: a rolling 3-day average that leaves out a child without consent.
select pg_temp.as_member('11');
select pg_temp.ok('today counts only the day''s own check-ins (child left out)',
  (select checked_in_count = 1 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', public.club_today() - 2, public.club_today()) where day = public.club_today()), true);
select pg_temp.ok('today''s window covers three days',
  (select window_count = 6 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', public.club_today() - 2, public.club_today()) where day = public.club_today()), true);
select pg_temp.ok('today shows scores with 6 athletes over three days',
  (select avg_sleep is not null from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', public.club_today() - 2, public.club_today()) where day = public.club_today()), true);
select pg_temp.ok('today''s flagged count covers the three days',
  (select flagged_count = 1 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', public.club_today() - 2, public.club_today()) where day = public.club_today()), true);
-- From 20261017090000 averages show from 3 check-ins (it was 5).
select pg_temp.ok('the day before yesterday shows scores (3 over its three days)',
  (select avg_sleep is not null and checked_in_count = 3 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', public.club_today() - 2, public.club_today()) where day = public.club_today() - 2), true);
select pg_temp.ok('a coach cannot ask for the whole club',
  (select count(*) = 0 from public.check_in_trend(null, public.club_today() - 2, public.club_today())), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee: whole club shows today',
  (select avg_sleep is not null and window_count = 6 from public.check_in_trend(null, public.club_today() - 2, public.club_today()) where day = public.club_today()), true);
select pg_temp.ok('committee overview leaves the child out of the count',
  (select athlete_count = 7 and checked_in_count = 1 from public.check_in_overview(public.club_today()) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('committee overview hides a single day under 5',
  (select avg_sleep is null from public.check_in_overview(public.club_today()) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);

-- The parent consents: the child counts from then on.
select pg_temp.as_member('41');
select pg_temp.works('parent gives data consent', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, false) $s$);
select pg_temp.as_member('11');
select pg_temp.ok('after consent today counts the child',
  (select checked_in_count = 2 and window_count = 7 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', public.club_today() - 2, public.club_today()) where day = public.club_today()), true);
select pg_temp.as_member('22');
select pg_temp.ok('after consent the overview counts the child',
  (select athlete_count = 8 and checked_in_count = 2 from public.check_in_overview(public.club_today()) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);

-- 2. Home totals know a team's squad.
select pg_temp.as_member('11');
select pg_temp.ok('check_in_summary names the team''s squad',
  (select squad_id = '00000000-0000-0000-0000-0000000000a1' from public.check_in_summary(public.club_today()) where team_id = '00000000-0000-0000-0000-0000000000a2'), true);
select pg_temp.ok('a lapsed coach gets no summary', (select count(*) = 0 from (select pg_temp.as_member('12')) x, public.check_in_summary(public.club_today())), true);

-- 3. Team goals: coaches and athletes only. A game for the team, with a
-- manager and a physio placed in the team too.
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Rockets', 'Round 1', now() + interval '2 days');
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000013', 'manager'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000014', 'physio');
insert into public.team_game_goals (id, fixture_id, body, set_by, set_by_name)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'Win the third quarter', '00000000-0000-0000-0000-000000000011', 'Casey Coach');
grant select on public.team_game_goals, public.team_game_goal_comments to authenticated;
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('coach reads the team goal', (select count(*) = 1 from public.team_game_goals), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete reads the team goal', (select count(*) = 1 from public.team_game_goals), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads the team goal', (select count(*) = 1 from public.team_game_goals), true);
select pg_temp.as_member('01');
-- Team goals stay with the team (27 November 2026): an admin no longer reads them.
select pg_temp.ok('admin does not read the team goal', (select count(*) = 0 from public.team_game_goals), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager in the team does not read it', (select count(*) = 0 from public.team_game_goals), true);
select pg_temp.fails('manager cannot comment', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Go team') $s$);
select pg_temp.as_member('14');
select pg_temp.ok('physio in the team does not read it', (select count(*) = 0 from public.team_game_goals), true);
select pg_temp.fails('physio cannot comment', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Go team') $s$);
select pg_temp.as_member('31');
select pg_temp.works('athlete comments', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Let''s do it') $s$);
select pg_temp.as_member('11');
select pg_temp.works('coach comments', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Agreed') $s$);
select pg_temp.ok('coach sees both comments', (select count(*) = 2 from public.team_game_goal_comments), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager sees no comments', (select count(*) = 0 from public.team_game_goal_comments), true);
reset role;

-- 4. The goal board still runs, and the role rule names temporary helpers.
select pg_temp.as_member('11');
select pg_temp.ok('goal board lists the team''s athlete', (select count(*) >= 1 from public.goal_board() where team_id = '00000000-0000-0000-0000-0000000000a2'), true);
select pg_temp.ok('role rule says Temporary helpers',
  (select public.role_combination_problem(array['volunteer', 'coach']::public.app_role[], null, false) = 'Temporary helpers can''t have another role'), true);
