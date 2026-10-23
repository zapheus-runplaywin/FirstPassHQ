-- Tests for 20261023130000_legal_hold.sql: nothing about a member named in a
-- concern is removed by the nightly clean-up, safeguarding records can be
-- kept 45 years or for good, and attendance 10 or 15 years (customer review
-- C7). Jordan (31, under 18) is named in a concern; Kai (32) is not, so his
-- matching records show what the clean-up removes. Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
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
-- How many rows of a table belong to a member, by the named column.
create or replace function pg_temp.n(tbl text, col text, member text) returns bigint language plpgsql as
$$ declare v bigint;
   begin execute format('select count(*) from public.%I where %I = $1', tbl, col) into v using pg_temp.id(member); return v; end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members cannot ask who is on hold', has_function_privilege('authenticated', 'public.on_legal_hold(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot ask who is on hold', has_function_privilege('anon', 'public.on_legal_hold(uuid)', 'execute'), false);
select pg_temp.ok('members still cannot run the clean-up', has_function_privilege('authenticated', 'public.purge_expired_records()', 'execute'), false);
select pg_temp.ok('members still cannot run the survey clean-up', has_function_privilege('authenticated', 'public.purge_expired_surveys()', 'execute'), false);
select pg_temp.ok('members still cannot list certificate files', has_function_privilege('authenticated', 'public.expired_certificate_documents()', 'execute'), false);

-- ---------------------------------------------------------------------------
-- The longer choices
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('attendance for 10 years is allowed', $$select public.admin_set_record_retention(false, 12, 12, 36, 120, 12, 84)$$);
select pg_temp.ok('and reads back', (select attendance_months = 120 from public.record_retention()), true);
select pg_temp.works('attendance for 15 years is allowed', $$select public.admin_set_record_retention(false, 12, 12, 36, 180, 12, 84)$$);
select pg_temp.ok('and reads back', (select attendance_months = 180 from public.record_retention()), true);
select pg_temp.fails_with('attendance for 20 years is refused', $$select public.admin_set_record_retention(false, 12, 12, 36, 240, 12, 84)$$, 'Attendance can be kept 1 to 5, 10 or 15 years');
select pg_temp.fails_with('attendance for 7 years is refused', $$select public.admin_set_record_retention(false, 12, 12, 36, 84, 12, 84)$$, 'Attendance can be kept');
select pg_temp.fails_with('game goals still stop at 5 years', $$select public.admin_set_record_retention(false, 12, 120, 36, 12, 12, 84)$$, 'Game goals and training certificates can be kept 1 to 5 years');
select pg_temp.fails_with('training certificates still stop at 5 years', $$select public.admin_set_record_retention(false, 12, 12, 36, 12, 180, 84)$$, 'Game goals and training certificates can be kept 1 to 5 years');
select pg_temp.works('safeguarding records for 45 years are allowed', $$select public.admin_set_more_record_retention(84, 540, 12, 120)$$);
select pg_temp.ok('and read back', (select safeguarding_months = 540 from public.more_record_retention()), true);
select pg_temp.works('safeguarding records kept for good are allowed', $$select public.admin_set_more_record_retention(84, 0, 12, 120)$$);
select pg_temp.ok('and read back as 0', (select safeguarding_months = 0 from public.more_record_retention()), true);
select pg_temp.fails_with('safeguarding records for 50 years are refused', $$select public.admin_set_more_record_retention(84, 600, 12, 120)$$, 'Safeguarding records can be kept 7, 10, 15, 20, 30 or 45 years, or for good');
select pg_temp.fails_with('safeguarding records for 5 years are still refused', $$select public.admin_set_more_record_retention(84, 60, 12, 120)$$, 'Safeguarding records can be kept');
select pg_temp.fails_with('cleared injuries still stop at 10 years', $$select public.admin_set_more_record_retention(0, 360, 12, 120)$$, 'Cleared injuries can be kept 3, 5, 7 or 10 years');
select pg_temp.as_member('11');
select pg_temp.fails_with('a coach still cannot change attendance', $$select public.admin_set_record_retention(false, 12, 12, 36, 120, 12, 84)$$, 'Only admins');
select pg_temp.fails_with('a coach still cannot change safeguarding records', $$select public.admin_set_more_record_retention(84, 0, 12, 120)$$, 'Only admins');
select set_config('request.jwt.claim.sub', '', false);

-- The club's periods for the clean-up below.
update public.club_settings set
  retention_check_ins_months = 3, retention_goals_months = 12, retention_messages_months = 12,
  retention_child_messages_months = 36, retention_attendance_months = 12,
  retention_certificates_months = 12, retention_access_log_months = 36,
  retention_injuries_months = 36, retention_safeguarding_months = 84,
  retention_award_votes_months = 12, retention_awards_months = 36,
  retention_injury_documents_days = 90, retention_surveys_months = 12,
  retention_shared_surveys_months = 12, retention_team_polls_months = 3,
  retention_updated_at = now()
where id;

-- ---------------------------------------------------------------------------
-- Who is on hold
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'pending.held@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'pending.free@example.test', now());
update public.profiles set full_name = 'Pat Pending', join_requested_at = now() - interval '100 days'
where id in (pg_temp.id('61'), pg_temp.id('62'));

select pg_temp.ok('nobody is on hold before a concern names them', public.on_legal_hold(pg_temp.id('31')), false);
insert into public.concerns (raised_by, raised_by_name, body, about_text)
values (pg_temp.id('41'), 'Logan Parent', 'Something at training', 'A parent at training');
select pg_temp.ok('a concern describing someone in words holds nobody', (select count(*) = 0 from public.profiles where public.on_legal_hold(id)), true);
insert into public.concerns (raised_by, raised_by_name, body, about_member_id, about_member_name, status, closed_at) values
  (pg_temp.id('41'), 'Logan Parent', 'Worried about Jordan', pg_temp.id('31'), 'Jordan Junior', 'closed', now()),
  (pg_temp.id('11'), 'Casey Coach', 'Worried about Pat', pg_temp.id('61'), 'Pat Pending', 'received', null);
select pg_temp.ok('a member named in a concern is on hold', public.on_legal_hold(pg_temp.id('31')), true);
select pg_temp.ok('even once the concern is closed', (select status = 'closed' from public.concerns where about_member_id = pg_temp.id('31')), true);
select pg_temp.ok('whoever raised it is not on hold', public.on_legal_hold(pg_temp.id('41')), false);
select pg_temp.ok('other members are not on hold', public.on_legal_hold(pg_temp.id('32')), false);
select pg_temp.ok('no member is never on hold', public.on_legal_hold(null), false);

-- ---------------------------------------------------------------------------
-- Old records, one for Jordan (on hold) and one for Kai
-- ---------------------------------------------------------------------------
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note) values
  (pg_temp.id('31'), current_date - 400, 2, 3, 3, 3, 'Old'),
  (pg_temp.id('32'), current_date - 400, 2, 3, 3, 3, 'Old');

