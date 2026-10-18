-- Tests for 20261013100000_record_retention.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
-- Uses the keep periods from 20261016030000_retention_choices.sql (check-ins,
-- goals, attendance and certificates 1 year, messages 3 years, record views 7
-- years); retention-choices.sql tests every choice offered.
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

-- Old and recent records of every kind.
insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note) values
  ('00000000-0000-0000-0000-000000000031', current_date - interval '13 months', 3, 3, 3, 3, 'old'),
  ('00000000-0000-0000-0000-000000000031', current_date - interval '11 months', 3, 3, 3, 3, 'recent');
insert into public.fixtures (id, team_id, team_name, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', now() - interval '13 months'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', now() - interval '1 month');
insert into public.game_goals (id, athlete_id, fixture_id, body, set_by_name, set_by_coach) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'old goal', 'Jordan Junior', false),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f2', 'new goal', 'Jordan Junior', false);
insert into public.game_goal_comments (goal_id, author_name, body) values
  ('00000000-0000-0000-0000-0000000000b1', 'Casey Coach', 'old comment');
insert into public.team_game_goals (fixture_id, body, set_by_name) values
  ('00000000-0000-0000-0000-0000000000f1', 'old team goal', 'Casey Coach'),
  ('00000000-0000-0000-0000-0000000000f2', 'new team goal', 'Casey Coach');
insert into public.messages (id, sender_name, body, audience, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'Alex Admin', 'old message', 'club', now() - interval '37 months'),
  ('00000000-0000-0000-0000-0000000000c2', 'Alex Admin', 'new message', 'club', now() - interval '1 month');
