-- Tests for 20261123500000_selection_game_evidence.sql: the games an athlete
-- played during a selection round, for the panel, and who is told an
-- athlete's figures from a recorded game. The athlete's coaches are told as
-- before; a selector who can assess the athlete is told for games played in
-- the round, and nobody else is. Run on a fresh database with the migrations
-- and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.eq(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- The same checks, first acting as sample member n.
create or replace function pg_temp.m_ok(n text, label text, expression text, expected boolean) returns text language plpgsql as
$$ declare v boolean; begin perform pg_temp.as_member(n); execute 'select ' || expression into v;
   return pg_temp.ok(label, v, expected); end $$;
create or replace function pg_temp.m_eq(n text, label text, expression text, expected text) returns text language plpgsql as
$$ declare v text; begin perform pg_temp.as_member(n); execute 'select (' || expression || ')::text' into v;
   return pg_temp.eq(label, v, expected); end $$;
create or replace function pg_temp.round(p_name text default 'Sample selections') returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
create or replace function pg_temp.date_id(p_title text) returns uuid language sql as
$$ select id from public.selection_round_milestones where title = p_title order by created_at limit 1 $$;
create or replace function pg_temp.set_feature(p_on boolean) returns void language sql as
$$ update public.club_settings set features = features || jsonb_build_object('selectionAssessments', p_on) where id $$;
create or replace function pg_temp.fx(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
-- Whether the game-stats function would be told there are figures, as this member, as the app asks.
create or replace function pg_temp.told(n text, athlete text, fixture text) returns boolean language plpgsql as
$$ declare r jsonb; begin
     perform set_config('request.jwt.claim.sub', case when n = '' then '' else pg_temp.id(n)::text end, false);
     set local role authenticated;
     r := public.goal_game_stats_access(pg_temp.id(athlete), pg_temp.fx(fixture));
     reset role;
     return r is not null;
   end $$;
create or replace function pg_temp.lists(p_round uuid, n text) returns boolean language plpgsql as
$$ begin perform public.selection_round_games(p_round, pg_temp.id(n)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.games(athlete text) returns text language sql as
$$ select coalesce(string_agg(opponent || ' ' || recorded, ', '), 'none') from public.selection_round_games(pg_temp.round(), pg_temp.id(athlete)) $$;
create or replace function pg_temp.views(n text) returns bigint language sql as
$$ select count(*) from public.record_access_log l where l.subject_id = pg_temp.id(n) and l.kind like 'assessment%' $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;

-- A guest with a current check (an independent selector), and a statistician.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('62'), 'guest.checked@example.test', now()),
  (pg_temp.id('61'), 'stats@example.test', now());
update public.profiles p set status = 'approved', full_name = 'Ola Selector', role = 'guest',
  wwcc_number = 'WWC0062', wwcc_expires_on = public.club_today() + 400, verified_at = now()
where p.id = pg_temp.id('62');
update public.profiles p set status = 'approved', full_name = 'Sam Stats', role = 'statistician',
  wwcc_number = 'WWC0061', wwcc_expires_on = public.club_today() + 400, verified_at = now()
where p.id = pg_temp.id('61');

-- The Sample Squad's games. The round runs from 20 days ago to 40 days on.
--   f1 Stars    5 days ago, recorded and finished
--   f2 Planets  3 days ago, never recorded
--   f3 Moons    2 days ago, recording still live
--   f4 Comets   30 days ago, recorded: before the round
--   f5 Suns     in 3 days: not played yet
--   f6 a bye    4 days ago
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  (pg_temp.fx('f1'), pg_temp.id('a1'), 'Sample Squad', 'Stars', 'Round 5', now() - interval '5 days'),
  (pg_temp.fx('f2'), pg_temp.id('a1'), 'Sample Squad', 'Planets', 'Round 6', now() - interval '3 days'),
  (pg_temp.fx('f3'), pg_temp.id('a1'), 'Sample Squad', 'Moons', 'Round 7', now() - interval '2 days'),
  (pg_temp.fx('f4'), pg_temp.id('a1'), 'Sample Squad', 'Comets', 'Round 1', now() - interval '30 days'),
  (pg_temp.fx('f5'), pg_temp.id('a1'), 'Sample Squad', 'Suns', 'Round 8', now() + interval '3 days'),
  (pg_temp.fx('f6'), pg_temp.id('a1'), 'Sample Squad', null, 'Bye', now() - interval '4 days');
insert into public.games (id, team_id, fixture_id, config, status, recorder_id, created_by, created_at, finished_at) values
  (pg_temp.fx('d1'), pg_temp.id('a1'), pg_temp.fx('f1'), '{"us":"Sample Squad","them":"Stars"}', 'final', pg_temp.id('61'), pg_temp.id('61'), now() - interval '5 days', now() - interval '119 hours'),
  (pg_temp.fx('d3'), pg_temp.id('a1'), pg_temp.fx('f3'), '{"us":"Sample Squad","them":"Moons"}', 'live', pg_temp.id('61'), pg_temp.id('61'), now() - interval '2 days', null),
  (pg_temp.fx('d4'), pg_temp.id('a1'), pg_temp.fx('f4'), '{"us":"Sample Squad","them":"Comets"}', 'final', pg_temp.id('61'), pg_temp.id('61'), now() - interval '30 days', now() - interval '719 hours');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('anon cannot list a round''s games', has_function_privilege('anon', 'public.selection_round_games(uuid, uuid)', 'execute'), false);
select pg_temp.ok('signed-in members can ask (it checks who they are)', has_function_privilege('authenticated', 'public.selection_round_games(uuid, uuid)', 'execute'), true);
select pg_temp.ok('nobody calls the helper themselves',
  has_function_privilege('anon', 'public.selects_athlete_for_game(uuid, uuid)', 'execute')
  or has_function_privilege('authenticated', 'public.selects_athlete_for_game(uuid, uuid)', 'execute'), false);
select pg_temp.ok('all three run as their owner with a fixed search path',
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where proname in ('goal_game_stats_access', 'selection_round_games', 'selects_athlete_for_game') and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('there is still one goal_game_stats_access',
  (select count(*) from pg_proc where proname = 'goal_game_stats_access' and pronamespace = 'public'::regnamespace) = 1, true);

-- ---------------------------------------------------------------------------
-- Before any round: figures are for the athlete's coaches only, as before
-- ---------------------------------------------------------------------------

select pg_temp.ok(who || ': told Kai''s figures with no round open', pg_temp.told(n, '32', 'f1'), told)
from (values
  ('11', 'the squad''s head coach', true),
  ('42', 'the squad''s assistant coach', true),
  ('62', 'a guest with a check', false),
  ('01', 'an admin', false),
  ('32', 'the athlete', false)
) as v(n, who, told);

-- ---------------------------------------------------------------------------
-- A round for the Sample Squad. Panel: Casey (11, head coach), Morgan (42,
-- assistant, parent of Jordan 31), Ola (62, guest) and Alex (01, admin).
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.set_feature(true);
select pg_temp.works('an admin saves criteria', $$select public.admin_save_assessment_criteria(
  '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
    "items": [{"key": "passing", "name": "Passing"}]}]}'::jsonb)$$);
select pg_temp.works('opens a round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Sample selections',
    public.club_today() - 20, public.club_today() + 40)$$);
select pg_temp.works('adds the guest selector',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.works('and themselves',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('01'))$$);

-- Who may list an athlete's games in the round, and who is told the figures
-- from the recorded one, for every kind of member.
select pg_temp.m_ok(n, who || ': lists Kai''s games in the round', 'pg_temp.lists(pg_temp.round(), ''32'')', kai)
  || E'\n' || pg_temp.m_ok(n, who || ': lists Jordan''s games in the round', 'pg_temp.lists(pg_temp.round(), ''31'')', jordan)
  || E'\n' || pg_temp.ok(who || ': told Kai''s figures from the recorded game', pg_temp.told(n, '32', 'f1'), kai)
  || E'\n' || pg_temp.ok(who || ': told Jordan''s figures from the recorded game', pg_temp.told(n, '31', 'f1'), jordan_told)
from (values
  ('11', 'the head coach on the panel', true, true, true),
  ('62', 'a guest selector with a check', true, true, true),
  ('01', 'an admin on the panel', true, true, true),
  ('02', 'an admin off the panel', false, false, false),
  -- Morgan can't assess Jordan, their own child, but coaches the squad, so is told as a coach, as before.
  ('42', 'a coach on the panel who is Jordan''s parent', true, false, true),
  ('12', 'a coach whose check lapsed', false, false, false),
  ('13', 'a manager', false, false, false),
  ('14', 'a physio', false, false, false),
  ('21', 'the committee', false, false, false),
  ('61', 'the statistician who recorded it', false, false, false),
  ('31', 'an athlete under 18 in the round', false, false, false),
  ('32', 'an adult athlete in the round', false, false, false),
  ('41', 'a parent of an athlete in the round', false, false, false)
) as v(n, who, kai, jordan, jordan_told);
select pg_temp.ok('nobody signed out is told', pg_temp.told('', '32', 'f1'), false);

-- Which games.
select pg_temp.m_eq('62', 'the list is the games played in the round, newest first, with whether each has a finished recording',
  'pg_temp.games(''32'')', 'Moons false, Planets false, Stars true');
select pg_temp.m_eq('62', 'each with its day, team and round name',
  $$select team_name || ' / ' || round_name || ' / ' || (played_on = public.club_day(starts_at))
    from public.selection_round_games(pg_temp.round(), pg_temp.id('32')) where opponent = 'Stars'$$,
  'Sample Squad / Round 5 / true');
select pg_temp.ok('a selector is told nothing for a game before the round', pg_temp.told('62', '32', 'f4'), false);
select pg_temp.ok('though the athlete''s coach still is', pg_temp.told('11', '32', 'f4'), true);
select pg_temp.ok('nothing for a game nobody recorded', pg_temp.told('62', '32', 'f2'), false);
select pg_temp.ok('nothing while the recording is still live', pg_temp.told('62', '32', 'f3'), false);
select pg_temp.ok('nothing for a game still to be played', pg_temp.told('62', '32', 'f5'), false);
select pg_temp.ok('nothing for someone who isn''t an athlete in the round', pg_temp.told('62', '41', 'f1'), false);
select pg_temp.ok('nothing about themselves', pg_temp.told('62', '62', 'f1'), false);
select pg_temp.m_ok('62', 'the list refuses someone who isn''t an athlete in the round', 'pg_temp.lists(pg_temp.round(), ''41'')', false);
select pg_temp.as_member('62');
select pg_temp.fails('and a round that doesn''t exist',
  $$select * from public.selection_round_games('00000000-0000-0000-0000-00000000dead', pg_temp.id('32'))$$);
select pg_temp.ok('what a selector is told names the game and the athlete, like a coach',
  (select j ? 'game_id' and j ? 'names' and j ->> 'net_points' = 'true'
   from (select set_config('request.jwt.claim.sub', pg_temp.id('62')::text, false)) s,
        public.goal_game_stats_access(pg_temp.id('32'), pg_temp.fx('f1')) j), true);

-- The game's events stay closed to a selector: only the function reads them.
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
values (pg_temp.fx('d1'), 'primary', 1, gen_random_uuid(), 'period_start', '{}', now(), pg_temp.id('61'));
create or replace function pg_temp.reads_events(n text) returns bigint language plpgsql as
$$ declare r bigint; begin
     perform pg_temp.as_member(n);
     set local role authenticated;
     select count(*) into r from public.game_events;
     reset role;
     return r;
   end $$;
select pg_temp.ok('a guest selector reads no game events directly', pg_temp.reads_events('62') = 0, true);

-- Opening an under 18's games is recorded; an adult's isn't.
select pg_temp.ok('listing Jordan''s games went in Jordan''s record views', pg_temp.views('31') > 0, true);
select pg_temp.ok('nothing is recorded for Kai, an adult', pg_temp.views('32') = 0, true);

-- ---------------------------------------------------------------------------
-- When access ends
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), true);
select pg_temp.ok('the panel still reads a closed round, figures included', pg_temp.told('62', '32', 'f1'), true);
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), false);

