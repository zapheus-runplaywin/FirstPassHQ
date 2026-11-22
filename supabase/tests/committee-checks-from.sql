-- Tests for 20261013150000_committee_checks_from.sql. Run on a fresh database
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

-- Default: 90 days after the migration ran.
-- The migration that added it filled it in from the UTC day it ran (current_date).
select pg_temp.ok('date defaults to 90 days ahead',
  (select committee_checks_from = current_date + 90 from public.safeguarding_settings where id), true);

-- Before the date
select pg_temp.as_member('22');
select pg_temp.ok('committee with no check keeps the role before the date',
  (select public.has_role('committee')), true);
select pg_temp.ok('and still counts as committee',
  (select public.is_committee()), true);
select pg_temp.as_member('21');
select pg_temp.ok('expired check still pauses committee',
  (select public.has_role('committee')), false);
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee member keeps the role',
  (select public.has_role('committee')), true);
select pg_temp.as_member('22');
select pg_temp.ok('member can read the date',
  (select public.committee_checks_from() = current_date + 90), true);

-- Changing the date
select pg_temp.fails('committee cannot change the date',
  $$select public.admin_set_committee_checks_from(public.club_today())$$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot push the date back',
  $$select public.admin_set_committee_checks_from(public.club_today() + 200)$$);
select pg_temp.fails('admin cannot clear the date',
  $$select public.admin_set_committee_checks_from(null)$$);
select pg_temp.works('admin brings the date forward to today',
  $$select public.admin_set_committee_checks_from(public.club_today())$$);
select pg_temp.ok('who changed it is kept',
  (select updated_by = '00000000-0000-0000-0000-000000000001' from public.safeguarding_settings where id), true);

-- From the date
select pg_temp.as_member('22');
select pg_temp.ok('committee with no check is paused from the date',
  (select public.has_role('committee')), false);
select pg_temp.ok('and no longer counts as committee',
  (select public.is_committee()), false);
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee member still keeps the role',
  (select public.has_role('committee')), true);
select pg_temp.as_member('22');

-- A check brings the role back
reset role;
update public.profiles set wwcc_number = 'WWC0022', wwcc_expires_on = public.club_today() + 365
  where id = '00000000-0000-0000-0000-000000000022';
select pg_temp.ok('a current check brings the role back',
  (select public.has_role('committee')), true);

-- Admins aren't affected
select pg_temp.as_member('01');
select pg_temp.ok('admin role unchanged',
  (select public.has_role('admin')), true);

-- Coaches are unchanged
select pg_temp.as_member('12');
select pg_temp.ok('coach with expired check still paused',
  (select public.has_role('coach')), false);
select pg_temp.as_member('11');
select pg_temp.ok('coach with current check still active',
  (select public.has_role('coach')), true);
