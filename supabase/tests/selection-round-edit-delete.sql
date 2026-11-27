-- Tests for 20261127700000_selection_round_edit_delete.sql: admins change a
-- round's name, description, dates and squad or team, and delete a round that
-- isn't running and has no assessment in it. A round with assessments is
-- refused, never cascaded. Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
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
create or replace function pg_temp.save(p_round text, p_name text, p_from integer, p_to integer,
  p_description text default null, p_team text default null) returns text language plpgsql as
$$ begin return format('select public.admin_save_selection_round(%L, %L, %L, %L, null, null, %L, %L)',
     pg_temp.round(p_round), p_name, pg_temp.d(p_from), pg_temp.d(p_to), p_description,
     case when p_team is null then null else pg_temp.g(p_team) end); end $$;
create or replace function pg_temp.observe(p_round text) returns text language sql as
$$ select format($f$select public.save_assessment_observation(null, %L, %L, 'training', %L, 'Note', '[{"item_key": "passing", "rating": 2}]')$f$,
     pg_temp.round(p_round), pg_temp.id('31'), public.club_today()) $$;
create or replace function pg_temp.on_panel(p_round text) returns text language sql as
$$ select coalesce(string_agg(profile_name, ',' order by profile_name), '-') from public.selection_round_panel
   where round_id = pg_temp.round(p_round) and removed_at is null $$;
create or replace function pg_temp.delete(p_round text) returns text language sql as
$$ select format('select public.admin_delete_selection_round(%L)', pg_temp.round(p_round)) $$;
create or replace function pg_temp.flags(p_round text) returns text language sql as
$$ select can_delete || ' ' || can_change_team from public.admin_selection_rounds() where name = p_round $$;

-- Squads and teams: a1 Sample Squad, a2 Sample Team (in a1), a3 Second Team
-- (in a1, coached by 42), b1 Other Squad, b2 Old Team (archived), c1 Next
-- Year Squad (next season).
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000a3', 'Second Team', 'team', '00000000-0000-0000-0000-0000000000a1', 3);
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 4);
insert into public.teams (id, name, kind, sort_order, archived) values
  ('00000000-0000-0000-0000-0000000000b2', 'Old Team', 'team', 5, true);
insert into public.teams (id, name, kind, sort_order, season) values
  ('00000000-0000-0000-0000-0000000000c1', 'Next Year Squad', 'squad', 6, extract(year from now())::int + 1);
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000032', 'athlete'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000042', 'coach');

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('rounds have a description column',
  exists (select 1 from information_schema.columns where table_name = 'selection_rounds' and column_name = 'description'), true);
select pg_temp.ok('members can''t read the deleted rounds table',
  has_table_privilege('authenticated', 'public.selection_round_deletions', 'select'), false);
select pg_temp.ok('anon can''t read the deleted rounds table',
  has_table_privilege('anon', 'public.selection_round_deletions', 'select'), false);
select pg_temp.ok('the deleted rounds table has row level security',
  (select relrowsecurity from pg_class where oid = 'public.selection_round_deletions'::regclass), true);
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.selection_round_has_assessments(uuid)',
    'public.selection_round_running(public.selection_rounds)']) f), false);
select pg_temp.ok('anon can call none of the new or changed functions',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.admin_save_selection_round(uuid, text, date, date, integer, integer, text, uuid)',
    'public.admin_delete_selection_round(uuid)',
    'public.admin_selection_round_deletions(integer)',
    'public.admin_selection_rounds()', 'public.selection_round_sheet(uuid)']) f), false);
select pg_temp.ok('one version of each changed function',
  (select bool_and(c = 1) from (select count(*) c from pg_proc where proname in
    ('admin_save_selection_round', 'admin_delete_selection_round', 'admin_selection_rounds',
     'selection_round_sheet') group by proname) x), true);

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a criteria set for everyone',
  $$select public.admin_save_criteria_set(null, 'Club set', pg_temp.crit(), true, null)$$);

