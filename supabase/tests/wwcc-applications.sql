-- Tests for 20261023100000_wwcc_applications.sql: a lodged Working With
-- Children Check application counting as screening until the card arrives.
-- Run on a fresh database with the migrations and seed-members.sql loaded.
-- Prints one line per check.
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
-- Fails unless the error message contains the expected words.
create or replace function pg_temp.fails_with(label text, statement text, words text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when position(words in sqlerrm) > 0 then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- A receipt in the member's folder, as the admin's upload would leave it.
create or replace function pg_temp.receipt(n text) returns text language plpgsql as
$$ declare v_name text := pg_temp.id(n)::text || '/' || gen_random_uuid() || '.pdf';
   begin
     insert into storage.objects (bucket_id, name, metadata)
     values ('wwcc-receipts', v_name, '{"mimetype": "application/pdf"}');
     return v_name;
   end $$;
-- Records an application for member n as the signed-in admin.
create or replace function pg_temp.record(n text, p_lodged date, p_kind text default 'new') returns uuid language sql as
$$ select public.admin_record_wwcc_application(pg_temp.id(n), 'apl ' || n, p_lodged, p_kind, pg_temp.receipt(n), 'receipt.pdf') $$;
create or replace function pg_temp.status(n text) returns text language sql as
$$ select public.wwcc_application_status(a) from public.wwcc_applications a
   where a.profile_id = pg_temp.id(n) order by a.recorded_at desc, a.ended_at nulls first limit 1 $$;
-- has_role as member n.
create or replace function pg_temp.has(n text, r public.app_role) returns boolean language plpgsql as
$$ declare v boolean; v_was text := current_setting('request.jwt.claim.sub', true);
   begin
     perform pg_temp.as_member(n);
     v := public.has_role(r);
     perform set_config('request.jwt.claim.sub', coalesce(v_was, ''), false);
     return v;
   end $$;
-- Whether the signed-in member can see the table or the bucket directly.
create or replace function pg_temp.reads_table() returns boolean language plpgsql as
$$ declare v boolean;
   begin
     set local role authenticated;
     begin
       select exists (select 1 from public.wwcc_applications) into v;
     exception when insufficient_privilege then v := null;
     end;
     reset role;
     return v;
   end $$;
create or replace function pg_temp.reads_receipts() returns boolean language plpgsql as
$$ declare v boolean;
   begin
     set local role authenticated;
     select exists (select 1 from storage.objects where bucket_id = 'wwcc-receipts') into v;
     reset role;
     return v;
   end $$;
create or replace function pg_temp.uploads(n text) returns boolean language plpgsql as
$$ begin
     set local role authenticated;
     insert into storage.objects (bucket_id, name) values ('wwcc-receipts', pg_temp.id(n)::text || '/upload.pdf');
     reset role;
     return true;
   exception when others then
     reset role;
     return false;
   end $$;
grant select, insert on storage.objects to authenticated;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- A new coach waiting to be approved, with no card yet.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'coach.applied@example.test', now());
update public.profiles set full_name = 'Nico Newcoach', role = 'coach', status = 'pending',
  date_of_birth = date '1990-01-01'
where id = pg_temp.id('61');

-- The rules.
select pg_temp.ok('an application lapses after 90 days', public.wwcc_application_lapse_days() = 90, true);
select pg_temp.ok('admins confirm it every 30 days', public.wwcc_application_check_days() = 30, true);
select pg_temp.ok('the declaration names the number and day',
  public.wwcc_application_declaration('APL 9', date '2026-10-20')
    like 'I applied for a Working With Children Check on 20 October 2026 (application APL 9)%', true);
select pg_temp.ok('and every condition from the Screening Unit',
  public.wwcc_application_declaration('APL 9', date '2026-10-20') like '%Negative Notice or an Interim Negative Notice%'
  and public.wwcc_application_declaration('APL 9', date '2026-10-20') like '%withdrawn%'
  and public.wwcc_application_declaration('APL 9', date '2026-10-20') like '%Class 1 offence as an adult%', true);

-- Nobody reads the table or the receipts directly, except admins' receipts.
select pg_temp.as_member('12');
select pg_temp.ok('a member can''t read the table', pg_temp.reads_table(), null);
select pg_temp.ok('a coach can''t upload a receipt', pg_temp.uploads('12'), false);
select pg_temp.as_member('01');
select pg_temp.ok('an admin can''t read the table either', pg_temp.reads_table(), null);
select pg_temp.ok('an admin uploads a receipt', pg_temp.uploads('12'), true);
select pg_temp.ok('and opens it', pg_temp.reads_receipts(), true);
select pg_temp.as_member('12');
select pg_temp.ok('a coach can''t open receipts', pg_temp.reads_receipts(), false);

