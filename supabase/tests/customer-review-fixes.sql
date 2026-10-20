-- Tests for 20261020100000_customer_review_fixes.sql: clearances nobody can
-- endorse (I4), injuries of athletes who left following the club's rules
-- (I5, I6), and the generic absence reason (I16). Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- How many clearances the signed-in admin is told nobody can endorse.
create or replace function pg_temp.unendorsable() returns bigint language sql as
$$ select count(*) from public.admin_unendorsable_clearances() $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
select set_config('request.jwt.claim.sub', '', false);

-- Who can call what.
select pg_temp.ok('members can call the admin list (admins only inside)', has_function_privilege('authenticated', 'public.admin_unendorsable_clearances()', 'execute'), true);
select pg_temp.ok('anon cannot call the admin list', has_function_privilege('anon', 'public.admin_unendorsable_clearances()', 'execute'), false);
select pg_temp.ok('members cannot ask who could endorse', has_function_privilege('authenticated', 'public.could_endorse_clearance(uuid, uuid)', 'execute'), false);
select pg_temp.ok('members cannot ask if an injury expired', has_function_privilege('authenticated', 'public.departed_injury_expired(public.injuries)', 'execute'), false);
select pg_temp.ok('members cannot list expired documents', has_function_privilege('authenticated', 'public.expired_injury_documents()', 'execute'), false);
select pg_temp.ok('members cannot run the injury purge', has_function_privilege('authenticated', 'public.purge_expired_injuries()', 'execute'), false);
select pg_temp.ok('the purge can list expired documents', has_function_privilege('service_role', 'public.expired_injury_documents()', 'execute'), true);
select pg_temp.ok('the purge can remove injuries', has_function_privilege('service_role', 'public.purge_expired_injuries()', 'execute'), true);

-- ---------------------------------------------------------------------------
-- 1. Clearances nobody can endorse (I4)
-- ---------------------------------------------------------------------------
-- Kai Senior (32) is an adult in the squad only, asking for clearance.
insert into public.injuries (id, athlete_id, reported_by, body_area, description, injured_on, status, athlete_name) values
  ('c1000000-0000-0000-0000-000000000001', pg_temp.id('32'), pg_temp.id('32'), 'Knee', 'Jarred knee', current_date - 20, 'clearance_requested', 'Kai Senior');

select pg_temp.as_member('01');
select pg_temp.ok('squad open: the squad coach can endorse, nothing listed', pg_temp.unendorsable() = 0, true);

-- Selections done: the squad's coaches stop looking after Kai.
update public.teams set selections_completed_at = now() where id = pg_temp.id('a1');
select pg_temp.ok('coach no longer could endorse Kai', public.could_endorse_clearance(pg_temp.id('11'), pg_temp.id('32')), false);
select pg_temp.ok('squad physio still could endorse Kai', public.could_endorse_clearance(pg_temp.id('14'), pg_temp.id('32')), true);
select pg_temp.ok('squad phase complete with a squad physio: nothing listed', pg_temp.unendorsable() = 0, true);

