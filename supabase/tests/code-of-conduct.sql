-- Tests for 20261013140000_code_of_conduct.sql. Run on a fresh database with
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

update public.teams set season = 2026 where true;

-- No code linked: nothing to accept.
select pg_temp.as_member('11');
select pg_temp.ok('no code linked, nothing to do',
  (select count(*) = 0 from public.my_conduct_todos()), true);
select pg_temp.fails('cannot accept without a code',
  $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000011')$$);

insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
update public.safeguarding_settings set code_of_conduct_url = 'https://example.com/conduct', policy_version = '2026-1' where id;

-- Code linked but the club hasn't turned on asking: still nothing to accept.
select pg_temp.ok('off by default',
  (select public.conduct_each_season_setting()), false);
select pg_temp.ok('switch off, nothing to do',
  (select count(*) = 0 from public.my_conduct_todos()), true);
select pg_temp.fails('switch off, cannot accept',
  $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000011')$$);
select pg_temp.fails('coach cannot turn it on',
  $$select public.admin_set_conduct_each_season(true)$$);
select pg_temp.as_member('01');
select pg_temp.works('admin turns it on', $$select public.admin_set_conduct_each_season(true)$$);
select pg_temp.ok('setting reads on',
  (select public.conduct_each_season_setting()), true);
select pg_temp.as_member('11');

-- Adults
select pg_temp.ok('coach has it to do',
  (select count(*) = 1 from public.my_conduct_todos() where not for_child), true);
select pg_temp.works('coach accepts', $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000011')$$);
select pg_temp.ok('kept with words, version, season and link',
  (select accepted_as = 'self' and policy_version = '2026-1' and season = 2026
     and code_of_conduct_url = 'https://example.com/conduct' and statement like 'I''ve read the club''s code of conduct and I''ll follow it%'
   from public.conduct_acceptances where profile_id = '00000000-0000-0000-0000-000000000011'), true);
select pg_temp.ok('coach done for the season',
  (select count(*) = 0 from public.my_conduct_todos()), true);
select pg_temp.works('accepting twice is harmless', $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000011')$$);
select pg_temp.fails('coach cannot accept for someone else',
  $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000032')$$);

-- Under 18s with a guardian: the guardian accepts
select pg_temp.as_member('31');
select pg_temp.ok('child has nothing to do',
  (select count(*) = 0 from public.my_conduct_todos()), true);
select pg_temp.fails('child cannot accept for themselves',
  $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000031')$$);
select pg_temp.as_member('41');
select pg_temp.ok('guardian has self and child to do',
  (select count(*) = 2 from public.my_conduct_todos()), true);
select pg_temp.ok('child row uses the parent statement',
  (select statement like '%gone through it with my child%' from public.my_conduct_todos() where for_child), true);
select pg_temp.works('guardian accepts for child', $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000031')$$);
select pg_temp.ok('kept as accepted by the guardian',
  (select accepted_as = 'guardian' and accepted_by_name = 'Logan Parent'
   from public.conduct_acceptances where profile_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('42');
select pg_temp.ok('other guardian sees the child done',
  (select count(*) = 0 from public.my_conduct_todos() where for_child), true);
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot accept for an adult athlete',
  $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000032')$$);
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000041';
select pg_temp.ok('unverified guardian is not asked for the child',
  (select count(*) = 0 from public.my_conduct_todos() where for_child), true);
update public.profiles set verified_at = now() where id = '00000000-0000-0000-0000-000000000041';

-- Under 18 with no guardian: locked until a verified guardian is linked
-- (20261020020000), so nothing to do yet.
delete from public.guardianships where athlete_id = '00000000-0000-0000-0000-000000000031';
delete from public.conduct_acceptances where profile_id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('31');
select pg_temp.ok('child with no guardian is locked, so has nothing to do',
  (select count(*) = 0 from public.my_conduct_todos()), true);

-- Guests aren't asked
update public.profiles set role = 'guest', extra_roles = '{}' where id = '00000000-0000-0000-0000-000000000014';
select pg_temp.as_member('14');
select pg_temp.ok('guest is not asked', (select count(*) = 0 from public.my_conduct_todos()), true);

-- New season: asked again
update public.teams set season = 2027 where true;
select pg_temp.as_member('11');
select pg_temp.ok('asked again next season', (select count(*) = 1 from public.my_conduct_todos()), true);
select pg_temp.ok('history keeps last season',
  (select count(*) = 1 and bool_and(season = 2026) from public.conduct_history('00000000-0000-0000-0000-000000000011')), true);

-- Admins
select pg_temp.as_member('13');
select pg_temp.ok('manager cannot read another member history',
  (select count(*) = 0 from public.conduct_history('00000000-0000-0000-0000-000000000011')), true);
select pg_temp.ok('manager gets no status list', (select count(*) = 0 from public.admin_conduct_status()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin status lists the members who must accept',
  (select count(*) > 5 and bool_and(accepted_at is null) from public.admin_conduct_status()), true);
select pg_temp.ok('admin status leaves out guests',
  (select count(*) = 0 from public.admin_conduct_status() where profile_id = '00000000-0000-0000-0000-000000000014'), true);

-- Safeguarding induction
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot add the induction', $$select public.admin_add_safeguarding_induction(2027)$$);
select pg_temp.as_member('01');
select pg_temp.works('admin adds the induction', $$select public.admin_add_safeguarding_induction(2027)$$);
select pg_temp.ok('induction for coaches, managers, physios and committee',
  (select roles = array['coach','manager','physio','committee']::public.app_role[] and course_url = 'https://elearning.sportintegrity.gov.au/'
   from public.training_requirements where name = 'Child Safeguarding in Sport Induction'), true);
select public.admin_add_safeguarding_induction(2027);
select pg_temp.ok('adding again does not duplicate',
  (select count(*) = 1 from public.training_requirements where name = 'Child Safeguarding in Sport Induction'), true);

set role authenticated;
select pg_temp.fails('no direct read', $$select count(*) from public.conduct_acceptances$$);
reset role;

-- Turning it off stops asking and keeps what was accepted.
select pg_temp.as_member('01');
select pg_temp.works('admin turns it off', $$select public.admin_set_conduct_each_season(false)$$);
select pg_temp.ok('nobody listed while off',
  (select count(*) = 0 from public.admin_conduct_status()), true);
reset role;
select pg_temp.ok('acceptances kept when turned off',
  (select count(*) > 0 from public.conduct_acceptances), true);
