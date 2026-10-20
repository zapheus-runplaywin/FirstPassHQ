-- Tests for 20261012220000_stand_downs.sql. Run on a database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- From 20261013010000_consents.sql on, coaches see a child's check-ins and
-- injury details only once a guardian consents, so give it here.
do $$ begin
  if to_regprocedure('public.set_child_consent(uuid, boolean, boolean)') is not null then
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
    perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
  end if;
end $$;
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.stand_downs to authenticated;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;

-- Current check: rights as before.
select pg_temp.as_member('11');
select pg_temp.ok('current coach coaches the minor', public.coaches_athlete('00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('current coach sees injuries', public.can_view_athlete_injuries('00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('current coach sees check-ins', public.can_view_check_ins('00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('current coach messages squad', public.can_message_group('00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('current coach has coach role', public.has_role('coach'), true);
select pg_temp.ok('current coach sees check-in board', (select count(*) > 0 from public.check_in_board('00000000-0000-0000-0000-0000000000a1', current_date)), true);
select pg_temp.ok('current coach sees check-in trend', (select count(*) > 0 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', current_date - 7, current_date)), true);

-- Expired check: every coach right stops.
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach coaches the minor', public.coaches_athlete('00000000-0000-0000-0000-000000000031'), false);
select pg_temp.ok('lapsed coach sees injuries', public.can_view_athlete_injuries('00000000-0000-0000-0000-000000000031'), false);
select pg_temp.ok('lapsed coach sees check-ins', public.can_view_check_ins('00000000-0000-0000-0000-000000000031'), false);
select pg_temp.ok('lapsed coach messages squad', public.can_message_group('00000000-0000-0000-0000-0000000000a1'), false);
select pg_temp.ok('lapsed coach takes attendance', public.is_attendance_taker(), false);
select pg_temp.ok('lapsed coach leads squad', public.leads_group('00000000-0000-0000-0000-0000000000a1'), false);
select pg_temp.ok('lapsed coach sees check-in trend', (select count(*) > 0 from public.check_in_trend('00000000-0000-0000-0000-0000000000a1', current_date - 7, current_date)), false);
select pg_temp.ok('lapsed coach sees check-in board', (select count(*) > 0 from public.check_in_board('00000000-0000-0000-0000-0000000000a1', current_date)), false);
select pg_temp.ok('lapsed coach sees goal board', (select count(*) > 0 from public.goal_board()), false);
select pg_temp.ok('lapsed coach sees check-in summary', (select count(*) > 0 from public.check_in_summary(current_date)), false);
select pg_temp.ok('lapsed coach still approved', public.is_approved(), true);

-- Manager and physio with current checks.
select pg_temp.as_member('13');
select pg_temp.ok('manager messages squad', public.can_message_group('00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio sees injuries', public.can_view_athlete_injuries('00000000-0000-0000-0000-000000000031'), true);

-- Committee: lapsed recorded check stops; none recorded (approved before
-- checks were needed) and exempt carry on.
select pg_temp.as_member('21');
select pg_temp.ok('committee with expired check is committee', public.is_committee(), false);
select pg_temp.ok('committee with expired check sees injuries', public.can_view_athlete_injuries('00000000-0000-0000-0000-000000000031'), false);
select pg_temp.as_member('22');
select pg_temp.ok('committee with no check recorded is committee', public.is_committee(), true);
select pg_temp.as_member('23');
select pg_temp.ok('exempt committee is committee', public.is_committee(), true);

-- Admin without a check is still an admin (finding 8 is separate).
select pg_temp.as_member('02');
select pg_temp.ok('admin2 is admin', public.is_admin(), true);

-- Standing down.
select pg_temp.as_member('01');
select pg_temp.fails('admin standing themselves down refused', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000001', 'other', 'test')$$);
select pg_temp.ok('admin can''t stand themselves down', (select stood_down_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000001'), true);
select pg_temp.fails('standing down an athlete-only member refused', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000031', 'allegation', null)$$);
select pg_temp.ok('athlete-only member can''t be stood down', (select stood_down_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.fails('other without a note refused', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000042', 'other', null)$$);
select pg_temp.ok('other needs a note', (select stood_down_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000042'), true);
select public.admin_stand_down('00000000-0000-0000-0000-000000000042', 'interim_negative_notice', 'Letter received 12/10');
select pg_temp.ok('coach-parent stood down', (select stood_down_at is not null from public.profiles where id = '00000000-0000-0000-0000-000000000042'), true);
select pg_temp.ok('coach place removed', (select count(*) = 0 from public.team_members where profile_id = '00000000-0000-0000-0000-000000000042' and team_role <> 'guardian'), true);
-- Guardians follow their child into squads as well as teams (20261020020000),
-- so the coach-parent stays in the squad they coached, as Jordan's guardian.
select pg_temp.ok('their places as their child''s guardian stay, in the team and the squad', (select count(*) = 2 from public.team_members where profile_id = '00000000-0000-0000-0000-000000000042' and team_role = 'guardian'), true);
select pg_temp.ok('stand-down recorded', (select count(*) = 1 from public.stand_downs where profile_id = '00000000-0000-0000-0000-000000000042' and lifted_at is null and jsonb_array_length(placements) = 1), true);

select pg_temp.as_member('42');
select pg_temp.ok('stood-down coach coaches', public.has_role('coach'), false);
select pg_temp.ok('stood-down coach messages squad', public.can_message_group('00000000-0000-0000-0000-0000000000a1'), false);
select pg_temp.ok('stood-down parent still guardian', public.is_guardian_of('00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('stood-down parent sees own child injuries', public.can_view_athlete_injuries('00000000-0000-0000-0000-000000000031'), true);
set role authenticated;
select pg_temp.ok('stood-down member can''t read stand-downs', (select count(*) = 0 from public.stand_downs), true);
reset role;
select pg_temp.fails('member lifting their own refused', $$select public.admin_lift_stand_down('00000000-0000-0000-0000-000000000042', null)$$);
select pg_temp.ok('stood-down member can''t lift their own', (select stood_down_at is not null from public.profiles where id = '00000000-0000-0000-0000-000000000042'), true);

select pg_temp.as_member('01');
select pg_temp.fails('placing a stood-down coach refused', $$insert into public.team_members (team_id, profile_id, team_role, coach_title)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000042', 'coach', 'assistant_coach')$$);
select pg_temp.ok('can''t re-place a stood-down coach', (select count(*) = 0 from public.team_members where profile_id = '00000000-0000-0000-0000-000000000042' and team_role <> 'guardian'), true);
select public.admin_lift_stand_down('00000000-0000-0000-0000-000000000042', 'Notice withdrawn');
select pg_temp.ok('lifted', (select stood_down_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000042'), true);
select pg_temp.ok('place put back', (select count(*) = 1 from public.team_members where profile_id = '00000000-0000-0000-0000-000000000042' and team_role = 'coach' and coach_title = 'assistant_coach'), true);
select pg_temp.ok('the coaching place took over from the guardian place in the squad', (select team_role::text = 'coach' from public.team_members where profile_id = '00000000-0000-0000-0000-000000000042' and team_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('history kept', (select count(*) = 1 from public.stand_downs where profile_id = '00000000-0000-0000-0000-000000000042' and lifted_by_name is not null), true);
select pg_temp.as_member('42');
select pg_temp.ok('lifted coach messages squad again', public.can_message_group('00000000-0000-0000-0000-0000000000a1'), true);

-- Standing down an admin.
select pg_temp.as_member('01');
select public.admin_stand_down('00000000-0000-0000-0000-000000000002', 'allegation', null);
select pg_temp.as_member('02');
select pg_temp.ok('stood-down admin is not admin', public.is_admin(), false);
select pg_temp.fails('stood-down admin can''t stand others down', $$select public.admin_stand_down('00000000-0000-0000-0000-000000000011', 'other', 'x')$$);
select pg_temp.as_member('11');
select pg_temp.ok('coach not stood down by stood-down admin', (select stood_down_at is null from public.profiles where id = '00000000-0000-0000-0000-000000000011'), true);
set role authenticated;
select pg_temp.ok('coach can''t read stand-downs', (select count(*) = 0 from public.stand_downs), true);
reset role;
select pg_temp.as_member('01');
set role authenticated;
select pg_temp.ok('admin reads stand-downs', (select count(*) = 2 from public.stand_downs), true);
reset role;

-- Deleting a stood-down member keeps the record.
select pg_temp.as_member('01');
select public.admin_delete_member('00000000-0000-0000-0000-000000000002');
select pg_temp.ok('record survives deletion', (select count(*) = 1 from public.stand_downs where member_name = 'Blair Admin' and profile_id is null), true);

-- To-dos count a check expiring in 45 days.
update public.profiles set wwcc_expires_on = current_date + 45 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.ok('60-day expiry warning', (select wwcc_expiring >= 1 from public.admin_safety_todos()), true);