-- Who may record one.
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach can''t record an application',
  $s$ select pg_temp.record('12', public.club_today() - 3) $s$, 'Only admins');
select pg_temp.as_member('01');
select pg_temp.fails_with('an admin can''t record their own',
  $s$ select pg_temp.record('01', public.club_today() - 3) $s$, 'another admin');
select pg_temp.fails_with('an under 18 doesn''t need one',
  $s$ select pg_temp.record('31', public.club_today() - 3) $s$, 'under 18');
select pg_temp.fails_with('a missing member is refused',
  $s$ select public.admin_record_wwcc_application(gen_random_uuid(), 'APL', public.club_today(), 'new', 'x/y.pdf', null) $s$, 'not found');
select pg_temp.fails_with('the number is needed',
  $s$ select public.admin_record_wwcc_application(pg_temp.id('12'), '  ', public.club_today(), 'new', pg_temp.receipt('12'), null) $s$, 'application number');
select pg_temp.fails_with('a number longer than 40 is refused',
  $s$ select public.admin_record_wwcc_application(pg_temp.id('12'), repeat('9', 41), public.club_today(), 'new', pg_temp.receipt('12'), null) $s$, 'application number');
select pg_temp.fails_with('the day can''t be in the future',
  $s$ select pg_temp.record('12', public.club_today() + 1) $s$, 'lodged');
select pg_temp.fails_with('or more than 90 days ago',
  $s$ select pg_temp.record('12', public.club_today() - 91) $s$, 'lodged');
select pg_temp.fails_with('or missing',
  $s$ select pg_temp.record('12', null) $s$, 'lodged');
select pg_temp.fails_with('new or renewal is needed',
  $s$ select pg_temp.record('12', public.club_today(), 'other') $s$, 'renewal');
select pg_temp.fails_with('the receipt is needed',
  $s$ select public.admin_record_wwcc_application(pg_temp.id('12'), 'APL', public.club_today(), 'new', null, null) $s$, 'receipt');
select pg_temp.fails_with('the receipt must be uploaded',
  $s$ select public.admin_record_wwcc_application(pg_temp.id('12'), 'APL', public.club_today(), 'new', pg_temp.id('12')::text || '/missing.pdf', null) $s$, 'receipt');
select pg_temp.fails_with('the receipt must be in the member''s folder',
  $s$ select public.admin_record_wwcc_application(pg_temp.id('12'), 'APL', public.club_today(), 'new', pg_temp.receipt('11'), null) $s$, 'receipt');
select pg_temp.ok('nothing was recorded', (select count(*) = 0 from public.wwcc_applications), true);

-- A renewal for a coach whose card has expired.
select pg_temp.ok('the lapsed coach is paused', pg_temp.has('12', 'coach'), false);
select pg_temp.works('an admin records their renewal application',
  $s$ select pg_temp.record('12', public.club_today() - 3, 'renewal') $s$);
select pg_temp.ok('it''s kept as entered, number in capitals',
  (select application_number = 'APL 12' and kind = 'renewal' and lodged_on = public.club_today() - 3
     and receipt_name = 'receipt.pdf' and recorded_by = pg_temp.id('01') and recorded_by_name = 'Alex Admin'
   from public.wwcc_applications where profile_id = pg_temp.id('12')), true);
