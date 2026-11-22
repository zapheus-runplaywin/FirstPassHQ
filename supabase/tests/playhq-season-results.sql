-- Tests for 20261122200000_playhq_season_results.sql: may_view_team_games
-- and playhq_unrecorded_games, which tell the playhq function whose PlayHQ
-- results it may read for the season view.
-- Rules checked, for every kind of member, both ways: only the people who
-- see a team's recorded games (statisticians, admins, and coaches and
-- managers of the team or its squad who may work with children) get its
-- list; a lapsed or stood-down coach, physios, the committee, athletes,
-- guardians, another squad's staff and anyone signed out are refused. The
-- list holds only past PlayHQ games with an opponent and no finished
-- recording, newest first, with the PlayHQ site; athletes' registered and
-- lineup names come with it. Run on a fresh database with the migrations
-- and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', case when n = '' then '' else '00000000-0000-0000-0000-0000000000' || n end, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.is(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
-- The PlayHQ game ids a member is given for a team, newest first, as the app
-- asks; 'refused' when the database refuses, 'no access' when the role
-- can't call it at all.
create or replace function pg_temp.games(n text, p_team text) returns text language plpgsql as
$$ declare r jsonb; begin
     perform pg_temp.as_member(n);
     if n = '' then set local role anon; else set local role authenticated; end if;
     begin
       r := public.playhq_unrecorded_games(pg_temp.m(p_team));
     exception
       when insufficient_privilege then
         reset role;
         return case when sqlerrm like 'Only the team%' then 'refused' else 'no access' end;
     end;
     reset role;
     return coalesce((select string_agg(g->>'playhq_game_id', ',') from jsonb_array_elements(r->'games') g), '');
   end $$;
create or replace function pg_temp.may(n text, p_team text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     set local role authenticated;
     r := public.may_view_team_games(pg_temp.m(p_team));
     reset role;
     return r;
   end $$;
create or replace function pg_temp.check(who text, n text, p_team text, expected text) returns setof text language plpgsql as
$$ declare got text := pg_temp.games(n, p_team); begin
     return next case when got = expected then 'PASS ' else 'FAIL ' end || who || ' gets [' || expected || '] (got [' || got || '])';
     return next pg_temp.ok(who || ': may_view_team_games agrees', pg_temp.may(n, p_team), expected <> 'refused');
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- A second squad with a team. 71 Rene coaches Other Squad, 72 Sky manages
-- Other Team only, 73 Toni coaches Sample Squad but is stood down, 74 Pat
-- is a statistician.
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000b2', 'Other Team', 'team', '00000000-0000-0000-0000-0000000000b1', 4);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000071', 'other.coach@example.test', now()),
  ('00000000-0000-0000-0000-000000000072', 'other.manager@example.test', now()),
  ('00000000-0000-0000-0000-000000000073', 'stood.coach@example.test', now()),
  ('00000000-0000-0000-0000-000000000074', 'stats@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, wwcc_exempt_reason = v.reason,
  date_of_birth = current_date - interval '40 years', verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000071', 'Rene Other', 'coach', 'WWC0071', current_date + 400, null),
  ('00000000-0000-0000-0000-000000000072', 'Sky Other', 'manager', 'WWC0072', current_date + 400, null),
  ('00000000-0000-0000-0000-000000000073', 'Toni Paused', 'coach', 'WWC0073', current_date + 400, null),
  ('00000000-0000-0000-0000-000000000074', 'Pat Stats', 'statistician', null, null::date, 'Opens games only')
) as v(id, name, role, wwcc, exp, reason)
where p.id = v.id::uuid;
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.m('71'), 'coach', 'head_coach'),
  ('00000000-0000-0000-0000-0000000000b2', pg_temp.m('72'), 'manager', null),
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.m('73'), 'coach', 'assistant_coach');
update public.profiles set stood_down_at = now() where id = pg_temp.m('73');

-- Sample Team (a2) and Other Team (b2) play in one PlayHQ competition.
-- Sample Team's fixtures: r1 played, nobody recorded; r2 played and
-- recorded to full time from the fixture; r3 played, a recording started but
-- never finished; r4 a bye; r5 next week; r6 played, recorded with no
-- fixture chosen but the same PlayHQ game. Other Team has o1, played.
insert into public.playhq_seasons (playhq_season_id, name, url, season) values
  ('s1', 'Sample League', 'https://www.playhq.com/netball-australia/org/sample-association/sample-league/abc123', 2026);
