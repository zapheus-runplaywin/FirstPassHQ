-- Tests for 20261123100000_selection_assessments.sql: the club's assessment
-- criteria, selection rounds and their panels, observations, and the admins'
-- audit report. Run on a fresh database with the migrations and
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
-- The Sample Squad's round, and the Other Squad's.
create or replace function pg_temp.round(p_name text default 'Sample selections') returns uuid language sql as
$$ select id from public.selection_rounds where name = p_name $$;
-- An observation by its evidence line.
create or replace function pg_temp.obs(p_note text) returns uuid language sql as
$$ select id from public.assessment_observations where note = p_note $$;
-- Whether the signed-in member can open the round as a panel member.
create or replace function pg_temp.reads_round(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.selection_round_sheet(p_round); return true;
   exception when others then return false; end $$;
-- Whether the signed-in member can open this athlete's assessment.
create or replace function pg_temp.reads_athlete(p_round uuid, n text) returns boolean language plpgsql as
$$ begin perform public.athlete_assessment(p_round, pg_temp.id(n)); return true;
   exception when others then return false; end $$;
-- Whether the signed-in member can write an observation about this athlete.
create or replace function pg_temp.writes_athlete(p_round uuid, n text) returns boolean language plpgsql as
$$ begin
     perform public.save_assessment_observation(null, p_round, pg_temp.id(n), 'training', public.club_today(),
       'Probe by ' || current_setting('request.jwt.claim.sub'), '[{"item_key": "passing", "rating": 2}]');
     return true;
   exception when others then return false; end $$;
-- Whether the signed-in member can call an admin function of the feature.
create or replace function pg_temp.admin_reads() returns boolean language plpgsql as
$$ begin perform public.admin_selection_rounds(); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.audits(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.admin_selection_audit(p_round); return true;
   exception when others then return false; end $$;
-- How many views of this kind are in this member's record views.
create or replace function pg_temp.views(n text, p_kind text) returns bigint language sql as
$$ select count(*) from public.record_access_log l where l.subject_id = pg_temp.id(n) and l.kind = p_kind $$;
create or replace function pg_temp.set_feature(p_on boolean) returns void language sql as
$$ update public.club_settings set features = features || jsonb_build_object('selectionAssessments', p_on) where id $$;

-- More sample people, only for this file: a second squad with its own coach
-- and athlete, a guest with a current check (an independent selector) and a
-- guest without one.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('61'), 'coach.other@example.test', now()),
  (pg_temp.id('62'), 'guest.checked@example.test', now()),
  (pg_temp.id('63'), 'guest.unchecked@example.test', now()),
  (pg_temp.id('64'), 'athlete.other@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, verified_at = now(), date_of_birth = v.dob
from (values
  ('61', 'Nico Othercoach', 'coach', 'WWC0061', public.club_today() + 400, null::date),
  ('62', 'Ola Selector', 'guest', 'WWC0062', public.club_today() + 400, null),
  ('63', 'Pat Visitor', 'guest', null, null, null),
  ('64', 'Quinn Other', 'athlete', null, null, (public.club_today() - interval '22 years')::date)
) as v(n, name, role, wwcc, exp, dob)
where p.id = pg_temp.id(v.n);
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('61'), 'coach', 'head_coach'),
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('64'), 'athlete', null);
-- Gale (21)'s check is current, so the committee role works.
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('signed-in members cannot read ' || t || ' directly',
  has_table_privilege('authenticated', 'public.' || t, 'select'), false)
from unnest(array['assessment_criteria', 'selection_rounds', 'selection_round_panel',
  'assessment_observations', 'assessment_observation_ratings']) t;
select pg_temp.ok('signed-in members cannot write ' || t || ' directly',
  has_table_privilege('authenticated', 'public.' || t, 'insert')
  or has_table_privilege('authenticated', 'public.' || t, 'update')
  or has_table_privilege('authenticated', 'public.' || t, 'delete'), false)
from unnest(array['assessment_criteria', 'selection_rounds', 'selection_round_panel',
  'assessment_observations', 'assessment_observation_ratings']) t;
select pg_temp.ok('anon reads none of ' || t, has_table_privilege('anon', 'public.' || t, 'select'), false)
from unnest(array['assessment_criteria', 'selection_rounds', 'selection_round_panel',
  'assessment_observations', 'assessment_observation_ratings']) t;
select pg_temp.ok('row level security is on for ' || t,
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), true)
from unnest(array['assessment_criteria', 'selection_rounds', 'selection_round_panel',
  'assessment_observations', 'assessment_observation_ratings']) t;
select pg_temp.ok('anon cannot call any assessment function',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.selection_assessments_on()', 'public.admin_assessment_criteria()',
    'public.admin_save_assessment_criteria(jsonb)', 'public.on_selection_panel(uuid)',
    'public.can_assess_athlete(uuid, uuid)', 'public.admin_selection_rounds()',
    'public.admin_open_selection_round(uuid, text, date, date, uuid, integer, integer)',
    'public.admin_save_selection_round(uuid, text, date, date, integer, integer)',
    'public.admin_close_selection_round(uuid, boolean)', 'public.admin_selection_panel_choices(uuid)',
    'public.admin_add_selection_panel_member(uuid, uuid)',
    'public.admin_remove_selection_panel_member(uuid, uuid)', 'public.my_selection_rounds()',
    'public.selection_round_sheet(uuid)', 'public.athlete_assessment(uuid, uuid)',
    'public.save_assessment_observation(uuid, uuid, uuid, text, date, text, jsonb, uuid)',
    'public.delete_assessment_observation(uuid)', 'public.admin_selection_audit(uuid)']) f), false);