insert into public.message_recipients (message_id, profile_id, read_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000032', now() - interval '37 months');
insert into public.attendance_sessions (id, team_id, team_name, name, held_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Training', now() - interval '13 months'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Training', now() - interval '11 months');
insert into public.attendance_marks (session_id, profile_id, present) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000031', true);
insert into public.training_requirements (id, season, name, due_on, roles) values
  ('00000000-0000-0000-0000-0000000000e1', 2019, 'Safeguarding course', '2019-06-01', '{coach}');
insert into public.training_certificates (requirement_id, profile_id, completed_on, document_path, status, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000011', '2019-05-01', '00000000-0000-0000-0000-000000000011/gone.pdf', 'approved', now() - interval '13 months'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000013', '2019-05-01', '00000000-0000-0000-0000-000000000013/still-there.pdf', 'approved', now() - interval '13 months'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000014', '2020-05-01', '00000000-0000-0000-0000-000000000014/recent.pdf', 'approved', now() - interval '11 months');
insert into storage.objects (bucket_id, name) values
  ('training-certificates', '00000000-0000-0000-0000-000000000013/still-there.pdf');
insert into public.record_access_log (subject_id, viewer_name, kind, created_at) values
  ('00000000-0000-0000-0000-000000000031', 'Casey Coach', 'check_ins', now() - interval '85 months'),
  ('00000000-0000-0000-0000-000000000031', 'Casey Coach', 'check_ins', now() - interval '83 months');
insert into public.concerns (raised_by_name, body, involves_child, created_at) values
  ('Logan Parent', 'An old concern', 'yes', now() - interval '20 years');

create temp table before as select
  (select count(*) from public.check_ins) as check_ins,
  (select count(*) from public.game_goals) as goals,
  (select count(*) from public.concerns) as concerns;

-- Who can call what.
select pg_temp.ok('members cannot purge', has_function_privilege('authenticated', 'public.purge_expired_records()', 'execute'), false);
select pg_temp.ok('anon cannot purge', has_function_privilege('anon', 'public.purge_expired_records()', 'execute'), false);
select pg_temp.ok('service role can purge', has_function_privilege('service_role', 'public.purge_expired_records()', 'execute'), true);
select pg_temp.ok('members cannot list certificate files', has_function_privilege('authenticated', 'public.expired_certificate_documents()', 'execute'), false);

-- Off by default: nothing goes.
select pg_temp.ok('removal starts off', (select not retention_enabled from public.club_settings), true);
select pg_temp.ok('purge while off reports off', (select public.purge_expired_records() = '{"enabled": false}'::jsonb), true);
select pg_temp.ok('no certificate files listed while off', (select count(*) = 0 from public.expired_certificate_documents()), true);
select pg_temp.ok('nothing removed while off', (select check_ins = (select count(*) from public.check_ins) and goals = (select count(*) from public.game_goals) from before), true);

-- Admins only, with sensible periods.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot change retention', $$select public.admin_set_record_retention(true, 12, 12, 36, 12, 12, 84)$$);
select pg_temp.ok('coach cannot read retention', (select count(*) = 0 from public.record_retention()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin reads the approved defaults', (select not enabled and check_ins_months = 12 and goals_months = 12 and messages_months = 36 and attendance_months = 12 and certificates_months = 12 and access_log_months = 84 from public.record_retention()), true);
select pg_temp.fails('check-ins for 1 month refused', $$select public.admin_set_record_retention(true, 1, 12, 36, 12, 12, 84)$$);
select pg_temp.fails('messages over 7 years refused', $$select public.admin_set_record_retention(true, 12, 12, 121, 12, 12, 84)$$);
select pg_temp.fails('attendance for 10 years refused', $$select public.admin_set_record_retention(true, 12, 12, 36, 120, 12, 84)$$);
select pg_temp.fails('record views under 3 years refused', $$select public.admin_set_record_retention(true, 12, 12, 36, 12, 12, 12)$$);
select pg_temp.fails('missing period refused', $$select public.admin_set_record_retention(true, null, 12, 36, 12, 12, 84)$$);
select pg_temp.works('admin switches removal on', $$select public.admin_set_record_retention(true, 12, 12, 36, 12, 12, 84)$$);
select pg_temp.ok('who and when recorded', (select retention_updated_by_name = 'Alex Admin' and retention_updated_at is not null from public.club_settings), true);

-- The certificate file still in storage is listed for removal; the one
-- already gone and the recent one are not.
select pg_temp.ok('expired certificate files listed', (select array_agg(p order by p) = array['00000000-0000-0000-0000-000000000011/gone.pdf', '00000000-0000-0000-0000-000000000013/still-there.pdf'] from public.expired_certificate_documents() p), true);

create temp table result as select public.purge_expired_records() as r;
select pg_temp.ok('counts returned', (select r ->> 'check_ins' = '1' and r ->> 'game_goals' = '1' and r ->> 'team_goals' = '1' and r ->> 'messages' = '1' and r ->> 'attendance_sessions' = '1' and r ->> 'certificates' = '1' and r ->> 'record_views' = '1' from result), true);
select pg_temp.ok('old check-in removed, recent kept', (select array_agg(note) = array['recent'] from public.check_ins where note in ('old', 'recent')), true);
select pg_temp.ok('old goal and its comment removed', (select count(*) = 0 from public.game_goal_comments) and (select count(*) = 1 from public.game_goals where body = 'new goal') and (select count(*) = 0 from public.game_goals where body = 'old goal'), true);
select pg_temp.ok('old team goal removed, new kept', (select array_agg(body) = array['new team goal'] from public.team_game_goals), true);
select pg_temp.ok('old message text removed', (select body = 'This message was removed after the club''s keep period.' and body_removed_at is not null from public.messages where id = '00000000-0000-0000-0000-0000000000c1'), true);
select pg_temp.ok('old message recipient and read time kept', (select count(*) = 1 from public.message_recipients where message_id = '00000000-0000-0000-0000-0000000000c1' and read_at is not null), true);
select pg_temp.ok('new message untouched', (select body = 'new message' and body_removed_at is null from public.messages where id = '00000000-0000-0000-0000-0000000000c2'), true);
select pg_temp.ok('old attendance and its marks removed', (select count(*) = 0 from public.attendance_marks where session_id = '00000000-0000-0000-0000-0000000000d1') and (select count(*) = 1 from public.attendance_sessions where id = '00000000-0000-0000-0000-0000000000d2'), true);
select pg_temp.ok('certificate with no file left removed', (select count(*) = 0 from public.training_certificates where document_path like '%gone.pdf'), true);
select pg_temp.ok('certificate whose file is still stored kept until it goes', (select count(*) = 1 from public.training_certificates where document_path like '%still-there.pdf'), true);
select pg_temp.ok('recent certificate kept', (select count(*) = 1 from public.training_certificates where document_path like '%recent.pdf'), true);
select pg_temp.ok('old record view removed, recent kept', (select count(*) = 1 from public.record_access_log), true);
select pg_temp.ok('concerns never removed', (select concerns = (select count(*) from public.concerns) from before), true);

-- A second run changes nothing more.
select pg_temp.ok('second run removes nothing', (select r ->> 'check_ins' = '0' and r ->> 'messages' = '0' and r ->> 'certificates' = '0' from (select public.purge_expired_records() as r) x), true);

-- Longer periods keep more.
select pg_temp.works('admin keeps check-ins 2 years', $$select public.admin_set_record_retention(true, 24, 12, 36, 12, 12, 84)$$);
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note) values
  ('00000000-0000-0000-0000-000000000032', current_date - interval '18 months', 3, 3, 3, 3, 'kept longer');
select pg_temp.ok('kept under the longer period', (select (public.purge_expired_records() ->> 'check_ins') = '0'), true);

-- Switching off stops it again.
select pg_temp.works('admin switches removal off', $$select public.admin_set_record_retention(false, 12, 12, 36, 12, 12, 84)$$);
select pg_temp.ok('nothing removed once off', (select public.purge_expired_records() = '{"enabled": false}'::jsonb) and (select count(*) = 1 from public.check_ins where note = 'kept longer'), true);
