-- Sample records for scripts/check-row-counts.sh: one or more rows in most
-- tables, owned by different sample people, so a migration that loses rows
-- shows up as a lower count. Load after seed-members.sql. Copied from the
-- sample records in role-table-access.sql; sample people only.

-- A coach of another squad, a guest and a member waiting for approval.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000015', 'coach.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000051', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'pending@example.test', now());
update public.profiles set status = 'approved', full_name = 'Olly Othercoach', role = 'coach',
  wwcc_number = 'WWC0015', wwcc_expires_on = public.club_today() + 400, verified_at = now()
where id = '00000000-0000-0000-0000-000000000015';
update public.profiles set status = 'approved', full_name = 'Gus Guest', role = 'guest', verified_at = now()
where id = '00000000-0000-0000-0000-000000000051';
update public.profiles set status = 'pending', full_name = 'Pat Pending', role = 'athlete',
  date_of_birth = public.club_today() - interval '30 years'
where id = '00000000-0000-0000-0000-000000000052';
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000015', 'coach', 'head_coach');


-- ---------------------------------------------------------------------------
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000032', 'Knee', 'Jarred knee', public.club_today() - 1, 'Kai Senior');
insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
select id, athlete_id, athlete_name, 'reported', 'Reported' from public.injuries;
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
values ('00000000-0000-0000-0000-000000000032', public.club_today(), 3, 3, 3, 3, 'Fine');
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
values ('00000000-0000-0000-0000-0000000000d1', 2026, 'Integrity course', public.club_today() + 30, '{athlete,coach}');
insert into public.training_certificates (requirement_id, profile_id, submitted_by, submitted_by_name, completed_on, document_path) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000041', 'Logan Parent', public.club_today(), 'x/jordan.pdf'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'Casey Coach', public.club_today(), 'x/casey.pdf');

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
values ('00000000-0000-0000-0000-000000000012', 'Drew Lapsed', 'interim_negative_notice', public.club_today(), 'Stood down');
insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name)
values ('00000000-0000-0000-0000-000000000041', 'parent_volunteer', '00000000-0000-0000-0000-000000000031', 'Jordan Junior');
insert into public.policy_acknowledgements (profile_id, policy_version, statement)
values ('00000000-0000-0000-0000-000000000032', '1', 'I have read the policies');
insert into public.push_tokens (token, profile_id) values ('kai-token', '00000000-0000-0000-0000-000000000032');
insert into public.personal_tasks (profile_id, title) values ('00000000-0000-0000-0000-000000000011', 'Plan pre-season');
insert into public.verification_codes (profile_id, code, expires_at)
values ('00000000-0000-0000-0000-000000000052', '123456', now() + interval '10 minutes');
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
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Private plan', public.club_today() + 1, false, false, '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Head coach'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Athletes plan', public.club_today() + 1, false, true, '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Head coach'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Coaches plan', public.club_today() + 1, true, false, '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Head coach');
