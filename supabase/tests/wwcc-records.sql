-- Tests for 20261013030000_wwcc_records.sql. Run on a fresh database with the
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
grant select on public.screening_notices to authenticated;

-- Current checks for 01 (admin), 11 (coach), 13 (manager), 14 (physio) and 42 (coach), none validated.
select pg_temp.as_member('01');
select pg_temp.ok('to-dos: five cards to validate, five to link, an officer to choose',
  (select wwcc_to_validate = 5 and wwcc_to_link = 5 and notices_to_report = 0 and wwc_officer_missing = 1
   from public.admin_safety_todos()), true);

-- Expiry.
select pg_temp.fails('an expiry more than three years away is refused',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000013', null, 'WWC0013', (current_date + interval '3 years 1 day')::date) $s$);
select pg_temp.works('an unchanged card saves even with other details',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000013', '1990-01-01', 'WWC0013', current_date + 400) $s$);

-- Validation.
select pg_temp.as_member('11');
select pg_temp.fails('only admins validate',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000013', 'Emery Manager', 'online', true) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin cannot validate their own card',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000001', 'Alex Admin', 'online', true) $s$);
select pg_temp.fails('the name on the card is needed',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000011', ' ', 'online', true) $s$);
select pg_temp.fails('how it was checked is needed',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000011', 'Casey Coach', 'phone', true) $s$);
select pg_temp.fails('an expired card cannot be validated',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000012', 'Drew Lapsed', 'online', true) $s$);
select pg_temp.fails('a member without a card cannot be validated',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000022', 'Harper Committee', 'online', true) $s$);
select pg_temp.works('admin validates a card online and links it',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000011', ' Casey J Coach ', 'online', true) $s$);
select pg_temp.ok('the validation is kept with who and when',
  (select wwcc_card_name = 'Casey J Coach' and wwcc_validation_method = 'online' and wwcc_validated_at is not null
     and wwcc_validated_by = '00000000-0000-0000-0000-000000000001' and wwcc_unit_linked_at is not null
   from public.profiles where id = '00000000-0000-0000-0000-000000000011'), true);
select pg_temp.works('admin validates a sighted card, not yet linked',
  $s$ select public.admin_validate_wwcc('00000000-0000-0000-0000-000000000013', 'Emery Manager', 'card_sighted', false) $s$);
select pg_temp.ok('to-dos count what is left',
  (select wwcc_to_validate = 3 and wwcc_to_link = 4 from public.admin_safety_todos()), true);
update public.profiles set wwcc_validated_at = now() - interval '13 months' where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.ok('a validation over a year old needs doing again',
  (select wwcc_to_validate = 4 from public.admin_safety_todos()), true);
select pg_temp.works('saving the same card keeps the validation',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000011', null, 'wwc0011', current_date + 400) $s$);
select pg_temp.ok('the validation is still there',
  (select wwcc_validated_at is not null and wwcc_unit_linked_at is not null from public.profiles where id = '00000000-0000-0000-0000-000000000011'), true);
select pg_temp.works('a renewed card is saved',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000011', null, 'WWC1111', current_date + 1000) $s$);
select pg_temp.ok('a renewed card needs validating and linking again',
  (select wwcc_validated_at is null and wwcc_validation_method is null and wwcc_unit_linked_at is null
   from public.profiles where id = '00000000-0000-0000-0000-000000000011'), true);

-- Registration Officer.
select pg_temp.as_member('11');
select pg_temp.fails('only admins choose the officer',
  $s$ select public.admin_set_wwc_officer('00000000-0000-0000-0000-000000000001') $s$);
select pg_temp.ok('only admins see the officer', (select count(*) = 0 from public.admin_wwc_officer()), true);
select pg_temp.as_member('01');
select pg_temp.fails('a coach cannot be the officer',
  $s$ select public.admin_set_wwc_officer('00000000-0000-0000-0000-000000000011') $s$);
select pg_temp.fails('a committee member with an expired check cannot be the officer',
  $s$ select public.admin_set_wwc_officer('00000000-0000-0000-0000-000000000021') $s$);
select pg_temp.works('an admin with a current check is the officer',
  $s$ select public.admin_set_wwc_officer('00000000-0000-0000-0000-000000000001') $s$);
select pg_temp.ok('the officer shows, and the to-do clears',
  (select officer_name = 'Alex Admin' from public.admin_wwc_officer())
  and (select wwc_officer_missing = 0 from public.admin_safety_todos()), true);

-- Notices.
select pg_temp.as_member('11');
select pg_temp.fails('only admins record notices',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000042', 'other', current_date, 'Change of address letter') $s$);
set role authenticated;
select pg_temp.ok('non-admins cannot read notices', (select count(*) = 0 from public.screening_notices), true);
reset role;
select pg_temp.as_member('01');
select pg_temp.fails('an admin cannot record a notice about themselves',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000001', 'other', current_date, 'x') $s$);
select pg_temp.fails('what the club did is needed',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000042', 'negative_notice', current_date, ' ') $s$);
select pg_temp.fails('a future date is refused',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000042', 'negative_notice', current_date + 1, 'Removed') $s$);
select pg_temp.works('an other notice is recorded',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000013', 'other', current_date, 'Unit asked us to confirm their role') $s$);
select pg_temp.ok('an other notice does not stand them down',
  (select stood_down_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000013'), true);
select pg_temp.works('an interim negative notice is recorded',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000042', 'interim_negative_notice', current_date - 1, 'Removed from coaching straight away') $s$);
select pg_temp.ok('they are stood down at once, for that reason',
  (select p.stood_down_at is not null and s.reason = 'interim_negative_notice' and s.note = 'Removed from coaching straight away'
   from public.profiles p join public.stand_downs s on s.profile_id = p.id and s.lifted_at is null
   where p.id = '00000000-0000-0000-0000-000000000042'), true);
select pg_temp.ok('and taken out of the squads they coach',
  (select count(*) = 0 from public.team_members where profile_id = '00000000-0000-0000-0000-000000000042' and team_role = 'coach'), true);
select pg_temp.works('a negative notice for someone already stood down is recorded',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000042', 'negative_notice', current_date, 'Confirmed removal') $s$);
select pg_temp.ok('still one open stand-down',
  (select count(*) = 1 from public.stand_downs where profile_id = '00000000-0000-0000-0000-000000000042' and lifted_at is null), true);
select pg_temp.works('a cancelled card is recorded',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000014', 'card_cancelled', current_date, 'Physio told not to attend') $s$);
select pg_temp.ok('a cancelled card stands them down with the reason in the note',
  (select reason = 'other' and note like 'Card cancelled%Physio told not to attend'
   from public.stand_downs where profile_id = '00000000-0000-0000-0000-000000000014' and lifted_at is null), true);
select pg_temp.works('a notice about a guardian only is recorded without a stand-down',
  $s$ select public.admin_record_screening_notice('00000000-0000-0000-0000-000000000041', 'negative_notice', current_date, 'Guardian told; not volunteering') $s$);
select pg_temp.ok('four notices wait to be reported to the governing body',
  (select notices_to_report = 4 from public.admin_safety_todos()), true);
select pg_temp.fails('a report date before the notice is refused',
  $s$ select public.admin_screening_notice_reported((select id from public.screening_notices where kind = 'interim_negative_notice'), current_date - 5) $s$);
select pg_temp.works('admin records telling the governing body',
  $s$ select public.admin_screening_notice_reported((select id from public.screening_notices where kind = 'interim_negative_notice'), current_date) $s$);
select pg_temp.ok('who told them is kept',
  (select governing_body_told_on = current_date and governing_body_told_by_name = 'Alex Admin'
   from public.screening_notices where kind = 'interim_negative_notice'), true);
select pg_temp.fails('it can only be marked once',
  $s$ select public.admin_screening_notice_reported((select id from public.screening_notices where kind = 'interim_negative_notice'), current_date) $s$);
select pg_temp.ok('the to-do counts one less',
  (select notices_to_report = 3 from public.admin_safety_todos()), true);
select pg_temp.as_member('11');
select pg_temp.ok('to-dos are only for admins',
  (select coalesce(sum(wwcc_to_validate + wwcc_to_link + notices_to_report + wwc_officer_missing), 0) = 0 from public.admin_safety_todos()), true);
