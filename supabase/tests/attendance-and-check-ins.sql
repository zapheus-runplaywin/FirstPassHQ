-- Tests for attendance, check-ins and member details:
-- 20261007130000_attendance.sql (with the helpers replaced in
-- 20261009000000_optional_squads.sql, 20261009110000_multiple_roles.sql and
-- 20261012220000_stand_downs.sql), 20261009110000_multiple_roles.sql
-- (save_check_in, save_my_details) and 20261013010000_consents.sql. Covers
-- save_attendance, attendance_roster, nearby_attendance_sessions,
-- athlete_attendance_summary, save_check_in and save_my_details.
-- Rules checked: coaches and managers take attendance for groups they lead;
-- other takers (the committee) only for a squad, or a team without one;
-- lapsed or stood-down coaches, athletes, guardians and physios can't; only
-- athletes of the group (or club) are marked; whoever took it, the group's
-- leaders and admins correct it; coaches, the committee and admins see
-- attendance records, managers don't; only athletes check in, for today;
-- coaches see a child's check-ins only once a guardian consents, and managers
-- and the committee never do; only the committee and admins have a title.
-- Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.attendance_sessions, public.attendance_marks, public.check_ins to authenticated;
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
create or replace function pg_temp.session(p_name text) returns uuid language sql as
$$ select id from public.attendance_sessions where name = p_name $$;
-- Marks for the two athletes: 31 (under 18) and 32 (adult).
create or replace function pg_temp.marks(p31 boolean, p32 boolean) returns text language sql as
$$ select jsonb_build_array(
     jsonb_build_object('profile_id', pg_temp.m('31'), 'present', p31),
     jsonb_build_object('profile_id', pg_temp.m('32'), 'present', p32))::text $$;

