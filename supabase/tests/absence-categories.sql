-- Tests for 20261015220000_absence_categories.sql. Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
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
create or replace function pg_temp.cat(n text) returns uuid language sql as
$$ select id from public.absence_categories where name = n $$;

-- Ten from the starting list, then Representative or elite program, added for
-- every club by 20261020100000 and shown after West Coast Fever.
select pg_temp.ok('starting list has 11 reasons in order',
  (select array_agg(name order by sort_order, created_at) = array['Planned holidays','Personal illness','Caring duties','Planned event','National team','Volunteering','West Coast Fever','Representative or elite program','School or uni exam','Work commitment','Other'] from public.absence_categories), true);

-- Members read the list; only admins change it, through the API role.
set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees the reasons', (select count(*) = 11 from public.absence_categories), true);
select pg_temp.fails('athlete cannot add a reason', $s$insert into public.absence_categories (name) values ('Beach day')$s$);
update public.absence_categories set active = false where name = 'Other';
select pg_temp.ok('athlete cannot turn a reason off',
  (select active from public.absence_categories where name = 'Other'), true);
select pg_temp.fails('athlete cannot write absences directly',
  $s$insert into public.attendance_absences (athlete_id, from_day, to_day, reported_as) values ('00000000-0000-0000-0000-000000000031', current_date, current_date, 'athlete')$s$);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot add a reason', $s$insert into public.absence_categories (name) values ('Beach day')$s$);
select pg_temp.as_member('01');
select pg_temp.works('admin adds a club reason', $s$insert into public.absence_categories (name, sort_order) values ('State League final', 11)$s$);
select pg_temp.fails('admin cannot add the same name twice', $s$insert into public.absence_categories (name) values ('state league final ')$s$);
update public.absence_categories set active = false where name = 'Volunteering';
select pg_temp.ok('admin turns Volunteering off',
  (select not active from public.absence_categories where name = 'Volunteering'), true);
select pg_temp.fails('admin cannot delete a reason', $s$delete from public.absence_categories where name = 'Other'$s$);
reset role;

-- Reporting
select pg_temp.as_member('31');
select pg_temp.works('athlete reports planned holidays with details',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 3, current_date + 9, %L, 'Bali')$s$, pg_temp.cat('Planned holidays')));
select pg_temp.works('athlete reports a club reason, no details',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 20, current_date + 20, %L, null)$s$, pg_temp.cat('State League final')));
select pg_temp.fails('a reason is required',
  $s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 1, current_date + 1, null::uuid, 'x')$s$);
select pg_temp.fails('a turned-off reason is refused',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 1, current_date + 1, %L, null)$s$, pg_temp.cat('Volunteering')));
select pg_temp.fails('an unknown reason is refused',
  $s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 1, current_date + 1, gen_random_uuid(), null)$s$);
