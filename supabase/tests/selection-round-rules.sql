-- Tests for 20261127200000_selection_phase_round_no_overlap.sql: phase and
-- round number, rounds set up ahead of time, no two rounds for the same
-- athletes on the same days, observations dated inside their round, and a
-- record of every change to a round. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
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
-- The same checks, first acting as sample member n, so one statement can run
-- a check for each kind of member and still print one line per check.
create or replace function pg_temp.m_ok(n text, label text, expression text, expected boolean) returns text language plpgsql as
$$ declare v boolean; begin perform pg_temp.as_member(n); execute 'select ' || expression into v;
   return pg_temp.ok(label, v, expected); end $$;
create or replace function pg_temp.m_fails(n text, label text, statement text) returns text language plpgsql as
$$ begin perform pg_temp.as_member(n); return pg_temp.fails(label, statement); end $$;
create or replace function pg_temp.set_feature(p_on boolean) returns void language sql as
$$ update public.club_settings set features = features || jsonb_build_object('selectionAssessments', p_on) where id $$;
create or replace function pg_temp.crit(p_item text default 'Passing') returns jsonb language sql as
$$ select jsonb_build_object('groups', jsonb_build_array(jsonb_build_object('key', 'skills', 'name', 'Skills',
     'scale', '["Below", "Meets", "Exceeds"]'::jsonb,
     'items', jsonb_build_array(jsonb_build_object('key', 'passing', 'name', p_item)))),
     'recommendations', '["Select", "Not this time"]'::jsonb) $$;
create or replace function pg_temp.set_id(p_name text) returns uuid language sql as
$$ select id from public.assessment_criteria_sets where name = p_name and archived_at is null $$;
create or replace function pg_temp.round(p_name text) returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
create or replace function pg_temp.d(n integer) returns date language sql as $$ select public.club_today() + n $$;
-- Squads and teams: a1 Sample Squad, a2 Sample Team (in a1), a3 Second Team
-- (in a1), b1 Other Squad.
create or replace function pg_temp.g(k text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || k)::uuid $$;
-- Opens a round as admin 01 and says whether it opened.
create or replace function pg_temp.open(p_label text, p_team text, p_name text, p_from integer, p_to integer,
  p_phase integer default null, p_round integer default null) returns text language plpgsql as
$$ begin perform pg_temp.as_member('01');
   return pg_temp.works(p_label, format('select public.admin_open_selection_round(%L, %L, %L, %L, %L, %L, %L)',
     pg_temp.g(p_team), p_name, pg_temp.d(p_from), pg_temp.d(p_to), pg_temp.set_id('Club set'), p_phase, p_round)); end $$;
create or replace function pg_temp.open_fails(p_label text, p_team text, p_name text, p_from integer, p_to integer,
  p_phase integer default null, p_round integer default null) returns text language plpgsql as
$$ begin perform pg_temp.as_member('01');
   return pg_temp.fails(p_label, format('select public.admin_open_selection_round(%L, %L, %L, %L, %L, %L, %L)',
     pg_temp.g(p_team), p_name, pg_temp.d(p_from), pg_temp.d(p_to), pg_temp.set_id('Club set'), p_phase, p_round)); end $$;
create or replace function pg_temp.events(p_round text, p_kind text) returns text language sql as
$$ select count(*) || ' ' || coalesce(string_agg(distinct e.by_name, ','), '-')
   from public.selection_round_events e where e.round_id = pg_temp.round(p_round) and e.kind = p_kind $$;
-- Starts again with no rounds (a test database only).
create or replace function pg_temp.clear() returns void language sql as $$ delete from public.selection_rounds $$;

insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000a3', 'Second Team', 'team', '00000000-0000-0000-0000-0000000000a1', 3);
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 4);
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000032', 'athlete');
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('51'), 'guest.rr@example.test', now());
update public.profiles set status = 'approved', full_name = 'Gus Guest', role = 'guest' where id = pg_temp.id('51');

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('the old one-open-round index is gone',
  exists (select 1 from pg_indexes where indexname = 'selection_rounds_one_open'), false);
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.selection_round_last_day(date, timestamptz)',
    'public.selection_round_clashes(uuid, date, date, uuid)',
    'public.check_selection_round_overlap()',
    'public.selection_round_label(integer, integer)',
    'public.selection_round_order_problem(uuid, integer, integer, integer, date, uuid)']) f), false);
