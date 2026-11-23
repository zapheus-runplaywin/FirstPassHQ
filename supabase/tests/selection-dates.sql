-- Tests for 20261123200000_selection_dates.sql: a selection round's dates,
-- the to-dos they give, the attendance summary, and the criteria and dates
-- athletes and their parents see. Run on a fresh database with the
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
-- Whether the signed-in member can do each thing.
create or replace function pg_temp.admin_dates(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.admin_selection_milestones(p_round); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.panel_dates(p_round uuid) returns boolean language plpgsql as
$$ begin perform public.selection_round_dates(p_round); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.attendance(p_round uuid, n text) returns boolean language plpgsql as
$$ begin perform public.athlete_round_attendance(p_round, pg_temp.id(n)); return true;
   exception when others then return false; end $$;
create or replace function pg_temp.adds_date(p_round uuid) returns boolean language plpgsql as
$$ begin
     perform public.admin_save_selection_milestone(null, p_round,
       'Probe ' || right(current_setting('request.jwt.claim.sub'), 2), public.club_today() + 60, true);
     return true;
   exception when others then return false; end $$;
create or replace function pg_temp.todo_count(p_kind text) returns bigint language sql as
$$ select count(*) from public.my_selection_todos() t where t.kind = p_kind $$;
create or replace function pg_temp.info_count() returns bigint language sql as
$$ select count(*) from public.my_selection_info() $$;

-- A guest with a current check (an independent selector) and a second squad
-- with its own athlete, only for this file. Gale (21)'s check is current.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('62'), 'guest.checked@example.test', now()),
  (pg_temp.id('64'), 'athlete.other@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, verified_at = now(), date_of_birth = v.dob
from (values
  ('62', 'Ola Selector', 'guest', 'WWC0062', public.club_today() + 400, null::date),
  ('64', 'Quinn Other', 'athlete', null, null, (public.club_today() - interval '22 years')::date)
) as v(n, name, role, wwcc, exp, dob)
where p.id = pg_temp.id(v.n);
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('64'), 'athlete');
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('signed-in members cannot read the dates table directly',
  has_table_privilege('authenticated', 'public.selection_round_milestones', 'select'), false);
select pg_temp.ok('signed-in members cannot write the dates table directly',
  has_table_privilege('authenticated', 'public.selection_round_milestones', 'insert')
  or has_table_privilege('authenticated', 'public.selection_round_milestones', 'update')
  or has_table_privilege('authenticated', 'public.selection_round_milestones', 'delete'), false);
select pg_temp.ok('anon reads none of the dates table',
  has_table_privilege('anon', 'public.selection_round_milestones', 'select'), false);
select pg_temp.ok('row level security is on for the dates table',
  (select relrowsecurity from pg_class where oid = 'public.selection_round_milestones'::regclass), true);
select pg_temp.ok('anon cannot call ' || f, has_function_privilege('anon', f, 'execute'), false)
from unnest(array[
  'public.admin_selection_milestones(uuid)',
  'public.admin_save_selection_milestone(uuid, uuid, text, date, boolean)',
  'public.admin_set_selection_milestone_done(uuid, boolean)',
  'public.admin_remove_selection_milestone(uuid)',
  'public.selection_round_dates(uuid)', 'public.my_selection_todos()',
  'public.athlete_round_attendance(uuid, uuid)', 'public.my_selection_info()']) f;

-- ---------------------------------------------------------------------------
-- Setting up: criteria, a round for the Sample Squad (panel: Casey 11 and
-- Morgan 42, parent of Jordan 31; Drew 12's check has lapsed) plus Ola the
-- guest, and a round for the Other Squad with nobody from the Sample Squad.
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.set_feature(true);
select pg_temp.works('an admin saves criteria', $$select public.admin_save_assessment_criteria(
  '{"groups": [{"key": "skills", "name": "Skills", "scale": ["Below", "Meets", "Exceeds"],
    "items": [{"key": "passing", "name": "Passing"}]}]}')$$);
select pg_temp.works('an admin opens a round that started 20 days ago and ends in 40',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000a1', 'Sample selections',
    public.club_today() - 20, public.club_today() + 40)$$);
