-- Tests for 20261118100000_join_age_13.sql: nobody under 13 joins FirstPass
-- HQ this year (Matt, 18 November 2026; design tab D7, work item W11).
--
-- submit_join_request turns away a date of birth under 13, for every role a
-- person can ask for, after the club password check, and saves nothing.
-- admin_save_member won't approve anyone under 13, by the checked date or the
-- date given at join. Members already approved, and every sample member, are
-- unchanged. "Today" is the database's public.club_today(), the same date every
-- date below is worked out from, so the test means the same on any day.
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
create or replace function pg_temp.fails_with(label text, statement text, expected text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like expected then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;

-- The two dates every check turns on: the day before the 13th birthday, and
-- the birthday itself.
create or replace function pg_temp.almost_13() returns date language sql as
$$ select (public.club_today() - interval '13 years')::date + 1 $$;
create or replace function pg_temp.just_13() returns date language sql as
$$ select (public.club_today() - interval '13 years')::date $$;

create or replace function pg_temp.too_young() returns text language sql as
$$ select 'FirstPass HQ is for members aged 13 and over. If you’re a parent or guardian, enter your own date of birth.' $$;

-- Everything a join request could save, as one value.
create or replace function pg_temp.request_of(n text) returns text language sql as
$$ select concat_ws('|', full_name, playhq_email, requested_role, requested_team_id, join_requested_at,
     declared_date_of_birth, guardian_email, status, date_of_birth)
   from public.profiles where id = pg_temp.id(n) $$;

-- Every sample member as they are now, to show nobody already in the club is changed.
create temp table seed_before as
select id, status, role, extra_roles, date_of_birth, declared_date_of_birth, under_17, full_name
from public.profiles;
grant select on seed_before to public;

-- New people (no join request yet):
--   61 turned away for every role, 62 joins on their 13th birthday for every role,
--   63 tries without and then with the club password, 64 asked before this rule
--   (no date of birth), 65 was declined before, 66 for approval tests,
--   67 asked with a date at 13 that the admin found was under 13,
--   68 approved before the rule and found to be under 13.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('61'), 'too.young@example.test', now()),
  (pg_temp.id('62'), 'just.thirteen@example.test', now()),
  (pg_temp.id('63'), 'password.first@example.test', now()),
  (pg_temp.id('64'), 'old.app@example.test', now()),
  (pg_temp.id('65'), 'declined.before@example.test', now()),
  (pg_temp.id('66'), 'approval@example.test', now()),
  (pg_temp.id('67'), 'checked.younger@example.test', now()),
  (pg_temp.id('68'), 'approved.before@example.test', now());

-- ---------------------------------------------------------------------------
-- The helper
-- ---------------------------------------------------------------------------

select pg_temp.ok('is_under_13: the day before the 13th birthday', public.is_under_13(pg_temp.almost_13()), true);
select pg_temp.ok('is_under_13: the 13th birthday', public.is_under_13(pg_temp.just_13()), false);
select pg_temp.ok('is_under_13: a young child', public.is_under_13(public.club_today() - 365 * 5), true);
select pg_temp.ok('is_under_13: an adult', public.is_under_13(date '1980-01-01'), false);
select pg_temp.ok('is_under_13: no date of birth is not known, so no', public.is_under_13(null), false);
select pg_temp.ok('is_under_13: signed-out callers can''t run it',
  has_function_privilege('anon', 'public.is_under_13(date)', 'execute'), false);
select pg_temp.ok('is_under_13: members can',
  has_function_privilege('authenticated', 'public.is_under_13(date)', 'execute'), true);
select pg_temp.ok('submit_join_request: still not for signed-out callers',
  has_function_privilege('anon', 'public.submit_join_request(text, text, public.app_role, uuid, text, date, text)', 'execute'), false);