insert into public.teams (id, name, kind, season, archived) values
  ('a0000000-0000-0000-0000-000000000001', 'Old Team', 'team', 2023, true);
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Old Team', 'Rivals', 'Round 1', now() - interval '2 years');
insert into public.game_goals (athlete_id, fixture_id, body, set_by_name) values
  (pg_temp.id('31'), 'a0000000-0000-0000-0000-000000000002', 'Talk more', 'Jordan Junior'),
  (pg_temp.id('32'), 'a0000000-0000-0000-0000-000000000002', 'Talk more', 'Kai Senior');
insert into public.season_kpis (profile_id, team_id, team_role, format, title, updated_at) values
  (pg_temp.id('31'), 'a0000000-0000-0000-0000-000000000001', 'athlete', 'kpi', 'Fitness', now() - interval '2 years'),
  (pg_temp.id('32'), 'a0000000-0000-0000-0000-000000000001', 'athlete', 'kpi', 'Fitness', now() - interval '2 years');

-- Messages ten years old: to Jordan, from Jordan, and to Kai.
insert into public.messages (id, sender_id, sender_name, body, audience, created_at) values
  ('b0000000-0000-0000-0000-000000000001', pg_temp.id('11'), 'Casey Coach', 'To Jordan', 'club', now() - interval '10 years'),
  ('b0000000-0000-0000-0000-000000000002', pg_temp.id('31'), 'Jordan Junior', 'From Jordan', 'club', now() - interval '10 years'),
  ('b0000000-0000-0000-0000-000000000003', pg_temp.id('11'), 'Casey Coach', 'To Kai', 'club', now() - interval '10 years');
