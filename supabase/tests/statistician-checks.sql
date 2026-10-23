-- Tests for 20261023110000_statistician_checks.sql: statisticians need a
-- Working With Children Check like managers, with an exemption for adult-only
-- work and a club date before which those already approved keep the role;
-- and an admin whose check has lapsed for 30 days keeps admin powers but
-- stops seeing under 18s' injuries (customer review C8). Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
-- Fails unless the error message contains the expected words.
create or replace function pg_temp.fails_with(label text, statement text, words text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when position(words in sqlerrm) > 0 then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Row level security applies to the app's role, not to the test's.
create or replace function pg_temp.reads(p_area text) returns boolean language plpgsql as
$$ declare v boolean;
   begin
     set local role authenticated;
     select exists (select 1 from public.injuries where body_area = p_area) into v;
     reset role;
     return v;
   end $$;
create or replace function pg_temp.listed(p_area text) returns boolean language sql as
$$ select exists (select 1 from public.visible_injuries(true) where body_area = p_area) $$;
create or replace function pg_temp.save_statistician(n text) returns void language sql as
$$ select public.admin_save_member(pg_temp.id(n), 'statistician', 'approved') $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- Statisticians: 51 no check, 52 exempt with a reason, 53 current check,
-- 54 expired check, 55 a parent of Jordan with a parent volunteer
-- exemption, 56 asking to join, 57 already approved with no check.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'stats.none@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'stats.exempt@example.test', now()),
  ('00000000-0000-0000-0000-000000000053', 'stats.current@example.test', now()),
  ('00000000-0000-0000-0000-000000000054', 'stats.expired@example.test', now()),
  ('00000000-0000-0000-0000-000000000055', 'stats.parent@example.test', now()),
  ('00000000-0000-0000-0000-000000000056', 'stats.new@example.test', now()),
  ('00000000-0000-0000-0000-000000000057', 'stats.kept@example.test', now());
update public.profiles p set status = v.status::public.member_status, full_name = v.name,
  role = v.role::public.app_role, extra_roles = v.extra::public.app_role[],
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, wwcc_exempt_reason = v.reason,
  date_of_birth = current_date - interval '40 years', verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000051', 'Rowan Stats', 'statistician', '{}', 'approved', null, null::date, null),
  ('00000000-0000-0000-0000-000000000052', 'Sasha Opens', 'statistician', '{}', 'approved', null, null, 'Opens games only, from video'),
  ('00000000-0000-0000-0000-000000000053', 'Tatum Checked', 'statistician', '{}', 'approved', 'WWC0053', current_date + 400, null),
  ('00000000-0000-0000-0000-000000000054', 'Uri Lapsed', 'statistician', '{}', 'approved', 'WWC0054', current_date - 1, null),
  ('00000000-0000-0000-0000-000000000055', 'Val Parent-Stats', 'guardian', '{statistician}', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000056', 'Wren Newcomer', 'guest', '{}', 'pending', null, null, null),
  ('00000000-0000-0000-0000-000000000057', 'Xan Kept', 'statistician', '{}', 'approved', null, null, null)
) as v(id, name, role, extra, status, wwcc, exp, reason)
where p.id = v.id::uuid;
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('55'), pg_temp.id('31'));
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, declared_at, declaration_text)
values (pg_temp.id('55'), 'parent_volunteer', pg_temp.id('31'), 'Jordan Junior', now(), 'Declared');
-- An adult's injury alongside the seed's under 18 (Jordan's ankle).
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values (pg_temp.id('32'), pg_temp.id('32'), 'Knee', 'Jarred knee', current_date - 2, 'Kai Senior');
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members can read the statistician date', has_function_privilege('authenticated', 'public.statistician_checks_from()', 'execute'), true);
select pg_temp.ok('anon cannot read the statistician date', has_function_privilege('anon', 'public.statistician_checks_from()', 'execute'), false);
select pg_temp.ok('members can call the date setter (it checks for admins)', has_function_privilege('authenticated', 'public.admin_set_statistician_checks_from(date)', 'execute'), true);
select pg_temp.ok('anon cannot set the date', has_function_privilege('anon', 'public.admin_set_statistician_checks_from(date)', 'execute'), false);
select pg_temp.ok('members can ask about their own injury access', has_function_privilege('authenticated', 'public.my_admin_sees_children_injuries()', 'execute'), true);
select pg_temp.ok('anon cannot ask about injury access', has_function_privilege('anon', 'public.my_admin_sees_children_injuries()', 'execute'), false);
select pg_temp.ok('helper is closed: admin_sees_children_injuries', has_function_privilege('authenticated', 'public.admin_sees_children_injuries(uuid)', 'execute'), false);
select pg_temp.ok('helper is closed to anon: admin_sees_children_injuries', has_function_privilege('anon', 'public.admin_sees_children_injuries(uuid)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Who needs a check
-- ---------------------------------------------------------------------------
select pg_temp.ok('a statistician needs a check', public.needs_wwcc('{statistician}', null), true);
select pg_temp.ok('a blank reason is no exemption', public.needs_wwcc('{statistician}', '  '), true);
select pg_temp.ok('a statistician exempt with a reason does not', public.needs_wwcc('{statistician}', 'Opens only'), false);
select pg_temp.ok('a coach who is also a statistician always does', public.needs_wwcc('{coach,statistician}', 'Opens only'), true);
select pg_temp.ok('an athlete still does not', public.needs_wwcc('{athlete}', null), false);
select pg_temp.ok('committee unchanged: exempt with a reason', public.needs_wwcc('{committee}', 'Treasurer'), false);

-- ---------------------------------------------------------------------------
-- The statistician checks date
-- ---------------------------------------------------------------------------
select pg_temp.ok('date defaults to 90 days ahead',
  (select statistician_checks_from = current_date + 90 from public.safeguarding_settings where id), true);
select pg_temp.ok('committee date is untouched',
  (select committee_checks_from = current_date + 90 from public.safeguarding_settings where id), true);
select pg_temp.as_member('51');
select pg_temp.ok('a statistician can read the date', public.statistician_checks_from() = current_date + 90, true);

-- Before the date
select pg_temp.ok('no check: keeps the role before the date', public.has_role('statistician'), true);
select pg_temp.ok('no check: still records games before the date', public.is_statistician(), true);
select pg_temp.as_member('52');
select pg_temp.ok('exempt with a reason: keeps the role', public.has_role('statistician'), true);
select pg_temp.as_member('53');
select pg_temp.ok('current check: keeps the role', public.has_role('statistician'), true);
select pg_temp.as_member('54');
select pg_temp.ok('expired check: paused even before the date', public.has_role('statistician'), false);
select pg_temp.ok('expired check: cannot record games', public.is_statistician(), false);
select pg_temp.as_member('55');
select pg_temp.ok('parent volunteer exemption: keeps the role', public.has_role('statistician'), true);

-- Changing the date
select pg_temp.as_member('51');
select pg_temp.fails_with('a statistician cannot change the date',
  $$select public.admin_set_statistician_checks_from(current_date)$$, 'Only admins');
select pg_temp.as_member('22');
select pg_temp.fails_with('a committee member cannot change the date',
  $$select public.admin_set_statistician_checks_from(current_date)$$, 'Only admins');
select pg_temp.as_member('01');
select pg_temp.fails_with('admin cannot push the date back',
  $$select public.admin_set_statistician_checks_from(current_date + 200)$$, 'only be brought forward');
select pg_temp.fails_with('admin cannot clear the date',
  $$select public.admin_set_statistician_checks_from(null)$$, 'Choose the date');
select pg_temp.works('admin brings the date forward to today',
  $$select public.admin_set_statistician_checks_from(current_date)$$);
select pg_temp.ok('the new date is saved',
  (select statistician_checks_from = current_date from public.safeguarding_settings where id), true);
select pg_temp.ok('who changed it is kept',
  (select updated_by = pg_temp.id('01') from public.safeguarding_settings where id), true);
select pg_temp.ok('the committee date did not move',
  (select committee_checks_from = current_date + 90 from public.safeguarding_settings where id), true);
select pg_temp.works('admin can set it to the same day again',
  $$select public.admin_set_statistician_checks_from(current_date)$$);

-- From the date
select pg_temp.as_member('51');
select pg_temp.ok('no check: paused from the date', public.has_role('statistician'), false);
select pg_temp.ok('no check: cannot record games from the date', public.is_statistician(), false);
select pg_temp.fails_with('no check: Vantage refuses a new game',
  $$select public.create_game(gen_random_uuid(), '{}'::jsonb, 'tablet-1')$$, 'Only statisticians and admins');
select pg_temp.as_member('52');
select pg_temp.ok('exempt with a reason: still keeps the role', public.has_role('statistician'), true);
select pg_temp.as_member('53');
select pg_temp.ok('current check: still keeps the role', public.has_role('statistician'), true);
select pg_temp.as_member('55');
select pg_temp.ok('parent volunteer exemption: still keeps the role', public.has_role('statistician'), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee member with no check still keeps theirs (their own date)', public.has_role('committee'), true);

-- What brings it back
reset role;
insert into public.wwcc_applications (profile_id, application_number, lodged_on, kind, receipt_path, recorded_by, declared_at, declaration_text)
values (pg_temp.id('51'), 'APP51', current_date - 5, 'new', '51/r/receipt.pdf', pg_temp.id('01'), now(), 'Declared');
select pg_temp.as_member('51');
select pg_temp.ok('a lodged application in force brings the role back', public.has_role('statistician'), true);
reset role;
update public.wwcc_applications set declared_at = null where profile_id = pg_temp.id('51');
select pg_temp.ok('one waiting for their declaration does not', public.has_role('statistician'), false);
update public.wwcc_applications set ended_at = now(), ended_reason = 'withdrawn' where profile_id = pg_temp.id('51');
update public.profiles set wwcc_number = 'WWC0051', wwcc_expires_on = current_date + 365 where id = pg_temp.id('51');
select pg_temp.ok('a current check brings it back', public.has_role('statistician'), true);
update public.profiles set wwcc_expires_on = current_date - 1 where id = pg_temp.id('51');
select pg_temp.ok('and it pauses again when the check expires', public.has_role('statistician'), false);
update public.profiles set wwcc_number = null, wwcc_expires_on = null, wwcc_exempt_reason = 'Video only' where id = pg_temp.id('51');
select pg_temp.ok('an exemption with a reason brings it back', public.has_role('statistician'), true);
update public.profiles set wwcc_exempt_reason = null where id = pg_temp.id('51');

-- A stand-down still stops it
update public.profiles set stood_down_at = now() where id = pg_temp.id('53');
select pg_temp.as_member('53');
select pg_temp.ok('stood down with a current check: paused', public.has_role('statistician'), false);
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('53');
update public.profiles set stood_down_at = now() where id = pg_temp.id('52');
select pg_temp.as_member('52');
select pg_temp.ok('stood down while exempt: paused', public.has_role('statistician'), false);
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('52');

-- Other roles are unchanged
select pg_temp.as_member('12');
select pg_temp.ok('coach with expired check still paused', public.has_role('coach'), false);
select pg_temp.as_member('11');
select pg_temp.ok('coach with current check still active', public.has_role('coach'), true);
select pg_temp.as_member('21');
select pg_temp.ok('committee with expired check still paused', public.has_role('committee'), false);
select pg_temp.as_member('02');
select pg_temp.ok('admin with no check keeps the admin role', public.has_role('admin'), true);
select pg_temp.ok('and still records games, as an admin', public.is_statistician(), true);

-- ---------------------------------------------------------------------------
-- Approving statisticians
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.fails_with('a new statistician with no check is refused',
  $$select pg_temp.save_statistician('56')$$, 'before making them a statistician');
reset role;
select pg_temp.ok('and nothing changed', (select status = 'pending' and role = 'guest' from public.profiles where id = pg_temp.id('56')), true);
update public.profiles set wwcc_number = 'WWC0056', wwcc_expires_on = current_date - 1 where id = pg_temp.id('56');
select pg_temp.as_member('01');
select pg_temp.fails_with('a new statistician with an expired check is refused',
  $$select pg_temp.save_statistician('56')$$, 'before making them a statistician');
reset role;
update public.profiles set wwcc_number = null, wwcc_expires_on = null where id = pg_temp.id('56');
select pg_temp.as_member('01');
select pg_temp.works('an admin exempts them with a reason',
  $$select public.admin_set_wwcc_exemption(pg_temp.id('56'), 'Codes opens games from video')$$);
select pg_temp.works('then approving them works',
  $$select pg_temp.save_statistician('56')$$);
reset role;
select pg_temp.ok('they are approved as a statistician',
  (select status = 'approved' and role = 'statistician' from public.profiles where id = pg_temp.id('56')), true);

-- A new one with a current check, an application or a volunteer exemption
update public.profiles set status = 'pending', role = 'guest', wwcc_exempt_reason = null where id = pg_temp.id('56');
update public.profiles set wwcc_number = 'WWC0056', wwcc_expires_on = current_date + 400 where id = pg_temp.id('56');
select pg_temp.as_member('01');
select pg_temp.works('a new statistician with a current check is approved',
  $$select pg_temp.save_statistician('56')$$);
reset role;
update public.profiles set status = 'pending', role = 'guest', wwcc_number = null, wwcc_expires_on = null where id = pg_temp.id('56');
insert into public.wwcc_applications (profile_id, application_number, lodged_on, kind, receipt_path, recorded_by)
values (pg_temp.id('56'), 'APP56', current_date - 2, 'new', '56/r/receipt.pdf', pg_temp.id('01'));
select pg_temp.as_member('01');
select pg_temp.works('one with an application still waiting for their declaration is approved',
  $$select pg_temp.save_statistician('56')$$);
select pg_temp.as_member('56');
select pg_temp.ok('but the role waits for the declaration', public.has_role('statistician'), false);
reset role;
update public.wwcc_applications set ended_at = now(), ended_reason = 'withdrawn' where profile_id = pg_temp.id('56');
update public.profiles set status = 'pending', role = 'guest', extra_roles = '{}' where id = pg_temp.id('56');
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, declaration_text)
values (pg_temp.id('56'), 'parent_volunteer', pg_temp.id('31'), 'Jordan Junior', 'Not yet declared');
select pg_temp.as_member('01');
select pg_temp.works('one with a volunteer exemption waiting for their declaration is approved',
  $$select pg_temp.save_statistician('56')$$);

-- One already approved keeps their approval, even with the role paused
select pg_temp.works('re-saving a statistician approved before this works',
  $$select pg_temp.save_statistician('57')$$);
select pg_temp.as_member('57');
select pg_temp.ok('their role is paused from the date, though', public.has_role('statistician'), false);

-- Another role with a check doesn't cover a new statistician role's own rule
select pg_temp.as_member('01');
select pg_temp.fails_with('a committee member with no check made a statistician is refused',
  $$select public.admin_save_member(pg_temp.id('22'), 'committee', 'approved', '[]'::jsonb, false, '{}', null, '{statistician}')$$,
  'before making them a statistician');
select pg_temp.works('a manager with a current check can also be a statistician',
  $$select public.admin_save_member(pg_temp.id('13'), 'manager', 'approved', '[{"team_id":"00000000-0000-0000-0000-0000000000a1"}]'::jsonb, false, '{}', null, '{statistician}')$$);
select pg_temp.as_member('13');
select pg_temp.ok('and holds both roles', public.has_role('manager') and public.has_role('statistician'), true);

-- ---------------------------------------------------------------------------
-- C8: admins and under 18s' injuries
-- ---------------------------------------------------------------------------
-- Admin 01 has a current check; admin 02 has none. The committee checks
-- date is 90 days ahead.
select pg_temp.as_member('01');
select pg_temp.ok('admin with a check sees the under 18''s injury', pg_temp.reads('Ankle'), true);
select pg_temp.ok('and lists it', pg_temp.listed('Ankle'), true);
select pg_temp.ok('and the adult''s', pg_temp.reads('Knee'), true);
select pg_temp.ok('their own answer is yes', public.my_admin_sees_children_injuries(), true);
select pg_temp.as_member('02');
select pg_temp.ok('admin with no check sees it before the committee date', pg_temp.reads('Ankle'), true);
select pg_temp.ok('their own answer is yes before the date', public.my_admin_sees_children_injuries(), true);

-- 29 and 31 days after the committee checks date
reset role;
update public.safeguarding_settings set committee_checks_from = current_date - 29 where id;
select pg_temp.as_member('02');
select pg_temp.ok('no check, 29 days after the committee date: still sees it', pg_temp.reads('Ankle'), true);
reset role;
update public.safeguarding_settings set committee_checks_from = current_date - 30 where id;
select pg_temp.as_member('02');
select pg_temp.ok('no check, 30 days after the committee date: no longer sees it', pg_temp.reads('Ankle'), false);
reset role;
update public.safeguarding_settings set committee_checks_from = current_date - 31 where id;
select pg_temp.as_member('02');
select pg_temp.ok('no check, 31 days after: does not read the under 18''s injury', pg_temp.reads('Ankle'), false);
select pg_temp.ok('nor list it', pg_temp.listed('Ankle'), false);
select pg_temp.ok('their own answer is no', public.my_admin_sees_children_injuries(), false);
select pg_temp.ok('still sees the adult''s injury', pg_temp.reads('Knee'), true);
select pg_temp.ok('still lists the adult''s injury', pg_temp.listed('Knee'), true);
select pg_temp.ok('keeps the admin role', public.has_role('admin'), true);
select pg_temp.ok('and still counts as an admin', public.is_admin(), true);
select pg_temp.works('and can still use admin powers',
  $$select public.admin_set_statistician_checks_from(current_date)$$);

-- Accepting a clearance follows the same rule
reset role;
update public.injuries set status = 'coach_endorsed', coach_endorsed_by = pg_temp.id('11') where body_area = 'Ankle';
select pg_temp.as_member('02');
select pg_temp.fails_with('the lapsed admin cannot accept an under 18''s clearance',
  $$select public.accept_clearance((select id from public.injuries where body_area = 'Ankle'))$$, 'can accept an under 18');
select pg_temp.as_member('01');
select pg_temp.ok('the admin with a check is asked to accept it',
  (select waiting_for_me from public.visible_injuries(true) where body_area = 'Ankle'), true);
reset role;
update public.injuries set status = 'injured', coach_endorsed_by = null where body_area = 'Ankle';

-- Exempt with a reason doesn't count, as for committee members (C6)
update public.profiles set wwcc_exempt_reason = 'Runs the accounts only' where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('an exemption with a reason does not bring it back', pg_temp.reads('Ankle'), false);
reset role;
update public.profiles set wwcc_exempt_reason = null where id = pg_temp.id('02');

-- What brings it back
insert into public.wwcc_applications (profile_id, application_number, lodged_on, kind, receipt_path, recorded_by, declared_at, declaration_text)
values (pg_temp.id('02'), 'APP02', current_date - 5, 'new', '02/r/receipt.pdf', pg_temp.id('01'), now(), 'Declared');
select pg_temp.as_member('02');
select pg_temp.ok('a lodged application in force brings it back', pg_temp.reads('Ankle'), true);
reset role;
update public.wwcc_applications set ended_at = now(), ended_reason = 'withdrawn' where profile_id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('and it goes again when the application ends', pg_temp.reads('Ankle'), false);
reset role;
update public.profiles set wwcc_number = 'WWC0002', wwcc_expires_on = current_date + 365 where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('a current check brings it back', pg_temp.reads('Ankle'), true);

-- An expired card: 30 days' grace from the expiry
reset role;
update public.profiles set wwcc_expires_on = current_date - 1 where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('card expired yesterday: still sees it', pg_temp.reads('Ankle'), true);
reset role;
update public.profiles set wwcc_expires_on = current_date - 30 where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('card expired 30 days ago: still sees it', pg_temp.reads('Ankle'), true);
reset role;
update public.profiles set wwcc_expires_on = current_date - 31 where id = pg_temp.id('02');
select pg_temp.as_member('02');
select pg_temp.ok('card expired 31 days ago: no longer sees it', pg_temp.reads('Ankle'), false);
select pg_temp.ok('their own answer is no', public.my_admin_sees_children_injuries(), false);
-- The committee date doesn't matter once a card is recorded.
reset role;
update public.safeguarding_settings set committee_checks_from = current_date + 90 where id;
select pg_temp.as_member('02');
select pg_temp.ok('an expired card counts even before the committee date', pg_temp.reads('Ankle'), false);

-- A parent volunteer exemption that applies brings it back
reset role;
update public.profiles set extra_roles = '{guardian}' where id = pg_temp.id('02');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('02'), pg_temp.id('32'))
  on conflict do nothing;
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, declared_at, declaration_text)
values (pg_temp.id('02'), 'parent_volunteer', pg_temp.id('31'), 'Jordan Junior', now(), 'Declared');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('02'), pg_temp.id('31'))
  on conflict do nothing;
select pg_temp.as_member('02');
select pg_temp.ok('a parent volunteer exemption that applies counts', public.my_admin_sees_children_injuries(), true);
reset role;
delete from public.volunteer_exemptions where profile_id = pg_temp.id('02');
delete from public.guardianships where guardian_id = pg_temp.id('02');
update public.profiles set extra_roles = '{}' where id = pg_temp.id('02');

-- Committee members are unchanged (C6)
select pg_temp.as_member('21');
select pg_temp.ok('committee with an expired check still does not see it', pg_temp.reads('Ankle'), false);
select pg_temp.as_member('01');
select pg_temp.ok('the admin with a check is unaffected throughout', pg_temp.reads('Ankle'), true);
-- Guardians still see their own child's
select pg_temp.as_member('41');
select pg_temp.ok('a guardian still sees their child''s injury', pg_temp.reads('Ankle'), true);

-- has_role says why statisticians and committee members are screened
-- differently (20261023150000_review_follow_ups.sql).
select pg_temp.ok('has_role explains the statistician and committee rules',
  obj_description('public.has_role(public.app_role)'::regprocedure) like '%is_cleared%committee%', true);