select pg_temp.ok('anon can call none of the changed functions',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.admin_selection_round_clashes(uuid, date, date, uuid)',
    'public.admin_open_selection_round(uuid, text, date, date, uuid, integer, integer)',
    'public.admin_save_selection_round(uuid, text, date, date, integer, integer, text, uuid)',
    'public.my_selection_rounds()', 'public.my_selection_info()']) f), false);
select pg_temp.ok('one version of each changed function',
  (select bool_and(c = 1) from (select count(*) c from pg_proc where proname in
    ('admin_open_selection_round', 'admin_save_selection_round', 'admin_selection_rounds',
     'my_selection_rounds', 'my_selection_info') group by proname) x), true);

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a criteria set for everyone',
  $$select public.admin_save_criteria_set(null, 'Club set', pg_temp.crit(), true, null)$$);

-- ---------------------------------------------------------------------------
-- No overlapping rounds for the same athletes
-- ---------------------------------------------------------------------------

select pg_temp.open('a squad round opens', 'a1', 'Squad A', 0, 20);
select pg_temp.open_fails('the same squad on overlapping days is refused', 'a1', 'Squad B', 10, 30);
select pg_temp.eq('the refusal names the other round',
  (select substr(pg_temp.open_fails('x', 'a1', 'Squad B', 10, 30), 1, 400) like '%“Squad A”%Sample Squad%')::text, 'true');
select pg_temp.open_fails('a team of the squad on overlapping days is refused', 'a2', 'Team A', 5, 8);
select pg_temp.open_fails('a one-day overlap is refused (ends the day the other starts)', 'a1', 'Squad early', -10, 0);
select pg_temp.open('back to back is allowed (starts the day after)', 'a1', 'Squad next', 21, 40);
select pg_temp.ok('two rounds for one squad are both open (no one-open-round rule)',
  (select count(*) from public.selection_rounds where team_id = pg_temp.g('a1') and closed_at is null) = 2, true);
select pg_temp.open('a different squad on the same days is allowed', 'b1', 'Other A', 0, 20);
select pg_temp.clear();
select pg_temp.open('a team round opens', 'a2', 'Team A', 0, 20);
select pg_temp.open('another team of the same squad on the same days is allowed', 'a3', 'Second A', 0, 20);
select pg_temp.open_fails('then its squad on overlapping days is refused', 'a1', 'Squad A', 15, 30);
select pg_temp.open('the squad after both teams is allowed', 'a1', 'Squad A', 21, 30);

