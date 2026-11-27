-- Tests for 20261127400000_selection_register.sql: the round record beside the
-- audit report (admins and the round's auditors) and the season register
-- (admins only), with staff names, counts and dates only. Run on a fresh
-- database with the migrations and seed-members.sql loaded.
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
create or replace function pg_temp.crit() returns jsonb language sql as
$$ select '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
     "items": [{"key": "passing", "name": "Passing"}]}], "recommendations": ["Select", "Not this time"]}'::jsonb $$;
create or replace function pg_temp.round(p_name text default 'Audited') returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
create or replace function pg_temp.views(n text, p_kind text) returns bigint language sql as
$$ select count(*) from public.record_access_log l where l.subject_id = pg_temp.id(n) and l.kind = p_kind $$;
create or replace function pg_temp.add(p_round uuid, n text) returns text language plpgsql as
$$ begin perform pg_temp.as_member('01');
   return pg_temp.works('an admin adds ' || n || ' as auditor', format('select public.admin_add_selection_auditor(%L, %L)', p_round, pg_temp.id(n))); end $$;


create or replace function pg_temp.reg(p_season integer default null) returns jsonb language sql as
$$ select public.admin_selection_register(p_season) $$;
create or replace function pg_temp.r(p_name text) returns jsonb language sql as
$$ select x from jsonb_array_elements(pg_temp.reg() -> 'rounds') x where x ->> 'name' = p_name $$;
create or replace function pg_temp.rec(p_name text default 'Squad trials') returns jsonb language sql as
$$ select public.admin_selection_round_record(pg_temp.round(p_name)) $$;

