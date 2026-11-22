-- Tests for 20261015235000_absence_reviews.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
-- Squad a1: coaches 11 (current), 12 (expired check), 42; manager 13; physio 14;
-- athletes 31 (under 18, guardians 41 and 42) and 32.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.cat(n text) returns uuid language sql as
$$ select id from public.absence_categories where name = n $$;

-- An old absence (reported 10 days ago) is before the 7-day start.
insert into public.attendance_absences (athlete_id, from_day, to_day, reported_by, reported_by_name, reported_as, created_at)
values ('00000000-0000-0000-0000-000000000032', public.club_today() + 5, public.club_today() + 5, '00000000-0000-0000-0000-000000000032', 'Kai', 'athlete', now() - interval '10 days');

select pg_temp.as_member('11');
select pg_temp.ok('coach starts with nothing to review', (select count(*) = 0 from public.absences_to_review()), true);

select pg_temp.as_member('31');
select pg_temp.works('athlete reports an absence',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 3, public.club_today() + 4, %L, 'Bali')$s$, pg_temp.cat('Planned holidays')));

select pg_temp.as_member('11');
select pg_temp.ok('coach sees the new absence with its reason',
  (select category = 'Planned holidays' and not withdrawn from public.absences_to_review()), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager sees it too', (select count(*) = 1 from public.absences_to_review()), true);
select pg_temp.as_member('12');
select pg_temp.ok('coach with an expired check does not', (select count(*) = 0 from public.absences_to_review()), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio does not', (select count(*) = 0 from public.absences_to_review()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin who does not coach the squad does not', (select count(*) = 0 from public.absences_to_review()), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete does not', (select count(*) = 0 from public.absences_to_review()), true);
select pg_temp.as_member('42');
select pg_temp.ok('coach who is the athlete''s guardian sees it (reported by the athlete)', (select count(*) = 1 from public.absences_to_review()), true);

-- Reviewing clears it; withdrawing brings it back as changed.
select pg_temp.as_member('11');
select pg_temp.works('coach marks reviewed', 'select public.mark_absences_reviewed()');
select pg_temp.ok('nothing left for that coach', (select count(*) = 0 from public.absences_to_review()), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager still has it', (select count(*) = 1 from public.absences_to_review()), true);
select pg_temp.as_member('41');
select pg_temp.works('guardian withdraws it',
  $s$select public.withdraw_absence((select id from public.my_absences('00000000-0000-0000-0000-000000000031') where withdrawn_at is null limit 1))$s$);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees it again as withdrawn', (select bool_and(withdrawn) and count(*) = 1 from public.absences_to_review()), true);

-- A coach who reports for their own child isn't asked to review it.
select pg_temp.as_member('42');
select pg_temp.works('coach-guardian marks reviewed', 'select public.mark_absences_reviewed()');
select pg_temp.works('coach-guardian reports for their child',
  format($s$select public.report_absence('00000000-0000-0000-0000-000000000031', public.club_today() + 8, public.club_today() + 8, %L, null)$s$, pg_temp.cat('Personal illness')));
select pg_temp.ok('their own report is not on their list', (select count(*) = 0 from public.absences_to_review()), true);
select pg_temp.as_member('11');
select pg_temp.ok('the other coach sees it', (select count(*) = 2 from public.absences_to_review()), true);
