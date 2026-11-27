-- Tests for 20261127100000_criteria_sets.sql: several criteria sets, who a set
-- is for, archive or delete, a round choosing its set, and the calls an app
-- that hasn't updated still makes. Run on a fresh database with the
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
create or replace function pg_temp.events(p_set uuid, p_kind text) returns bigint language sql as
$$ select count(*) from public.assessment_criteria_set_events where set_id = p_set and kind = p_kind $$;
create or replace function pg_temp.sq() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
create or replace function pg_temp.tm() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a2'::uuid $$;
create or replace function pg_temp.osq() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000b1'::uuid $$;

insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('the new tables are closed to signed-in members: ' || t,
  has_table_privilege('authenticated', 'public.' || t, 'select')
  or has_table_privilege('authenticated', 'public.' || t, 'insert'), false)
from unnest(array['assessment_criteria_sets', 'assessment_criteria_set_groups',
  'assessment_criteria_set_events', 'selection_round_events']) t;
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.criteria_set_fits(uuid, uuid)', 'public.criteria_set_rounds(uuid)',
    'public.criteria_set_for_label(uuid)', 'public.criteria_set_default(uuid)',
    'public.criteria_item_count(jsonb)']) f), false);
select pg_temp.ok('anon can call none of the new functions',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.admin_criteria_sets()', 'public.admin_criteria_set(uuid)',
    'public.admin_save_criteria_set(uuid, text, jsonb, boolean, uuid[])',
    'public.admin_archive_criteria_set(uuid, boolean)', 'public.admin_delete_criteria_set(uuid)',
    'public.admin_selection_round_set_choices(uuid)',
    'public.admin_set_selection_round_criteria(uuid, uuid)',
    'public.admin_open_selection_round(uuid, text, date, date, uuid)']) f), false);
select pg_temp.ok('the four-argument open is gone (one version only)',
  (select count(*) from pg_proc where proname = 'admin_open_selection_round') = 1, true);

