-- Tests for 20261013120000_family_attendance.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

-- Two sessions for the squad: Jordan (31) present at one, absent at the other;
-- Kai (32) present at both.
insert into public.attendance_sessions (id, team_id, team_name, name, held_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Tuesday training', now() - interval '7 days'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Thursday training', now() - interval '5 days');
insert into public.attendance_marks (session_id, profile_id, present) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000031', true),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000031', false),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000032', true),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000032', true);

-- Seeing attendance
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees own 2 sessions',
  (select count(*) = 2 from public.athlete_attendance('00000000-0000-0000-0000-000000000031', public.club_today() - 30)), true);
select pg_temp.ok('athlete sees own absence',
  (select bool_or(not present) from public.athlete_attendance('00000000-0000-0000-0000-000000000031', public.club_today() - 30)), true);
select pg_temp.ok('athlete does not see another athlete',
  (select count(*) = 0 from public.athlete_attendance('00000000-0000-0000-0000-000000000032', public.club_today() - 30)), true);
select pg_temp.ok('athlete still cannot see the register',
  (select count(*) = 0 from public.attendance_register('00000000-0000-0000-0000-0000000000d1')), true);
select pg_temp.ok('athlete still cannot list sessions',
  (select count(*) = 0 from public.attendance_sessions_list()), true);

select pg_temp.as_member('41');
select pg_temp.ok('guardian sees child sessions',
  (select count(*) = 2 from public.athlete_attendance('00000000-0000-0000-0000-000000000031', public.club_today() - 30)), true);
select pg_temp.ok('guardian does not see unrelated adult',
  (select count(*) = 0 from public.athlete_attendance('00000000-0000-0000-0000-000000000032', public.club_today() - 30)), true);
select pg_temp.ok('guardian cannot see the register',
  (select count(*) = 0 from public.attendance_register('00000000-0000-0000-0000-0000000000d2')), true);

select pg_temp.as_member('14');
select pg_temp.ok('physio does not see attendance',
  (select count(*) = 0 from public.athlete_attendance('00000000-0000-0000-0000-000000000031', public.club_today() - 30)), true);

select pg_temp.as_member('11');
select pg_temp.ok('coach still sees attendance',
  (select count(*) = 2 from public.athlete_attendance('00000000-0000-0000-0000-000000000031', public.club_today() - 30)), true);

-- Guardian rights end at 18
update public.profiles set date_of_birth = public.club_today() - interval '19 years', under_17 = false
  where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('41');
select pg_temp.ok('guardian of an adult sees nothing',
  (select count(*) = 0 from public.athlete_attendance('00000000-0000-0000-0000-000000000031', public.club_today() - 30)), true);
select pg_temp.fails('guardian of an adult cannot report an absence',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 1, public.club_today() + 1)$$);
update public.profiles set date_of_birth = public.club_today() - interval '14 years', under_17 = true
  where id = '00000000-0000-0000-0000-000000000031';

-- Reporting absences
select pg_temp.as_member('41');
select pg_temp.works('guardian reports an absence',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 2, public.club_today() + 4, 'School camp')$$);
select pg_temp.ok('reported as guardian with their name',
  (select reported_as = 'guardian' and reported_by_name = 'Logan Parent' from public.attendance_absences where reason = 'School camp'), true);
select pg_temp.fails('guardian cannot report for another athlete',
  $$select public.report_absence('00000000-0000-0000-0000-000000000032', public.club_today() + 1, public.club_today() + 1)$$);
select pg_temp.fails('last day before first day refused',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 4, public.club_today() + 2)$$);
select pg_temp.fails('more than 14 days back refused',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() - 15, public.club_today() - 15)$$);
select pg_temp.works('up to 14 days back allowed',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() - 5, public.club_today() - 5, 'Was sick')$$);
select pg_temp.fails('more than 12 months ahead refused',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 360, public.club_today() + 370)$$);
select pg_temp.fails('longer than 3 months refused',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today(), public.club_today() + 100)$$);
select pg_temp.fails('reason over 200 characters refused',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 1, public.club_today() + 1, repeat('x', 201))$$);
set role authenticated;
select pg_temp.fails('no direct insert',
  $$insert into public.attendance_absences (athlete_id, from_day, to_day, reported_as) values ('00000000-0000-0000-0000-000000000031', public.club_today(), public.club_today(), 'guardian')$$);
reset role;

select pg_temp.as_member('32');
select pg_temp.works('adult athlete reports own absence',
  $$select public.report_absence('00000000-0000-0000-0000-000000000032', public.club_today() + 3, public.club_today() + 3, 'Work')$$);
