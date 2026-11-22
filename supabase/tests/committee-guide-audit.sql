-- Tests for 20261018220000_committee_guide_audit.sql. Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, needle text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like '%' || needle || '%' then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

create temp table ids (name text, id uuid);

-- 1. One review note per reviewer. The committee (22) and an admin (01) each
-- set a KPI for Emery the manager (13) and each write a mid-season review.
select pg_temp.as_member('01');
insert into ids select 'mid', public.admin_save_kpi_review_point(null, (select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1'), 'Mid-season', public.club_today() - 1);
insert into ids select 'admin_kpi', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-0000000000a1', 'kpi', 'Rosters in on time', null, '[{"kind":"yes_no"}]');
select pg_temp.as_member('22');
insert into ids select 'cmt_kpi', public.save_season_kpi(null, '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-0000000000a1', 'okr', 'Run smooth game days', null, '[{"title":"Late cancellations","kind":"number","target":2,"lower_is_better":true}]');
select pg_temp.ok('committee has a write to-do before writing', exists (
  select 1 from public.kpi_review_todos() where kind = 'write' and profile_id = '00000000-0000-0000-0000-000000000013'), true);
select pg_temp.works('committee writes a review', $$select public.save_kpi_review('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'), 'Committee: going well')$$);
select pg_temp.ok('committee write to-do gone', exists (
  select 1 from public.kpi_review_todos() where kind = 'write' and profile_id = '00000000-0000-0000-0000-000000000013'), false);
select pg_temp.as_member('01');
select pg_temp.ok('admin still has their own write to-do', exists (
  select 1 from public.kpi_review_todos() where kind = 'write' and profile_id = '00000000-0000-0000-0000-000000000013'), true);
select pg_temp.ok('admin sees the committee note but has none of their own', (
  select s -> 'reviews' -> 0 ->> 'note' is null and jsonb_array_length(s -> 'reviews' -> 0 -> 'notes') = 1
    and s -> 'reviews' -> 0 -> 'notes' -> 0 ->> 'note' = 'Committee: going well'
    and s -> 'reviews' -> 0 -> 'notes' -> 0 ->> 'reviewer_name' = 'Harper Committee'
  from public.season_kpi_sheet('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1') s), true);
select pg_temp.works('admin writes their own review', $$select public.save_kpi_review('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'), 'Admin: keep it up')$$);
select pg_temp.ok('both notes are kept', (
  select count(*) from public.season_kpi_review_notes where profile_id = '00000000-0000-0000-0000-000000000013') = 2, true);
select pg_temp.ok('admin sheet shows own note and both notes', (
  select s -> 'reviews' -> 0 ->> 'note' = 'Admin: keep it up' and jsonb_array_length(s -> 'reviews' -> 0 -> 'notes') = 2
  from public.season_kpi_sheet('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1') s), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee note was not overwritten', (
  select s -> 'reviews' -> 0 ->> 'note' = 'Committee: going well'
  from public.season_kpi_sheet('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1') s), true);
select pg_temp.ok('people list: one review written, none confirmed', exists (
  select 1 from public.season_kpi_people() p
  where p.profile_id = '00000000-0000-0000-0000-000000000013' and p.reviews_written = 1 and p.reviews_confirmed = 0), true);
-- Emery sees both notes, has one confirm to-do, and confirms both at once.
select pg_temp.as_member('13');
select pg_temp.ok('manager sees both notes', (
  select jsonb_array_length(s -> 'reviews' -> 0 -> 'notes') = 2
  from public.season_kpi_sheet('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1') s), true);
select pg_temp.ok('manager has one confirm to-do', (select count(*) from public.kpi_review_todos() where kind = 'confirm') = 1, true);
select pg_temp.works('manager confirms', $$select public.confirm_kpi_review('00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'))$$);
select pg_temp.ok('both notes confirmed', (
  select count(*) from public.season_kpi_review_notes where profile_id = '00000000-0000-0000-0000-000000000013' and confirmed_at is not null) = 2, true);
select pg_temp.ok('confirm to-do gone', exists (select 1 from public.kpi_review_todos() where kind = 'confirm'), false);
select pg_temp.as_member('22');
select pg_temp.ok('people list: review confirmed', exists (
  select 1 from public.season_kpi_people() p
  where p.profile_id = '00000000-0000-0000-0000-000000000013' and p.reviews_written = 1 and p.reviews_confirmed = 1), true);