-- Re-run the migration's copy step on a club that had criteria: it makes
-- "Club criteria" once, marked as the old one, with a created event.
insert into public.assessment_criteria (id, criteria, updated_by, updated_at)
values (true, pg_temp.crit('Old passing'), pg_temp.id('01'), now());
insert into public.assessment_criteria_sets (name, criteria, for_all, legacy)
select 'Club criteria', c.criteria, true, true from public.assessment_criteria c
where c.id and not exists (select 1 from public.assessment_criteria_sets);
insert into public.assessment_criteria_set_events (set_id, set_name, kind, version, detail)
select s.id, s.name, 'created', 1, 'Made from the club’s criteria when criteria sets were added'
from public.assessment_criteria_sets s
where not exists (select 1 from public.assessment_criteria_set_events e where e.set_id = s.id);
select pg_temp.eq('the club''s criteria became "Club criteria"',
  (select criteria #>> '{groups,0,items,0,name}' from public.assessment_criteria_sets where legacy), 'Old passing');
select pg_temp.eq('with one created event', pg_temp.events(pg_temp.set_id('Club criteria'), 'created')::text, '1');
select pg_temp.eq('the old row is left as it was',
  (select criteria #>> '{groups,0,items,0,name}' from public.assessment_criteria where id), 'Old passing');
select pg_temp.eq('no round has used it yet', public.criteria_set_rounds(pg_temp.set_id('Club criteria'))::text, '0');
insert into public.selection_rounds (team_id, team_name, season, name, starts_on, ends_on, criteria, created_by_name)
values (pg_temp.osq(), 'Other Squad', 2026, 'Before sets', public.club_today(), public.club_today() + 10,
  pg_temp.crit('Old passing'), 'Alex Admin');
select pg_temp.eq('a round opened before sets counts as a use of it',
  public.criteria_set_rounds(pg_temp.set_id('Club criteria'))::text, '1');

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.fails('an admin with the switch off is refused the list', $$select public.admin_criteria_sets()$$);
select pg_temp.fails('an admin with the switch off can''t save a set',
  $$select public.admin_save_criteria_set(null, 'Off set', pg_temp.crit(), true, null)$$);
select pg_temp.set_feature(true);
select pg_temp.works('an admin with the switch on reads the list', $$select public.admin_criteria_sets()$$);

-- Everyone else, for every function: 11 coach (head coach), 12 lapsed coach,
-- 13 manager, 14 physio, 21/22/23 committee, 31 athlete under 18, 32 adult
-- athlete, 41 guardian, 42 coach-parent, 51 guest.
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('51'), 'guest.cs@example.test', now());
update public.profiles set status = 'approved', full_name = 'Gus Guest', role = 'guest' where id = pg_temp.id('51');
select pg_temp.m_fails(n, 'member ' || n || ' is refused ' || f, 'select ' || f)
from unnest(array['11', '12', '13', '14', '21', '22', '23', '31', '32', '41', '42', '51']) n,
  unnest(array[
    'public.admin_criteria_sets()',
    format('public.admin_criteria_set(%L)', pg_temp.set_id('Club criteria')),
    $f$public.admin_save_criteria_set(null, 'Sneaky', pg_temp.crit(), true, null)$f$,
    format('public.admin_archive_criteria_set(%L, true)', pg_temp.set_id('Club criteria')),
    format('public.admin_delete_criteria_set(%L)', pg_temp.set_id('Club criteria')),
    format('public.admin_selection_round_set_choices(%L)', pg_temp.sq()),
    format('public.admin_set_selection_round_criteria(%L, %L)', (select id from public.selection_rounds where name = 'Before sets'), pg_temp.set_id('Club criteria')),
    format($f$public.admin_open_selection_round(%L, 'Sneaky round', public.club_today(), public.club_today() + 5)$f$, pg_temp.sq()),
    'public.admin_selection_rounds()',
    'public.admin_assessment_criteria()',
    $f$public.admin_save_assessment_criteria(pg_temp.crit())$f$
  ]) f
order by n, f;
select pg_temp.eq('nothing was changed by those refusals',
  (select count(*) from public.assessment_criteria_sets)::text, '1');

-- A stood-down admin is refused too.
update public.profiles set stood_down_at = now() where id = pg_temp.id('02');
select pg_temp.m_fails('02', 'a stood-down admin is refused the list', 'select public.admin_criteria_sets()');
select pg_temp.m_fails('02', 'a stood-down admin can''t save a set',
  $$select public.admin_save_criteria_set(null, 'Stood', pg_temp.crit(), true, null)$$);
update public.profiles set stood_down_at = null where id = pg_temp.id('02');
select pg_temp.m_ok('02', 'and back in office, an admin reads the list',
  $$(select jsonb_typeof(public.admin_criteria_sets()) = 'array')$$, true);

-- ---------------------------------------------------------------------------
-- Saving a set
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.fails('a blank name is refused', $$select public.admin_save_criteria_set(null, '  ', pg_temp.crit(), true, null)$$);
select pg_temp.fails('a name over 60 characters is refused',
  format($$select public.admin_save_criteria_set(null, %L, pg_temp.crit(), true, null)$$, repeat('x', 61)));
select pg_temp.fails('a name another set has is refused, whatever its capitals',
  $$select public.admin_save_criteria_set(null, ' club CRITERIA ', pg_temp.crit(), true, null)$$);
select pg_temp.fails('a set with no groups is refused',
  $$select public.admin_save_criteria_set(null, 'Empty', '{"groups": []}', true, null)$$);
select pg_temp.fails('broken criteria are refused by the existing check',
  $$select public.admin_save_criteria_set(null, 'Broken', '{"groups": "x"}', true, null)$$);
select pg_temp.fails('only some squads needs at least one',
  $$select public.admin_save_criteria_set(null, 'Junior criteria', pg_temp.crit(), false, '{}')$$);
select pg_temp.fails('only some squads refuses an id that isn''t a squad or team',
  $$select public.admin_save_criteria_set(null, 'Junior criteria', pg_temp.crit(), false, array[gen_random_uuid()])$$);
select pg_temp.works('an admin makes a set for the Sample Squad',
  format($$select public.admin_save_criteria_set(null, ' Junior criteria ', pg_temp.crit('Junior passing'), false, array[%L::uuid])$$, pg_temp.sq()));
select pg_temp.eq('its name is trimmed and it starts at version 1',
  (select name || ' v' || version from public.assessment_criteria_sets where id = pg_temp.set_id('Junior criteria')), 'Junior criteria v1');
select pg_temp.eq('a created event says who it''s for',
  (select detail from public.assessment_criteria_set_events where set_id = pg_temp.set_id('Junior criteria') and kind = 'created'),
  'Sample Squad and its teams');
select pg_temp.eq('the event names who made it',
  (select by_name from public.assessment_criteria_set_events where set_id = pg_temp.set_id('Junior criteria') and kind = 'created'),
  'Alex Admin');
select pg_temp.works('a second set for everyone',
  $$select public.admin_save_criteria_set(null, 'Senior criteria', pg_temp.crit('Senior passing'), true, null)$$);

-- Changing a set: rename, scope and criteria, one event each.
select pg_temp.works('only the name changes',
  format($$select public.admin_save_criteria_set(%L, 'Junior set', pg_temp.crit('Junior passing'), false, array[%L::uuid])$$,
    pg_temp.set_id('Junior criteria'), pg_temp.sq()));
select pg_temp.eq('the version stays at 1', (select version::text from public.assessment_criteria_sets where id = pg_temp.set_id('Junior set')), '1');
select pg_temp.eq('a renamed event', (select detail from public.assessment_criteria_set_events
  where set_id = pg_temp.set_id('Junior set') and kind = 'renamed'), 'From “Junior criteria” to “Junior set”');
select pg_temp.eq('and no saved or for event', (pg_temp.events(pg_temp.set_id('Junior set'), 'saved')
  + pg_temp.events(pg_temp.set_id('Junior set'), 'for'))::text, '0');
select pg_temp.works('the criteria change',
  format($$select public.admin_save_criteria_set(%L, 'Junior set', pg_temp.crit('Junior passing 2'), false, array[%L::uuid])$$,
    pg_temp.set_id('Junior set'), pg_temp.sq()));
select pg_temp.eq('version 2', (select version::text from public.assessment_criteria_sets where id = pg_temp.set_id('Junior set')), '2');
select pg_temp.eq('a saved event with version 2 and the wording kept',
  (select version || ' ' || (criteria #>> '{groups,0,items,0,name}') from public.assessment_criteria_set_events
    where set_id = pg_temp.set_id('Junior set') and kind = 'saved'), '2 Junior passing 2');
select pg_temp.works('who it''s for changes to the team only',
  format($$select public.admin_save_criteria_set(%L, 'Junior set', pg_temp.crit('Junior passing 2'), false, array[%L::uuid])$$,
    pg_temp.set_id('Junior set'), pg_temp.tm()));
select pg_temp.eq('a for event with the new label', (select detail from public.assessment_criteria_set_events
  where set_id = pg_temp.set_id('Junior set') and kind = 'for'), 'Sample Team');
select pg_temp.eq('the version is still 2', (select version::text from public.assessment_criteria_sets where id = pg_temp.set_id('Junior set')), '2');
select pg_temp.works('back to the squad',
  format($$select public.admin_save_criteria_set(%L, 'Junior set', pg_temp.crit('Junior passing 2'), false, array[%L::uuid])$$,
    pg_temp.set_id('Junior set'), pg_temp.sq()));

-- ---------------------------------------------------------------------------
-- Which sets fit a squad or team, and the default
-- ---------------------------------------------------------------------------

select pg_temp.ok('a set for everyone fits any group', public.criteria_set_fits(pg_temp.set_id('Senior criteria'), pg_temp.osq()), true);
select pg_temp.ok('a squad''s set fits the squad', public.criteria_set_fits(pg_temp.set_id('Junior set'), pg_temp.sq()), true);
select pg_temp.ok('and its team', public.criteria_set_fits(pg_temp.set_id('Junior set'), pg_temp.tm()), true);
select pg_temp.ok('and not another squad', public.criteria_set_fits(pg_temp.set_id('Junior set'), pg_temp.osq()), false);
select pg_temp.works('a set for the team only',
  format($$select public.admin_save_criteria_set(null, 'Team only', pg_temp.crit(), false, array[%L::uuid])$$, pg_temp.tm()));
select pg_temp.ok('a team''s set doesn''t fit its squad', public.criteria_set_fits(pg_temp.set_id('Team only'), pg_temp.sq()), false);
select pg_temp.ok('a team''s set fits the team', public.criteria_set_fits(pg_temp.set_id('Team only'), pg_temp.tm()), true);
insert into public.assessment_criteria_sets (name, criteria, for_all) values ('No groups', '{"groups": []}', true);
select pg_temp.ok('a set with no groups fits nothing', public.criteria_set_fits(pg_temp.set_id('No groups'), pg_temp.sq()), false);
-- A set for the Other Squad, then the squad is archived and next season's squad of the same name made.
select pg_temp.works('a set for the Other Squad',
  format($$select public.admin_save_criteria_set(null, 'Other set', pg_temp.crit(), false, array[%L::uuid])$$, pg_temp.osq()));
update public.teams set archived = true where id = pg_temp.osq();
insert into public.teams (id, name, kind, sort_order, season) select '00000000-0000-0000-0000-0000000000b2', 'Other Squad', 'squad', 4, season + 1 from public.teams where id = pg_temp.osq();
select pg_temp.ok('it fits next season''s squad of the same name',
  public.criteria_set_fits(pg_temp.set_id('Other set'), '00000000-0000-0000-0000-0000000000b2'), true);
select pg_temp.eq('the label keeps the old squad''s name',
  public.criteria_set_for_label(pg_temp.set_id('Other set')), 'Other Squad and its teams');

select pg_temp.eq('one set named for the squad wins over sets for everyone',
  public.criteria_set_default(pg_temp.sq())::text, pg_temp.set_id('Junior set')::text);
select pg_temp.eq('two sets named for the team give no default', coalesce(public.criteria_set_default(pg_temp.tm())::text, 'none'), 'none');
select pg_temp.eq('the choices for the squad, by name, with the default marked',
  (select string_agg(name || case when is_default then '*' else '' end, ', ' order by name)
   from public.admin_selection_round_set_choices(pg_temp.sq())), 'Club criteria, Junior set*, Senior criteria');
select pg_temp.eq('the choices give counts and who it''s for',
  (select groups || '/' || items || ' ' || for_label from public.admin_selection_round_set_choices(pg_temp.sq())
   where name = 'Junior set'), '1/1 Sample Squad and its teams');

-- ---------------------------------------------------------------------------
-- Opening a round
-- ---------------------------------------------------------------------------

select pg_temp.works('an admin opens a squad round with the default (the old four-argument call)',
  format($$select public.admin_open_selection_round(%L, 'Squad round', public.club_today(), public.club_today() + 20)$$, pg_temp.sq()));
select pg_temp.eq('it took the squad''s set and version',
  (select criteria_set_name || ' v' || criteria_set_version || ' ' || (criteria #>> '{groups,0,items,0,name}')
   from public.selection_rounds where name = 'Squad round'), 'Junior set v2 Junior passing 2');
select pg_temp.eq('an opened event is written',
  (select e.detail from public.selection_round_events e join public.selection_rounds r on r.id = e.round_id
   where r.name = 'Squad round' and e.kind = 'opened'), 'Junior set, version 2');
select pg_temp.fails('with two sets named for the team and none chosen, it asks',
  format($$select public.admin_open_selection_round(%L, 'Team round', public.club_today(), public.club_today() + 20)$$, pg_temp.tm()));
select pg_temp.fails('a set that isn''t for the group is refused',
  format($$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b2', 'Wrong', public.club_today(), public.club_today() + 20, %L)$$,
    pg_temp.set_id('Junior set')));
select pg_temp.works('with a set chosen it opens',
  format($$select public.admin_open_selection_round(%L, 'Team round', public.club_today(), public.club_today() + 20, %L)$$,
    pg_temp.tm(), pg_temp.set_id('Team only')));
select pg_temp.works('the squad''s set changes to version 3',
  format($$select public.admin_save_criteria_set(%L, 'Junior set', pg_temp.crit('Junior passing 3'), false, array[%L::uuid])$$,
    pg_temp.set_id('Junior set'), pg_temp.sq()));
select pg_temp.eq('the round''s copy is unchanged',
  (select criteria_set_version || ' ' || (criteria #>> '{groups,0,items,0,name}') from public.selection_rounds where name = 'Squad round'),
  '2 Junior passing 2');
select pg_temp.eq('admin_selection_rounds gives the set and whether it can change',
  (select criteria_set_name || ' v' || criteria_set_version || ' ' || can_change_criteria
   from public.admin_selection_rounds() where name = 'Squad round'), 'Junior set v2 true');
select pg_temp.eq('an old round shows the old set''s name, no version',
  (select criteria_set_name || ' ' || coalesce(criteria_set_version::text, '-')
   from public.admin_selection_rounds() where name = 'Before sets'), 'Club criteria -');

-- ---------------------------------------------------------------------------
-- Changing a round's set
-- ---------------------------------------------------------------------------

select pg_temp.works('an admin changes the squad round to Senior criteria',
  format($$select public.admin_set_selection_round_criteria(%L, %L)$$,
    (select id from public.selection_rounds where name = 'Squad round'), pg_temp.set_id('Senior criteria')));
select pg_temp.eq('the round now has Senior''s criteria',
  (select criteria_set_name || ' v' || criteria_set_version || ' ' || (criteria #>> '{groups,0,items,0,name}')
   from public.selection_rounds where name = 'Squad round'), 'Senior criteria v1 Senior passing');
select pg_temp.eq('a criteria event says from and to',
  (select e.detail from public.selection_round_events e join public.selection_rounds r on r.id = e.round_id
   where r.name = 'Squad round' and e.kind = 'criteria'), 'From “Junior set” to “Senior criteria, version 1”');
select pg_temp.fails('a set that isn''t for the group is refused',
  format($$select public.admin_set_selection_round_criteria(%L, %L)$$,
    (select id from public.selection_rounds where name = 'Squad round'), pg_temp.set_id('Team only')));
select pg_temp.fails('an unknown round is refused',
  format($$select public.admin_set_selection_round_criteria(gen_random_uuid(), %L)$$, pg_temp.set_id('Senior criteria')));
insert into public.assessment_observations (round_id, athlete_id, author_id, author_name, context, observed_on, note)
select id, pg_temp.id('32'), pg_temp.id('11'), 'Casey Coach', 'training', public.club_today(), 'First look'
from public.selection_rounds where name = 'Squad round';
select pg_temp.fails('after an observation it is refused',
  format($$select public.admin_set_selection_round_criteria(%L, %L)$$,
    (select id from public.selection_rounds where name = 'Squad round'), pg_temp.set_id('Junior set')));
select pg_temp.eq('and admin_selection_rounds says so',
  (select can_change_criteria::text from public.admin_selection_rounds() where name = 'Squad round'), 'false');
insert into public.assessment_summaries (round_id, athlete_id, author_id, author_name)
select id, pg_temp.id('32'), pg_temp.id('11'), 'Casey Coach' from public.selection_rounds where name = 'Team round';
select pg_temp.fails('after a summary it is refused',
  format($$select public.admin_set_selection_round_criteria(%L, %L)$$,
    (select id from public.selection_rounds where name = 'Team round'), pg_temp.set_id('Senior criteria')));
update public.selection_rounds set closed_at = now() where name = 'Before sets';
select pg_temp.fails('a closed round is refused',
  format($$select public.admin_set_selection_round_criteria(%L, %L)$$,
    (select id from public.selection_rounds where name = 'Before sets'), pg_temp.set_id('Senior criteria')));
select pg_temp.eq('admin_selection_rounds says a closed round can''t change',
  (select can_change_criteria::text from public.admin_selection_rounds() where name = 'Before sets'), 'false');

-- ---------------------------------------------------------------------------
-- Archive, bring back, delete
-- ---------------------------------------------------------------------------

select pg_temp.fails('a used set can''t be deleted',
  format($$select public.admin_delete_criteria_set(%L)$$, pg_temp.set_id('Team only')));
select pg_temp.fails('nor can the old set a round before sets used',
  format($$select public.admin_delete_criteria_set(%L)$$, pg_temp.set_id('Club criteria')));
select pg_temp.works('a used set is archived',
  format($$select public.admin_archive_criteria_set(%L, true)$$, pg_temp.set_id('Team only')));
select pg_temp.eq('it is marked archived by whom',
  (select archived_by_name from public.assessment_criteria_sets where name = 'Team only'), 'Alex Admin');
select pg_temp.ok('an archived set fits nothing',
  public.criteria_set_fits((select id from public.assessment_criteria_sets where name = 'Team only'), pg_temp.tm()), false);
select pg_temp.fails('an archived set can''t be changed',
  format($$select public.admin_save_criteria_set(%L, 'Team only', pg_temp.crit(), true, null)$$,
    (select id from public.assessment_criteria_sets where name = 'Team only')));
select pg_temp.eq('archived sets come last in the list',
  (select string_agg(e ->> 'name', ', ' order by o) from jsonb_array_elements(public.admin_criteria_sets()) with ordinality a(e, o)),
  'Club criteria, Junior set, No groups, Other set, Senior criteria, Team only');
select pg_temp.works('a new set may take the archived set''s name',
  $$select public.admin_save_criteria_set(null, 'Team only', pg_temp.crit(), true, null)$$);
select pg_temp.fails('so the archived one can''t come back until one is renamed',
  format($$select public.admin_archive_criteria_set(%L, false)$$,
    (select id from public.assessment_criteria_sets where name = 'Team only' and archived_at is not null)));
select pg_temp.works('the new one is renamed',
  format($$select public.admin_save_criteria_set(%L, 'Team only B', pg_temp.crit(), true, null)$$, pg_temp.set_id('Team only')));
select pg_temp.works('then the archived one comes back',
  format($$select public.admin_archive_criteria_set(%L, false)$$,
    (select id from public.assessment_criteria_sets where name = 'Team only')));
select pg_temp.eq('archived and restored events',
  (pg_temp.events(pg_temp.set_id('Team only'), 'archived') || '/' || pg_temp.events(pg_temp.set_id('Team only'), 'restored')), '1/1');

create temp table gone (id uuid);
insert into gone select pg_temp.set_id('Team only B');
select pg_temp.works('an unused set is deleted', format($$select public.admin_delete_criteria_set(%L)$$, (select id from gone)));
select pg_temp.eq('it is gone from the list',
  (select count(*)::text from jsonb_array_elements(public.admin_criteria_sets()) e where (e ->> 'id')::uuid = (select id from gone)), '0');
select pg_temp.eq('its history stays, with a deleted event',
  (select string_agg(kind, ',' order by at, kind) from public.assessment_criteria_set_events where set_id = (select id from gone)),
  'created,renamed,deleted');
select pg_temp.fails('reading a deleted set says not found', format($$select public.admin_criteria_set(%L)$$, (select id from gone)));

-- ---------------------------------------------------------------------------
-- One set, in detail
-- ---------------------------------------------------------------------------

select pg_temp.eq('a set''s detail lists the rounds that used it',
  (select string_agg(r ->> 'name', ', ') from jsonb_array_elements(public.admin_criteria_set(pg_temp.set_id('Senior criteria')) -> 'rounds') r),
  'Squad round');
select pg_temp.eq('the old set lists rounds opened before sets',
  (select string_agg(r ->> 'name', ', ') from jsonb_array_elements(public.admin_criteria_set(pg_temp.set_id('Club criteria')) -> 'rounds') r),
  'Before sets');
select pg_temp.eq('events come newest first, without old wording',
  (select (e -> 0 ->> 'kind') || ' ' || (e -> 0 ? 'criteria')::text
   from (select public.admin_criteria_set(pg_temp.set_id('Team only')) -> 'events' e) x), 'restored false');
select pg_temp.eq('who it''s for is listed with names',
  (select f ->> 'team_name' from jsonb_array_elements(public.admin_criteria_set(pg_temp.set_id('Team only')) -> 'for') f), 'Sample Team');
select pg_temp.eq('the list gives counts and uses',
  (select (e ->> 'groups') || '/' || (e ->> 'items') || ' ' || (e ->> 'rounds') from jsonb_array_elements(public.admin_criteria_sets()) e
   where e ->> 'name' = 'Senior criteria'), '1/1 1');

-- ---------------------------------------------------------------------------
-- An app that hasn't updated
-- ---------------------------------------------------------------------------

select pg_temp.eq('the old read gives the oldest set in use',
  public.admin_assessment_criteria() #>> '{groups,0,items,0,name}', 'Old passing');
select pg_temp.works('the old save still works', $$select public.admin_save_assessment_criteria(pg_temp.crit('Saved the old way'))$$);
select pg_temp.eq('it saved into that set as a new version',
  (select version || ' ' || (criteria #>> '{groups,0,items,0,name}') from public.assessment_criteria_sets where legacy), '2 Saved the old way');
select pg_temp.eq('with a saved event', pg_temp.events(pg_temp.set_id('Club criteria'), 'saved')::text, '1');
select pg_temp.fails('the old save keeps the checks', $$select public.admin_save_assessment_criteria('{"groups": "x"}')$$);
