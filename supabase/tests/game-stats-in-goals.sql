-- Tests for 20261122100000_game_stats_in_goals.sql: goal_game_stats_access,
-- which tells the game-stats function whether the caller may see an
-- athlete's own figures from a recorded game, and admin_games, the Games
-- list in Administration.
-- Rules checked, for every kind of member: an athlete's figures are for
-- their current coaches and nobody else, not the athlete, their guardians,
-- managers, physios, statisticians, the committee, admins, lapsed or
-- stood-down coaches, other athletes or anyone signed out; only a
-- finished recording of one of the athlete's own games counts; a team mate
-- with the same name hides both; the game's events stay closed to athletes
-- and guardians; only admins list the club's games. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', case when n = '' then '' else '00000000-0000-0000-0000-0000000000' || n end, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.g(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-000000000d0' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.is(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
-- What the game-stats function is told, as this member.
create or replace function pg_temp.access(n text, p_athlete text, p_fixture text) returns jsonb language plpgsql as
$$ declare r jsonb; begin
     perform pg_temp.as_member(n);
     set local role authenticated;
     r := public.goal_game_stats_access(pg_temp.m(p_athlete), pg_temp.m(p_fixture));
     reset role;
     return r;
   end $$;
-- Rows a member reads as the app does, through row level security.
create or replace function pg_temp.reads_events(n text) returns bigint language plpgsql as
$$ declare r bigint; begin
     perform pg_temp.as_member(n);
     set local role authenticated;
     select count(*) into r from public.game_events;
     reset role;
     return r;
   end $$;
create or replace function pg_temp.lists_games(n text) returns bigint language plpgsql as
$$ declare r bigint; begin
     perform pg_temp.as_member(n);
     set local role authenticated;
     select count(*) into r from public.admin_games();
     reset role;
     return r;
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- 61 Sam a statistician, 62 Quinn a coach of the Sample Team who is stood
-- down, 63 Riley an athlete of the Sample Team, 64 Tatum the parent
-- of Riley, who is an adult.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'stats@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'coach.stood-down@example.test', now()),
  ('00000000-0000-0000-0000-000000000063', 'athlete.teammate@example.test', now()),
  ('00000000-0000-0000-0000-000000000064', 'guardian.unverified@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, wwcc_exempt_reason = v.reason, stood_down_at = v.stood,
  date_of_birth = v.dob, verified_at = v.verified
from (values
  ('00000000-0000-0000-0000-000000000061', 'Sam Stats', 'statistician', null, null::date, 'Opens games only', null::timestamptz, current_date - interval '40 years', now()),
  ('00000000-0000-0000-0000-000000000062', 'Quinn Paused', 'coach', 'WWC0062', current_date + 400, null, null, current_date - interval '40 years', now()),
  ('00000000-0000-0000-0000-000000000063', 'Riley Teammate', 'athlete', null, null, null, null, current_date - interval '25 years', now()),
  ('00000000-0000-0000-0000-000000000064', 'Tatum Parent', 'guardian', null, null, null, null, current_date - interval '40 years', now())
) as v(id, name, role, wwcc, exp, reason, stood, dob, verified)
where p.id = v.id::uuid;
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.m('62'), 'coach', 'assistant_coach'),
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.m('63'), 'athlete', null),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.m('63'), 'athlete', null);
-- Stood down after being placed, as it happens in a club.
update public.profiles set stood_down_at = now() where id = pg_temp.m('62');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.m('64'), pg_temp.m('63'));
update public.profiles set preferred_name = '  JJ ' where id = pg_temp.m('31');

