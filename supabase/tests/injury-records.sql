-- Tests for 20261022100000_injury_records.sql: physios writing updates and
-- staff logging injuries (C3), the concussion pathway (C4), the club's
-- "Only physios endorse clearances" switch (C5), and committee members
-- seeing an under 18's injuries only when screened (C6). Run on a fresh
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
create or replace function pg_temp.injury(p_area text) returns uuid language sql as
$$ select id from public.injuries where body_area = p_area $$;
-- An uploaded PDF for an injury, as its athlete or guardian would leave it.
create or replace function pg_temp.upload(p_area text) returns text language plpgsql as
$$ declare v_name text;
   begin
     select athlete_id::text || '/' || id::text || '/' || gen_random_uuid() || '.pdf' into v_name
     from public.injuries where body_area = p_area;
     insert into storage.objects (bucket_id, name, metadata)
     values ('injury-documents', v_name, '{"mimetype": "application/pdf"}');
     return v_name;
   end $$;
-- What the signed-in member reads of an injury directly, as the app does.
create or replace function pg_temp.reads_updates(p_area text) returns boolean language plpgsql as
$$ declare v boolean;
   begin
     set local role authenticated;
     select exists (select 1 from public.injury_updates u join public.injuries i on i.id = u.injury_id where i.body_area = p_area) into v;
     reset role;
     return v;
   end $$;
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
create or replace function pg_temp.waiting(p_area text) returns boolean language sql as
$$ select coalesce((select waiting_for_me from public.visible_injuries(true) where body_area = p_area), false) $$;
create or replace function pg_temp.logged_count() returns bigint language sql as
$$ select count(*) from public.my_logged_injuries() $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- More sample people: a coach and a physio with no group in common with
-- the seed athletes, and a committee member who is a parent volunteer.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000016', 'coach.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000017', 'physio.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000061', 'committee.parent@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'athlete.child2@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, date_of_birth = v.dob, verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000016', 'Nico Othercoach', 'coach', 'WWC0016', current_date + 400, null::date),
  ('00000000-0000-0000-0000-000000000017', 'Ola Otherphysio', 'physio', 'WWC0017', current_date + 400, null),
  ('00000000-0000-0000-0000-000000000061', 'Parker Parent-Committee', 'committee', null, null, null),
  ('00000000-0000-0000-0000-000000000062', 'Quinn Junior', 'athlete', null, null, current_date - interval '12 years')
) as v(id, name, role, wwcc, exp, dob)
where p.id = v.id::uuid;
update public.profiles set extra_roles = '{guardian}' where id = pg_temp.id('61');
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('16'), 'coach'),
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('17'), 'physio'),
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.id('62'), 'athlete');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.id('61'), pg_temp.id('62'));
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, declared_at, declaration_text)
values (pg_temp.id('61'), 'parent_volunteer', pg_temp.id('62'), 'Quinn Junior', now(), 'Declared');
-- The seed's injury (Jordan's ankle) is reported by Jordan; keep it apart
-- from the ones below.
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members can log injuries', has_function_privilege('authenticated', 'public.log_injury(uuid, text, text, date, text, date, boolean)', 'execute'), true);
select pg_temp.ok('anon cannot log injuries', has_function_privilege('anon', 'public.log_injury(uuid, text, text, date, text, date, boolean)', 'execute'), false);
select pg_temp.ok('members can list who they can log for', has_function_privilege('authenticated', 'public.injury_loggable_athletes()', 'execute'), true);
select pg_temp.ok('anon cannot list who they can log for', has_function_privilege('anon', 'public.injury_loggable_athletes()', 'execute'), false);
select pg_temp.ok('members can list injuries logged for them', has_function_privilege('authenticated', 'public.my_logged_injuries()', 'execute'), true);
select pg_temp.ok('anon cannot list logged injuries', has_function_privilege('anon', 'public.my_logged_injuries()', 'execute'), false);
select pg_temp.ok('anon cannot mark a logged injury seen', has_function_privilege('anon', 'public.mark_logged_injury_seen(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot read the injury rules', has_function_privilege('anon', 'public.injury_rules()', 'execute'), false);
select pg_temp.ok('anon cannot set the injury rules', has_function_privilege('anon', 'public.admin_set_injury_rules(boolean, integer)', 'execute'), false);
select pg_temp.ok('members can report with concussion', has_function_privilege('authenticated', 'public.report_injury(uuid, text, text, date, text, date, boolean)', 'execute'), true);
select pg_temp.ok('anon cannot report', has_function_privilege('anon', 'public.report_injury(uuid, text, text, date, text, date, boolean)', 'execute'), false);
select pg_temp.ok('members can add updates', has_function_privilege('authenticated', 'public.add_injury_update(uuid, text, text, date, text, text, boolean)', 'execute'), true);
select pg_temp.ok('anon cannot add updates', has_function_privilege('anon', 'public.add_injury_update(uuid, text, text, date, text, text, boolean)', 'execute'), false);
select pg_temp.ok('members can ask for clearance', has_function_privilege('authenticated', 'public.request_clearance(uuid, text, text, text, boolean)', 'execute'), true);
select pg_temp.ok('anon cannot ask for clearance', has_function_privilege('anon', 'public.request_clearance(uuid, text, text, text, boolean)', 'execute'), false);
select pg_temp.ok('anon cannot list injuries', has_function_privilege('anon', 'public.visible_injuries(boolean, uuid)', 'execute'), false);
select pg_temp.ok('the old report_injury is gone', to_regprocedure('public.report_injury(uuid, text, text, date, text, date)') is null, true);
select pg_temp.ok('the old add_injury_update is gone', to_regprocedure('public.add_injury_update(uuid, text, text, date, text, text)') is null, true);
select pg_temp.ok('the old request_clearance is gone', to_regprocedure('public.request_clearance(uuid, text, text, text)') is null, true);
select pg_temp.ok('helpers are closed: manages_athlete', has_function_privilege('authenticated', 'public.manages_athlete(uuid)', 'execute'), false);
select pg_temp.ok('helpers are closed: physio_writes_for', has_function_privilege('authenticated', 'public.physio_writes_for(uuid)', 'execute'), false);
select pg_temp.ok('helpers are closed: can_add_injury_update', has_function_privilege('authenticated', 'public.can_add_injury_update(uuid)', 'execute'), false);
select pg_temp.ok('helpers are closed: injury_logger_role', has_function_privilege('authenticated', 'public.injury_logger_role(uuid)', 'execute'), false);
select pg_temp.ok('helpers are closed: committee_sees_injuries_of', has_function_privilege('authenticated', 'public.committee_sees_injuries_of(uuid)', 'execute'), false);
select pg_temp.ok('helpers are closed: endorsement_needs_physio', has_function_privilege('authenticated', 'public.endorsement_needs_physio(public.injuries)', 'execute'), false);
select pg_temp.ok('helpers are closed: earliest_concussion_clearance', has_function_privilege('authenticated', 'public.earliest_concussion_clearance(public.injuries)', 'execute'), false);
select pg_temp.ok('helpers are closed: could_endorse_clearance', has_function_privilege('authenticated', 'public.could_endorse_clearance(uuid, uuid, boolean)', 'execute'), false);
select pg_temp.ok('members cannot read who has seen logged injuries', has_table_privilege('authenticated', 'public.injury_log_seen', 'select'), false);

-- ---------------------------------------------------------------------------
-- C3: logging an injury at the time
-- ---------------------------------------------------------------------------
-- Casey (11) coaches the squad and team; Emery (13) manages the squad;
-- Finley (14) is the squad's physio. Kai (32) is an adult in the squad,
-- Jordan (31) an under 18 in the squad and team.
select pg_temp.as_member('11');
select pg_temp.works('coach logs Kai''s injury', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Wrist', 'Fell on a drive at training', current_date, 'No catching', current_date + 7)$$);
select pg_temp.ok('logged as the coach', (select logged_by_role = 'coach' and reported_by = pg_temp.id('11') and not concussion and athlete_name = 'Kai Senior' from public.injuries where body_area = 'Wrist'), true);
select pg_temp.ok('its first entry is the coach''s report', (select count(*) = 1 from public.injury_updates where injury_id = pg_temp.injury('Wrist') and kind = 'reported' and author_role = 'coach' and author_name = 'Casey Coach'), true);
select pg_temp.ok('the coach still sees the adult''s injury', pg_temp.reads('Wrist'), true);
select pg_temp.ok('and it lists for them, not as theirs to update', (select not can_report and not can_update and logged_by_role = 'coach' from public.visible_injuries(true) where body_area = 'Wrist'), true);
select pg_temp.fails_with('future day refused', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Toe', 'Stubbed', current_date + 1)$$, 'Choose the day');
select pg_temp.fails_with('blank refused', $$select public.log_injury('00000000-0000-0000-0000-000000000032', ' ', 'Stubbed', current_date)$$, 'Say where');
select pg_temp.ok('coach''s athletes to log for', (select array_agg(athlete_name order by athlete_name) = '{"Jordan Junior","Kai Senior"}' from public.injury_loggable_athletes()), true);

select pg_temp.as_member('13');
select pg_temp.works('manager logs Jordan''s injury', $$select public.log_injury('00000000-0000-0000-0000-000000000031', 'Knee', 'Landed badly in the game', current_date - 1, null, null, true)$$);
select pg_temp.ok('logged as the manager, a suspected concussion', (select logged_by_role = 'manager' and concussion from public.injuries where body_area = 'Knee'), true);
select pg_temp.ok('the manager can''t read what they logged', pg_temp.reads('Knee'), false);
select pg_temp.ok('nor the adult''s', pg_temp.reads('Wrist'), false);
select pg_temp.ok('manager''s athletes to log for', (select count(*) = 2 from public.injury_loggable_athletes()), true);
select pg_temp.ok('manager logs as manager', (select bool_and(logged_as = 'manager') from public.injury_loggable_athletes()), true);

select pg_temp.as_member('14');
select pg_temp.works('squad physio logs Kai''s injury', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Calf', 'Tight calf after sprints', current_date)$$);
select pg_temp.ok('logged as the physio', (select logged_by_role = 'physio' from public.injuries where body_area = 'Calf'), true);
select pg_temp.ok('physio can''t read Jordan''s without consent', pg_temp.reads('Knee'), false);

-- Refused: no group in common, a lapsed check, the athlete's own, family,
-- committee, admins, guests.
select pg_temp.as_member('16');
select pg_temp.fails_with('a coach of another squad can''t log for Kai', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$, 'Only the athlete’s coaches');
select pg_temp.ok('and has nobody to log for but their own', (select array_agg(athlete_name) = '{"Quinn Junior"}' from public.injury_loggable_athletes()), true);
select pg_temp.as_member('17');
select pg_temp.fails('a physio of another squad can''t log for Kai', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select pg_temp.as_member('12');
select pg_temp.fails('a coach with a lapsed check can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select pg_temp.ok('and has nobody to log for', (select count(*) = 0 from public.injury_loggable_athletes()), true);
select pg_temp.as_member('32');
select pg_temp.fails('an athlete can''t log for a teammate', $$select public.log_injury('00000000-0000-0000-0000-000000000031', 'Hip', 'x', current_date)$$);
select pg_temp.fails('nor log their own (they report it)', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select pg_temp.as_member('41');
select pg_temp.fails('a guardian can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000031', 'Hip', 'x', current_date)$$);
select pg_temp.as_member('23');
select pg_temp.fails('committee can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails('nobody signed in can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);

-- A stood-down coach can't; once selections are done the squad's coach and
-- manager can't for an athlete left only in the squad, but its physio can.
update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.as_member('11');
select pg_temp.fails('a stood-down coach can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
update public.profiles set stood_down_at = null where id = pg_temp.id('11');
update public.teams set selections_completed_at = now() where id = pg_temp.id('a1');
select pg_temp.fails('after selections, the squad coach can''t log for Kai', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select pg_temp.ok('but can for Jordan, still in their team', (select array_agg(athlete_name) = '{"Jordan Junior"}' from public.injury_loggable_athletes()), true);
select pg_temp.as_member('13');
select pg_temp.fails('after selections, the squad manager can''t log', $$select public.log_injury('00000000-0000-0000-0000-000000000032', 'Hip', 'x', current_date)$$);
select pg_temp.as_member('14');
select pg_temp.ok('the squad physio still can', (select count(*) = 2 from public.injury_loggable_athletes()), true);
update public.teams set selections_completed_at = null where id = pg_temp.id('a1');
-- A Head Physio can log for any athlete.
update public.profiles set head_physio = true where id = pg_temp.id('17');
select pg_temp.as_member('17');
select pg_temp.ok('a Head Physio can log for every athlete', (select count(*) = 3 from public.injury_loggable_athletes()), true);
update public.profiles set head_physio = false where id = pg_temp.id('17');

-- ---------------------------------------------------------------------------
-- C3: the athlete and parents are told
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.ok('Kai has two logged injuries to look at', pg_temp.logged_count() = 2, true);
select pg_temp.ok('named with who logged it', (select logged_by_name = 'Casey Coach' and logged_by_role = 'coach' from public.my_logged_injuries() where body_area = 'Wrist'), true);
select pg_temp.ok('and Kai can update what the coach logged', (select can_report and can_update from public.visible_injuries(true) where body_area = 'Wrist'), true);
select pg_temp.works('Kai opens the wrist', $$select public.mark_logged_injury_seen(pg_temp.injury('Wrist'))$$);
select pg_temp.ok('one left', pg_temp.logged_count() = 1, true);
select pg_temp.works('opening it again changes nothing', $$select public.mark_logged_injury_seen(pg_temp.injury('Wrist'))$$);
select pg_temp.works('opening one they reported themselves does nothing', $$select public.mark_logged_injury_seen(pg_temp.injury('Ankle'))$$);
select pg_temp.ok('nothing recorded for the ankle', (select count(*) = 0 from public.injury_log_seen where injury_id = pg_temp.injury('Ankle')), true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach who logged it isn''t asked to look at it', pg_temp.logged_count() = 0, true);
select pg_temp.works('a coach opening it records nothing', $$select public.mark_logged_injury_seen(pg_temp.injury('Calf'))$$);
select pg_temp.ok('so Kai still has the calf', (select count(*) = 0 from public.injury_log_seen where member_id = pg_temp.id('11')), true);

select pg_temp.as_member('31');
select pg_temp.ok('Jordan has the manager''s one', (select count(*) = 1 from public.my_logged_injuries() where body_area = 'Knee' and logged_by_name = 'Emery Manager'), true);
select pg_temp.works('Jordan opens it', $$select public.mark_logged_injury_seen(pg_temp.injury('Knee'))$$);
select pg_temp.ok('gone from Jordan''s list', pg_temp.logged_count() = 0, true);
select pg_temp.as_member('41');
select pg_temp.ok('still on Logan''s list (each person sees it)', (select count(*) = 1 from public.my_logged_injuries() where body_area = 'Knee'), true);
select pg_temp.ok('Logan''s What''s changed says who logged it', (select count(*) = 1 from public.child_activity(pg_temp.id('31')) where kind = 'injury' and summary = 'Emery Manager (manager) logged an injury for Jordan Junior: Knee.'), true);
select pg_temp.ok('and the injury Jordan reported isn''t in it', (select count(*) = 0 from public.child_activity(pg_temp.id('31')) where summary like '%Ankle%'), true);
select pg_temp.as_member('42');
select pg_temp.ok('Morgan, also a guardian, has it too', (select count(*) = 1 from public.my_logged_injuries() where body_area = 'Knee'), true);
select pg_temp.as_member('13');
select pg_temp.ok('the manager sees no What''s changed', (select count(*) = 0 from public.child_activity(pg_temp.id('31'))), true);
select pg_temp.as_member('01');
select pg_temp.ok('admins see it in What''s changed', (select count(*) = 1 from public.child_activity(pg_temp.id('31')) where kind = 'injury'), true);
select pg_temp.ok('admins have no logged injuries to look at', pg_temp.logged_count() = 0, true);

-- ---------------------------------------------------------------------------
-- C3: physio updates
-- ---------------------------------------------------------------------------
select pg_temp.as_member('14');
select pg_temp.works('physio updates Kai''s wrist', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Sprain, strapping for two weeks', 'No ball work', current_date + 14)$$);
select pg_temp.ok('the injury takes the physio''s restrictions', (select restrictions = 'No ball work' and expected_return = current_date + 14 from public.injuries where body_area = 'Wrist'), true);
select pg_temp.ok('the update is marked as the physio''s', (select author_role = 'physio' and author_name = 'Finley Physio' from public.injury_updates where injury_id = pg_temp.injury('Wrist') and kind = 'physio_update'), true);
select pg_temp.ok('the physio can update it', (select can_update from public.visible_injuries(true) where body_area = 'Wrist'), true);
select pg_temp.ok('the physio may attach for an adult: photos', public.injury_document_rule(pg_temp.id('32')) = 'photos', true);
select pg_temp.ok('the physio may attach for Jordan: no rule without consent', public.injury_document_rule(pg_temp.id('31')) is null, true);
select pg_temp.fails_with('physio can''t update Jordan''s without consent', $$select public.add_injury_update(pg_temp.injury('Knee'), 'Seen')$$, 'Only the athlete, their guardians and their physios');
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t add updates', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Looks fine')$$);
select pg_temp.ok('nor attach', public.injury_document_rule(pg_temp.id('32')) is null, true);
select pg_temp.as_member('13');
select pg_temp.fails('a manager can''t add updates', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Looks fine')$$);
select pg_temp.as_member('17');
select pg_temp.fails('a physio of another squad can''t', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Looks fine')$$);
select pg_temp.as_member('22');
select pg_temp.fails('committee can''t', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Looks fine')$$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin can''t', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Looks fine')$$);
update public.profiles set stood_down_at = now() where id = pg_temp.id('14');
select pg_temp.as_member('14');
select pg_temp.fails('a stood-down physio can''t', $$select public.add_injury_update(pg_temp.injury('Wrist'), 'Looks fine')$$);
update public.profiles set stood_down_at = null where id = pg_temp.id('14');

-- With consent, the physio updates Jordan's and attaches the letter.
select pg_temp.as_member('41');
select pg_temp.works('Logan consents for Jordan', $$select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true)$$);
select pg_temp.as_member('14');
select pg_temp.ok('physio may attach for Jordan: letters only', public.injury_document_rule(pg_temp.id('31')) = 'letter', true);
select pg_temp.works('physio confirms a photo of the letter', $$select public.confirm_injury_photo(pg_temp.id('31')::text || '/' || pg_temp.injury('Knee')::text || '/scan.jpg', 'letter')$$);
select pg_temp.ok('the declaration names the physio', (select declared_by_role = 'Physio' from public.injury_photo_declarations where document_path like '%/scan.jpg'), true);
select pg_temp.fails('but not a photo of the injury', $$select public.confirm_injury_photo(pg_temp.id('31')::text || '/' || pg_temp.injury('Knee')::text || '/knee.jpg', 'injury')$$);
select pg_temp.ok('physio may upload the letter', public.can_upload_injury_document(pg_temp.id('31')::text || '/' || pg_temp.injury('Knee')::text || '/report.pdf'), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.upload('Knee') as path \gset
select pg_temp.as_member('14');
select pg_temp.works('physio updates Jordan''s knee with the report', format($$select public.add_injury_update(pg_temp.injury('Knee'), 'Assessed, concussion protocol started', 'No contact', current_date + 21, %L, 'report.pdf')$$, :'path'));
select pg_temp.ok('the update keeps the report', (select count(*) = 1 from public.injury_updates where injury_id = pg_temp.injury('Knee') and document_name = 'report.pdf' and author_role = 'physio'), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach may not upload', public.can_upload_injury_document(pg_temp.id('31')::text || '/' || pg_temp.injury('Knee')::text || '/report2.pdf'), false);

-- ---------------------------------------------------------------------------
-- C4: concussion
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.works('Kai reports a concussion', $$select public.report_injury('00000000-0000-0000-0000-000000000032', 'Head', 'Knock to the head in a contest', current_date - 5, null, current_date + 20, true)$$);
select pg_temp.ok('it''s a concussion', (select concussion and logged_by_role is null from public.injuries where body_area = 'Head'), true);
select pg_temp.ok('its report says so', (select concussion from public.injury_updates where injury_id = pg_temp.injury('Head') and kind = 'reported'), true);
select pg_temp.ok('earliest clearance is day 21', (select earliest_clearance = current_date + 16 and needs_physio from public.visible_injuries(true) where body_area = 'Head'), true);
select pg_temp.ok('not a concussion: no earliest day', (select earliest_clearance is null and not concussion and not needs_physio from public.visible_injuries(true) where body_area = 'Wrist'), true);
select pg_temp.works('report without the flag is not a concussion', $$select public.report_injury('00000000-0000-0000-0000-000000000032', 'Shin', 'Bruised shin', current_date)$$);
select pg_temp.ok('shin isn''t a concussion', (select not concussion from public.injuries where body_area = 'Shin'), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.upload('Head') as head_letter \gset
select pg_temp.as_member('32');
select pg_temp.fails_with('too early to ask for clearance', format($$select public.request_clearance(pg_temp.injury('Head'), null, %L, 'letter.pdf', true)$$, :'head_letter'), 'After a concussion, clearance can be asked for from');
update public.injuries set injured_on = current_date - 21 where body_area = 'Head';
select pg_temp.fails_with('day 21 needs a doctor''s clearance', format($$select public.request_clearance(pg_temp.injury('Head'), null, %L, 'letter.pdf')$$, :'head_letter'), 'attach a doctor’s clearance');
select pg_temp.works('with a doctor''s clearance on day 21', format($$select public.request_clearance(pg_temp.injury('Head'), 'GP cleared', %L, 'gp.pdf', true)$$, :'head_letter'));
select pg_temp.ok('the request records the doctor''s clearance', (select doctor_clearance from public.injury_updates where injury_id = pg_temp.injury('Head') and kind = 'clearance_requested'), true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach isn''t asked to endorse a concussion', pg_temp.waiting('Head'), false);
select pg_temp.fails_with('and can''t', $$select public.endorse_clearance(pg_temp.injury('Head'))$$, 'After a concussion, only a physio');
select pg_temp.as_member('14');
select pg_temp.ok('the physio is asked', pg_temp.waiting('Head'), true);
select pg_temp.works('the physio endorses it', $$select public.endorse_clearance(pg_temp.injury('Head'), 'Return to play stages done')$$);
select pg_temp.as_member('22');
select pg_temp.works('a committee member accepts it', $$select public.accept_clearance(pg_temp.injury('Head'))$$);

-- Other injuries: an ordinary request needs no doctor and can be any day.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.upload('Shin') as shin_letter \gset
select pg_temp.as_member('32');
select pg_temp.works('an ordinary clearance the same day', format($$select public.request_clearance(pg_temp.injury('Shin'), null, %L, 'letter.pdf')$$, :'shin_letter'));
select pg_temp.ok('without a doctor''s clearance recorded', (select not doctor_clearance from public.injury_updates where injury_id = pg_temp.injury('Shin') and kind = 'clearance_requested'), true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach is asked to endorse it', pg_temp.waiting('Shin'), true);

-- Marking and unmarking.
select pg_temp.works('Kai marks the calf as a concussion', $$select 1$$);
select pg_temp.as_member('32');
select pg_temp.works('athlete marks an injury as a suspected concussion', $$select public.add_injury_update(pg_temp.injury('Calf'), 'Also hit my head', null, current_date + 21, null, null, true)$$);
select pg_temp.ok('the calf is now a concussion', (select concussion from public.injuries where body_area = 'Calf'), true);
select pg_temp.fails_with('the athlete can''t unmark it', $$select public.add_injury_update(pg_temp.injury('Calf'), 'It was nothing', null, current_date + 3, null, null, false)$$, 'Only a physio can say it isn’t a concussion');
select pg_temp.works('repeating true changes nothing', $$select public.add_injury_update(pg_temp.injury('Calf'), 'Still sore', null, current_date + 21, null, null, true)$$);
select pg_temp.ok('and isn''t recorded as a change', (select count(*) = 1 from public.injury_updates where injury_id = pg_temp.injury('Calf') and concussion is true and kind = 'physio_update'), true);
select pg_temp.as_member('14');
select pg_temp.works('the physio rules it out', $$select public.add_injury_update(pg_temp.injury('Calf'), 'No concussion signs on assessment', null, current_date + 3, null, null, false)$$);
select pg_temp.ok('the calf is no longer a concussion', (select not concussion from public.injuries where body_area = 'Calf'), true);
select pg_temp.ok('the physio''s update records it', (select count(*) = 1 from public.injury_updates where injury_id = pg_temp.injury('Calf') and concussion is false and author_role = 'physio'), true);

-- The club's minimum: 21 or 12 days, set by admins only.
select pg_temp.as_member('31');
select pg_temp.ok('everyone reads the rules: 21 days, coaches endorse', (select not physio_only_endorsement and concussion_min_days = 21 from public.injury_rules()), true);
select pg_temp.fails('an athlete can''t change them', $$select public.admin_set_injury_rules(false, 12)$$);
select pg_temp.as_member('22');
select pg_temp.fails('committee can''t change them', $$select public.admin_set_injury_rules(false, 12)$$);
select pg_temp.as_member('01');
select pg_temp.fails_with('only 12 or 21', $$select public.admin_set_injury_rules(false, 14)$$, 'Choose 21 days');
select pg_temp.fails('the switch must be chosen', $$select public.admin_set_injury_rules(null, 21)$$);
select pg_temp.works('an admin picks 12 days', $$select public.admin_set_injury_rules(false, 12)$$);
select pg_temp.as_member('41');
select pg_temp.ok('Jordan''s knee can be asked for 12 days after', (select earliest_clearance = injured_on + 12 from public.visible_injuries(true) where body_area = 'Knee'), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in reads no rules', (select count(*) = 0 from public.injury_rules()), true);

-- ---------------------------------------------------------------------------
-- C5: "Only physios endorse clearances"
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('an admin turns on physio-only endorsement', $$select public.admin_set_injury_rules(true, 21)$$);
select pg_temp.as_member('11');
select pg_temp.ok('the coach is no longer asked for the shin', pg_temp.waiting('Shin'), false);
select pg_temp.fails_with('and can''t endorse it', $$select public.endorse_clearance(pg_temp.injury('Shin'))$$, 'At this club, only a physio');
select pg_temp.as_member('01');
select pg_temp.ok('a physio is in the squad, so nothing is stuck', (select count(*) = 0 from public.admin_unendorsable_clearances() where body_area = 'Shin'), true);
delete from public.team_members where team_id = pg_temp.id('a1') and profile_id = pg_temp.id('14');
select pg_temp.ok('without one, the shin is stuck though a coach is there', (select count(*) = 1 from public.admin_unendorsable_clearances() where body_area = 'Shin'), true);
select pg_temp.works('switch off again', $$select public.admin_set_injury_rules(false, 21)$$);
select pg_temp.ok('the coach can endorse, so nothing is stuck', (select count(*) = 0 from public.admin_unendorsable_clearances() where body_area = 'Shin'), true);
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.id('a1'), pg_temp.id('14'), 'physio');
select pg_temp.as_member('11');
select pg_temp.works('the coach endorses the shin', $$select public.endorse_clearance(pg_temp.injury('Shin'))$$);

-- ---------------------------------------------------------------------------
-- C6: committee members see an under 18's injuries only when screened
-- ---------------------------------------------------------------------------
-- Jordan's injuries, with Logan's consent. Indy (23) is exempt as
-- Treasurer only; Gale (21) has a lapsed check; Harper (22) has none yet,
-- before the club's checks date; Parker (61) is a parent volunteer.
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee: not Jordan''s', pg_temp.reads('Knee'), false);
select pg_temp.ok('exempt committee: not listed either', pg_temp.listed('Knee'), false);
select pg_temp.ok('exempt committee: still sees adults''', pg_temp.reads('Wrist'), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee with no check yet: not Jordan''s', pg_temp.reads('Knee'), false);
select pg_temp.ok('but adults''', pg_temp.reads('Wrist'), true);
select pg_temp.as_member('21');
select pg_temp.ok('lapsed committee: not Jordan''s', pg_temp.reads('Knee'), false);
select pg_temp.as_member('61');
select pg_temp.ok('parent volunteer committee: Jordan''s', pg_temp.reads('Knee'), true);
update public.profiles set wwcc_number = 'WWC0022', wwcc_expires_on = current_date + 300 where id = pg_temp.id('22');
select pg_temp.as_member('22');
select pg_temp.ok('committee with a current check: Jordan''s', pg_temp.reads('Knee'), true);
select pg_temp.ok('and its updates', pg_temp.reads_updates('Knee'), true);
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee: not its updates', pg_temp.reads_updates('Knee'), false);
select pg_temp.as_member('22');
select pg_temp.as_member('02');
select pg_temp.ok('an admin with no check: Jordan''s', pg_temp.reads('Knee'), true);
update public.profiles set stood_down_at = now() where id = pg_temp.id('02');
select pg_temp.ok('a stood-down admin: not Jordan''s', pg_temp.reads('Knee'), false);
update public.profiles set stood_down_at = null where id = pg_temp.id('02');

-- Signing off Jordan's ankle (the seed's), endorsed by the physio.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.upload('Ankle') as ankle_letter \gset
select pg_temp.as_member('31');
select pg_temp.works('Jordan asks for clearance', format($$select public.request_clearance(pg_temp.injury('Ankle'), null, %L, 'letter.pdf')$$, :'ankle_letter'));
select pg_temp.as_member('23');
select pg_temp.fails('exempt committee can''t send back an under 18''s request', $$select public.send_back_clearance(pg_temp.injury('Ankle'), 'Wrong letter')$$);
select pg_temp.as_member('14');
select pg_temp.works('the physio endorses Jordan''s ankle', $$select public.endorse_clearance(pg_temp.injury('Ankle'))$$);
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee isn''t asked to accept', pg_temp.waiting('Ankle'), false);
select pg_temp.fails_with('and can''t accept', $$select public.accept_clearance(pg_temp.injury('Ankle'))$$, 'Only a committee member with a current Working With Children Check');
select pg_temp.fails('nor send it back', $$select public.send_back_clearance(pg_temp.injury('Ankle'), 'Wrong letter')$$);
select pg_temp.ok('nor share its documents', (select public.can_share_injury_documents(i) from public.injuries i where body_area = 'Ankle'), false);
select pg_temp.as_member('61');
select pg_temp.ok('the parent volunteer committee member is asked', pg_temp.waiting('Ankle'), true);
select pg_temp.ok('and may share its documents', (select public.can_share_injury_documents(i) from public.injuries i where body_area = 'Ankle'), true);
select pg_temp.as_member('22');
select pg_temp.works('the screened committee member accepts it', $$select public.accept_clearance(pg_temp.injury('Ankle'))$$);
select pg_temp.ok('Jordan is cleared', (select status = 'cleared' from public.injuries where body_area = 'Ankle'), true);

-- The exempt committee member still signs off adults.
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee is asked to accept Kai''s shin', pg_temp.waiting('Shin'), true);
select pg_temp.works('and accepts it', $$select public.accept_clearance(pg_temp.injury('Shin'))$$);

-- ---------------------------------------------------------------------------
-- The migration runs again cleanly
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
\ir ../migrations/20261022100000_injury_records.sql
select pg_temp.ok('re-run keeps the rows', (select count(*) = 6 from public.injuries), true);
select pg_temp.ok('re-run keeps the settings', (select not physio_only_endorsement and concussion_min_days = 21 from public.safeguarding_settings where id), true);
