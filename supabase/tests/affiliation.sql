-- Tests for 20261013093000_affiliation.sql and 20261106120000_affiliation_club_only.sql
-- (affiliation records are for clubs only; association records came out). Run on a fresh database with the
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
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.fails('a coach can''t mark a registration',
  $s$ select public.admin_set_playhq_registration('00000000-0000-0000-0000-000000000031', 2026, true) $s$);
select pg_temp.ok('a coach sees no registrations', (select count(*) = 0 from public.admin_playhq_registrations(2026)), true);

select pg_temp.as_member('01');
select pg_temp.ok('starts with nothing recorded, season 2026, one team, six people to check',
  (select incorporation_number is null and season = 2026 and team_count = 1
     and registrations_total = 6 and registered = 0 and not_registered = 0
   from public.admin_affiliation()), true);
select pg_temp.fails('a child can''t be a primary contact',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', current_date, '00000000-0000-0000-0000-000000000031', null, '{}', null) $s$);
select pg_temp.fails('the same person twice is refused',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', current_date, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '{}', null) $s$);
select pg_temp.fails('a future date is refused',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', current_date + 1, null, null, '{}', null) $s$);
select pg_temp.fails('checks must be ticks',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{"compliance": "yes"}', null) $s$);
select pg_temp.works('a club saves',
  $s$ select public.admin_set_affiliation(' A1234 ', 'Sample Netball Association', current_date - 10,
        '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', '{"compliance": true}', 'note') $s$);
select pg_temp.ok('the details are trimmed and named',
  (select incorporation_number = 'A1234' and primary_contact_2_name = 'Emery Manager'
     and (checks ->> 'compliance')::boolean and updated_by_name = 'Alex Admin'
   from public.admin_affiliation()), true);

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

-- Association records came out on 6 November 2026. What was saved stays in
-- the tables, and nothing the app can call reads or changes it.
update public.affiliation_settings set member_type = 'association', tier = 2 where id;
insert into public.affiliation_officers (office, profile_id, inducted_on)
values ('president', '00000000-0000-0000-0000-000000000021', current_date - 30);
select pg_temp.as_member('01');
select pg_temp.ok('the record no longer has a type or tier',
  (select count(*) = 0 from information_schema.routines r
   join information_schema.parameters x on x.specific_name = r.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'admin_affiliation'
     and x.parameter_name in ('member_type', 'tier')), true);
select pg_temp.fails('the old save with a type and tier is gone',
  $s$ select public.admin_set_affiliation('association', 2, 'A9', 'Netball WA', null, null, null, '{}', null) $s$);
select pg_temp.fails('officers can''t be read', $s$ select * from public.admin_affiliation_officers() $s$);
select pg_temp.fails('officers can''t be named',
  $s$ select public.admin_set_affiliation_officer('president', '00000000-0000-0000-0000-000000000021', null) $s$);
select pg_temp.works('an admin still saves the club record',
  $s$ select public.admin_set_affiliation('A9', 'Sample Netball Association', null, null, null, '{}', null) $s$);
select pg_temp.ok('saving leaves the saved type and tier as they were',
  (select member_type = 'association' and tier = 2 and incorporation_number = 'A9'
   from public.affiliation_settings where id), true);
select pg_temp.ok('and the saved officer',
  (select count(*) = 1 from public.affiliation_officers), true);

-- Every kind of member but an admin is refused, both ways.
select pg_temp.as_member('11');
select pg_temp.ok('a current coach sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a current coach can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('12');
select pg_temp.ok('a lapsed coach sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a lapsed coach can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('13');
select pg_temp.ok('a manager sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a manager can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('14');
select pg_temp.ok('a physio sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a physio can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a committee member can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('23');
select pg_temp.ok('a exempt committee member sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a exempt committee member can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('31');
select pg_temp.ok('a child athlete sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a child athlete can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('32');
select pg_temp.ok('a adult athlete sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a adult athlete can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('41');
select pg_temp.ok('a guardian sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a guardian can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('42');
select pg_temp.ok('a coach who is a parent sees no record', (select count(*) = 0 from public.admin_affiliation()), true);
select pg_temp.fails('a coach who is a parent can''t save it',
  $s$ select public.admin_set_affiliation('A1', 'Assoc', null, null, null, '{}', null) $s$);
select pg_temp.as_member('02');
select pg_temp.ok('another admin sees it', (select count(*) = 1 from public.admin_affiliation()), true);
select pg_temp.works('and saves it',
  $s$ select public.admin_set_affiliation('A9', 'Sample Netball Association', null, null, null, '{}', null) $s$);