select pg_temp.ok('admin_save_member: still not for signed-out callers',
  has_function_privilege('anon', 'public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Join: turned away under 13, for every role a person can ask for
-- ---------------------------------------------------------------------------

select pg_temp.as_member('61');
create temp table before_61 as select pg_temp.request_of('61') as v;
grant select on before_61 to public;

select pg_temp.ok('join as ' || r || ', the day before the 13th birthday: turned away with the message',
  public.submit_join_request('Riley Young', 'riley@playhq.test', r::public.app_role, null, null,
    pg_temp.almost_13(), 'parent@example.test') = pg_temp.too_young(), true)
from unnest(array['athlete', 'guardian', 'coach', 'manager', 'committee', 'physio',
  'statistician', 'studio', 'guest', 'volunteer']) as r;

select pg_temp.ok('turned away: nothing saved (no name, PlayHQ email, role, date of birth or guardian email)',
  pg_temp.request_of('61') = (select v from before_61), true);
select pg_temp.ok('turned away: still pending, with no join request',
  (select status = 'pending' and join_requested_at is null and full_name is null and declared_date_of_birth is null
     and guardian_email is null and requested_role is null
   from public.profiles where id = pg_temp.id('61')), true);
select pg_temp.ok('turned away with no guardian email: the age answers, not the guardian email rule',
  public.submit_join_request('Riley Young', '', 'athlete', null, null, pg_temp.almost_13(), null) = pg_temp.too_young(), true);
select pg_temp.ok('turned away: a young child too',
  public.submit_join_request('Riley Young', '', 'athlete', null, null, public.club_today() - 365 * 7, 'parent@example.test') = pg_temp.too_young(), true);
select pg_temp.ok('turned away: a baby born today too',
  public.submit_join_request('Riley Young', '', 'athlete', null, null, public.club_today(), 'parent@example.test') = pg_temp.too_young(), true);
select pg_temp.fails_with('a date of birth in the future still doesn''t look right',
  $s$ select public.submit_join_request('Riley Young', '', 'athlete', null, null, public.club_today() + 1, 'parent@example.test') $s$,
  'That date of birth doesn%t look right');
select pg_temp.ok('still nothing saved after every refusal',
  pg_temp.request_of('61') = (select v from before_61), true);

-- A parent who typed their child's date corrects it to their own and joins.
select pg_temp.ok('a parent corrects the date to their own: the request is sent',
  public.submit_join_request('Riley Parent', 'parent@playhq.test', 'guardian', null, null, date '1985-06-01', null) is null, true);
select pg_temp.ok('the corrected request is saved',
  (select full_name = 'Riley Parent' and requested_role = 'guardian' and declared_date_of_birth = date '1985-06-01'
     and join_requested_at is not null and status = 'pending'
   from public.profiles where id = pg_temp.id('61')), true);
select pg_temp.ok('after asking, a date under 13 is still turned away',
  public.submit_join_request('Riley Young', '', 'athlete', null, null, pg_temp.almost_13(), 'parent@example.test') = pg_temp.too_young(), true);
select pg_temp.ok('and their request is unchanged',
  (select full_name = 'Riley Parent' and requested_role = 'guardian' and declared_date_of_birth = date '1985-06-01'
       from public.profiles where id = pg_temp.id('61')), true);

-- ---------------------------------------------------------------------------
-- Join: the 13th birthday itself is let in, for every role
-- ---------------------------------------------------------------------------

select pg_temp.as_member('62');
-- One statement per role, so each check sees the row the request saved.
select pg_temp.ok('join as ' || r || ' on the 13th birthday: the request is sent',
  public.submit_join_request('Sam Thirteen', 'sam@playhq.test', r::public.app_role, null, null,
    pg_temp.just_13(), 'parent@example.test') is null, true)
from unnest(array['athlete', 'guardian', 'coach', 'manager', 'committee', 'physio',
  'statistician', 'studio', 'guest', 'volunteer']) as r;
select pg_temp.ok('the last request is saved: a 13-year-old asking to help as a temporary helper',
  (select requested_role = 'volunteer' and declared_date_of_birth = pg_temp.just_13() and full_name = 'Sam Thirteen'
   from public.profiles where id = pg_temp.id('62')), true);
select pg_temp.works('join as an athlete on the 13th birthday keeps the parent''s email',
  $s$ select public.submit_join_request('Sam Thirteen', '', 'athlete', null, null, (public.club_today() - interval '13 years')::date, 'parent@example.test') $s$);
select pg_temp.ok('a 13-year-old athlete''s request is saved with their parent''s email',
  (select guardian_email = 'parent@example.test' and declared_date_of_birth = pg_temp.just_13()
   from public.profiles where id = pg_temp.id('62')), true);
select pg_temp.fails_with('a 13-year-old athlete still needs a parent''s email',
  $s$ select public.submit_join_request('Sam Thirteen', '', 'athlete', null, null, (public.club_today() - interval '13 years')::date, null) $s$,
  'Give the email of a parent or guardian%');

-- ---------------------------------------------------------------------------
-- Join: a wrong club password answers first
-- ---------------------------------------------------------------------------

select pg_temp.as_member('01');
select pg_temp.works('admin sets a club password', $s$ select public.admin_set_join_password('open sesame') $s$);
select pg_temp.as_member('63');
create temp table before_63 as select pg_temp.request_of('63') as v;
grant select on before_63 to public;
select pg_temp.ok('under 13 with a wrong club password: told about the password, not the age',
  public.submit_join_request('Pat Young', '', 'athlete', null, 'wrong', pg_temp.almost_13(), 'parent@example.test')
  = 'That club password is not right. Ask a club admin for it.', true);
select pg_temp.ok('under 13 with no club password: told about the password, not the age',
  public.submit_join_request('Pat Young', '', 'athlete', null, null, pg_temp.almost_13(), 'parent@example.test')
  = 'That club password is not right. Ask a club admin for it.', true);
select pg_temp.ok('the wrong tries are still counted',
  (select failures = 2 from public.join_password_attempts where profile_id = pg_temp.id('63')), true);
select pg_temp.ok('under 13 with the right club password: turned away for age',
  public.submit_join_request('Pat Young', '', 'athlete', null, 'open sesame', pg_temp.almost_13(), 'parent@example.test') = pg_temp.too_young(), true);
select pg_temp.ok('the right password clears the count, as before',
  not exists (select 1 from public.join_password_attempts where profile_id = pg_temp.id('63')), true);
select pg_temp.ok('nothing about them saved',
  pg_temp.request_of('63') = (select v from before_63), true);
select pg_temp.ok('13 with the right club password: the request is sent',
  public.submit_join_request('Pat Thirteen', '', 'athlete', null, 'open sesame', pg_temp.just_13(), 'parent@example.test') is null, true);
select pg_temp.as_member('01');
select pg_temp.works('admin clears the club password', $s$ select public.admin_set_join_password('') $s$);

-- ---------------------------------------------------------------------------
-- Join: older apps that send no date of birth, and a member declined before
-- ---------------------------------------------------------------------------

select pg_temp.as_member('64');
select pg_temp.ok('no date of birth: the request is sent as before',
  public.submit_join_request('Old App', '', 'studio', null, null, null, null) is null, true);
select pg_temp.ok('and saved',
  (select full_name = 'Old App' and declared_date_of_birth is null and requested_role = 'studio'
   from public.profiles where id = pg_temp.id('64')), true);

update public.profiles set status = 'rejected', full_name = 'Declined Before', requested_role = 'athlete'
where id = pg_temp.id('65');
select pg_temp.as_member('65');
select pg_temp.ok('a member declined before, now under 13: turned away',
  public.submit_join_request('Declined Again', '', 'athlete', null, null, pg_temp.almost_13(), 'parent@example.test') = pg_temp.too_young(), true);
select pg_temp.ok('and still declined, with nothing saved',
  (select status = 'rejected' and full_name = 'Declined Before' and declared_date_of_birth is null
       from public.profiles where id = pg_temp.id('65')), true);

-- An approved member who opens join again with a date under 13 changes nothing.
select pg_temp.as_member('31');
select pg_temp.ok('an approved under-18 athlete sends a date under 13: turned away',
  public.submit_join_request('Jordan Changed', '', 'athlete', null, null, pg_temp.almost_13(), 'parent@example.test') = pg_temp.too_young(), true);
select pg_temp.ok('and nothing about them changed',
  (select status = 'approved' and full_name = 'Jordan Junior' and declared_date_of_birth is null
       from public.profiles where id = pg_temp.id('31')), true);

select pg_temp.as_member('99');
select pg_temp.fails_with('signed-out or unknown callers are refused as before',
  $s$ select public.submit_join_request('Nobody', '', 'athlete', null, null, (public.club_today() - interval '13 years')::date + 1, 'p@example.test') $s$,
  'Confirm your email address%');

-- ---------------------------------------------------------------------------
-- Approval: an admin can't approve anyone under 13
-- ---------------------------------------------------------------------------

-- 66 asked before this rule with a date under 13 (the old app let it through).
update public.profiles
set full_name = 'Quinn Young', requested_role = 'athlete', join_requested_at = now(),
    declared_date_of_birth = pg_temp.almost_13(), guardian_email = 'parent@example.test'
where id = pg_temp.id('66');

select pg_temp.as_member('01');
select pg_temp.fails_with('admin approves as ' || r || ' someone who said at join they''re under 13: refused',
  format($s$ select public.admin_save_member(%L, %L, 'approved') $s$, pg_temp.id('66'), r),
  'They''re under 13. FirstPass HQ is for members aged 13 and over, so decline their request')
from unnest(array['athlete', 'guardian', 'coach', 'manager', 'committee', 'physio',
  'statistician', 'studio', 'guest', 'volunteer']) as r;
select pg_temp.fails_with('as athlete and coach together: refused',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved', p_extra_roles => '{coach}') $s$, pg_temp.id('66')),
  'They''re under 13%');
select pg_temp.ok('still pending after every refusal',
  (select status = 'pending' from public.profiles where id = pg_temp.id('66')), true);

-- The admin checks the date and records it: still under 13.
select pg_temp.works('admin records the date they checked, under 13',
  format($s$ select public.admin_set_member_details(%L, %L, null, null) $s$, pg_temp.id('66'), pg_temp.almost_13()));
select pg_temp.fails_with('approving by the checked date under 13: refused',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('66')),
  'They''re under 13%');
-- The checked date says 13, the join date said under 13: still refused.
select pg_temp.works('admin records a checked date of 13',
  format($s$ select public.admin_set_member_details(%L, %L, null, null) $s$, pg_temp.id('66'), pg_temp.just_13()));
select pg_temp.fails_with('checked date 13 but join date under 13: refused',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('66')),
  'They''re under 13%');
