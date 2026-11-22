-- Tests for 20261017120000_retention_gaps.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
-- auth.users needs last_sign_in_at (Supabase has it; the local stubs may not):
alter table auth.users add column if not exists last_sign_in_at timestamptz;
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
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
select set_config('request.jwt.claim.sub', '', false);

-- Who can call what.
select pg_temp.ok('members can call the new setter (admins only inside)', has_function_privilege('authenticated', 'public.admin_set_more_record_retention(integer, integer, integer, integer)', 'execute'), true);
select pg_temp.ok('anon cannot save', has_function_privilege('anon', 'public.admin_set_more_record_retention(integer, integer, integer, integer)', 'execute'), false);
select pg_temp.ok('anon cannot list inactive members', has_function_privilege('anon', 'public.admin_inactive_members()', 'execute'), false);
select pg_temp.ok('members cannot run the purge', has_function_privilege('authenticated', 'public.purge_expired_records()', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Defaults and choices
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.ok('unsaved club gets defaults (7y, 30y, 1y, 10y)', (select injuries_months = 84 and safeguarding_months = 360 and award_votes_months = 12 and awards_months = 120 from public.more_record_retention()), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach reads nothing', (select count(*) = 0 from public.more_record_retention()), true);
select pg_temp.fails('coach cannot save', $$select public.admin_set_more_record_retention(84, 360, 12, 120)$$);
select pg_temp.ok('coach sees no inactive members', (select count(*) = 0 from public.admin_inactive_members()), true);
select pg_temp.as_member('01');
select pg_temp.fails('safeguarding 5 years refused', $$select public.admin_set_more_record_retention(84, 60, 12, 120)$$);
select pg_temp.fails('injuries 1 year refused', $$select public.admin_set_more_record_retention(12, 360, 12, 120)$$);
select pg_temp.fails('awards shorter than votes refused', $$select public.admin_set_more_record_retention(84, 360, 60, 36)$$);
select pg_temp.works('awards kept for good allowed', $$select public.admin_set_more_record_retention(84, 360, 60, 0)$$);
select pg_temp.ok('kept for good reads back as 0', (select awards_months = 0 and award_votes_months = 60 from public.more_record_retention()), true);
select pg_temp.works('admin saves 3y injuries, 7y safeguarding, 1y votes, 3y awards', $$select public.admin_set_more_record_retention(36, 84, 12, 36)$$);
select pg_temp.ok('saved values read back', (select injuries_months = 36 and safeguarding_months = 84 and award_votes_months = 12 and awards_months = 36 from public.more_record_retention()), true);
select pg_temp.ok('saving marks who changed it', (select retention_updated_by_name is not null from public.club_settings where id), true);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Deleting a member keeps their safeguarding records
-- ---------------------------------------------------------------------------
insert into public.teams (id, name, kind, season) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Under 17s', 'team', 2026);
insert into public.attendance_sessions (id, team_id, team_name, name, held_at)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Under 17s', 'Training', now());
insert into public.attendance_marks (session_id, profile_id, present) values ('bbbbbbbb-0000-0000-0000-000000000001', pg_temp.id('32'), true);
insert into public.messages (id, sender_id, sender_name, body, audience) values ('cccccccc-0000-0000-0000-000000000001', pg_temp.id('11'), 'Casey Coach', 'Training moved', 'club');
insert into public.message_recipients (message_id, profile_id, read_at) values ('cccccccc-0000-0000-0000-000000000001', pg_temp.id('32'), now());
insert into public.training_requirements (id, season, name, due_on, roles) values ('dddddddd-0000-0000-0000-000000000001', 2026, 'Integrity basics', public.club_today(), '{athlete}');
insert into public.training_certificates (requirement_id, profile_id, completed_on, document_path) values ('dddddddd-0000-0000-0000-000000000001', pg_temp.id('32'), public.club_today(), pg_temp.id('32') || '/cert.pdf');
insert into storage.objects (bucket_id, name) values ('training-certificates', pg_temp.id('32') || '/cert.pdf');
insert into public.record_access_log (subject_id, viewer_id, kind) values (pg_temp.id('32'), pg_temp.id('11'), 'member_record');
insert into public.child_consents (athlete_id, kind, policy_version) values (pg_temp.id('32'), 'data', 'v1');
insert into public.conduct_acceptances (profile_id, season, accepted_as, policy_version, statement) values (pg_temp.id('32'), 2026, 'self', 'v1', 'I agree');
insert into public.policy_acknowledgements (profile_id, policy_version, statement) values (pg_temp.id('32'), 'v1', 'I agree');
insert into public.volunteer_exemptions (profile_id, basis) values (pg_temp.id('32'), 'under_18_volunteer');

select pg_temp.as_member('01');
select pg_temp.works('admin deletes the athlete', $$select public.admin_delete_member('00000000-0000-0000-0000-000000000032')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('profile gone', (select count(*) = 0 from public.profiles where id = pg_temp.id('32')), true);
select pg_temp.ok('attendance mark kept with name', (select member_name = 'Kai Senior' and member_left_at is not null from public.attendance_marks where profile_id = pg_temp.id('32')), true);
select pg_temp.ok('message receipt kept', (select member_name is not null and read_at is not null from public.message_recipients where profile_id = pg_temp.id('32')), true);
select pg_temp.ok('certificate kept with its file', (select count(*) = 1 from public.training_certificates where profile_id = pg_temp.id('32') and member_left_at is not null), true);
select pg_temp.ok('record view kept', (select subject_name is not null from public.record_access_log where subject_id = pg_temp.id('32')), true);
select pg_temp.ok('consent kept', (select athlete_name is not null from public.child_consents where athlete_id = pg_temp.id('32')), true);
select pg_temp.ok('conduct acceptance kept', (select member_name is not null from public.conduct_acceptances where profile_id = pg_temp.id('32')), true);
select pg_temp.ok('policy acknowledgement kept', (select member_name is not null from public.policy_acknowledgements where profile_id = pg_temp.id('32')), true);
select pg_temp.ok('exemption kept and ended', (select member_name is not null and ended_at is not null and end_note = 'Member deleted' from public.volunteer_exemptions where profile_id = pg_temp.id('32')), true);
select pg_temp.as_member('11');
select pg_temp.ok('sender still sees the deleted member''s receipt', (select full_name like '% (deleted)' from public.message_receipts('cccccccc-0000-0000-0000-000000000001')), true);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- When a request was turned down
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.id('51'), 'rejected.old@example.test', now()),
  (pg_temp.id('52'), 'rejected.new@example.test', now()),
  (pg_temp.id('53'), 'pending.old@example.test', now()),
  (pg_temp.id('54'), 'pending.new@example.test', now()),
  (pg_temp.id('55'), 'helper.old@example.test', now()),
  (pg_temp.id('56'), 'helper.recent@example.test', now()),
  (pg_temp.id('57'), 'inactive@example.test', now()),
  (pg_temp.id('58'), 'quiet.recent@example.test', now());
update public.profiles set status = 'rejected', full_name = 'Old Reject' where id = pg_temp.id('51');
select pg_temp.ok('rejecting stamps rejected_at', (select rejected_at is not null from public.profiles where id = pg_temp.id('51')), true);
update public.profiles set status = 'rejected', full_name = 'New Reject' where id = pg_temp.id('52');
update public.profiles set rejected_at = now() - interval '91 days' where id = pg_temp.id('51');
update public.profiles set full_name = 'Old Pending', join_requested_at = now() - interval '91 days' where id = pg_temp.id('53');
update public.profiles set full_name = 'New Pending', join_requested_at = now() - interval '10 days' where id = pg_temp.id('54');
update public.profiles set status = 'approved', full_name = 'Old Helper', role = 'volunteer', volunteer_until = public.club_today() - 400 where id = pg_temp.id('55');
update public.profiles set status = 'approved', full_name = 'Recent Helper', role = 'volunteer', volunteer_until = public.club_today() - 30 where id = pg_temp.id('56');
update public.profiles set status = 'approved', full_name = 'Ivy Inactive', role = 'athlete', created_at = now() - interval '3 years' where id = pg_temp.id('57');
update auth.users set last_sign_in_at = now() - interval '30 months' where id = pg_temp.id('57');
update public.profiles set status = 'approved', full_name = 'Quinn Quiet', role = 'athlete', created_at = now() - interval '3 years' where id = pg_temp.id('58');
update auth.users set last_sign_in_at = now() - interval '1 month' where id = pg_temp.id('58');

-- Inactive members, for admins.
select pg_temp.as_member('01');
select pg_temp.ok('athlete with no team for 2 years is listed', (select count(*) = 1 from public.admin_inactive_members() where profile_id = pg_temp.id('57')), true);
select pg_temp.ok('athlete who signed in last month is not', (select count(*) = 0 from public.admin_inactive_members() where profile_id = pg_temp.id('58')), true);
select pg_temp.ok('admins are never listed', (select count(*) = 0 from public.admin_inactive_members() where profile_id = pg_temp.id('01')), true);
select set_config('request.jwt.claim.sub', '', false);
insert into public.team_members (team_id, profile_id, team_role) values ('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.id('57'), 'athlete');
select pg_temp.as_member('01');
select pg_temp.ok('a place in a current team takes them off the list', (select count(*) = 0 from public.admin_inactive_members() where profile_id = pg_temp.id('57')), true);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Old records for the purge
-- ---------------------------------------------------------------------------
-- Injuries: old cleared (goes), old cleared with a file (stays until the
-- file goes), recent cleared (stays), old but not cleared (stays).
insert into public.injuries (id, athlete_id, body_area, description, injured_on, status, cleared_at) values
  ('eeeeeeee-0000-0000-0000-000000000001', pg_temp.id('31'), 'Ankle', 'Rolled', public.club_today() - 1500, 'cleared', now() - interval '4 years'),
  ('eeeeeeee-0000-0000-0000-000000000002', pg_temp.id('31'), 'Knee', 'Sore', public.club_today() - 1500, 'cleared', now() - interval '4 years'),
  ('eeeeeeee-0000-0000-0000-000000000003', pg_temp.id('31'), 'Wrist', 'Sprain', public.club_today() - 400, 'cleared', now() - interval '1 year'),
  ('eeeeeeee-0000-0000-0000-000000000004', pg_temp.id('31'), 'Back', 'Tight', public.club_today() - 1500, 'injured', null);
insert into storage.objects (bucket_id, name) values ('injury-documents', pg_temp.id('31') || '/eeeeeeee-0000-0000-0000-000000000002/letter.pdf');

-- Safeguarding records, with the club's 7-year period.
insert into public.stand_downs (id, profile_id, member_name, reason, started_at, lifted_at) values
  ('f0000000-0000-0000-0000-000000000001', pg_temp.id('12'), 'Drew Lapsed', 'other', now() - interval '9 years', now() - interval '8 years'),
  ('f0000000-0000-0000-0000-000000000002', pg_temp.id('12'), 'Drew Lapsed', 'other', now() - interval '9 years', null),
  ('f0000000-0000-0000-0000-000000000003', pg_temp.id('12'), 'Drew Lapsed', 'other', now() - interval '3 years', now() - interval '2 years');
insert into public.screening_notices (profile_id, member_name, kind, received_on, action) values
  (pg_temp.id('12'), 'Drew Lapsed', 'other', public.club_today() - 3000, 'Noted'),
  (pg_temp.id('12'), 'Drew Lapsed', 'other', public.club_today() - 100, 'Noted');
insert into public.child_consents (athlete_id, kind, policy_version, given_at, withdrawn_at) values
  (pg_temp.id('31'), 'health', 'v0', now() - interval '9 years', now() - interval '8 years'),
  (pg_temp.id('31'), 'data', 'v0', now() - interval '9 years', null);
insert into public.policy_acknowledgements (profile_id, policy_version, statement, acknowledged_at) values
  (pg_temp.id('11'), 'v0', 'I agree', now() - interval '9 years'),
  (pg_temp.id('11'), 'v0.5', 'I agree', now() - interval '8 years'),
  (pg_temp.id('13'), 'v0', 'I agree', now() - interval '9 years');
insert into public.conduct_acceptances (profile_id, season, accepted_as, policy_version, statement, accepted_at) values
  (pg_temp.id('31'), 2017, 'self', 'v0', 'I agree', now() - interval '9 years');
insert into public.guardianship_history (guardian_id, athlete_id, change, changed_at) values
  (pg_temp.id('41'), pg_temp.id('31'), 'linked', now() - interval '9 years'),
  (pg_temp.id('41'), pg_temp.id('31'), 'linked', now() - interval '1 year');

-- Awards with the club's 1-year votes and 3-year awards.
insert into public.awards (id, season, name, closes_at, voter_roles) values
  ('a1000000-0000-0000-0000-000000000001', 2022, 'Best and fairest 2022', now() - interval '4 years', '{athlete}'),
  ('a1000000-0000-0000-0000-000000000002', 2024, 'Best and fairest 2024', now() - interval '2 years', '{athlete}'),
  ('a1000000-0000-0000-0000-000000000003', 2026, 'Best and fairest 2026', now() - interval '1 month', '{athlete}');
insert into public.award_ballots (id, award_id, voter_id) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', pg_temp.id('31')),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', pg_temp.id('31')),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', pg_temp.id('31'));
insert into public.award_votes (ballot_id, rank, points, nominee_name) values
  ('a2000000-0000-0000-0000-000000000001', 1, 3, 'Ivy'),
  ('a2000000-0000-0000-0000-000000000002', 1, 3, 'Ivy'),
  ('a2000000-0000-0000-0000-000000000003', 1, 3, 'Ivy');

-- ---------------------------------------------------------------------------
-- Nothing goes while removal is off
-- ---------------------------------------------------------------------------
select pg_temp.ok('purge off does nothing', (select public.purge_expired_records() = '{"enabled": false}'::jsonb), true);
select pg_temp.ok('old reject still there while off', (select count(*) = 1 from public.profiles where id = pg_temp.id('51')), true);

update public.club_settings set retention_enabled = true where id;
select pg_temp.works('purge runs', $$select public.purge_expired_records()$$);

-- People
select pg_temp.ok('request rejected 91 days ago removed', (select count(*) = 0 from public.profiles where id = pg_temp.id('51')), true);
select pg_temp.ok('its sign-in removed too', (select count(*) = 0 from auth.users where id = pg_temp.id('51')), true);
select pg_temp.ok('recent reject kept', (select count(*) = 1 from public.profiles where id = pg_temp.id('52')), true);
select pg_temp.ok('request unanswered for 91 days removed', (select count(*) = 0 from public.profiles where id = pg_temp.id('53')), true);
select pg_temp.ok('recent request kept', (select count(*) = 1 from public.profiles where id = pg_temp.id('54')), true);
select pg_temp.ok('helper ended over a year ago removed', (select count(*) = 0 from public.profiles where id = pg_temp.id('55')), true);
select pg_temp.ok('helper ended last month kept', (select count(*) = 1 from public.profiles where id = pg_temp.id('56')), true);
select pg_temp.ok('inactive members are not removed automatically', (select count(*) = 2 from public.profiles where id in (pg_temp.id('57'), pg_temp.id('58'))), true);
select pg_temp.ok('approved members untouched', (select count(*) = 1 from public.profiles where id = pg_temp.id('31')), true);

-- Injuries
select pg_temp.ok('old cleared injury removed', (select count(*) = 0 from public.injuries where id = 'eeeeeeee-0000-0000-0000-000000000001'), true);
select pg_temp.ok('old cleared injury with a file left kept', (select count(*) = 1 from public.injuries where id = 'eeeeeeee-0000-0000-0000-000000000002'), true);
select pg_temp.ok('recently cleared injury kept', (select count(*) = 1 from public.injuries where id = 'eeeeeeee-0000-0000-0000-000000000003'), true);
select pg_temp.ok('injury not cleared kept', (select count(*) = 1 from public.injuries where id = 'eeeeeeee-0000-0000-0000-000000000004'), true);

-- Safeguarding
select pg_temp.ok('stand-down lifted 8 years ago removed', (select count(*) = 0 from public.stand_downs where id = 'f0000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('stand-down still in force kept', (select count(*) = 1 from public.stand_downs where id = 'f0000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('recent stand-down kept', (select count(*) = 1 from public.stand_downs where id = 'f0000000-0000-0000-0000-000000000003'), true);
select pg_temp.ok('old notice removed, recent kept', (select count(*) = 1 from public.screening_notices), true);
select pg_temp.ok('withdrawn consent removed, active consent kept', (select count(*) = 1 from public.child_consents where athlete_id = pg_temp.id('31')), true);
select pg_temp.ok('old acknowledgement replaced by a later one removed', (select count(*) = 0 from public.policy_acknowledgements where profile_id = pg_temp.id('11') and policy_version = 'v0'), true);
select pg_temp.ok('a member''s latest acknowledgement kept however old', (select count(*) = 1 from public.policy_acknowledgements where profile_id = pg_temp.id('13')), true);
select pg_temp.ok('old conduct acceptance removed', (select count(*) = 0 from public.conduct_acceptances where season = 2017), true);
select pg_temp.ok('old guardian link history removed, recent kept', (select count(*) filter (where changed_at < now() - interval '5 years') = 0 and count(*) filter (where changed_at between now() - interval '2 years' and now() - interval '6 months') = 1 from public.guardianship_history where athlete_id = pg_temp.id('31')), true);
select pg_temp.ok('deleted athlete''s records from today kept', (select count(*) = 1 from public.child_consents where athlete_id = pg_temp.id('32')), true);

-- Awards
select pg_temp.ok('award closed 4 years ago removed with its votes', (select count(*) = 0 from public.award_votes where ballot_id = 'a2000000-0000-0000-0000-000000000001'), true);
select pg_temp.ok('award closed 2 years ago kept', (select count(*) = 1 from public.awards where id = 'a1000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('its voter removed', (select voter_id is null from public.award_ballots where id = 'a2000000-0000-0000-0000-000000000002'), true);
select pg_temp.ok('its points kept', (select count(*) = 1 from public.award_votes where ballot_id = 'a2000000-0000-0000-0000-000000000002'), true);
select pg_temp.as_member('01');
select pg_temp.ok('its results still add up', (select votes = 1 and nominee_name = 'Ivy' from public.award_results('a1000000-0000-0000-0000-000000000002')), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('recent award keeps who voted', (select voter_id is not null from public.award_ballots where id = 'a2000000-0000-0000-0000-000000000003'), true);

-- Awards kept for good.
update public.club_settings set retention_awards_months = 0, retention_award_votes_months = 12 where id;
update public.awards set closes_at = now() - interval '30 years' where id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.works('purge runs again', $$select public.purge_expired_records()$$);
select pg_temp.ok('awards kept for good stay', (select count(*) = 1 from public.awards where id = 'a1000000-0000-0000-0000-000000000002'), true);

-- Running it again changes nothing else.
select pg_temp.ok('second run removes nothing more', (select (r->>'people')::int = 0 and (r->>'cleared_injuries')::int = 0 and (r->>'safeguarding_records')::int = 0 and (r->>'awards')::int = 0 from public.purge_expired_records() r), true);