insert into public.message_recipients (message_id, profile_id) values
  ('b0000000-0000-0000-0000-000000000001', pg_temp.id('31')),
  ('b0000000-0000-0000-0000-000000000002', pg_temp.id('11')),
  ('b0000000-0000-0000-0000-000000000003', pg_temp.id('32'));

-- Two old sessions: one Jordan was marked at, one only Kai was.
insert into public.attendance_sessions (id, team_id, team_name, name, held_at) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Old Team', 'Training', now() - interval '2 years'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Old Team', 'Training', now() - interval '2 years');
insert into public.attendance_marks (session_id, profile_id, present) values
  ('c0000000-0000-0000-0000-000000000001', pg_temp.id('31'), true),
  ('c0000000-0000-0000-0000-000000000001', pg_temp.id('32'), true),
  ('c0000000-0000-0000-0000-000000000002', pg_temp.id('32'), true);
insert into public.attendance_absences (athlete_id, from_day, to_day, reported_as) values
  (pg_temp.id('31'), current_date - 800, current_date - 800, 'guardian'),
  (pg_temp.id('32'), current_date - 800, current_date - 800, 'athlete');

insert into public.training_requirements (id, season, name, due_on, roles) values
  ('d0000000-0000-0000-0000-000000000001', 2023, 'Integrity basics', current_date - 800, '{athlete}');
insert into public.training_certificates (requirement_id, profile_id, completed_on, document_path, created_at) values
  ('d0000000-0000-0000-0000-000000000001', pg_temp.id('31'), current_date - 800, pg_temp.id('31') || '/cert.pdf', now() - interval '2 years'),
  ('d0000000-0000-0000-0000-000000000001', pg_temp.id('32'), current_date - 800, pg_temp.id('32') || '/cert.pdf', now() - interval '2 years');

-- Views of each one's records, and one of Kai's viewed by Jordan.
insert into public.record_access_log (subject_id, viewer_id, kind, created_at) values
  (pg_temp.id('31'), pg_temp.id('11'), 'check_ins', now() - interval '4 years'),
  (pg_temp.id('32'), pg_temp.id('11'), 'check_ins', now() - interval '4 years'),
  (pg_temp.id('32'), pg_temp.id('31'), 'member_record', now() - interval '4 years');

-- Cleared injuries four years ago, each with a document still in storage,
-- and injuries of athletes who left.
insert into public.injuries (id, athlete_id, body_area, description, injured_on, status, cleared_at) values
  ('e0000000-0000-0000-0000-000000000001', pg_temp.id('31'), 'Ankle', 'Rolled', current_date - 1500, 'cleared', now() - interval '4 years'),
  ('e0000000-0000-0000-0000-000000000002', pg_temp.id('32'), 'Ankle', 'Rolled', current_date - 1500, 'cleared', now() - interval '4 years'),
  ('e0000000-0000-0000-0000-000000000003', pg_temp.id('31'), 'Knee', 'Sore', current_date - 1500, 'cleared', now() - interval '4 years'),
  ('e0000000-0000-0000-0000-000000000004', pg_temp.id('32'), 'Knee', 'Sore', current_date - 1500, 'cleared', now() - interval '4 years');
insert into storage.objects (bucket_id, name) values
  ('injury-documents', pg_temp.id('31') || '/e0000000-0000-0000-0000-000000000003/letter.pdf'),
  ('injury-documents', pg_temp.id('32') || '/e0000000-0000-0000-0000-000000000004/letter.pdf');

-- Safeguarding records that ended nine years ago.
insert into public.screening_notices (profile_id, member_name, kind, received_on, action) values
  (pg_temp.id('31'), 'Jordan Junior', 'other', current_date - 3300, 'Noted'),
  (pg_temp.id('32'), 'Kai Senior', 'other', current_date - 3300, 'Noted');