select pg_temp.ok('the helpers are closed to members',
  (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array[
    'public.check_assessment_criteria(jsonb)', 'public.selection_round_items(uuid)',
    'public.can_join_selection_panel(uuid)', 'public.in_selection_round(uuid, uuid)',
    'public.observation_is_open(timestamptz)']) f), false);

-- ---------------------------------------------------------------------------
-- Off by default
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.ok('the feature starts off', public.selection_assessments_on(), false);
select pg_temp.ok('an admin can''t open the rounds while it''s off', pg_temp.admin_reads(), false);
select pg_temp.fails('an admin can''t save criteria while it''s off',
  $$select public.admin_save_assessment_criteria('{"groups": []}')$$);
select pg_temp.set_feature(true);
select pg_temp.ok('an admin turns it on', public.selection_assessments_on(), true);

-- ---------------------------------------------------------------------------
-- Criteria
-- ---------------------------------------------------------------------------

select pg_temp.fails('a round can''t open before the criteria are set',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Too early', public.club_today() - 7, public.club_today() + 30)$$);
select pg_temp.eq('criteria start empty', public.admin_assessment_criteria()::text, '{"groups": []}');

select pg_temp.fails('criteria must be a list of groups', $$select public.admin_save_assessment_criteria('{"groups": "no"}')$$);
select pg_temp.fails('a group needs a name',
  $$select public.admin_save_assessment_criteria('{"groups": [{"key": "g", "name": " ", "scale": ["a", "b", "c"], "items": [{"key": "i", "name": "Item"}]}]}')$$);
select pg_temp.fails('a scale has three steps',
  $$select public.admin_save_assessment_criteria('{"groups": [{"key": "g", "name": "Group", "scale": ["a", "b"], "items": [{"key": "i", "name": "Item"}]}]}')$$);
select pg_temp.fails('a group needs an item',
  $$select public.admin_save_assessment_criteria('{"groups": [{"key": "g", "name": "Group", "scale": ["a", "b", "c"], "items": []}]}')$$);
select pg_temp.fails('an item needs a name',
  $$select public.admin_save_assessment_criteria('{"groups": [{"key": "g", "name": "Group", "scale": ["a", "b", "c"], "items": [{"key": "i", "name": ""}]}]}')$$);
select pg_temp.fails('keys can''t repeat',
  $$select public.admin_save_assessment_criteria('{"groups": [{"key": "g", "name": "Group", "scale": ["a", "b", "c"], "items": [{"key": "g", "name": "Item"}]}]}')$$);
select pg_temp.fails('keys are short slugs',
  $$select public.admin_save_assessment_criteria('{"groups": [{"key": "Not A Slug", "name": "Group", "scale": ["a", "b", "c"], "items": [{"key": "i", "name": "Item"}]}]}')$$);
select pg_temp.fails('no more than 12 items in a group',
  $$select public.admin_save_assessment_criteria(jsonb_build_object('groups', jsonb_build_array(jsonb_build_object(
    'key', 'g', 'name', 'Group', 'scale', '["a", "b", "c"]'::jsonb,
    'items', (select jsonb_agg(jsonb_build_object('key', 'i' || n, 'name', 'Item ' || n)) from generate_series(1, 13) n)))))$$);

select pg_temp.works('an admin saves the club''s criteria', $$select public.admin_save_assessment_criteria('{"groups": [
  {"key": "technical", "name": " Technical ability ", "scale": ["Below standard", "Meets standard", "Exceeds standard"],
   "items": [{"key": "passing", "name": "Passing and delivery"}, {"key": "catching", "name": "Catching"}]},
  {"key": "coachability", "name": "Coachability", "scale": ["Developing", "Meets standard", "Exceeds standard"],
   "items": [{"key": "feedback", "name": "Accepts feedback", "extra": "dropped"}]}]}')$$);
select pg_temp.eq('names are trimmed', public.admin_assessment_criteria() #>> '{groups,0,name}', 'Technical ability');
select pg_temp.ok('unknown fields are dropped', public.admin_assessment_criteria() #> '{groups,1,items,0}' ? 'extra', false);

select pg_temp.m_fails(n, who || ' can''t ' || what, statement)
from (values ('read the criteria', 'select public.admin_assessment_criteria()'),
  ('change the criteria', $$select public.admin_save_assessment_criteria('{"groups": []}')$$)) c(what, statement),
  (values ('11', 'a coach'), ('13', 'a manager'), ('14', 'a physio'), ('21', 'a committee member'),
  ('31', 'an athlete under 18'), ('32', 'an adult athlete'), ('41', 'a parent'), ('62', 'a guest')) v(n, who);

-- ---------------------------------------------------------------------------
-- Opening a round and its panel
-- ---------------------------------------------------------------------------

select pg_temp.m_fails(n, who || ' can''t open a round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Not mine', public.club_today() - 7, public.club_today() + 30)$$)
from (values ('11', 'a coach'), ('13', 'a manager'), ('21', 'a committee member'), ('32', 'an athlete'),
  ('41', 'a parent'), ('62', 'a guest')) v(n, who);

select pg_temp.as_member('01');
select pg_temp.fails('a round needs a name',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', ' ', public.club_today() - 7, public.club_today() + 30)$$);
select pg_temp.fails('a round can''t end before it starts',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Backwards', public.club_today(), public.club_today() - 1)$$);
select pg_temp.fails('a round is a year at most',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Long', public.club_today(), public.club_today() + 400)$$);
select pg_temp.fails('a round needs a squad or team',
  $$select public.admin_open_selection_round(gen_random_uuid(), 'Nowhere', public.club_today(), public.club_today() + 30)$$);
select pg_temp.works('an admin opens a round for Sample Squad',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Sample selections', public.club_today() - 7, public.club_today() + 30)$$);
select pg_temp.fails('a squad has one open round at a time',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Second', public.club_today() - 7, public.club_today() + 30)$$);
select pg_temp.works('another squad can have its own',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b1', 'Other selections', public.club_today() - 7, public.club_today() + 30)$$);

-- The panel starts as the squad's coaches who hold a current check: Casey
-- (11) and Morgan (42), not Drew (12), whose check has lapsed.
select pg_temp.eq('the panel starts as the squad''s cleared coaches',
  (select string_agg(m.profile_name, ', ' order by m.profile_name) from public.selection_round_panel m
    where m.round_id = pg_temp.round() and m.removed_at is null),
  'Casey Coach, Morgan Coach-Parent');
select pg_temp.eq('each is recorded as added by the admin',
  (select string_agg(distinct m.added_by_name, ', ') from public.selection_round_panel m where m.round_id = pg_temp.round()),
  'Alex Admin');
select pg_temp.ok('the admin isn''t on the panel',
  exists (select 1 from public.selection_round_panel m where m.round_id = pg_temp.round() and m.profile_id = pg_temp.id('01')), false);

select pg_temp.ok('the choices offer the guest with a check',
  (select cleared from public.admin_selection_panel_choices(pg_temp.round()) where profile_id = pg_temp.id('62')), true);
select pg_temp.ok('the choices show the guest without a check as not cleared',
  (select cleared from public.admin_selection_panel_choices(pg_temp.round()) where profile_id = pg_temp.id('63')), false);
select pg_temp.ok('the choices leave out people already on the panel',
  exists (select 1 from public.admin_selection_panel_choices(pg_temp.round()) where profile_id = pg_temp.id('11')), false);
select pg_temp.ok('the choices leave out managers, physios, the committee, athletes and parents',
  exists (select 1 from public.admin_selection_panel_choices(pg_temp.round())
    where profile_id in (pg_temp.id('13'), pg_temp.id('14'), pg_temp.id('21'), pg_temp.id('31'), pg_temp.id('32'), pg_temp.id('41'))), false);

select pg_temp.works('an admin adds the guest with a check as a selector',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.works('adding them again changes nothing',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.eq('they are on the panel once',
  (select count(*)::text from public.selection_round_panel m where m.round_id = pg_temp.round() and m.profile_id = pg_temp.id('62')), '1');
select pg_temp.fails(who || ' can''t be added to a panel',
  format($$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('%s'))$$, n))
from (values ('63', 'a guest without a check'), ('12', 'a coach whose check has lapsed'), ('13', 'a manager'),
  ('14', 'a physio'), ('21', 'a committee member'), ('31', 'an athlete under 18'), ('32', 'an adult athlete'),
  ('41', 'a parent')) v(n, who);
select pg_temp.m_fails(n, who || ' can''t ' || what, statement)
from (values ('add to a panel', $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('61'))$$),
  ('remove from a panel', $$select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$),
  ('list panel choices', $$select public.admin_selection_panel_choices(pg_temp.round())$$)) c(what, statement),
  (values ('11', 'a panel member'), ('21', 'a committee member'), ('62', 'a guest selector')) v(n, who);

-- ---------------------------------------------------------------------------
-- Who reads a round, for every kind of member
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || case when expected then ' opens' else ' can''t open' end || ' the round',
  'pg_temp.reads_round(pg_temp.round())', expected)
from (values
  ('11', 'the squad''s head coach', true),
  ('42', 'a coach who is also a parent', true),
  ('62', 'a guest added as a selector', true),
  ('01', 'an admin', false),
  ('02', 'an admin with no check', false),
  ('12', 'the squad''s coach whose check has lapsed', false),
  ('61', 'a coach of another squad', false),
  ('13', 'the squad''s manager', false),
  ('14', 'the squad''s physio', false),
  ('21', 'a committee member', false),
  ('31', 'an athlete under 18 in the round', false),
  ('32', 'an adult athlete in the round', false),
  ('41', 'a parent of an athlete in the round', false),
  ('63', 'a guest', false)
) v(n, who, expected);

select pg_temp.m_ok(n, who || case when expected then ' opens' else ' can''t open' end || ' Kai''s assessment',
  $$pg_temp.reads_athlete(pg_temp.round(), '32')$$, expected)
from (values
  ('11', 'the squad''s head coach', true), ('42', 'a coach who is also a parent', true),
  ('62', 'a guest added as a selector', true), ('01', 'an admin', false), ('12', 'a lapsed coach', false),
  ('61', 'a coach of another squad', false), ('13', 'the manager', false), ('14', 'the physio', false),
  ('21', 'a committee member', false), ('32', 'Kai', false), ('31', 'another athlete', false),
  ('41', 'a parent', false)
) v(n, who, expected);

select pg_temp.m_ok(n, who || case when expected then ' writes' else ' can''t write' end || ' about Kai',
  $$pg_temp.writes_athlete(pg_temp.round(), '32')$$, expected)
from (values
  ('11', 'the squad''s head coach', true), ('42', 'a coach who is also a parent', true),
  ('62', 'a guest added as a selector', true), ('01', 'an admin', false), ('12', 'a lapsed coach', false),
  ('61', 'a coach of another squad', false), ('13', 'the manager', false), ('14', 'the physio', false),
  ('21', 'a committee member', false), ('32', 'Kai', false), ('31', 'another athlete', false),
  ('41', 'a parent', false)
) v(n, who, expected);
select pg_temp.eq('only the three panel members wrote',
  (select count(*)::text from public.assessment_observations where note like 'Probe by %'), '3');

select pg_temp.as_member('11');
select pg_temp.ok('a panel member can''t read an athlete from another squad', pg_temp.reads_athlete(pg_temp.round(), '64'), false);
select pg_temp.ok('or write about them', pg_temp.writes_athlete(pg_temp.round(), '64'), false);
select pg_temp.ok('or open the other squad''s round', pg_temp.reads_round(pg_temp.round('Other selections')), false);
select pg_temp.ok('a coach can''t be assessed as an athlete', pg_temp.writes_athlete(pg_temp.round(), '12'), false);
select pg_temp.eq('Casey''s rounds list only the one they are on',
  (select string_agg(name, ', ') from public.my_selection_rounds()), 'Sample selections');
select pg_temp.as_member('61');
select pg_temp.eq('the other squad''s coach sees only theirs',
  (select string_agg(name, ', ') from public.my_selection_rounds()), 'Other selections');
select pg_temp.m_ok(n, who || ' has no rounds', 'not exists (select 1 from public.my_selection_rounds())', true)
from (values ('01', 'an admin'), ('13', 'a manager'), ('21', 'a committee member'), ('31', 'an athlete'),
  ('41', 'a parent'), ('12', 'a lapsed coach')) v(n, who);

-- ---------------------------------------------------------------------------
-- A panel member never assesses their own child
-- ---------------------------------------------------------------------------

select pg_temp.as_member('42');
select pg_temp.ok('Morgan can''t open their own child Jordan''s assessment', pg_temp.reads_athlete(pg_temp.round(), '31'), false);
select pg_temp.ok('or write about Jordan', pg_temp.writes_athlete(pg_temp.round(), '31'), false);
select pg_temp.eq('Jordan is left off Morgan''s list',
  (select string_agg(a ->> 'name', ', ') from jsonb_array_elements(public.selection_round_sheet(pg_temp.round()) -> 'athletes') a), 'Kai Senior');
select pg_temp.eq('and counted as hidden', public.selection_round_sheet(pg_temp.round()) ->> 'hidden', '1');
select pg_temp.eq('Morgan''s round counts one athlete', (select athletes::text from public.my_selection_rounds()), '1');
select pg_temp.as_member('11');
select pg_temp.eq('Casey sees both athletes',
  (select string_agg(a ->> 'name', ', ') from jsonb_array_elements(public.selection_round_sheet(pg_temp.round()) -> 'athletes') a),
  'Jordan Junior, Kai Senior');
select pg_temp.eq('with nobody hidden', public.selection_round_sheet(pg_temp.round()) ->> 'hidden', '0');

-- ---------------------------------------------------------------------------
-- Observations
-- ---------------------------------------------------------------------------

select pg_temp.fails('an observation needs a setting',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'gym', public.club_today(), 'x', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.fails('it can''t be dated in the future',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today() + 1, 'x', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.fails('or before the round started',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today() - 8, 'x', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.fails('it needs at least one of the criteria',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'x', '[]')$$);
select pg_temp.fails('the criteria must be the round''s',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'x', '[{"item_key": "speed", "rating": 2}]')$$);
select pg_temp.fails('a group''s key isn''t a criterion',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'x', '[{"item_key": "technical", "rating": 2}]')$$);
select pg_temp.fails('a criterion can''t be listed twice',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'x', '[{"item_key": "passing", "rating": 2}, {"item_key": "passing", "rating": 3}]')$$);
select pg_temp.fails('a rating is 1 to 3',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'x', '[{"item_key": "passing", "rating": 4}]')$$);
select pg_temp.fails('a rating is a number',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'x', '[{"item_key": "passing", "rating": "high"}]')$$);
select pg_temp.fails('with no rating it needs evidence',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), '  ', '[{"item_key": "passing", "rating": null}]')$$);
select pg_temp.fails('evidence is 1,000 characters at most',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), repeat('x', 1001), '[{"item_key": "passing", "rating": 2}]')$$);

