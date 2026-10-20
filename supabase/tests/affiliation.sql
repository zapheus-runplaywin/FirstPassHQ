-- Tests for 20261013093000_affiliation.sql. Run on a fresh database with the
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

update public.teams set season = 2026 where true;

select pg_temp.as_member('11');
select pg_temp.ok('a coach sees no affiliation record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a coach can''t change it',
  $s$ select public.admin_set_affiliation('club', null, 'A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.fails('a coach can''t mark a registration',
  $s$ select public.admin_set_playhq_registration('00000000-0000-0000-0000-000000000031', 2026, true) $s$);
select pg_temp.ok('a coach sees no registrations', (select count(*) = 0 from public.admin_playhq_registrations(2026)), true);

select pg_temp.as_member('01');
select pg_temp.ok('starts as a club with nothing recorded, season 2026, one team, six people to check',
  (select member_type = 'club' and incorporation_number is null and season = 2026 and team_count = 1
     and registrations_total = 6 and registered = 0 and not_registered = 0
   from public.admin_affiliation()), true);
select pg_temp.fails('a child can''t be a primary contact',
  $s$ select public.admin_set_affiliation('club', null, 'A1', 'Assoc', current_date, '00000000-0000-0000-0000-000000000031', null, '{}', null) $s$);
select pg_temp.fails('the same person twice is refused',
  $s$ select public.admin_set_affiliation('club', null, 'A1', 'Assoc', current_date, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '{}', null) $s$);
select pg_temp.fails('a future date is refused',
  $s$ select public.admin_set_affiliation('club', null, 'A1', 'Assoc', current_date + 1, null, null, '{}', null) $s$);
select pg_temp.fails('an association needs a tier',
  $s$ select public.admin_set_affiliation('association', null, 'A1', 'Netball WA', null, null, null, '{}', null) $s$);
select pg_temp.fails('checks must be ticks',
  $s$ select public.admin_set_affiliation('club', null, 'A1', 'Assoc', null, null, null, '{"compliance": "yes"}', null) $s$);
select pg_temp.works('a club saves',
  $s$ select public.admin_set_affiliation('club', 3, ' A1234 ', 'Sample Netball Association', current_date - 10,
        '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', '{"compliance": true}', 'note') $s$);
select pg_temp.ok('a club keeps no tier and the details are trimmed and named',
  (select tier is null and incorporation_number = 'A1234' and primary_contact_2_name = 'Emery Manager'
     and (checks ->> 'compliance')::boolean and updated_by_name = 'Alex Admin'
   from public.admin_affiliation()), true);

select pg_temp.fails('a child can''t be an officer',
  $s$ select public.admin_set_affiliation_officer('president', '00000000-0000-0000-0000-000000000031', null) $s$);
select pg_temp.fails('an unknown office is refused',
  $s$ select public.admin_set_affiliation_officer('treasurer', '00000000-0000-0000-0000-000000000001', null) $s$);
select pg_temp.works('an officer is named',
  $s$ select public.admin_set_affiliation_officer('president', '00000000-0000-0000-0000-000000000021', current_date - 30) $s$);
select pg_temp.works('and changed',
  $s$ select public.admin_set_affiliation_officer('president', '00000000-0000-0000-0000-000000000022', null) $s$);
select pg_temp.ok('one president, not yet inducted',
  (select count(*) = 1 and bool_and(name = 'Harper Committee' and inducted_on is null) from public.admin_affiliation_officers()), true);
select pg_temp.works('and cleared', $s$ select public.admin_set_affiliation_officer('president', null, null) $s$);
select pg_temp.ok('no officers', (select count(*) = 0 from public.admin_affiliation_officers()), true);

select pg_temp.fails('someone not in that season is refused',
  $s$ select public.admin_set_playhq_registration('00000000-0000-0000-0000-000000000031', 2025, true) $s$);
select pg_temp.works('a registration is marked',
  $s$ select public.admin_set_playhq_registration('00000000-0000-0000-0000-000000000031', 2026, true) $s$);
select pg_temp.works('another is not registered',
  $s$ select public.admin_set_playhq_registration('00000000-0000-0000-0000-000000000032', 2026, false) $s$);
select pg_temp.works('and changed again',
  $s$ select public.admin_set_playhq_registration('00000000-0000-0000-0000-000000000032', 2026, true) $s$);
select pg_temp.ok('two registered, none not registered',
  (select registered = 2 and not_registered = 0 from public.admin_affiliation()), true);
select pg_temp.ok('the list shows each person once with their groups',
  (select count(*) = 6 and bool_and(cardinality(groups) >= 1)
     and count(*) filter (where registered and checked_by_name = 'Alex Admin') = 2
   from public.admin_playhq_registrations(2026)), true);
select pg_temp.works('an association saves with its tier',
  $s$ select public.admin_set_affiliation('association', 2, 'A9', 'Netball WA', null, null, null, '{}', null) $s$);
select pg_temp.ok('tier kept', (select tier = 2 from public.admin_affiliation()), true);
