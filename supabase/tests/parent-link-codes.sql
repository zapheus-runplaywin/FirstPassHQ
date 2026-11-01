-- Tests for 20261101000000_parent_link_codes.sql: a child's link code, a
-- parent or guardian entering it, approving them, the lock on a child with no
-- verified guardian (refused across the club's features, and lifted again),
-- the notice to admins when a child is locked again, and guardians following
-- their child into and out of squads. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

-- Supabase lets the API role read these tables and relies on row level
-- security; the local stubs give it nothing.
grant select on public.profiles, public.guardianships, public.check_ins, public.injuries,
  public.messages, public.message_recipients, public.fixtures, public.calendars,
  public.team_members, public.team_captains, public.awards, public.club_captains to authenticated;
grant select, insert on public.personal_tasks to authenticated;

create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.fails_with(label text, statement text, needle text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like '%' || needle || '%' then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Rows a query returns for the member signed in now, or -1 when refused.
create or replace function pg_temp.n(q text) returns bigint language plpgsql as
$$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r;
   exception when others then return -1; end $$;
-- The newest notice and who got it.
create or replace function pg_temp.last_notice() returns text language sql as
$$ select body from public.messages where audience = 'notice' order by created_at desc, id desc limit 1 $$;
create or replace function pg_temp.last_notice_to() returns text language sql as
$$ select string_agg(right(r.profile_id::text, 2), ',' order by r.profile_id)
   from public.message_recipients r
   where r.message_id = (select id from public.messages where audience = 'notice' order by created_at desc, id desc limit 1) $$;
-- Who got the newest notice whose text matches: one save can send more than
-- one notice at the same moment, such as a parent with two children leaving.
create or replace function pg_temp.notice_to(p_like text) returns text language sql as
$$ select string_agg(right(r.profile_id::text, 2), ',' order by r.profile_id)
   from public.message_recipients r
   where r.message_id = (select id from public.messages where audience = 'notice' and body like p_like
                         order by created_at desc, id desc limit 1) $$;
create temp table codes (k text primary key, v text);
grant all on codes to authenticated;

-- Sample people for this file: Sam Taylor (61) and another Sam Taylor (64),
-- both 13 and asking to join as athletes; Robin Taylor (62), Sam's parent,
-- asking to join as a parent or guardian; Quinn (63), someone else asking to
-- join as a parent; Ash (65), asking to join as an athlete aged 30.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'sam.taylor@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'robin.taylor@example.test', now()),
  ('00000000-0000-0000-0000-000000000063', 'quinn@example.test', now()),
  ('00000000-0000-0000-0000-000000000064', 'sam.taylor2@example.test', now()),
  ('00000000-0000-0000-0000-000000000065', 'ash@example.test', now());

-- ---------------------------------------------------------------------------
-- 1. A child asking to join gets a link code; nobody else does.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('61');
select pg_temp.ok('Sam asks to join as an athlete aged 13', public.submit_join_request('Sam Taylor', 'sam.taylor@example.test', 'athlete', '00000000-0000-0000-0000-0000000000a1', null, (current_date - interval '13 years')::date, 'robin.taylor@example.test') is null, true);
select pg_temp.ok('Sam is waiting for a parent or guardian', (select waiting from public.my_link_code()), true);
insert into codes select 'sam1', code from public.my_link_code();
select pg_temp.ok('the code is 6 characters with no look-alikes (0, O, 1, I, L)', (select v ~ '^[2-9A-HJKMNP-Z]{6}$' from codes where k = 'sam1'), true);
select pg_temp.ok('it lasts 7 days', (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days' from public.my_link_code()), true);
select pg_temp.ok('asking again gives the same code', (select code from public.my_link_code()) = (select v from codes where k = 'sam1'), true);
select pg_temp.ok('nobody has entered it yet', (select cardinality(parents_waiting) = 0 from public.my_link_code()), true);
insert into codes select 'sam2', code from public.new_link_code();
select pg_temp.ok('a new code replaces it', (select v from codes where k = 'sam2') <> (select v from codes where k = 'sam1') and (select code from public.my_link_code()) = (select v from codes where k = 'sam2'), true);

select pg_temp.as_member('64');
select pg_temp.ok('the other Sam Taylor asks to join too', public.submit_join_request('Sam Taylor', '', 'athlete', '00000000-0000-0000-0000-0000000000a1', null, (current_date - interval '13 years')::date, 'other.parent@example.test') is null, true);
insert into codes select 'sam64', code from public.my_link_code();
select pg_temp.ok('and gets a different code', (select v from codes where k = 'sam64') not in (select v from codes where k in ('sam1', 'sam2')), true);

select pg_temp.as_member('65');
select pg_temp.ok('an adult asking to join as an athlete', public.submit_join_request('Ash Adult', '', 'athlete', null, null, (current_date - interval '30 years')::date, null) is null, true);
select pg_temp.ok('an adult has no code', (select not waiting and code is null from public.my_link_code()), true);
select pg_temp.fails_with('an adult can''t make one', $$select * from public.new_link_code()$$, 'Only an athlete under 18');
select pg_temp.as_member('32');
select pg_temp.ok('an approved adult athlete has no code', (select not waiting and code is null from public.my_link_code()), true);
select pg_temp.as_member('31');
select pg_temp.ok('an approved child with a verified guardian has no code', (select not waiting and code is null from public.my_link_code()), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach has no code', (select not waiting from public.my_link_code()), true);

-- Nobody reads codes or wrong tries directly; requests only through the rules.
select pg_temp.ok('members have no privilege on codes', has_table_privilege('authenticated', 'public.guardian_link_codes', 'select'), false);
select pg_temp.ok('members have no privilege on wrong tries', has_table_privilege('authenticated', 'public.guardian_link_code_attempts', 'select'), false);
select pg_temp.ok('members cannot add a request directly', has_table_privilege('authenticated', 'public.guardian_link_requests', 'insert'), false);
select pg_temp.ok('members cannot check who is locked', has_function_privilege('authenticated', 'public.is_locked_child(uuid)', 'execute'), false);
select pg_temp.ok('members cannot make a code for someone else', has_function_privilege('authenticated', 'public.issue_link_code(uuid)', 'execute'), false);
select pg_temp.ok('signed-out visitors cannot enter a code', has_function_privilege('anon', 'public.enter_child_code(text)', 'execute'), false);
select pg_temp.ok('signed-out visitors cannot read a code', has_function_privilege('anon', 'public.my_link_code()', 'execute'), false);

-- ---------------------------------------------------------------------------
-- 2. A parent or guardian enters the code.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('62');
select pg_temp.fails_with('someone who hasn''t asked to join as a parent can''t enter one',
  format('select public.enter_child_code(%L)', (select v from codes where k = 'sam2')), 'Ask to join as a parent or guardian first');
select pg_temp.ok('Robin asks to join as a parent or guardian', public.submit_join_request('Robin Taylor', 'robin.taylor@example.test', 'guardian', null, null, (current_date - interval '45 years')::date, null) is null, true);
select pg_temp.as_member('64');
select pg_temp.fails_with('a child asking to join can''t enter another child''s code',
  format('select public.enter_child_code(%L)', (select v from codes where k = 'sam2')), 'Ask to join as a parent or guardian first');

select pg_temp.as_member('62');
select pg_temp.ok('the replaced code doesn''t work', public.enter_child_code((select v from codes where k = 'sam1')) like 'That code isn’t right%', true);
select pg_temp.ok('a made-up code doesn''t work', public.enter_child_code('ZZZ-ZZZ') like 'That code isn’t right%', true);
select pg_temp.ok('three more wrong codes', (select bool_and(public.enter_child_code('ABC-DE' || x) like 'That code isn’t right%') from unnest(array['F', 'G', 'H']) x), true);
select pg_temp.ok('after five wrong codes the right one is refused for the hour',
  public.enter_child_code((select v from codes where k = 'sam2')) like 'Too many wrong codes. Try again in %minutes.', true);
reset role;
update public.guardian_link_code_attempts set attempted_at = now() - interval '61 minutes' where profile_id = pg_temp.m('62');
select pg_temp.as_member('62');
select pg_temp.ok('an hour later the right code works, written with a dash and in lower case',
  public.enter_child_code(lower(substr((select v from codes where k = 'sam2'), 1, 3) || '-' || substr((select v from codes where k = 'sam2'), 4))) is null, true);
select pg_temp.ok('Robin is waiting to be linked to Sam', (select array_agg(athlete_name) = array['Sam Taylor'] from public.my_link_requests()), true);
select pg_temp.ok('the request is for exactly that Sam Taylor, not the other',
  (select count(*) = 1 and bool_and(athlete_id = pg_temp.m('61')) from public.guardian_link_requests where guardian_id = pg_temp.m('62')), true);
select pg_temp.ok('entering it again says so', public.enter_child_code((select v from codes where k = 'sam2')) like 'That code isn’t right%', true);

select pg_temp.as_member('63');
select pg_temp.ok('Quinn asks to join as a parent', public.submit_join_request('Quinn Stranger', 'quinn@example.test', 'guardian', null, null, null, null) is null, true);
select pg_temp.ok('a used code doesn''t work for anyone else', public.enter_child_code((select v from codes where k = 'sam2')) like 'That code isn’t right%', true);
select pg_temp.ok('so Quinn has no request', (select count(*) = 0 from public.my_link_requests()), true);

select pg_temp.as_member('61');
select pg_temp.ok('Sam sees Robin entered the code', (select parents_waiting = array['Robin Taylor'] from public.my_link_code()), true);
select pg_temp.ok('and has a fresh code for another parent', (select code not in (select v from codes) and code ~ '^[2-9A-HJKMNP-Z]{6}$' from public.my_link_code()), true);
insert into codes select 'sam3', code from public.my_link_code();
reset role;
update public.guardian_link_codes set expires_at = now() - interval '1 minute' where code = (select v from codes where k = 'sam3');
select pg_temp.as_member('63');
select pg_temp.ok('an expired code doesn''t work', public.enter_child_code((select v from codes where k = 'sam3')) like 'That code isn’t right%', true);

-- Who reads the requests.
set role authenticated;
select pg_temp.as_member('62');
select pg_temp.ok('the parent reads their own request', pg_temp.n('select 1 from public.guardian_link_requests') = 1, true);
select pg_temp.as_member('61');
select pg_temp.ok('the child doesn''t read requests', pg_temp.n('select 1 from public.guardian_link_requests') = 0, true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach doesn''t read requests', pg_temp.n('select 1 from public.guardian_link_requests') = 0, true);
select pg_temp.as_member('63');
select pg_temp.ok('another parent doesn''t read them', pg_temp.n('select 1 from public.guardian_link_requests') = 0, true);
select pg_temp.as_member('01');
select pg_temp.ok('admins read every request', pg_temp.n('select 1 from public.guardian_link_requests') = 1, true);
select pg_temp.ok('nobody reads a code, admins included', pg_temp.n('select 1 from public.guardian_link_codes') = -1, true);
reset role;

-- ---------------------------------------------------------------------------
-- 3. Approving: the child first (locked), then the verified parent, which
-- links them and unlocks the child.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.fails_with('a parent who isn''t verified can''t be approved',
  $$select public.admin_save_member('00000000-0000-0000-0000-000000000062', 'guardian', 'approved')$$, 'Verify who they are');
select pg_temp.works('the admin records checking Robin against PlayHQ',
  $$select public.admin_record_verification('00000000-0000-0000-0000-000000000062', 'playhq', 'Listed as Sam''s parent in PlayHQ')$$);
select pg_temp.fails_with('a parent whose child isn''t approved yet can''t be approved',
  $$select public.admin_save_member('00000000-0000-0000-0000-000000000062', 'guardian', 'approved')$$, 'Approve their child first');
select pg_temp.works('the admin verifies Quinn too',
  $$select public.admin_record_verification('00000000-0000-0000-0000-000000000063', 'id_sighted', 'Licence sighted')$$);
select pg_temp.fails_with('a parent with no child''s code can''t be approved',
  $$select public.admin_save_member('00000000-0000-0000-0000-000000000063', 'guardian', 'approved')$$, 'haven’t entered their child’s link code');
select pg_temp.works('the admin records Sam''s date of birth',
  $$select public.admin_set_member_details('00000000-0000-0000-0000-000000000061', (current_date - interval '13 years')::date, null, null)$$);
select pg_temp.works('the child is approved with no guardian linked, into the squad',
  $$select public.admin_save_member('00000000-0000-0000-0000-000000000061', 'athlete', 'approved', '[{"team_id": "00000000-0000-0000-0000-0000000000a1"}]', true, '{}')$$);
select pg_temp.ok('Sam is locked', public.is_locked_child(pg_temp.m('61')), true);
select pg_temp.ok('the admin''s to-do counts Sam as locked', (select minors_without_guardian = 1 from public.admin_safety_todos()), true);
select pg_temp.as_member('61');
select pg_temp.ok('locked Sam isn''t approved to the database', public.is_approved(), false);
select pg_temp.ok('locked Sam holds no role', public.has_role('athlete'), false);
select pg_temp.ok('locked Sam isn''t a member of the squad', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);
select pg_temp.ok('locked Sam still has the waiting screen and a code', (select waiting and code is not null from public.my_link_code()), true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach sees locked Sam on the squad roster', exists (select 1 from public.team_roster('00000000-0000-0000-0000-0000000000a1') where profile_id = pg_temp.m('61')), true);
select pg_temp.ok('and on the attendance register', exists (select 1 from public.attendance_roster('00000000-0000-0000-0000-0000000000a1') r where r.profile_id = pg_temp.m('61')), true);

select pg_temp.as_member('11');
select pg_temp.fails_with('a coach can''t approve a parent', $$select public.admin_save_member('00000000-0000-0000-0000-000000000062', 'guardian', 'approved')$$, 'Only admins');
select pg_temp.as_member('01');
select pg_temp.works('the admin approves Robin', $$select public.admin_save_member('00000000-0000-0000-0000-000000000062', 'guardian', 'approved')$$);
select pg_temp.ok('Robin is linked to Sam', exists (select 1 from public.guardianships where guardian_id = pg_temp.m('62') and athlete_id = pg_temp.m('61')), true);
select pg_temp.ok('the request is done', exists (select 1 from public.guardian_link_requests where guardian_id = pg_temp.m('62')), false);
select pg_temp.ok('the history says why', (select reason = 'Entered the child’s link code' and change = 'linked' from public.guardianship_history where guardian_id = pg_temp.m('62') order by changed_at desc limit 1), true);
select pg_temp.ok('Robin and Sam (13) get the notice', pg_temp.last_notice_to() = '61,62', true);
select pg_temp.ok('Sam is unlocked', public.is_locked_child(pg_temp.m('61')), false);
select pg_temp.ok('the to-do is clear', (select minors_without_guardian = 0 from public.admin_safety_todos()), true);
select pg_temp.ok('Robin followed Sam into the squad', exists (select 1 from public.team_members where team_id = pg_temp.m('a1') and profile_id = pg_temp.m('62') and team_role = 'guardian'), true);
select pg_temp.as_member('61');
select pg_temp.ok('unlocked Sam is approved', public.is_approved(), true);
select pg_temp.ok('and has no code any more', (select not waiting and code is null from public.my_link_code()), true);
select pg_temp.as_member('62');
select pg_temp.ok('Robin is Sam''s guardian', public.is_guardian_of(pg_temp.m('61')), true);
select pg_temp.as_member('01');
select pg_temp.works('saving Robin again keeps their approval', $$select public.admin_save_member('00000000-0000-0000-0000-000000000062', 'guardian', 'approved')$$);

-- A guardian approved before this rule keeps their approval when saved,
-- with no child.
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000066', 'old.guardian@example.test', now());
update public.profiles set status = 'approved', role = 'guardian', full_name = 'Olive Oldparent' where id = pg_temp.m('66');
select pg_temp.works('an existing guardian with no child is saved, still approved', $$select public.admin_save_member('00000000-0000-0000-0000-000000000066', 'guardian', 'approved')$$);
select pg_temp.ok('and stays approved', (select status = 'approved' from public.profiles where id = pg_temp.m('66')), true);

-- ---------------------------------------------------------------------------
-- 4. A locked child is refused across the club's features; unlocked, the
-- same calls work. Jordan (31) is locked by unlinking both guardians.
-- ---------------------------------------------------------------------------
insert into public.messages (id, sender_id, sender_name, body, audience, team_id) values
  ('00000000-0000-0000-0000-0000000000c1', pg_temp.m('11'), 'Casey Coach', 'Training moved', 'group', pg_temp.m('a1'));
insert into public.message_recipients (message_id, profile_id) values
  ('00000000-0000-0000-0000-0000000000c1', pg_temp.m('31')), ('00000000-0000-0000-0000-0000000000c1', pg_temp.m('32'));
insert into public.fixtures (id, team_id, team_name, opponent, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.m('a1'), 'Sample Squad', 'Rockets', now() + interval '3 days');
insert into public.calendars (team_id, name, url) values (pg_temp.m('a1'), 'Squad calendar', 'https://example.test/squad.ics');
insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values (pg_temp.m('31'), current_date - 1, 'training', 60, 5);
select pg_temp.as_member('01');
create temp table survey as select public.create_survey('Training nights', null, 'named', 'group', null,
  '00000000-0000-0000-0000-0000000000a1', null, now() + interval '7 days',
  '[{"kind":"choice","prompt":"Best night","options":["Tuesday","Thursday"]}]') as id;
create temp table survey_answer as select jsonb_build_array(jsonb_build_object('question_id', q.id, 'choices', '[0]'::jsonb)) as answer
from public.survey_questions q where q.survey_id = (select id from survey);
grant select on survey, survey_answer to authenticated;

-- What a locked or unlocked Jordan can do: one row per feature.
create temp table jordan_can (label text, q text);
insert into jordan_can values
  ('is approved', $$select 1 where public.is_approved()$$),
  ('holds the athlete role', $$select 1 where public.has_role('athlete')$$),
  ('is a member of the squad', $$select 1 where public.is_team_member('00000000-0000-0000-0000-0000000000a1')$$),
  ('reads the squad message', $$select 1 from public.messages where id = '00000000-0000-0000-0000-0000000000c1'$$),
  ('reads their own receipt', $$select 1 from public.message_recipients where message_id = '00000000-0000-0000-0000-0000000000c1'$$),
  ('reads their own check-in', $$select 1 from public.check_ins where athlete_id = '00000000-0000-0000-0000-000000000031'$$),
  ('reads their own injury', $$select 1 from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031'$$),
  ('reads the squad''s fixture', $$select 1 from public.fixtures where id = '00000000-0000-0000-0000-0000000000f1'$$),
  ('reads the squad''s calendar', $$select 1 from public.calendars where team_id = '00000000-0000-0000-0000-0000000000a1'$$),
  ('sees the squad roster', $$select 1 from public.team_roster('00000000-0000-0000-0000-0000000000a1')$$),
  ('sees the squad survey', $$select 1 from public.my_surveys() where id = (select id from survey)$$),
  ('may report their own absences and injuries', $$select 1 where public.can_report_for('00000000-0000-0000-0000-000000000031')$$),
  ('reads their own training session', $$select 1 from public.session_logs where athlete_id = '00000000-0000-0000-0000-000000000031'$$),
  ('reads the training load settings', $$select 1 from public.load_monitoring_settings()$$);
grant select on jordan_can to authenticated;

-- Unlocked first.
set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('unlocked Jordan ' || label, pg_temp.n(q) > 0, true) from jordan_can order by label;
reset role;

-- Locked: both guardians unlinked by an admin.
select pg_temp.as_member('02');
select pg_temp.works('an admin unlinks both of Jordan''s guardians',
  $$select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved', '[{"team_id": "00000000-0000-0000-0000-0000000000a1"}, {"team_id": "00000000-0000-0000-0000-0000000000a2", "selection": "touring"}]', true, '{}', null, '{}', 'Testing')$$);
select pg_temp.ok('Jordan is locked', public.is_locked_child(pg_temp.m('31')), true);
select pg_temp.ok('every admin is told Jordan is locked', pg_temp.last_notice_to() = '01,02', true);
select pg_temp.ok('the notice says what happened and what to do',
  pg_temp.last_notice() like 'Jordan Junior is under 18 and no longer has a verified parent or guardian linked (% was the last). Their app is locked until one is%', true);
select pg_temp.ok('the notice is from the club, to admins',
  (select sender_id is null and sender_name = 'Club safeguarding' and audience_label = 'Admins' from public.messages where audience = 'notice' order by created_at desc, id desc limit 1), true);
select pg_temp.ok('the admin''s to-do counts Jordan', (select minors_without_guardian = 1 from public.admin_safety_todos()), true);

set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('locked Jordan ' || label, pg_temp.n(q) > 0, false) from jordan_can order by label;
select pg_temp.ok('locked Jordan has a code to share', (select waiting and code is not null from public.my_link_code()), true);
select pg_temp.ok('locked Jordan reads no notices', pg_temp.n('select 1 from public.messages') = 0, true);
reset role;
select pg_temp.as_member('31');
select pg_temp.fails('locked Jordan can''t do a check-in', $$select public.save_check_in(current_date, 4, 3, 2, 4, 'x')$$);
select pg_temp.fails('locked Jordan can''t report an injury', $$select public.report_injury('00000000-0000-0000-0000-000000000031', 'Knee', 'Fell', current_date)$$);
select pg_temp.fails('locked Jordan can''t report an absence', $$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 1, current_date + 1, 'Exam')$$);
select pg_temp.fails('locked Jordan can''t answer the survey', format('select public.submit_survey_response(%L, %L, false)', (select id from survey), (select answer from survey_answer)));
select pg_temp.fails('locked Jordan can''t accept the code of conduct', $$select public.accept_code_of_conduct('00000000-0000-0000-0000-000000000031')$$);
select pg_temp.fails('locked Jordan can''t log a training session', $$select public.save_session_log(null, current_date, 'training', 60, 5)$$);
select pg_temp.fails('locked Jordan can''t delete a training session', $$select public.delete_session_log((select id from public.session_logs where athlete_id = '00000000-0000-0000-0000-000000000031' limit 1))$$);
select pg_temp.fails('locked Jordan can''t see their training load', $$select public.athlete_load('00000000-0000-0000-0000-000000000031')$$);
select pg_temp.fails('locked Jordan can''t open their medical details', $$select public.medical_profile('00000000-0000-0000-0000-000000000031')$$);
select pg_temp.ok('locked Jordan has no medical check to do', pg_temp.n('select 1 from public.my_medical_reviews()') = 0, true);
set role authenticated;
select pg_temp.fails('locked Jordan can''t add a personal task', $$insert into public.personal_tasks (profile_id, title) values ('00000000-0000-0000-0000-000000000031', 'Stretch')$$);
reset role;
select pg_temp.ok('locked Jordan can still raise a concern', public.raise_concern('Something worried me') is not null, true);

-- Everyone else is unaffected while Jordan is locked.
set role authenticated;
select pg_temp.as_member('32');
select pg_temp.ok('Kai, an adult athlete, still reads the squad message', pg_temp.n($$select 1 from public.messages where id = '00000000-0000-0000-0000-0000000000c1'$$) = 1, true);
select pg_temp.ok('Kai still reads the squad''s fixture', pg_temp.n($$select 1 from public.fixtures where id = '00000000-0000-0000-0000-0000000000f1'$$) = 1, true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach still sees Jordan on the roster', pg_temp.n($$select 1 from public.team_roster('00000000-0000-0000-0000-0000000000a1') where profile_id = '00000000-0000-0000-0000-000000000031'$$) = 1, true);
select pg_temp.ok('and on the attendance register', pg_temp.n($$select 1 from public.attendance_roster('00000000-0000-0000-0000-0000000000a1') r where r.profile_id = '00000000-0000-0000-0000-000000000031'$$) = 1, true);
select pg_temp.ok('the coach is still a member of the squad', pg_temp.n($$select 1 where public.is_team_member('00000000-0000-0000-0000-0000000000a1')$$) = 1, true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin still reads Jordan''s profile', pg_temp.n($$select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000031'$$) = 1, true);
select pg_temp.ok('the admin still reads Jordan''s injury', pg_temp.n($$select 1 from public.injuries where athlete_id = '00000000-0000-0000-0000-000000000031'$$) = 1, true);
reset role;

-- A guardian linked but not verified, or not approved, doesn't unlock.
select pg_temp.as_member('01');
select pg_temp.works('an admin links Logan back by hand', $$select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved', '[{"team_id": "00000000-0000-0000-0000-0000000000a1"}, {"team_id": "00000000-0000-0000-0000-0000000000a2", "selection": "touring"}]', true, '{00000000-0000-0000-0000-000000000041}')$$);
select pg_temp.ok('linked by hand, Jordan is unlocked', public.is_locked_child(pg_temp.m('31')), false);
update public.profiles set verified_at = null where id = pg_temp.m('41');
select pg_temp.ok('a guardian who isn''t verified doesn''t unlock', public.is_locked_child(pg_temp.m('31')), true);
update public.profiles set verified_at = now() where id = pg_temp.m('41');
update public.profiles set status = 'pending' where id = pg_temp.m('41');
select pg_temp.ok('a guardian who isn''t approved doesn''t unlock', public.is_locked_child(pg_temp.m('31')), true);
update public.profiles set status = 'approved' where id = pg_temp.m('41');

-- Unlocked again, every feature works.
set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('unlocked again, Jordan ' || label, pg_temp.n(q) > 0, true) from jordan_can order by label;
reset role;
select pg_temp.as_member('31');
select pg_temp.works('unlocked Jordan does a check-in', $$select public.save_check_in(current_date, 4, 3, 2, 4, 'x')$$);
select pg_temp.works('unlocked Jordan reports an absence', $$select public.report_absence('00000000-0000-0000-0000-000000000031', current_date + 1, current_date + 1, 'Exam')$$);
select pg_temp.works('unlocked Jordan answers the survey', format('select public.submit_survey_response(%L, %L, false)', (select id from survey), (select answer from survey_answer)));
select pg_temp.works('unlocked Jordan logs a training session', $$select public.save_session_log(null, current_date, 'training', 60, 5)$$);
select pg_temp.works('unlocked Jordan sees their training load', $$select public.athlete_load('00000000-0000-0000-0000-000000000031')$$);
select pg_temp.works('unlocked Jordan opens their medical details', $$select public.medical_profile('00000000-0000-0000-0000-000000000031')$$);

-- Turning 18 ends the lock; the day before, it holds.
reset role;
delete from public.guardianships where athlete_id = pg_temp.m('31');
update public.profiles set date_of_birth = current_date - interval '18 years' + interval '1 day' where id = pg_temp.m('31');
select pg_temp.as_member('31');
select pg_temp.ok('the day before turning 18 with no guardian, Jordan is locked', public.is_approved(), false);
update public.profiles set date_of_birth = current_date - interval '18 years' where id = pg_temp.m('31');
select pg_temp.ok('on their 18th birthday Jordan is no longer locked', public.is_approved(), true);
select pg_temp.ok('and needs no code', (select not waiting from public.my_link_code()), true);
update public.profiles set date_of_birth = current_date - interval '14 years' where id = pg_temp.m('31');

-- ---------------------------------------------------------------------------
-- 5. An approved parent adds another child by code; an admin links or turns
-- it down from Members.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
insert into codes select 'jordan', code from public.my_link_code();
select pg_temp.as_member('62');
select pg_temp.ok('Robin, already approved, enters Jordan''s code', public.enter_child_code((select v from codes where k = 'jordan')) is null, true);
select pg_temp.as_member('41');
select pg_temp.ok('a code works once', public.enter_child_code((select v from codes where k = 'jordan')) like 'That code isn’t right%', true);
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach can''t link them', $$select public.admin_accept_guardian_link('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000031')$$, 'Only admins');
select pg_temp.fails_with('a coach can''t turn it down', $$select public.admin_decline_guardian_link('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000031')$$, 'Only admins');
select pg_temp.as_member('01');
select pg_temp.fails_with('only a request can be linked this way', $$select public.admin_accept_guardian_link('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000031')$$, 'haven’t entered');
update public.profiles set verified_at = null where id = pg_temp.m('62');
select pg_temp.fails_with('a parent who isn''t verified can''t be linked', $$select public.admin_accept_guardian_link('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000031')$$, 'Verify and approve');
update public.profiles set verified_at = now() where id = pg_temp.m('62');
select pg_temp.works('the admin links Robin to Jordan', $$select public.admin_accept_guardian_link('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000031')$$);
select pg_temp.ok('Jordan is unlocked by Robin', public.is_locked_child(pg_temp.m('31')), false);
select pg_temp.ok('the request is done', exists (select 1 from public.guardian_link_requests where athlete_id = pg_temp.m('31')), false);
select pg_temp.ok('Robin followed Jordan into the team too', exists (select 1 from public.team_members where team_id = pg_temp.m('a2') and profile_id = pg_temp.m('62') and team_role = 'guardian'), true);

-- Turning a request down.
select pg_temp.as_member('64');
insert into codes select 'sam64b', code from public.my_link_code();
select pg_temp.as_member('63');
select pg_temp.ok('Quinn enters the other Sam''s code', public.enter_child_code((select v from codes where k = 'sam64b')) is null, true);
select pg_temp.as_member('01');
select pg_temp.fails_with('a pending child can''t be linked yet', $$select public.admin_accept_guardian_link('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000064')$$, 'Verify and approve');
select pg_temp.works('the admin turns Quinn''s request down', $$select public.admin_decline_guardian_link('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000064')$$);
select pg_temp.ok('the request is gone', exists (select 1 from public.guardian_link_requests where guardian_id = pg_temp.m('63')), false);
select pg_temp.fails_with('turning it down twice says so', $$select public.admin_decline_guardian_link('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000064')$$, 'haven’t entered');

-- ---------------------------------------------------------------------------
-- 6. Guardians follow their child out of squads, and keep places their
-- other children are in; saving a guardian keeps those places.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.ok('Robin is in the squad and team with Sam and Jordan', (select count(*) = 2 from public.team_members where profile_id = pg_temp.m('62') and team_role = 'guardian'), true);
select pg_temp.works('saving Robin with no squads or teams', $$select public.admin_save_member('00000000-0000-0000-0000-000000000062', 'guardian', 'approved', '[]')$$);
select pg_temp.ok('keeps Robin''s places with their children', (select count(*) = 2 from public.team_members where profile_id = pg_temp.m('62') and team_role = 'guardian'), true);
select pg_temp.works('an admin links the coach-parent back to Jordan', $$select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved', '[{"team_id": "00000000-0000-0000-0000-0000000000a1"}, {"team_id": "00000000-0000-0000-0000-0000000000a2", "selection": "touring"}]', true, '{00000000-0000-0000-0000-000000000041,00000000-0000-0000-0000-000000000042,00000000-0000-0000-0000-000000000062}')$$);
select pg_temp.ok('the coach-parent coaches the squad and follows Jordan into the team', exists (select 1 from public.team_members where team_id = pg_temp.m('a1') and profile_id = pg_temp.m('42') and team_role = 'coach') and exists (select 1 from public.team_members where team_id = pg_temp.m('a2') and profile_id = pg_temp.m('42') and team_role = 'guardian'), true);
select pg_temp.works('saving the coach-parent with the places the app shows (coach in the squad, guardian in the team)',
  $$select public.admin_save_member('00000000-0000-0000-0000-000000000042', 'coach', 'approved', '[{"team_id": "00000000-0000-0000-0000-0000000000a1", "team_role": "coach", "coach_title": "assistant_coach"}, {"team_id": "00000000-0000-0000-0000-0000000000a2", "team_role": "guardian"}]', false, '{}', null, '{guardian}')$$);
select pg_temp.ok('the coach-parent still coaches the squad', exists (select 1 from public.team_members where team_id = pg_temp.m('a1') and profile_id = pg_temp.m('42') and team_role = 'coach'), true);
select pg_temp.works('Sam leaves the squad', $$select public.admin_save_member('00000000-0000-0000-0000-000000000061', 'athlete', 'approved', '[]', true, '{00000000-0000-0000-0000-000000000062}')$$);
select pg_temp.ok('Robin stays in the squad, where Jordan still is', exists (select 1 from public.team_members where team_id = pg_temp.m('a1') and profile_id = pg_temp.m('62')), true);
select pg_temp.works('Jordan leaves the squad and team', $$select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved', '[]', true, '{00000000-0000-0000-0000-000000000062}')$$);
select pg_temp.ok('with none of their children left in them, Robin leaves the squad and team', (select count(*) = 0 from public.team_members where profile_id = pg_temp.m('62')), true);
select pg_temp.works('Sam joins the squad again', $$select public.admin_save_member('00000000-0000-0000-0000-000000000061', 'athlete', 'approved', '[{"team_id": "00000000-0000-0000-0000-0000000000a1"}]', true, '{00000000-0000-0000-0000-000000000062}')$$);
select pg_temp.ok('and Robin follows', exists (select 1 from public.team_members where team_id = pg_temp.m('a1') and profile_id = pg_temp.m('62') and team_role = 'guardian'), true);

-- ---------------------------------------------------------------------------
-- 7. The last parent leaving locks the child again: deleting their account,
-- or being taken off as a guardian.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('62');
select pg_temp.works('Robin deletes their account', $$select public.delete_my_account()$$);
select pg_temp.ok('Sam is locked again', public.is_locked_child(pg_temp.m('61')), true);
select pg_temp.ok('every admin is told about Sam', pg_temp.notice_to('Sam Taylor is under 18%Robin Taylor was the last%') = '01,02', true);
select pg_temp.as_member('61');
select pg_temp.ok('Sam sees the waiting screen with a fresh code', (select waiting and code is not null and code not in (select v from codes) from public.my_link_code()), true);
select pg_temp.ok('and can''t read the squad''s club data', public.is_team_member('00000000-0000-0000-0000-0000000000a1'), false);

-- Jordan's only guardian is Logan again; taking the Guardian role away locks
-- Jordan and tells the admins.
select pg_temp.as_member('01');
select pg_temp.works('Logan linked to Jordan again', $$select public.admin_save_member('00000000-0000-0000-0000-000000000031', 'athlete', 'approved', '[]', true, '{00000000-0000-0000-0000-000000000041}')$$);
select pg_temp.ok('Jordan unlocked', public.is_locked_child(pg_temp.m('31')), false);
select pg_temp.works('Logan''s access is removed', $$select public.admin_save_member('00000000-0000-0000-0000-000000000041', 'guardian', 'rejected', '[]', false, '{}', 'other')$$);
select pg_temp.ok('Jordan is locked again', public.is_locked_child(pg_temp.m('31')), true);
select pg_temp.ok('and every admin is told', pg_temp.last_notice_to() = '01,02' and pg_temp.last_notice() like 'Jordan Junior is under 18%Logan Parent was the last%', true);

-- A locked child can still delete their own account.
select pg_temp.as_member('61');
select pg_temp.works('locked Sam deletes their account', $$select public.delete_my_account()$$);
select pg_temp.ok('Sam is gone, with their codes', not exists (select 1 from public.profiles where id = pg_temp.m('61')) and not exists (select 1 from public.guardian_link_codes where athlete_id = pg_temp.m('61')), true);
select pg_temp.ok('no notice is sent when the child themselves leaves', pg_temp.last_notice() like 'Jordan Junior%', true);
