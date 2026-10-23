-- Tests for 20261023140000_medical_profiles.sql: medical and emergency
-- details (customer review C10). Jordan (31) is under 18, with Logan (41)
-- and Morgan (42, also an assistant coach) as guardians; Kai (32) is an
-- adult. Both are athletes in Sample Squad, whose coach is Casey (11),
-- manager Emery (13) and physio Finley (14). Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, words text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when position(words in sqlerrm) > 0 then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Whether the signed-in member can open an athlete's details.
create or replace function pg_temp.opens(athlete text) returns boolean language plpgsql as
$$ begin perform public.medical_profile(pg_temp.id(athlete)); return true;
   exception when others then return false; end $$;
-- Whether the signed-in member can save an athlete's details.
create or replace function pg_temp.saves(athlete text) returns boolean language plpgsql as
$$ begin
     perform public.save_medical_profile(pg_temp.id(athlete),
       '[{"name": "Sam Sample", "relationship": "Aunt", "phone": "0400 000 000"}]'::jsonb,
       'Asthma', 'Peanuts', 'Ventolin', 'Two puffs, call 000 if no better');
     return true;
   exception when others then return false; end $$;
-- Medical views logged about an athlete.
create or replace function pg_temp.views(athlete text) returns bigint language sql as
$$ select count(*) from public.record_access_log where subject_id = pg_temp.id(athlete) and kind = 'medical' $$;

select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select pg_temp.ok('members can''t read the table directly', has_table_privilege('authenticated', 'public.medical_profiles', 'select'), false);
select pg_temp.ok('or write it', has_table_privilege('authenticated', 'public.medical_profiles', 'insert'), false);
select pg_temp.ok('signed-out visitors get nothing', has_table_privilege('anon', 'public.medical_profiles', 'select'), false);
select pg_temp.ok('the service role has full access', has_table_privilege('service_role', 'public.medical_profiles', 'delete'), true);
select pg_temp.ok('members can open details', has_function_privilege('authenticated', 'public.medical_profile(uuid)', 'execute'), true);
select pg_temp.ok('signed-out visitors can''t', has_function_privilege('anon', 'public.medical_profile(uuid)', 'execute'), false);
select pg_temp.ok('signed-out visitors can''t save', has_function_privilege('anon', 'public.save_medical_profile(uuid, jsonb, text, text, text, text)', 'execute'), false);
select pg_temp.ok('the role helper is closed to the app', has_function_privilege('authenticated', 'public.medical_profile_role(uuid)', 'execute'), false);
select pg_temp.ok('so is the edit helper', has_function_privilege('authenticated', 'public.can_edit_medical_profile(uuid)', 'execute'), false);
select pg_temp.ok('signed out, nobody opens anything', pg_temp.opens('32'), false);