-- Changing a round.
select pg_temp.as_member('01');
select pg_temp.fails('moving a round''s dates into a clash is refused',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Squad A'), 'Squad A', pg_temp.d(18), pg_temp.d(30)));
select pg_temp.works('changing only the name isn''t checked',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Squad A'), 'Squad A renamed', pg_temp.d(21), pg_temp.d(30)));

-- Closing early frees the days after the day it closed.
select pg_temp.clear();
select pg_temp.open('a long squad round opens', 'a1', 'Long', -5, 40);
select pg_temp.works('it closes today',
  format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Long')));
select pg_temp.open_fails('a round starting today still clashes (closed today counts today)', 'a1', 'Today', 0, 10);
select pg_temp.open('a round starting tomorrow is allowed', 'a1', 'Tomorrow', 1, 10);
select pg_temp.fails('reopening the first is refused while the later one sits on its days',
  format('select public.admin_close_selection_round(%L, false)', pg_temp.round('Long')));
select pg_temp.works('a round closed before it started blocks nothing: Tomorrow closes',
  format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Tomorrow')));
select pg_temp.open('and another round can take tomorrow', 'a1', 'Tomorrow again', 1, 10);

-- Rounds that overlapped before this migration aren't refused until changed.
select pg_temp.clear();
alter table public.selection_rounds disable trigger selection_rounds_no_overlap;
select pg_temp.open('an old round', 'a1', 'Old one', 0, 20);
select pg_temp.open('an old round on the same days', 'a1', 'Old two', 5, 25);
alter table public.selection_rounds enable trigger selection_rounds_no_overlap;
select pg_temp.as_member('01');
select pg_temp.works('renaming one of them is allowed',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Old two'), 'Old two renamed', pg_temp.d(5), pg_temp.d(25)));
select pg_temp.fails('moving its dates is refused while it still overlaps',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Old two renamed'), 'Old two renamed', pg_temp.d(6), pg_temp.d(25)));

-- ---------------------------------------------------------------------------
-- Phase and round number
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.open_fails('a phase without a round is refused', 'a1', 'P', 0, 10, 1, null);
select pg_temp.open_fails('a round without a phase is refused', 'a1', 'P', 0, 10, null, 1);
select pg_temp.open_fails('phase 10 is refused', 'a1', 'P', 0, 10, 10, 1);
select pg_temp.open_fails('round 21 is refused', 'a1', 'P', 0, 10, 1, 21);
select pg_temp.open_fails('phase 0 is refused', 'a1', 'P', 0, 10, 0, 1);
select pg_temp.open('Phase 1, Round 1 opens with no name', 'a1', '', 0, 10, 1, 1);
select pg_temp.eq('the name defaults to the label',
  (select name || ' ' || phase || '/' || round_number from public.selection_rounds where team_id = pg_temp.g('a1')), 'Phase 1, Round 1 1/1');
select pg_temp.eq('the opened event names the phase, round and set',
  (select detail from public.selection_round_events where round_id = pg_temp.round('Phase 1, Round 1') and kind = 'opened'),
  'Phase 1, Round 1 · Club set, version 1');
select pg_temp.open_fails('the same number twice in a season is refused', 'a1', 'Again', 20, 30, 1, 1);
select pg_temp.eq('and says which round has it',
  (select pg_temp.open_fails('x', 'a1', 'Again', 20, 30, 1, 1) like '%already has Phase 1, Round 1%')::text, 'true');
select pg_temp.open('Phase 1, Round 3 set up ahead, with a name', 'a1', 'Trials', 41, 60, 1, 3);
select pg_temp.open_fails('a later number can''t start before an earlier one', 'a1', 'Early', 61, 70, 1, 2);
select pg_temp.open_fails('an earlier number can''t start after a later one', 'a1', 'Late', 11, 20, 2, 1);
select pg_temp.open('Phase 1, Round 2 fits between them', 'a1', 'Middle', 11, 40, 1, 2);
select pg_temp.open('another squad can use Phase 1, Round 1 too', 'b1', '', 0, 10, 1, 1);
select pg_temp.open('the old call without phase still works', 'a2', 'Plain old', 70, 80);
select pg_temp.as_member('01');
select pg_temp.fails('the old call still needs a name',
  format('select public.admin_open_selection_round(%L, %L, %L, %L)', pg_temp.g('a3'), '', pg_temp.d(90), pg_temp.d(95)));
select pg_temp.eq('admin_selection_rounds gives phase and round number',
  (select string_agg(coalesce(phase || '/' || round_number, '-'), ',' order by starts_on)
   from public.admin_selection_rounds() where team_id = pg_temp.g('a1')), '1/1,1/2,1/3');

-- ---------------------------------------------------------------------------
-- Observation dates
-- ---------------------------------------------------------------------------

select pg_temp.clear();
alter table public.selection_rounds disable trigger selection_rounds_no_overlap;
select pg_temp.open('a round that started 10 days ago and ended yesterday', 'a1', 'Past', -10, -1);
alter table public.selection_rounds enable trigger selection_rounds_no_overlap;
select pg_temp.as_member('11');
select pg_temp.fails('an observation before the start is refused',
  format($f$select public.save_assessment_observation(null, %L, %L, 'training', %L, 'Note', '[{"item_key": "passing", "rating": 2}]')$f$,
    pg_temp.round('Past'), pg_temp.id('32'), pg_temp.d(-11)));
select pg_temp.fails('an observation after the end is refused',
  format($f$select public.save_assessment_observation(null, %L, %L, 'training', %L, 'Note', '[{"item_key": "passing", "rating": 2}]')$f$,
    pg_temp.round('Past'), pg_temp.id('32'), pg_temp.d(0)));
select pg_temp.ok('and says the round ended',
  pg_temp.fails('x', format($f$select public.save_assessment_observation(null, %L, %L, 'training', %L, 'Note', '[{"item_key": "passing", "rating": 2}]')$f$,
    pg_temp.round('Past'), pg_temp.id('32'), pg_temp.d(0))) like '%The round ended on%Choose a day in the round%', true);
select pg_temp.works('the last day is allowed',
  format($f$select public.save_assessment_observation(null, %L, %L, 'training', %L, 'Note', '[{"item_key": "passing", "rating": 2}]')$f$,
    pg_temp.round('Past'), pg_temp.id('32'), pg_temp.d(-1)));
select pg_temp.as_member('01');
select pg_temp.fails('an end date before an observation is refused',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Past'), 'Past', pg_temp.d(-10), pg_temp.d(-2)));

-- ---------------------------------------------------------------------------
-- Every change is kept
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.open('a round to change', 'a1', 'Kept', 0, 10, 1, 1);
select pg_temp.as_member('01');
select pg_temp.eq('opening adds one event, by the admin', pg_temp.events('Kept', 'opened'), '1 Alex Admin');
select pg_temp.works('a save that changes nothing',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Kept'), 'Kept', pg_temp.d(0), pg_temp.d(10)));
select pg_temp.eq('adds no event', (select count(*)::text from public.selection_round_events where round_id = pg_temp.round('Kept')), '1');
select pg_temp.works('renaming',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Kept'), 'Kept 2', pg_temp.d(0), pg_temp.d(10)));
select pg_temp.eq('adds a renamed event', pg_temp.events('Kept 2', 'renamed'), '1 Alex Admin');
select pg_temp.eq('saying what it was',
  (select detail from public.selection_round_events where round_id = pg_temp.round('Kept 2') and kind = 'renamed'), 'From “Kept” to “Kept 2”');
select pg_temp.as_member('02');
select pg_temp.works('another admin changes the dates',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Kept 2'), 'Kept 2', pg_temp.d(0), pg_temp.d(12)));
select pg_temp.eq('adds a dates event by them', pg_temp.events('Kept 2', 'dates'), '1 Blair Admin');
select pg_temp.works('changing phase and round',
  format('select public.admin_save_selection_round(%L, %L, %L, %L, 1, 2)', pg_temp.round('Kept 2'), 'Kept 2', pg_temp.d(0), pg_temp.d(12)));
select pg_temp.eq('adds a phase event',
  (select detail from public.selection_round_events where round_id = pg_temp.round('Kept 2') and kind = 'phase'),
  'From Phase 1, Round 1 to Phase 1, Round 2');
select pg_temp.works('saving without phase keeps it',
  format('select public.admin_save_selection_round(%L, %L, %L, %L)', pg_temp.round('Kept 2'), 'Kept 2', pg_temp.d(0), pg_temp.d(12)));
select pg_temp.eq('phase unchanged, no new event',
  (select r.phase || '/' || r.round_number || ' ' || (select count(*) from public.selection_round_events e where e.round_id = r.id)
   from public.selection_rounds r where r.name = 'Kept 2'), '1/2 4');
select pg_temp.works('closing', format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Kept 2')));
select pg_temp.works('closing again', format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Kept 2')));
select pg_temp.eq('adds one closed event', pg_temp.events('Kept 2', 'closed'), '1 Blair Admin');
select pg_temp.works('reopening', format('select public.admin_close_selection_round(%L, false)', pg_temp.round('Kept 2')));
select pg_temp.works('reopening again', format('select public.admin_close_selection_round(%L, false)', pg_temp.round('Kept 2')));
select pg_temp.eq('adds one reopened event', pg_temp.events('Kept 2', 'reopened'), '1 Blair Admin');

-- ---------------------------------------------------------------------------
-- The clash check for the screen
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.open('a squad round', 'a1', 'First', 0, 20);
select pg_temp.open('a team round after it', 'a2', 'Second', 21, 30);
select pg_temp.as_member('01');
select pg_temp.eq('an admin sees both clashes and the day after the later one',
  (select string_agg(round_name, ',' order by starts_on) || ' ' || max(free_from)
   from public.admin_selection_round_clashes(pg_temp.g('a1'), pg_temp.d(5), pg_temp.d(25))),
  'First,Second ' || pg_temp.d(31));
select pg_temp.eq('the round itself is left out when its id is passed',
  (select string_agg(round_name, ',') from public.admin_selection_round_clashes(pg_temp.g('a1'), pg_temp.d(5), pg_temp.d(25), pg_temp.round('First'))),
  'Second');
select pg_temp.eq('no clash, no rows',
  (select count(*)::text from public.admin_selection_round_clashes(pg_temp.g('b1'), pg_temp.d(5), pg_temp.d(25))), '0');
select pg_temp.m_fails(n, 'member ' || n || ' is refused the clash check',
  format('select public.admin_selection_round_clashes(%L, %L, %L)', pg_temp.g('a1'), pg_temp.d(5), pg_temp.d(25)))
from unnest(array['11', '12', '13', '14', '21', '22', '23', '31', '32', '41', '42', '51']) n;
select pg_temp.set_feature(false);
select pg_temp.m_fails('01', 'an admin is refused with the switch off',
  format('select public.admin_selection_round_clashes(%L, %L, %L)', pg_temp.g('a1'), pg_temp.d(5), pg_temp.d(25)));
select pg_temp.set_feature(true);

-- ---------------------------------------------------------------------------
-- Athletes and parents
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.open('a squad round now', 'a1', 'Squad now', 0, 20, 1, 2);
select pg_temp.open('a team round coming up', 'a2', 'Team later', 21, 40, 2, 1);
select pg_temp.m_ok('31', 'an athlete in the squad and team sees both rounds, phase, round and set',
  $$(select string_agg(round_name || ' ' || phase || '/' || round_number || ' ' || criteria_set_name, ',' order by starts_on)
     from public.my_selection_info()) = 'Squad now 1/2 Club set,Team later 2/1 Club set'$$, true);
select pg_temp.m_ok('41', 'a verified parent sees the same for their child',
  $$(select string_agg(round_name || ' ' || phase || '/' || round_number || ' ' || criteria_set_name, ',' order by starts_on)
     from public.my_selection_info()) = 'Squad now 1/2 Club set,Team later 2/1 Club set'$$, true);
select pg_temp.m_ok('41', 'the row has no set id',
  $$(select bool_or(k like '%set_id%') from public.my_selection_info() i, jsonb_object_keys(to_jsonb(i)) k)$$, false);
select pg_temp.m_ok(n, 'member ' || n || ' gets no rows', '(select count(*) = 0 from public.my_selection_info())', true)
from unnest(array['01', '11', '13', '14', '21', '22', '23', '51']) n;
select pg_temp.m_ok('11', 'a selector''s rounds give phase, round and set, running first',
  $$(select string_agg(name || ' ' || phase || '/' || round_number || ' ' || criteria_set_name, ',')
     from public.my_selection_rounds()) = 'Squad now 1/2 Club set,Team later 2/1 Club set'$$, true);
select pg_temp.m_ok('11', 'the sheet gives phase, round and set name but no set id',
  format($$(select (s ->> 'phase') || '/' || (s ->> 'round_number') || ' ' || (s ->> 'criteria_set_name') || ' ' || (s ? 'criteria_set_id')::text
     from public.selection_round_sheet(%L) s) = '1/2 Club set false'$$, pg_temp.round('Squad now')), true);