select pg_temp.works('an admin opens the Other Squad''s round',
  $$select public.admin_open_selection_round('00000000-0000-0000-0000-0000000000b1', 'Other selections',
    public.club_today() - 20, public.club_today() + 40)$$);
select pg_temp.works('an admin adds the guest selector',
  $$select public.admin_add_selection_panel_member(pg_temp.round(), pg_temp.id('62'))$$);

-- ---------------------------------------------------------------------------
-- Who may read and change a round's dates, for every kind of member
-- ---------------------------------------------------------------------------

select pg_temp.m_ok(n, who || ': reads the dates as an admin', 'pg_temp.admin_dates(pg_temp.round())', admin)
  || E'\n' || pg_temp.m_ok(n, who || ': adds a date', 'pg_temp.adds_date(pg_temp.round())', admin)
  || E'\n' || pg_temp.m_ok(n, who || ': reads the dates as the panel', 'pg_temp.panel_dates(pg_temp.round())', panel)
from (values
  ('01', 'an admin', true, false),
  ('02', 'another admin', true, false),
  ('11', 'a coach on the panel', false, true),
  ('42', 'a coach on the panel who is a parent', false, true),
  ('62', 'a guest selector with a check', false, true),
  ('12', 'a coach whose check lapsed', false, false),
  ('13', 'a manager', false, false),
  ('14', 'a physio', false, false),
  ('21', 'the committee', false, false),
  ('31', 'an athlete under 18 in the round', false, false),
  ('32', 'an adult athlete in the round', false, false),
  ('41', 'a parent', false, false),
  ('64', 'an athlete in another squad', false, false)
) as v(n, who, admin, panel);

select pg_temp.as_member('01');
select pg_temp.eq('only the admins'' probe dates were added',
  (select string_agg(title, ', ' order by title) from public.admin_selection_milestones(pg_temp.round())),
  'Probe 01, Probe 02');
select pg_temp.works('an admin takes the probes off',
  $$select public.admin_remove_selection_milestone(id) from public.admin_selection_milestones(pg_temp.round())$$);
select pg_temp.eq('dates taken off stay, marked with who took them off',
  (select string_agg(title || ' by ' || removed_by_name, ', ' order by title)
   from public.admin_selection_milestones(pg_temp.round()) where removed_at is not null),
  'Probe 01 by Alex Admin, Probe 02 by Alex Admin');
select pg_temp.fails('a date taken off can''t be taken off again',
  $$select public.admin_remove_selection_milestone(pg_temp.date_id('Probe 01'))$$);
select pg_temp.fails('a date taken off can''t be changed',
  $$select public.admin_save_selection_milestone(pg_temp.date_id('Probe 01'), pg_temp.round(), 'Back', public.club_today(), true)$$);
select pg_temp.fails('a date taken off can''t be marked done',
  $$select public.admin_set_selection_milestone_done(pg_temp.date_id('Probe 01'), true)$$);
select pg_temp.m_ok('11', 'the panel doesn''t see dates taken off',
  '(select count(*) from public.selection_round_dates(pg_temp.round())) = 0', true);

-- ---------------------------------------------------------------------------
-- Saving dates
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.fails('a date needs a name',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), '  ', public.club_today(), true)$$);
select pg_temp.fails('a name is 60 characters at most',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), repeat('a', 61), public.club_today(), true)$$);
select pg_temp.fails('a date needs a day',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'No day', null, true)$$);
select pg_temp.fails('a day is within a year of the round',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'Far off', public.club_today() + 40 + 367, true)$$);
select pg_temp.fails('a date needs a round that exists',
  $$select public.admin_save_selection_milestone(null, gen_random_uuid(), 'Nowhere', public.club_today(), true)$$);

