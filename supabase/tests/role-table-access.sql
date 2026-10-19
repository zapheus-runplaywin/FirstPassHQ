-- Role x table access: who can read which rows of the sensitive tables when
-- signed in, and that members can't write them directly where the app goes
-- through functions. Signed in as the API role (authenticated) with each sample
-- persona, so row level security applies as it does in the app. Expectations
-- come from the migrations' comments and docs/user-guide.md section 11, "Who
-- can see what". Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

-- Supabase gives anon and authenticated every table by default and relies on
-- row level security; the local stubs give them nothing. Grant as Supabase
-- would, then replay every table grant and revoke in the migrations, in order,
-- so the privileges match production.
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
revoke update on public.profiles from authenticated, anon;                                   -- 20261007000000_init, 20261012200000_security_hardening
revoke all on public.former_partner_roles from public, anon, authenticated;                  -- 20261008100000_remove_partner_role
revoke all on public.join_password_attempts from public, anon, authenticated;                -- 20261012200000_security_hardening
revoke all on public.record_access_log from public, anon, authenticated;                     -- 20261013090000_record_access_log
revoke all on public.attendance_absences from public, anon, authenticated;                   -- 20261013120000_family_attendance
revoke all on public.group_membership_changes from public, anon, authenticated;              -- 20261013130000_guardian_activity
revoke all on public.child_activity_seen from public, anon, authenticated;
revoke all on public.conduct_acceptances from public, anon, authenticated;                   -- 20261013140000_code_of_conduct
revoke insert, update, delete on public.games, public.game_members, public.game_events, public.game_snapshots from anon, authenticated; -- 20261015000100_game_stats
revoke all on public.game_pair_attempts from anon, authenticated;
revoke all on table public.personal_tasks from anon;                                         -- 20261015210000_personal_tasks
revoke delete on public.absence_categories from anon, authenticated;                         -- 20261015220000_absence_categories
revoke all on public.absence_reviews from public, anon, authenticated;                       -- 20261015235000_absence_reviews
revoke all on public.season_kpis, public.season_kpi_review_points, public.season_kpi_measures, public.season_kpi_reviews from public, anon, authenticated; -- 20261016000000_season_kpis
revoke all on table public.session_plans, public.session_plan_files, public.session_plan_shares, public.session_plan_views from public, anon, authenticated; -- 20261016010000_session_plans
grant select on table public.session_plans, public.session_plan_files, public.session_plan_shares to authenticated;
revoke all on table public.session_plan_notices from public, anon, authenticated;
revoke all on public.surveys, public.survey_questions, public.survey_recipients, public.survey_responses, public.survey_answers from public, anon, authenticated; -- 20261017100000_surveys

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
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
-- Rows a query returns for the member signed in now.
create or replace function pg_temp.n(q text) returns bigint language plpgsql as
$$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r; end $$;
-- Rows a write changed.
create or replace function pg_temp.changed(statement text) returns bigint language plpgsql as
$$ declare r bigint; begin execute statement; get diagnostics r = row_count; return r; end $$;
-- A refusal by privileges or row level security (SQLSTATE 42501), not some
-- other error that would hide a missing rule.
create or replace function pg_temp.refused(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when insufficient_privilege then return 'PASS ' || label || ' (' || sqlerrm || ')';
   when others then return 'FAIL ' || label || ' (wrong error: ' || sqlerrm || ')'; end $$;
-- One row of a table as JSON, to copy in an insert.
create or replace function pg_temp.row_json(t text, key text) returns jsonb language plpgsql as
$$ declare r jsonb; begin execute format('select to_jsonb(x) from public.%I x where %s limit 1', t, key) into r; return r; end $$;
-- One direct write by a persona: an insert must be refused; an update or
-- delete must change nothing, or be refused where there's no privilege.
create or replace function pg_temp.write(n text, who text, t text, what text, statement text, expect_refusal boolean) returns text language plpgsql as
$$ declare got bigint; label text := t || ': ' || who || ' cannot ' || what || ' directly'; begin
     perform pg_temp.as_member(n);
     if expect_refusal then return pg_temp.refused(label, statement); end if;
     got := pg_temp.changed(statement);
     return case when got = 0 then 'PASS ' else 'FAIL ' end || label || ' (changed ' || got || ' rows)';
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- One matrix cell: signs in as the persona and counts the rows they read.
create or replace function pg_temp.cell(label text, who text, n text, q text, expected int) returns text language plpgsql as
$$ declare got bigint; begin
     perform pg_temp.as_member(n);
     got := pg_temp.n(q);
     return case when got = expected then 'PASS ' else 'FAIL ' end || label || ' | ' || who || ' reads ' || expected || ' (got ' || got || ')';
   exception when others then return 'FAIL ' || label || ' | ' || who || ' (' || sqlerrm || ')'; end $$;

-- ---------------------------------------------------------------------------
-- Personas. The seed has the admin, committee members (current, lapsed),
-- coaches (head, lapsed), the manager, the physio, the athletes, the guardian
-- and the coach-parent. Added here: a coach of another squad, a guest and a
-- member waiting for approval.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000015', 'coach.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000051', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'pending@example.test', now());
update public.profiles set status = 'approved', full_name = 'Olly Othercoach', role = 'coach',
  wwcc_number = 'WWC0015', wwcc_expires_on = current_date + 400, verified_at = now()
where id = '00000000-0000-0000-0000-000000000015';
update public.profiles set status = 'approved', full_name = 'Gus Guest', role = 'guest', verified_at = now()
where id = '00000000-0000-0000-0000-000000000051';
update public.profiles set status = 'pending', full_name = 'Pat Pending', role = 'athlete',
  date_of_birth = current_date - interval '30 years'
where id = '00000000-0000-0000-0000-000000000052';
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000015', 'coach', 'head_coach');

create temp table personas (ord int, key text, n text, who text);
insert into personas values
  (1, 'admin', '01', 'admin'),
  (2, 'committee', '23', 'committee member'),
  (3, 'lapsed_committee', '21', 'committee member with an expired check'),
  (4, 'head_coach', '11', 'head coach'),
  (5, 'lapsed_coach', '12', 'coach with an expired check'),
  (6, 'manager', '13', 'manager'),
  (7, 'physio', '14', 'physio in the squad'),
  (8, 'adult', '32', 'adult athlete'),
  (9, 'minor', '31', 'athlete under 18'),
  (10, 'guardian', '41', 'guardian'),
  (11, 'coach_parent', '42', 'coach who is the child''s guardian'),
  (12, 'other_coach', '15', 'coach of another squad'),
  (13, 'guest', '51', 'guest'),
  (14, 'pending', '52', 'member waiting for approval');
grant select on personas to authenticated;

-- ---------------------------------------------------------------------------
-- Sample records, owned by different people. Jordan Junior (31, under 18,
-- guardians 41 and 42) and Kai Senior (32, adult) are athletes in Sample Squad,
-- coached by Casey (11), Drew (12, expired check) and Morgan (42); Emery (13)
-- manages it and Finley (14) is its physio.
-- ---------------------------------------------------------------------------
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000032', 'Knee', 'Jarred knee', current_date - 1, 'Kai Senior');
insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
select id, athlete_id, athlete_name, 'reported', 'Reported' from public.injuries;
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
values ('00000000-0000-0000-0000-000000000032', current_date, 3, 3, 3, 3, 'Fine');
insert into public.fixtures (id, team_id, team_name, opponent, starts_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Rivals', now() + interval '2 days');
insert into public.game_goals (athlete_id, fixture_id, body, set_by, set_by_name) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Jordan goal', '00000000-0000-0000-0000-000000000031', 'Jordan Junior'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000f1', 'Kai goal', '00000000-0000-0000-0000-000000000032', 'Kai Senior');

-- A squad message from Casey (a guest's copy included, which guests must
-- never see) and a club notice from the admin.
insert into public.messages (id, sender_id, sender_name, body, audience, team_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Squad message', 'group', '00000000-0000-0000-0000-0000000000a1');
insert into public.messages (id, sender_id, sender_name, body, audience) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'Alex Admin', 'Club notice', 'club');
insert into public.message_recipients (message_id, profile_id)
select '00000000-0000-0000-0000-0000000000c1'::uuid, ('00000000-0000-0000-0000-0000000000' || n)::uuid
from unnest(array['12', '13', '14', '31', '32', '41', '42', '51']) n;
insert into public.message_recipients (message_id, profile_id)
select '00000000-0000-0000-0000-0000000000c2'::uuid, ('00000000-0000-0000-0000-0000000000' || n)::uuid
from unnest(array['14', '23', '32', '51']) n;

insert into public.training_requirements (id, season, name, due_on, roles)
values ('00000000-0000-0000-0000-0000000000d1', 2026, 'Integrity course', current_date + 30, '{athlete,coach}');
insert into public.training_certificates (requirement_id, profile_id, submitted_by, submitted_by_name, completed_on, document_path) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000041', 'Logan Parent', current_date, 'x/jordan.pdf'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'Casey Coach', current_date, 'x/casey.pdf');

insert into public.awards (id, season, name, closes_at, voter_roles)
values ('00000000-0000-0000-0000-0000000000e1', 2026, 'Best and fairest', now() + interval '7 days', '{athlete,coach}');
insert into public.award_ballots (id, award_id, voter_id) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000032'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000011');
insert into public.award_votes (ballot_id, rank, points, nominee_id, nominee_name) values
  ('00000000-0000-0000-0000-0000000000e2', 1, 3, '00000000-0000-0000-0000-000000000031', 'Jordan Junior'),
  ('00000000-0000-0000-0000-0000000000e3', 1, 3, '00000000-0000-0000-0000-000000000032', 'Kai Senior');

