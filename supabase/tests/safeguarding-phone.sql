-- Tests for 20261125300000_safeguarding_phone_check.sql: the governing body's
-- phone number on the Safeguarding screen must be a phone number. Run on a
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
create or replace function pg_temp.fails_with(label text, statement text, expected text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like '%' || expected || '%' then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.saves(phone text) returns void language sql as
$$ select public.admin_set_safeguarding_contacts(array[pg_temp.id('11')], array[pg_temp.id('13')],
     'Netball WA', phone, 'https://example.com/complaints', 'https://example.com/policy') $$;
create or replace function pg_temp.saved_phone() returns text language sql as
$$ select governing_body_phone from public.safeguarding_settings where id $$;

-- ---------------------------------------------------------------------------
-- The rule itself (the same as isPhoneNumber in src/lib/phone.ts)
-- ---------------------------------------------------------------------------
select pg_temp.ok('a mobile', public.is_phone_number('0412 345 678'), true);
select pg_temp.ok('a mobile with no spaces', public.is_phone_number('0412345678'), true);
select pg_temp.ok('a landline with its area code in brackets', public.is_phone_number('(08) 9123 4567'), true);
select pg_temp.ok('landlines in every area code', (select bool_and(public.is_phone_number(n)) from unnest(array['02 9123 4567', '03 9123 4567', '07 3123 4567', '08 9123 4567']) n), true);
select pg_temp.ok('1800, 1300 and 13 numbers', (select bool_and(public.is_phone_number(n)) from unnest(array['1800 955 900', '1300 123 456', '13 12 34', '1800 55 1800']) n), true);
select pg_temp.ok('+61 forms', (select bool_and(public.is_phone_number(n)) from unnest(array['+61 412 345 678', '+61 8 9123 4567', '+61 (0)8 9123 4567', '61412345678', '+61-412-345-678']) n), true);
select pg_temp.ok('a number from another country with +', public.is_phone_number('+44 20 7946 0958'), true);
select pg_temp.ok('an email address is not', public.is_phone_number('safe@netballwa.com.au'), false);
select pg_temp.ok('words are not', public.is_phone_number('call the office'), false);
select pg_temp.ok('a number with words after it is not', public.is_phone_number('1800 955 900 ext 2'), false);
select pg_temp.ok('a local number with no area code is not', public.is_phone_number('9123 4567'), false);
select pg_temp.ok('a mobile a digit short is not', public.is_phone_number('0412 345 67'), false);
select pg_temp.ok('a mobile a digit long is not', public.is_phone_number('0412 345 6789'), false);
select pg_temp.ok('a landline with an area code that isn''t one is not', public.is_phone_number('06 9123 4567'), false);
select pg_temp.ok('a + in the middle is not', public.is_phone_number('0412+345678'), false);
select pg_temp.ok('+ on its own is not', public.is_phone_number('+'), false);
select pg_temp.ok('+61 on its own is not', public.is_phone_number('+61'), false);
select pg_temp.ok('an overseas number too short is not', public.is_phone_number('+44 123'), false);
select pg_temp.ok('an overseas number too long is not', public.is_phone_number('+44 1234 5678 9012 3456'), false);
select pg_temp.ok('blank is not', public.is_phone_number('  '), false);
select pg_temp.ok('null is not', public.is_phone_number(null), false);

-- ---------------------------------------------------------------------------
-- Saving the Safeguarding screen
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('an admin saves a 1800 number', $s$ select pg_temp.saves('1800 955 900') $s$);
select pg_temp.ok('it is saved as typed', pg_temp.saved_phone() = '1800 955 900', true);
select pg_temp.fails_with('an email address is refused',
  $s$ select pg_temp.saves('safe@netballwa.com.au') $s$, 'must be a phone number');
select pg_temp.fails_with('words are refused',
  $s$ select pg_temp.saves('ring the office') $s$, 'must be a phone number');
select pg_temp.fails_with('a number with no area code is refused',
  $s$ select pg_temp.saves('9123 4567') $s$, 'must be a phone number');
select pg_temp.ok('a refused save leaves the number as it was', pg_temp.saved_phone() = '1800 955 900', true);
select pg_temp.works('a mobile is saved', $s$ select pg_temp.saves('0412 345 678') $s$);
select pg_temp.works('a landline is saved', $s$ select pg_temp.saves('(08) 9123 4567') $s$);
select pg_temp.works('a +61 number is saved', $s$ select pg_temp.saves('+61 8 9123 4567') $s$);
select pg_temp.works('blank clears it', $s$ select pg_temp.saves('   ') $s$);
select pg_temp.ok('and it is cleared', pg_temp.saved_phone() is null, true);
select pg_temp.works('null clears it too', $s$ select pg_temp.saves(null) $s$);

-- The old save, used by app versions not yet updated, checks the same.
select pg_temp.fails_with('the old save refuses an email address too',
  $s$ select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('13'), 'Netball WA', 'safe@netballwa.com.au', null, null) $s$,
  'must be a phone number');
select pg_temp.works('the old save takes a phone number',
  $s$ select public.admin_set_safeguarding(pg_temp.id('11'), pg_temp.id('13'), 'Netball WA', '1800 955 900', null, null) $s$);

-- A non-admin still can't save, whatever the number.
select pg_temp.as_member('11');
select pg_temp.fails_with('a member who isn''t an admin can''t save the contacts',
  $s$ select pg_temp.saves('1800 955 900') $s$, 'Only admins');

-- ---------------------------------------------------------------------------
-- A number saved before the check is kept, and other settings still save
-- ---------------------------------------------------------------------------
reset role;
update public.safeguarding_settings set governing_body_phone = 'old@example.com' where id;
select pg_temp.as_member('01');
select pg_temp.ok('an email address saved before the check is still there', pg_temp.saved_phone() = 'old@example.com', true);
select pg_temp.works('other safeguarding settings on the same row still save',
  $s$ select public.admin_set_minor_injury_photos(true) $s$);
select pg_temp.ok('and the old value is untouched', pg_temp.saved_phone() = 'old@example.com', true);
select pg_temp.fails_with('saving the contacts with it unchanged is refused, so it gets fixed',
  $s$ select pg_temp.saves('old@example.com') $s$, 'must be a phone number');
select pg_temp.works('fixing it saves', $s$ select pg_temp.saves('1800 955 900') $s$);