select pg_temp.works('an admin adds a date that was due 5 days ago',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'Criteria shared', public.club_today() - 5, true)$$);
select pg_temp.works('an admin adds a date due in 7 days',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'Observations complete', public.club_today() + 7, true)$$);
select pg_temp.works('an admin adds a date due in 8 days, kept from athletes',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'Panel meets', public.club_today() + 8, false)$$);
select pg_temp.works('an admin adds a date to the other round',
  $$select public.admin_save_selection_milestone(null, pg_temp.round('Other selections'), 'Other teams named', public.club_today() + 1, true)$$);
select pg_temp.works('an admin changes a date''s name and day',
  $$select public.admin_save_selection_milestone(pg_temp.date_id('Panel meets'), pg_temp.round(), 'Panel meeting', public.club_today() + 9, null)$$);
select pg_temp.eq('the change is saved, and no answer on sharing means shared',
  (select title || ' ' || (due_on - public.club_today()) || ' ' || shared
   from public.admin_selection_milestones(pg_temp.round()) where title like 'Panel%'),
  'Panel meeting 9 true');
select pg_temp.works('an admin keeps it from athletes again',
  $$select public.admin_save_selection_milestone(pg_temp.date_id('Panel meeting'), pg_temp.round(), 'Panel meeting', public.club_today() + 9, false)$$);
select pg_temp.fails('a date can''t be moved to another round',
  $$select public.admin_save_selection_milestone(pg_temp.date_id('Panel meeting'), pg_temp.round('Other selections'), 'Moved', public.club_today(), true)$$);
select pg_temp.eq('the dates read soonest first, with who added them and how late the open ones are',
  (select string_agg(title || ' ' || created_by_name || ' late ' || days_late, ', ')
   from public.admin_selection_milestones(pg_temp.round()) where removed_at is null),
  'Criteria shared Alex Admin late 5, Observations complete Alex Admin late 0, Panel meeting Alex Admin late 0');

select pg_temp.m_eq('11', 'the panel reads every date that stands, soonest first',
  $$select string_agg(title || ' ' || done, ', ') from public.selection_round_dates(pg_temp.round())$$,
  'Criteria shared false, Observations complete false, Panel meeting false');

-- 12 dates at most stand in a round.
select pg_temp.as_member('01');
select count(public.admin_save_selection_milestone(null, pg_temp.round(), 'Filler ' || n, public.club_today() + 30, false)) as filler_dates
from generate_series(1, 9) n;
select pg_temp.fails('a round holds 12 dates at most',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'Thirteenth', public.club_today() + 30, false)$$);
select public.admin_remove_selection_milestone(id)
from public.admin_selection_milestones(pg_temp.round()) where title like 'Filler%';
select pg_temp.works('dates taken off don''t count towards the 12',
  $$select public.admin_save_selection_milestone(null, pg_temp.round(), 'Teams named', public.club_today() + 30, true)$$);

-- ---------------------------------------------------------------------------
-- To-dos
-- ---------------------------------------------------------------------------

-- Two dates of the Sample round are due within 7 days or overdue; the Other
-- round has one. Admins get every open round's; the panel only their own.
select pg_temp.m_eq(n, who || ': date to-dos', 'pg_temp.todo_count(''date'')', dates::text)
from (values
  ('01', 'an admin', 3),
  ('11', 'a coach on the panel', 2),
  ('42', 'a coach on the panel who is a parent', 2),
  ('62', 'a guest selector with a check', 2),
  ('12', 'a coach whose check lapsed', 0),
  ('13', 'a manager', 0),
  ('14', 'a physio', 0),
  ('21', 'the committee', 0),
  ('31', 'an athlete under 18 in the round', 0),
  ('32', 'an adult athlete in the round', 0),
  ('41', 'a parent', 0),
  ('64', 'an athlete in another squad', 0)
) as v(n, who, dates);