select pg_temp.works('Casey writes about Jordan with a rating and evidence',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today() - 1, ' Hit the circle edge feed four times ', '[{"item_key": "passing", "rating": 3}, {"item_key": "feedback", "rating": null}]')$$);
select pg_temp.works('Casey rates Jordan with no evidence line',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'game', public.club_today(), null, '[{"item_key": "catching", "rating": 1}]')$$);
select pg_temp.eq('evidence is trimmed', (select count(*)::text from public.assessment_observations where note = 'Hit the circle edge feed four times'), '1');
select pg_temp.eq('the author''s name is kept with it',
  (select author_name from public.assessment_observations where id = pg_temp.obs('Hit the circle edge feed four times')), 'Casey Coach');
select pg_temp.eq('a criterion without a rating is kept as tagged',
  (select coalesce(rating::text, 'none') from public.assessment_observation_ratings
    where observation_id = pg_temp.obs('Hit the circle edge feed four times') and item_key = 'feedback'), 'none');

select pg_temp.as_member('62');
select pg_temp.works('Ola the guest selector writes about Jordan',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'trial', public.club_today(), 'Asked for feedback after the trial', '[{"item_key": "feedback", "rating": 2}]')$$);
select pg_temp.eq('Ola reads all three observations about Jordan',
  jsonb_array_length(public.athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'observations')::text, '3');