-- The physio leaves the squad, and the club has no Head Physio.
delete from public.team_members where team_id = pg_temp.id('a1') and profile_id = pg_temp.id('14');
select pg_temp.ok('no physio, no coach: Kai listed', (select count(*) = 1 from public.admin_unendorsable_clearances() where athlete_name = 'Kai Senior' and body_area = 'Knee'), true);
select pg_temp.as_member('02');
select pg_temp.ok('second admin sees it too', pg_temp.unendorsable() = 1, true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees no list', pg_temp.unendorsable() = 0, true);
select pg_temp.fails('and the coach really cannot endorse', $$select public.endorse_clearance('c1000000-0000-0000-0000-000000000001')$$);
select pg_temp.as_member('14');
select pg_temp.ok('physio sees no list', pg_temp.unendorsable() = 0, true);
select pg_temp.as_member('32');
select pg_temp.ok('athlete sees no list', pg_temp.unendorsable() = 0, true);
select pg_temp.as_member('23');
select pg_temp.ok('committee sees no list', pg_temp.unendorsable() = 0, true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in sees no list', pg_temp.unendorsable() = 0, true);

-- A Head Physio looks after everyone.
update public.profiles set head_physio = true where id = pg_temp.id('14');
select pg_temp.as_member('01');
select pg_temp.ok('with a Head Physio: nothing listed', pg_temp.unendorsable() = 0, true);
select pg_temp.as_member('14');
select pg_temp.works('and the Head Physio really can endorse', $$select public.endorse_clearance('c1000000-0000-0000-0000-000000000001')$$);
update public.injuries set status = 'clearance_requested', coach_endorsed_by = null, coach_endorsed_at = null
where id = 'c1000000-0000-0000-0000-000000000001';

-- A stood-down Head Physio can't.
update public.profiles set stood_down_at = now() where id = pg_temp.id('14');
select pg_temp.as_member('01');
select pg_temp.ok('Head Physio stood down: Kai listed again', pg_temp.unendorsable() = 1, true);
update public.profiles set stood_down_at = null where id = pg_temp.id('14');

-- A Head Physio whose check lapsed can't.
update public.profiles set wwcc_expires_on = current_date - 1 where id = pg_temp.id('14');
select pg_temp.ok('Head Physio check lapsed: Kai listed', pg_temp.unendorsable() = 1, true);
update public.profiles set wwcc_expires_on = current_date + 400 where id = pg_temp.id('14');

-- Head Physio without the physio role doesn't count.
update public.profiles set role = 'coach' where id = pg_temp.id('14');
select pg_temp.ok('Head Physio flag without the physio role: Kai listed', pg_temp.unendorsable() = 1, true);
update public.profiles set role = 'physio', head_physio = false where id = pg_temp.id('14');

-- A coach of a team Kai is in, whose phase is open, can.
insert into public.team_members (team_id, profile_id, team_role, coach_title) values (pg_temp.id('a2'), pg_temp.id('32'), 'athlete', null);
select pg_temp.ok('Kai picked for the team: its coach can endorse, nothing listed', pg_temp.unendorsable() = 0, true);
-- ...unless that coach's check lapsed: Drew Lapsed (12) alone wouldn't count.
select pg_temp.ok('a coach with a lapsed check could not endorse', public.could_endorse_clearance(pg_temp.id('12'), pg_temp.id('32')), false);
delete from public.team_members where team_id = pg_temp.id('a2') and profile_id = pg_temp.id('32');

-- A parent who coaches doesn't count for their own child, and nobody for themselves.
-- (They are already in the child's team as a guardian; make them its coach.)
insert into public.team_members (team_id, profile_id, team_role, coach_title) values (pg_temp.id('a2'), pg_temp.id('42'), 'coach', 'assistant_coach')
on conflict (team_id, profile_id) do update set team_role = 'coach', coach_title = 'assistant_coach';
select pg_temp.ok('coach-parent could not endorse their own child', public.could_endorse_clearance(pg_temp.id('42'), pg_temp.id('31')), false);
select pg_temp.ok('the other team coach could endorse that child', public.could_endorse_clearance(pg_temp.id('11'), pg_temp.id('31')), true);
select pg_temp.ok('nobody could endorse their own clearance', public.could_endorse_clearance(pg_temp.id('32'), pg_temp.id('32')), false);

-- Only requests waiting for a coach or physio, and only current athletes.
update public.injuries set status = 'injured' where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.ok('an injury not asking for clearance is not listed', pg_temp.unendorsable() = 0, true);
update public.injuries set status = 'clearance_requested', athlete_left_at = now() where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.ok('an athlete who left is not listed', pg_temp.unendorsable() = 0, true);
update public.injuries set athlete_left_at = null where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.ok('back to waiting: listed', pg_temp.unendorsable() = 1, true);

-- Nobody's access changed: Kai's injury is still hidden from the squad coach.
select pg_temp.as_member('11');
select pg_temp.ok('squad coach still cannot see Kai''s injuries', public.can_view_athlete_injuries(pg_temp.id('32')), false);
select set_config('request.jwt.claim.sub', '', false);
delete from public.injuries where id = 'c1000000-0000-0000-0000-000000000001';
update public.teams set selections_completed_at = null where id = pg_temp.id('a1');

-- ---------------------------------------------------------------------------
-- 2. Injuries of athletes who left (I5, I6)
-- ---------------------------------------------------------------------------
-- All for athletes who have left (athlete_left_at set):
--   d1 left 13 months ago, cleared 14 months ago (the old rule removed it)
--   d2 left 8 years ago, cleared 9 years ago
--   d3 left 8 years ago, never cleared
--   d4 cleared 8 years ago, left a year ago (counted from leaving)
--   d5 left 8 years ago, cleared 9 years ago, a file still in storage
--   d6 left 4 years ago, cleared 4 years ago
-- And c1 belongs to a current athlete, never cleared, from 9 years ago.
insert into public.injuries (id, athlete_id, body_area, description, injured_on, status, cleared_at, athlete_name, athlete_left_at) values
  ('d1000000-0000-0000-0000-000000000001', pg_temp.id('32'), 'Ankle', 'Rolled', current_date - 500, 'cleared', now() - interval '14 months', 'Kai Senior', now() - interval '13 months'),
  ('d1000000-0000-0000-0000-000000000002', pg_temp.id('32'), 'Knee', 'Sore', current_date - 3400, 'cleared', now() - interval '9 years', 'Kai Senior', now() - interval '8 years'),
  ('d1000000-0000-0000-0000-000000000003', pg_temp.id('32'), 'Back', 'Tight', current_date - 3400, 'injured', null, 'Kai Senior', now() - interval '8 years'),
  ('d1000000-0000-0000-0000-000000000004', pg_temp.id('32'), 'Wrist', 'Sprain', current_date - 3400, 'cleared', now() - interval '8 years', 'Kai Senior', now() - interval '1 year'),
  ('d1000000-0000-0000-0000-000000000005', pg_temp.id('32'), 'Hip', 'Strain', current_date - 3400, 'cleared', now() - interval '9 years', 'Kai Senior', now() - interval '8 years'),
  ('d1000000-0000-0000-0000-000000000006', pg_temp.id('32'), 'Calf', 'Strain', current_date - 1500, 'cleared', now() - interval '4 years', 'Kai Senior', now() - interval '4 years'),
  ('c2000000-0000-0000-0000-000000000001', pg_temp.id('31'), 'Shoulder', 'Sore', current_date - 3400, 'injured', null, 'Jordan Junior', null);
insert into storage.objects (bucket_id, name) values
  ('injury-documents', pg_temp.id('32') || '/d1000000-0000-0000-0000-000000000005/letter.pdf'),
  ('injury-documents', pg_temp.id('32') || '/d1000000-0000-0000-0000-000000000003/scan.pdf');

-- Remove old records is off: nothing goes, however old.
update public.club_settings set retention_enabled = false where id;
select pg_temp.ok('switch off: no documents listed', (select count(*) = 0 from public.expired_injury_documents()), true);
select pg_temp.ok('switch off: purge removes nothing', public.purge_expired_injuries() = 0, true);
select pg_temp.ok('switch off: every injury kept', (select count(*) = 7 from public.injuries where id::text like 'd1%' or id::text like 'c2%'), true);
select pg_temp.ok('switch off: the 13-month injury the old rule removed is kept', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000001'), true);

-- On, with the default 7 years.
update public.club_settings set retention_enabled = true where id;
select pg_temp.ok('default period is 7 years', (select retention_injuries_months = 84 from public.club_settings where id), true);
select pg_temp.ok('documents listed: only the old injuries'' files', (select array_agg(n order by n) = array[
    pg_temp.id('32') || '/d1000000-0000-0000-0000-000000000003/scan.pdf',
    pg_temp.id('32') || '/d1000000-0000-0000-0000-000000000005/letter.pdf']
  from public.expired_injury_documents() n), true);
select pg_temp.ok('purge removes the one old injury with no file left', public.purge_expired_injuries() = 1, true);
select pg_temp.ok('left 8 years ago, cleared: removed', (select count(*) = 0 from public.injuries where id = 'd1000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('left 8 years ago, never cleared, file left: kept until the file goes', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000003'), true);
select pg_temp.ok('left 13 months ago: kept', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('cleared 8 years ago but left a year ago: kept', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000004'), true);
select pg_temp.ok('file still in storage: kept', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000005'), true);
select pg_temp.ok('left 4 years ago: kept under 7 years', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000006'), true);
select pg_temp.ok('current athlete''s old uncleared injury: untouched', (select count(*) = 1 from public.injuries where id = 'c2000000-0000-0000-0000-000000000001'), true);

-- The function removes the files, then the next step finishes the job.
delete from storage.objects where bucket_id = 'injury-documents' and name like pg_temp.id('32') || '/%';
select pg_temp.ok('files gone: both old injuries removed', public.purge_expired_injuries() = 2, true);
select pg_temp.ok('never-cleared injury removed 7 years after leaving', (select count(*) = 0 from public.injuries where id in ('d1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000005')), true);
select pg_temp.ok('a second run removes nothing more', public.purge_expired_injuries() = 0, true);

-- A club that keeps cleared injuries 3 years.
update public.club_settings set retention_injuries_months = 36 where id;
select pg_temp.ok('3 years: the 4-year-old one goes', public.purge_expired_injuries() = 1, true);
select pg_temp.ok('3 years: left 4 years ago removed', (select count(*) = 0 from public.injuries where id = 'd1000000-0000-0000-0000-000000000006'), true);
select pg_temp.ok('3 years: left 13 months ago still kept', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('3 years: left a year ago still kept', (select count(*) = 1 from public.injuries where id = 'd1000000-0000-0000-0000-000000000004'), true);

-- The nightly records purge still leaves departed athletes' injuries alone.
select pg_temp.ok('purge_expired_records leaves departed injuries', (select (r->>'cleared_injuries')::int = 0 from public.purge_expired_records() r), true);
select pg_temp.ok('departed injuries still there after it', (select count(*) = 2 from public.injuries where athlete_left_at is not null), true);

-- ---------------------------------------------------------------------------
-- 3. The generic absence reason (I16)
-- ---------------------------------------------------------------------------
select pg_temp.ok('Representative or elite program added once', (select count(*) = 1 and bool_and(active) from public.absence_categories where name = 'Representative or elite program'), true);
select pg_temp.ok('West Coast Fever left as it was', (select count(*) = 1 and bool_and(active) from public.absence_categories where name = 'West Coast Fever'), true);
select pg_temp.as_member('32');
select pg_temp.ok('members see the new reason', (select count(*) = 1 from public.absence_categories where name = 'Representative or elite program'), true);
select set_config('request.jwt.claim.sub', '', false);

-- An admin who switched it off keeps it off when the migration runs again,
-- and running it again adds nothing.
update public.absence_categories set active = false where name = 'Representative or elite program';
\ir ../migrations/20261020100000_customer_review_fixes.sql
select pg_temp.ok('re-run: still one, still off', (select count(*) = 1 and not bool_or(active) from public.absence_categories where name = 'Representative or elite program'), true);
select pg_temp.ok('re-run: reasons not duplicated', (select count(*) = count(distinct lower(trim(name))) from public.absence_categories), true);