select pg_temp.m_eq('11', 'a selector''s date to-dos name the step, the round and the day, soonest first',
  $$select string_agg(title || ' / ' || round_name || ' / ' || (due_on - public.club_today()) || ' / ' || for_admin, ', ')
    from public.my_selection_todos() where kind = 'date'$$,
  'Criteria shared / Sample selections / -5 / false, Observations complete / Sample selections / 7 / false');
select pg_temp.m_ok('01', 'an admin''s are marked as theirs to mark done',
  $$(select bool_and(for_admin) from public.my_selection_todos() where kind = 'date')$$, true);
select pg_temp.m_ok('11', 'a date due in 8 days or more isn''t a to-do yet',
  $$(select count(*) from public.my_selection_todos() where title in ('Panel meeting', 'Teams named')) = 0$$, true);

select pg_temp.as_member('01');
select pg_temp.works('an admin marks the overdue date done',
  $$select public.admin_set_selection_milestone_done(pg_temp.date_id('Criteria shared'), true)$$);
select pg_temp.eq('who marked it done is kept, and how late it was',
  (select done_by_name || ' late ' || days_late || ' ' || (done_at is not null)
   from public.admin_selection_milestones(pg_temp.round()) where title = 'Criteria shared'),
  'Alex Admin late 5 true');
select pg_temp.as_member('02');
select pg_temp.works('marking it done again changes nothing',
  $$select public.admin_set_selection_milestone_done(pg_temp.date_id('Criteria shared'), true)$$);
select pg_temp.eq('the first admin still stands as who did it',
  (select done_by_name from public.admin_selection_milestones(pg_temp.round()) where title = 'Criteria shared'),
  'Alex Admin');
select pg_temp.fails('a date that is done can''t be changed',
  $$select public.admin_save_selection_milestone(pg_temp.date_id('Criteria shared'), pg_temp.round(), 'Changed', public.club_today(), true)$$);
select pg_temp.m_eq('11', 'a done date leaves the panel''s to-dos', 'pg_temp.todo_count(''date'')', '1');
select pg_temp.m_eq('11', 'and reads as done to the panel',
  $$select done from public.selection_round_dates(pg_temp.round()) where title = 'Criteria shared'$$, 'true');
select pg_temp.as_member('02');
select pg_temp.works('an admin marks it not done after all',
  $$select public.admin_set_selection_milestone_done(pg_temp.date_id('Criteria shared'), false)$$);
select pg_temp.eq('nobody stands as having done it',
  (select coalesce(done_by_name, 'nobody') || ' ' || (done_at is null)
   from public.admin_selection_milestones(pg_temp.round()) where title = 'Criteria shared'),
  'nobody true');
select pg_temp.m_eq('11', 'and it is a to-do again', 'pg_temp.todo_count(''date'')', '2');
select pg_temp.fails('a date that doesn''t exist can''t be marked',
  $$select public.admin_set_selection_milestone_done(gen_random_uuid(), true)$$);

-- Nothing written yet: only in a round's last 14 days.
select pg_temp.m_eq('11', 'no "nothing written" to-do with 40 days to go', 'pg_temp.todo_count(''thin'')', '0');
update public.selection_rounds set ends_on = public.club_today() + 14 where name = 'Sample selections';
select pg_temp.m_eq('11', '14 days from the end, a selector is told how many athletes have nothing written',
  $$select kind || ' ' || athletes || ' ' || (due_on - public.club_today()) from public.my_selection_todos() where kind = 'thin'$$,
  'thin 2 14');
select pg_temp.m_eq('42', 'a parent on the panel isn''t counted their own child',
  $$select athletes from public.my_selection_todos() where kind = 'thin'$$, '1');
select pg_temp.m_eq('01', 'an admin gets no "nothing written" to-do', 'pg_temp.todo_count(''thin'')', '0');
select pg_temp.m_eq('32', 'an athlete gets none', 'pg_temp.todo_count(''thin'')', '0');
select pg_temp.as_member('62');
select pg_temp.works('the guest selector writes about Kai',
  $$select public.save_assessment_observation(null, pg_temp.round(), pg_temp.id('32'), 'training', public.club_today(),
    'Strong drive', '[{"item_key": "passing", "rating": 2}]')$$);