-- ---------------------------------------------------------------------------
-- Name, description and dates
-- ---------------------------------------------------------------------------

select pg_temp.open('a team round coming up', 'a2', 'Trials', 10, 20);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a description', pg_temp.save('Trials', 'Trials', 10, 20, 'At the state centre. Bring kit.'));
select pg_temp.eq('the description is saved',
  (select description from public.selection_rounds where name = 'Trials'), 'At the state centre. Bring kit.');
select pg_temp.eq('adding it is kept as a change',
  (select detail from public.selection_round_events where round_id = pg_temp.round('Trials') and kind = 'description'),
  'Description added');
select pg_temp.works('saving without a description (an older app)', pg_temp.save('Trials', 'Trials', 10, 20, null));
select pg_temp.eq('keeps the description',
  (select description from public.selection_rounds where name = 'Trials'), 'At the state centre. Bring kit.');
select pg_temp.eq('and adds no change', pg_temp.events('Trials', 'description'), '1 Alex Admin');
select pg_temp.fails('a description over 500 characters is refused', pg_temp.save('Trials', 'Trials', 10, 20, repeat('x', 501)));
select pg_temp.works('the name and dates change', pg_temp.save('Trials', 'Final trials', 12, 22, 'At the state centre. Bring kit.'));
select pg_temp.eq('both are kept as changes',
  pg_temp.events('Final trials', 'renamed') || ' / ' || pg_temp.events('Final trials', 'dates'), '1 Alex Admin / 1 Alex Admin');
select pg_temp.works('an empty description clears it', pg_temp.save('Final trials', 'Final trials', 12, 22, '  '));
select pg_temp.ok('the description is gone',
  (select description is null from public.selection_rounds where name = 'Final trials'), true);
select pg_temp.eq('taking it off is kept as a change',
  (select string_agg(detail, ',' order by at) from public.selection_round_events
   where round_id = pg_temp.round('Final trials') and kind = 'description'), 'Description added,Description taken off');
select pg_temp.works('the description goes back on', pg_temp.save('Final trials', 'Final trials', 12, 22, 'Bring kit.'));
select pg_temp.m_ok('11', 'the panel''s round sheet gives the description',
  format($$(select s ->> 'description' from public.selection_round_sheet(%L) s) = 'Bring kit.'$$, pg_temp.round('Final trials')), true);
select pg_temp.m_ok('01', 'the admin''s list gives the description',
  $$(select description from public.admin_selection_rounds() where name = 'Final trials') = 'Bring kit.'$$, true);
select pg_temp.m_ok(n, 'member ' || n || ' (athlete or parent) gets the round but not its description',
  $$(select bool_and(not (to_jsonb(i) ? 'description')) and count(*) > 0 from public.my_selection_info() i)$$, true)
from unnest(array['31', '41']) n;

select pg_temp.m_fails(n, 'member ' || n || ' is refused a change to a round',
  pg_temp.save('Final trials', 'Hacked', 12, 22, 'x'))
from unnest(array['11', '12', '13', '14', '21', '22', '23', '31', '32', '41', '42', '51']) n;
select pg_temp.as_member('01');
select pg_temp.eq('and nothing changed',
  (select name || ' ' || description from public.selection_rounds where id = pg_temp.round('Final trials')), 'Final trials Bring kit.');

-- ---------------------------------------------------------------------------
-- Changing the squad or team
-- ---------------------------------------------------------------------------

select pg_temp.eq('the team round starts with its coach on the panel', pg_temp.on_panel('Final trials'), 'Casey Coach');
select pg_temp.m_ok('01', 'an upcoming round with nothing written can change team and be deleted',
  $$pg_temp.flags('Final trials') = 'true true'$$, true);
select pg_temp.as_member('01');
select pg_temp.works('an admin moves the round to another team', pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'a3'));
select pg_temp.eq('the round is now for that team',
  (select team_name || ' ' || (team_id = pg_temp.g('a3'))::text from public.selection_rounds where id = pg_temp.round('Final trials')),
  'Second Team true');