select pg_temp.eq('Ola can change only their own',
  (select string_agg(o ->> 'author_name', ', ') from jsonb_array_elements(
    public.athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'observations') o where (o ->> 'can_change')::boolean), 'Ola Selector');
select pg_temp.fails('Ola can''t change Casey''s observation',
  $$select public.save_assessment_observation(pg_temp.obs('Hit the circle edge feed four times'), pg_temp.round(), pg_temp.id('31'), 'training', public.club_today(), 'Rewritten', '[{"item_key": "passing", "rating": 1}]')$$);
select pg_temp.fails('or remove it', $$select public.delete_assessment_observation(pg_temp.obs('Hit the circle edge feed four times'))$$);
select pg_temp.as_member('13');
select pg_temp.fails('a manager can''t remove an observation', $$select public.delete_assessment_observation(pg_temp.obs('Hit the circle edge feed four times'))$$);

select pg_temp.as_member('11');
select pg_temp.works('Casey changes their own observation the same day',
  $$select public.save_assessment_observation(pg_temp.obs('Hit the circle edge feed four times'), pg_temp.round(), pg_temp.id('31'), 'training', public.club_today() - 1, 'Hit the circle edge feed five times', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.eq('the ratings are replaced',
  (select string_agg(item_key || '=' || rating, ', ') from public.assessment_observation_ratings
    where observation_id = pg_temp.obs('Hit the circle edge feed five times')), 'passing=2');
select pg_temp.fails('an observation can''t be moved to another athlete',
  $$select public.save_assessment_observation(pg_temp.obs('Hit the circle edge feed five times'), pg_temp.round(), pg_temp.id('32'), 'training', public.club_today(), 'Moved', '[{"item_key": "passing", "rating": 2}]')$$);

-- Written yesterday: still open today. Written two days ago: locked.
update public.assessment_observations set created_at = now() - interval '1 day' where id = pg_temp.obs('Hit the circle edge feed five times');
select pg_temp.ok('an observation written yesterday can still be changed',
  (select (o ->> 'can_change')::boolean from jsonb_array_elements(public.athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'observations') o
    where o ->> 'note' = 'Hit the circle edge feed five times'), true);
update public.assessment_observations set created_at = now() - interval '2 days' where id = pg_temp.obs('Hit the circle edge feed five times');
select pg_temp.ok('one written two days ago can''t',
  (select (o ->> 'can_change')::boolean from jsonb_array_elements(public.athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'observations') o
    where o ->> 'note' = 'Hit the circle edge feed five times'), false);
select pg_temp.fails('changing it is refused',
  $$select public.save_assessment_observation(pg_temp.obs('Hit the circle edge feed five times'), pg_temp.round(), pg_temp.id('31'), 'training', public.club_today() - 1, 'Too late', '[{"item_key": "passing", "rating": 1}]')$$);
select pg_temp.fails('removing it is refused', $$select public.delete_assessment_observation(pg_temp.obs('Hit the circle edge feed five times'))$$);
select pg_temp.works('a correction is a new observation that points at it',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('31'), 'training', public.club_today() - 1, 'Correction: it was four feeds', '[{"item_key": "passing", "rating": 2}]', pg_temp.obs('Hit the circle edge feed five times'))$$);
select pg_temp.fails('a correction must point at the same athlete''s observation',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'training', public.club_today(), 'Wrong athlete', '[{"item_key": "passing", "rating": 2}]', pg_temp.obs('Hit the circle edge feed five times'))$$);
select pg_temp.eq('the original still stands',
  (select count(*)::text from public.assessment_observations where note = 'Hit the circle edge feed five times'), '1');