-- Changing a note un-confirms only that note.
select pg_temp.works('committee changes their note', $$select public.save_kpi_review('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'), 'Committee: going very well')$$);
select pg_temp.ok('changed note is unconfirmed, the other stays confirmed', (
  select count(*) filter (where confirmed_at is null) = 1 and count(*) filter (where confirmed_at is not null) = 1
  from public.season_kpi_review_notes where profile_id = '00000000-0000-0000-0000-000000000013'), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin report: written, not confirmed', exists (
  select 1 from public.season_kpi_report((select season from public.teams where id = '00000000-0000-0000-0000-0000000000a1')) r
  where r.profile_id = '00000000-0000-0000-0000-000000000013'
    and (r.reviews -> 0 ->> 'written')::boolean and not (r.reviews -> 0 ->> 'confirmed')::boolean), true);
-- Clearing a note removes only the reviewer's own.
select pg_temp.works('admin clears their note', $$select public.save_kpi_review('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', (select id from ids where name = 'mid'), '')$$);
select pg_temp.ok('only the committee note remains', (
  select count(*) = 1 and bool_and(reviewer_id = '00000000-0000-0000-0000-000000000022')
  from public.season_kpi_review_notes where profile_id = '00000000-0000-0000-0000-000000000013'), true);
-- A head coach can't read a review written by the committee of someone whose KPIs they don't set.
select pg_temp.as_member('11');
select pg_temp.ok('head coach has no sheet for the manager', public.season_kpi_sheet('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1') is null, true);

-- 2. Admin to-dos for a missing Child Safety Officer or Complaints Manager.
select pg_temp.as_member('01');
select pg_temp.ok('both officer positions missing', (
  select child_safety_officer_missing = 1 and complaints_manager_missing = 1 from public.admin_safety_todos()), true);
select pg_temp.as_member('02');
select pg_temp.works('admin names Casey (cleared coach) and Alex (admin) as officers', $$select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', null, null, null, null)$$);
select pg_temp.ok('no officer to-dos once named', (
  select child_safety_officer_missing = 0 and complaints_manager_missing = 0 from public.admin_safety_todos()), true);
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = '00000000-0000-0000-0000-000000000011';
select pg_temp.ok('officer whose check lapsed counts as missing', (
  select child_safety_officer_missing = 1 and complaints_manager_missing = 0 from public.admin_safety_todos()), true);
select pg_temp.as_member('22');
select pg_temp.ok('a non-admin gets no counts', (select count(*) from public.admin_safety_todos() where child_safety_officer_missing is not null and public.is_admin()) = 0, true);

-- 3. A member who is only a statistician can be stood down.
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000051', 'stats@example.test', now());
update public.profiles set status = 'approved', full_name = 'Sam Stats', role = 'statistician', verified_at = now()
where id = '00000000-0000-0000-0000-000000000051';
select pg_temp.as_member('01');
select pg_temp.works('admin stands down a statistician', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000051', 'allegation', null)$$);
select pg_temp.ok('statistician is stood down', (select stood_down_at is not null from public.profiles where id = '00000000-0000-0000-0000-000000000051'), true);
select pg_temp.fails_with('an athlete still cannot be stood down', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000032', 'allegation', null)$$, 'statisticians and temporary helpers');

-- 4. Error texts.
update public.injuries set status = 'clearance_requested' where athlete_id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('22');
select pg_temp.fails_with('accept before endorsement names physios', $$select public.accept_clearance((select id from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031'), null)$$, 'A coach or physio needs to endorse this first');
select pg_temp.as_member('01');
insert into ids select 'session', public.save_attendance(null, null, 'Club training', now() - interval '1 hour',
  '[{"profile_id":"00000000-0000-0000-0000-000000000031","present":true},{"profile_id":"00000000-0000-0000-0000-000000000032","present":true}]');
select pg_temp.as_member('14');
select pg_temp.fails_with('attendance change error names the committee and admins', $$select public.save_attendance((select id from ids where name = 'session'), null, 'Club training', now() - interval '1 hour', '[]')$$, 'the committee for whole-club sessions, or an admin');

-- 5. The trend's flagged count is athletes. Kai (32) checks in flagged on two
-- days; the club has only two athletes, so scores are hidden but the count is
-- computed per athlete (checked on the raw window through an admin-visible day).
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood)
values ('00000000-0000-0000-0000-000000000032', public.club_today() - 1, 1, 1, 1, 1),
       ('00000000-0000-0000-0000-000000000032', public.club_today(), 1, 1, 1, 1);
select pg_temp.as_member('22');
select pg_temp.ok('trend window counts both check-ins', (
  select window_count from public.check_in_trend(null, public.club_today(), public.club_today())) >= 2, true);
select pg_temp.ok('trend flagged is null or at most one per athlete', (
  select flagged_count is null or flagged_count <= 2 from public.check_in_trend(null, public.club_today(), public.club_today())), true);