select pg_temp.ok('reported as athlete',
  (select reported_as = 'athlete' from public.attendance_absences where reason = 'Work'), true);
select pg_temp.ok('adult athlete does not see Jordan absences',
  (select count(*) = 0 from public.my_absences('00000000-0000-0000-0000-000000000031')), true);

select pg_temp.as_member('11');
select pg_temp.fails('coach cannot report for an athlete',
  $$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 1, public.club_today() + 1)$$);
select pg_temp.fails('guardian-only role required, not a coach',
  $$select public.report_absence('00000000-0000-0000-0000-000000000011', public.club_today() + 1, public.club_today() + 1)$$);

-- The family sees each other's reports
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees guardian-reported absences',
  (select count(*) = 2 from public.my_absences('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('42');
select pg_temp.ok('second guardian sees them too',
  (select count(*) = 2 from public.my_absences('00000000-0000-0000-0000-000000000031')), true);

-- Coaches see absences on the register and the upcoming list
select pg_temp.as_member('11');
select pg_temp.ok('coach sees absence on the register day',
  (select reason = 'School camp' from public.absences_on('00000000-0000-0000-0000-0000000000a1', public.club_today() + 3)
   where profile_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('two athletes away on day 3',
  (select count(*) = 2 from public.absences_on('00000000-0000-0000-0000-0000000000a1', public.club_today() + 3)), true);
select pg_temp.ok('team register shows only team athletes',
  (select count(*) = 1 from public.absences_on('00000000-0000-0000-0000-0000000000a2', public.club_today() + 3)), true);
select pg_temp.ok('nobody away on another day',
  (select count(*) = 0 from public.absences_on('00000000-0000-0000-0000-0000000000a1', public.club_today() + 10)), true);
select pg_temp.ok('coach upcoming list has 2',
  (select count(*) = 2 from public.upcoming_absences()), true);
select pg_temp.ok('past absence not in upcoming list',
  (select count(*) = 0 from public.upcoming_absences() where reason = 'Was sick'), true);

select pg_temp.as_member('13');
select pg_temp.ok('manager sees upcoming absences',
  (select count(*) = 2 from public.upcoming_absences()), true);
select pg_temp.as_member('12');
select pg_temp.ok('coach with expired check sees none',
  (select count(*) = 0 from public.upcoming_absences()), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio sees none',
  (select count(*) = 0 from public.upcoming_absences()), true);
select pg_temp.ok('physio sees none on the register',
  (select count(*) = 0 from public.absences_on('00000000-0000-0000-0000-0000000000a1', public.club_today() + 3)), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian does not get the coaches list',
  (select count(*) = 0 from public.upcoming_absences()), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee sees upcoming absences',
  (select count(*) = 2 from public.upcoming_absences()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees club event absences',
  (select count(*) = 2 from public.absences_on(null, public.club_today() + 3)), true);

-- Withdrawing
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot withdraw',
  $$select public.withdraw_absence((select id from public.attendance_absences where reason = 'School camp'))$$);
select pg_temp.as_member('31');
select pg_temp.works('athlete withdraws guardian report',
  $$select public.withdraw_absence((select id from public.attendance_absences where reason = 'School camp'))$$);
select pg_temp.ok('withdrawn absence kept and marked',
  (select withdrawn_at is not null from public.my_absences('00000000-0000-0000-0000-000000000031') where reason = 'School camp'), true);
select pg_temp.fails('cannot withdraw twice',
  $$select public.withdraw_absence((select id from public.attendance_absences where reason = 'School camp'))$$);
select pg_temp.as_member('11');
select pg_temp.ok('withdrawn absence gone from register',
  (select count(*) = 1 from public.absences_on('00000000-0000-0000-0000-0000000000a1', public.club_today() + 3)), true);

-- Retention: absences go with attendance, only while switched on
insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.attendance_absences (athlete_id, from_day, to_day, reported_as) values
  ('00000000-0000-0000-0000-000000000032', public.club_today() - interval '86 months', public.club_today() - interval '85 months', 'athlete');
select pg_temp.ok('switch off keeps old absence',
  (select (public.purge_expired_records() ->> 'enabled')::boolean = false
     and (select count(*) = 4 from public.attendance_absences)), true);
update public.club_settings set retention_enabled = true where id;
select pg_temp.ok('switch on removes one old absence',
  (select (public.purge_expired_records() ->> 'absences')::int = 1), true);
select pg_temp.ok('recent absences kept',
  (select count(*) = 3 from public.attendance_absences), true);