select pg_temp.works('Casey removes an observation written today',
  $$select public.delete_assessment_observation((select id from public.assessment_observations where note like 'Probe by %' and author_id = pg_temp.id('11')))$$);
select pg_temp.eq('its ratings go with it',
  (select count(*)::text from public.assessment_observation_ratings ra
    where not exists (select 1 from public.assessment_observations o where o.id = ra.observation_id)), '0');

-- The round's list shows how much is written, not what.
select pg_temp.eq('the list counts Jordan''s observations',
  (select a ->> 'observations' from jsonb_array_elements(public.selection_round_sheet(pg_temp.round()) -> 'athletes') a where a ->> 'name' = 'Jordan Junior'), '4');
select pg_temp.eq('and how many selectors wrote them',
  (select a ->> 'assessors' from jsonb_array_elements(public.selection_round_sheet(pg_temp.round()) -> 'athletes') a where a ->> 'name' = 'Jordan Junior'), '2');
select pg_temp.eq('and how many groups of criteria they cover',
  (select a ->> 'groups_covered' from jsonb_array_elements(public.selection_round_sheet(pg_temp.round()) -> 'athletes') a where a ->> 'name' = 'Jordan Junior'), '2');
select pg_temp.eq('and Casey''s own count',
  (select a ->> 'my_observations' from jsonb_array_elements(public.selection_round_sheet(pg_temp.round()) -> 'athletes') a where a ->> 'name' = 'Jordan Junior'), '3');
