-- Manual test: run by hand (scripts/run-sql-tests.sh large-club concurrency, or
-- the "Scale tests" workflow), not on every push.
-- Two people saving at the same moment, in the 200-member sample club
-- (setup/large-club.sql). Each check opens two extra connections to this
-- database with dblink, signs each in as a member, starts the first save and
-- holds its transaction open, sends the second save, then commits the first
-- and collects the second: the closest two phones or a retried request can
-- get to each other. The checks then read what was kept: no lost marks, one
-- check-in a day, one register and one absence however often they're sent,
-- one consent and one survey answer each, and one coach's choice of
-- captains. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
\ir setup/large-club.sql
create extension if not exists dblink;

create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;

-- A connection signed in as sample member n, as the API role.
create or replace function pg_temp.open(conn text, n int) returns void language plpgsql as $$
begin
  perform dblink_connect(conn, format('dbname=%s user=%s', current_database(), current_user));
  perform dblink_exec(conn, format('set request.jwt.claim.sub = %L', pg_temp.lc(n)));
  perform dblink_exec(conn, 'set role authenticated');
end $$;

-- Member a runs a_sql in an open transaction; member b sends b_sql; a commits;
-- b's result is collected. Returns whether b had to wait for a, and b's error.
create temp table race_results (label text primary key, b_waited boolean, b_error text);
create or replace function pg_temp.race(label text, a int, a_sql text, b int, b_sql text) returns void language plpgsql as $$
declare
  v_waited boolean;
  v_error text;
begin
  if 'a' = any (dblink_get_connections()) then perform dblink_disconnect('a'); end if;
  if 'b' = any (dblink_get_connections()) then perform dblink_disconnect('b'); end if;
  perform pg_temp.open('a', a);
  perform pg_temp.open('b', b);
  perform dblink_exec('a', 'begin');
  perform * from dblink('a', a_sql) as t(x text);
  perform dblink_send_query('b', b_sql);
  perform pg_sleep(0.3);
  v_waited := dblink_is_busy('b') = 1;
  perform dblink_exec('a', 'commit');
  begin
    perform * from dblink_get_result('b') as t(x text);
  exception when others then v_error := sqlerrm;
  end;
  begin
    perform * from dblink_get_result('b') as t(x text);
  exception when others then null;
  end;
  perform dblink_disconnect('a');
  perform dblink_disconnect('b');
  insert into race_results values (label, v_waited, v_error);
end $$;

-- Sample people for the checks: four athletes in 17 & Under Squad, coached
-- by head coach 10 and assistant 16.
create temp table pick (k text primary key, v uuid);
insert into pick
select 'athlete' || row_number() over (order by tm.profile_id), tm.profile_id
from public.team_members tm
where tm.team_id = pg_temp.lc_team(2) and tm.team_role = 'athlete'
order by tm.profile_id limit 4;
-- A child under 18 with two verified guardians.
insert into pick
select 'child', g.athlete_id
from public.guardianships g
join public.profiles c on c.id = g.athlete_id
join public.profiles gp on gp.id = g.guardian_id
where c.id::text like '00000000-0000-0000-0001-%' and public.is_minor(c.date_of_birth, c.under_17)
group by g.athlete_id, c.date_of_birth
having count(*) = 2 and bool_and(gp.verified_at is not null and gp.status = 'approved')
order by c.date_of_birth desc, g.athlete_id limit 1;
insert into pick
select 'guardian' || row_number() over (order by g.guardian_id), g.guardian_id
from public.guardianships g where g.athlete_id = (select v from pick where k = 'child');
create or replace function pg_temp.p(k text) returns uuid language sql as $$ select v from pick where pick.k = p.k $$;
create or replace function pg_temp.n(id uuid) returns int language sql as $$ select right(id::text, 12)::int $$;

select pg_temp.ok('the sample people are there',
  (select count(*) from pick) = 7 and pg_temp.n(pg_temp.p('athlete1')) between 28 and 137, true);

-- ---------------------------------------------------------------------------
-- Two coaches change the same register: the second waits for the first, and
-- both sets of marks are kept.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', pg_temp.lc(10)::text, false);
insert into pick select 'session', public.save_attendance(null, pg_temp.lc_team(2), 'Tuesday training',
  now() - interval '2 hours', jsonb_build_array(
    jsonb_build_object('profile_id', pg_temp.p('athlete1'), 'present', true),
    jsonb_build_object('profile_id', pg_temp.p('athlete2'), 'present', true)));
select pg_temp.race('register', 10,
  format('select public.save_attendance(%L, null, %L, %L, %L)::text', pg_temp.p('session'), 'Tuesday training',
    now() - interval '2 hours', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p('athlete1'), 'present', false))),
  16,
  format('select public.save_attendance(%L, null, %L, %L, %L)::text', pg_temp.p('session'), 'Tuesday training',
    now() - interval '2 hours', jsonb_build_array(
      jsonb_build_object('profile_id', pg_temp.p('athlete2'), 'present', false),
      jsonb_build_object('profile_id', pg_temp.p('athlete3'), 'present', true))));
