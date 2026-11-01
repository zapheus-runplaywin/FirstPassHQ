-- Tests for 20261012230000_volunteer_exemptions.sql. Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
grant select on public.volunteer_exemptions to authenticated;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.todos() returns record language sql as
$$ select row(t.wwcc_missing, t.exemptions_ending) from public.admin_safety_todos() t $$;

-- Logan Parent (guardian of Jordan Junior, 14) becomes a team manager with no check.
reset role;
update public.profiles set extra_roles = '{manager}' where id = '00000000-0000-0000-0000-000000000041';
-- Logan is in Sample Squad already as Jordan's guardian (guardians follow
-- their child into squads, 20261101000000); the manager place takes over.
insert into public.team_members (team_id, profile_id, team_role)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', 'manager')
on conflict (team_id, profile_id) do update set team_role = excluded.team_role;

select pg_temp.as_member('02');
select 'INFO todos before: ' || (select wwcc_missing from public.admin_safety_todos());
select pg_temp.as_member('41');
select pg_temp.ok('parent manager without check or exemption has no manager role', public.has_role('manager'), false);
select pg_temp.ok('parent manager without check or exemption leads no squad', public.leads_group('00000000-0000-0000-0000-0000000000a1'), false);

-- Who can record exemptions, and for whom.
select pg_temp.as_member('41');
select pg_temp.fails('non-admin cannot record an exemption',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000031') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot exempt themselves',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000001', 'under_18_volunteer') $s$);
select pg_temp.fails('child must be under 18',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000032') $s$);
select pg_temp.fails('volunteer must be a guardian of the child',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000013', 'parent_volunteer', '00000000-0000-0000-0000-000000000031') $s$);
select pg_temp.fails('adult cannot be an under-18 volunteer',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000032', 'under_18_volunteer') $s$);
select pg_temp.fails('under-18 volunteer needs a date of birth',
  $s$ select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'under_18_volunteer') $s$);

-- Recorded but not accepted: still paused.
select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000031');
select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000031');
select pg_temp.ok('recording the same exemption twice keeps one row', (select count(*) = 1 from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000041'), true);
select pg_temp.as_member('41');
select pg_temp.ok('exemption waiting for the declaration: role still paused', public.has_role('manager'), false);
select pg_temp.ok('member sees their exemption waiting', (select declared_at is null and not valid and declaration_text like '%Jordan Junior%' from public.my_volunteer_exemption()), true);
select pg_temp.as_member('02');
select pg_temp.ok('waiting exemption counts as missing for admins (plus Blair, an admin with no check)', (select wwcc_missing from public.admin_safety_todos()) = 5, true);

-- Accepted: the role works.
select pg_temp.as_member('41');
select public.accept_volunteer_declaration();
select pg_temp.ok('accepted exemption gives the manager role', public.has_role('manager'), true);
select pg_temp.ok('accepted exemption lets them lead the squad', public.leads_group('00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('accepted exemption lets them message the squad', public.can_message_group('00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('declaration words are kept', (select declaration_text like 'I volunteer at this club because my child, Jordan Junior,%overnight camps.' from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000041' and ended_at is null), true);
select pg_temp.ok('ends on the child''s 18th birthday', (select ends_on = (current_date - interval '14 years' + interval '18 years')::date from public.my_volunteer_exemption()), true);
select pg_temp.as_member('02');
select pg_temp.ok('accepted exemption no longer counts as missing', (select wwcc_missing from public.admin_safety_todos()) = 4, true);
select pg_temp.ok('nothing ending soon yet', (select exemptions_ending from public.admin_safety_todos()) = 0, true);

-- Other members can't see it.
select pg_temp.as_member('11');
set role authenticated;
select pg_temp.ok('other members can''t read exemptions', (select count(*) = 0 from public.volunteer_exemptions), true);
reset role;
select pg_temp.ok('admin list is empty for non-admins', (select count(*) = 0 from public.admin_volunteer_exemptions()), true);

-- The child nearly 18: admins hear 60 days ahead.
reset role;
update public.profiles set date_of_birth = current_date - interval '18 years' + interval '40 days' where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('02');
select pg_temp.ok('exemption ending within 60 days is a to-do', (select exemptions_ending from public.admin_safety_todos()) = 1, true);

-- The child turns 18: the exemption stops applying.
reset role;
update public.profiles set date_of_birth = current_date - interval '18 years' - interval '1 day' where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('41');
select pg_temp.ok('child turned 18: role paused again', public.has_role('manager'), false);
select pg_temp.as_member('02');
select pg_temp.ok('lapsed exemption counts as missing', (select wwcc_missing from public.admin_safety_todos()) = 5, true);
reset role;
update public.profiles set date_of_birth = current_date - interval '14 years' where id = '00000000-0000-0000-0000-000000000031';

-- Unlinked from the child: stops applying.
delete from public.guardianships where guardian_id = '00000000-0000-0000-0000-000000000041';
select pg_temp.as_member('41');
select pg_temp.ok('unlinked from the child: role paused', public.has_role('manager'), false);
reset role;
insert into public.guardianships (guardian_id, athlete_id) values ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031');
select pg_temp.as_member('41');
select pg_temp.ok('linked again: role back', public.has_role('manager'), true);

-- A stand-down still wins.
select pg_temp.as_member('02');
select public.admin_stand_down('00000000-0000-0000-0000-000000000041', 'allegation', 'Test');
select pg_temp.as_member('41');
select pg_temp.ok('stood-down exempt volunteer has no manager role', public.has_role('manager'), false);
select pg_temp.as_member('02');
select public.admin_lift_stand_down('00000000-0000-0000-0000-000000000041', 'Test over');

-- Ending it keeps the history.
select pg_temp.as_member('02');
select public.admin_end_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'Recorded a check instead');
select pg_temp.as_member('41');
select pg_temp.ok('ended exemption: role paused', public.has_role('manager'), false);
select pg_temp.ok('ended exemption kept with who ended it', (select ended_by_name = 'Blair Admin' and end_note = 'Recorded a check instead' from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000041'), true);
select pg_temp.fails('nothing to accept after it ends', $s$ select public.accept_volunteer_declaration() $s$);

-- Under-18 volunteer: Jordan Junior (14) helps coach.
reset role;
update public.profiles set extra_roles = '{coach}' where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('01');
select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000031', 'under_18_volunteer');
select pg_temp.as_member('31');
select pg_temp.ok('under-18 volunteer paused until they accept', public.has_role('coach'), false);
select public.accept_volunteer_declaration();
select pg_temp.ok('under-18 volunteer coaches once accepted', public.has_role('coach'), true);
select pg_temp.ok('under-18 declaration words', (select declaration_text like 'I''m under 18%18th birthday%' from public.my_volunteer_exemption()), true);
reset role;
update public.profiles set date_of_birth = current_date - interval '18 years' where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('31');
select pg_temp.ok('under-18 volunteer turns 18: coach role paused', public.has_role('coach'), false);
reset role;
update public.profiles set date_of_birth = current_date - interval '14 years', extra_roles = '{}' where id = '00000000-0000-0000-0000-000000000031';

-- Replacing an exemption ends the old one.
select pg_temp.as_member('01');
select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000031');
select pg_temp.ok('one open exemption per member', (select count(*) = 1 from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000041' and ended_at is null), true);
select pg_temp.ok('history kept: two rows', (select count(*) = 2 from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000041'), true);
select pg_temp.ok('admin list shows both, open first', (select array_agg(ended_at is null order by ordinality) = '{t,f}' from public.admin_volunteer_exemptions() with ordinality where profile_id = '00000000-0000-0000-0000-000000000041'), true);

-- Approving a new coach: a check or an exemption.
reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'teen.helper@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'adult.helper@example.test', now());
update public.profiles set full_name = 'Noa Helper', date_of_birth = current_date - interval '16 years', status = 'pending'
where id = '00000000-0000-0000-0000-000000000051';
update public.profiles set full_name = 'Oak Helper', date_of_birth = current_date - interval '30 years', status = 'pending'
where id = '00000000-0000-0000-0000-000000000052';
select pg_temp.as_member('01');
select pg_temp.fails('new coach with no check or exemption refused',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000052', 'coach', 'approved') $s$);
select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000051', 'under_18_volunteer');
select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'coach', 'approved');
select pg_temp.ok('new under-18 coach approved with an exemption', (select status = 'approved' from public.profiles where id = '00000000-0000-0000-0000-000000000051'), true);
select pg_temp.as_member('51');
select pg_temp.ok('new under-18 coach paused until they accept', public.has_role('coach'), false);
