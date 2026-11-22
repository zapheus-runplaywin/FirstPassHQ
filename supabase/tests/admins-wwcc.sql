-- Tests for 20261013040000_admins_need_wwcc.sql. Run on a fresh database with the
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

-- The rule.
select pg_temp.ok('an admin needs a check', public.needs_wwcc('{admin}', null), true);
select pg_temp.ok('an admin with a reason is exempt', public.needs_wwcc('{admin}', 'Runs the books only'), false);
select pg_temp.ok('an admin who coaches needs one whatever the reason', public.needs_wwcc('{admin,coach}', 'Runs the books'), true);
select pg_temp.ok('committee unchanged', public.needs_wwcc('{committee}', null), true);
select pg_temp.ok('a guardian still needs none', public.needs_wwcc('{guardian}', null), false);

-- Blair (admin, no check) was approved before the rule.
select pg_temp.as_member('02');
select pg_temp.ok('an existing admin without a check keeps admin access', public.is_admin(), true);
select pg_temp.as_member('01');
select pg_temp.ok('the to-do list counts the admin with no check (expired coach, expired and missing committee, admin)',
  (select wwcc_missing = 4 from public.admin_safety_todos()), true);
select pg_temp.works('re-saving an existing admin without a check still works',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000002', 'admin', 'approved') $s$);

-- New admins.
select pg_temp.fails('making someone a new admin without a check is refused',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000041', 'admin', 'approved', '[]', false, '{}', null, '{guardian}') $s$);
select pg_temp.ok('they are still a guardian only',
  (select role = 'guardian' from public.profiles where id = '00000000-0000-0000-0000-000000000041'), true);
select pg_temp.works('with a current check they can be made an admin',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000041', null, 'WWC0041', public.club_today() + 400);
      select public.admin_save_member('00000000-0000-0000-0000-000000000041', 'admin', 'approved', '[]', false, '{}', null, '{guardian}') $s$);
select pg_temp.fails('a new admin with an expired check is refused, even if already on the committee',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000022', null, 'WWC0022', public.club_today() - 1);
      select public.admin_save_member('00000000-0000-0000-0000-000000000022', 'admin', 'approved', '[]', false, '{}', null, '{committee}') $s$);
select pg_temp.works('a committee member exempted with a reason can be made an admin',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000023', 'admin', 'approved', '[]', false, '{}', null, '{committee}') $s$);
select pg_temp.ok('they are an admin and committee member, still exempt with their reason',
  (select wwcc_exempt_reason = 'Treasurer only' and 'committee' = any (extra_roles) and role = 'admin'
   from public.profiles where id = '00000000-0000-0000-0000-000000000023'), true);

-- Exemptions for admins.
select pg_temp.as_member('02');
select pg_temp.fails('an admin cannot exempt themselves',
  $s$ select public.admin_set_wwcc_exemption('00000000-0000-0000-0000-000000000002', 'Office only') $s$);
select pg_temp.as_member('01');
select pg_temp.works('another admin exempts them',
  $s$ select public.admin_set_wwcc_exemption('00000000-0000-0000-0000-000000000002', 'Office only') $s$);
select pg_temp.ok('the to-do list no longer counts them',
  (select wwcc_missing = 3 from public.admin_safety_todos()), true);
select pg_temp.works('taking the exemption away',
  $s$ select public.admin_set_wwcc_exemption('00000000-0000-0000-0000-000000000002', '') $s$);
select pg_temp.ok('and they are counted again',
  (select wwcc_missing = 4 from public.admin_safety_todos()), true);

-- An expired check never locks the club out.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = '00000000-0000-0000-0000-000000000001';
select pg_temp.ok('an admin whose check expired is still an admin', public.is_admin(), true);
select pg_temp.ok('and shows on the to-do list',
  (select wwcc_missing = 5 from public.admin_safety_todos()), true);
select pg_temp.fails('they cannot record their own renewed card',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000001', null, 'WWC0001B', public.club_today() + 700) $s$);
select pg_temp.as_member('02');
select pg_temp.works('another admin records their renewed card',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000001', null, 'WWC0001B', public.club_today() + 700) $s$);
select pg_temp.as_member('01');
select pg_temp.ok('and the to-do clears',
  (select wwcc_missing = 4 from public.admin_safety_todos()), true);

-- A stand-down still pauses an admin.
select pg_temp.works('standing an admin down',
  $s$ select public.admin_stand_down('00000000-0000-0000-0000-000000000041', 'allegation', null) $s$);
select pg_temp.as_member('41');
select pg_temp.ok('a stood-down admin is not an admin', public.is_admin(), false);

-- Committee rule unchanged.
select pg_temp.as_member('01');
select pg_temp.fails('a new committee member still needs a check',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000032', 'committee', 'approved', '[]', false, '{}', null, '{athlete}') $s$);
