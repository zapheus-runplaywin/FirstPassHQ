-- Tests for 20261023120000_wellbeing_flags.sql: the Child Safety Officer sees
-- every athlete's check-in flags (day and lowest score only), with a to-do
-- count for athletes flagged on 3 days in 7; under 18s only with data
-- consent, and each view of a child's flags is logged (customer review C9).
-- Run on a fresh database with the migrations and seed-members.sql loaded.
-- Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.is(label text, actual bigint, expected bigint) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
-- Fails unless the error message contains the expected words.
create or replace function pg_temp.fails_with(label text, statement text, words text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when position(words in sqlerrm) > 0 then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
-- Days the signed-in member sees flagged for an athlete, in the last p_days.
create or replace function pg_temp.flag_days(n text, p_days int default 14) returns bigint language sql as
$$ select count(*) from public.wellbeing_flags(p_days) where athlete_id = pg_temp.id(n) $$;
create or replace function pg_temp.check_in(n text, back int, low int) returns void language sql as
$$ insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
   values (pg_temp.id(n), public.club_today() - back, 4, low, 4, 5, 'Private note')
   on conflict (athlete_id, day) do update set soreness = excluded.soreness $$;
create or replace function pg_temp.officer_cannot(n text) returns text language sql as
$$ select pg_temp.as_member(n);
   select pg_temp.fails_with('member ' || n || ' is refused the flags', 'select * from public.wellbeing_flags()', 'Only the Child Safety Officer sees wellbeing flags') $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
-- Casey Coach is the Child Safety Officer, Emery Manager the Complaints Manager.
delete from public.safeguarding_post_holders where post = 'child_safety_officer';
insert into public.safeguarding_post_holders (post, profile_id) values ('child_safety_officer', pg_temp.id('11'));
delete from public.safeguarding_post_holders where post = 'complaints_manager';
insert into public.safeguarding_post_holders (post, profile_id) values ('complaints_manager', pg_temp.id('13'));

-- More athletes: 61 an adult in no squad or team (not selected), 62 asking
-- to join, 63 a coach who also plays.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'athlete.unselected@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'athlete.pending@example.test', now()),
  ('00000000-0000-0000-0000-000000000063', 'coach.player@example.test', now());
update public.profiles p set status = v.status::public.member_status, full_name = v.name,
  role = v.role::public.app_role, extra_roles = v.extra::public.app_role[],
  date_of_birth = public.club_today() - interval '22 years', verified_at = now(),
  wwcc_number = 'WWC' || right(v.id, 4), wwcc_expires_on = public.club_today() + 400
from (values
  ('00000000-0000-0000-0000-000000000061', 'Nico Unselected', 'athlete', '{}', 'approved'),
  ('00000000-0000-0000-0000-000000000062', 'Oli Waiting', 'athlete', '{}', 'pending'),
  ('00000000-0000-0000-0000-000000000063', 'Pat Coach-Player', 'coach', '{athlete}', 'approved')
) as v(id, name, role, extra, status)
where p.id = v.id::uuid;

-- Jordan (31, under 18) is flagged today in the seed (stress 2). Kai (32)
-- is flagged on 3 of the last 7 days and once 20 days ago, and fine today.
select pg_temp.check_in('32', 0, 4);
select pg_temp.check_in('32', 1, 2);
select pg_temp.check_in('32', 3, 1);
select pg_temp.check_in('32', 6, 2);
select pg_temp.check_in('32', 20, 1);
select pg_temp.check_in('61', 2, 2);
select pg_temp.check_in('62', 1, 1);
select pg_temp.check_in('63', 1, 2);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members can ask whether they are the Child Safety Officer', has_function_privilege('authenticated', 'public.is_child_safety_officer()', 'execute'), true);
select pg_temp.ok('anon cannot ask whether they are the Child Safety Officer', has_function_privilege('anon', 'public.is_child_safety_officer()', 'execute'), false);
select pg_temp.ok('members can call the flags (it checks for the officer)', has_function_privilege('authenticated', 'public.wellbeing_flags(int)', 'execute'), true);
select pg_temp.ok('anon cannot call the flags', has_function_privilege('anon', 'public.wellbeing_flags(int)', 'execute'), false);
select pg_temp.ok('members can call the to-do count', has_function_privilege('authenticated', 'public.wellbeing_flag_alerts()', 'execute'), true);
select pg_temp.ok('anon cannot call the to-do count', has_function_privilege('anon', 'public.wellbeing_flag_alerts()', 'execute'), false);
select pg_temp.ok('helper is closed: wellbeing_flag_rows', has_function_privilege('authenticated', 'public.wellbeing_flag_rows(int)', 'execute'), false);
select pg_temp.ok('helper is closed to anon: wellbeing_flag_rows', has_function_privilege('anon', 'public.wellbeing_flag_rows(int)', 'execute'), false);
select pg_temp.ok('the flags never return answers or notes',
  pg_get_function_result('public.wellbeing_flags(int)'::regprocedure)
    = 'TABLE(athlete_id uuid, athlete_name text, day date, lowest_score smallint, flags_in_7_days integer)', true);

-- ---------------------------------------------------------------------------
-- Who is the Child Safety Officer
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('the Child Safety Officer is one', public.is_child_safety_officer(), true);
select pg_temp.as_member('13');
select pg_temp.ok('the Complaints Manager is not', public.is_child_safety_officer(), false);
select pg_temp.as_member('01');
select pg_temp.ok('an admin is not', public.is_child_safety_officer(), false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in is not', public.is_child_safety_officer(), false);

-- Everyone but the Child Safety Officer is refused, admins included.
select pg_temp.officer_cannot('01');
select pg_temp.officer_cannot('02');
select pg_temp.officer_cannot('12');
select pg_temp.officer_cannot('13');
select pg_temp.officer_cannot('14');
select pg_temp.officer_cannot('21');
select pg_temp.officer_cannot('22');
select pg_temp.officer_cannot('23');
select pg_temp.officer_cannot('31');
select pg_temp.officer_cannot('32');
select pg_temp.officer_cannot('41');
select pg_temp.officer_cannot('42');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails_with('nobody signed in is refused', 'select * from public.wellbeing_flags()', 'Only the Child Safety Officer sees wellbeing flags');

-- The to-do count is null for everyone else.
select pg_temp.as_member('01');
select pg_temp.ok('an admin gets no to-do count', public.wellbeing_flag_alerts() is null, true);
select pg_temp.as_member('13');
select pg_temp.ok('the Complaints Manager gets no to-do count', public.wellbeing_flag_alerts() is null, true);
select pg_temp.as_member('11');
select pg_temp.ok('the officer gets a to-do count', public.wellbeing_flag_alerts() is not null, true);
select pg_temp.as_member('42');
select pg_temp.ok('another coach gets no to-do count', public.wellbeing_flag_alerts() is null, true);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete gets no to-do count', public.wellbeing_flag_alerts() is null, true);

-- ---------------------------------------------------------------------------
-- What the Child Safety Officer sees
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.is('an adult flagged on 3 days in the last 14 shows 3 days', pg_temp.flag_days('32'), 3);
select pg_temp.is('a flag 20 days ago shows when asked for 30 days', pg_temp.flag_days('32', 30), 4);
select pg_temp.is('a flag 20 days ago is left out of the last 14 days', pg_temp.flag_days('32', 14), 3);
select pg_temp.is('asking for more than 60 days gives 60', pg_temp.flag_days('32', 1000), 4);
select pg_temp.is('asking for 0 days gives today only', pg_temp.flag_days('32', 0), 0);
select pg_temp.is('no days given means 14', (select count(*) from public.wellbeing_flags(null) where athlete_id = pg_temp.id('32')), 3);
select pg_temp.is('a day with no low score is not a flag', (select count(*) from public.wellbeing_flags() where athlete_id = pg_temp.id('32') and day = public.club_today()), 0);
select pg_temp.is('the lowest score is shown', (select lowest_score from public.wellbeing_flags() where athlete_id = pg_temp.id('32') and day = public.club_today() - 3), 1);
select pg_temp.is('each row counts the athlete''s flags in the last 7 days', (select min(flags_in_7_days) from public.wellbeing_flags() where athlete_id = pg_temp.id('32')), 3);
select pg_temp.ok('rows are newest first', (select array_agg(day) = array_agg(day order by day desc) from public.wellbeing_flags() where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('the athlete''s name is shown', exists (select 1 from public.wellbeing_flags() where athlete_name = 'Kai Senior'), true);
select pg_temp.is('an athlete in no squad or team shows', pg_temp.flag_days('61'), 1);
select pg_temp.is('a member asking to join does not', pg_temp.flag_days('62'), 0);
select pg_temp.is('a coach who also plays shows as an athlete', pg_temp.flag_days('63'), 1);
select pg_temp.is('an under 18 without data consent does not show', pg_temp.flag_days('31'), 0);
select pg_temp.is('only Kai is flagged on 3 days in 7', public.wellbeing_flag_alerts(), 1);

-- Not selected: Kai's places end, and the flags still show.
delete from public.team_members where profile_id = pg_temp.id('32');
select pg_temp.is('an athlete with no squad or team place still shows', pg_temp.flag_days('32'), 3);

-- Data consent brings a child's flags in; withdrawing it takes them out.
select pg_temp.as_member('41');
select public.set_child_consent(pg_temp.id('31'), true, false);
select pg_temp.as_member('11');
select pg_temp.is('an under 18 with data consent shows', pg_temp.flag_days('31'), 1);
select pg_temp.check_in('31', 2, 2);
select pg_temp.check_in('31', 4, 1);
select pg_temp.is('a child flagged on 3 days in 7 joins the to-do count', public.wellbeing_flag_alerts(), 2);
select pg_temp.as_member('41');
select public.set_child_consent(pg_temp.id('31'), false, false);
select pg_temp.as_member('11');
select pg_temp.is('withdrawn data consent hides the child again', pg_temp.flag_days('31'), 0);
select pg_temp.is('and takes them out of the to-do count', public.wellbeing_flag_alerts(), 1);
select pg_temp.as_member('41');
select public.set_child_consent(pg_temp.id('31'), true, false);

-- ---------------------------------------------------------------------------
-- Logging a child's flags
-- ---------------------------------------------------------------------------
delete from public.record_access_log;
select pg_temp.as_member('11');
select pg_temp.is('the officer sees four athletes'' flags', (select count(distinct athlete_id) from public.wellbeing_flags()), 4);
select pg_temp.is('opening the flags logs one view of the child''s check-ins',
  (select count(*) from public.record_access_log where subject_id = pg_temp.id('31') and viewer_id = pg_temp.id('11') and kind = 'check_ins'), 1);
select pg_temp.is('adults'' flags are not logged', (select count(*) from public.record_access_log where subject_id <> pg_temp.id('31')), 0);
select pg_temp.is('and still four the second time', (select count(distinct athlete_id) from public.wellbeing_flags()), 4);
select pg_temp.is('opening again straight away is not logged twice', (select count(*) from public.record_access_log), 1);
select pg_temp.as_member('13');
select pg_temp.fails_with('a refused member', 'select * from public.wellbeing_flags()', 'Only the Child Safety Officer');
select pg_temp.is('and a refused call logs nothing', (select count(*) from public.record_access_log), 1);
select pg_temp.as_member('11');
select public.wellbeing_flag_alerts();
select pg_temp.is('the to-do count logs nothing', (select count(*) from public.record_access_log), 1);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- An officer who can't act as one sees nothing
-- ---------------------------------------------------------------------------
update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.officer_cannot('11');
select pg_temp.ok('a stood down officer gets no to-do count', public.wellbeing_flag_alerts() is null, true);
update public.profiles set stood_down_at = null where id = pg_temp.id('11');
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('11');
select pg_temp.officer_cannot('11');
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('11');
delete from public.safeguarding_post_holders where post = 'child_safety_officer';
select pg_temp.officer_cannot('11');
select pg_temp.ok('with no officer named, nobody gets a to-do count', public.wellbeing_flag_alerts() is null, true);
-- A new officer sees the flags straight away.
delete from public.safeguarding_post_holders where post = 'child_safety_officer';
insert into public.safeguarding_post_holders (post, profile_id) values ('child_safety_officer', pg_temp.id('14'));
select pg_temp.as_member('14');
select pg_temp.is('a newly named officer sees the flags', pg_temp.flag_days('32'), 3);
select pg_temp.officer_cannot('11');
select set_config('request.jwt.claim.sub', '', false);

-- Nothing else changed: check-ins are as they were.
select pg_temp.is('check-ins are untouched', (select count(*) from public.check_ins), 11);
select pg_temp.ok('notes are kept', (select count(*) = 10 from public.check_ins where note = 'Private note'), true);

-- ---------------------------------------------------------------------------
-- Daily check-ins switched off: the database shows nothing either
-- (20261023160000_review_follow_ups.sql)
-- ---------------------------------------------------------------------------
select pg_temp.as_member('14');
update public.club_settings set features = coalesce(features, '{}'::jsonb) || '{"checkIns": false}'::jsonb where id;
select pg_temp.is('with Daily check-ins off, the officer sees no flags', (select count(*) from public.wellbeing_flags()), 0);
select pg_temp.is('and the to-do count is 0', public.wellbeing_flag_alerts(), 0);
update public.club_settings set features = features || '{"checkIns": true}'::jsonb where id;
select pg_temp.is('switched back on, the flags are back', pg_temp.flag_days('32'), 3);
update public.club_settings set features = features - 'checkIns' where id;
select pg_temp.is('and with no setting at all they stay on', pg_temp.flag_days('32'), 3);
select set_config('request.jwt.claim.sub', '', false);
