-- Tests for 20261013020000_date_of_birth_at_join.sql. Run on a fresh database
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

-- New people: 51 a child, 52 an adult, 53 an athlete approved long ago with no date of birth.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'new.child@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'new.adult@example.test', now()),
  ('00000000-0000-0000-0000-000000000053', 'old.athlete@example.test', now());
update public.profiles set status = 'approved', role = 'athlete', full_name = 'Old Athlete', under_17 = true
where id = '00000000-0000-0000-0000-000000000053';

select pg_temp.as_member('01');
select pg_temp.ok('to-do: one approved athlete without a date of birth',
  (select athletes_without_date_of_birth = 1 from public.admin_safety_todos()), true);

-- Join.
select pg_temp.as_member('51');
select pg_temp.fails('a child must give a guardian email',
  $s$ select public.submit_join_request('Riley Child', '', 'athlete', null, null, (current_date - interval '13 years')::date, null) $s$);
select pg_temp.fails('a guardian email must look like one',
  $s$ select public.submit_join_request('Riley Child', '', 'athlete', null, null, (current_date - interval '13 years')::date, 'not-an-email') $s$);
select pg_temp.fails('a date of birth in the future is refused',
  $s$ select public.submit_join_request('Riley Child', '', 'athlete', null, null, current_date + 1, 'parent@example.test') $s$);
select pg_temp.works('a child asks to join with a guardian email',
  $s$ select public.submit_join_request('Riley Child', '', 'athlete', null, null, (current_date - interval '13 years')::date, ' Parent@Example.test ') $s$);
select pg_temp.ok('their date of birth is kept as declared, not as checked',
  (select declared_date_of_birth = (current_date - interval '13 years')::date and date_of_birth is null and status = 'pending'
   from public.profiles where id = auth.uid()), true);
select pg_temp.ok('the guardian email is kept, in lower case',
  (select guardian_email = 'parent@example.test' from public.profiles where id = auth.uid()), true);
select pg_temp.works('an older app version can still ask to join',
  $s$ select public.submit_join_request('Riley Child', '', 'athlete', null, null) $s$);
select pg_temp.ok('and what they said before is kept',
  (select declared_date_of_birth is not null and guardian_email = 'parent@example.test' from public.profiles where id = auth.uid()), true);
set role authenticated;
select pg_temp.fails('a member cannot change their declared date of birth directly',
  $s$ update public.profiles set declared_date_of_birth = '2000-01-01' where id = auth.uid() $s$);
reset role;

select pg_temp.as_member('52');
select pg_temp.works('an adult athlete asks to join',
  $s$ select public.submit_join_request('Sam Adult', '', 'athlete', null, null, '1999-04-01', 'someone@example.test') $s$);
select pg_temp.ok('an adult''s guardian email is not kept',
  (select guardian_email is null and declared_date_of_birth = '1999-04-01' from public.profiles where id = auth.uid()), true);
select pg_temp.works('a coach gives a date of birth too',
  $s$ select public.submit_join_request('Sam Adult', '', 'coach', null, null, '1999-04-01', null) $s$);

-- Approving needs a checked date of birth.
select pg_temp.as_member('01');
select pg_temp.fails('an athlete is not approved as an adult without a date of birth',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'athlete', 'approved', '[]', false, '{}') $s$);
select pg_temp.fails('nor as a child without a date of birth',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'athlete', 'approved', '[]', true, '{00000000-0000-0000-0000-000000000041}') $s$);
select pg_temp.as_member('11');
select pg_temp.fails('only admins record a date of birth',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000051', (current_date - interval '13 years')::date, null, null) $s$);
select pg_temp.ok('only admins see who recorded it',
  (select count(*) = 0 from public.admin_date_of_birth_record('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('01');
select pg_temp.works('admin records the checked date of birth',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000051', (current_date - interval '13 years')::date, null, null) $s$);
select pg_temp.ok('who recorded it and when is kept',
  (select recorded_by_name = 'Alex Admin' and recorded_at is not null
   from public.admin_date_of_birth_record('00000000-0000-0000-0000-000000000051')), true);
create temp table first_record as
  select date_of_birth_recorded_at as at from public.profiles where id = '00000000-0000-0000-0000-000000000051';
select pg_temp.as_member('02');
select pg_temp.works('another admin saves the same date',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000051', (current_date - interval '13 years')::date, null, null) $s$);
select pg_temp.ok('saving the same date keeps the first record',
  (select p.date_of_birth_recorded_by = '00000000-0000-0000-0000-000000000001' and p.date_of_birth_recorded_at = f.at
   from public.profiles p, first_record f where p.id = '00000000-0000-0000-0000-000000000051'), true);
select pg_temp.as_member('01');
select pg_temp.fails('a child still needs a verified guardian, whatever the admin ticks',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'athlete', 'approved', '[]', false, '{}') $s$);
select pg_temp.works('the child is approved with a guardian',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000051', 'athlete', 'approved', '[]', false, '{00000000-0000-0000-0000-000000000041}') $s$);
select pg_temp.ok('and is under 18 by their date of birth',
  (select under_17 from public.profiles where id = '00000000-0000-0000-0000-000000000051'), true);

select pg_temp.works('admin records the adult''s date of birth',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000052', '1999-04-01', null, null) $s$);
select pg_temp.works('the adult athlete is approved',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000052', 'athlete', 'approved', '[]', false, '{}') $s$);

select pg_temp.fails('an athlete approved before is not re-saved without a date of birth',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000053', 'athlete', 'approved', '[]', true, '{00000000-0000-0000-0000-000000000041}') $s$);
select pg_temp.ok('the old athlete keeps their access meanwhile',
  (select status = 'approved' and under_17 from public.profiles where id = '00000000-0000-0000-0000-000000000053'), true);
select pg_temp.works('a guardian is still saved without a date of birth',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000041', 'guardian', 'approved', '[]', false, '{}') $s$);
select pg_temp.works('the old athlete''s date of birth is added',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000053', (current_date - interval '15 years')::date, null, null) $s$);
select pg_temp.ok('the to-do clears',
  (select athletes_without_date_of_birth = 0 from public.admin_safety_todos()), true);
select pg_temp.as_member('11');
select pg_temp.ok('the to-do is only for admins',
  (select coalesce(sum(athletes_without_date_of_birth), 0) = 0 from public.admin_safety_todos()), true);
