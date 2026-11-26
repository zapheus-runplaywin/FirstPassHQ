-- Tests for 20261127000000_team_goals_stay_with_the_team.sql. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
--
-- Team goals and the comments on them are read by the team's athletes, its
-- coaches with a current check, and its athletes' parents and guardians.
-- Nobody else reads them: not an admin, the committee, the team's manager or
-- physio, or a member outside the team. An admin reads them only when they
-- would without being an admin (as the team's coach, or an athlete's parent).
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
-- What the signed-in member reads under row level security, as the app does.
create or replace function pg_temp.goals() returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.team_game_goals; reset role; return v; end $$;
create or replace function pg_temp.comments() returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.team_game_goal_comments; reset role; return v; end $$;
create or replace function pg_temp.listed() returns bigint language plpgsql as
$$ declare v bigint; begin set local role authenticated;
   select count(*) into v from public.admin_team_games(); reset role; return v; end $$;
grant select on public.team_game_goals, public.team_game_goal_comments to authenticated;

-- A game for the squad (a1: head coach Casey 11, manager Emery 13, athlete
-- Jordan Junior 31 with parents 41 and 42) with one team goal and one
-- comment from Jordan.
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Rockets', 'Round 1', now() + interval '2 days');
insert into public.team_game_goals (id, fixture_id, body, set_by, set_by_name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'Win the centre passes', '00000000-0000-0000-0000-000000000011', 'Casey Coach');
select pg_temp.as_member('31');
select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'Sample comment') is not null;

-- 1. The team still reads its own goals.
select pg_temp.ok('athlete reads the team goal', pg_temp.goals() = 1, true);
select pg_temp.ok('athlete reads the comment', pg_temp.comments() = 1, true);
select pg_temp.as_member('11');
select pg_temp.ok('coach reads the team goal', pg_temp.goals() = 1, true);
select pg_temp.ok('coach reads the comment', pg_temp.comments() = 1, true);
select pg_temp.as_member('41');
select pg_temp.ok('parent reads the team goal', pg_temp.goals() = 1, true);
select pg_temp.ok('parent reads the comment', pg_temp.comments() = 1, true);

-- 2. Nobody outside it does, an admin included.
select pg_temp.as_member('01');
select pg_temp.ok('admin is an admin', public.is_admin(), true);
select pg_temp.ok('admin cannot view the team''s goals', public.can_view_team_goals('00000000-0000-0000-0000-0000000000f1'), false);
select pg_temp.ok('admin reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.ok('admin reads no comments, including the child''s', pg_temp.comments() = 0, true);
select pg_temp.ok('admin is listed no games', pg_temp.listed() = 0, true);
select pg_temp.fails('admin cannot comment', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e1', 'From an admin') $s$);
select pg_temp.fails('admin cannot set a team goal', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Win') $s$);
select pg_temp.as_member('02');
select pg_temp.ok('a second admin reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.as_member('22');
select pg_temp.ok('committee reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.ok('committee reads no comments', pg_temp.comments() = 0, true);
select pg_temp.ok('committee is listed no games', pg_temp.listed() = 0, true);
select pg_temp.as_member('13');
select pg_temp.ok('manager reads no team goals', pg_temp.goals() = 0, true);
select pg_temp.ok('manager reads no comments', pg_temp.comments() = 0, true);
select pg_temp.as_member('11');
select pg_temp.ok('coach is listed no games through the admin list', pg_temp.listed() = 0, true);

-- 3. An admin who coaches the team reads its goals as its coach, and stops
-- when they leave it.
insert into public.team_members (team_id, profile_id, team_role, coach_title)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'coach', 'assistant_coach');
select pg_temp.as_member('01');
select pg_temp.ok('admin who coaches the team reads its goal', pg_temp.goals() = 1, true);
select pg_temp.ok('admin who coaches the team reads the comment', pg_temp.comments() = 1, true);
select pg_temp.ok('the admin list stays empty for them', pg_temp.listed() = 0, true);
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = '00000000-0000-0000-0000-000000000001';
select pg_temp.ok('admin who left the team reads no team goals', pg_temp.goals() = 0, true);

-- 4. The functions stay callable only by signed-in members.
select pg_temp.ok('anon cannot call can_view_team_goals', has_function_privilege('anon', 'public.can_view_team_goals(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot call admin_team_games', has_function_privilege('anon', 'public.admin_team_games()', 'execute'), false);