-- Sample Team (a2: athletes 31 and 63, coach 11) and Sample Squad (a1).
--   f5 played yesterday, recorded twice and finished (games 1 and 2)
--   f6 played 8 days ago, recording never finished (game 3)
--   f7 squad game 3 days ago, finished (game 4)
--   f8 played 2 days ago, never recorded
--   game 5 finished, for f8's fixture but recorded for the squad, game 6 from no fixture
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  (pg_temp.m('f5'), '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Stars', 'Round 4', now() - interval '1 day'),
  (pg_temp.m('f6'), '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Planets', 'Round 3', now() - interval '8 days'),
  (pg_temp.m('f7'), '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Moons', 'Round 1', now() - interval '3 days'),
  (pg_temp.m('f8'), '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Suns', 'Round 2', now() - interval '2 days');
insert into public.games (id, team_id, fixture_id, config, status, recorder_id, created_by, created_at, finished_at) values
  (pg_temp.g(1), '00000000-0000-0000-0000-0000000000a2', pg_temp.m('f5'), '{"us":"Sample Team","them":"Stars","quarterMs":600000}', 'final', pg_temp.m('61'), pg_temp.m('61'), now() - interval '26 hours', now() - interval '25 hours'),
  (pg_temp.g(2), '00000000-0000-0000-0000-0000000000a2', pg_temp.m('f5'), '{"us":"Sample Team","them":"Stars","quarterMs":900000}', 'final', pg_temp.m('61'), pg_temp.m('61'), now() - interval '25 hours', now() - interval '23 hours'),
  (pg_temp.g(3), '00000000-0000-0000-0000-0000000000a2', pg_temp.m('f6'), '{"us":"Sample Team","them":"Planets"}', 'live', pg_temp.m('61'), pg_temp.m('61'), now() - interval '8 days', null),
  (pg_temp.g(4), '00000000-0000-0000-0000-0000000000a1', pg_temp.m('f7'), '{"us":"Sample Squad","them":"Moons"}', 'final', null, pg_temp.m('61'), now() - interval '3 days', now() - interval '71 hours'),
  (pg_temp.g(5), '00000000-0000-0000-0000-0000000000a1', pg_temp.m('f8'), '{"us":"Sample Squad","them":"Suns"}', 'final', pg_temp.m('61'), pg_temp.m('61'), now() - interval '2 days', now() - interval '47 hours'),
  (pg_temp.g(6), '00000000-0000-0000-0000-0000000000a2', null, '{"us":"Sample Team","them":"Friendly"}', 'setup', pg_temp.m('61'), pg_temp.m('61'), now() - interval '1 hour', null);
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(2), s.stream, n, gen_random_uuid(), 'period_start', '{}', now(), pg_temp.m('61')
from (values ('primary', 3), ('helper:00000000-0000-0000-0000-000000000061', 2)) as s(stream, events), generate_series(1, s.events) n;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon cannot ask whose stats may be seen', has_function_privilege('anon', 'public.goal_game_stats_access(uuid, uuid)', 'execute'), false);
select pg_temp.ok('signed-in members can ask (it checks who they are)', has_function_privilege('authenticated', 'public.goal_game_stats_access(uuid, uuid)', 'execute'), true);
select pg_temp.ok('anon cannot list the club''s games', has_function_privilege('anon', 'public.admin_games(int, int)', 'execute'), false);
select pg_temp.ok('signed-in members can call admin_games (it answers admins only)', has_function_privilege('authenticated', 'public.admin_games(int, int)', 'execute'), true);
select pg_temp.ok('nobody calls plain_name themselves', has_function_privilege('anon', 'public.plain_name(text)', 'execute') or has_function_privilege('authenticated', 'public.plain_name(text)', 'execute'), false);
select pg_temp.ok('both run as their owner with a fixed search path', (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where proname in ('goal_game_stats_access', 'admin_games') and pronamespace = 'public'::regnamespace), true);