-- Sample people: 71 an auditor (committee, current check), 72 a committee
-- member auditing another round, 51 a guest. Groups: Sample Squad (a1) and
-- its Sample Team (a2), Other Squad (b1), and Spare Team (b2) with no round.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('71'), 'auditor.reg@example.test', now()),
  (pg_temp.id('72'), 'auditor.other@example.test', now()),
  (pg_temp.id('51'), 'guest.reg@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = public.club_today() + 400, verified_at = now()
from (values
  ('71', 'Ari Auditor', 'committee', 'WWC0071'),
  ('72', 'Oz Auditor', 'committee', 'WWC0072'),
  ('51', 'Gus Guest', 'guest', 'WWC0051')
) v(n, name, role, wwcc)
where p.id = pg_temp.id(v.n);
insert into public.teams (id, name, kind, sort_order, season)
select v.id::uuid, v.name, v.kind::public.group_kind, v.ord, t.season
from (values ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3),
             ('00000000-0000-0000-0000-0000000000b2', 'Spare Team', 'team', 4)) v(id, name, kind, ord),
  (select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1') t;

-- ---------------------------------------------------------------------------
-- The migration
-- ---------------------------------------------------------------------------

select pg_temp.ok('anon can call neither function',
  has_function_privilege('anon', 'public.admin_selection_register(integer)', 'execute')
  or has_function_privilege('anon', 'public.admin_selection_round_record(uuid)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Rounds with something in them
-- ---------------------------------------------------------------------------

select pg_temp.set_feature(true);
select pg_temp.as_member('01');
select pg_temp.works('an admin adds Junior criteria', $$select public.admin_save_criteria_set(null, 'Junior criteria', pg_temp.crit(), true, null)$$);
select pg_temp.works('an admin opens the squad round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Squad trials', public.club_today() - 5, public.club_today() + 20, (select id from public.assessment_criteria_sets where name = 'Junior criteria'), 1, 1)$$);
select pg_temp.works('the team''s round after it',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a2', 'Team trials', public.club_today() + 30, public.club_today() + 40, (select id from public.assessment_criteria_sets where name = 'Junior criteria'), 2, 1)$$);
select pg_temp.works('and the other squad''s round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b1', 'Other trials', public.club_today() - 5, public.club_today() + 20, (select id from public.assessment_criteria_sets where name = 'Junior criteria'), 1, 1)$$);
select pg_temp.works('renames the squad round', format(
  $$select public.admin_save_selection_round(%L, 'Squad trials', public.club_today() - 5, public.club_today() + 21, 1, 1)$$, pg_temp.round('Squad trials')));
select pg_temp.works('adds Ari as the squad round''s auditor', format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round('Squad trials'), pg_temp.id('71')));
select pg_temp.works('adds Oz to the other round', format('select public.admin_add_selection_auditor(%L, %L)', pg_temp.round('Other trials'), pg_temp.id('72')));
select pg_temp.as_member('11');
select pg_temp.works('the head coach writes about Kai',
  $$select public.save_assessment_observation(null, pg_temp.round('Squad trials'), pg_temp.id('32'), 'training', public.club_today(), 'Zesty evidence words', '[{"item_key": "passing", "rating": 3}]')$$);
select pg_temp.works('twice',
  $$select public.save_assessment_observation(null, pg_temp.round('Squad trials'), pg_temp.id('32'), 'game', public.club_today(), null, '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.works('signs a summary of Kai',
  $$select public.save_assessment_summary(pg_temp.round('Squad trials'), pg_temp.id('32'), '[{"item_key": "passing", "rating": 3}]', 'Select', 'Quokka strengths', 'Quokka priorities', 'Quokka comments', true)$$);
select pg_temp.works('shares feedback with Kai',
  $$select public.save_assessment_feedback(pg_temp.round('Squad trials'), pg_temp.id('32'), 'Wombat went well', 'Wombat work on', true)$$);

-- ---------------------------------------------------------------------------
-- Who may
-- ---------------------------------------------------------------------------

select pg_temp.m_fails(n, 'member ' || n || ' is refused the register', 'select public.admin_selection_register()')
from unnest(array['11', '12', '13', '14', '21', '22', '23', '31', '32', '41', '42', '51', '71', '72']) n;
select pg_temp.m_ok('01', 'an admin builds the register', 'public.admin_selection_register() is not null', true);
select pg_temp.m_ok('01', 'an admin reads a round record', format('public.admin_selection_round_record(%L) is not null', pg_temp.round('Squad trials')), true);
select pg_temp.m_ok('71', 'the round''s auditor reads its record', format('public.admin_selection_round_record(%L) is not null', pg_temp.round('Squad trials')), true);
select pg_temp.m_fails(n, 'member ' || n || ' is refused the squad round''s record',
  format('select public.admin_selection_round_record(%L)', pg_temp.round('Squad trials')))
from unnest(array['72', '11', '42', '12', '13', '14', '21', '31', '32', '41', '51']) n;
select pg_temp.m_fails('01', 'an unknown round is not found', format('select public.admin_selection_round_record(%L)', gen_random_uuid()));

select pg_temp.set_feature(false);
select pg_temp.m_fails(n, 'with the switch off member ' || n || ' is refused the register', 'select public.admin_selection_register()')
from unnest(array['01', '71']) n;
select pg_temp.m_fails(n, 'with the switch off member ' || n || ' is refused the record',
  format('select public.admin_selection_round_record(%L)', pg_temp.round('Squad trials')))
from unnest(array['01', '71']) n;
select pg_temp.set_feature(true);

-- ---------------------------------------------------------------------------
-- The round record
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.eq('the set and version', (select (x ->> 'set_name') || ' v' || (x ->> 'version') from (select pg_temp.rec() -> 'criteria' x) y), 'Junior criteria v1');
select pg_temp.eq('counted from the round''s copy', (select (x ->> 'groups') || '/' || (x ->> 'items') || '/' || (x ->> 'recommendations') from (select pg_temp.rec() -> 'criteria' x) y), '1/1/2');
select pg_temp.eq('the set is unchanged', pg_temp.rec() #>> '{criteria,set_state}', 'same');
select pg_temp.eq('who saved that version', pg_temp.rec() #>> '{criteria,saved_by_name}', (select by_name from public.assessment_criteria_set_events where set_name = 'Junior criteria' and kind = 'created'));
select pg_temp.ok('and when', (pg_temp.rec() #>> '{criteria,saved_at}') is not null, true);
select pg_temp.eq('who the set is for', pg_temp.rec() #>> '{criteria,for_label}', 'Every squad and team');
select pg_temp.eq('events oldest first, with the kinds part 2 writes',
  (select string_agg(e ->> 'kind', ',' order by o) from jsonb_array_elements(pg_temp.rec() -> 'events') with ordinality t(e, o)), 'opened,dates');
select pg_temp.works('an admin saves the set again', format($$select public.admin_save_criteria_set(%L, 'Junior criteria',
  '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"], "items": [{"key": "passing", "name": "Passing"}, {"key": "catching", "name": "Catching"}]}, {"key": "x", "name": "X", "scale": ["A", "B", "C"], "items": [{"key": "y", "name": "Y"}]}]}'::jsonb, true, null)$$,
  (select id from public.assessment_criteria_sets where name = 'Junior criteria')));
select pg_temp.eq('now changed', pg_temp.rec() #>> '{criteria,set_state}', 'changed');
select pg_temp.eq('the set is at version 2', pg_temp.rec() #>> '{criteria,set_version}', '2');
select pg_temp.eq('the round keeps version 1', pg_temp.rec() #>> '{criteria,version}', '1');
select pg_temp.eq('and its own counts', (select (x ->> 'groups') || '/' || (x ->> 'items') from (select pg_temp.rec() -> 'criteria' x) y), '1/1');
update public.assessment_criteria_sets set archived_at = now() where name = 'Junior criteria';
select pg_temp.eq('archived', pg_temp.rec() #>> '{criteria,set_state}', 'archived');
update public.assessment_criteria_sets set archived_at = null where name = 'Junior criteria';
alter table public.selection_rounds disable trigger selection_rounds_no_overlap;
update public.selection_rounds set criteria_set_id = null, criteria_set_name = null, criteria_set_version = null where name = 'Team trials';
alter table public.selection_rounds enable trigger selection_rounds_no_overlap;
select pg_temp.eq('a round from before criteria sets is legacy', pg_temp.rec('Team trials') #>> '{criteria,set_state}', 'legacy');
select pg_temp.ok('with no version', (pg_temp.rec('Team trials') #>> '{criteria,version}') is null, true);
-- No set has this id: skip the foreign key check for this one row.
set session_replication_role = replica;
update public.selection_rounds set criteria_set_id = gen_random_uuid() where name = 'Team trials';
select pg_temp.eq('a set that is gone is deleted', pg_temp.rec('Team trials') #>> '{criteria,set_state}', 'deleted');
select pg_temp.ok('and has no label', (pg_temp.rec('Team trials') #>> '{criteria,for_label}') is null, true);
set session_replication_role = origin;
update public.selection_rounds set criteria_set_id = (select id from public.assessment_criteria_sets where name = 'Junior criteria'), criteria_set_name = 'Junior criteria', criteria_set_version = 2 where name = 'Team trials';

-- ---------------------------------------------------------------------------
-- The register
-- ---------------------------------------------------------------------------

select pg_temp.eq('this season''s rounds, by group then start',
  (select string_agg(x ->> 'name', ',' order by o) from jsonb_array_elements(pg_temp.reg() -> 'rounds') with ordinality t(x, o)),
  'Other trials,Squad trials,Team trials');
select pg_temp.eq('the season is the newest', pg_temp.reg() ->> 'season', (select max(season)::text from public.teams where not archived));
select pg_temp.ok('Spare Team is a group with no round',
  exists (select 1 from jsonb_array_elements(pg_temp.reg() -> 'groups') g where g ->> 'name' = 'Spare Team')
  and not exists (select 1 from jsonb_array_elements(pg_temp.reg() -> 'rounds') r where r ->> 'team_name' = 'Spare Team'), true);
select pg_temp.eq('the squad''s athletes', (select g ->> 'athletes' from jsonb_array_elements(pg_temp.reg() -> 'groups') g where g ->> 'name' = 'Sample Squad'), '2');
select pg_temp.eq('panel names', (select string_agg(p ->> 'name', ', ') from jsonb_array_elements(pg_temp.r('Squad trials') -> 'panel') p),
  (select string_agg(coalesce(public.member_display_name(m.profile_id), m.profile_name), ', ' order by coalesce(public.member_display_name(m.profile_id), m.profile_name))
   from public.selection_round_panel m where m.round_id = pg_temp.round('Squad trials') and m.removed_at is null));
select pg_temp.ok('nobody on it is independent', (select bool_or((p ->> 'independent')::boolean) from jsonb_array_elements(pg_temp.r('Squad trials') -> 'panel') p), false);
select pg_temp.eq('auditors', pg_temp.r('Squad trials') ->> 'auditors', '["Ari Auditor"]');
select pg_temp.eq('athletes', pg_temp.r('Squad trials') ->> 'athletes', '2');
select pg_temp.eq('observations', pg_temp.r('Squad trials') ->> 'observations', '2');
select pg_temp.eq('athletes observed', pg_temp.r('Squad trials') ->> 'athletes_observed', '1');
select pg_temp.eq('summaries signed', pg_temp.r('Squad trials') ->> 'summaries_signed', '1');
select pg_temp.eq('summaries expected: each selector''s athletes, less themselves and their own children',
  pg_temp.r('Squad trials') ->> 'summaries_expected',
  (select sum((select count(*) from public.team_members a where a.team_id = '00000000-0000-0000-0000-0000000000a1' and a.team_role = 'athlete'
     and not exists (select 1 from public.guardianships g where g.guardian_id = m.profile_id and g.athlete_id = a.profile_id)))::text
   from public.selection_round_panel m where m.round_id = pg_temp.round('Squad trials') and m.removed_at is null));
select pg_temp.eq('feedback shared', pg_temp.r('Squad trials') ->> 'feedback_shared', '1');
select pg_temp.ok('released is empty until part 5', pg_temp.r('Squad trials') -> 'released' = 'null'::jsonb, true);
select pg_temp.ok('the set fits the squad', (pg_temp.r('Squad trials') ->> 'set_fits')::boolean, true);
select pg_temp.eq('no clashes', pg_temp.r('Squad trials') ->> 'clashes', '[]');
select pg_temp.eq('the other round''s auditor', pg_temp.r('Other trials') ->> 'auditors', '["Oz Auditor"]');
select pg_temp.eq('sets with their round counts', (select string_agg((s ->> 'name') || ':' || (s ->> 'rounds_season') || '/' || (s ->> 'rounds_ever'), ',') from jsonb_array_elements(pg_temp.reg() -> 'sets') s), 'Junior criteria:3/3');
select pg_temp.eq('set events newest first', (select string_agg(e ->> 'kind', ',' order by o) from jsonb_array_elements(pg_temp.reg() -> 'set_events') with ordinality t(e, o)), 'saved,created');
select pg_temp.ok('round events leave out opened',
  (select bool_and(e ->> 'kind' <> 'opened') and count(*) > 0 from jsonb_array_elements(pg_temp.reg() -> 'round_events') e), true);

alter table public.selection_rounds disable trigger selection_rounds_no_overlap;
update public.selection_rounds set starts_on = public.club_today() + 10 where name = 'Team trials';
alter table public.selection_rounds enable trigger selection_rounds_no_overlap;
select pg_temp.eq('an overlap saved before they were refused shows on the team round', pg_temp.r('Team trials') #>> '{clashes,0,round_name}', 'Squad trials');
select pg_temp.eq('and on the squad round', pg_temp.r('Squad trials') #>> '{clashes,0,round_name}', 'Team trials');

update public.assessment_criteria_sets set for_all = false where name = 'Junior criteria';
insert into public.assessment_criteria_set_groups (set_id, team_id, team_name)
select id, '00000000-0000-0000-0000-0000000000b1', 'Other Squad' from public.assessment_criteria_sets where name = 'Junior criteria';
select pg_temp.ok('the set no longer fits the squad', (pg_temp.r('Squad trials') ->> 'set_fits')::boolean, false);
select pg_temp.ok('but still the other squad', (pg_temp.r('Other trials') ->> 'set_fits')::boolean, true);

-- ---------------------------------------------------------------------------
-- No athlete data, no record view
-- ---------------------------------------------------------------------------

select pg_temp.ok('the register names no athlete and holds no words a selector wrote',
  (select bool_or(position(w in pg_temp.reg()::text) > 0) from unnest(array['Jordan', 'Kai', 'Zesty', 'Quokka', 'Wombat']) w), false);
select pg_temp.ok('nor does the round record',
  (select bool_or(position(w in pg_temp.rec()::text) > 0) from unnest(array['Jordan', 'Kai', 'Zesty', 'Quokka', 'Wombat']) w), false);
create temp table before_views as select count(*) as n from public.record_access_log where subject_id in (pg_temp.id('31'), pg_temp.id('32'));
select pg_temp.reg() is not null and pg_temp.rec() is not null;
select pg_temp.as_member('71');
select pg_temp.rec() is not null;
select pg_temp.eq('neither writes a record view',
  (select count(*)::text from public.record_access_log where subject_id in (pg_temp.id('31'), pg_temp.id('32'))), (select n::text from before_views));

-- ---------------------------------------------------------------------------
-- Another season
-- ---------------------------------------------------------------------------

alter table public.selection_rounds disable trigger selection_rounds_no_overlap;
insert into public.selection_rounds (team_id, team_name, season, name, starts_on, ends_on, criteria, created_by_name)
select null, 'Old Squad', season - 1, 'Last year', public.club_today() - 400, public.club_today() - 380, pg_temp.crit(), 'Matt'
from public.teams where id = '00000000-0000-0000-0000-0000000000a1';
alter table public.selection_rounds enable trigger selection_rounds_no_overlap;
select pg_temp.as_member('01');
select pg_temp.ok('last season''s round is left out of this season',
  exists (select 1 from jsonb_array_elements(pg_temp.reg() -> 'rounds') r where r ->> 'name' = 'Last year'), false);
select pg_temp.eq('and is returned for its own season',
  (select string_agg(r ->> 'name', ',') from jsonb_array_elements(pg_temp.reg((pg_temp.reg() ->> 'season')::int - 1) -> 'rounds') r), 'Last year');
select pg_temp.eq('both seasons are listed, newest first', jsonb_array_length(pg_temp.reg() -> 'seasons')::text, '2');
select pg_temp.eq('a round with no group has no clashes', (select r ->> 'clashes' from jsonb_array_elements(pg_temp.reg((pg_temp.reg() ->> 'season')::int - 1) -> 'rounds') r), '[]');