select pg_temp.eq('the move is kept as a change',
  (select detail from public.selection_round_events where round_id = pg_temp.round('Final trials') and kind = 'team'),
  'From Sample Team to Second Team');
select pg_temp.eq('the old team''s coach left the panel and the new team''s coach joined', pg_temp.on_panel('Final trials'), 'Morgan Coach-Parent');
select pg_temp.eq('the coach who left is kept as removed',
  (select removed_by_name from public.selection_round_panel
   where round_id = pg_temp.round('Final trials') and profile_id = pg_temp.id('11')), 'Alex Admin');
select pg_temp.eq('the round keeps its set (it is for everyone)',
  (select count(*)::text from public.selection_round_events where round_id = pg_temp.round('Final trials') and kind = 'criteria'), '0');

select pg_temp.open('a squad round on other days', 'a1', 'Squad round', 30, 40);
select pg_temp.as_member('01');
select pg_temp.fails('moving to a team whose squad has a round on the same days is refused',
  pg_temp.save('Squad round', 'Squad round', 15, 25, null, 'a3'));
select pg_temp.fails('moving onto overlapping days of the same squad is refused',
  pg_temp.save('Final trials', 'Final trials', 30, 35, null, 'a1'));
select pg_temp.eq('the refused move changed nothing',
  (select team_name || ' ' || starts_on from public.selection_rounds where id = pg_temp.round('Final trials')),
  'Second Team ' || pg_temp.d(12));
select pg_temp.fails('an archived team is refused', pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'b2'));
select pg_temp.fails('a squad from another season is refused', pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'c1'));

-- Phase and round number are one per squad or team a season.
select pg_temp.open('phase 1 round 1 for the other squad', 'b1', 'Other P1R1', 50, 60, 1, 1);
select pg_temp.as_member('01');
select pg_temp.works('this round becomes phase 1 round 1', format(
  'select public.admin_save_selection_round(%L, %L, %L, %L, 1, 1)', pg_temp.round('Final trials'), 'Final trials', pg_temp.d(12), pg_temp.d(22)));
select pg_temp.fails('moving it to a squad that already has phase 1 round 1 is refused',
  pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'b1'));

-- A set for only one group: moving away from it takes the new group's set.
select pg_temp.works('an admin adds a set just for Second Team',
  format($$select public.admin_save_criteria_set(null, 'Second set', pg_temp.crit('Kicking'), false, array[%L]::uuid[])$$, pg_temp.g('a3')));
select pg_temp.works('the round takes that set', format('select public.admin_set_selection_round_criteria(%L, %L)',
  pg_temp.round('Final trials'), pg_temp.set_id('Second set')));
select pg_temp.works('then moves to Sample Team', pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'a2'));
select pg_temp.eq('and takes the set for everyone, with a copy of its criteria',
  (select criteria_set_name || ' ' || (criteria -> 'groups' -> 0 -> 'items' -> 0 ->> 'name') from public.selection_rounds
   where id = pg_temp.round('Final trials')), 'Club set Passing');
select pg_temp.ok('the set change is kept and says why',
  (select detail from public.selection_round_events where round_id = pg_temp.round('Final trials') and kind = 'criteria'
   order by at desc limit 1) like '%Second set%Club set%the set for Sample Team', true);
select pg_temp.works('the set for everyone is archived', format(
  'update public.assessment_criteria_sets set archived_at = now() where id = %L', pg_temp.set_id('Club set')));
select pg_temp.fails('moving to a group no set is for is refused', pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'a1'));
select pg_temp.ok('and says so',
  pg_temp.fails('x', pg_temp.save('Final trials', 'Final trials', 12, 22, null, 'a1')) like '%No criteria set is for Sample Squad%', true);
update public.assessment_criteria_sets set archived_at = null where name = 'Club set';