select pg_temp.fails('cannot report for someone else',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000032', current_date + 1, current_date + 1, %L, null)$s$, pg_temp.cat('Other')));
select pg_temp.as_member('32');
select pg_temp.works('old app version still reports (no reason)',
  $s$select public.report_absence('00000000-0000-0000-0000-000000000032', current_date + 1, current_date + 1, 'Dentist')$s$);
select pg_temp.works('athlete reports personal illness',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000032', current_date, current_date + 2, %L, null)$s$, pg_temp.cat('Personal illness')));

-- Reading
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees own reasons by name',
  (select array_agg(category order by from_day) = array['Planned holidays', 'State League final'] from public.my_absences('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.ok('athlete does not see another athlete''s',
  (select count(*) = 0 from public.my_absences('00000000-0000-0000-0000-000000000032')), true);
select pg_temp.ok('athlete cannot run the admin report',
  (select count(*) = 0 from public.absence_report(current_date - 30, current_date + 30)), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees the reason on upcoming absences',
  (select bool_and(category is not null) and count(*) >= 2 from public.upcoming_absences() where reason is distinct from 'Dentist'), true);
select pg_temp.ok('coach sees old absence with no reason',
  (select category is null from public.upcoming_absences() where reason = 'Dentist'), true);
select pg_temp.ok('coach cannot run the admin report',
  (select count(*) = 0 from public.absence_report(current_date - 30, current_date + 30)), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio still sees no absences',
  (select count(*) = 0 from public.upcoming_absences()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin report lists all four',
  (select count(*) = 4 from public.absence_report(current_date - 30, current_date + 30)), true);
select pg_temp.ok('admin report keeps to the period',
  (select count(*) = 2 from public.absence_report(current_date, current_date + 2)), true);
select pg_temp.ok('admin report has no free-text details column',
  (select not exists (select 1 from information_schema.routines r join information_schema.parameters p using (specific_schema, specific_name)
     where r.routine_name = 'absence_report' and p.parameter_name = 'reason')), true);
-- Turning a reason off keeps it on absences that used it.
update public.absence_categories set active = false where name = 'Planned holidays';
select pg_temp.as_member('31');
select pg_temp.ok('turned-off reason still shows on past absences',
  (select bool_or(category = 'Planned holidays') from public.my_absences('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.works('withdraw still works',
  $s$select public.withdraw_absence((select id from public.my_absences('00000000-0000-0000-0000-000000000031') where category = 'State League final'))$s$);
select pg_temp.as_member('01');
select pg_temp.ok('admin report leaves out withdrawn absences',
  (select count(*) = 3 from public.absence_report(current_date - 30, current_date + 30)), true);
select pg_temp.as_member('41');
select pg_temp.works('guardian reports caring duties for their child',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 30, current_date + 31, %L, null)$s$, pg_temp.cat('Caring duties')));
select pg_temp.ok('guardian sees the reason',
  (select bool_or(category = 'Caring duties') from public.my_absences('00000000-0000-0000-0000-000000000031')), true);
-- With every reason off, a reason isn't needed.
update public.absence_categories set active = false;
select pg_temp.works('no reason needed when the club has none switched on',
  $s$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 40, current_date + 40, null::uuid, 'Away')$s$);

-- Injured athletes on the register (Matt: everyone taking attendance sees it).
-- Jordan (31, under 18, no consent) injured 3 days ago, back in 10; Kai (32)
-- injured and cleared 2 days ago.
insert into public.injuries (athlete_id, body_area, description, injured_on, expected_return, status) values
  ('00000000-0000-0000-0000-000000000031', 'Left ankle', 'Rolled it', current_date - 3, current_date + 10, 'injured');
insert into public.injuries (athlete_id, body_area, description, injured_on, expected_return, status, cleared_at) values
  ('00000000-0000-0000-0000-000000000032', 'Wrist', 'Jarred it', current_date - 20, current_date - 5, 'cleared', now() - interval '2 days');
select pg_temp.as_member('13');
select pg_temp.ok('manager sees Jordan injured today with return date',
  (select expected_return = current_date + 10 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date) where profile_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('cleared injury not shown today',
  (select count(*) = 0 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date) where profile_id = '00000000-0000-0000-0000-000000000032'), true);
select pg_temp.ok('cleared injury shown for a session before clearance',
  (select count(*) = 1 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date - 5) where profile_id = '00000000-0000-0000-0000-000000000032'), true);
select pg_temp.ok('injury not shown before it happened',
  (select count(*) = 0 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date - 4) where profile_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('manager still cannot see the injury itself',
  (select count(*) = 0 from public.visible_injuries()), true);
select pg_temp.ok('injured_on has no details columns',
  (select not exists (select 1 from information_schema.routines r join information_schema.parameters p using (specific_schema, specific_name)
     where r.routine_name = 'injured_on' and p.parameter_name in ('body_area', 'description', 'restrictions'))), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete cannot use the register list',
  (select count(*) = 0 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date)), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio (not an attendance taker) gets nothing',
  (select count(*) = 0 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date)), true);
