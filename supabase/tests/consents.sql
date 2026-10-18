-- Tests for 20261013010000_consents.sql. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
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

-- Junior (31, under 18) has an ankle injury and a check-in today; Senior (32) is an adult.
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name, restrictions)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000032', 'Knee', 'Jarred knee', current_date - 1, 'Kai Senior', 'No jumping');
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
values ('00000000-0000-0000-0000-000000000032', current_date, 3, 3, 3, 3, 'Fine');
update public.injuries set restrictions = 'No landing drills' where athlete_id = '00000000-0000-0000-0000-000000000031';
create temp table t as select (select id from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031') as junior;
grant select on t to authenticated;
grant select on public.check_ins, public.injuries, public.injury_updates to authenticated;

-- Policies.
select pg_temp.ok('anyone can read the policy links', (select count(*) = 1 from public.club_policies()), true);
select pg_temp.as_member('11');
select pg_temp.fails('only admins set policies', $s$ select public.admin_set_policies('https://example.com/privacy', null, '2026-1') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('policy links must be https', $s$ select public.admin_set_policies('http://example.com/privacy', null, '2026-1') $s$);
select pg_temp.fails('a version is needed', $s$ select public.admin_set_policies(null, null, ' ') $s$);
select pg_temp.works('admin sets policies', $s$ select public.admin_set_policies('https://example.com/privacy', 'https://example.com/conduct', '2026-1') $s$);
select pg_temp.as_member('11');
select pg_temp.ok('a signed-in member sees the links', (select privacy_policy_url = 'https://example.com/privacy' and code_of_conduct_url = 'https://example.com/conduct' and policy_version = '2026-1' from public.club_policies()), true);
set role anon;
select pg_temp.fails('signed-out visitors can''t read them', $s$ select * from public.club_policies() $s$);
reset role;

-- Before consent: coach (11) sees nothing of the child's injuries or check-ins.
select pg_temp.as_member('11');
select pg_temp.ok('coach does not see the child''s injury',
  (select count(*) = 0 from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee does not see the child''s injury',
  (select count(*) = 0 from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio does not see the child''s injury',
  (select count(*) = 0 from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees an adult''s details as before',
  (select body_area = 'Knee' and description = 'Jarred knee' from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000032'), true);
select pg_temp.ok('coach board leaves the child out',
  (select count(*) = 0 from public.check_in_board('00000000-0000-0000-0000-0000000000a1', current_date) where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('coach counts leave the child out',
  (select athlete_count = 1 and checked_in_count = 1 from public.check_in_summary(current_date) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('coach board: adult answers shown',
  (select sleep = 3 and note = 'Fine' from public.check_in_board('00000000-0000-0000-0000-0000000000a1', current_date) where athlete_id = '00000000-0000-0000-0000-000000000032'), true);
set role authenticated;
select pg_temp.ok('coach cannot read the child''s check-ins directly', (select count(*) = 0 from public.check_ins where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('coach cannot read the child''s injury history', (select count(*) = 0 from public.injury_updates u join t on u.injury_id = t.junior), true);
select pg_temp.ok('coach cannot read the injury row directly', (select count(*) = 0 from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('31');
select pg_temp.ok('the child still reads their own injury', (select count(*) = 1 from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('41');
select pg_temp.ok('the guardian still reads the check-ins', (select count(*) = 1 from public.check_ins where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
reset role;
select pg_temp.as_member('01');
select pg_temp.ok('admin sees the details', (select description is not null from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('admin report: no consents yet', (select not data and not health from public.admin_child_consents() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);

-- Clearance waits for health consent.
select pg_temp.as_member('31');
reset role;
insert into storage.objects (bucket_id, name, metadata) values ('injury-documents',
  '00000000-0000-0000-0000-000000000031/' || (select junior from t) || '/1-letter.pdf', '{"mimetype":"application/pdf"}');
select public.request_clearance((select junior from t), 'Ready', '00000000-0000-0000-0000-000000000031/' || (select junior from t) || '/1-letter.pdf', 'letter.pdf');
select pg_temp.as_member('11');
select pg_temp.ok('nothing waiting for the coach without consent', (select count(*) = 0 from public.visible_injuries() where id = (select junior from t)), true);
select pg_temp.fails('coach cannot endorse without consent', format('select public.endorse_clearance(%L)', (select junior from t)));
select pg_temp.fails('coach cannot open the proof without consent', format('select public.open_injury_document(%L)', '00000000-0000-0000-0000-000000000031/' || (select junior from t) || '/1-letter.pdf'));

-- Giving consent.
select pg_temp.as_member('31');
select pg_temp.fails('the child cannot consent for themselves', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('a coach cannot consent', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true) $s$);
select pg_temp.as_member('41');
reset role;
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.fails('an unverified guardian cannot consent', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true) $s$);
select pg_temp.ok('unverified guardian is told they can''t consent yet', (select not can_consent from public.my_child_consents()), true);
update public.profiles set verified_at = now() where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.ok('guardian sees no consents yet', (select not data and not health and can_consent from public.my_child_consents()), true);
select pg_temp.works('guardian gives data consent only', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, false) $s$);
select pg_temp.works('saving again changes nothing', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, false) $s$);
select pg_temp.ok('one data consent recorded with the version', (select count(*) = 1 and bool_and(policy_version = '2026-1' and given_by_name = 'Logan Parent') from public.child_consent_history('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach now sees the answers', (select sleep = 4 and note = 'Tired after exams' from public.check_in_board('00000000-0000-0000-0000-0000000000a1', current_date) where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('and counts them', (select athlete_count = 2 from public.check_in_summary(current_date) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('but still not the injury', (select count(*) = 0 from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('42');
select pg_temp.works('second guardian gives health consent too', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true) $s$);
select pg_temp.as_member('11');
select pg_temp.ok('coach now sees the injury', (select body_area = 'Ankle' and description is not null and waiting_for_me from public.visible_injuries() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.works('coach can open the proof now', format('select public.open_injury_document(%L)', '00000000-0000-0000-0000-000000000031/' || (select junior from t) || '/1-letter.pdf'));
select pg_temp.works('coach can endorse now', format('select public.endorse_clearance(%L)', (select junior from t)));

-- Withdrawing.
select pg_temp.as_member('41');
select pg_temp.works('guardian withdraws health consent', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, false) $s$);
select pg_temp.ok('withdrawal recorded, not deleted', (select count(*) = 1 from public.child_consent_history('00000000-0000-0000-0000-000000000031') where kind = 'health' and withdrawn_at is not null and withdrawn_by_name = 'Logan Parent'), true);
select pg_temp.as_member('22');
select pg_temp.fails('committee cannot accept without consent', format('select public.accept_clearance(%L)', (select junior from t)));
select pg_temp.as_member('01');
select pg_temp.works('admin can still accept', format('select public.accept_clearance(%L)', (select junior from t)));
select pg_temp.as_member('31');
select pg_temp.ok('the child sees their consents', (select count(*) = 2 from public.child_consent_history('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('11');
select pg_temp.fails('coach does not see consents', $s$ select * from public.child_consent_history('00000000-0000-0000-0000-000000000031') $s$);
select pg_temp.fails('only admins see every consent', $s$ select * from public.admin_child_consents() $s$);
select pg_temp.as_member('41');
select pg_temp.fails('cannot consent for an adult', $s$ select public.set_child_consent('00000000-0000-0000-0000-000000000032', true, true) $s$);
