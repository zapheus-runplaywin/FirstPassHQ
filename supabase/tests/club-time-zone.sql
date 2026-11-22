-- Tests for 20261122300000_club_time_zone.sql: one rule for the club's
-- calendar day. Moments stay in UTC; "today" is the club's day, in the time
-- zone an admin chose in Club settings (Perth unless changed).
--
-- The database clock can't be moved inside a test, so the club is moved
-- instead. Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours apart, so
-- at any moment their days differ, and Kiritimati's is always the later one.
-- A function that still used the UTC day, or Perth's, would give the same
-- answer in both; one that follows the club gives different answers. Moments
-- near the club's midnight are checked with club_day(moment), which every
-- "today" uses. Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.as_nobody() returns void language sql as
$$ select set_config('request.jwt.claim.sub', '', false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label; end $$;
-- Moves the club, as the database owner would (admins use the function).
create or replace function pg_temp.club_in(tz text) returns void language sql as
$$ update public.club_settings set timezone = tz where id $$;

-- ---------------------------------------------------------------------------
-- The helpers
-- ---------------------------------------------------------------------------
select pg_temp.ok('the club is in Perth unless an admin changes it', public.club_timezone() = 'Australia/Perth', true);
select pg_temp.ok('today is the club''s day now', public.club_today() = public.club_day(now()), true);
select pg_temp.ok('which is Perth''s day', public.club_today() = (now() at time zone 'Australia/Perth')::date, true);

-- Perth's midnight is 4 pm UTC. The UTC day hasn't changed; the club's has.
select pg_temp.ok('a second before Perth''s midnight is still 22 November',
  public.club_day('2026-11-22 15:59:59+00') = date '2026-11-22', true);
select pg_temp.ok('Perth''s midnight is 23 November, though UTC is still the 22nd',
  public.club_day('2026-11-22 16:00:00+00') = date '2026-11-23', true);
select pg_temp.ok('a second after Perth''s midnight',
  public.club_day('2026-11-22 16:00:01+00') = date '2026-11-23', true);
select pg_temp.ok('just before UTC''s midnight it is long past Perth''s',
  public.club_day('2026-11-22 23:59:59+00') = date '2026-11-23', true);
select pg_temp.ok('the club''s day on New Year''s Eve, a second before midnight',
  public.club_day('2026-12-31 15:59:59+00') = date '2026-12-31', true);
select pg_temp.ok('and at midnight, the new year',
  public.club_day('2026-12-31 16:00:00+00') = date '2027-01-01', true);

-- A club in Sydney, in summer time (UTC+11): midnight is 1 pm UTC.
select pg_temp.club_in('Australia/Sydney');
select pg_temp.ok('a Sydney club''s day a second before its midnight',
  public.club_day('2026-11-22 12:59:59+00') = date '2026-11-22', true);
select pg_temp.ok('and at its midnight',
  public.club_day('2026-11-22 13:00:00+00') = date '2026-11-23', true);
select pg_temp.ok('in winter Sydney is UTC+10, so midnight is 2 pm UTC',
  public.club_day('2026-06-22 13:59:59+00') = date '2026-06-22'
  and public.club_day('2026-06-22 14:00:00+00') = date '2026-06-23', true);
select pg_temp.club_in('Australia/Perth');

-- Members read the helpers; anon doesn't.
select pg_temp.ok('members can read the club''s time zone', has_function_privilege('authenticated', 'public.club_timezone()', 'execute'), true);
select pg_temp.ok('members can read the club''s day', has_function_privilege('authenticated', 'public.club_today()', 'execute'), true);
select pg_temp.ok('anon cannot read the time zone', has_function_privilege('anon', 'public.club_timezone()', 'execute'), false);
select pg_temp.ok('anon cannot read the club''s day', has_function_privilege('anon', 'public.club_today()', 'execute'), false);
select pg_temp.ok('anon cannot change the time zone', has_function_privilege('anon', 'public.admin_set_club_timezone(text)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- The app reads the time zone with the club's look
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.ok('club_profile gives the time zone', (select timezone = 'Australia/Perth' from public.club_profile()), true);
select pg_temp.ok('club_profile still gives the name and features', (select features is not null from public.club_profile()), true);

-- ---------------------------------------------------------------------------
-- Who can change it
-- ---------------------------------------------------------------------------
select pg_temp.as_member('21');
select pg_temp.fails('committee cannot change the time zone', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_member('11');
select pg_temp.fails('a coach cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_member('13');
select pg_temp.fails('a manager cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_member('32');
select pg_temp.fails('an athlete cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_member('31');
select pg_temp.fails('a junior athlete cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_member('41');
select pg_temp.fails('a parent cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_member('14');
select pg_temp.fails('a physio cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.as_nobody();
select pg_temp.fails('nobody signed in cannot change it', $$select public.admin_set_club_timezone('Australia/Sydney')$$);
select pg_temp.ok('none of them changed it', public.club_timezone() = 'Australia/Perth', true);

select pg_temp.as_member('01');
select pg_temp.fails('an unknown place is refused', $$select public.admin_set_club_timezone('Mars/Olympus_Mons')$$);
select pg_temp.fails('an offset written as text is refused (Postgres reads it backwards)', $$select public.admin_set_club_timezone('UTC+8')$$);
select pg_temp.fails('a short name such as AWST is refused', $$select public.admin_set_club_timezone('AWST')$$);
select pg_temp.fails('blank is refused', $$select public.admin_set_club_timezone('  ')$$);
select pg_temp.fails('nothing is refused', $$select public.admin_set_club_timezone(null)$$);
select pg_temp.ok('the refused ones changed nothing', public.club_timezone() = 'Australia/Perth', true);
select pg_temp.works('an admin moves the club to Adelaide', $$select public.admin_set_club_timezone(' Australia/Adelaide ')$$);
select pg_temp.ok('saved without the spaces', (select timezone = 'Australia/Adelaide' from public.club_settings where id), true);
select pg_temp.ok('the club''s day follows it', public.club_today() = (now() at time zone 'Australia/Adelaide')::date, true);
select pg_temp.works('and back to Perth', $$select public.admin_set_club_timezone('Australia/Perth')$$);
select pg_temp.as_nobody();
select pg_temp.fails('the database refuses a made-up zone saved any other way',
  $$update public.club_settings set timezone = 'Somewhere/Else' where id$$);
select pg_temp.ok('so the club''s day always works', public.club_today() is not null, true);

-- ---------------------------------------------------------------------------
-- Everything that means "today" follows the club, not UTC or Perth
-- ---------------------------------------------------------------------------
select pg_temp.club_in('Pacific/Pago_Pago');
create temp table days as select public.club_today() as pago;
select pg_temp.club_in('Pacific/Kiritimati');
alter table days add column kiri date;
update days set kiri = public.club_today();
select pg_temp.ok('the two clubs are on different days', (select kiri > pago from days), true);
select pg_temp.ok('load monitoring''s day follows the club', public.load_today() = (select kiri from days), true);

-- A card that ends on Pago Pago's today: current there, ended in Kiritimati.
update public.profiles set wwcc_expires_on = (select pago from days) where id = pg_temp.id('11');
select pg_temp.ok('a card ending on Pago Pago''s today has ended in Kiritimati, a day on',
  (select public.has_current_wwcc(pg_temp.id('11'))), false);
select pg_temp.club_in('Pacific/Pago_Pago');
select pg_temp.ok('and is current in Pago Pago, where today is that day',
  (select public.has_current_wwcc(pg_temp.id('11'))), true);

-- Turning 18 on the club's day.
select pg_temp.ok('a member turning 18 today is an adult',
  public.is_minor(((select pago from days) - interval '18 years')::date, null), false);
select pg_temp.ok('a member turning 18 tomorrow is still a child',
  public.is_minor((((select pago from days) + 1) - interval '18 years')::date, null), true);
select pg_temp.club_in('Pacific/Kiritimati');
select pg_temp.ok('a day later in the club''s calendar they are an adult',
  public.is_minor(((select kiri from days) - interval '18 years')::date, null), false);
select pg_temp.ok('under 13 follows the club''s day too',
  public.is_under_13(((select kiri from days) - interval '13 years')::date)
  = false and public.is_under_13(((select kiri from days) - interval '13 years' + interval '1 day')::date), true);

-- A check-in may be for yesterday, today or tomorrow, in the club's days.
select pg_temp.as_member('32');
select pg_temp.works('a check-in for the club''s tomorrow is taken', $$select public.save_check_in((select kiri from days) + 1, 4, 2, 3, 4, null)$$);
select pg_temp.fails('two days ahead is refused', $$select public.save_check_in((select kiri from days) + 2, 4, 2, 3, 4, null)$$);
select pg_temp.as_nobody();
select pg_temp.club_in('Pacific/Pago_Pago');
select pg_temp.as_member('32');
select pg_temp.fails('in a club a day behind, that same day is too far ahead', $$select public.save_check_in((select kiri from days) + 1, 4, 2, 3, 4, null)$$);
select pg_temp.works('its own tomorrow is fine', $$select public.save_check_in((select pago from days) + 1, 4, 2, 3, 4, null)$$);
select pg_temp.as_nobody();

-- Quiet hours (8 pm to 7 am) are the club's, near its midnight and its 7 am.
select pg_temp.club_in('Australia/Perth');
select pg_temp.ok('a second before 8 pm in Perth, notifications go',
  public.push_quiet_hours('2026-11-22 11:59:59+00'), false);
select pg_temp.ok('at 8 pm in Perth they wait', public.push_quiet_hours('2026-11-22 12:00:00+00'), true);
select pg_temp.ok('at Perth''s midnight they wait', public.push_quiet_hours('2026-11-22 16:00:00+00'), true);
select pg_temp.ok('at 7 am in Perth they go', public.push_quiet_hours('2026-11-22 23:00:00+00'), false);
select pg_temp.club_in('Australia/Sydney');
select pg_temp.ok('7 am in Perth is 10 am in Sydney: they go', public.push_quiet_hours('2026-11-22 23:00:00+00'), false);
select pg_temp.ok('8 pm in Perth is 11 pm in Sydney: they wait', public.push_quiet_hours('2026-11-22 12:00:00+00'), true);
select pg_temp.ok('at 7 am in Sydney they go', public.push_quiet_hours('2026-11-22 20:00:00+00'), false);
select pg_temp.club_in('Australia/Perth');

-- ---------------------------------------------------------------------------
-- Nothing works out the day another way
-- ---------------------------------------------------------------------------
-- current_date is the UTC day on Supabase. Perth written into a function
-- ignores the club's setting. Either one mixed with the club's day is how
-- the message access dates went a day out (#275).
select 'FAIL ' || p.oid::regprocedure || ' uses current_date; use public.club_today()'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~* '\mcurrent_date\M|now\(\)::date|\(now\(\)\)::date';
select 'FAIL ' || p.oid::regprocedure || ' names Perth; use public.club_timezone()'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~ 'Australia/Perth' and p.proname <> 'club_timezone';
select pg_temp.ok('no function uses the UTC day or names Perth', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.prosrc ~* '\mcurrent_date\M|now\(\)::date|\(now\(\)\)::date'
         or (p.prosrc ~ 'Australia/Perth' and p.proname <> 'club_timezone'))), true);
select pg_temp.ok('no column default uses the UTC day or Perth, apart from a new club''s zone', not exists (
  select 1 from pg_attrdef d join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and pg_get_expr(d.adbin, d.adrelid) ~* 'current_date|Australia/Perth'
    and not (c.relname = 'club_settings')), true);
select pg_temp.ok('a new club starts in Perth', (select pg_get_expr(d.adbin, d.adrelid) = '''Australia/Perth''::text'
  from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where d.adrelid = 'public.club_settings'::regclass and a.attname = 'timezone'), true);
