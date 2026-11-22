-- Tests for 20261013050000_guardian_history.sql. Run on a fresh database with the
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
-- Recipients of the newest notice, as a sorted list of member numbers.
create or replace function pg_temp.last_notice_to() returns text language sql as
$$ select string_agg(right(r.profile_id::text, 2), ',' order by r.profile_id)
   from public.message_recipients r
   where r.message_id = (select id from public.messages where audience = 'notice' order by created_at desc, id desc limit 1) $$;
create or replace function pg_temp.last_notice() returns text language sql as
$$ select body from public.messages where audience = 'notice' order by created_at desc, id desc limit 1 $$;
grant select on public.guardianship_history to authenticated;
grant select on public.messages, public.message_recipients to authenticated;

-- The seed linked Logan (41) then Morgan (42) to Jordan (31, 14 years old).
select pg_temp.ok('the seed links are in the history',
  (select count(*) = 2 and bool_and(change = 'linked') from public.guardianship_history
   where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('each link sent a notice', (select count(*) = 2 from public.messages where audience = 'notice'), true);
select pg_temp.ok('Morgan''s link went to both guardians and Jordan, naming the guardian and the child',
  (select string_agg(right(r.profile_id::text, 2), ',' order by r.profile_id) = '31,41,42'
   from public.messages m join public.message_recipients r on r.message_id = m.id
   where m.audience = 'notice'
     and m.body like 'Morgan Coach-Parent is now linked to Jordan Junior as a parent or guardian.%'), true);

-- Saving with the same guardians changes nothing.
select pg_temp.as_member('01');
select pg_temp.works('re-saving Jordan with the same guardians',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[{"team_id": "00000000-0000-0000-0000-0000000000a1"}]', true,
      '{00000000-0000-0000-0000-000000000042,00000000-0000-0000-0000-000000000041}') $s$);
select pg_temp.ok('no new history', (select count(*) = 2 from public.guardianship_history), true);
select pg_temp.ok('no new notice', (select count(*) = 2 from public.messages where audience = 'notice'), true);
select pg_temp.ok('the links keep their dates',
  (select count(*) = 2 from public.guardianships where athlete_id = '00000000-0000-0000-0000-000000000031'), true);

-- Unlinking, with a reason.
select pg_temp.fails('a reason over 500 characters is refused',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000041}', null, '{}', repeat('x', 501)) $s$);
select pg_temp.works('an admin unlinks Morgan with a reason',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000041}', null, '{}', 'Court order on file') $s$);
select pg_temp.ok('the unlink is kept with who, when and why',
  (select change = 'unlinked' and guardian_name = 'Morgan Coach-Parent' and athlete_name = 'Jordan Junior'
     and reason = 'Court order on file' and changed_by = '00000000-0000-0000-0000-000000000001'
     and changed_by_name = 'Alex Admin'
   from public.guardianship_history order by changed_at desc, id desc limit 1), true);
select pg_temp.ok('Logan and Jordan are told, not Morgan', pg_temp.last_notice_to() = '31,41', true);
select pg_temp.ok('the notice names the guardian and the admin',
  pg_temp.last_notice() like 'Morgan Coach-Parent is no longer linked to Jordan Junior as a parent or guardian. Changed by Alex Admin on %', true);
select pg_temp.ok('the reason stays out of the notice', pg_temp.last_notice() like '%Court order%', false);
select pg_temp.ok('the notice is from the club, to the family',
  (select sender_id is null and sender_name = 'Club safeguarding' and audience_label = 'Parents and guardians of Jordan Junior'
   from public.messages where audience = 'notice' order by created_at desc, id desc limit 1), true);
select pg_temp.ok('the reason setting does not leak past the save', current_setting('app.guardian_reason', true) = '', true);

-- Who can read what.
set role authenticated;
select pg_temp.as_member('41');
select pg_temp.ok('a guardian reads the notice in their messages',
  (select count(*) >= 1 from public.messages where audience = 'notice'), true);
select pg_temp.ok('a guardian cannot read the link history', (select count(*) = 0 from public.guardianship_history), true);
select pg_temp.as_member('31');
select pg_temp.ok('the child cannot read the link history', (select count(*) = 0 from public.guardianship_history), true);
select pg_temp.as_member('01');
select pg_temp.ok('admins read the link history', (select count(*) = 3 from public.guardianship_history), true);
reset role;

-- An admin who is one of the child's guardians.
-- Since 20261101000000 a parent or guardian is approved once they've entered
-- an approved child's link code, and approving them links them: Blair entered
-- Jordan's.
insert into public.guardian_link_requests (guardian_id, athlete_id)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000031');
select pg_temp.works('Blair, an admin, also becomes a guardian, linked to Jordan by the code',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000002', 'admin', 'approved', '[]', false, '{}', null, '{guardian}') $s$);
select pg_temp.works('another admin keeps Blair linked to Jordan',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000041,00000000-0000-0000-0000-000000000002}') $s$);
select pg_temp.ok('the link notice goes to both guardians and Jordan', pg_temp.last_notice_to() = '02,31,41', true);
select pg_temp.as_member('02');
select pg_temp.fails('Blair cannot unlink the other guardian',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000002}') $s$);
select pg_temp.fails('Blair cannot add another guardian',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000041,00000000-0000-0000-0000-000000000002,00000000-0000-0000-0000-000000000042}') $s$);
select pg_temp.works('Blair can still save Jordan with the guardians unchanged',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000002,00000000-0000-0000-0000-000000000041}') $s$);
select pg_temp.as_member('01');
select pg_temp.works('another admin unlinks Blair',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000041}') $s$);

-- Under 13: the child isn't sent the notice.
update public.profiles set date_of_birth = public.club_today() - interval '10 years' where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.works('linking Morgan again',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved',
      '[]', true, '{00000000-0000-0000-0000-000000000041,00000000-0000-0000-0000-000000000042}') $s$);
select pg_temp.ok('a child under 13 is not sent it, the guardians are', pg_temp.last_notice_to() = '41,42', true);

-- A member deleted: the history keeps the name.
select pg_temp.works('deleting Morgan',
  $s$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000042' $s$);
select pg_temp.ok('their unlink is recorded with their name',
  (select guardian_name = 'Morgan Coach-Parent' and change = 'unlinked'
   from public.guardianship_history order by changed_at desc, id desc limit 1), true);

-- Verification.
update public.profiles set verified_at = null, verified_by = null where id = '00000000-0000-0000-0000-000000000032';
select pg_temp.as_member('11');
select pg_temp.fails('only admins record a verification',
  $s$ select public.admin_record_verification('00000000-0000-0000-0000-000000000032', 'id_sighted', 'Licence') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin cannot verify themselves',
  $s$ select public.admin_record_verification('00000000-0000-0000-0000-000000000001', 'id_sighted', 'Licence') $s$);
select pg_temp.fails('the method must be PlayHQ or ID',
  $s$ select public.admin_record_verification('00000000-0000-0000-0000-000000000032', 'code', 'Licence') $s$);
select pg_temp.fails('what was checked is needed',
  $s$ select public.admin_record_verification('00000000-0000-0000-0000-000000000032', 'playhq', '  ') $s$);
select pg_temp.works('an admin records sighting ID',
  $s$ select public.admin_record_verification('00000000-0000-0000-0000-000000000032', 'id_sighted', ' Driver''s licence, name and photo match ') $s$);
select pg_temp.ok('the method, note, who and when are kept',
  (select verification_method = 'id_sighted' and verification_note = 'Driver''s licence, name and photo match'
     and verified_by = '00000000-0000-0000-0000-000000000001' and verified_at is not null
   from public.profiles where id = '00000000-0000-0000-0000-000000000032'), true);
select pg_temp.fails('an existing verification is not overwritten',
  $s$ select public.admin_record_verification('00000000-0000-0000-0000-000000000032', 'playhq', 'Other') $s$);
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000032';
insert into public.verification_codes (profile_id, code, expires_at)
values ('00000000-0000-0000-0000-000000000032', '123456', now() + interval '1 day');
select pg_temp.works('checking a code in person',
  $s$ select public.admin_verify_member('00000000-0000-0000-0000-000000000032', '123 456') $s$);
select pg_temp.ok('is recorded as a code, with no note',
  (select verification_method = 'code' and verification_note is null
   from public.profiles where id = '00000000-0000-0000-0000-000000000032'), true);
update public.profiles set verified_at = null where id = '00000000-0000-0000-0000-000000000032';
select pg_temp.works('older app versions still mark someone checked against PlayHQ',
  $s$ select public.admin_mark_verified('00000000-0000-0000-0000-000000000032') $s$);
select pg_temp.ok('recorded as PlayHQ',
  (select verification_method = 'playhq' from public.profiles where id = '00000000-0000-0000-0000-000000000032'), true);
select pg_temp.ok('the remaining guardian was told',
  pg_temp.last_notice() like 'Morgan Coach-Parent is no longer linked to Jordan Junior%' and pg_temp.last_notice_to() = '41', true);
create temp table notices_before as select count(*) as n from public.messages where audience = 'notice';
select pg_temp.works('deleting Jordan',
  $s$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000031' $s$);
select pg_temp.ok('the child''s unlink is recorded with their name',
  (select athlete_name = 'Jordan Junior' and guardian_name = 'Logan Parent' and change = 'unlinked'
   from public.guardianship_history order by changed_at desc, id desc limit 1), true);
select pg_temp.ok('and nobody is sent a notice about a child who left',
  (select count(*) from public.messages where audience = 'notice') = (select n from notices_before), true);