select pg_temp.ok('two coaches saving one register: the second waits for the first',
  (select b_waited and b_error is null from race_results where label = 'register'), true);
select pg_temp.ok('two coaches saving one register: every mark from both is kept',
  (select jsonb_object_agg(pg_temp.n(profile_id), present) from public.attendance_marks where session_id = pg_temp.p('session'))
    = jsonb_build_object(pg_temp.n(pg_temp.p('athlete1')), false, pg_temp.n(pg_temp.p('athlete2')), false,
                         pg_temp.n(pg_temp.p('athlete3')), true), true);
select pg_temp.ok('two coaches saving one register: still one register',
  (select count(*) from public.attendance_sessions where team_id = pg_temp.lc_team(2) and name = 'Tuesday training') = 1, true);

-- ---------------------------------------------------------------------------
-- Two coaches choose captains at once: the group ends with one coach's
-- choice, whichever saved last, never a mix of both.
-- ---------------------------------------------------------------------------
-- Captains are chosen per team (20 November 2026): 17 & Under B, coached by
-- head coach 10, with assistant 16 added for this check.
insert into public.team_members (team_id, profile_id, team_role, coach_title)
values (pg_temp.lc_team(22), pg_temp.lc(16), 'coach', 'assistant_coach')
on conflict do nothing;
insert into pick
select 'captain' || row_number() over (order by tm.profile_id), tm.profile_id
from public.team_members tm
join public.profiles p on p.id = tm.profile_id and p.status = 'approved'
where tm.team_id = pg_temp.lc_team(22) and tm.team_role = 'athlete'
order by tm.profile_id limit 4;
select pg_temp.race('captains', 10,
  format('select public.set_group_captains(%L::uuid, %L::uuid[], %L::uuid[])::text', pg_temp.lc_team(22),
    array[pg_temp.p('captain1')], array[pg_temp.p('captain2')]),
  16,
  format('select public.set_group_captains(%L::uuid, %L::uuid[], %L::uuid[])::text', pg_temp.lc_team(22),
    array[pg_temp.p('captain3')], array[pg_temp.p('captain4')]));
select pg_temp.ok('two coaches choosing captains: the second save goes through',
  (select b_error is null from race_results where label = 'captains'), true);
select pg_temp.ok('two coaches choosing captains: one coach''s choice is kept, not a mix of both',
  (select array_agg(profile_id order by captain_role, profile_id) from public.team_captains where team_id = pg_temp.lc_team(22))
    in (array[pg_temp.p('captain3'), pg_temp.p('captain4')], array[pg_temp.p('captain1'), pg_temp.p('captain2')]), true);

-- ---------------------------------------------------------------------------
-- A new register sent twice (a retry after a dropped connection): one
-- register, with the marks.
-- ---------------------------------------------------------------------------
select pg_temp.race('new register', 10,
  format('select public.save_attendance(null, %L, %L, %L, %L)::text', pg_temp.lc_team(2), 'Thursday training',
    date_trunc('minute', now()) - interval '1 hour',
    jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p('athlete1'), 'present', true))),
  10,
  format('select public.save_attendance(null, %L, %L, %L, %L)::text', pg_temp.lc_team(2), 'Thursday training',
    date_trunc('minute', now()) - interval '1 hour',
    jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p('athlete1'), 'present', true),
                      jsonb_build_object('profile_id', pg_temp.p('athlete2'), 'present', false))));
select pg_temp.ok('a new register sent twice: the second waits and goes through',
  (select b_waited and b_error is null from race_results where label = 'new register'), true);
select pg_temp.ok('a new register sent twice: one register, with every mark',
  (select count(*) = 1 from public.attendance_sessions where team_id = pg_temp.lc_team(2) and name = 'Thursday training')
  and (select count(*) = 2 from public.attendance_marks m join public.attendance_sessions s on s.id = m.session_id
       where s.team_id = pg_temp.lc_team(2) and s.name = 'Thursday training'), true);
-- A second coach's register for the same session is their own.
select set_config('request.jwt.claim.sub', pg_temp.lc(16)::text, false);
select public.save_attendance(null, pg_temp.lc_team(2), 'Thursday training', date_trunc('minute', now()) - interval '1 hour',
  jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p('athlete1'), 'present', true)));
select pg_temp.ok('another coach taking the same session still gets their own register',
  (select count(*) = 2 from public.attendance_sessions where team_id = pg_temp.lc_team(2) and name = 'Thursday training'), true);