insert into public.stand_downs (profile_id, member_name, reason, started_at, lifted_at) values
  (pg_temp.id('31'), 'Jordan Junior', 'other', now() - interval '10 years', now() - interval '9 years'),
  (pg_temp.id('32'), 'Kai Senior', 'other', now() - interval '10 years', now() - interval '9 years');
insert into public.child_consents (athlete_id, kind, policy_version, given_at, withdrawn_at) values
  (pg_temp.id('31'), 'health', 'v0', now() - interval '10 years', now() - interval '9 years'),
  (pg_temp.id('32'), 'health', 'v0', now() - interval '10 years', now() - interval '9 years');
insert into public.conduct_acceptances (profile_id, season, accepted_as, policy_version, statement, accepted_at) values
  (pg_temp.id('31'), 2017, 'self', 'v0', 'I agree', now() - interval '9 years'),
  (pg_temp.id('32'), 2017, 'self', 'v0', 'I agree', now() - interval '9 years');
insert into public.policy_acknowledgements (profile_id, policy_version, statement, acknowledged_at) values
  (pg_temp.id('31'), 'v0', 'I agree', now() - interval '9 years'),
  (pg_temp.id('31'), 'v1', 'I agree', now() - interval '1 year'),
  (pg_temp.id('32'), 'v0', 'I agree', now() - interval '9 years'),
  (pg_temp.id('32'), 'v1', 'I agree', now() - interval '1 year');
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, ended_at) values
  (pg_temp.id('41'), 'parent_volunteer', pg_temp.id('31'), 'Jordan Junior', now() - interval '9 years'),
  (pg_temp.id('42'), 'parent_volunteer', pg_temp.id('32'), 'Kai Senior', now() - interval '9 years');
insert into public.guardianship_history (guardian_id, athlete_id, change, changed_at) values
  (pg_temp.id('41'), pg_temp.id('31'), 'linked', now() - interval '9 years'),
  (pg_temp.id('41'), pg_temp.id('32'), 'linked', now() - interval '9 years');

-- Awards closed four years ago: Jordan voted in one, was voted for in
-- another, and had nothing to do with the third.
insert into public.awards (id, season, name, closes_at, voter_roles) values
  ('f0000000-0000-0000-0000-000000000001', 2022, 'Jordan voted', now() - interval '4 years', '{athlete}'),
  ('f0000000-0000-0000-0000-000000000002', 2022, 'Jordan voted for', now() - interval '4 years', '{athlete}'),
  ('f0000000-0000-0000-0000-000000000003', 2022, 'Neither', now() - interval '4 years', '{athlete}');
insert into public.award_ballots (id, award_id, voter_id) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', pg_temp.id('31')),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', pg_temp.id('32')),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000003', pg_temp.id('32'));
insert into public.award_votes (ballot_id, rank, points, nominee_id, nominee_name) values
  ('f1000000-0000-0000-0000-000000000001', 1, 3, pg_temp.id('32'), 'Kai Senior'),
  ('f1000000-0000-0000-0000-000000000002', 1, 3, pg_temp.id('31'), 'Jordan Junior'),
  ('f1000000-0000-0000-0000-000000000003', 1, 3, pg_temp.id('32'), 'Kai Senior');

-- Committee surveys closed two years ago, one answered by Jordan by name.
insert into public.surveys (id, title, identity, audience, opens_at, closes_at, sent_as) values
  ('f2000000-0000-0000-0000-000000000001', 'Jordan answered', 'named', 'club', now() - interval '2 years 1 month', now() - interval '2 years', 'committee'),
  ('f2000000-0000-0000-0000-000000000002', 'Kai answered', 'named', 'club', now() - interval '2 years 1 month', now() - interval '2 years', 'committee');
insert into public.survey_responses (survey_id, respondent_id, respondent_name) values
  ('f2000000-0000-0000-0000-000000000001', pg_temp.id('31'), 'Jordan Junior'),
  ('f2000000-0000-0000-0000-000000000002', pg_temp.id('32'), 'Kai Senior');

-- ---------------------------------------------------------------------------
-- Nothing goes while Remove old records is off
-- ---------------------------------------------------------------------------
update public.club_settings set retention_enabled = false where id;
select pg_temp.ok('the clean-up does nothing while off', (select public.purge_expired_records() = '{"enabled": false}'::jsonb), true);
select pg_temp.ok('and no injury document is due', (select count(*) = 0 from public.cleared_injury_documents()), true);
update public.club_settings set retention_enabled = true where id;