insert into public.playhq_teams (playhq_team_id, playhq_season_id, playhq_name, team_id) values
  ('pt-a2', 's1', 'Sample Team', '00000000-0000-0000-0000-0000000000a2'),
  ('pt-b2', 's1', 'Other Team', '00000000-0000-0000-0000-0000000000b2');
insert into public.fixtures (id, playhq_game_id, playhq_team_id, team_id, team_name, opponent, round_name, starts_at, is_home, status) values
  (pg_temp.m('f1'), 'r1', 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Swans', 'Round 1', now() - interval '35 days', true, 'FINAL'),
  (pg_temp.m('f2'), 'r2', 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Hawks', 'Round 2', now() - interval '28 days', false, 'FINAL'),
  (pg_temp.m('f3'), 'r3', 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Kites', 'Round 3', now() - interval '21 days', false, 'FINAL'),
  (pg_temp.m('f4'), 'bye-round4-pt-a2', 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', null, 'Round 4', now() - interval '14 days', true, 'BYE'),
  (pg_temp.m('f5'), 'r5', 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Owls', 'Round 5', now() + interval '7 days', true, 'UPCOMING'),
  (pg_temp.m('f6'), 'r6', 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Terns', 'Round 6', now() - interval '2 days', true, 'FINAL'),
  (pg_temp.m('f7'), 'o1', 'pt-b2', '00000000-0000-0000-0000-0000000000b2', 'Other Team', 'Swans', 'Round 1', now() - interval '35 days', true, 'FINAL');
insert into public.games (id, team_id, fixture_id, playhq_game_id, config, status, recorder_id, pair_code, created_by) values
  (pg_temp.m('d2'), '00000000-0000-0000-0000-0000000000a2', pg_temp.m('f2'), 'r2', '{}', 'final', pg_temp.m('74'), '100002', pg_temp.m('74')),
  (pg_temp.m('d3'), '00000000-0000-0000-0000-0000000000a2', pg_temp.m('f3'), 'r3', '{}', 'live', pg_temp.m('74'), '100003', pg_temp.m('74')),
  (pg_temp.m('d6'), '00000000-0000-0000-0000-0000000000a2', null, 'r6', '{}', 'final', pg_temp.m('74'), '100006', pg_temp.m('74'));

-- ---------------------------------------------------------------------------
-- Every kind of member, Sample Team
-- ---------------------------------------------------------------------------
select pg_temp.check('admin', '01', 'a2', 'r3,r1');
select pg_temp.check('statistician', '74', 'a2', 'r3,r1');
select pg_temp.check('head coach of Sample Squad and Sample Team', '11', 'a2', 'r3,r1');
select pg_temp.check('assistant coach of Sample Squad only', '42', 'a2', 'r3,r1');
select pg_temp.check('manager of Sample Squad only', '13', 'a2', 'r3,r1');
select pg_temp.check('Sample Squad coach whose check lapsed', '12', 'a2', 'refused');
select pg_temp.check('stood-down Sample Squad coach', '73', 'a2', 'refused');
select pg_temp.check('physio on Sample Squad', '14', 'a2', 'refused');
select pg_temp.check('coach of Other Squad', '71', 'a2', 'refused');
select pg_temp.check('manager of Other Team', '72', 'a2', 'refused');
select pg_temp.check('committee, check expired', '21', 'a2', 'refused');
select pg_temp.check('committee, no check', '22', 'a2', 'refused');
select pg_temp.check('committee, exempt', '23', 'a2', 'refused');
select pg_temp.check('athlete under 18 in the team', '31', 'a2', 'refused');
select pg_temp.check('adult athlete in the squad', '32', 'a2', 'refused');
select pg_temp.check('guardian', '41', 'a2', 'refused');
select pg_temp.is('someone signed out can''t call it', pg_temp.games('', 'a2'), 'no access');

-- The other way: Other Team's list goes to its own staff, not Sample's.
select pg_temp.check('coach of Other Squad, Other Team', '71', 'b2', 'o1');
select pg_temp.check('manager of Other Team, Other Team', '72', 'b2', 'o1');
select pg_temp.check('head coach of Sample Team, Other Team', '11', 'b2', 'refused');
select pg_temp.check('admin, Other Team', '01', 'b2', 'o1');
select pg_temp.check('admin, a team with no PlayHQ games (the squad)', '01', 'a1', '');
select pg_temp.check('admin, a team that doesn''t exist', '01', 'ee', '');
select pg_temp.check('coach, a team that doesn''t exist', '11', 'ee', 'refused');

-- ---------------------------------------------------------------------------
-- What the list holds
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.is('each game carries what the function needs',
  (select (g - 'starts_at')::text from jsonb_array_elements(public.playhq_unrecorded_games(pg_temp.m('a2'))->'games') g where g->>'playhq_game_id' = 'r1'),
  jsonb_build_object('fixture_id', pg_temp.m('f1'), 'playhq_game_id', 'r1', 'tenant', 'netball-australia', 'opponent', 'Swans', 'round_name', 'Round 1', 'is_home', true)::text);
select pg_temp.ok('with when it was played',
  (select (g->>'starts_at')::timestamptz < now() - interval '34 days' from jsonb_array_elements(public.playhq_unrecorded_games(pg_temp.m('a2'))->'games') g where g->>'playhq_game_id' = 'r1'), true);

-- Names: an athlete's registered name and the name the lineup uses.
update public.profiles set preferred_name = 'JJ Junior' where id = pg_temp.m('31');
select pg_temp.is('athletes'' registered and lineup names come with it',
  (public.playhq_unrecorded_games(pg_temp.m('a2'))->'names')::text,
  (select jsonb_agg(jsonb_build_object('registered', p.full_name, 'lineup', case when p.id = pg_temp.m('31') then 'JJ Junior' else p.full_name end) order by p.full_name)
   from public.team_members tm join public.profiles p on p.id = tm.profile_id
   where tm.team_id = pg_temp.m('a2') and tm.team_role = 'athlete')::text);
select pg_temp.ok('and Jordan is among them',
  public.playhq_unrecorded_games(pg_temp.m('a2'))->'names' @> '[{"registered": "Jordan Junior", "lineup": "JJ Junior"}]', true);
select pg_temp.ok('coaches, managers and parents are not',
  not (public.playhq_unrecorded_games(pg_temp.m('a2'))->'names')::text like any (array['%Casey Coach%', '%Emery Manager%', '%Logan Parent%']), true);

-- A recording that reaches full time takes its game off the list.
update public.games set status = 'final' where id = pg_temp.m('d3');
select pg_temp.is('a game recorded to full time leaves the list', pg_temp.games('11', 'a2'), 'r1');

-- A competition whose link isn't a PlayHQ one gives no site, so no games.
update public.playhq_seasons set url = 'https://example.test/somewhere' where playhq_season_id = 's1';
select pg_temp.is('no PlayHQ site in the link, no games', pg_temp.games('11', 'a2'), '');
update public.playhq_seasons set url = 'https://www.playhq.com/netball-australia/org/sample-association/sample-league/abc123' where playhq_season_id = 's1';

-- At most 40, the newest.
insert into public.fixtures (playhq_game_id, playhq_team_id, team_id, team_name, opponent, starts_at, is_home)
select 'x' || n, 'pt-a2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Team ' || n, now() - make_interval(days => 100 + n), true
from generate_series(1, 45) n;
select pg_temp.as_member('11');
select pg_temp.is('40 games at most',
  jsonb_array_length(public.playhq_unrecorded_games(pg_temp.m('a2'))->'games')::text, '40');
select pg_temp.is('the newest first',
  public.playhq_unrecorded_games(pg_temp.m('a2'))->'games'->0->>'playhq_game_id', 'r1');

-- Rights end with the role.
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = pg_temp.m('13');
select pg_temp.check('manager who left Sample Squad', '13', 'a2', 'refused');
update public.profiles set stood_down_at = now() where id = pg_temp.m('11');
select pg_temp.check('head coach once stood down', '11', 'a2', 'refused');

select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nothing is stored: no new table',
  (select count(*) = 0 from pg_tables where schemaname = 'public' and tablename like 'playhq_result%'), true);
select pg_temp.ok('anon can''t run either function',
  not has_function_privilege('anon', 'public.playhq_unrecorded_games(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.may_view_team_games(uuid)', 'execute'), true);
