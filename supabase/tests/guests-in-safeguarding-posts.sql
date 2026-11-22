-- Tests for 20261121410000_guests_in_safeguarding_posts.sql: an adult guest
-- with a current check can be named Child Safety Officer or Complaints
-- Manager and acts like any other holder; a guest without a check, a
-- temporary helper and a guest as WWC Registration Officer can't. Run on a
-- fresh database with the migrations and seed-members.sql loaded. Prints one
-- line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

-- Quinn (81): an adult guest with a current check. Remy (82): an adult guest
-- with none. Sky (83): a temporary helper with a current check.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000081', 'guest.checked@example.test', now()),
  ('00000000-0000-0000-0000-000000000082', 'guest.unchecked@example.test', now()),
  ('00000000-0000-0000-0000-000000000083', 'helper.checked@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, date_of_birth = public.club_today() - interval '40 years',
  verified_at = now(), volunteer_task = v.task, volunteer_from = v.vfrom, volunteer_until = v.vuntil
from (values
  ('00000000-0000-0000-0000-000000000081', 'Quinn Guest', 'guest', 'WWC0081', public.club_today() + 400, null, null::date, null::date),
  ('00000000-0000-0000-0000-000000000082', 'Remy Guest', 'guest', null, null, null, null, null),
  ('00000000-0000-0000-0000-000000000083', 'Sky Helper', 'volunteer', 'WWC0083', public.club_today() + 400, 'Bench help', public.club_today(), public.club_today() + 5)
) as v(id, name, role, wwcc, exp, task, vfrom, vuntil)
where p.id = v.id::uuid;

select pg_temp.as_member('01');
select pg_temp.fails('a guest without a check can''t be named',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('82')], null, null, null, null, null) $s$);
select pg_temp.fails('a temporary helper with a check still can''t',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11'), pg_temp.id('83')], null, null, null, null, null) $s$);
select pg_temp.fails('a guest can''t be WWC Registration Officer (admins and committee only)',
  $s$ select public.admin_set_wwc_officers(array[pg_temp.id('81')]) $s$);
select pg_temp.works('a guest with a current check is named Child Safety Officer',
  $s$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('81')], array[pg_temp.id('13')], null, null, null, null) $s$);
select pg_temp.ok('they hold the post', (select count(*) = 1 from public.safeguarding_post_holders where post = 'child_safety_officer' and profile_id = pg_temp.id('81')), true);

select pg_temp.as_member('32');
select pg_temp.works('an athlete raises a concern', $s$ select public.raise_concern('Something at training worried me') $s$);

select pg_temp.as_member('81');
select pg_temp.ok('the guest acts as a safeguarding officer', public.is_safeguarding_officer(), true);
select pg_temp.ok('and as Child Safety Officer', public.is_child_safety_officer(), true);
select pg_temp.ok('their title shows', (select child_safety_officer from public.my_safeguarding_posts()), true);
select pg_temp.ok('they see the concern in the register', (select count(*) = 1 from public.concern_register()), true);

-- Their check lapses: still named, but can't act.
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('81');
select pg_temp.ok('a lapsed check stops them acting', public.is_safeguarding_officer(), false);
select pg_temp.ok('nor see the register', (select count(*) = 0 from public.concern_register()), true);
select pg_temp.ok('but they stay named', (select count(*) = 1 from public.safeguarding_post_holders where profile_id = pg_temp.id('81')), true);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('81');
select pg_temp.ok('renewed, they act again', public.is_safeguarding_officer(), true);

-- Ordinary guests are unaffected.
select pg_temp.as_member('82');
select pg_temp.ok('a guest with no post is no safeguarding officer', public.is_safeguarding_officer(), false);
select pg_temp.ok('and sees nothing in the register', (select count(*) = 0 from public.concern_register()), true);

-- Sending in their own card: optional for guests, still checked by an admin.
select pg_temp.as_member('82');
select pg_temp.works('a guest can send in their own card',
  $s$ select public.submit_my_wwcc('WWC0082', public.club_today() + 300, 'Remy Guest') $s$);
reset role;
select pg_temp.ok('it waits for an admin and counts for nothing yet',
  (select count(*) = 1 from public.wwcc_submissions where profile_id = pg_temp.id('82') and status = 'waiting')
  and not public.can_be_safeguarding_contact(pg_temp.id('82')), true);
select pg_temp.as_member('83');
select pg_temp.works('a temporary helper still can, as before',
  $s$ select public.submit_my_wwcc('WWC0093', public.club_today() + 300, 'Sky Helper') $s$);
select pg_temp.as_member('41');
select pg_temp.fails('a parent, whose roles need no check, still can''t',
  $s$ select public.submit_my_wwcc('WWC0041', public.club_today() + 300, 'Logan Parent') $s$);