-- ---------------------------------------------------------------------------
-- An absence sent twice: kept once. A different absence is still added.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.absence(days int, reason text) returns text language sql as $$
  select format('select public.report_absence(%L, current_date + %s, current_date + %s, %L, %L)::text',
    pg_temp.lc(98), days, days, (select id from public.absence_categories where active order by id limit 1), reason) $$;
select pg_temp.race('absence', 98, pg_temp.absence(3, 'Away'), 98, pg_temp.absence(3, 'Away'));
select pg_temp.ok('an absence sent twice: the second waits and goes through',
  (select b_waited and b_error is null from race_results where label = 'absence'), true);
select pg_temp.ok('an absence sent twice: kept once',
  (select count(*) = 1 from public.attendance_absences where athlete_id = pg_temp.lc(98) and from_day = current_date + 3), true);
select set_config('request.jwt.claim.sub', pg_temp.lc(98)::text, false);
select public.report_absence(pg_temp.lc(98), current_date + 3, current_date + 3,
  (select id from public.absence_categories where active order by id limit 1), 'Away for a wedding');
select public.report_absence(pg_temp.lc(98), current_date + 4, current_date + 4,
  (select id from public.absence_categories where active order by id limit 1), 'Away');
select pg_temp.ok('a different reason or day is a new absence',
  (select count(*) = 3 from public.attendance_absences where athlete_id = pg_temp.lc(98) and from_day >= current_date + 3), true);

-- ---------------------------------------------------------------------------
-- An athlete's check-in sent twice (a retry on a bad connection): one
-- check-in for the day, with the later answers.
-- ---------------------------------------------------------------------------
select pg_temp.race('check-in', pg_temp.n(pg_temp.p('athlete1')),
  format('select public.save_check_in(%L, 3, 3, 3, 3, %L)::text', current_date, 'first'),
  pg_temp.n(pg_temp.p('athlete1')),
  format('select public.save_check_in(%L, 4, 4, 4, 4, %L)::text', current_date, 'second'));
select pg_temp.ok('a check-in sent twice: the second waits and goes through',
  (select b_waited and b_error is null from race_results where label = 'check-in'), true);
select pg_temp.ok('a check-in sent twice: one check-in for the day, with the later answers',
  (select count(*) = 1 and min(note) = 'second' from public.check_ins
   where athlete_id = pg_temp.p('athlete1') and day = current_date), true);

-- ---------------------------------------------------------------------------
-- Both guardians give consent at the same moment: one consent of each kind,
-- and neither parent sees an error.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', pg_temp.p('guardian1')::text, false);
select public.set_child_consent(pg_temp.p('child'), false, false);
select pg_temp.race('consent', pg_temp.n(pg_temp.p('guardian1')),
  format('select public.set_child_consent(%L, true, true)::text', pg_temp.p('child')),
  pg_temp.n(pg_temp.p('guardian2')),
  format('select public.set_child_consent(%L, true, true)::text', pg_temp.p('child')));
select pg_temp.ok('two guardians consenting at once: the second waits and sees no error',
  (select b_waited and b_error is null from race_results where label = 'consent'), true);
select pg_temp.ok('two guardians consenting at once: one consent of each kind',
  (select count(*) = 2 and count(distinct kind) = 2 from public.child_consents
   where athlete_id = pg_temp.p('child') and withdrawn_at is null), true);
select pg_temp.ok('two guardians consenting at once: given by the first to save',
  (select bool_and(given_by = pg_temp.p('guardian1')) from public.child_consents
   where athlete_id = pg_temp.p('child') and withdrawn_at is null), true);

-- ---------------------------------------------------------------------------
-- A survey answer sent twice: one answer counted, and the second is told
-- it's already answered.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', pg_temp.lc(3)::text, false);
insert into pick select 'survey', public.create_survey('Kit sizes', null, 'named', 'club', null, null, null,
  now() + interval '7 days', '[{"kind":"choice","prompt":"Dress size","options":["S","M","L"]}]');
insert into pick select 'question', id from public.survey_questions where survey_id = pg_temp.p('survey');
select pg_temp.race('survey', 98,
  format('select public.submit_survey_response(%L, %L, false)::text', pg_temp.p('survey'),
    jsonb_build_array(jsonb_build_object('question_id', pg_temp.p('question'), 'choices', '[1]'::jsonb))),
  98,
  format('select public.submit_survey_response(%L, %L, false)::text', pg_temp.p('survey'),
    jsonb_build_array(jsonb_build_object('question_id', pg_temp.p('question'), 'choices', '[2]'::jsonb))));
select pg_temp.ok('a survey answer sent twice: the second waits and is told it''s answered',
  (select b_waited and b_error = 'You''ve already answered this survey' from race_results where label = 'survey'), true);
select pg_temp.ok('a survey answer sent twice: one answer counted, the first',
  (select count(*) = 1 and min(a.choices::text) = '{1}' from public.survey_responses r
   join public.survey_answers a on a.response_id = r.id where r.survey_id = pg_temp.p('survey')), true);
