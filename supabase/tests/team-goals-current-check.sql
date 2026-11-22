-- Tests for 20261106000000_team_goals_need_current_check.sql. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
--
-- A coach reads a team's goals and comments, and comments on them, only with
-- a current check and while not stood down. Athletes, their guardians and
-- admins are unchanged.
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
-- What the signed-in member reads under row level security, as the app does.
create or replace function pg_temp.goals() returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.team_game_goals; reset role; return v; end $$;
create or replace function pg_temp.comments() returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.team_game_goal_comments; reset role; return v; end $$;
grant select on public.team_game_goals, public.team_game_goal_comments to authenticated;

-- A game for the squad (a1: head coach Casey 11, assistant coaches Drew 12,
-- whose check has lapsed, and Morgan 42, manager Emery 13) and one for the
-- team (a2: Casey). Each has a team goal, and Jordan Junior (31, 14)
-- comments on both.
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Rockets', 'Round 1', now() + interval '2 days'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Comets', 'Round 2', now() + interval '3 days');
insert into public.team_game_goals (id, fixture_id, body, set_by, set_by_name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'Win the centre passes', '00000000-0000-0000-0000-000000000011', 'Casey Coach'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2', 'Win the third quarter', '00000000-0000-0000-0000-000000000011', 'Casey Coach');
select pg_temp.as_member('31');
select pg_temp.works('athlete comments on the squad goal', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Sample comment one') $s$);
select pg_temp.works('athlete comments on the team goal', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e2', 'Sample comment two') $s$);

-- 1. A coach whose check has lapsed keeps their squad place but not the
-- team goals.
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach cannot work with children', public.can_work_with_children(), false);
select pg_temp.ok('lapsed coach is still placed in the squad',
  exists (select 1 from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = auth.uid() and team_role = 'coach'), true);
select pg_temp.ok('lapsed coach cannot view the squad''s team goals', public.can_view_team_goals('00000000-0000-0000-0000-0000000000f1'), false);
select pg_temp.ok('lapsed coach has no part in the game', public.fixture_team_role('00000000-0000-0000-0000-0000000000f1') is null, true);
select pg_temp.ok('lapsed coach reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.ok('lapsed coach reads no comments, including the child''s', pg_temp.comments() = 0, true);
select pg_temp.fails('lapsed coach cannot comment', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Comment from a lapsed coach') $s$);
select pg_temp.fails('lapsed coach still cannot set a team goal', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Win') $s$);

-- 2. Everyone who should see them still does.
select pg_temp.as_member('11');
select pg_temp.ok('current coach reads both team goals', pg_temp.goals() = 2, true);
select pg_temp.ok('current coach reads the comments', pg_temp.comments() = 2, true);
select pg_temp.ok('current coach is the game''s coach', public.fixture_team_role('00000000-0000-0000-0000-0000000000f1') = 'coach', true);
select pg_temp.works('current coach comments', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Agreed') $s$);
select pg_temp.as_member('42');
select pg_temp.ok('cleared assistant coach reads the squad goal', public.can_view_team_goals('00000000-0000-0000-0000-0000000000f1'), true);
select pg_temp.ok('cleared assistant coach is the game''s coach', public.fixture_team_role('00000000-0000-0000-0000-0000000000f1') = 'coach', true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete reads both team goals', pg_temp.goals() = 2, true);
select pg_temp.ok('athlete is the game''s athlete', public.fixture_team_role('00000000-0000-0000-0000-0000000000f1') = 'athlete', true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads both team goals', pg_temp.goals() = 2, true);
select pg_temp.ok('guardian reads the comments', pg_temp.comments() = 3, true);
select pg_temp.fails('guardian cannot comment', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Go team') $s$);
select pg_temp.as_member('01');
select pg_temp.ok('admin reads both team goals', pg_temp.goals() = 2, true);
select pg_temp.as_member('13');
select pg_temp.ok('manager still reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.as_member('22');
select pg_temp.ok('member outside the team reads no team goals', pg_temp.goals() = 0, true);

-- 3. Renewing the check gives the coach the team goals back.
update public.profiles set wwcc_expires_on = public.club_today() + 365 where id = '00000000-0000-0000-0000-000000000012';
select pg_temp.as_member('12');
select pg_temp.ok('renewed coach can work with children', public.can_work_with_children(), true);
select pg_temp.ok('renewed coach reads the squad''s team goal', pg_temp.goals() = 1, true);
select pg_temp.works('renewed coach comments', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Back again') $s$);

-- 4. A coach stood down while the team is archived keeps the team placement
-- but not its team goals.
update public.teams set archived = true where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.as_member('01');
select pg_temp.works('admin stands the coach down', $s$ select public.admin_stand_down('00000000-0000-0000-0000-000000000011', 'allegation', null) $s$);
select pg_temp.ok('the archived team placement is kept',
  exists (select 1 from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a2' and profile_id = '00000000-0000-0000-0000-000000000011'), true);
select pg_temp.as_member('11');
select pg_temp.ok('stood-down coach cannot view the archived team''s goals', public.can_view_team_goals('00000000-0000-0000-0000-0000000000f2'), false);
select pg_temp.ok('stood-down coach reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.ok('stood-down coach reads no comments', pg_temp.comments() = 0, true);
select pg_temp.fails('stood-down coach cannot comment', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Comment while stood down') $s$);
select pg_temp.as_member('31');
select pg_temp.ok('athlete still reads the archived team''s goal', public.can_view_team_goals('00000000-0000-0000-0000-0000000000f2'), true);

-- 5. The functions stay callable only by signed-in members.
select pg_temp.ok('anon cannot call can_view_team_goals', has_function_privilege('anon', 'public.can_view_team_goals(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot call fixture_team_role', has_function_privilege('anon', 'public.fixture_team_role(uuid)', 'execute'), false);
