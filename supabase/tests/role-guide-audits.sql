-- Tests for 20261018230000_role_guide_audits.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;

-- A guest with a recorded card is still not eligible as a safeguarding contact.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'helper@example.test', now());
update public.profiles set status = 'approved', full_name = 'Gus Guest', role = 'guest', verified_at = now(),
  wwcc_number = 'WWC0061', wwcc_expires_on = current_date + 400, date_of_birth = current_date - interval '30 years'
where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.ok('guest cannot be a safeguarding contact', public.can_be_safeguarding_contact('00000000-0000-0000-0000-000000000061'), false);
select pg_temp.ok('cleared coach can be', public.can_be_safeguarding_contact('00000000-0000-0000-0000-000000000011'), true);

-- A temporary helper whose first day is ahead, with an unvalidated card, is in no WWC count yet.
update public.profiles set status = 'approved', full_name = 'Hal Helper', role = 'volunteer', verified_at = now(),
  volunteer_task = 'Bench helper', volunteer_from = current_date + 10, volunteer_until = current_date + 12,
  wwcc_number = 'WWC0062', wwcc_expires_on = current_date + 11
where id = '00000000-0000-0000-0000-000000000062';
select pg_temp.as_member('01');
create temp table before as select * from public.admin_safety_todos();
update public.profiles set volunteer_from = current_date - 1 where id = '00000000-0000-0000-0000-000000000062';
create temp table during as select * from public.admin_safety_todos();
select pg_temp.ok('upcoming helper not counted to validate', (select wwcc_to_validate from during) - (select wwcc_to_validate from before) = 1, true);
select pg_temp.ok('upcoming helper not counted to register', (select wwcc_to_link from during) - (select wwcc_to_link from before) = 1, true);
select pg_temp.ok('upcoming helper not counted as expiring', (select wwcc_expiring from during) - (select wwcc_expiring from before) = 1, true);
select pg_temp.ok('upcoming helper not counted in people', (select wwcc_people from during) - (select wwcc_people from before) = 1, true);
update public.profiles set volunteer_until = current_date - 1, volunteer_from = current_date - 3 where id = '00000000-0000-0000-0000-000000000062';
create temp table after as select * from public.admin_safety_todos();
select pg_temp.ok('finished helper drops out again', (select wwcc_people from after) = (select wwcc_people from before), true);