select pg_temp.ok('the list carries no ratings or evidence',
  public.selection_round_sheet(pg_temp.round())::text ~ 'circle edge|"rating"', false);
select pg_temp.eq('the list says what day it is at the club',
  public.selection_round_sheet(pg_temp.round()) ->> 'today', public.club_today()::text);

-- ---------------------------------------------------------------------------
-- Record views: an under 18's assessment
-- ---------------------------------------------------------------------------

select pg_temp.ok('opening Jordan''s assessment is in their record views', pg_temp.views('31', 'assessment') > 0, true);
select pg_temp.eq('once for each selector within half an hour', pg_temp.views('31', 'assessment')::text, '2');
select pg_temp.eq('it names who looked',
  (select string_agg(l.viewer_name, ', ' order by l.viewer_name) from public.record_access_log l
    where l.subject_id = pg_temp.id('31') and l.kind = 'assessment'), 'Casey Coach, Ola Selector');
select pg_temp.eq('an adult''s assessment isn''t logged', pg_temp.views('32', 'assessment')::text, '0');
select pg_temp.eq('no audit report has been built yet', pg_temp.views('31', 'assessment_audit')::text, '0');
update public.record_access_log set created_at = now() - interval '31 minutes' where kind = 'assessment';
select pg_temp.works('Casey opens Jordan''s assessment again later', $$select public.athlete_assessment(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.eq('and it is logged again', pg_temp.views('31', 'assessment')::text, '3');

-- ---------------------------------------------------------------------------
-- The round keeps its own copy of the criteria
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.works('an admin changes the club''s criteria', $$select public.admin_save_assessment_criteria('{"groups": [
  {"key": "fitness", "name": "Fitness", "scale": ["Low", "Medium", "High"], "items": [{"key": "speed", "name": "Speed"}]}]}')$$);
select pg_temp.as_member('11');
select pg_temp.eq('the open round keeps the criteria it started with',
  public.selection_round_sheet(pg_temp.round()) #>> '{criteria,groups,0,name}', 'Technical ability');
select pg_temp.fails('and doesn''t accept the new ones',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'training', public.club_today(), 'x', '[{"item_key": "speed", "rating": 2}]')$$);

-- ---------------------------------------------------------------------------
-- Losing access: stood down, lapsed check, taken off the panel
-- ---------------------------------------------------------------------------

update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.ok('a stood-down panel member can''t open the round', pg_temp.reads_round(pg_temp.round()), false);
select pg_temp.ok('or an assessment', pg_temp.reads_athlete(pg_temp.round(), '32'), false);
select pg_temp.ok('or write', pg_temp.writes_athlete(pg_temp.round(), '32'), false);
select pg_temp.fails('or remove what they wrote', $$select public.delete_assessment_observation(pg_temp.obs('Correction: it was four feeds'))$$);
select pg_temp.eq('and has no rounds', (select count(*)::text from public.my_selection_rounds()), '0');
update public.profiles set stood_down_at = null where id = pg_temp.id('11');
select pg_temp.ok('access comes back when the stand-down ends', pg_temp.reads_round(pg_temp.round()), true);

select pg_temp.as_member('62');
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('62');
select pg_temp.ok('a selector whose check lapses can''t open the round', pg_temp.reads_round(pg_temp.round()), false);
select pg_temp.ok('or write', pg_temp.writes_athlete(pg_temp.round(), '32'), false);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('62');
select pg_temp.ok('and can again once it is current', pg_temp.reads_round(pg_temp.round()), true);

select pg_temp.as_member('01');
select pg_temp.works('an admin takes Ola off the panel', $$select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.fails('they can''t be taken off twice', $$select public.admin_remove_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.eq('the removal is recorded with who did it',
  (select removed_by_name from public.selection_round_panel where round_id = pg_temp.round() and profile_id = pg_temp.id('62')), 'Alex Admin');
select pg_temp.as_member('62');
select pg_temp.ok('Ola can''t open the round any more', pg_temp.reads_round(pg_temp.round()), false);
select pg_temp.ok('or an assessment', pg_temp.reads_athlete(pg_temp.round(), '31'), false);
select pg_temp.eq('what Ola wrote stays',
  (select count(*)::text from public.assessment_observations where author_id = pg_temp.id('62')), '2');
select pg_temp.as_member('01');
select pg_temp.works('an admin puts Ola back', $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);
select pg_temp.eq('the panel keeps both the old and the new row',
  (select count(*)::text from public.selection_round_panel where round_id = pg_temp.round() and profile_id = pg_temp.id('62')), '2');

-- ---------------------------------------------------------------------------
-- The admin's view: counts and the panel, never an assessment
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || case when expected then ' can ' else ' can''t ' end || what, expression, expected)
from (values ('list the rounds', 'pg_temp.admin_reads()'),
  ('build the audit report', 'pg_temp.audits(pg_temp.round())')) c(what, expression),
  (values ('02', 'an admin with no check', true), ('11', 'a panel member', false),
  ('13', 'a manager', false), ('14', 'a physio', false), ('21', 'a committee member', false),
  ('31', 'an athlete', false), ('41', 'a parent', false), ('62', 'a guest selector', false)) v(n, who, expected);

select pg_temp.as_member('01');
select pg_temp.eq('the rounds list counts observations',
  (select observations::text from public.admin_selection_rounds() where name = 'Sample selections'), '6');
select pg_temp.eq('and athletes', (select athletes::text from public.admin_selection_rounds() where name = 'Sample selections'), '2');
select pg_temp.eq('the panel shows Morgan has a child in the round',
  (select m ->> 'own_children' from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m
    where r.name = 'Sample selections' and m ->> 'name' = 'Morgan Coach-Parent'), '1');
select pg_temp.ok('nobody has declared a conflict yet',
  (select bool_or((m ->> 'declared_conflict')::boolean) from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m
    where r.name = 'Sample selections'), false);
insert into public.conflict_declarations (profile_id, season, has_conflict, details)
values (pg_temp.id('42'), (select season from public.selection_rounds where id = pg_temp.round()), true, 'My child is trialling');
select pg_temp.ok('a declared conflict shows beside the panel member',
  (select (m ->> 'declared_conflict')::boolean from public.admin_selection_rounds() r, jsonb_array_elements(r.panel) m
    where r.name = 'Sample selections' and m ->> 'name' = 'Morgan Coach-Parent'), true);
select pg_temp.ok('but not what it is', (select panel::text from public.admin_selection_rounds() where name = 'Sample selections') like '%trialling%', false);

select pg_temp.eq('the audit report counts the round''s observations',
  public.admin_selection_audit(pg_temp.round()) #>> '{round,observations}', '6');
select pg_temp.eq('Casey: observations',
  (select s ->> 'observations' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '3');
select pg_temp.eq('Casey: athletes covered',
  (select s ->> 'athletes_covered' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '1');
select pg_temp.eq('Casey: groups of criteria covered',
  (select s ->> 'groups_covered' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '1');
select pg_temp.eq('Casey: one rating with no evidence',
  (select s ->> 'without_evidence' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '1');
select pg_temp.eq('Casey: one correction',
  (select s ->> 'corrections' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '1');
select pg_temp.eq('Casey: training and game split',
  (select (s ->> 'training') || '/' || (s ->> 'game') || '/' || (s ->> 'trial') from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '2/1/0');
select pg_temp.eq('Morgan wrote once, about the one athlete they may assess',
  (select (s ->> 'observations') || '/' || (s ->> 'athletes_covered') from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Morgan Coach-Parent'), '1/1');
select pg_temp.eq('Ola is listed once, though added twice',
  (select count(*)::text from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Ola Selector'), '1');
select pg_temp.eq('the panel history shows Ola''s two rows',
  (select count(*)::text from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'panel') m where m ->> 'name' = 'Ola Selector'), '2');
select pg_temp.eq('Jordan: observations, selectors and groups',
  (select (a ->> 'observations') || '/' || (a ->> 'selectors') || '/' || (a ->> 'groups_covered')
    from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'athletes') a where a ->> 'name' = 'Jordan Junior'), '4/2/2');
select pg_temp.ok('the audit report carries no evidence, ratings or criteria',
  public.admin_selection_audit(pg_temp.round())::text ~* 'circle edge|feedback after|"rating"|"note"|passing|coachability|technical', false);
select pg_temp.ok('the rounds list carries none either',
  (select string_agg(r::text, ' ') from public.admin_selection_rounds() r) ~* 'circle edge|"rating"|"note"|passing', false);
select pg_temp.fails('an admin can''t open the round as a panel member', $$select public.selection_round_sheet(pg_temp.round())$$);
select pg_temp.fails('or an athlete''s assessment', $$select public.athlete_assessment(pg_temp.round(), pg_temp.id('31'))$$);
select pg_temp.fails('an unknown round has no report', $$select public.admin_selection_audit(gen_random_uuid())$$);

select pg_temp.eq('building the report is in Jordan''s record views, once per admin', pg_temp.views('31', 'assessment_audit')::text, '2');
select pg_temp.eq('and not in an adult''s', pg_temp.views('32', 'assessment_audit')::text, '0');

-- A late entry: seen 10 days before it was written.
update public.selection_rounds set starts_on = public.club_today() - 30 where id = pg_temp.round();
update public.assessment_observations set observed_on = public.club_today() - 10 where id = pg_temp.obs('Asked for feedback after the trial');
select pg_temp.eq('an observation written more than 7 days after it was seen counts as late',
  (select s ->> 'written_late' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Ola Selector'), '1');
select pg_temp.eq('others don''t',
  (select s ->> 'written_late' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Casey Coach'), '0');

-- ---------------------------------------------------------------------------
-- Changing and closing a round
-- ---------------------------------------------------------------------------

select pg_temp.fails('the start can''t move past an observation',
  $$select public.admin_save_selection_round(pg_temp.round(), 'Sample selections', public.club_today(), public.club_today() + 30)$$);
select pg_temp.works('an admin renames the round and moves its end',
  $$select public.admin_save_selection_round(pg_temp.round(), 'Sample selections', public.club_today() - 30, public.club_today() + 60)$$);
select pg_temp.as_member('11');
select pg_temp.fails('a panel member can''t change the round',
  $$select public.admin_save_selection_round(pg_temp.round(), 'Mine now', public.club_today() - 30, public.club_today() + 60)$$);
select pg_temp.fails('or close it', $$select public.admin_close_selection_round(pg_temp.round(), true)$$);

select pg_temp.as_member('01');
select pg_temp.works('an admin closes the round', $$select public.admin_close_selection_round(pg_temp.round(), true)$$);
select pg_temp.as_member('11');
select pg_temp.ok('the panel still reads a closed round', pg_temp.reads_athlete(pg_temp.round(), '31'), true);
select pg_temp.ok('but can''t add to it', pg_temp.writes_athlete(pg_temp.round(), '32'), false);
select pg_temp.ok('nothing in it can be changed',
  (select bool_or((o ->> 'can_change')::boolean) from jsonb_array_elements(public.athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'observations') o), false);
select pg_temp.fails('or removed', $$select public.delete_assessment_observation(pg_temp.obs('Correction: it was four feeds'))$$);
select pg_temp.as_member('01');
select pg_temp.works('a second round can open once the first is closed',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Second selections', public.club_today() + 1, public.club_today() + 30)$$);
select pg_temp.eq('the new round takes the club''s new criteria',
  (select criteria #>> '{groups,0,name}' from public.selection_rounds where id = pg_temp.round('Second selections')), 'Fitness');
select pg_temp.fails('the first can''t reopen: its dates overlap the second', $$select public.admin_close_selection_round(pg_temp.round(), false)$$);
select pg_temp.works('the second closes', $$select public.admin_close_selection_round(pg_temp.round('Second selections'), true)$$);
select pg_temp.works('and the first reopens', $$select public.admin_close_selection_round(pg_temp.round(), false)$$);
select pg_temp.as_member('11');
select pg_temp.ok('the panel can add to it again', pg_temp.writes_athlete(pg_temp.round(), '32'), true);

-- ---------------------------------------------------------------------------
-- Pilot teams only
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.works('an admin makes it pilot-only, for Other Squad',
  $$select public.admin_set_pilot('{selectionAssessments}', '{00000000-0000-0000-0000-0000000000b1}')$$);
select pg_temp.ok('admins keep it', pg_temp.admin_reads(), true);
select pg_temp.as_member('11');
select pg_temp.ok('a panel member outside the pilot loses the round', pg_temp.reads_round(pg_temp.round()), false);
select pg_temp.ok('and can''t write', pg_temp.writes_athlete(pg_temp.round(), '32'), false);
select pg_temp.as_member('61');
select pg_temp.ok('the pilot squad''s coach keeps theirs', pg_temp.reads_round(pg_temp.round('Other selections')), true);
select pg_temp.as_member('01');
select pg_temp.works('an admin ends the pilot', $$select public.admin_set_pilot('{}', '{}')$$);
select pg_temp.as_member('11');
select pg_temp.ok('everyone on a panel has it again', pg_temp.reads_round(pg_temp.round()), true);

select pg_temp.as_member('01');
select pg_temp.set_feature(false);
select pg_temp.as_member('11');
select pg_temp.ok('turning the feature off closes it to the panel', pg_temp.reads_round(pg_temp.round()), false);
select pg_temp.ok('and nothing can be written', pg_temp.writes_athlete(pg_temp.round(), '32'), false);
select pg_temp.as_member('01');
select pg_temp.ok('and to admins', pg_temp.audits(pg_temp.round()), false);
select pg_temp.eq('nothing is deleted by turning it off',
  (select count(*)::text from public.assessment_observations where round_id = pg_temp.round()), '7');
select pg_temp.set_feature(true);

-- ---------------------------------------------------------------------------
-- When people and groups go
-- ---------------------------------------------------------------------------

-- A selector's account goes: what they wrote stays under their name.
delete from public.profiles where id = pg_temp.id('62');
select pg_temp.eq('a departed selector''s observations stay',
  (select count(*)::text from public.assessment_observations where author_name = 'Ola Selector' and author_id is null), '2');
select pg_temp.eq('and they stay in the audit report by name',
  (select s ->> 'observations' from jsonb_array_elements(public.admin_selection_audit(pg_temp.round()) -> 'selectors') s where s ->> 'name' = 'Ola Selector'), '2');
select pg_temp.as_member('11');
select pg_temp.eq('the panel still reads them, under that name',
  (select count(*)::text from jsonb_array_elements(public.athlete_assessment(pg_temp.round(), pg_temp.id('31')) -> 'observations') o
    where o ->> 'author_name' = 'Ola Selector'), '1');

-- An athlete's account goes: their assessment goes with it.
delete from public.profiles where id = pg_temp.id('32');
select pg_temp.eq('an athlete''s observations go with their account',
  (select count(*)::text from public.assessment_observations where athlete_id = pg_temp.id('32')), '0');
select pg_temp.eq('other athletes'' stay',
  (select count(*)::text from public.assessment_observations where athlete_id = pg_temp.id('31')), '4');

-- An athlete leaves the squad: the panel no longer reads them; the record stays.
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a2' and profile_id = pg_temp.id('31');
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = pg_temp.id('31');
select pg_temp.ok('an athlete who left the squad isn''t open to the panel', pg_temp.reads_athlete(pg_temp.round(), '31'), false);
select pg_temp.eq('their observations are kept',
  (select count(*)::text from public.assessment_observations where athlete_id = pg_temp.id('31')), '4');

-- The squad itself is deleted: the round and its record stay, by name.
delete from public.teams where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.as_member('01');
select pg_temp.eq('a round outlives its squad, under the squad''s name',
  (select team_name from public.admin_selection_rounds() where name = 'Other selections'), 'Other Squad');
select pg_temp.ok('and its audit report still builds', pg_temp.audits(pg_temp.round('Other selections')), true);