select pg_temp.ok('anon cannot take attendance', has_function_privilege('anon', 'public.save_attendance(uuid, uuid, text, timestamptz, jsonb)', 'execute'), false);
select pg_temp.ok('anon cannot read attendance', has_function_privilege('anon', 'public.athlete_attendance_summary(date, uuid)', 'execute'), false);
select pg_temp.ok('anon cannot check in', has_function_privilege('anon', 'public.save_check_in(date, integer, integer, integer, integer, text)', 'execute'), false);
select pg_temp.ok('members cannot call is_club_athlete directly', has_function_privilege('authenticated', 'public.is_club_athlete(uuid)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- Taking attendance
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('coach takes squad attendance', format('select public.save_attendance(null, %L, %L, now() - interval ''1 hour'', %L)', pg_temp.m('a1'), ' Tuesday training ', pg_temp.marks(true, false)));
select pg_temp.ok('session saved with the squad and the coach''s name', (select team_name = 'Sample Squad' and not club_wide and taken_by = pg_temp.m('11') and taken_by_name = 'Casey Coach' from public.attendance_sessions where name = 'Tuesday training'), true);
select pg_temp.ok('two marks saved', (select count(*) = 2 and count(*) filter (where present) = 1 from public.attendance_marks where session_id = pg_temp.session('Tuesday training')), true);
select pg_temp.fails('session needs a name', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), '  ', pg_temp.marks(true, true)));
select pg_temp.fails('session in the future refused', format('select public.save_attendance(null, %L, %L, now() + interval ''2 days'', %L)', pg_temp.m('a1'), 'Next week', pg_temp.marks(true, true)));
select pg_temp.fails('marks must be a list', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Bad marks', '{"profile_id": 1}'));
select pg_temp.fails('present must be true or false', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Bad mark', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('31'), 'present', 'yes'))));
select pg_temp.fails('only the group''s athletes can be marked', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Manager marked', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('13'), 'present', true))));
select pg_temp.fails('an athlete outside the team cannot be marked', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a2'), 'Team session', pg_temp.marks(true, true)));
select pg_temp.works('coach takes team attendance for their team', format('select public.save_attendance(null, %L, %L, now() - interval ''2 days'', %L)', pg_temp.m('a2'), 'Team session', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('31'), 'present', true))));
select pg_temp.fails('changing a missing record refused', format('select public.save_attendance(%L, null, %L, now(), %L)', pg_temp.m('ee'), 'Gone', '[]'));
select pg_temp.works('coach corrects their record', format('select public.save_attendance(%L, null, %L, now() - interval ''1 hour'', %L)', pg_temp.session('Tuesday training'), 'Tuesday training', pg_temp.marks(true, true)));
select pg_temp.ok('mark corrected in place', (select count(*) = 2 and bool_and(present) from public.attendance_marks where session_id = pg_temp.session('Tuesday training')), true);

select pg_temp.as_member('13');
select pg_temp.works('manager corrects the squad''s record', format('select public.save_attendance(%L, null, %L, now() - interval ''1 hour'', %L)', pg_temp.session('Tuesday training'), 'Tuesday training', pg_temp.marks(true, false)));
select pg_temp.ok('manager''s correction recorded with them', (select marked_by = pg_temp.m('13') and not present from public.attendance_marks where session_id = pg_temp.session('Tuesday training') and profile_id = pg_temp.m('32')), true);
select pg_temp.as_member('42');
select pg_temp.works('another squad coach takes attendance', format('select public.save_attendance(null, %L, %L, now() - interval ''3 days'', %L)', pg_temp.m('a1'), 'Saturday training', pg_temp.marks(false, true)));
select pg_temp.fails('squad coach cannot take attendance for a team they don''t lead', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a2'), 'Not my team', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('31'), 'present', true))));
select pg_temp.as_member('12');
select pg_temp.fails('coach with a lapsed check cannot take attendance', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Lapsed', pg_temp.marks(true, true)));
select pg_temp.fails('coach with a lapsed check cannot correct a record', format('select public.save_attendance(%L, null, %L, now() - interval ''1 hour'', %L)', pg_temp.session('Tuesday training'), 'Tuesday training', pg_temp.marks(false, false)));
select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot take attendance', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Athlete', pg_temp.marks(true, true)));
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot take attendance', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Guardian', pg_temp.marks(true, true)));
select pg_temp.as_member('14');
select pg_temp.fails('physio cannot take attendance', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Physio', pg_temp.marks(true, true)));
update public.profiles set stood_down_at = now() where id = pg_temp.m('11');
select pg_temp.as_member('11');
select pg_temp.fails('stood-down coach cannot take attendance', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a1'), 'Stood down', pg_temp.marks(true, true)));
update public.profiles set stood_down_at = null where id = pg_temp.m('11');

select pg_temp.as_member('22');
select pg_temp.works('committee takes whole-squad attendance', format('select public.save_attendance(null, %L, %L, now() - interval ''5 days'', %L)', pg_temp.m('a1'), 'Squad camp', pg_temp.marks(true, true)));
select pg_temp.fails('committee cannot take attendance for a team in a squad', format('select public.save_attendance(null, %L, %L, now(), %L)', pg_temp.m('a2'), 'Committee team', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('31'), 'present', true))));
select pg_temp.fails('committee cannot correct a coach''s squad record', format('select public.save_attendance(%L, null, %L, now() - interval ''1 hour'', %L)', pg_temp.session('Tuesday training'), 'Tuesday training', pg_temp.marks(false, false)));
select pg_temp.works('committee takes club event attendance', format('select public.save_attendance(null, null, %L, now() - interval ''4 days'', %L)', 'Club presentation', pg_temp.marks(true, false)));
select pg_temp.ok('club event saved for the whole club', (select club_wide and team_id is null and team_name = 'Whole club' from public.attendance_sessions where name = 'Club presentation'), true);
select pg_temp.fails('only athletes go on a club register', format('select public.save_attendance(null, null, %L, now(), %L)', 'Club night', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('11'), 'present', true))));
select pg_temp.as_member('01');
select pg_temp.works('admin takes attendance for a team in a squad', format('select public.save_attendance(null, %L, %L, now() - interval ''6 days'', %L)', pg_temp.m('a2'), 'Admin session', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('31'), 'present', false))));
select pg_temp.works('admin corrects any record', format('select public.save_attendance(%L, null, %L, now() - interval ''3 days'', %L)', pg_temp.session('Saturday training'), 'Saturday training', pg_temp.marks(true, true)));