-- Closed rounds and rounds with assessments keep their group.
select pg_temp.clear();
select pg_temp.open('a running team round', 'a2', 'Running', -2, 10);
select pg_temp.m_ok('01', 'a running round with nothing written can change team but not be deleted',
  $$pg_temp.flags('Running') = 'false true'$$, true);
select pg_temp.as_member('11');
select pg_temp.works('a selector writes an observation', pg_temp.observe('Running'));
select pg_temp.m_ok('01', 'once assessing starts it can do neither',
  $$pg_temp.flags('Running') = 'false false'$$, true);
select pg_temp.as_member('01');
select pg_temp.fails('moving a round with an observation is refused', pg_temp.save('Running', 'Running', -2, 10, null, 'a3'));
select pg_temp.ok('and says why',
  pg_temp.fails('x', pg_temp.save('Running', 'Running', -2, 10, null, 'a3')) like '%Assessing has started, so this round stays with Sample Team%', true);
select pg_temp.works('its name, description and dates can still change', pg_temp.save('Running', 'Running round', -3, 12, 'Notes'));
select pg_temp.works('passing the same team is not a move', pg_temp.save('Running round', 'Running round', -3, 12, 'Notes', 'a2'));
select pg_temp.works('an admin closes it', format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Running round')));
select pg_temp.open('an upcoming round', 'a3', 'Upcoming', 30, 40);
select pg_temp.as_member('01');
select pg_temp.works('an admin closes the upcoming round', format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Upcoming')));
select pg_temp.fails('moving a closed round is refused', pg_temp.save('Upcoming', 'Upcoming', 30, 40, null, 'a2'));
select pg_temp.m_ok('01', 'a closed round with nothing written can be deleted but not moved',
  $$pg_temp.flags('Upcoming') = 'true false'$$, true);

-- ---------------------------------------------------------------------------
-- Deleting a round
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.open('an upcoming squad round', 'a1', 'Upcoming', 10, 20, 1, 1);
select pg_temp.as_member('01');
select pg_temp.works('with a date', format('select public.admin_save_selection_milestone(null, %L, %L, %L, false)',
  pg_temp.round('Upcoming'), 'Shortlist', pg_temp.d(15)));
select pg_temp.works('and a renamed name', pg_temp.save('Upcoming', 'Upcoming trials', 10, 20, 'Bring kit.'));
create temp table kept_round as select id from public.selection_rounds where name = 'Upcoming trials';
select pg_temp.m_fails(n, 'member ' || n || ' is refused deleting a round', pg_temp.delete('Upcoming trials'))
from unnest(array['11', '12', '13', '14', '21', '22', '23', '31', '32', '41', '42', '51']) n;
select pg_temp.set_feature(false);
select pg_temp.m_fails('01', 'an admin is refused with the switch off', pg_temp.delete('Upcoming trials'));
select pg_temp.set_feature(true);
select pg_temp.ok('the round is still there', pg_temp.round('Upcoming trials') is not null, true);

select pg_temp.as_member('01');
select pg_temp.works('an admin deletes the upcoming round', pg_temp.delete('Upcoming trials'));
select pg_temp.ok('the round is gone', exists (select 1 from public.selection_rounds where id = (select id from kept_round)), false);
select pg_temp.ok('its panel, dates and changes went with it',
  exists (select 1 from public.selection_round_panel where round_id = (select id from kept_round))
  or exists (select 1 from public.selection_round_milestones where round_id = (select id from kept_round))
  or exists (select 1 from public.selection_round_events where round_id = (select id from kept_round)), false);
select pg_temp.eq('a record of it is kept',
  (select team_name || ' / ' || name || ' / ' || phase || '-' || round_number || ' / ' || deleted_by_name || ' / ' || description
   from public.selection_round_deletions where round_id = (select id from kept_round)),
  'Sample Squad / Upcoming trials / 1-1 / Alex Admin / Bring kit.');
select pg_temp.eq('with its change history',
  (select string_agg(h ->> 'kind', ',' order by h ->> 'at') from public.selection_round_deletions d,
   jsonb_array_elements(d.history) h where d.round_id = (select id from kept_round)), 'opened,renamed,description');
select pg_temp.eq('the admin sees it in the season''s deleted rounds',
  (select string_agg(name || ' ' || deleted_by_name, ',') from public.admin_selection_round_deletions(extract(year from now())::int)),
  'Upcoming trials Alex Admin');
select pg_temp.eq('and not in another season''s',
  (select count(*)::text from public.admin_selection_round_deletions(extract(year from now())::int + 1)), '0');
select pg_temp.m_fails(n, 'member ' || n || ' is refused the deleted rounds',
  'select public.admin_selection_round_deletions(null)')
from unnest(array['11', '13', '21', '23', '31', '41', '42', '51']) n;
select pg_temp.as_member('01');
select pg_temp.works('the same phase and round can be used again', format(
  'select public.admin_open_selection_round(%L, %L, %L, %L, %L, 1, 1)', pg_temp.g('a1'), 'Again', pg_temp.d(10), pg_temp.d(20), pg_temp.set_id('Club set')));

-- Running rounds and rounds with assessments.
select pg_temp.clear();
select pg_temp.open('a running round', 'a2', 'Running', -2, 10);
select pg_temp.as_member('01');
select pg_temp.fails('deleting a running round is refused', pg_temp.delete('Running'));
select pg_temp.ok('and says to close it first',
  pg_temp.fails('x', pg_temp.delete('Running')) like '%This round is running. Close it first%', true);
select pg_temp.works('closing it', format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Running')));
select pg_temp.works('a closed round with nothing written can be deleted', pg_temp.delete('Running'));

select pg_temp.open('a running round with an observation', 'a2', 'Assessed', -2, 10);
select pg_temp.as_member('11');
select pg_temp.works('a selector writes an observation', pg_temp.observe('Assessed'));
select pg_temp.as_member('01');
select pg_temp.works('closing it', format('select public.admin_close_selection_round(%L, true)', pg_temp.round('Assessed')));
create temp table counts_before as
  select (select count(*) from public.selection_rounds) rounds, (select count(*) from public.assessment_observations) obs,
    (select count(*) from public.assessment_observation_ratings) ratings, (select count(*) from public.selection_round_panel) panel;
select pg_temp.fails('deleting a round with an observation is refused, even closed', pg_temp.delete('Assessed'));
select pg_temp.ok('and says to keep it closed',
  pg_temp.fails('x', pg_temp.delete('Assessed')) like '%Assessments have been written in this round, so it can’t be deleted%', true);
select pg_temp.ok('nothing was lost',
  (select (count(*) filter (where true)) from public.selection_rounds) = (select rounds from counts_before)
  and (select count(*) from public.assessment_observations) = (select obs from counts_before)
  and (select count(*) from public.assessment_observation_ratings) = (select ratings from counts_before)
  and (select count(*) from public.selection_round_panel) = (select panel from counts_before), true);
select pg_temp.eq('no record of a deletion was kept', (select count(*)::text from public.selection_round_deletions where name = 'Assessed'), '0');

-- A summary, feedback or release alone also counts as an assessment.
select pg_temp.open('a past round', 'b1', 'Past', 100, 110);
update public.selection_rounds set starts_on = pg_temp.d(-30), ends_on = pg_temp.d(-20) where name = 'Past';
select pg_temp.as_member('01');
select pg_temp.m_ok('01', 'an ended round with nothing written can be deleted', $$pg_temp.flags('Past') = 'true true'$$, true);
insert into public.assessment_summaries (round_id, athlete_id, author_id, author_name)
  select pg_temp.round('Past'), pg_temp.id('32'), pg_temp.id('11'), 'Casey Coach';
select pg_temp.m_ok('01', 'a summary alone stops a delete', $$pg_temp.flags('Past') = 'false false'$$, true);
select pg_temp.fails('and the delete is refused', pg_temp.delete('Past'));