select pg_temp.set_feature(false);
select pg_temp.ok('with the feature off a selector is told nothing', pg_temp.told('62', '32', 'f1'), false);
select pg_temp.m_ok('62', 'and lists nothing', 'pg_temp.lists(pg_temp.round(), ''32'')', false);
select pg_temp.ok('while the athlete''s coach is told, as before', pg_temp.told('11', '32', 'f1'), true);
select pg_temp.set_feature(true);

update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('62');
select pg_temp.ok('a selector whose check lapsed is told nothing', pg_temp.told('62', '32', 'f1'), false);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('62');
select pg_temp.ok('and is told again once it is current', pg_temp.told('62', '32', 'f1'), true);

select pg_temp.as_member('01');
select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('62'));
select pg_temp.ok('a selector taken off the panel is told nothing', pg_temp.told('62', '32', 'f1'), false);
select pg_temp.m_ok('62', 'and lists nothing', 'pg_temp.lists(pg_temp.round(), ''32'')', false);
select pg_temp.as_member('01');
select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('01'));
select pg_temp.ok('nor is an admin taken off it', pg_temp.told('01', '32', 'f1'), false);

-- The round is removed under Record keeping: nothing is left to give access.
select pg_temp.as_member('01');
select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'));
select pg_temp.ok('back on the panel, the guest is told again', pg_temp.told('62', '32', 'f1'), true);
delete from public.selection_rounds where name = 'Sample selections';
select pg_temp.ok('with the round gone a selector is told nothing', pg_temp.told('62', '32', 'f1'), false);
select pg_temp.ok('and the athlete''s coach is told, as before', pg_temp.told('11', '32', 'f1'), true);