select pg_temp.m_eq('11', 'an athlete anyone has written about no longer counts',
  $$select athletes from public.my_selection_todos() where kind = 'thin'$$, '1');
select pg_temp.m_eq('42', 'and the parent on the panel has nobody left', 'pg_temp.todo_count(''thin'')', '0');
update public.selection_rounds set ends_on = public.club_today() - 1 where name = 'Sample selections';
select pg_temp.m_eq('11', 'the day after the round ends it stops', 'pg_temp.todo_count(''thin'')', '0');
update public.selection_rounds set ends_on = public.club_today() + 40 where name = 'Sample selections';

-- A closed round gives nobody to-dos.
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), true);
select pg_temp.m_eq('11', 'a closed round gives its panel no to-dos', '(select count(*) from public.my_selection_todos())', '0');
select pg_temp.m_eq('01', 'and an admin only the other round''s', 'pg_temp.todo_count(''date'')', '1');
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), false);

-- ---------------------------------------------------------------------------
-- Attendance during the round
-- ---------------------------------------------------------------------------

-- Three squad sessions in the round (Kai at two), one of the squad's team,
-- one before the round, one of another squad and a whole-club one.
insert into public.attendance_sessions (id, team_id, team_name, club_wide, name, held_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', false, 'Training 1', now() - interval '10 days'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', false, 'Training 2', now() - interval '6 days'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', false, 'Training 3', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', false, 'Team game', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', false, 'Before the round', now() - interval '30 days'),
  ('00000000-0000-0000-0000-00000000e006', '00000000-0000-0000-0000-0000000000b1', 'Other Squad', false, 'Other training', now() - interval '4 days'),
  ('00000000-0000-0000-0000-00000000e007', null, 'Whole club', true, 'Club day', now() - interval '5 days');
insert into public.attendance_marks (session_id, profile_id, present) values
  ('00000000-0000-0000-0000-00000000e001', pg_temp.id('32'), true),
  ('00000000-0000-0000-0000-00000000e002', pg_temp.id('32'), false),
  ('00000000-0000-0000-0000-00000000e003', pg_temp.id('32'), true),
  ('00000000-0000-0000-0000-00000000e005', pg_temp.id('32'), true),
  ('00000000-0000-0000-0000-00000000e006', pg_temp.id('32'), true),
  ('00000000-0000-0000-0000-00000000e007', pg_temp.id('32'), true),
  ('00000000-0000-0000-0000-00000000e001', pg_temp.id('31'), true),
  ('00000000-0000-0000-0000-00000000e004', pg_temp.id('31'), true);

select pg_temp.m_eq('11', 'a selector sees sessions marked and attended in the round, for the squad only',
  $$select sessions || ' of which ' || attended from public.athlete_round_attendance(pg_temp.round(), pg_temp.id('32'))$$,
  '3 of which 2');
select pg_temp.m_eq('11', 'a squad round counts its teams'' sessions too',
  $$select sessions || ' of which ' || attended from public.athlete_round_attendance(pg_temp.round(), pg_temp.id('31'))$$,
  '2 of which 2');
select pg_temp.m_eq('62', 'an athlete marked at nothing shows none',
  $$select sessions || ' of which ' || attended from public.athlete_round_attendance(pg_temp.round('Sample selections'), pg_temp.id('32'))$$,
  '3 of which 2');

select pg_temp.m_ok(n, who || ': reads Kai''s attendance in the round', 'pg_temp.attendance(pg_temp.round(), ''32'')', kai)
  || E'\n' || pg_temp.m_ok(n, who || ': reads Jordan''s attendance in the round', 'pg_temp.attendance(pg_temp.round(), ''31'')', jordan)
from (values
  ('01', 'an admin', false, false),
  ('11', 'a coach on the panel', true, true),
  ('42', 'a coach on the panel who is Jordan''s parent', true, false),
  ('62', 'a guest selector with a check', true, true),
  ('12', 'a coach whose check lapsed', false, false),
  ('13', 'a manager', false, false),
  ('14', 'a physio', false, false),
  ('21', 'the committee', false, false),
  ('31', 'Jordan', false, false),
  ('32', 'Kai', false, false),
  ('41', 'Jordan''s parent', false, false),
  ('64', 'an athlete in another squad', false, false)
) as v(n, who, kai, jordan);
select pg_temp.m_ok('11', 'a selector can''t read an athlete outside the round',
  'pg_temp.attendance(pg_temp.round(), ''64'')', false);

-- ---------------------------------------------------------------------------
-- The criteria and dates for athletes and their parents
-- ---------------------------------------------------------------------------

select pg_temp.m_eq(n, who || ': rounds they are shown', 'pg_temp.info_count()', rounds::text)
from (values
  ('31', 'an athlete under 18 in the round', 1),
  ('32', 'an adult athlete in the round', 1),
  ('41', 'the verified parent of an athlete under 18 in the round', 1),
  ('42', 'a coach who is the parent of an athlete in the round', 1),
  ('64', 'an athlete in the other squad', 1),
  ('01', 'an admin', 0),
  ('11', 'a coach on the panel', 0),
  ('12', 'a coach whose check lapsed', 0),
  ('13', 'a manager', 0),
  ('14', 'a physio', 0),
  ('21', 'the committee', 0),
  ('62', 'a guest selector', 0)
) as v(n, who, rounds);

select pg_temp.m_eq('32', 'an athlete sees their own round, its criteria and the shared dates only',
  $$select round_name || ' / ' || team_name || ' / ' || is_me || ' / ' || (criteria #>> '{groups,0,items,0,name}') || ' / '
      || (select string_agg(d ->> 'title', ', ') from jsonb_array_elements(dates) d)
    from public.my_selection_info()$$,
  'Sample selections / Sample Squad / true / Passing / Criteria shared, Observations complete, Teams named');
select pg_temp.m_ok('32', 'never a date kept from athletes or one taken off',
  $$(select dates::text !~ 'Panel meeting|Probe|Filler' from public.my_selection_info())$$, true);
select pg_temp.m_ok('32', 'no rating, evidence or selector name comes with it',
  $$(select to_jsonb(i)::text !~* 'Strong drive|Ola|Casey|rated|evidence' from public.my_selection_info() i)$$, true);
select pg_temp.m_eq('32', 'and the row holds these columns only',
  $$select string_agg(k, ', ' order by k) from public.my_selection_info() i, jsonb_object_keys(to_jsonb(i)) k$$,
  'athlete_id, athlete_name, criteria, dates, ends_on, is_me, round_id, round_name, starts_on, team_name');
select pg_temp.m_eq('41', 'a parent sees it for their child, by name',
  $$select athlete_name || ' / ' || is_me || ' / ' || round_name from public.my_selection_info()$$,
  'Jordan Junior / false / Sample selections');
select pg_temp.m_eq('64', 'an athlete in the other squad sees only that squad''s round',
  $$select round_name || ' / ' || (select string_agg(d ->> 'title', ', ') from jsonb_array_elements(dates) d)
    from public.my_selection_info()$$,
  'Other selections / Other teams named');

-- A parent who isn't verified, a parent of an adult, and a closed round.
update public.profiles set verified_at = null where id = pg_temp.id('41');
select pg_temp.m_eq('41', 'a parent who isn''t verified sees nothing', 'pg_temp.info_count()', '0');
update public.profiles set verified_at = now() where id = pg_temp.id('41');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('41'), pg_temp.id('32'));
select pg_temp.m_eq('41', 'a parent sees nothing for a child who is 18 or over', 'pg_temp.info_count()', '1');
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), true);
select pg_temp.m_eq('32', 'a closed round is no longer shown to its athletes', 'pg_temp.info_count()', '0');
select pg_temp.m_eq('41', 'or to their parents', 'pg_temp.info_count()', '0');
select pg_temp.as_member('01');
select public.admin_close_selection_round(pg_temp.round(), false);