-- ---------------------------------------------------------------------------
-- Who keeps the details
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.ok('Kai (adult) opens their own', pg_temp.opens('32'), true);
select pg_temp.ok('and saves them', pg_temp.saves('32'), true);
select pg_temp.ok('saved with who saved them', (select updated_by_name = 'Kai Senior' and conditions = 'Asthma' and jsonb_array_length(emergency_contacts) = 1 from public.medical_profiles where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('Kai can''t open Jordan''s', pg_temp.opens('31'), false);
select pg_temp.ok('or save them', pg_temp.saves('31'), false);
select pg_temp.ok('opening their own isn''t logged', pg_temp.views('32') = 0, true);
select pg_temp.ok('the profile says they can change it', (select (public.medical_profile(pg_temp.id('32')) ->> 'can_edit')::boolean), true);

select pg_temp.as_member('31');
select pg_temp.ok('Jordan (under 18) reads their own', pg_temp.opens('31'), true);
select pg_temp.ok('but can''t change it', pg_temp.saves('31'), false);
select pg_temp.fails_with('and is told who can', $$select public.save_medical_profile(pg_temp.id('31'), '[]'::jsonb, '', '', '', '')$$, 'a parent or guardian for an under 18');
select pg_temp.ok('the profile says they can''t', (select (public.medical_profile(pg_temp.id('31')) ->> 'can_edit')::boolean), false);

select pg_temp.as_member('41');
select pg_temp.ok('Logan, Jordan''s verified guardian, opens Jordan''s', pg_temp.opens('31'), true);
select pg_temp.ok('and saves them', pg_temp.saves('31'), true);
select pg_temp.ok('a guardian''s opening isn''t logged', pg_temp.views('31') = 0, true);
select pg_temp.ok('Logan can''t open Kai''s', pg_temp.opens('32'), false);

update public.profiles set verified_at = null where id = pg_temp.id('41');
select pg_temp.ok('an unverified guardian can''t open it', pg_temp.opens('31'), false);
select pg_temp.ok('or save it', pg_temp.saves('31'), false);
update public.profiles set verified_at = now() where id = pg_temp.id('41');

-- Saving checks what's saved.
select pg_temp.fails_with('a contact needs a phone number', $$select public.save_medical_profile(pg_temp.id('31'), '[{"name": "Sam"}]'::jsonb, '', '', '', '')$$, 'a name and a phone number');
select pg_temp.fails_with('and a name', $$select public.save_medical_profile(pg_temp.id('31'), '[{"name": " ", "phone": "0400 000 000"}]'::jsonb, '', '', '', '')$$, 'a name and a phone number');
select pg_temp.fails_with('a phone number must look like one', $$select public.save_medical_profile(pg_temp.id('31'), '[{"name": "Sam", "phone": "call me"}]'::jsonb, '', '', '', '')$$, 'Check the phone number for Sam');
select pg_temp.fails_with('at least 6 digits', $$select public.save_medical_profile(pg_temp.id('31'), '[{"name": "Sam", "phone": "123"}]'::jsonb, '', '', '', '')$$, 'Check the phone number');
select pg_temp.fails_with('at most 3 contacts', $$select public.save_medical_profile(pg_temp.id('31'),
  '[{"name": "A", "phone": "0400000001"}, {"name": "B", "phone": "0400000002"}, {"name": "C", "phone": "0400000003"}, {"name": "D", "phone": "0400000004"}]'::jsonb, '', '', '', '')$$, 'up to 3');
select pg_temp.fails_with('contacts must be a list', $$select public.save_medical_profile(pg_temp.id('31'), '{}'::jsonb, '', '', '', '')$$, 'must be a list');
select pg_temp.fails_with('each contact an object', $$select public.save_medical_profile(pg_temp.id('31'), '["Sam"]'::jsonb, '', '', '', '')$$, 'a name and a phone number');
select pg_temp.fails_with('sections have a length limit', $$select public.save_medical_profile(pg_temp.id('31'), '[]'::jsonb, repeat('x', 2001), '', '', '')$$, 'too long');
select pg_temp.fails_with('a contact''s name too', $$select public.save_medical_profile(pg_temp.id('31'), jsonb_build_array(jsonb_build_object('name', repeat('x', 81), 'phone', '0400000000')), '', '', '', '')$$, 'too long');
select pg_temp.works('three contacts, trimmed', $$select public.save_medical_profile(pg_temp.id('31'),
  '[{"name": " Logan Parent ", "relationship": "Parent", "phone": "+61 (400) 000-001"}, {"name": "B", "phone": "0400000002"}, {"name": "C", "phone": "0400000003"}]'::jsonb,
  ' Asthma ', 'Peanuts', 'Ventolin', 'Two puffs')$$);
select pg_temp.ok('saved trimmed, replacing the last save', (select emergency_contacts -> 0 ->> 'name' = 'Logan Parent' and conditions = 'Asthma' and jsonb_array_length(emergency_contacts) = 3 from public.medical_profiles where athlete_id = pg_temp.id('31')), true);
select pg_temp.ok('still one profile for Jordan', (select count(*) = 1 from public.medical_profiles where athlete_id = pg_temp.id('31')), true);
select pg_temp.works('no contacts at all is allowed', $$select public.save_medical_profile(pg_temp.id('31'), '[]'::jsonb, 'Asthma', '', '', '')$$);
select pg_temp.works('put the contacts back', $$select public.save_medical_profile(pg_temp.id('31'), '[{"name": "Logan Parent", "relationship": "Parent", "phone": "0400 000 001"}]'::jsonb, 'Asthma', 'Peanuts', 'Ventolin', 'Two puffs')$$);

select pg_temp.as_member('42');
select pg_temp.ok('Morgan, Jordan''s guardian and a coach, opens as guardian', (select public.medical_profile(pg_temp.id('31')) ->> 'role' = 'guardian'), true);
select pg_temp.ok('and isn''t logged', pg_temp.views('31') = 0, true);

-- Once Jordan turns 18, Jordan keeps them and the guardians lose them.
update public.profiles set date_of_birth = current_date - interval '18 years', under_17 = false where id = pg_temp.id('31');
select pg_temp.as_member('41');
select pg_temp.ok('a guardian can''t open an adult''s', pg_temp.opens('31'), false);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan at 18 saves their own', pg_temp.saves('31'), true);
update public.profiles set date_of_birth = current_date - interval '14 years', under_17 = true where id = pg_temp.id('31');
select pg_temp.as_member('41');
select pg_temp.works('Logan puts Jordan''s back', $$select public.save_medical_profile(pg_temp.id('31'), '[{"name": "Logan Parent", "relationship": "Parent", "phone": "0400 000 001"}]'::jsonb, 'Asthma', 'Peanuts', 'Ventolin', 'Two puffs')$$);

-- ---------------------------------------------------------------------------
-- Who reads them: the athlete's coaches, managers and physios
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('Casey, Kai''s coach, opens Kai''s', pg_temp.opens('32'), true);
select pg_temp.ok('as coach', (select public.medical_profile(pg_temp.id('32')) ->> 'role' = 'coach'), true);
select pg_temp.ok('with the details', (select public.medical_profile(pg_temp.id('32')) ->> 'allergies' = 'Peanuts'), true);
select pg_temp.ok('but can''t change them', pg_temp.saves('32'), false);
select pg_temp.ok('the view is logged once in 30 minutes', pg_temp.views('32') = 1, true);
select pg_temp.ok('as Coach, by name', (select viewer_name = 'Casey Coach' and viewer_role = 'Coach' from public.record_access_log where subject_id = pg_temp.id('32') and kind = 'medical'), true);
select pg_temp.ok('Casey can''t open Jordan''s without health consent', pg_temp.opens('31'), false);
select pg_temp.fails_with('and is told so', $$select public.medical_profile(pg_temp.id('31'))$$, 'can’t see this athlete’s medical details');
select pg_temp.ok('nothing logged for Jordan', pg_temp.views('31') = 0, true);

select pg_temp.as_member('13');
select pg_temp.ok('Emery, Kai''s manager, opens Kai''s', (select public.medical_profile(pg_temp.id('32')) ->> 'role' = 'manager'), true);
select pg_temp.ok('but can''t change them', pg_temp.saves('32'), false);
select pg_temp.ok('Emery can''t open Jordan''s without consent', pg_temp.opens('31'), false);

select pg_temp.as_member('14');
select pg_temp.ok('Finley, the squad''s physio, opens Kai''s', (select public.medical_profile(pg_temp.id('32')) ->> 'role' = 'physio'), true);
select pg_temp.ok('Finley can''t open Jordan''s without consent', pg_temp.opens('31'), false);
select pg_temp.ok('three people have looked at Kai''s', pg_temp.views('32') = 3, true);

-- A parent gives health consent.
insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
values (pg_temp.id('31'), 'health', pg_temp.id('41'), 'Logan Parent', 'v1');
select pg_temp.as_member('11');
select pg_temp.ok('with health consent, Casey opens Jordan''s', pg_temp.opens('31'), true);
select pg_temp.ok('but can''t change them', pg_temp.saves('31'), false);
select pg_temp.as_member('13');
select pg_temp.ok('Emery opens Jordan''s', pg_temp.opens('31'), true);
select pg_temp.as_member('14');
select pg_temp.ok('Finley opens Jordan''s', pg_temp.opens('31'), true);
select pg_temp.ok('each view of Jordan''s is logged', pg_temp.views('31') = 3, true);
select pg_temp.ok('and shows in Jordan''s record views', (select count(*) = 3 from public.record_access_log where subject_id = pg_temp.id('31') and kind = 'medical' and viewer_role in ('Coach', 'Manager', 'Physio')), true);

-- Data consent isn't health consent.
update public.child_consents set withdrawn_at = now() where athlete_id = pg_temp.id('31') and kind = 'health';
insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
values (pg_temp.id('31'), 'data', pg_temp.id('41'), 'Logan Parent', 'v1');
select pg_temp.as_member('11');
select pg_temp.ok('withdrawn health consent closes it again, even with data consent', pg_temp.opens('31'), false);
insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
values (pg_temp.id('31'), 'health', pg_temp.id('41'), 'Logan Parent', 'v1');

-- Everyone else, both ways.
select pg_temp.as_member('01');
select pg_temp.ok('an admin can''t open Kai''s', pg_temp.opens('32'), false);
select pg_temp.ok('or Jordan''s', pg_temp.opens('31'), false);
select pg_temp.ok('or save them', pg_temp.saves('32'), false);
select pg_temp.as_member('21');
select pg_temp.ok('a committee member can''t open Kai''s', pg_temp.opens('32'), false);
select pg_temp.as_member('22');
select pg_temp.ok('nor another', pg_temp.opens('31'), false);
select pg_temp.as_member('12');
select pg_temp.ok('a coach whose check has lapsed can''t open Kai''s', pg_temp.opens('32'), false);
select pg_temp.ok('or Jordan''s', pg_temp.opens('31'), false);

update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
select pg_temp.as_member('11');
select pg_temp.ok('a stood-down coach can''t open Kai''s', pg_temp.opens('32'), false);
update public.profiles set stood_down_at = null where id = pg_temp.id('11');
select pg_temp.ok('and can again once the stand-down is lifted', pg_temp.opens('32'), true);

update public.profiles set wwcc_expires_on = current_date - 1 where id = pg_temp.id('14');
select pg_temp.as_member('14');
select pg_temp.ok('a physio whose check has lapsed can''t open Jordan''s', pg_temp.opens('31'), false);
update public.profiles set wwcc_expires_on = current_date + 400 where id = pg_temp.id('14');

-- A squad whose selections are done: its coach and manager lose it, as with
-- their other access; Jordan is still in Sample Team, which Casey coaches.
update public.teams set selections_completed_at = now() where id = pg_temp.id('a1');
select pg_temp.as_member('13');
select pg_temp.ok('a manager of a squad whose selections are done can''t open Kai''s', pg_temp.opens('32'), false);
select pg_temp.as_member('11');
select pg_temp.ok('Casey can''t open Kai''s either', pg_temp.opens('32'), false);
select pg_temp.ok('but still opens Jordan''s, in Sample Team', pg_temp.opens('31'), true);
update public.teams set selections_completed_at = null where id = pg_temp.id('a1');

-- An archived squad.
update public.teams set archived = true where id = pg_temp.id('a1');
select pg_temp.as_member('14');
select pg_temp.ok('a physio of an archived squad only can''t open Kai''s', pg_temp.opens('32'), false);
update public.profiles set head_physio = true where id = pg_temp.id('14');
select pg_temp.ok('a Head Physio opens anyone''s', pg_temp.opens('32'), true);
update public.profiles set head_physio = false where id = pg_temp.id('14');
update public.teams set archived = false where id = pg_temp.id('a1');

-- A pending member, a former athlete and a non-athlete.
select pg_temp.as_member('11');
update public.profiles set status = 'pending' where id = pg_temp.id('11');
select pg_temp.ok('a coach waiting for approval can''t open anything', pg_temp.opens('32'), false);
update public.profiles set status = 'approved' where id = pg_temp.id('11');
select pg_temp.ok('nobody has details as a non-athlete', pg_temp.opens('13'), false);
select pg_temp.as_member('13');
select pg_temp.ok('not even themselves', pg_temp.opens('13'), false);
select pg_temp.ok('or saves them', pg_temp.saves('13'), false);

-- ---------------------------------------------------------------------------
-- Who looked
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.ok('Kai sees who has looked at theirs', (select count(*) >= 3 from public.medical_profile_views(pg_temp.id('32'))), true);
select pg_temp.ok('by name and role, newest first', (select bool_and(viewer_name is not null and viewer_role is not null) from public.medical_profile_views(pg_temp.id('32'))), true);
select pg_temp.ok('but not who looked at Jordan''s', (select count(*) = 0 from public.medical_profile_views(pg_temp.id('31'))), true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan sees who has looked at Jordan''s', (select count(*) >= 3 from public.medical_profile_views(pg_temp.id('31'))), true);
select pg_temp.ok('and in Jordan''s record views', (select count(*) >= 3 from public.record_access_history(pg_temp.id('31')) where kind = 'medical'), true);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan, under 18, doesn''t', (select count(*) = 0 from public.medical_profile_views(pg_temp.id('31'))), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach doesn''t', (select count(*) = 0 from public.medical_profile_views(pg_temp.id('32'))), true);
select pg_temp.as_member('01');
select pg_temp.ok('nor an admin', (select count(*) = 0 from public.medical_profile_views(pg_temp.id('32'))), true);

-- ---------------------------------------------------------------------------
-- A squad's list for its staff
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('Casey sees Sample Squad''s athletes', (select count(*) = 2 from public.team_medical_profiles(pg_temp.id('a1'))), true);
select pg_temp.ok('who they can open, and who has contacts', (select can_open and has_contacts from public.team_medical_profiles(pg_temp.id('a1')) where athlete_id = pg_temp.id('32')), true);
create temp table views_before as select pg_temp.views('32') as n;
select count(*) from public.team_medical_profiles(pg_temp.id('a1')) where false;
select pg_temp.ok('the list itself isn''t logged', (select pg_temp.views('32') = n from views_before), true);
update public.child_consents set withdrawn_at = now() where athlete_id = pg_temp.id('31') and kind = 'health' and withdrawn_at is null;
select pg_temp.ok('a child without health consent is listed, closed, needing consent', (select not can_open and not has_contacts and needs_consent from public.team_medical_profiles(pg_temp.id('a1')) where athlete_id = pg_temp.id('31')), true);
select pg_temp.as_member('32');
select pg_temp.ok('an athlete gets no list', (select count(*) = 0 from public.team_medical_profiles(pg_temp.id('a1'))), true);
select pg_temp.as_member('41');
select pg_temp.ok('nor a guardian', (select count(*) = 0 from public.team_medical_profiles(pg_temp.id('a1'))), true);
select pg_temp.as_member('01');
select pg_temp.ok('nor an admin not in the squad', (select count(*) = 0 from public.team_medical_profiles(pg_temp.id('a1'))), true);
select pg_temp.as_member('13');
select pg_temp.ok('the manager gets it', (select count(*) = 2 from public.team_medical_profiles(pg_temp.id('a1'))), true);
select pg_temp.as_member('14');
select pg_temp.ok('and the physio', (select count(*) = 2 from public.team_medical_profiles(pg_temp.id('a1'))), true);
update public.teams set archived = true where id = pg_temp.id('a1');
select pg_temp.ok('not for an archived squad', (select count(*) = 0 from public.team_medical_profiles(pg_temp.id('a1'))), true);
update public.teams set archived = false where id = pg_temp.id('a1');

-- ---------------------------------------------------------------------------
-- Keeping
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
delete from auth.users where id = pg_temp.id('32');
select pg_temp.ok('deleting an athlete''s account removes their details', (select count(*) = 0 from public.medical_profiles where athlete_id = pg_temp.id('32')), true);