insert into public.stand_downs (profile_id, member_name, reason, note)
values ('00000000-0000-0000-0000-000000000012', 'Drew Lapsed', 'allegation', 'Being looked into');
insert into public.screening_notices (profile_id, member_name, kind, received_on, action)
values ('00000000-0000-0000-0000-000000000012', 'Drew Lapsed', 'interim_negative_notice', current_date, 'Stood down');
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name)
values ('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000031', 'Jordan Junior');
insert into public.policy_acknowledgements (profile_id, policy_version, statement)
values ('00000000-0000-0000-0000-000000000032', '1', 'I have read the policies');
insert into public.push_tokens (token, profile_id) values ('kai-token', '00000000-0000-0000-0000-000000000032');
insert into public.personal_tasks (profile_id, title) values ('00000000-0000-0000-0000-000000000011', 'Plan pre-season');
insert into public.verification_codes (profile_id, code, expires_at)
values ('00000000-0000-0000-0000-000000000052', '123456', now() + interval '10 minutes');
insert into public.playhq_registrations (profile_id, season, registered)
values ('00000000-0000-0000-0000-000000000032', 2026, true);
insert into public.concerns (raised_by, raised_by_name, about_member_id, about_member_name, body)
values ('00000000-0000-0000-0000-000000000031', 'Jordan Junior', '00000000-0000-0000-0000-000000000012', 'Drew Lapsed', 'Something worried me');
insert into public.concern_events (concern_id, by_name, kind, note)
select id, 'Alex Admin', 'note', 'Spoke to Jordan' from public.concerns;
insert into public.injury_document_events (injury_id, document_path, viewer_id, viewer_name, viewer_role, kind)
select id, 'x/letter.pdf', '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Coach', 'viewed' from public.injuries where body_area = 'Knee';