-- ---------------------------------------------------------------------------
-- Stood down, and the feature off or for pilot teams only
-- ---------------------------------------------------------------------------

update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.m_ok('11', 'a stood-down selector can''t read the dates', 'pg_temp.panel_dates(pg_temp.round())', false);
select pg_temp.m_eq('11', 'and gets no to-dos', '(select count(*) from public.my_selection_todos())', '0');
select pg_temp.m_ok('11', 'or attendance', 'pg_temp.attendance(pg_temp.round(), ''32'')', false);
update public.profiles set stood_down_at = null where id = pg_temp.id('11');

select pg_temp.as_member('01');
select pg_temp.set_feature(false);
select pg_temp.m_ok('01', 'feature off: an admin can''t read the dates', 'pg_temp.admin_dates(pg_temp.round())', false);
select pg_temp.m_ok('01', 'feature off: an admin can''t add a date', 'pg_temp.adds_date(pg_temp.round())', false);
select pg_temp.m_ok('01', 'feature off: an admin can''t mark a date done',
  $$pg_temp.fails('x', 'select public.admin_set_selection_milestone_done(pg_temp.date_id(''Teams named''), true)') like 'PASS%'$$, true);
select pg_temp.m_ok('01', 'feature off: an admin can''t take a date off',
  $$pg_temp.fails('x', 'select public.admin_remove_selection_milestone(pg_temp.date_id(''Teams named''))') like 'PASS%'$$, true);
