-- Tests for 20261012235000_concerns.sql. Run on a fresh database with the
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

-- Contacts: Casey Coach (11) and Emery Manager (13) have current checks.
select pg_temp.as_member('11');
select pg_temp.fails('non-admin cannot set contacts',
  $s$ select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013', null, null, null, null) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('contact needs a current check',
  $s$ select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000012', null, null, null, null, null) $s$);
select pg_temp.fails('contact must be an adult',
  $s$ select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000031', null, null, null, null, null) $s$);
select pg_temp.fails('two different people',
  $s$ select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', null, null, null, null) $s$);
select pg_temp.fails('admin cannot be the only contact',
  $s$ select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000001', null, null, null, null, null) $s$);
select pg_temp.fails('links must be https',
  $s$ select public.admin_set_safeguarding(null, null, 'Netball WA', null, 'http://example.com', null) $s$);
select public.admin_set_safeguarding('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013',
  'Netball WA', '1800 955 900', 'https://example.com/complaints', 'https://example.com/policy');

-- Everyone signed in sees the contacts, including people waiting for approval.
reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'waiting.parent@example.test', now());
update public.profiles set full_name = 'Pat Waiting', status = 'pending' where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.as_member('61');
select pg_temp.ok('pending member sees the contacts',
  (select child_safety_officer_name = 'Casey Coach' and complaints_manager_name = 'Emery Manager' and governing_body_phone = '1800 955 900' from public.safeguarding_contacts()), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('signed-out sees no contacts', (select count(*) = 0 from public.safeguarding_contacts()), true);

-- Raising concerns.
select pg_temp.as_member('61');
select pg_temp.fails('a concern needs words', $s$ select public.raise_concern('   ') $s$);
select pg_temp.fails('no future dates', $s$ select public.raise_concern('Something', p_happened_on => public.club_today() + 1) $s$);
select public.raise_concern('Coach shouted at my child and grabbed her arm', 'Head coach of the squad',
  '00000000-0000-0000-0000-000000000011', public.club_today() - 2, 'yes', true, '0400 000 000', false, null);
select pg_temp.as_member('31');
select public.raise_concern('Someone keeps messaging me', p_anonymous => true, p_contact_ok => true, p_contact_details => 'my number', p_involves_child => 'yes', p_context => 'From the check-in screen');
select pg_temp.ok('raiser sees their own concern and status', (select count(*) = 1 and bool_and(status = 'received') from public.my_concerns()), true);

-- Nobody but handlers can read the tables directly.
set role authenticated;
select pg_temp.as_member('31');
-- Supabase grants the table, so row level security, with no policy, shows nothing.
select pg_temp.ok('no direct reading of concerns', (select count(*) = 0 from public.concerns), true);
select pg_temp.ok('no direct reading of concern events', (select count(*) = 0 from public.concern_events), true);
reset role;

-- Who sees the register.
select pg_temp.as_member('11');
select pg_temp.ok('officer does not see the concern about them', (select count(*) = 1 from public.concern_register()), true);
select pg_temp.ok('anonymous concern hides the raiser and contact details',
  (select raised_by_name is null and contact_details is null and not contact_ok from public.concern_register() where anonymous), true);
select pg_temp.as_member('13');
select pg_temp.ok('other officer sees both', (select count(*) = 2 from public.concern_register()), true);
select pg_temp.ok('named raiser shown with contact details',
  (select raised_by_name = 'Pat Waiting' and contact_details = '0400 000 000' from public.concern_register() where not anonymous), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees both', (select count(*) = 2 from public.concern_register()), true);
select pg_temp.as_member('41');
select pg_temp.ok('ordinary member sees none', (select count(*) = 0 from public.concern_register()), true);
select pg_temp.as_member('13');
select pg_temp.ok('two new concerns to look at', public.new_concerns_count() = 2, true);

-- Acting on a concern.
select pg_temp.as_member('13');
select pg_temp.fails('closing needs a reason',
  $s$ select public.add_concern_event((select id from public.concerns where not anonymous), 'status_changed', null, 'closed') $s$);
select public.add_concern_event((select id from public.concerns where not anonymous), 'referred_governing_body', 'Sent the complaints form');
select public.add_concern_event((select id from public.concerns where not anonymous), 'referred_police', 'Reported to local police');
select pg_temp.ok('referral sets the status', (select status = 'referred' from public.concern_register() where not anonymous), true);
select pg_temp.ok('history kept in order', (select array_agg(kind::text order by created_at) = '{referred_governing_body,referred_police}' from public.concern_history((select id from public.concerns where not anonymous))), true);
select pg_temp.ok('one new concern left', public.new_concerns_count() = 1, true);
select pg_temp.as_member('11');
select pg_temp.fails('officer cannot act on a concern about them',
  $s$ select public.add_concern_event((select id from public.concerns where not anonymous), 'note', 'Nothing happened') $s$);
select pg_temp.ok('officer cannot read the history of a concern about them',
  (select count(*) = 0 from public.concern_history((select id from public.concerns where not anonymous))), true);
select pg_temp.as_member('41');
select pg_temp.fails('ordinary member cannot act', $s$ select public.add_concern_event((select id from public.concerns limit 1), 'note', 'x') $s$);

-- Naming who an anonymous concern is about hides it from that person.
select pg_temp.as_member('01');
select public.set_concern_about((select id from public.concerns where anonymous), '00000000-0000-0000-0000-000000000013');
select pg_temp.as_member('13');
select pg_temp.ok('named officer loses the concern', (select count(*) = 1 from public.concern_register()), true);
select pg_temp.as_member('01');
select public.add_concern_event((select id from public.concerns where anonymous), 'status_changed', 'Spoke to the family; resolved', 'closed');
select pg_temp.ok('closed with a date', (select status = 'closed' and closed_at is not null from public.concern_register() where anonymous), true);
select pg_temp.ok('closed ones listed last', (select array_agg(status::text order by ordinality) = '{referred,closed}' from public.concern_register() with ordinality), true);
select pg_temp.as_member('31');
select pg_temp.ok('raiser sees it closed', (select status = 'closed' from public.my_concerns()), true);

-- A contact who loses their check stops being a contact.
reset role;
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.as_member('13');
select pg_temp.ok('lapsed officer sees nothing', (select count(*) = 0 from public.concern_register()), true);
select pg_temp.as_member('61');
select pg_temp.ok('lapsed officer not shown as a contact', (select complaints_manager_name is null from public.safeguarding_contacts()), true);

-- Ten a day.
select pg_temp.as_member('32');
select count(*) from (select public.raise_concern('Test ' || g) from generate_series(1, 10) g) x;
select pg_temp.fails('eleventh concern in a day refused', $s$ select public.raise_concern('One more') $s$);
