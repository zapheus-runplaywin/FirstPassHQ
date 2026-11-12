-- Tests for 20261017000000_conduct_waiting_for_verification.sql. Run on a
-- fresh database with the migrations and seed-members.sql loaded, after
-- code-of-conduct.sql has turned the setting on (or run alone: it turns it
-- on itself). Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;

update public.teams set season = 2026 where true;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
update public.safeguarding_settings set code_of_conduct_url = 'https://example.com/conduct', policy_version = '2026-1' where id;
select pg_temp.as_member('01');
select public.admin_set_conduct_each_season(true);
delete from public.conduct_acceptances where profile_id = '00000000-0000-0000-0000-000000000031';

-- Child 31 has guardians 41 and 42, both verified: not waiting.
select pg_temp.as_member('31');
select pg_temp.ok('verified guardian: child not waiting',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), false);
select pg_temp.as_member('01');
select pg_temp.ok('admin list: child not flagged',
  (select waiting_for_guardian from public.admin_conduct_status() where profile_id = '00000000-0000-0000-0000-000000000031'), false);

-- Neither guardian verified: waiting, for the child, a guardian and admins.
update public.profiles set verified_at = null where id in ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');
-- With no verified guardian the child is locked (20261101000000), so they
-- see only their waiting screen and can't ask.
select pg_temp.as_member('31');
select pg_temp.ok('no verified guardian: the child is locked, so isn''t told here',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), false);
select pg_temp.ok('child still has nothing to do',
  (select count(*) = 0 from public.my_conduct_todos()), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees the wait',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.ok('unverified guardian still not asked for the child',
  (select count(*) = 0 from public.my_conduct_todos() where for_child), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin list: child flagged',
  (select waiting_for_guardian from public.admin_conduct_status() where profile_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('admin list: adult not flagged',
  (select waiting_for_guardian from public.admin_conduct_status() where profile_id = '00000000-0000-0000-0000-000000000032'), false);
select pg_temp.as_member('11');
select pg_temp.ok('a coach cannot ask about the child',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), false);

-- One guardian verified again: the wait ends, and once accepted it stays off.
update public.profiles set verified_at = now() where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.as_member('31');
select pg_temp.ok('one verified guardian ends the wait',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), false);
select pg_temp.as_member('41');
select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000031');
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.as_member('31');
select pg_temp.ok('accepted child never waits',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), false);
select pg_temp.as_member('01');
select pg_temp.ok('admin list: accepted child not flagged',
  (select waiting_for_guardian from public.admin_conduct_status() where profile_id = '00000000-0000-0000-0000-000000000031'), false);

-- An under 18 with no guardian at all is locked (20261101000000): not
-- waiting, and nothing to do until a verified guardian is linked.
delete from public.guardianships where athlete_id = '00000000-0000-0000-0000-000000000031';
delete from public.conduct_acceptances where profile_id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('31');
select pg_temp.ok('child with no guardian is not waiting',
  (select public.conduct_waiting_for_guardian('00000000-0000-0000-0000-000000000031')), false);
select pg_temp.ok('child with no guardian is locked, so has nothing to do',
  (select count(*) = 0 from public.my_conduct_todos()), true);