-- Attendance: Sample Squad's training taken by Casey, Other Squad's taken by
-- Olly, and a club-wide clinic taken by the admin.
insert into public.attendance_sessions (id, team_id, team_name, name, taken_by, taken_by_name) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Training', '00000000-0000-0000-0000-000000000011', 'Casey Coach'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'Training', '00000000-0000-0000-0000-000000000015', 'Olly Othercoach');
insert into public.attendance_sessions (id, club_wide, team_name, name, taken_by, taken_by_name) values
  ('00000000-0000-0000-0000-0000000000c5', true, 'Whole club', 'Clinic', '00000000-0000-0000-0000-000000000001', 'Alex Admin');
insert into public.attendance_marks (session_id, profile_id, present) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000031', true),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000032', false),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000032', true);

-- Session plans by Casey: private, shared with the squad's athletes, and
-- shared with the squad's other coaches.
insert into public.session_plans (id, team_id, team_name, title, session_on, share_team_coaches, share_athletes, author_id, author_name, author_position) values
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Private plan', current_date + 1, false, false, '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Head coach'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Athletes plan', current_date + 1, false, true, '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Head coach'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Coaches plan', current_date + 1, true, false, '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Head coach');

-- ---------------------------------------------------------------------------
-- The read matrix. Each row is a set of records and how many of them each
-- persona reads, in persona order:
--   admin, committee, lapsed committee, head coach, lapsed coach, manager,
--   physio, adult athlete, athlete under 18, guardian, coach-parent,
--   other squad's coach, guest, waiting for approval.
-- ---------------------------------------------------------------------------
create temp table matrix (ord serial, phase int, label text, q text, counts int[]);
grant select on matrix to authenticated;
insert into matrix (phase, label, q, counts) values
  (1, 'profiles: Jordan''s profile', $$select 1 from public.profiles where id = pg_temp.m('31')$$,
      '{1,0,0,0,0,0,0,0,1,0,0,0,0,0}'),
  (1, 'profiles: Kai''s profile', $$select 1 from public.profiles where id = pg_temp.m('32')$$,
      '{1,0,0,0,0,0,0,1,0,0,0,0,0,0}'),
  (1, 'profiles: your own profile', $$select 1 from public.profiles where id = auth.uid()$$,
      '{1,1,1,1,1,1,1,1,1,1,1,1,1,1}'),
  (1, 'profiles: anyone else''s profile', $$select 1 from public.profiles where id <> auth.uid() limit 1$$,
      '{1,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'guardianships: Jordan''s guardian links', $$select 1 from public.guardianships where athlete_id = pg_temp.m('31')$$,
      '{2,0,0,0,0,0,0,0,2,1,1,0,0,0}'),
  (1, 'guardianship_history: every link and unlink', $$select 1 from public.guardianship_history$$,
      '{2,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  -- Under 18 with no consent: only the athlete, their guardians and admins.
  (1, 'injuries: Jordan''s, no consent yet', $$select 1 from public.injuries where athlete_id = pg_temp.m('31')$$,
      '{1,0,0,0,0,0,0,0,1,1,1,0,0,0}'),
  (1, 'injury_updates: Jordan''s, no consent yet', $$select 1 from public.injury_updates u join public.injuries i on i.id = u.injury_id where i.athlete_id = pg_temp.m('31')$$,
      '{1,0,0,0,0,0,0,0,1,1,1,0,0,0}'),
  -- Adults: the athlete, their coaches, their physio, the committee and admins; never managers.
  (1, 'injuries: Kai''s', $$select 1 from public.injuries where athlete_id = pg_temp.m('32')$$,
      '{1,1,0,1,0,0,1,1,0,0,1,0,0,0}'),
  (1, 'injury_updates: Kai''s', $$select 1 from public.injury_updates u join public.injuries i on i.id = u.injury_id where i.athlete_id = pg_temp.m('32')$$,
      '{1,1,0,1,0,0,1,1,0,0,1,0,0,0}'),
  (1, 'injury_document_events: views of Kai''s documents', $$select 1 from public.injury_document_events$$,
      '{0,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  -- Check-ins: the athlete, their guardians and their coaches (for a child,
  -- only with a data consent). Committee, physios and admins see averages only.
  (1, 'check_ins: Jordan''s, no consent yet', $$select 1 from public.check_ins where athlete_id = pg_temp.m('31')$$,
      '{0,0,0,0,0,0,0,0,1,1,1,0,0,0}'),
  (1, 'check_ins: Kai''s', $$select 1 from public.check_ins where athlete_id = pg_temp.m('32')$$,
      '{0,0,0,1,0,0,0,1,0,0,1,0,0,0}'),
  -- Game goals: the athlete, their guardians and their coaches. Not the committee, physios or admins.
  (1, 'game_goals: Jordan''s', $$select 1 from public.game_goals where athlete_id = pg_temp.m('31')$$,
      '{0,0,0,1,0,0,0,0,1,1,1,0,0,0}'),
  (1, 'game_goals: Kai''s', $$select 1 from public.game_goals where athlete_id = pg_temp.m('32')$$,
      '{0,0,0,1,0,0,0,1,0,0,1,0,0,0}'),
  -- Messages: recipients, the sender and admins. Guests never; physios get
  -- squad messages but not club ones unless an admin turns that on.
  (1, 'messages: Casey''s squad message', $$select 1 from public.messages where id = '00000000-0000-0000-0000-0000000000c1'$$,
      '{1,0,0,1,1,1,1,1,1,1,1,0,0,0}'),
  (1, 'messages: the admin''s club notice', $$select 1 from public.messages where id = '00000000-0000-0000-0000-0000000000c2'$$,
      '{1,1,0,0,0,0,0,1,0,0,0,0,0,0}'),
  (1, 'message_recipients: other people''s receipts of the squad message', $$select 1 from public.message_recipients where message_id = '00000000-0000-0000-0000-0000000000c1' and profile_id <> auth.uid()$$,
      '{8,0,0,8,0,0,0,0,0,0,0,0,0,0}'),
  -- Training certificates: the member, their guardians, the committee and admins. Not coaches.
  (1, 'training_certificates: Jordan''s', $$select 1 from public.training_certificates where profile_id = pg_temp.m('31')$$,
      '{1,1,0,0,0,0,0,0,1,1,1,0,0,0}'),
  (1, 'training_certificates: Casey''s', $$select 1 from public.training_certificates where profile_id = pg_temp.m('11')$$,
      '{1,1,0,1,0,0,0,0,0,0,0,0,0,0}'),
  -- Award votes: only the voter, admins included.
  (1, 'award_ballots: anyone else''s', $$select 1 from public.award_ballots where voter_id is distinct from auth.uid()$$,
      '{0,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'award_ballots: your own', $$select 1 from public.award_ballots where voter_id = auth.uid()$$,
      '{0,0,0,1,0,0,0,1,0,0,0,0,0,0}'),
  (1, 'award_votes: anyone else''s', $$select 1 from public.award_votes v join public.award_ballots b on b.id = v.ballot_id where b.voter_id is distinct from auth.uid()$$,
      '{0,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'award_votes: every vote', $$select 1 from public.award_votes$$,
      '{0,0,0,1,0,0,0,1,0,0,0,0,0,0}'),
  -- Safeguarding records: admins only; the member stood down doesn't see the reason.
  (1, 'stand_downs: Drew''s stand-down', $$select 1 from public.stand_downs$$,
      '{1,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'screening_notices: Drew''s notice', $$select 1 from public.screening_notices$$,
      '{1,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'volunteer_exemptions: Logan''s exemption', $$select 1 from public.volunteer_exemptions$$,
      '{1,0,0,0,0,0,0,0,0,1,0,0,0,0}'),
  (1, 'policy_acknowledgements: Kai''s', $$select 1 from public.policy_acknowledgements where profile_id = pg_temp.m('32')$$,
      '{1,0,0,0,0,0,0,1,0,0,0,0,0,0}'),
  (1, 'push_tokens: Kai''s', $$select 1 from public.push_tokens$$,
      '{0,0,0,0,0,0,0,1,0,0,0,0,0,0}'),
  -- Personal tasks: only you, not admins.
  (1, 'personal_tasks: Casey''s', $$select 1 from public.personal_tasks$$,
      '{0,0,0,1,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'team_members: Kai''s squad places', $$select 1 from public.team_members where profile_id = pg_temp.m('32')$$,
      '{1,0,0,0,0,0,0,1,0,0,0,0,0,0}'),
  -- A coach whose check has expired loses the fixtures with the rest of the
  -- group's reads (20261017070000_manager_guide_audit.sql).
  (1, 'fixtures: Sample Squad''s game', $$select 1 from public.fixtures where id = '00000000-0000-0000-0000-0000000000f1'$$,
      '{1,0,0,1,0,1,1,1,1,0,1,0,0,0}'),
  -- Attendance: the committee and admins see every session; coaches and
  -- managers their own groups', whole-club ones and any they took. Athletes
  -- and guardians read marks through functions, never the register.
  (1, 'attendance_marks: Sample Squad''s register', $$select 1 from public.attendance_marks where session_id = '00000000-0000-0000-0000-0000000000a5'$$,
      '{2,2,0,2,0,2,0,0,0,0,2,0,0,0}'),
  (1, 'attendance_sessions: Other Squad''s session', $$select 1 from public.attendance_sessions where id = '00000000-0000-0000-0000-0000000000b5'$$,
      '{1,1,0,0,0,0,0,0,0,0,0,1,0,0}'),
  (1, 'attendance_sessions: the club-wide clinic', $$select 1 from public.attendance_sessions where id = '00000000-0000-0000-0000-0000000000c5'$$,
      '{1,1,0,1,0,1,0,0,0,0,1,1,0,0}'),
  (1, 'attendance_marks: the club-wide clinic''s register', $$select 1 from public.attendance_marks where session_id = '00000000-0000-0000-0000-0000000000c5'$$,
      '{1,1,0,1,0,1,0,0,0,0,1,1,0,0}'),
  -- Session plans: the author and admins; shared ones also those shared with.
  -- Managers, physios and the committee don't see plans.
  (1, 'session_plans: Casey''s private plan', $$select 1 from public.session_plans where id = '00000000-0000-0000-0000-0000000000a7'$$,
      '{1,0,0,1,0,0,0,0,0,0,0,0,0,0}'),
  (1, 'session_plans: shared with the squad''s athletes', $$select 1 from public.session_plans where id = '00000000-0000-0000-0000-0000000000a8'$$,
      '{1,0,0,1,0,0,0,1,1,1,1,0,0,0}'),
  (1, 'session_plans: shared with the squad''s coaches', $$select 1 from public.session_plans where id = '00000000-0000-0000-0000-0000000000a9'$$,
      '{1,0,0,1,0,0,0,0,0,0,1,0,0,0}'),
  -- After Logan (a verified guardian) consents for Jordan.
  (2, 'injuries: Jordan''s, with consent', $$select 1 from public.injuries where athlete_id = pg_temp.m('31')$$,
      '{1,1,0,1,0,0,1,0,1,1,1,0,0,0}'),
  (2, 'injury_updates: Jordan''s, with consent', $$select 1 from public.injury_updates u join public.injuries i on i.id = u.injury_id where i.athlete_id = pg_temp.m('31')$$,
      '{1,1,0,1,0,0,1,0,1,1,1,0,0,0}'),
  (2, 'check_ins: Jordan''s, with consent', $$select 1 from public.check_ins where athlete_id = pg_temp.m('31')$$,
      '{0,0,0,1,0,0,0,0,1,1,1,0,0,0}'),
  (2, 'game_goals: Jordan''s, with consent', $$select 1 from public.game_goals where athlete_id = pg_temp.m('31')$$,
      '{0,0,0,1,0,0,0,0,1,1,1,0,0,0}'),
  -- Once Jordan turns 18 the guardians' access ends.
  (3, 'injuries: Jordan''s, at 18', $$select 1 from public.injuries where athlete_id = pg_temp.m('31')$$,
      '{1,1,0,1,0,0,1,0,1,0,1,0,0,0}'),
  (3, 'check_ins: Jordan''s, at 18', $$select 1 from public.check_ins where athlete_id = pg_temp.m('31')$$,
      '{0,0,0,1,0,0,0,0,1,0,1,0,0,0}'),
  (3, 'game_goals: Jordan''s, at 18', $$select 1 from public.game_goals where athlete_id = pg_temp.m('31')$$,
      '{0,0,0,1,0,0,0,0,1,0,1,0,0,0}'),
  (3, 'training_certificates: Jordan''s, at 18', $$select 1 from public.training_certificates where profile_id = pg_temp.m('31')$$,
      '{1,1,0,0,0,0,0,0,1,0,0,0,0,0}'),
  (3, 'session_plans: shared with athletes, Jordan at 18', $$select 1 from public.session_plans where id = '00000000-0000-0000-0000-0000000000a8'$$,
      '{1,0,0,1,0,0,0,1,1,0,0,0,0,0}'),
  -- Once Casey is stood down, her coach rights stop straight away.
  (4, 'injuries: Kai''s, head coach stood down', $$select 1 from public.injuries where athlete_id = pg_temp.m('32')$$,
      '{1,1,0,0,0,0,1,1,0,0,1,0,0,0}'),
  (4, 'check_ins: Kai''s, head coach stood down', $$select 1 from public.check_ins where athlete_id = pg_temp.m('32')$$,
      '{0,0,0,0,0,0,0,1,0,0,1,0,0,0}'),
  (4, 'game_goals: Kai''s, head coach stood down', $$select 1 from public.game_goals where athlete_id = pg_temp.m('32')$$,
      '{0,0,0,0,0,0,0,1,0,0,1,0,0,0}'),
  (4, 'attendance_sessions: the club-wide clinic, head coach stood down', $$select 1 from public.attendance_sessions where id = '00000000-0000-0000-0000-0000000000c5'$$,
      '{1,1,0,0,0,1,0,0,0,0,1,1,0,0}'),
  -- Nor the records she made as a coach: the register she took, her plans,
  -- and the messages she sent with their receipts.
  (4, 'attendance_marks: the register Casey took, head coach stood down', $$select 1 from public.attendance_marks where session_id = '00000000-0000-0000-0000-0000000000a5'$$,
      '{2,2,0,0,0,2,0,0,0,0,2,0,0,0}'),
  (4, 'attendance_sessions: the session Casey took, head coach stood down', $$select 1 from public.attendance_sessions where id = '00000000-0000-0000-0000-0000000000a5'$$,
      '{1,1,0,0,0,1,0,0,0,0,1,0,0,0}'),
  (4, 'session_plans: Casey''s private plan, head coach stood down', $$select 1 from public.session_plans where id = '00000000-0000-0000-0000-0000000000a7'$$,
      '{1,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  -- Plans she shared stay with the squad: its athletes, their guardians and its other coaches.
  (4, 'session_plans: Casey''s plans, head coach stood down', $$select 1 from public.session_plans where author_id = pg_temp.m('11')$$,
      '{3,0,0,0,0,0,0,1,1,1,2,0,0,0}'),
  (4, 'messages: Casey''s squad message, head coach stood down', $$select 1 from public.messages where id = '00000000-0000-0000-0000-0000000000c1'$$,
      '{1,0,0,0,1,1,1,1,1,1,1,0,0,0}'),
  (4, 'message_recipients: receipts of Casey''s squad message, head coach stood down', $$select 1 from public.message_recipients where message_id = '00000000-0000-0000-0000-0000000000c1' and profile_id <> auth.uid()$$,
      '{8,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (4, 'my_sent_messages: head coach stood down', $$select 1 from public.my_sent_messages()$$,
      '{1,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  (4, 'message_receipts: Casey''s squad message, head coach stood down', $$select 1 from public.message_receipts('00000000-0000-0000-0000-0000000000c1')$$,
      '{8,0,0,0,0,0,0,0,0,0,0,0,0,0}'),
  -- Once it's lifted she reads them again.
  (5, 'attendance_marks: the register Casey took, stand-down lifted', $$select 1 from public.attendance_marks where session_id = '00000000-0000-0000-0000-0000000000a5'$$,
      '{2,2,0,2,0,2,0,0,0,0,2,0,0,0}'),
  (5, 'session_plans: Casey''s private plan, stand-down lifted', $$select 1 from public.session_plans where id = '00000000-0000-0000-0000-0000000000a7'$$,
      '{1,0,0,1,0,0,0,0,0,0,0,0,0,0}'),
  (5, 'messages: Casey''s squad message, stand-down lifted', $$select 1 from public.messages where id = '00000000-0000-0000-0000-0000000000c1'$$,
      '{1,0,0,1,1,1,1,1,1,1,1,0,0,0}'),
  (5, 'message_recipients: receipts of Casey''s squad message, stand-down lifted', $$select 1 from public.message_recipients where message_id = '00000000-0000-0000-0000-0000000000c1' and profile_id <> auth.uid()$$,
      '{8,0,0,8,0,0,0,0,0,0,0,0,0,0}'),
  (5, 'my_sent_messages: stand-down lifted', $$select 1 from public.my_sent_messages()$$,
      '{1,0,0,1,0,0,0,0,0,0,0,0,0,0}'),
  -- When Olly's check lapses he no longer reads the register he took.
  (6, 'attendance_sessions: the session Olly took, his check lapsed', $$select 1 from public.attendance_sessions where id = '00000000-0000-0000-0000-0000000000b5'$$,
      '{1,1,0,0,0,0,0,0,0,0,0,0,0,0}');

-- The sample records are there to be read (checked as the database owner).
select pg_temp.ok('sample records loaded', (select count(*) = 2 from public.injuries) and (select count(*) = 2 from public.check_ins)
  and (select count(*) = 2 from public.guardianship_history) and (select count(*) = 1 from public.injury_document_events), true);

set role authenticated;
select pg_temp.cell(x.label, p.who, p.n, x.q, x.counts[p.ord]) from matrix x cross join personas p where x.phase = 1 order by x.ord, p.ord;
reset role;

-- Logan, a verified guardian, consents to data and health for Jordan.
select pg_temp.as_member('41');
select pg_temp.works('guardian consents for Jordan', $$select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true)$$);
set role authenticated;
select pg_temp.cell(x.label, p.who, p.n, x.q, x.counts[p.ord]) from matrix x cross join personas p where x.phase = 2 order by x.ord, p.ord;
reset role;

update public.profiles set date_of_birth = current_date - interval '18 years' where id = '00000000-0000-0000-0000-000000000031';
set role authenticated;
select pg_temp.cell(x.label, p.who, p.n, x.q, x.counts[p.ord]) from matrix x cross join personas p where x.phase = 3 order by x.ord, p.ord;
reset role;
update public.profiles set date_of_birth = current_date - interval '14 years' where id = '00000000-0000-0000-0000-000000000031';

select pg_temp.as_member('01');
select pg_temp.works('admin stands Casey down', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000011', 'allegation', null)$$);
set role authenticated;
select pg_temp.cell(x.label, p.who, p.n, x.q, x.counts[p.ord]) from matrix x cross join personas p where x.phase = 4 order by x.ord, p.ord;
reset role;
select pg_temp.as_member('01');
select pg_temp.works('admin lifts Casey''s stand-down', $$select public.admin_lift_stand_down('00000000-0000-0000-0000-000000000011', 'Cleared')$$);
set role authenticated;
select pg_temp.cell(x.label, p.who, p.n, x.q, x.counts[p.ord]) from matrix x cross join personas p where x.phase = 5 order by x.ord, p.ord;
reset role;

update public.profiles set wwcc_expires_on = current_date - 1 where id = '00000000-0000-0000-0000-000000000015';
set role authenticated;
select pg_temp.cell(x.label, p.who, p.n, x.q, x.counts[p.ord]) from matrix x cross join personas p where x.phase = 6 order by x.ord, p.ord;
reset role;

-- ---------------------------------------------------------------------------
-- Tables read only through functions. Nobody, admins included, reads their
-- rows directly: either the API role has no privilege on them, or row level
-- security is on with no policy that lets anyone select.
-- ---------------------------------------------------------------------------
-- No privilege at all.
create temp table revoked_tables (t text);
insert into revoked_tables values
  ('record_access_log'), ('attendance_absences'), ('absence_reviews'), ('group_membership_changes'),
  ('child_activity_seen'), ('conduct_acceptances'), ('season_kpis'), ('season_kpi_review_points'),
  ('season_kpi_measures'), ('season_kpi_reviews'), ('session_plan_views'), ('session_plan_notices'),
  ('surveys'), ('survey_questions'), ('survey_recipients'), ('survey_responses'), ('survey_answers'),
  ('join_password_attempts'), ('former_partner_roles'), ('game_pair_attempts');
grant select on revoked_tables to authenticated;
select pg_temp.ok(t || ': signed-in members have no privilege on it',
  has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert')
  or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete'), false)
from revoked_tables order by t;
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.refused(t || ': even an admin cannot select it', format('select * from public.%I', t)) from revoked_tables order by t;
reset role;

-- Row level security with no select policy, and rows in them to find.
create temp table policy_free_tables (t text);
insert into policy_free_tables values
  ('child_consents'), ('concerns'), ('concern_events'), ('injury_document_events'),
  ('verification_codes'), ('playhq_registrations'), ('club_settings'), ('safeguarding_settings');
grant select on policy_free_tables to authenticated;
select pg_temp.ok(t || ': has rows to find', pg_temp.n(format('select 1 from public.%I', t)) > 0, true) from policy_free_tables order by t;
select pg_temp.ok(t || ': no policy lets anyone select it',
  exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass and polcmd in ('r', '*')), false)
from policy_free_tables order by t;
set role authenticated;
select pg_temp.cell(f.t || ': read directly', p.who, p.n, format('select 1 from public.%I', f.t), 0)
from policy_free_tables f cross join personas p order by f.t, p.ord;
reset role;

-- ---------------------------------------------------------------------------
-- Direct writes. These tables change only through the app's functions, so no
-- member, admins included, inserts, updates or deletes their rows directly.
-- Inserts are refused; updates and deletes change nothing (or are refused
-- where the API role has no privilege).
-- ---------------------------------------------------------------------------
-- mode: rls = the API role has the privilege and row level security stops the
-- write; select only = the migrations left it only select; no update privilege
-- = profiles, whose update privilege the migrations revoked.
create temp table writes (t text, key text, col text, mode text);
insert into writes values
  ('profiles', $$id = '00000000-0000-0000-0000-000000000031'$$, 'full_name', 'no update privilege'),
  ('guardianships', $$athlete_id = '00000000-0000-0000-0000-000000000031'$$, 'created_at', 'rls'),
  ('guardianship_history', $$true$$, 'reason', 'rls'),
  ('injuries', $$athlete_id = '00000000-0000-0000-0000-000000000031'$$, 'description', 'rls'),
  ('injury_updates', $$true$$, 'notes', 'rls'),
  ('check_ins', $$athlete_id = '00000000-0000-0000-0000-000000000031'$$, 'note', 'rls'),
  ('messages', $$id = '00000000-0000-0000-0000-0000000000c1'$$, 'body', 'rls'),
  ('message_recipients', $$message_id = '00000000-0000-0000-0000-0000000000c1'$$, 'read_at', 'rls'),
  ('child_consents', $$athlete_id = '00000000-0000-0000-0000-000000000031'$$, 'withdrawn_at', 'rls'),
  ('concerns', $$true$$, 'body', 'rls'),
  ('concern_events', $$true$$, 'note', 'rls'),
  ('stand_downs', $$true$$, 'note', 'rls'),
  ('screening_notices', $$true$$, 'action', 'rls'),
  ('volunteer_exemptions', $$true$$, 'end_note', 'rls'),
  ('policy_acknowledgements', $$true$$, 'statement', 'rls'),
  ('training_certificates', $$true$$, 'notes', 'rls'),
  ('award_ballots', $$true$$, 'updated_at', 'rls'),
  ('award_votes', $$true$$, 'points', 'rls'),
  ('game_goals', $$true$$, 'body', 'rls'),
  ('attendance_sessions', $$true$$, 'name', 'rls'),
  ('attendance_marks', $$true$$, 'present', 'rls'),
  ('session_plans', $$true$$, 'title', 'select only'),
  ('fixtures', $$true$$, 'venue', 'rls'),
  ('push_tokens', $$true$$, 'platform', 'rls'),
  ('verification_codes', $$true$$, 'code', 'rls'),
  ('injury_document_events', $$true$$, 'kind', 'rls'),
  ('club_settings', $$true$$, 'features', 'rls'),
  ('safeguarding_settings', $$true$$, 'policy_version', 'rls');
-- A copy of one existing row of each, with a fresh id where it has one (the
-- settings tables have a single row keyed by true).
create temp table write_rows as
select w.*, j.r, format('insert into public.%I select * from jsonb_populate_record(null::public.%I, %L::jsonb)', w.t, w.t,
     case when jsonb_typeof(j.r -> 'id') = 'string' then j.r || jsonb_build_object('id', gen_random_uuid()) else j.r end) as ins
from writes w, lateral (select pg_temp.row_json(w.t, w.key) as r) j;
grant select on write_rows to authenticated;
select pg_temp.ok(t || ': has a row to write', r is not null, true) from write_rows order by t;

set role authenticated;
select pg_temp.write(p.n, p.who, w.t, 'insert', w.ins, true)
from write_rows w cross join personas p
where p.key in ('admin', 'committee', 'head_coach', 'physio', 'adult', 'minor', 'guardian') order by w.t, p.ord;
select pg_temp.write(p.n, p.who, w.t, 'update', format('update public.%I set %I = %I where %s', w.t, w.col, w.col, w.key), w.mode <> 'rls')
from write_rows w cross join personas p
where p.key in ('admin', 'committee', 'head_coach', 'physio', 'adult', 'minor', 'guardian') order by w.t, p.ord;
select pg_temp.write(p.n, p.who, w.t, 'delete', format('delete from public.%I where %s', w.t, w.key), w.mode = 'select only')
from write_rows w cross join personas p
where p.key in ('admin', 'committee', 'head_coach', 'physio', 'adult', 'minor', 'guardian') order by w.t, p.ord;
reset role;
select pg_temp.ok('every row is still there', (select bool_and(pg_temp.row_json(t, key) is not null) from write_rows), true);
select pg_temp.ok('Jordan''s injury unchanged', (select description = 'Rolled ankle at training' from public.injuries where athlete_id = pg_temp.m('31')), true);
select pg_temp.ok('Jordan''s name unchanged', (select full_name = 'Jordan Junior' from public.profiles where id = pg_temp.m('31')), true);

-- Squads, teams and their members: admins manage them directly; nobody else does.
set role authenticated;
select pg_temp.write(n, who, 'teams', 'add a squad', $$insert into public.teams (name, kind, sort_order) values ('Sneaky Squad', 'squad', 9)$$, true)
from personas where key <> 'admin' order by ord;
select pg_temp.write(n, who, 'team_members', 'join a squad', format($$insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000b1', %L, 'athlete')$$, pg_temp.m(n)), true)
from personas where key <> 'admin' order by ord;
select pg_temp.write(n, who, 'teams', 'rename a squad', $$update public.teams set name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a1'$$, false)
from personas where key <> 'admin' order by ord;
select pg_temp.write(n, who, 'team_members', 'remove people from a squad', $$delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1'$$, false)
from personas where key <> 'admin' order by ord;
select pg_temp.as_member('01');
select pg_temp.ok('teams: admin renames a squad', pg_temp.changed($$update public.teams set name = 'Sample Squad' where id = '00000000-0000-0000-0000-0000000000a1'$$) = 1, true);
select pg_temp.works('team_members: admin places a member', $$insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000032', 'athlete')$$);
reset role;
select pg_temp.ok('squad places and groups unchanged', (select count(*) from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1') = 7
  and (select count(*) from public.teams) = 3, true);