select pg_temp.ok('it waits for their declaration', pg_temp.status('12') = 'waiting_for_declaration', true);
select pg_temp.ok('so it doesn''t count yet', public.wwcc_application_valid(pg_temp.id('12')), false);
select pg_temp.ok('and they''re still paused', pg_temp.has('12', 'coach'), false);
select pg_temp.ok('the admin sees it, with the dates it''s due',
  (select member_name = 'Drew Lapsed' and status = 'waiting_for_declaration'
     and check_due_on = (now() at time zone 'Australia/Perth')::date + 30
     and lapses_on = (now() at time zone 'Australia/Perth')::date + 90
   from public.admin_wwcc_applications() where profile_id = pg_temp.id('12')), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach sees no list', (select count(*) = 0 from public.admin_wwcc_applications()), true);
select pg_temp.ok('nor anyone else''s application', (select count(*) = 0 from public.my_wwcc_application()), true);
select pg_temp.fails_with('and has none to accept',
  $s$ select public.accept_wwcc_application_declaration() $s$, 'don''t have');

-- The member accepts the declaration.
select pg_temp.as_member('12');
select pg_temp.ok('the member sees their application and the declaration',
  (select application_number = 'APL 12' and status = 'waiting_for_declaration' and not valid
     and declaration_text like 'I applied for a Working With Children Check on %' and declared_at is null
   from public.my_wwcc_application()), true);
select pg_temp.works('they accept it', $s$ select public.accept_wwcc_application_declaration() $s$);
select pg_temp.fails_with('only once', $s$ select public.accept_wwcc_application_declaration() $s$, 'already');
select pg_temp.ok('the words they accepted are kept',
  (select declaration_text = public.wwcc_application_declaration('APL 12', public.club_today() - 3) and declared_at is not null
   from public.wwcc_applications where profile_id = pg_temp.id('12')), true);
select pg_temp.ok('it''s in force', pg_temp.status('12') = 'in_force', true);
select pg_temp.ok('they see it counts', (select valid and status = 'in_force' from public.my_wwcc_application()), true);
select pg_temp.ok('so they''re cleared', public.is_cleared(pg_temp.id('12')), true);
select pg_temp.ok('and coach again', pg_temp.has('12', 'coach'), true);
select pg_temp.ok('they can be a safeguarding contact', public.can_be_safeguarding_contact(pg_temp.id('12')), true);
select pg_temp.ok('and work with children', public.can_work_with_children(), true);

-- Confirming it's still being assessed.
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach can''t confirm it',
  $s$ select public.admin_confirm_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('12'))) $s$, 'Only admins');
select pg_temp.as_member('02');
select pg_temp.works('another admin confirms it',
  $s$ select public.admin_confirm_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('12'))) $s$);
select pg_temp.ok('who and when are kept',
  (select checked_at is not null and checked_by_name = 'Blair Admin'
   from public.wwcc_applications where profile_id = pg_temp.id('12')), true);
select pg_temp.fails_with('an unknown application can''t be confirmed',
  $s$ select public.admin_confirm_wwcc_application(gen_random_uuid()) $s$, 'ended');

-- Nobody confirms it for 90 days.
update public.wwcc_applications set checked_at = now() - interval '89 days' where profile_id = pg_temp.id('12');
select pg_temp.ok('after 89 days it still counts', pg_temp.status('12') = 'in_force', true);
update public.wwcc_applications set checked_at = now() - interval '91 days' where profile_id = pg_temp.id('12');
select pg_temp.ok('after 90 days it lapses', pg_temp.status('12') = 'lapsed', true);
select pg_temp.ok('and they''re paused again', pg_temp.has('12', 'coach'), false);
select pg_temp.ok('and not cleared', public.is_cleared(pg_temp.id('12')), false);
select pg_temp.as_member('01');
select pg_temp.ok('the admin sees it lapsed', (select status = 'lapsed' from public.admin_wwcc_applications() where profile_id = pg_temp.id('12')), true);
select pg_temp.works('confirming it brings it back',
  $s$ select public.admin_confirm_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('12'))) $s$);
select pg_temp.ok('coach again', pg_temp.has('12', 'coach'), true);
update public.wwcc_applications set checked_at = null, recorded_at = now() - interval '91 days' where profile_id = pg_temp.id('12');
select pg_temp.ok('one never confirmed lapses 90 days after it was recorded', pg_temp.status('12') = 'lapsed', true);
update public.wwcc_applications set declared_at = null where profile_id = pg_temp.id('12');
select pg_temp.ok('even before their declaration', pg_temp.status('12') = 'lapsed', true);
update public.wwcc_applications set recorded_at = now(), declared_at = now() where profile_id = pg_temp.id('12');

-- The card arrives.
select pg_temp.works('recording their new card',
  $s$ select public.admin_set_member_details(pg_temp.id('12'), null, 'WWC0012', public.club_today() + 1000) $s$);
select pg_temp.ok('ends the application',
  (select ended_at is not null and ended_reason = 'card_recorded' and ended_by_name = 'Alex Admin'
   from public.wwcc_applications where profile_id = pg_temp.id('12')), true);
select pg_temp.ok('they''re a coach through the card', pg_temp.has('12', 'coach'), true);
select pg_temp.ok('the ended one stays on the admin''s list',
  (select status = 'ended' from public.admin_wwcc_applications() where profile_id = pg_temp.id('12')), true);
