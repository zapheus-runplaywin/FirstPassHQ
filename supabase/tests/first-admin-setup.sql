-- Tests for 20261119000000_first_admin_setup_code.sql: a new club's first
-- admin uses a one-time setup code instead of a database script (Matt, 18
-- November 2026).
--
-- Who may make a code (only the database's own sign-in, never an app role),
-- who may use one (a signed-in person, only while the club has no approved
-- admin), what a right code changes (that person alone becomes an approved
-- admin, the code is spent), and what a wrong, expired, cancelled or reused
-- code changes (nothing but the count of wrong tries). Every kind of member
-- in a running club is refused and unchanged.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.signed_out() returns void language sql as
$$ select set_config('request.jwt.claim.sub', '', false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, expected text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like expected then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.wrong() returns text language sql as
$$ select 'That setup code isn’t right, or it has expired. Check it with FirstPass.' $$;
create or replace function pg_temp.has_admin_already() returns text language sql as
$$ select 'This club already has an admin. Ask to join below and they’ll approve you.' $$;
-- Everyone's access, as one value, to show who changed.
create or replace function pg_temp.access() returns text language sql as
$$ select string_agg(concat_ws('|', id, role, extra_roles, status, full_name), ';' order by id) from public.profiles $$;
create or replace function pg_temp.access_except(n text) returns text language sql as
$$ select string_agg(concat_ws('|', id, role, extra_roles, status, full_name), ';' order by id)
   from public.profiles where id <> pg_temp.id(n) $$;

-- New people who have only signed in: 71 becomes the first admin, 72 has the
-- code too, 73 guesses, 74 hasn't confirmed their email, 75 was declined.
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('71'), 'first.admin@example.test', now()),
  (pg_temp.id('72'), 'second.person@example.test', now()),
  (pg_temp.id('73'), 'guesser@example.test', now()),
  (pg_temp.id('74'), 'unconfirmed@example.test', null),
  (pg_temp.id('75'), 'declined@example.test', now());
update public.profiles set status = 'rejected', rejection_reason = 'not_registered'
where id = pg_temp.id('75');

-- ---------------------------------------------------------------------------
-- Who may run what
-- ---------------------------------------------------------------------------

select pg_temp.ok('issue_first_admin_code: not for ' || r,
  has_function_privilege(r, 'public.issue_first_admin_code(integer)', 'execute'), false)
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.ok('club_has_admin: not for ' || r,
  has_function_privilege(r, 'public.club_has_admin()', 'execute'), false)
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.ok('claim_first_admin: not for signed-out callers',
  has_function_privilege('anon', 'public.claim_first_admin(text, text)', 'execute'), false);
select pg_temp.ok('claim_first_admin: for signed-in people',
  has_function_privilege('authenticated', 'public.claim_first_admin(text, text)', 'execute'), true);
select pg_temp.ok('first_admin_setup_open: not for signed-out callers',
  has_function_privilege('anon', 'public.first_admin_setup_open()', 'execute'), false);
select pg_temp.ok('first_admin_setup_open: for signed-in people',
  has_function_privilege('authenticated', 'public.first_admin_setup_open()', 'execute'), true);
select pg_temp.ok('the codes table is closed to ' || r,
  has_table_privilege(r, 'public.club_setup_codes', 'select,insert,update,delete'), false)
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.ok('the wrong-tries table is closed to ' || r,
  has_table_privilege(r, 'public.club_setup_code_attempts', 'select,insert,update,delete'), false)
from unnest(array['anon', 'authenticated']) as r;

-- ---------------------------------------------------------------------------
-- A running club (the sample club has two admins): no code, for anyone
-- ---------------------------------------------------------------------------

create temp table running as select pg_temp.access() as v;
select pg_temp.fails_with('a club with an admin: no code can be made',
  'select public.issue_first_admin_code()', 'This club already has an admin%');
select pg_temp.ok('a club with an admin: no code was saved',
  (select count(*) = 0 from public.club_setup_codes), true);

-- Even if a code were left over from before the club had an admin.
insert into public.club_setup_codes (code_hash, expires_at)
values (encode(sha256(convert_to('LEFTLEFTLEFT', 'UTF8')), 'hex'), now() + interval '7 days');

select pg_temp.as_member(m.n),
  pg_temp.ok(m.who || ': setup isn''t offered in a running club', public.first_admin_setup_open(), false),
  pg_temp.ok(m.who || ': a leftover code is refused in a running club',
    public.claim_first_admin('LEFT-LEFT-LEFT', 'Someone') = pg_temp.has_admin_already(), true)
from (values
  ('01', 'an admin'), ('11', 'a coach'), ('12', 'a coach with an expired check'), ('13', 'a manager'),
  ('14', 'a physio'), ('21', 'a committee member'), ('31', 'an athlete under 18'), ('32', 'an adult athlete'),
  ('41', 'a guardian'), ('42', 'a coach who is a guardian'), ('71', 'someone who just signed in'),
  ('75', 'someone declined')
) as m(n, who);
select pg_temp.ok('a running club: nobody''s access changed', pg_temp.access() = (select v from running), true);
select pg_temp.ok('a running club: the leftover code is unused',
  (select count(*) = 1 from public.club_setup_codes where used_at is null), true);
select pg_temp.ok('a running club: refusals for having an admin aren''t counted as wrong codes',
  (select count(*) = 0 from public.club_setup_code_attempts), true);

select pg_temp.signed_out();
select pg_temp.fails_with('signed out: can''t use a code', $$select public.claim_first_admin('LEFT-LEFT-LEFT', 'Someone')$$, 'Not signed in');
select pg_temp.ok('signed out: setup isn''t offered', public.first_admin_setup_open(), false);

-- ---------------------------------------------------------------------------
-- A new club: nobody approved as admin yet
-- ---------------------------------------------------------------------------

delete from public.club_setup_codes;
-- The sample club's admins step back to members, so the club has no admin.
-- An admin who is only waiting, or was declined, doesn't count as one.
update public.profiles set role = 'guest' where id = pg_temp.id('01');
update public.profiles set status = 'pending' where id = pg_temp.id('02');
create temp table fresh as select pg_temp.access() as v;

select pg_temp.as_member('71');
select pg_temp.ok('no code made yet: setup isn''t offered', public.first_admin_setup_open(), false);
select pg_temp.ok('no code made yet: any code is wrong',
  public.claim_first_admin('AAAA-BBBB-CCCC', 'Sam First') = pg_temp.wrong(), true);
delete from public.club_setup_code_attempts;

select pg_temp.fails_with('a code can''t last 0 days', 'select public.issue_first_admin_code(0)', '%between 1 and 30 days');
select pg_temp.fails_with('a code can''t last 31 days', 'select public.issue_first_admin_code(31)', '%between 1 and 30 days');
select pg_temp.fails_with('a code needs a number of days', 'select public.issue_first_admin_code(null)', '%between 1 and 30 days');

create temp table codes(name text primary key, code text);
insert into codes values ('first', public.issue_first_admin_code());
select pg_temp.ok('a code looks like XXXX-XXXX-XXXX, without letters that look alike',
  (select code ~ '^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$' from codes where name = 'first'), true);
select pg_temp.ok('the code itself isn''t stored, only its hash',
  (select count(*) = 0 from public.club_setup_codes c, codes
   where c.code_hash like '%' || replace(codes.code, '-', '') || '%' or c.code_hash = codes.code), true);
select pg_temp.ok('a code lasts 7 days unless told otherwise',
  (select expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days'
   from public.club_setup_codes where cancelled_at is null), true);
select pg_temp.ok('with a code waiting: setup is offered to someone signed in', public.first_admin_setup_open(), true);
select pg_temp.signed_out();
select pg_temp.ok('with a code waiting: still not offered signed out', public.first_admin_setup_open(), false);

-- A newer code cancels the last one.
insert into codes values ('second', public.issue_first_admin_code(3));
select pg_temp.ok('a new code cancels the last: one open code',
  (select count(*) = 1 from public.club_setup_codes where used_at is null and cancelled_at is null), true);
select pg_temp.ok('the new code lasts the days asked for',
  (select expires_at between now() + interval '3 days' - interval '1 minute' and now() + interval '3 days'
   from public.club_setup_codes where cancelled_at is null), true);
select pg_temp.as_member('71');
select pg_temp.ok('the cancelled code is refused',
  public.claim_first_admin((select code from codes where name = 'first'), 'Sam First') = pg_temp.wrong(), true);

-- What has to be right before the code is even looked at.
select pg_temp.fails_with('no name: refused', format('select public.claim_first_admin(%L, %L)', (select code from codes where name = 'second'), '  '), 'Name is required');
select pg_temp.fails_with('a name over 80 characters: refused', format('select public.claim_first_admin(%L, %L)', (select code from codes where name = 'second'), repeat('a', 81)), 'Keep your name to 80 characters');
select pg_temp.as_member('74');
select pg_temp.fails_with('an unconfirmed email: refused, even with the right code',
  format('select public.claim_first_admin(%L, %L)', (select code from codes where name = 'second'), 'Una Confirmed'), 'Confirm your email address%');

-- Wrong codes: five in an hour, then locked out, even with the right code.
select pg_temp.as_member('73');
select pg_temp.ok('wrong code ' || n || ': refused with the message',
  public.claim_first_admin('WRNG-WRNG-WRN' || n, 'Gus Guesser') = pg_temp.wrong(), true)
from generate_series(1, 5) as n;
select pg_temp.ok('after five wrong codes: locked out, even with the right code',
  public.claim_first_admin((select code from codes where name = 'second'), 'Gus Guesser') like 'Too many wrong codes. Try again in % minutes.', true);
select pg_temp.ok('locked out: the wait is at most the hour',
  (select substring(public.claim_first_admin('x', 'Gus Guesser') from '(\d+) minutes')::int between 1 and 60), true);
select pg_temp.ok('locked out: tries while locked out aren''t added to the count',
  (select count(*) = 5 from public.club_setup_code_attempts where profile_id = pg_temp.id('73')), true);
-- An hour later the guesser may try again.
update public.club_setup_code_attempts set attempted_at = attempted_at - interval '61 minutes'
where profile_id = pg_temp.id('73');
select pg_temp.ok('an hour later: the guesser is asked for the code again',
  public.claim_first_admin('WRNG-WRNG-WRNG', 'Gus Guesser') = pg_temp.wrong(), true);
select pg_temp.ok('nothing so far changed anyone''s access', pg_temp.access() = (select v from fresh), true);
select pg_temp.ok('nothing so far used the code',
  (select count(*) = 1 from public.club_setup_codes where used_at is null and cancelled_at is null), true);

-- An expired code.
update public.club_setup_codes set expires_at = now() - interval '1 second' where cancelled_at is null;
select pg_temp.as_member('71');
select pg_temp.ok('an expired code: setup isn''t offered', public.first_admin_setup_open(), false);
select pg_temp.ok('an expired code is refused',
  public.claim_first_admin((select code from codes where name = 'second'), 'Sam First') = pg_temp.wrong(), true);
select pg_temp.ok('an expired code: nobody''s access changed', pg_temp.access() = (select v from fresh), true);

-- The right code: typed in lower case with spaces, as people do.
insert into codes values ('third', public.issue_first_admin_code());
select pg_temp.ok('the right code, in lower case with spaces: accepted',
  public.claim_first_admin(' ' || lower(replace((select code from codes where name = 'third'), '-', ' ')) || ' ', '  Sam First ') is null, true);
select pg_temp.ok('the first admin: an approved admin, under the name they gave',
  (select role = 'admin' and status = 'approved' and full_name = 'Sam First' and extra_roles = '{}'
   from public.profiles where id = pg_temp.id('71')), true);
select pg_temp.ok('the first admin passes the app''s admin check', public.is_admin(), true);
select pg_temp.ok('nobody else changed', pg_temp.access_except('71') = (
  select string_agg(part, ';') from regexp_split_to_table((select v from fresh), ';') part
  where part not like pg_temp.id('71') || '%'), true);
select pg_temp.ok('the code is spent, by them',
  (select count(*) = 1 from public.club_setup_codes
   where used_at is not null and used_by = pg_temp.id('71')), true);
select pg_temp.ok('no code is left open',
  (select count(*) = 0 from public.club_setup_codes where used_at is null and cancelled_at is null and expires_at > now()), true);
select pg_temp.ok('their wrong tries are cleared',
  (select count(*) = 0 from public.club_setup_code_attempts where profile_id = pg_temp.id('71')), true);
select pg_temp.ok('setup is no longer offered', public.first_admin_setup_open(), false);

-- The same code again, by a second person: the club has its admin.
select pg_temp.as_member('72');
select pg_temp.ok('the same code, a second person: refused, the club has an admin',
  public.claim_first_admin((select code from codes where name = 'third'), 'Second Person') = pg_temp.has_admin_already(), true);
select pg_temp.ok('the second person is still waiting, not an admin',
  (select role = 'guest' and status = 'pending' from public.profiles where id = pg_temp.id('72')), true);
select pg_temp.fails_with('and no new code can be made', 'select public.issue_first_admin_code()', 'This club already has an admin%');

-- A used code never works again, even if the club were left with no admin.
update public.profiles set role = 'guest' where id = pg_temp.id('71');
select pg_temp.ok('a spent code, with no admin again: still refused',
  public.claim_first_admin((select code from codes where name = 'third'), 'Second Person') = pg_temp.wrong(), true);

-- Someone declined before can still be the first admin of a club with none,
-- and an admin by extra role counts as the club's admin.
insert into codes values ('fourth', public.issue_first_admin_code());
select pg_temp.as_member('75');
select pg_temp.ok('someone declined earlier, with the right code: accepted',
  public.claim_first_admin((select code from codes where name = 'fourth'), 'Dee Clined') is null, true);
select pg_temp.ok('they are an approved admin, with the decline reason cleared',
  (select role = 'admin' and status = 'approved' and rejection_reason is null
   from public.profiles where id = pg_temp.id('75')), true);
update public.profiles set role = 'coach', extra_roles = '{admin}' where id = pg_temp.id('75');
select pg_temp.fails_with('an admin by extra role counts: no new code', 'select public.issue_first_admin_code()', 'This club already has an admin%');