select pg_temp.m_eq('01', 'feature off: an admin gets no to-dos', '(select count(*) from public.my_selection_todos())', '0');
select pg_temp.m_ok('11', 'feature off: the panel can''t read the dates', 'pg_temp.panel_dates(pg_temp.round())', false);
select pg_temp.m_eq('11', 'feature off: the panel gets no to-dos', '(select count(*) from public.my_selection_todos())', '0');
select pg_temp.m_ok('11', 'feature off: the panel can''t read attendance', 'pg_temp.attendance(pg_temp.round(), ''32'')', false);
select pg_temp.m_eq('32', 'feature off: athletes are shown nothing', 'pg_temp.info_count()', '0');
select pg_temp.m_eq('41', 'feature off: parents are shown nothing', 'pg_temp.info_count()', '0');

-- For pilot teams only: the Other Squad is the pilot.
select pg_temp.as_member('01');
select pg_temp.set_feature(true);
select public.admin_set_pilot(array['selectionAssessments'], array['00000000-0000-0000-0000-0000000000b1'::uuid]);
select pg_temp.m_eq('64', 'pilot only: an athlete in the pilot squad sees its round', 'pg_temp.info_count()', '1');
select pg_temp.m_eq('32', 'pilot only: an athlete outside the pilot sees nothing', 'pg_temp.info_count()', '0');
select pg_temp.m_eq('41', 'pilot only: a parent outside the pilot sees nothing', 'pg_temp.info_count()', '0');
select pg_temp.m_ok('11', 'pilot only: a selector outside the pilot can''t read the dates', 'pg_temp.panel_dates(pg_temp.round())', false);
select pg_temp.m_ok('01', 'pilot only: an admin still reads every round''s dates', 'pg_temp.admin_dates(pg_temp.round())', true);
select pg_temp.as_member('01');
select public.admin_set_pilot(array[]::text[], array[]::uuid[]);

-- ---------------------------------------------------------------------------
-- A round that goes takes its dates; a member who goes leaves their name
-- ---------------------------------------------------------------------------

select pg_temp.as_member('02');
select public.admin_set_selection_milestone_done(pg_temp.date_id('Criteria shared'), true);
delete from auth.users where id = pg_temp.id('02');
select pg_temp.m_eq('01', 'a date keeps the name of an admin who has left',
  $$select done_by_name from public.admin_selection_milestones(pg_temp.round()) where title = 'Criteria shared'$$,
  'Blair Admin');