select pg_temp.as_member('12');
select pg_temp.ok('the member no longer has an open one', (select count(*) = 0 from public.my_wwcc_application()), true);
select pg_temp.as_member('01');
select pg_temp.fails_with('an ended application can''t be confirmed',
  $s$ select public.admin_confirm_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('12'))) $s$, 'ended');
select pg_temp.fails_with('or ended again',
  $s$ select public.admin_end_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('12')), 'other', null) $s$, 'already');
select pg_temp.works('changing an unrelated detail later', $s$ select public.admin_set_member_details(pg_temp.id('12'), null, 'WWC0012', public.club_today() + 1000) $s$);
select pg_temp.works('an expired card doesn''t end one',
  $s$ select pg_temp.record('13', public.club_today());
      select public.admin_set_member_details(pg_temp.id('13'), null, 'WWC0013', public.club_today() - 1) $s$);
select pg_temp.ok('so it stays open', pg_temp.status('13') = 'waiting_for_declaration', true);

-- A new committee member, after checks are needed.
update public.safeguarding_settings set committee_checks_from = public.club_today() - 1 where id;
select pg_temp.ok('a committee member with no check is paused', pg_temp.has('22', 'committee'), false);
select pg_temp.works('recording their application', $s$ select pg_temp.record('22', public.club_today()) $s$);
select pg_temp.as_member('22');
select pg_temp.works('they accept the declaration', $s$ select public.accept_wwcc_application_declaration() $s$);
select pg_temp.ok('they''re committee again', pg_temp.has('22', 'committee'), true);
select pg_temp.ok('and cleared, so they see children''s injuries if allowed', public.is_cleared(pg_temp.id('22')), true);
select pg_temp.as_member('01');
select pg_temp.works('recording it again replaces the open one', $s$ select pg_temp.record('22', public.club_today()) $s$);
select pg_temp.ok('the earlier one ends as replaced',
  (select count(*) = 1 from public.wwcc_applications where profile_id = pg_temp.id('22') and ended_reason = 'replaced'), true);
select pg_temp.ok('one stays open', (select count(*) = 1 from public.wwcc_applications where profile_id = pg_temp.id('22') and ended_at is null), true);
select pg_temp.ok('the new one needs their declaration again', pg_temp.has('22', 'committee'), false);

-- Ending one.
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach can''t end one',
  $s$ select public.admin_end_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('22') and ended_at is null), 'withdrawn', null) $s$, 'Only admins');
select pg_temp.as_member('01');
select pg_temp.fails_with('a reason is needed',
  $s$ select public.admin_end_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('22') and ended_at is null), 'card_recorded', null) $s$, 'why');
select pg_temp.fails_with('a long note is refused',
  $s$ select public.admin_end_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('22') and ended_at is null), 'other', repeat('x', 501)) $s$, '500');
select pg_temp.works('an admin ends it as withdrawn',
  $s$ select public.admin_end_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('22') and ended_at is null), 'withdrawn', ' They moved away ') $s$);
select pg_temp.ok('with the reason and note',
  (select ended_reason = 'withdrawn' and end_note = 'They moved away' and ended_by_name = 'Alex Admin'
   from public.wwcc_applications where profile_id = pg_temp.id('22') order by ended_at desc limit 1), true);
select pg_temp.ok('and they''re paused', pg_temp.has('22', 'committee'), false);

-- A notice from the Screening Unit stops it.
select pg_temp.works('an application for the physio, whose card has expired',
  $s$ select public.admin_set_member_details(pg_temp.id('14'), null, 'WWC0014', public.club_today() - 1);
      select pg_temp.record('14', public.club_today() - 10) $s$);
select pg_temp.as_member('14');
select pg_temp.works('the physio accepts it', $s$ select public.accept_wwcc_application_declaration() $s$);
select pg_temp.ok('the physio is working', pg_temp.has('14', 'physio'), true);
select pg_temp.as_member('01');
select pg_temp.works('an interim negative notice arrives',
  $s$ select public.admin_record_screening_notice(pg_temp.id('14'), 'interim_negative_notice', public.club_today(), 'Stood down') $s$);
select pg_temp.ok('the application is stopped', pg_temp.status('14') = 'stopped', true);
select pg_temp.ok('so they''re not cleared', public.is_cleared(pg_temp.id('14')), false);
select pg_temp.ok('and not a physio', pg_temp.has('14', 'physio'), false);
select pg_temp.fails_with('it can''t be confirmed',
  $s$ select public.admin_confirm_wwcc_application((select id from public.wwcc_applications where profile_id = pg_temp.id('14'))) $s$, 'notice');