-- ---------------------------------------------------------------------------
-- An athlete's figures: who is told there are some
-- ---------------------------------------------------------------------------
select pg_temp.ok('their team''s coach is told', pg_temp.access('11', '31', 'f5') is not null, true);
select pg_temp.ok('a coach who is also their parent is told, as their coach', pg_temp.access('42', '31', 'f5') is not null, true);
select pg_temp.ok('the athlete is not told about their own game', pg_temp.access('31', '31', 'f5') is null, true);
select pg_temp.ok('their verified parent is not', pg_temp.access('41', '31', 'f5') is null, true);
select pg_temp.ok('another athlete''s parent is not', pg_temp.access('64', '31', 'f5') is null, true);
select pg_temp.ok('a parent is not told about a child who is now an adult', pg_temp.access('64', '63', 'f5') is null, true);
select pg_temp.ok('nor is that adult athlete', pg_temp.access('63', '63', 'f5') is null, true);
select pg_temp.ok('though the adult athlete''s coach is', pg_temp.access('11', '63', 'f5') is not null, true);
select pg_temp.ok('a coach whose check lapsed is not', pg_temp.access('12', '31', 'f5') is null, true);
select pg_temp.ok('a stood-down coach of the team is not', pg_temp.access('62', '31', 'f5') is null, true);
select pg_temp.ok('a manager is not', pg_temp.access('13', '31', 'f5') is null, true);
select pg_temp.ok('a physio is not', pg_temp.access('14', '31', 'f5') is null, true);
select pg_temp.ok('the statistician who recorded it is not', pg_temp.access('61', '31', 'f5') is null, true);
select pg_temp.ok('a committee member is not', pg_temp.access('22', '31', 'f5') is null, true);
select pg_temp.ok('an admin is not', pg_temp.access('01', '31', 'f5') is null, true);
select pg_temp.ok('a team mate is not', pg_temp.access('63', '31', 'f5') is null, true);
select pg_temp.ok('another athlete is not', pg_temp.access('32', '31', 'f5') is null, true);
select pg_temp.ok('someone signed out is not', pg_temp.access('', '31', 'f5') is null, true);

-- ---------------------------------------------------------------------------
-- Net Points go with the rest, to the athlete's coaches
-- ---------------------------------------------------------------------------
select pg_temp.is('their coach gets Net Points', pg_temp.access('11', '31', 'f5') ->> 'net_points', 'true');
select pg_temp.is('a current coach who is also their parent gets them, as their coach', pg_temp.access('42', '31', 'f5') ->> 'net_points', 'true');

-- ---------------------------------------------------------------------------
-- Which game, and under which names
-- ---------------------------------------------------------------------------
select pg_temp.is('a game recorded twice gives the one finished last', pg_temp.access('11', '31', 'f5') ->> 'game_id', pg_temp.g(2)::text);
select pg_temp.is('with that recording''s setup', pg_temp.access('11', '31', 'f5') -> 'config' ->> 'quarterMs', '900000');
select pg_temp.is('the athlete may be recorded under their preferred or full name, tidied', (select string_agg(n, ',' order by n) from jsonb_array_elements_text(pg_temp.access('11', '31', 'f5') -> 'names') n), 'jj,jordan junior');
select pg_temp.is('the answer holds nothing else', (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.access('11', '31', 'f5')) k), 'config,game_id,names,net_points');
select pg_temp.ok('a recording that was never finished gives nothing', pg_temp.access('11', '31', 'f6') is null, true);
select pg_temp.ok('a game nobody recorded gives nothing', pg_temp.access('11', '31', 'f8') is null, true);
select pg_temp.ok('a game that is not this athlete''s gives nothing', pg_temp.access('11', '32', 'f5') is null, true);
select pg_temp.ok('a squad game gives its athletes'' figures to their coach', pg_temp.access('11', '32', 'f7') is not null, true);
select pg_temp.is('for the squad''s own recording', pg_temp.access('11', '32', 'f7') ->> 'game_id', pg_temp.g(4)::text);
select pg_temp.ok('a fixture that does not exist gives nothing', pg_temp.access('11', '31', 'ff') is null, true);
select pg_temp.ok('an athlete who does not exist gives nothing', pg_temp.access('11', '99', 'f5') is null, true);
select pg_temp.is('plain_name tidies case and spaces', public.plain_name('  Jordan   JUNIOR '), 'jordan junior');
select pg_temp.ok('plain_name gives nothing for an empty name', public.plain_name('   ') is null and public.plain_name(null) is null, true);