select pg_temp.works('the admin declines the request, as the message says',
  format($s$ select public.admin_save_member(%L, 'athlete', 'rejected', p_rejection_reason => 'other') $s$, pg_temp.id('66')));
select pg_temp.ok('declined',
  (select status = 'rejected' from public.profiles where id = pg_temp.id('66')), true);
select pg_temp.works('saving them as pending again works',
  format($s$ select public.admin_save_member(%L, 'athlete', 'pending') $s$, pg_temp.id('66')));

-- 67 said at join they're 13; the admin checks and finds they're 12.
select pg_temp.as_member('67');
select pg_temp.works('a 13-year-old by their own date asks to join',
  $s$ select public.submit_join_request('Rowan Checked', '', 'athlete', null, null, (public.club_today() - interval '13 years')::date, 'parent@example.test') $s$);
select pg_temp.as_member('01');
select pg_temp.works('admin records the checked date, under 13',
  format($s$ select public.admin_set_member_details(%L, %L, null, null) $s$, pg_temp.id('67'), pg_temp.almost_13()));
select pg_temp.fails_with('approving by the checked date under 13: refused, though the join date was 13',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('67')),
  'They''re under 13%');

-- 62 asked on their 13th birthday (as an athlete, last of all).
select pg_temp.works('admin records the checked date of 13',
  format($s$ select public.admin_set_member_details(%L, %L, null, null) $s$, pg_temp.id('62'), pg_temp.just_13()));