select pg_temp.fails_with('or recorded again for an earlier lodged date',
  $s$ select pg_temp.record('14', public.club_today() - 5) $s$, 'notice');
select pg_temp.ok('the admin sees it stopped', (select status = 'stopped' from public.admin_wwcc_applications() where profile_id = pg_temp.id('14')), true);
select pg_temp.works('a notice of another kind doesn''t stop one',
  $s$ select public.admin_record_screening_notice(pg_temp.id('13'), 'other', public.club_today(), 'Letter about address') $s$);
select pg_temp.ok('the manager''s is still waiting', pg_temp.status('13') = 'waiting_for_declaration', true);
-- A member with a notice that is still waiting for their declaration can't
-- accept it.
update public.wwcc_applications set declared_at = null where profile_id = pg_temp.id('14');
select pg_temp.as_member('14');
select pg_temp.fails_with('a stopped application can''t be accepted',
  $s$ select public.accept_wwcc_application_declaration() $s$, 'notice');

-- Approving a new coach with an application.
select pg_temp.as_member('01');
select pg_temp.fails_with('a new coach with nothing can''t be approved',
  $s$ select public.admin_save_member(pg_temp.id('61'), 'coach', 'approved') $s$, 'application they''ve lodged');
select pg_temp.works('with an application recorded, they''re approved',
  $s$ select pg_temp.record('61', public.club_today() - 1);
      select public.admin_save_member(pg_temp.id('61'), 'coach', 'approved') $s$);
select pg_temp.ok('but paused until they accept the declaration', pg_temp.has('61', 'coach'), false);
select pg_temp.as_member('61');
select pg_temp.works('they accept it', $s$ select public.accept_wwcc_application_declaration() $s$);
select pg_temp.ok('and can coach', pg_temp.has('61', 'coach'), true);
select pg_temp.as_member('01');
update public.wwcc_applications set checked_at = now() - interval '100 days' where profile_id = pg_temp.id('61');
update public.profiles set status = 'pending', role = 'coach', extra_roles = '{}' where id = pg_temp.id('61');
select pg_temp.fails_with('or a coach again',
  $s$ select public.admin_save_member(pg_temp.id('61'), 'coach', 'approved') $s$, 'application they''ve lodged');
select pg_temp.fails_with('a stopped application doesn''t approve a coach',
  $s$ update public.profiles set status = 'pending' where id = pg_temp.id('14');
      select public.admin_save_member(pg_temp.id('14'), 'physio', 'approved') $s$, 'application they''ve lodged');

-- Making someone a committee member or an admin.
select pg_temp.as_member('01');
select pg_temp.fails_with('a new committee member needs a check, an application or an exemption',
  $s$ select public.admin_save_member(pg_temp.id('32'), 'athlete', 'approved', '[]', false, '{}', null, '{committee}') $s$, 'before making them a committee member');
select pg_temp.works('an application they''ve lodged is enough',
  $s$ select pg_temp.record('32', public.club_today());
      select public.admin_save_member(pg_temp.id('32'), 'athlete', 'approved', '[]', false, '{}', null, '{committee}') $s$);
select pg_temp.fails_with('a committee member with no open application can''t be made an admin',
  $s$ select public.admin_save_member(pg_temp.id('22'), 'committee', 'approved', '[]', false, '{}', null, '{admin}') $s$, 'before making them an admin');
select pg_temp.works('with one, they can',
  $s$ select pg_temp.record('22', public.club_today());
      select public.admin_save_member(pg_temp.id('22'), 'committee', 'approved', '[]', false, '{}', null, '{admin}') $s$);
select pg_temp.works('taking admin away again',
  $s$ select public.admin_save_member(pg_temp.id('22'), 'committee', 'approved') $s$);
update public.wwcc_applications set checked_at = now() - interval '100 days' where profile_id = pg_temp.id('22');
select pg_temp.fails_with('a lapsed application doesn''t make them an admin',
  $s$ select public.admin_save_member(pg_temp.id('22'), 'committee', 'approved', '[]', false, '{}', null, '{admin}') $s$, 'before making them an admin');

-- No rows outside the new table were removed.
select pg_temp.ok('the sample members are all still here', (select count(*) = 14 from public.profiles), true);
