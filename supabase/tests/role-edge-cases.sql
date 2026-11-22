-- Role combination edge cases (migration 20261019230000): a guardian whom an
-- admin marked under 18 with no date of birth is refused, and a role listed
-- twice counts once. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.problem(roles text, dob date, under_18 boolean) returns text language sql as
$$ select public.role_combination_problem(roles::public.app_role[], dob, under_18) $$;

select pg_temp.ok('a guardian marked under 18 with no date of birth is refused',
  pg_temp.problem('{guardian}', null, true) = 'Parents and guardians must be 18 or over', true);
select pg_temp.ok('a guardian not marked under 18 with no date of birth is fine',
  pg_temp.problem('{guardian}', null, false) is null, true);
select pg_temp.ok('a guardian aged 17 is refused, whatever the admin chose',
  pg_temp.problem('{guardian}', (public.club_today() - interval '17 years')::date, false) = 'Parents and guardians must be 18 or over', true);
select pg_temp.ok('a guardian aged 18 is fine, whatever the admin chose',
  pg_temp.problem('{guardian}', (public.club_today() - interval '18 years')::date, true) is null, true);
select pg_temp.ok('a guardian who is also a coach, marked under 18, is refused',
  pg_temp.problem('{coach,guardian}', null, true) = 'Parents and guardians must be 18 or over', true);

select pg_temp.ok('a guest listed twice is fine',
  pg_temp.problem('{guest,guest}', null, false) is null, true);
select pg_temp.ok('a temporary helper listed twice is fine',
  pg_temp.problem('{volunteer,volunteer}', null, false) is null, true);
select pg_temp.ok('a guest listed twice with another role is still refused',
  pg_temp.problem('{guest,guest,coach}', null, false) = 'Guests can''t have another role', true);
select pg_temp.ok('an under-18 athlete and coach listed twice is fine',
  pg_temp.problem('{athlete,coach,coach}', null, true) is null, true);
select pg_temp.ok('an under-18 athlete with a committee role is still refused',
  pg_temp.problem('{athlete,athlete,committee}', null, true) = 'Athletes under 18 can only also be a coach', true);