-- Rosters.
select pg_temp.as_member('11');
select pg_temp.ok('coach''s squad roster is its athletes', (select array_agg(profile_id order by profile_id) = array[pg_temp.m('31'), pg_temp.m('32')] from public.attendance_roster(pg_temp.m('a1'))), true);
select pg_temp.ok('coach''s team roster is its athlete', (select array_agg(profile_id) = array[pg_temp.m('31')] from public.attendance_roster(pg_temp.m('a2'))), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee sees the squad roster', (select count(*) = 2 from public.attendance_roster(pg_temp.m('a1'))), true);
select pg_temp.ok('committee sees no roster for a team in a squad', (select count(*) = 0 from public.attendance_roster(pg_temp.m('a2'))), true);
select pg_temp.ok('club roster is every athlete', (select array_agg(profile_id order by profile_id) = array[pg_temp.m('31'), pg_temp.m('32')] from public.attendance_roster(null)), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees no roster', (select count(*) = 0 from public.attendance_roster(pg_temp.m('a1'))) and (select count(*) = 0 from public.attendance_roster(null)), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees no roster', (select count(*) = 0 from public.attendance_roster(pg_temp.m('a1'))), true);
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach sees no roster', (select count(*) = 0 from public.attendance_roster(pg_temp.m('a1'))), true);

-- Nearby sessions.
select pg_temp.as_member('13');
select pg_temp.ok('manager is warned about the session an hour ago', (select array_agg(name) = array['Tuesday training'] from public.nearby_attendance_sessions(pg_temp.m('a1'), now())), true);
select pg_temp.ok('the session being edited is left out', (select count(*) = 0 from public.nearby_attendance_sessions(pg_temp.m('a1'), now(), pg_temp.session('Tuesday training'))), true);
select pg_temp.ok('nothing within 3 hours of tomorrow', (select count(*) = 0 from public.nearby_attendance_sessions(pg_temp.m('a1'), now() + interval '1 day')), true);
select pg_temp.as_member('11');
select pg_temp.ok('club events nearby', (select array_agg(name) = array['Club presentation'] from public.nearby_attendance_sessions(null, now() - interval '4 days')), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees no nearby sessions', (select count(*) = 0 from public.nearby_attendance_sessions(pg_temp.m('a1'), now())) and (select count(*) = 0 from public.nearby_attendance_sessions(null, now() - interval '4 days')), true);

-- Attendance records: coaches, the committee and admins.
select pg_temp.as_member('11');
select pg_temp.ok('coach sees the junior at 6 sessions, present at 5', (select session_count = 6 and present_count = 5 from public.athlete_attendance_summary(current_date - 10) where profile_id = pg_temp.m('31')), true);
select pg_temp.ok('coach sees squad sessions only when filtered', (select session_count = 3 from public.athlete_attendance_summary(current_date - 10, pg_temp.m('a1')) where profile_id = pg_temp.m('31')), true);
select pg_temp.ok('older sessions left out', (select session_count = 1 from public.athlete_attendance_summary(current_date - 1) where profile_id = pg_temp.m('31')), true);
select pg_temp.ok('last present time is the latest present session', (select last_present_at = (select held_at from public.attendance_sessions where name = 'Tuesday training') from public.athlete_attendance_summary(current_date - 10) where profile_id = pg_temp.m('31')), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee sees everyone''s attendance', (select count(*) = 2 from public.athlete_attendance_summary(current_date - 10)), true);
select pg_temp.ok('committee counts the adult athlete''s 4 sessions, present at 2', (select session_count = 4 and present_count = 2 from public.athlete_attendance_summary(current_date - 10) where profile_id = pg_temp.m('32')), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager sees no attendance records', (select count(*) = 0 from public.athlete_attendance_summary(current_date - 10)), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees no attendance records', (select count(*) = 0 from public.athlete_attendance_summary(current_date - 10)), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees no attendance summary', (select count(*) = 0 from public.athlete_attendance_summary(current_date - 10)), true);
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach sees no attendance records', (select count(*) = 0 from public.athlete_attendance_summary(current_date - 10)), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio sees no attendance records', (select count(*) = 0 from public.athlete_attendance_summary(current_date - 10)), true);

set role authenticated;
select pg_temp.as_member('13');
select pg_temp.ok('manager sees the squad''s sessions and the club event, not the team''s', (select count(*) filter (where team_id = pg_temp.m('a1')) = 3 and count(*) filter (where club_wide) = 1 and count(*) = 4 from public.attendance_sessions), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete reads no sessions or marks', (select count(*) = 0 from public.attendance_sessions) and (select count(*) = 0 from public.attendance_marks), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio reads no marks', (select count(*) = 0 from public.attendance_marks), true);
reset role;

-- ---------------------------------------------------------------------------
-- Check-ins
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.works('adult athlete checks in', $s$ select public.save_check_in(current_date, 4, 4, 3, 5, '  Feeling good  ') $s$);
select pg_temp.ok('check-in saved with the note trimmed', (select sleep = 4 and mood = 5 and note = 'Feeling good' from public.check_ins where athlete_id = pg_temp.m('32')), true);
select pg_temp.works('checking in again replaces it', $s$ select public.save_check_in(current_date, 2, 4, 3, 5, '  ') $s$);
select pg_temp.ok('one check-in for the day, changed', (select count(*) = 1 and min(sleep) = 2 and bool_and(note is null) from public.check_ins where athlete_id = pg_temp.m('32')), true);
select pg_temp.works('check-in for yesterday allowed (time zones)', $s$ select public.save_check_in(current_date - 1, 3, 3, 3, 3) $s$);
select pg_temp.fails('check-in two days ago refused', $s$ select public.save_check_in(current_date - 2, 3, 3, 3, 3) $s$);
select pg_temp.fails('check-in for later in the week refused', $s$ select public.save_check_in(current_date + 2, 3, 3, 3, 3) $s$);
select pg_temp.fails('score above 5 refused', $s$ select public.save_check_in(current_date, 6, 3, 3, 3) $s$);
select pg_temp.fails('score of 0 refused', $s$ select public.save_check_in(current_date, 3, 0, 3, 3) $s$);
select pg_temp.as_member('31');
select pg_temp.works('junior checks in again today', $s$ select public.save_check_in(current_date, 5, 5, 5, 5, 'Better') $s$);
select pg_temp.ok('junior''s check-in replaced', (select count(*) = 1 and min(sleep) = 5 from public.check_ins where athlete_id = pg_temp.m('31')), true);
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot check in', $s$ select public.save_check_in(current_date, 3, 3, 3, 3) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot check in', $s$ select public.save_check_in(current_date, 3, 3, 3, 3) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot check in', $s$ select public.save_check_in(current_date, 3, 3, 3, 3) $s$);

-- Who reads check-ins.
set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('athlete reads only their own check-ins', (select count(*) = 1 and bool_and(athlete_id = pg_temp.m('31')) from public.check_ins), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads the child''s check-ins', (select count(*) = 1 and bool_and(athlete_id = pg_temp.m('31')) from public.check_ins), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach reads the adult''s check-ins', (select count(*) = 2 from public.check_ins where athlete_id = pg_temp.m('32')), true);
select pg_temp.ok('coach reads no child check-ins before consent', (select count(*) = 0 from public.check_ins where athlete_id = pg_temp.m('31')), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager reads no check-ins', (select count(*) = 0 from public.check_ins), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee reads no check-ins', (select count(*) = 0 from public.check_ins), true);
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach reads no check-ins', (select count(*) = 0 from public.check_ins), true);
reset role;
-- A guardian gives consent.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
end $$;
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('coach reads the child''s check-in after consent', (select count(*) = 1 from public.check_ins where athlete_id = pg_temp.m('31')), true);
reset role;

-- ---------------------------------------------------------------------------
-- Member details
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.works('athlete sets a preferred name', $s$ select public.save_my_details('  JJ  ') $s$);
select pg_temp.ok('preferred name trimmed', (select preferred_name = 'JJ' and title is null from public.profiles where id = pg_temp.m('31')), true);
select pg_temp.fails('preferred name over 40 characters refused', format('select public.save_my_details(%L)', repeat('x', 41)));
select pg_temp.fails('athlete cannot have a title', $s$ select public.save_my_details('JJ', 'Captain') $s$);
select pg_temp.works('athlete clears the preferred name', $s$ select public.save_my_details('   ') $s$);
select pg_temp.ok('preferred name cleared', (select preferred_name is null from public.profiles where id = pg_temp.m('31')), true);
select pg_temp.as_member('22');
select pg_temp.works('committee member sets a title', $s$ select public.save_my_details('Harps', ' Secretary ') $s$);
select pg_temp.ok('title saved', (select preferred_name = 'Harps' and title = 'Secretary' from public.profiles where id = pg_temp.m('22')), true);
select pg_temp.fails('title over 40 characters refused', format('select public.save_my_details(null, %L)', repeat('x', 41)));
select pg_temp.as_member('21');
select pg_temp.fails('committee member with a lapsed check has no title', $s$ select public.save_my_details(null, 'President') $s$);
select pg_temp.as_member('99');
select pg_temp.fails('someone without a profile refused', $s$ select public.save_my_details('Ghost') $s$);