-- A team mate under the same name: neither can be told apart in the lineup.
update public.profiles set preferred_name = 'jj' where id = pg_temp.m('63');
select pg_temp.is('a team mate with the same name hides the athlete''s figures from their coach', pg_temp.access('11', '31', 'f5') ->> 'names', '[]');
select pg_temp.is('and the team mate''s own', pg_temp.access('11', '63', 'f5') ->> 'names', '[]');
update public.profiles set preferred_name = null where id = pg_temp.m('63');
select pg_temp.is('and they come back once the names differ', pg_temp.access('11', '63', 'f5') ->> 'names', '["riley teammate"]');

-- ---------------------------------------------------------------------------
-- The game's events stay closed
-- ---------------------------------------------------------------------------
select pg_temp.ok('the athlete still reads none of the game''s events', pg_temp.reads_events('31') = 0, true);
select pg_temp.ok('nor does their parent', pg_temp.reads_events('41') = 0, true);
select pg_temp.ok('nor a team mate', pg_temp.reads_events('63') = 0, true);

-- ---------------------------------------------------------------------------
-- The Games list in Administration
-- ---------------------------------------------------------------------------
select pg_temp.ok('an admin lists every recorded game', pg_temp.lists_games('01') = 6, true);
select pg_temp.ok('a coach lists none', pg_temp.lists_games('11') = 0, true);
select pg_temp.ok('a committee member lists none', pg_temp.lists_games('22') = 0, true);
select pg_temp.ok('a manager lists none', pg_temp.lists_games('13') = 0, true);
select pg_temp.ok('a physio lists none', pg_temp.lists_games('14') = 0, true);
select pg_temp.ok('the statistician lists none', pg_temp.lists_games('61') = 0, true);
select pg_temp.ok('an athlete lists none', pg_temp.lists_games('31') = 0, true);
select pg_temp.ok('a parent lists none', pg_temp.lists_games('41') = 0, true);
select pg_temp.ok('someone signed out lists none', pg_temp.lists_games('') = 0, true);

select pg_temp.as_member('01');
select pg_temp.is('newest first', (select string_agg(right(id::text, 1), '' order by ord) from public.admin_games() with ordinality as t(id, team_name, us, them, round_name, status, created_at, finished_at, recorder_name, events, from_fixture, ord)), '621543');
select pg_temp.is('a game shows its teams, round, recorder and events', (select concat_ws('|', team_name, us, them, round_name, status, recorder_name, events, from_fixture) from public.admin_games() where id = pg_temp.g(2)), 'Sample Team|Sample Team|Stars|Round 4|final|Sam Stats|3|t');
select pg_temp.is('a game with no fixture or recorder says so', (select concat_ws('|', coalesce(round_name, '-'), coalesce(recorder_name, '-'), events, from_fixture) from public.admin_games() where id = pg_temp.g(6)), '-|Sam Stats|0|f');
select pg_temp.ok('a recorder who has gone leaves the name empty', (select recorder_name is null from public.admin_games() where id = pg_temp.g(4)), true);
select pg_temp.ok('it pages', (select count(*) = 2 from public.admin_games(2, 0)) and (select count(*) = 1 from public.admin_games(2, 5)) and (select count(*) = 0 from public.admin_games(2, 6)), true);
select pg_temp.is('the second page carries on from the first', (select string_agg(right(id::text, 1), '' order by created_at desc) from public.admin_games(2, 2)), '15');
select pg_temp.ok('a silly page size or start is tidied, not an error', (select count(*) = 1 from public.admin_games(0, -3)) and (select count(*) = 6 from public.admin_games(100000, null)) and (select count(*) = 6 from public.admin_games(null, 0)), true);
