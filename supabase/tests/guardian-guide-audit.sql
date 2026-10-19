-- Tests for 20261019120000_guardian_guide_audit.sql (parent and guardian guide
-- audit, 19 October 2026). Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
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
create temp table ids (k text primary key, v uuid);

-- ---------------------------------------------------------------------------
-- A guardian placed in a squad is a member of it (squad calendar, fixtures and
-- roster), with no Working With Children Check. Logan Parent (41) is Jordan's
-- (31) guardian; Sample Squad (a1) holds Jordan and Kai (32).
-- ---------------------------------------------------------------------------
select pg_temp.as_member('41');
select pg_temp.ok('a guardian in no squad is not a member of it', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);
insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', 'guardian');
select pg_temp.ok('a guardian placed in the squad is a member of it', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('the guardian sees the squad roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-0000000000a1')) > 0, true);
select pg_temp.ok('the roster never lists guardians', exists (select 1 from public.team_roster('00000000-0000-0000-0000-0000000000a1') where team_role::text = 'guardian'), false);
select pg_temp.ok('the guardian is not a member of the team they are not placed in', public.is_team_member('00000000-0000-0000-0000-0000000000a2'), false);
-- A guardian who is also a lapsed coach still has the squad as a guardian.
select pg_temp.as_member('12');
select pg_temp.ok('a lapsed coach is still not a member', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);
insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000012', 'guardian');
select pg_temp.ok('placed in a team as a guardian, the lapsed coach is a member of that team', public.is_team_member('00000000-0000-0000-0000-0000000000a2'), true);
delete from public.team_members where profile_id = '00000000-0000-0000-0000-000000000012' and team_role::text = 'guardian';
-- A guardian whose own account is not approved is not a member.
update public.profiles set status = 'pending' where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.as_member('41');
select pg_temp.ok('an unapproved guardian is not a member', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);
update public.profiles set status = 'approved' where id = '00000000-0000-0000-0000-000000000041';

-- ---------------------------------------------------------------------------
-- A parent or guardian reads their child's named survey answers only while
-- the child is under 18. The admin (01) sends a named survey to the squad;
-- Jordan answers it. Logan is taken out of the squad first: a guardian placed
-- in the squad is in its audience in their own right (see the audit's A4).
-- ---------------------------------------------------------------------------
delete from public.team_members where profile_id = '00000000-0000-0000-0000-000000000041';
select pg_temp.as_member('01');
insert into ids values ('named', public.create_survey(
  'Training nights', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Best night","options":["Tuesday","Thursday"]}]'));
select pg_temp.as_member('31');
select public.submit_survey_response((select v from ids where k = 'named'), (
  select jsonb_build_array(jsonb_build_object('question_id', q ->> 'id', 'choices', jsonb_build_array(1)))
  from jsonb_array_elements(public.survey_detail((select v from ids where k = 'named')) -> 'questions') q), false);
select pg_temp.as_member('41');
select pg_temp.ok('the guardian reads the child''s named answers',
  jsonb_array_length(public.survey_detail((select v from ids where k = 'named')) -> 'children' -> 0 -> 'answers') = 1, true);
update public.profiles set date_of_birth = current_date - interval '18 years', under_17 = false where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.ok('on the child''s 18th birthday the answers are no longer the guardian''s to read',
  jsonb_array_length(public.survey_detail((select v from ids where k = 'named')) -> 'children') = 0, true);
select pg_temp.ok('the copy itself stays in the guardian''s list',
  exists (select 1 from public.my_surveys() where id = (select v from ids where k = 'named')), true);
update public.profiles set date_of_birth = current_date - interval '14 years', under_17 = true where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.ok('and comes back for a child under 18',
  jsonb_array_length(public.survey_detail((select v from ids where k = 'named')) -> 'children') = 1, true);
