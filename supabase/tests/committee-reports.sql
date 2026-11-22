-- Tests for 20261023190000_committee_reports.sql: admins and committee members
-- with a current check read the governance reports, read only (customer
-- review C14). Run on a fresh database with the migrations and
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
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
-- How many rows the signed-in member reads from a table, as the app does.
create or replace function pg_temp.reads(q text) returns bigint language plpgsql as
$$ declare n bigint;
   begin
     set local role authenticated;
     execute 'select count(*) from (' || q || ') t' into n;
     reset role;
     return n;
   exception when others then
     reset role;
     return -1;
   end $$;
-- Whether a change by the signed-in member, as the app's role, touched a row.
create or replace function pg_temp.changes(q text) returns boolean language plpgsql as
$$ declare n bigint;
   begin
     set local role authenticated;
     execute q;
     get diagnostics n = row_count;
     reset role;
     return n > 0;
   exception when others then
     reset role;
     return false;
   end $$;
-- Everything one report reader can read, as one line per source.
create or replace function pg_temp.reader(n text) returns table (label text, seen boolean) language plpgsql as
$$ begin
     perform pg_temp.as_member(n);
     return query values
       ('can read reports', public.can_read_reports()),
       ('members', pg_temp.reads('select * from public.report_members()') > 3),
       ('stand-downs', pg_temp.reads('select * from public.stand_downs where profile_id = ''' || pg_temp.id('12') || '''') > 0),
       ('screening notices', pg_temp.reads('select * from public.screening_notices') > 0),
       ('other members'' policy acknowledgements', pg_temp.reads('select * from public.policy_acknowledgements where profile_id <> auth.uid()') > 0),
       ('other members'' team places', pg_temp.reads('select * from public.team_members where profile_id <> auth.uid()') > 0),
       ('volunteer exemptions', pg_temp.reads('select * from public.admin_volunteer_exemptions()') > 0),
       ('the WWC Registration Officer', pg_temp.reads('select * from public.admin_wwc_officer()') > 0),
       ('check applications', pg_temp.reads('select * from public.admin_wwcc_applications()') > 0),
       ('medical details checks', pg_temp.reads('select * from public.medical_review_compliance()') > 0),
       ('absences', pg_temp.reads($q$select * from public.absence_report(public.club_today() - 7, public.club_today() + 7)$q$) > 0),
       -- The awards themselves (20261121200000_match_database_access_to_roles.sql).
       ('awards', pg_temp.reads('select * from public.awards') > 0),
       ('award votes', pg_temp.reads($q$select * from public.award_vote_breakdown('f0000000-0000-0000-0000-000000000001')$q$) > 0),
       ('award turnout', pg_temp.reads($q$select * from public.award_turnout('f0000000-0000-0000-0000-000000000001')$q$) > 0);
   end $$;
create or replace function pg_temp.sees_all(who text, n text, expected boolean) returns setof text language sql as
$$ select pg_temp.ok(who || ': ' || r.label, r.seen, expected) from pg_temp.reader(n) r $$;

-- A committee member with a current check (Gale's lapsed five days ago in the
-- seed; renewed here), one cleared by a parent volunteer exemption, a checked
-- one who is stood down, and a coach-parent who is also on the committee.
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('51'), 'committee.parent@example.test', now()),
  (pg_temp.id('52'), 'committee.stood@example.test', now());
update public.profiles set status = 'approved', full_name = 'Nico Committee-Parent', role = 'committee',
  extra_roles = '{guardian}', verified_at = now() where id = pg_temp.id('51');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('51'), pg_temp.id('31'));
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, declared_at, declaration_text)
  values (pg_temp.id('51'), 'parent_volunteer', pg_temp.id('31'), 'Jordan Junior', now(), 'Declared');
update public.profiles set status = 'approved', full_name = 'Oak Committee', role = 'committee', wwcc_number = 'WWC0052',
  wwcc_expires_on = public.club_today() + 400, stood_down_at = now() where id = pg_temp.id('52');
update public.profiles set extra_roles = '{guardian,committee}' where id = pg_temp.id('42');

-- What the reports are built from.
insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
delete from public.safeguarding_post_holders where post = 'wwc_officer';
insert into public.safeguarding_post_holders (post, profile_id) values ('wwc_officer', pg_temp.id('01'));
insert into public.stand_downs (profile_id, member_name, reason, started_at, lifted_at)
  values (pg_temp.id('12'), 'Drew Lapsed', 'other', now() - interval '1 month', now() - interval '1 week');
insert into public.screening_notices (profile_id, member_name, kind, received_on, action)
  values (pg_temp.id('12'), 'Drew Lapsed', 'other', public.club_today() - 30, 'Noted');
insert into public.policy_acknowledgements (profile_id, policy_version, statement)
  values (pg_temp.id('32'), 'v1', 'I agree'), (pg_temp.id('11'), 'v1', 'I agree');
insert into public.wwcc_applications (profile_id, application_number, lodged_on, kind, receipt_path)
  values (pg_temp.id('13'), 'APP-0013', public.club_today() - 10, 'renewal', '00000000-0000-0000-0000-000000000013/receipt.pdf');
insert into public.attendance_absences (athlete_id, from_day, to_day, reported_as)
  values (pg_temp.id('31'), public.club_today(), public.club_today(), 'athlete');
insert into public.awards (id, season, name, closes_at, voter_roles) values
  ('f0000000-0000-0000-0000-000000000001', 2026, 'Best and fairest', now() - interval '1 day', '{athlete}'),
  ('f0000000-0000-0000-0000-000000000002', 2026, 'Still open', now() + interval '1 week', '{athlete}');
insert into public.award_ballots (id, award_id, voter_id) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', pg_temp.id('31')),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', pg_temp.id('31'));
insert into public.award_votes (ballot_id, rank, points, nominee_id, nominee_name) values
  ('f1000000-0000-0000-0000-000000000001', 1, 3, pg_temp.id('32'), 'Kai Senior'),
  ('f1000000-0000-0000-0000-000000000002', 1, 3, pg_temp.id('32'), 'Kai Senior');

-- Who may call what.
select pg_temp.ok('anon cannot ask whether they read reports', has_function_privilege('anon', 'public.can_read_reports()', 'execute'), false);
select pg_temp.ok('anon cannot read report members', has_function_privilege('anon', 'public.report_members()', 'execute'), false);
select pg_temp.ok('signed-in members can call report members (it checks inside)', has_function_privilege('authenticated', 'public.report_members()', 'execute'), true);

-- Report readers: every source, both admins and every kind of checked committee member.
select pg_temp.sees_all('an admin with a check', '01', true);
select pg_temp.sees_all('an admin without a check', '02', true);
select pg_temp.sees_all('a committee member with a current check', '21', true);
select pg_temp.sees_all('a committee member with a parent volunteer exemption', '51', true);
select pg_temp.sees_all('a coach-parent on the committee with a current check', '42', true);

-- Everyone else reads none of it.
select pg_temp.sees_all('a committee member in the checks grace period (no check)', '22', false);
select pg_temp.sees_all('a committee member exempted with a reason', '23', false);
select pg_temp.sees_all('a stood-down committee member with a check', '52', false);
select pg_temp.sees_all('a coach', '11', false);

-- The rest of what the committee's reports read was open to the committee
-- before (their attendance, training and award screens): still readable.
insert into public.attendance_sessions (team_id, team_name, club_wide, name, held_at)
  select null, '', true, 'Club day', now() - interval '1 day'
  where not exists (select 1 from public.attendance_sessions);
insert into public.training_requirements (season, name, due_on, roles)
  select 2026, 'Child Safeguarding in Sport Induction', public.club_today() + 30, '{coach}'
  where not exists (select 1 from public.training_requirements);
select pg_temp.as_member('21');
select pg_temp.ok('a checked committee member reads awards for the award results report', pg_temp.reads('select * from public.awards') > 0, true);
select pg_temp.ok('a checked committee member reads attendance sessions for the attendance report', pg_temp.reads('select * from public.attendance_sessions') > 0, true);
select pg_temp.ok('a checked committee member reads attendance marks without an error', pg_temp.reads('select * from public.attendance_marks') >= 0, true);
select pg_temp.ok('a checked committee member reads training courses for the integrity report', pg_temp.reads('select * from public.training_requirements') > 0, true);
select pg_temp.ok('a checked committee member reads who must do each course',
  pg_temp.reads('select * from public.training_requirement_members((select id from public.training_requirements limit 1))') >= 0, true);
select pg_temp.sees_all('a coach whose check lapsed', '12', false);
select pg_temp.sees_all('a manager', '13', false);
select pg_temp.sees_all('a physio', '14', false);
select pg_temp.sees_all('an athlete under 18', '31', false);
select pg_temp.sees_all('an adult athlete', '32', false);
select pg_temp.sees_all('a guardian', '41', false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('someone signed out cannot read reports', public.can_read_reports(), false);
select pg_temp.ok('someone signed out reads no members', pg_temp.reads('select * from public.report_members()') = 0, true);

-- Gale's check lapses: the reports close again.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('21');
select pg_temp.as_member('21');
select pg_temp.ok('a committee member whose check lapsed reads no reports', public.can_read_reports(), false);
select pg_temp.ok('a committee member whose check lapsed reads no members', pg_temp.reads('select * from public.report_members()') = 0, true);
select pg_temp.fails('a committee member whose check lapsed gets no medical details checks', 'select * from public.medical_review_compliance()');
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('21');

-- A member's own rows stay theirs whatever this adds.
select pg_temp.as_member('32');
select pg_temp.ok('an athlete still reads their own team places', pg_temp.reads('select * from public.team_members where profile_id = auth.uid()') > 0, true);
select pg_temp.ok('an athlete still reads their own policy acknowledgement', pg_temp.reads('select * from public.policy_acknowledgements where profile_id = auth.uid()') > 0, true);

-- What a checked committee member reads, and what they don't.
select pg_temp.as_member('21');
select pg_temp.ok('report members leave out email addresses', (select bool_and(email is null and playhq_email is null and guardian_email is null) from public.report_members()), true);
select pg_temp.ok('report members leave out verification notes and rejection reasons', (select bool_and(verification_note is null and rejection_reason is null) from public.report_members()), true);
select pg_temp.ok('report members leave out what was declared at joining', (select bool_and(declared_date_of_birth is null and declared_wwcc_number is null) from public.report_members()), true);
select pg_temp.ok('report members keep each check', (select wwcc_number = 'WWC0011' and wwcc_expires_on is not null from public.report_members() where id = pg_temp.id('11')), true);
select pg_temp.ok('report members keep names and roles', (select full_name = 'Casey Coach' and role = 'coach' from public.report_members() where id = pg_temp.id('11')), true);
select pg_temp.ok('report members are approved members only', (select bool_and(status = 'approved') from public.report_members()), true);
select pg_temp.ok('the committee still cannot read other profiles directly', pg_temp.reads('select * from public.profiles where id <> auth.uid()') = 0, true);
select pg_temp.ok('the committee does not see check receipts', (select bool_and(receipt_path is null) from public.admin_wwcc_applications()), true);
select pg_temp.ok('the committee sees the application itself', (select application_number = 'APP-0013' from public.admin_wwcc_applications()), true);
select pg_temp.ok('the committee sees the WWC Registration Officer', (select officer_name is not null from public.admin_wwc_officer()), true);
select pg_temp.ok('the medical details checks report has no medical details', (select count(*) = 0 from information_schema.routines r
  join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_schema = 'public' and r.routine_name = 'medical_review_compliance'
    and p.parameter_mode = 'OUT' and p.parameter_name in ('allergies', 'conditions', 'medications', 'action_plan', 'emergency_contacts')), true);
select pg_temp.ok('award votes only once the award has closed', pg_temp.reads($q$select * from public.award_vote_breakdown('f0000000-0000-0000-0000-000000000002')$q$) = 0, true);
select pg_temp.as_member('01');
select pg_temp.ok('admins still see check receipts', (select bool_and(receipt_path is not null) from public.admin_wwcc_applications()), true);
select pg_temp.ok('admins still read every profile directly', pg_temp.reads('select * from public.profiles where id <> auth.uid()') > 3, true);

-- Read only: a checked committee member changes nothing through what they read.
select pg_temp.as_member('21');
select pg_temp.ok('the committee cannot add a stand-down', pg_temp.changes(
  $q$insert into public.stand_downs (profile_id, member_name, reason, started_at) values ('00000000-0000-0000-0000-000000000011', 'Casey Coach', 'other', now())$q$), false);
select pg_temp.ok('the committee cannot lift a stand-down', pg_temp.changes(
  $q$update public.stand_downs set lifted_at = now()$q$), false);
select pg_temp.ok('the committee cannot delete a stand-down', pg_temp.changes(
  $q$delete from public.stand_downs$q$), false);
select pg_temp.ok('the committee cannot change a screening notice', pg_temp.changes(
  $q$update public.screening_notices set action = 'changed'$q$), false);
select pg_temp.ok('the committee cannot delete a screening notice', pg_temp.changes(
  $q$delete from public.screening_notices$q$), false);
select pg_temp.ok('the committee cannot add someone''s policy acknowledgement', pg_temp.changes(
  $q$insert into public.policy_acknowledgements (profile_id, policy_version, statement) values ('00000000-0000-0000-0000-000000000011', 'v1', 'I agree')$q$), false);
select pg_temp.ok('the committee cannot delete a policy acknowledgement', pg_temp.changes(
  $q$delete from public.policy_acknowledgements$q$), false);
select pg_temp.ok('the committee cannot place a member in a team', pg_temp.changes(
  $q$insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000032', 'athlete')$q$), false);
select pg_temp.ok('the committee cannot move a member between teams', pg_temp.changes(
  $q$update public.team_members set team_role = 'coach' where profile_id = '00000000-0000-0000-0000-000000000032'$q$), false);
select pg_temp.ok('the committee cannot take a member out of a team', pg_temp.changes(
  $q$delete from public.team_members where profile_id = '00000000-0000-0000-0000-000000000032'$q$), false);
select pg_temp.ok('the committee cannot change a check', pg_temp.changes(
  $q$update public.profiles set wwcc_expires_on = public.club_today() + 1000 where id = '00000000-0000-0000-0000-000000000011'$q$), false);
select pg_temp.fails('the committee cannot choose the WWC Registration Officer',
  $q$select public.admin_set_wwc_officer('00000000-0000-0000-0000-000000000021')$q$);
reset role;
select pg_temp.ok('nothing the committee tried changed a row', (select count(*) = 1 from public.stand_downs) and (select count(*) = 1 from public.screening_notices)
  and (select count(*) = 3 from public.team_members where profile_id = pg_temp.id('31') or profile_id = pg_temp.id('32')), true);