-- Files are listed before the clean-up removes their records.
select pg_temp.ok('Kai''s injury document is due', (select count(*) = 1 from public.cleared_injury_documents() d where d like pg_temp.id('32') || '/%'), true);
select pg_temp.ok('Jordan''s injury document is not', (select count(*) = 0 from public.cleared_injury_documents() d where d like pg_temp.id('31') || '/%'), true);
select pg_temp.ok('Kai''s certificate file is due', (select count(*) = 1 from public.expired_certificate_documents() d where d like pg_temp.id('32') || '/%'), true);
select pg_temp.ok('Jordan''s certificate file is not', (select count(*) = 0 from public.expired_certificate_documents() d where d like pg_temp.id('31') || '/%'), true);
select pg_temp.ok('an injury of Jordan''s is never past its document period', (select public.injury_documents_expired(i) from public.injuries i where id = 'e0000000-0000-0000-0000-000000000003'), false);
select pg_temp.ok('the same for Kai is', (select public.injury_documents_expired(i) from public.injuries i where id = 'e0000000-0000-0000-0000-000000000004'), true);

select pg_temp.works('the clean-up runs', $$select public.purge_expired_records()$$);
select pg_temp.works('the survey clean-up runs', $$select public.purge_expired_surveys()$$);

-- ---------------------------------------------------------------------------
-- What stays and what goes
-- ---------------------------------------------------------------------------
select pg_temp.ok('Jordan''s old check-in stays', (select count(*) = 1 from public.check_ins where athlete_id = pg_temp.id('31') and day = current_date - 400), true);
select pg_temp.ok('Kai''s goes', (select count(*) = 0 from public.check_ins where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('Jordan''s check-in from today stays too', (select count(*) = 1 from public.check_ins where athlete_id = pg_temp.id('31') and day = current_date), true);
select pg_temp.ok('Jordan''s game goal stays', pg_temp.n('game_goals', 'athlete_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes', pg_temp.n('game_goals', 'athlete_id', '32') = 0, true);
select pg_temp.ok('Jordan''s season KPI stays', pg_temp.n('season_kpis', 'profile_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes', pg_temp.n('season_kpis', 'profile_id', '32') = 0, true);
select pg_temp.ok('a message to Jordan keeps its text', (select body = 'To Jordan' from public.messages where id = 'b0000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('a message from Jordan keeps its text', (select body = 'From Jordan' from public.messages where id = 'b0000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('a message to Kai loses its text', (select body_removed_at is not null and body <> 'To Kai' from public.messages where id = 'b0000000-0000-0000-0000-000000000003'), true);
select pg_temp.ok('a session Jordan was marked at stays whole', (select count(*) = 2 from public.attendance_marks where session_id = 'c0000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('a session only Kai was at goes', (select count(*) = 0 from public.attendance_sessions where id = 'c0000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('Jordan''s old absence stays', pg_temp.n('attendance_absences', 'athlete_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes', pg_temp.n('attendance_absences', 'athlete_id', '32') = 0, true);
select pg_temp.ok('Jordan''s certificate stays', pg_temp.n('training_certificates', 'profile_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes once its file is gone', pg_temp.n('training_certificates', 'profile_id', '32') = 0, true);
select pg_temp.ok('views of Jordan''s records stay', pg_temp.n('record_access_log', 'subject_id', '31') = 1, true);
select pg_temp.ok('Jordan''s view of Kai''s record stays', (select count(*) = 1 from public.record_access_log where viewer_id = pg_temp.id('31')), true);
select pg_temp.ok('other views of Kai''s records go', (select count(*) = 0 from public.record_access_log where subject_id = pg_temp.id('32') and viewer_id = pg_temp.id('11')), true);
select pg_temp.ok('a waiting member named in a concern stays', (select count(*) = 1 from public.profiles where id = pg_temp.id('61')), true);
select pg_temp.ok('and keeps their sign-in', (select count(*) = 1 from auth.users where id = pg_temp.id('61')), true);
select pg_temp.ok('another waiting 100 days goes', (select count(*) = 0 from public.profiles where id = pg_temp.id('62')), true);
select pg_temp.ok('Jordan''s old cleared injury stays', (select count(*) = 1 from public.injuries where id = 'e0000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('Kai''s goes', (select count(*) = 0 from public.injuries where id = 'e0000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('Jordan''s stand-down stays', pg_temp.n('stand_downs', 'profile_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes', pg_temp.n('stand_downs', 'profile_id', '32') = 0, true);
select pg_temp.ok('Jordan''s Screening Unit notice stays', pg_temp.n('screening_notices', 'profile_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes', pg_temp.n('screening_notices', 'profile_id', '32') = 0, true);
select pg_temp.ok('Jordan''s withdrawn consent stays', (select count(*) = 1 from public.child_consents where athlete_id = pg_temp.id('31') and kind = 'health'), true);
select pg_temp.ok('Kai''s goes', (select count(*) = 0 from public.child_consents where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('Jordan''s old conduct acceptance stays', pg_temp.n('conduct_acceptances', 'profile_id', '31') = 1, true);
select pg_temp.ok('Kai''s goes', pg_temp.n('conduct_acceptances', 'profile_id', '32') = 0, true);
select pg_temp.ok('Jordan''s replaced policy acknowledgement stays', pg_temp.n('policy_acknowledgements', 'profile_id', '31') = 2, true);
select pg_temp.ok('Kai''s replaced one goes, their latest stays', (select count(*) = 1 and min(policy_version) = 'v1' from public.policy_acknowledgements where profile_id = pg_temp.id('32')), true);
select pg_temp.ok('a parent''s exemption for Jordan stays', pg_temp.n('volunteer_exemptions', 'child_id', '31') = 1, true);
select pg_temp.ok('one for Kai goes', pg_temp.n('volunteer_exemptions', 'child_id', '32') = 0, true);
select pg_temp.ok('Jordan''s old guardian link history stays', (select count(*) = 1 from public.guardianship_history where athlete_id = pg_temp.id('31') and changed_at < now() - interval '8 years'), true);
select pg_temp.ok('Kai''s goes', pg_temp.n('guardianship_history', 'athlete_id', '32') = 0, true);
select pg_temp.ok('an award Jordan voted in stays', (select count(*) = 1 from public.awards where id = 'f0000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('and keeps that Jordan voted', (select voter_id = pg_temp.id('31') from public.award_ballots where id = 'f1000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('an award Jordan was voted for in stays', (select count(*) = 1 from public.awards where id = 'f0000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('but who voted for Jordan goes', (select voter_id is null from public.award_ballots where id = 'f1000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('an award with neither goes', (select count(*) = 0 from public.awards where id = 'f0000000-0000-0000-0000-000000000003'), true);
select pg_temp.ok('a survey Jordan answered by name stays', (select count(*) = 1 from public.surveys where id = 'f2000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('one Kai answered goes', (select count(*) = 0 from public.surveys where id = 'f2000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('concerns are never removed', (select count(*) = 3 from public.concerns), true);

-- Injuries of an athlete who left.
update public.injuries set athlete_left_at = now() - interval '4 years'
where id in ('e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004');
select pg_temp.ok('an injury of Jordan''s is never past the period for those who left', (select public.departed_injury_expired(i) from public.injuries i where id = 'e0000000-0000-0000-0000-000000000003'), false);
select pg_temp.ok('the same for Kai is', (select public.departed_injury_expired(i) from public.injuries i where id = 'e0000000-0000-0000-0000-000000000004'), true);
select pg_temp.ok('so only Kai''s document is listed', (select array_agg(split_part(d, '/', 1)) = array[pg_temp.id('32')::text] from public.expired_injury_documents() d), true);
delete from storage.objects where bucket_id = 'injury-documents';
select pg_temp.ok('once the files are gone, only Kai''s injury goes', (select public.purge_expired_injuries() = 1), true);
select pg_temp.ok('Jordan''s stays', (select count(*) = 1 from public.injuries where id = 'e0000000-0000-0000-0000-000000000003'), true);

-- ---------------------------------------------------------------------------
-- Safeguarding records kept for good
-- ---------------------------------------------------------------------------
update public.club_settings set retention_safeguarding_months = 0 where id;
insert into public.stand_downs (profile_id, member_name, reason, started_at, lifted_at) values
  (pg_temp.id('32'), 'Kai Senior', 'other', now() - interval '60 years', now() - interval '59 years');
insert into public.guardianship_history (guardian_id, athlete_id, change, changed_at) values
  (pg_temp.id('41'), pg_temp.id('32'), 'linked', now() - interval '59 years');
select pg_temp.ok('kept for good removes no safeguarding records', (select (r->>'safeguarding_records')::int = 0 from public.purge_expired_records() r), true);
select pg_temp.ok('a stand-down lifted 59 years ago stays', pg_temp.n('stand_downs', 'profile_id', '32') = 1, true);
select pg_temp.ok('guardian link history from 59 years ago stays', pg_temp.n('guardianship_history', 'athlete_id', '32') = 1, true);
update public.club_settings set retention_safeguarding_months = 540 where id;
select pg_temp.ok('45 years removes them', (select (r->>'safeguarding_records')::int = 2 from public.purge_expired_records() r), true);
insert into public.stand_downs (profile_id, member_name, reason, started_at, lifted_at) values
  (pg_temp.id('32'), 'Kai Senior', 'other', now() - interval '45 years', now() - interval '44 years');
select pg_temp.ok('but keeps one lifted 44 years ago', (select (r->>'safeguarding_records')::int = 0 from public.purge_expired_records() r), true);

-- Attendance kept 15 years.
update public.club_settings set retention_attendance_months = 180 where id;
insert into public.attendance_sessions (id, team_id, team_name, name, held_at) values
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Old Team', 'Training', now() - interval '14 years'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Old Team', 'Training', now() - interval '16 years');
select pg_temp.works('the clean-up runs with 15 years of attendance', $$select public.purge_expired_records()$$);
select pg_temp.ok('a session 14 years ago stays', (select count(*) = 1 from public.attendance_sessions where id = 'c0000000-0000-0000-0000-000000000003'), true);
select pg_temp.ok('one 16 years ago goes', (select count(*) = 0 from public.attendance_sessions where id = 'c0000000-0000-0000-0000-000000000004'), true);
select pg_temp.ok('Jordan''s session from 2 years ago still stays', (select count(*) = 1 from public.attendance_sessions where id = 'c0000000-0000-0000-0000-000000000001'), true);

-- Running again removes nothing more about Jordan.
select pg_temp.ok('Jordan''s records are all still here', (
  select pg_temp.n('check_ins', 'athlete_id', '31') = 2
    and pg_temp.n('game_goals', 'athlete_id', '31') = 1
    and pg_temp.n('attendance_marks', 'profile_id', '31') = 1
    and pg_temp.n('stand_downs', 'profile_id', '31') = 1
    and pg_temp.n('injuries', 'athlete_id', '31') >= 2), true);

-- ---------------------------------------------------------------------------
-- A member on hold can't be deleted, by an admin or by themselves
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.fails_with('an admin can''t delete Jordan', $$select public.admin_delete_member(pg_temp.id('31'))$$, 'A concern names this member');
select pg_temp.fails_with('or a held join request', $$select public.admin_delete_member(pg_temp.id('61'))$$, 'A concern names this member');
select pg_temp.as_member('31');
select pg_temp.fails_with('Jordan can''t delete their own account', $$select public.delete_my_account()$$, 'contact a club admin');
select pg_temp.ok('and isn''t told a concern names them', (
  select pg_temp.fails_with('x', $$select public.delete_my_account()$$, 'concern') like 'FAIL%'), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('Jordan is still a member', (select count(*) = 1 from public.profiles where id = pg_temp.id('31')), true);
select pg_temp.ok('with their check-ins', pg_temp.n('check_ins', 'athlete_id', '31') = 2, true);
select pg_temp.as_member('32');
select pg_temp.works('Kai, not on hold, can delete their own account', $$select public.delete_my_account()$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('and is gone', (select count(*) = 0 from public.profiles where id = pg_temp.id('32')), true);
select pg_temp.as_member('01');
select pg_temp.works('an admin can still delete a member not on hold', $$select public.admin_delete_member(pg_temp.id('12'))$$);
select set_config('request.jwt.claim.sub', '', false);
