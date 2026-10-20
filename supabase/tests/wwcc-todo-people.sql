-- Tests for 20261016020000_wwcc_todo_people.sql. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;

select pg_temp.as_member('01');
-- Seed: 02, 12, 21 and 22 have no current card; 01, 11, 13, 14 and 42 have one
-- that is neither validated nor registered. 23 is exempt.
select pg_temp.ok('seed: 4 missing, 5 to validate, 5 to register, 9 people',
  (select wwcc_missing = 4 and wwcc_expiring = 0 and wwcc_to_validate = 5 and wwcc_to_link = 5 and wwcc_people = 9
   from public.admin_safety_todos()), true);

-- 13's card now expires within 60 days and is still unvalidated and unregistered:
-- three counts, one person.
update public.profiles set wwcc_expires_on = current_date + 30 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.ok('expiring and unvalidated counts the person once',
  (select wwcc_expiring = 1 and wwcc_to_validate = 5 and wwcc_people = 9 from public.admin_safety_todos()), true);

-- Validating and registering 11 takes them off every count.
select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000011', 'Casey Coach', 'online', true);
select pg_temp.ok('a validated, registered, current card drops off',
  (select wwcc_to_validate = 4 and wwcc_to_link = 4 and wwcc_people = 8 from public.admin_safety_todos()), true);

-- Validated but not registered still counts.
select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000014', 'Finley Physio', 'online', false);
select pg_temp.ok('validated but unregistered still counts',
  (select wwcc_to_validate = 3 and wwcc_to_link = 4 and wwcc_people = 8 from public.admin_safety_todos()), true);

-- Exempting 22 takes them off.
select pg_temp.as_member('02');
select public.admin_set_wwcc_exemption('00000000-0000-0000-0000-000000000022', 'Secretary, never at training');
select pg_temp.as_member('01');
select pg_temp.ok('an exempt committee member drops off',
  (select wwcc_missing = 3 and wwcc_people = 7 from public.admin_safety_todos()), true);

-- Non-admins get nothing.
select pg_temp.as_member('11');
select pg_temp.ok('a coach sees no counts',
  (select coalesce(wwcc_people, 0) = 0 from public.admin_safety_todos()), true);