select pg_temp.works('approving a 13-year-old athlete works (locked until a parent is linked, as before)',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('62')));
select pg_temp.ok('approved',
  (select status = 'approved' from public.profiles where id = pg_temp.id('62')), true);
select pg_temp.ok('a 13-year-old is still an under-18 athlete',
  (select under_17 from public.profiles where id = pg_temp.id('62')), true);

-- 64 asked with no date of birth: other roles are approved as before.
select pg_temp.works('approving a member with no date of birth as a Studio operator works as before',
  format($s$ select public.admin_save_member(%L, 'studio', 'approved') $s$, pg_temp.id('64')));

-- Only admins approve anyone, as before.
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach can''t approve, whatever the age',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('62')),
  'Only admins can change members');
select pg_temp.as_member('22');
select pg_temp.fails_with('a committee member can''t approve',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('67')),
  'Only admins can change members');
select pg_temp.as_member('41');
select pg_temp.fails_with('a guardian can''t approve',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('67')),
  'Only admins can change members');
select pg_temp.as_member('02');
select pg_temp.fails_with('the other admin is refused too',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('67')),
  'They''re under 13%');

-- ---------------------------------------------------------------------------
-- Nobody already approved is changed
-- ---------------------------------------------------------------------------

-- 68 was approved before the rule, and their date shows they're under 13.
update public.profiles
set status = 'approved', role = 'athlete', full_name = 'Avery Before', under_17 = true,
    date_of_birth = pg_temp.almost_13(), verified_at = now()
where id = pg_temp.id('68');
select pg_temp.as_member('01');
select pg_temp.works('an admin re-saves a member approved before the rule: kept',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('68')));
select pg_temp.ok('still approved',
  (select status = 'approved' from public.profiles where id = pg_temp.id('68')), true);
select pg_temp.works('an admin can still decline them',
  format($s$ select public.admin_save_member(%L, 'athlete', 'rejected', p_rejection_reason => 'other') $s$, pg_temp.id('68')));
select pg_temp.fails_with('but once declined, can''t approve them again',
  format($s$ select public.admin_save_member(%L, 'athlete', 'approved') $s$, pg_temp.id('68')),
  'They''re under 13%');

select pg_temp.ok('every sample member is unchanged',
  not exists (
    select 1 from seed_before b
    join public.profiles p on p.id = b.id
    where (p.status, p.role, p.extra_roles, p.date_of_birth, p.declared_date_of_birth, p.under_17, p.full_name)
      is distinct from (b.status, b.role, b.extra_roles, b.date_of_birth, b.declared_date_of_birth, b.under_17, b.full_name)
  ), true);
select pg_temp.ok('no sample member is gone',
  (select count(*) from seed_before b join public.profiles p on p.id = b.id) = (select count(*) from seed_before), true);
