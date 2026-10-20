-- Tests for game goals: 20261008200000_game_goals.sql,
-- 20261008220000_game_goals_by_team.sql, 20261009150000_guardians_view_game_goals.sql,
-- 20261011221000_team_goal_comments.sql and the stand-down rules in
-- 20261012220000_stand_downs.sql. Covers save_game_goal, delete_game_goal,
-- reflect_on_game_goal, add_game_goal_comment, save_team_game_goal,
-- delete_team_game_goal, review_team_game_goal, delete_team_game_goal_comment,
-- goal_game, goal_next_game, goal_past_games and coach_team_games.
-- Rules checked: only the athlete and their current coaches set goals (not
-- guardians, managers, physios, admins or lapsed or stood-down coaches); only
-- coaches change coaches' goals and only the athlete changes theirs; goals
-- open 7 days before the next game and close when it starts; reflections and
-- coach comments open after the game; guardians see but don't write; team
-- goals are for the team's coaches. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.game_goals, public.game_goal_comments, public.team_game_goals,
  public.team_game_goal_comments to authenticated;
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
create or replace function pg_temp.goal(p_body text) returns uuid language sql as
$$ select id from public.game_goals where body = p_body $$;
create or replace function pg_temp.team_goal(p_body text) returns uuid language sql as
$$ select id from public.team_game_goals where body = p_body $$;

-- Games for the Sample Team (a2, athlete 31, coach 11) and the Sample Squad
-- (a1, athletes 31 and 32, coaches 11, 12 (lapsed) and 42).
--   f1 next game in 2 days    f2 in 5 days    f3 in 10 days    f4 bye tomorrow
--   f5 played yesterday       f6 played 8 days ago    f7 squad game 3 days ago
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Rockets', 'Round 5', now() + interval '2 days'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Comets', 'Round 6', now() + interval '5 days'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Meteors', 'Round 7', now() + interval '10 days'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', null, 'Bye', now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Stars', 'Round 4', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Planets', 'Round 3', now() - interval '8 days'),
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Moons', 'Round 1', now() - interval '3 days');
-- A goal the athlete set before yesterday's game.
insert into public.game_goals (id, athlete_id, fixture_id, body, set_by, set_by_name, set_by_coach)
values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f5',
  'Talk on defence', '00000000-0000-0000-0000-000000000031', 'Jordan Junior', false);
-- A team goal from yesterday's game.
insert into public.team_game_goals (id, fixture_id, body, set_by, set_by_name)
values ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000f5', 'Win the rebounds',
  '00000000-0000-0000-0000-000000000011', 'Casey Coach');
insert into public.team_game_goals (id, fixture_id, body, set_by, set_by_name)
values ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000f7', 'Squad defence',
  '00000000-0000-0000-0000-000000000011', 'Casey Coach');

-- Nobody signed out can call any of them.
select pg_temp.ok('anon cannot save a goal', has_function_privilege('anon', 'public.save_game_goal(uuid, uuid, uuid, text)', 'execute'), false);
select pg_temp.ok('anon cannot read the next game', has_function_privilege('anon', 'public.goal_next_game(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot save a team goal', has_function_privilege('anon', 'public.save_team_game_goal(uuid, uuid, text)', 'execute'), false);
select pg_temp.ok('anon cannot list coach games', has_function_privilege('anon', 'public.coach_team_games()', 'execute'), false);
select pg_temp.ok('signed-in members can save goals', has_function_privilege('authenticated', 'public.save_game_goal(uuid, uuid, uuid, text)', 'execute'), true);

-- ---------------------------------------------------------------------------
-- Athlete goals: setting them
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.works('athlete sets a goal for the next game', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', '  Hit 5 shots  ') $s$);
select pg_temp.ok('goal saved trimmed, set by the athlete, not a coach', (select set_by = '00000000-0000-0000-0000-000000000031' and not set_by_coach and set_by_name = 'Jordan Junior' from public.game_goals where body = 'Hit 5 shots'), true);
select pg_temp.fails('empty goal refused', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', '   ') $s$);
select pg_temp.fails('goal over 300 characters refused', format('select public.save_game_goal(null, %L, %L, %L)', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', repeat('x', 301)));
select pg_temp.fails('goal for a game that is not the next one refused', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f2', 'Later') $s$);
select pg_temp.fails('goal more than 7 days out refused', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f3', 'Far') $s$);
select pg_temp.fails('goal for a played game refused', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f5', 'Late') $s$);
select pg_temp.fails('goal for a bye refused', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f4', 'Bye') $s$);
select pg_temp.fails('athlete cannot set a goal for another athlete', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000f7', 'Not mine') $s$);

select pg_temp.as_member('32');
select pg_temp.fails('athlete not in the team cannot set a goal for its game', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000f1', 'Not my game') $s$);

select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot set goals', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Parent goal') $s$);
select pg_temp.as_member('13');
select pg_temp.fails('manager cannot set goals', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Manager goal') $s$);
select pg_temp.as_member('14');
select pg_temp.fails('physio cannot set goals', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Physio goal') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot set goals', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Admin goal') $s$);
select pg_temp.as_member('12');
select pg_temp.fails('coach with a lapsed check cannot set goals', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Lapsed goal') $s$);

select pg_temp.as_member('11');
select pg_temp.works('coach sets a goal for the athlete', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Box out every time') $s$);
select pg_temp.ok('coach goal marked as a coach''s', (select set_by_coach from public.game_goals where body = 'Box out every time'), true);

-- Stood-down coaches lose the right straight away.
update public.profiles set stood_down_at = now() where id = '00000000-0000-0000-0000-000000000011';
select pg_temp.fails('stood-down coach cannot set goals', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Stood down goal') $s$);
update public.profiles set stood_down_at = null where id = '00000000-0000-0000-0000-000000000011';

-- Changing goals.
select pg_temp.fails('coach cannot change the athlete''s goal', format('select public.save_game_goal(%L, null, null, %L)', pg_temp.goal('Hit 5 shots'), 'Coach edit'));
select pg_temp.works('coach changes their own goal', format('select public.save_game_goal(%L, null, null, %L)', pg_temp.goal('Box out every time'), 'Box out on every shot'));
select pg_temp.ok('coach goal changed', pg_temp.goal('Box out on every shot') is not null, true);
select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot change the coach''s goal', format('select public.save_game_goal(%L, null, null, %L)', pg_temp.goal('Box out on every shot'), 'Athlete edit'));
select pg_temp.works('athlete changes their own goal', format('select public.save_game_goal(%L, null, null, %L)', pg_temp.goal('Hit 5 shots'), 'Hit 6 shots'));
select pg_temp.ok('athlete goal changed, not duplicated', (select count(*) = 2 from public.game_goals where fixture_id = '00000000-0000-0000-0000-0000000000f1'), true);
select pg_temp.fails('changing a removed goal refused', $s$ select public.save_game_goal('00000000-0000-0000-0000-0000000000ee', null, null, 'Gone') $s$);
select pg_temp.fails('changing a played game''s goal refused', $s$ select public.save_game_goal('00000000-0000-0000-0000-0000000000e5', null, null, 'Too late') $s$);

-- Up to 5 goals a game.
select pg_temp.works('athlete adds a third goal', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Goal three') $s$);
select pg_temp.works('athlete adds a fourth goal', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Goal four') $s$);
select pg_temp.works('athlete adds a fifth goal', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Goal five') $s$);
select pg_temp.fails('sixth goal refused', $s$ select public.save_game_goal(null, '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f1', 'Goal six') $s$);

-- Removing goals.
select pg_temp.fails('athlete cannot remove the coach''s goal', format('select public.delete_game_goal(%L)', pg_temp.goal('Box out on every shot')));
select pg_temp.works('athlete removes their own goal', format('select public.delete_game_goal(%L)', pg_temp.goal('Goal five')));
select pg_temp.ok('goal removed', pg_temp.goal('Goal five') is null, true);
select pg_temp.works('removing a goal that is already gone does nothing', $s$ select public.delete_game_goal('00000000-0000-0000-0000-0000000000ee') $s$);
select pg_temp.fails('goal cannot be removed after the game starts', $s$ select public.delete_game_goal('00000000-0000-0000-0000-0000000000e5') $s$);
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot remove the athlete''s goal', format('select public.delete_game_goal(%L)', pg_temp.goal('Goal four')));
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot remove the athlete''s goal', format('select public.delete_game_goal(%L)', pg_temp.goal('Goal four')));
select pg_temp.works('coach removes their own goal', format('select public.delete_game_goal(%L)', pg_temp.goal('Box out on every shot')));
select pg_temp.ok('three goals left on the next game', (select count(*) = 3 from public.game_goals where fixture_id = '00000000-0000-0000-0000-0000000000f1'), true);

-- ---------------------------------------------------------------------------
-- Reflections and coach comments after the game
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.fails('reflection before the game refused', format('select public.reflect_on_game_goal(%L, %L, null)', pg_temp.goal('Goal four'), 'achieved'));
select pg_temp.fails('unknown outcome refused', $s$ select public.reflect_on_game_goal('00000000-0000-0000-0000-0000000000e5', 'great', null) $s$);
select pg_temp.fails('blank reflection with no outcome refused', $s$ select public.reflect_on_game_goal('00000000-0000-0000-0000-0000000000e5', null, '  ') $s$);
select pg_temp.fails('reflection over 1000 characters refused', format('select public.reflect_on_game_goal(%L, null, %L)', '00000000-0000-0000-0000-0000000000e5', repeat('x', 1001)));
select pg_temp.works('athlete reflects on a played game''s goal', $s$ select public.reflect_on_game_goal('00000000-0000-0000-0000-0000000000e5', 'partly', ' Called most switches ') $s$);
select pg_temp.ok('reflection saved', (select outcome = 'partly' and reflection = 'Called most switches' and reflected_by = '00000000-0000-0000-0000-000000000031' and reflected_at is not null from public.game_goals where id = '00000000-0000-0000-0000-0000000000e5'), true);
select pg_temp.works('athlete changes the reflection later', $s$ select public.reflect_on_game_goal('00000000-0000-0000-0000-0000000000e5', 'achieved', null) $s$);
select pg_temp.ok('reflection changed', (select outcome = 'achieved' and reflection is null from public.game_goals where id = '00000000-0000-0000-0000-0000000000e5'), true);
select pg_temp.fails('athlete cannot comment as a coach', $s$ select public.add_game_goal_comment('00000000-0000-0000-0000-0000000000e5', 'Me again') $s$);
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot reflect', $s$ select public.reflect_on_game_goal('00000000-0000-0000-0000-0000000000e5', 'achieved', 'Proud') $s$);
select pg_temp.fails('guardian cannot comment', $s$ select public.add_game_goal_comment('00000000-0000-0000-0000-0000000000e5', 'Proud') $s$);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot reflect for the athlete', $s$ select public.reflect_on_game_goal('00000000-0000-0000-0000-0000000000e5', 'achieved', 'Coach view') $s$);
select pg_temp.fails('coach comment before the game refused', format('select public.add_game_goal_comment(%L, %L)', pg_temp.goal('Goal four'), 'Early'));
select pg_temp.fails('empty comment refused', $s$ select public.add_game_goal_comment('00000000-0000-0000-0000-0000000000e5', ' ') $s$);
select pg_temp.fails('comment over 1000 characters refused', format('select public.add_game_goal_comment(%L, %L)', '00000000-0000-0000-0000-0000000000e5', repeat('x', 1001)));
select pg_temp.works('coach comments after the game', $s$ select public.add_game_goal_comment('00000000-0000-0000-0000-0000000000e5', ' Great talk ') $s$);
select pg_temp.ok('comment saved with the coach''s name', (select body = 'Great talk' and author_name = 'Casey Coach' from public.game_goal_comments where goal_id = '00000000-0000-0000-0000-0000000000e5'), true);
select pg_temp.as_member('12');
select pg_temp.fails('lapsed coach cannot comment', $s$ select public.add_game_goal_comment('00000000-0000-0000-0000-0000000000e5', 'Lapsed') $s$);
select pg_temp.as_member('13');
select pg_temp.fails('manager cannot comment', $s$ select public.add_game_goal_comment('00000000-0000-0000-0000-0000000000e5', 'Manager') $s$);

-- ---------------------------------------------------------------------------
-- Reading: the athlete, guardians and coaches only
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.ok('athlete''s next game is the game in 2 days with 3 goals', (select fixture_id = '00000000-0000-0000-0000-0000000000f1' and goal_count = 3 and team_id = '00000000-0000-0000-0000-0000000000a2' and played_at = starts_at + interval '90 minutes' and goals_close_at = starts_at from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.ok('one next game only', (select count(*) = 1 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.ok('three played games, byes and future games left out', (select count(*) = 3 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0)), true);
select pg_temp.ok('played games newest first', (select array_agg(fixture_id::text order by starts_at desc) = array_agg(fixture_id::text) from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0)), true);
select pg_temp.ok('first played game has one goal, reflected and commented', (select fixture_id = '00000000-0000-0000-0000-0000000000f5' and goal_count = 1 and reflected_count = 1 and comment_count = 1 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 1, 0)), true);
select pg_temp.ok('second page holds the next game back', (select fixture_id = '00000000-0000-0000-0000-0000000000f7' from public.goal_past_games('00000000-0000-0000-0000-000000000031', 1, 1)), true);
select pg_temp.ok('played games for the team only', (select count(*) = 2 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0, '00000000-0000-0000-0000-0000000000a2')), true);
select pg_temp.ok('played games for the squad only', (select count(*) = 1 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0, '00000000-0000-0000-0000-0000000000a1')), true);
select pg_temp.ok('athlete opens one game', (select count(*) = 1 from public.goal_game('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f5')), true);
select pg_temp.ok('athlete cannot read another athlete''s games', (select count(*) = 0 from public.goal_past_games('00000000-0000-0000-0000-000000000032', 10, 0)), true);
select pg_temp.as_member('32');
select pg_temp.ok('a game that is not the athlete''s is not shown', (select count(*) = 0 from public.goal_game('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000f1')), true);
select pg_temp.ok('adult athlete sees their squad game', (select count(*) = 1 from public.goal_past_games('00000000-0000-0000-0000-000000000032', 10, 0)), true);
select pg_temp.ok('another athlete sees none of the child''s games', (select count(*) = 0 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian sees the child''s next game', (select count(*) = 1 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.ok('guardian sees the child''s played games', (select count(*) = 3 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0)), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees the athlete''s next game', (select count(*) = 1 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio does not see goals', (select count(*) = 0 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin does not see individual goals', (select count(*) = 0 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0)), true);
select pg_temp.as_member('21');
select pg_temp.ok('committee does not see individual goals', (select count(*) = 0 from public.goal_game('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f5')), true);
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach does not see goals', (select count(*) = 0 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);

-- The same rules on the tables.
set role authenticated;
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads the child''s goals', (select count(*) = 4 from public.game_goals), true);
select pg_temp.ok('guardian reads the coach''s comment', (select count(*) = 1 from public.game_goal_comments), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio reads no goals', (select count(*) = 0 from public.game_goals), true);
select pg_temp.as_member('32');
select pg_temp.ok('another athlete reads no goals or comments', (select count(*) = 0 from public.game_goals) and (select count(*) = 0 from public.game_goal_comments), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin reads no goals', (select count(*) = 0 from public.game_goals), true);
reset role;

-- ---------------------------------------------------------------------------
-- Team goals
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('coach sets a team goal', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', ' Hold them under 30 ') $s$);
select pg_temp.ok('team goal saved trimmed with the coach''s name', (select set_by_name = 'Casey Coach' from public.team_game_goals where body = 'Hold them under 30'), true);
select pg_temp.works('coach changes a team goal', format('select public.save_team_game_goal(%L, null, %L)', pg_temp.team_goal('Hold them under 30'), 'Hold them under 25'));
select pg_temp.ok('team goal changed', pg_temp.team_goal('Hold them under 25') is not null and pg_temp.team_goal('Hold them under 30') is null, true);
select pg_temp.fails('empty team goal refused', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', '') $s$);
select pg_temp.fails('team goal over 300 characters refused', format('select public.save_team_game_goal(null, %L, %L)', '00000000-0000-0000-0000-0000000000f1', repeat('x', 301)));
select pg_temp.fails('team goal for a bye refused', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f4', 'Rest') $s$);
select pg_temp.fails('team goal more than 7 days out refused', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f3', 'Far') $s$);
select pg_temp.fails('team goal for a played game refused', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f5', 'Late') $s$);
select pg_temp.fails('changing a removed team goal refused', $s$ select public.save_team_game_goal('00000000-0000-0000-0000-0000000000ee', null, 'Gone') $s$);
select pg_temp.works('team goal two', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Team two') $s$);
select pg_temp.works('team goal three', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Team three') $s$);
select pg_temp.works('team goal four', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Team four') $s$);
select pg_temp.works('team goal five', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Team five') $s$);
select pg_temp.fails('sixth team goal refused', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Team six') $s$);
select pg_temp.works('coach removes a team goal', format('select public.delete_team_game_goal(%L)', pg_temp.team_goal('Team five')));
select pg_temp.ok('team goal removed', pg_temp.team_goal('Team five') is null, true);
select pg_temp.fails('team goal cannot be removed after the game starts', $s$ select public.delete_team_game_goal('00000000-0000-0000-0000-0000000000e6') $s$);
select pg_temp.works('removing a missing team goal does nothing', $s$ select public.delete_team_game_goal('00000000-0000-0000-0000-0000000000ee') $s$);

select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot set team goals', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Athlete team goal') $s$);
select pg_temp.fails('athlete cannot remove team goals', format('select public.delete_team_game_goal(%L)', pg_temp.team_goal('Team four')));
select pg_temp.fails('athlete cannot review team goals', $s$ select public.review_team_game_goal('00000000-0000-0000-0000-0000000000e6', 'achieved', null) $s$);
select pg_temp.as_member('13');
select pg_temp.fails('manager cannot set team goals', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f7', 'Manager team goal') $s$);
select pg_temp.as_member('01');
select pg_temp.fails('admin cannot set team goals', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Admin team goal') $s$);
select pg_temp.as_member('42');
select pg_temp.fails('squad coach cannot set goals for a team they don''t coach', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Other team goal') $s$);
select pg_temp.as_member('12');
select pg_temp.fails('lapsed coach cannot review the squad''s team goals', $s$ select public.review_team_game_goal('00000000-0000-0000-0000-0000000000e7', 'achieved', null) $s$);
update public.profiles set stood_down_at = now() where id = '00000000-0000-0000-0000-000000000011';
select pg_temp.as_member('11');
select pg_temp.fails('stood-down coach cannot set team goals', $s$ select public.save_team_game_goal(null, '00000000-0000-0000-0000-0000000000f1', 'Stood down') $s$);
select pg_temp.ok('stood-down coach''s game list is empty', (select count(*) = 0 from public.coach_team_games()), true);
update public.profiles set stood_down_at = null where id = '00000000-0000-0000-0000-000000000011';

-- Reviews after the game.
select pg_temp.as_member('11');
select pg_temp.fails('review before the game refused', format('select public.review_team_game_goal(%L, %L, null)', pg_temp.team_goal('Team four'), 'achieved'));
select pg_temp.fails('unknown review outcome refused', $s$ select public.review_team_game_goal('00000000-0000-0000-0000-0000000000e6', 'won', null) $s$);
select pg_temp.fails('blank review refused', $s$ select public.review_team_game_goal('00000000-0000-0000-0000-0000000000e6', null, ' ') $s$);
select pg_temp.fails('review over 1000 characters refused', format('select public.review_team_game_goal(%L, null, %L)', '00000000-0000-0000-0000-0000000000e6', repeat('x', 1001)));
select pg_temp.works('coach reviews a played game''s team goal', $s$ select public.review_team_game_goal('00000000-0000-0000-0000-0000000000e6', 'not_yet', ' Lost the boards ') $s$);
select pg_temp.ok('review saved with the coach''s name', (select outcome = 'not_yet' and review = 'Lost the boards' and reviewed_by_name = 'Casey Coach' and reviewed_at is not null from public.team_game_goals where id = '00000000-0000-0000-0000-0000000000e6'), true);

-- coach_team_games: the coach's teams with the next and last played game.
select pg_temp.ok('coach sees the team''s next game with 4 team goals', (select goal_count = 4 and reviewed_count = 0 from public.coach_team_games() where fixture_id = '00000000-0000-0000-0000-0000000000f1' and is_next), true);
select pg_temp.ok('coach sees the team''s last played game, reviewed', (select goal_count = 1 and reviewed_count = 1 from public.coach_team_games() where fixture_id = '00000000-0000-0000-0000-0000000000f5' and not is_next), true);
select pg_temp.ok('coach sees the squad''s last played game', (select count(*) = 1 from public.coach_team_games() where fixture_id = '00000000-0000-0000-0000-0000000000f7'), true);
select pg_temp.ok('coach sees three rows (no older games, no byes)', (select count(*) = 3 from public.coach_team_games()), true);
select pg_temp.as_member('31');
select pg_temp.ok('athlete has no coach game list', (select count(*) = 0 from public.coach_team_games()), true);
select pg_temp.as_member('13');
select pg_temp.ok('manager has no coach game list', (select count(*) = 0 from public.coach_team_games()), true);
select pg_temp.as_member('12');
select pg_temp.ok('lapsed coach has no coach game list', (select count(*) = 0 from public.coach_team_games()), true);
select pg_temp.as_member('42');
select pg_temp.ok('squad coach sees only the squad''s game', (select count(*) = 1 and bool_and(team_id = '00000000-0000-0000-0000-0000000000a1') from public.coach_team_games()), true);

-- Team goal comments: the author or the team's coaches remove them.
select pg_temp.as_member('31');
select pg_temp.works('athlete comments on a team goal', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e6', 'We will next time') $s$);
select pg_temp.works('athlete comments again', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e6', 'Second thought') $s$);
select pg_temp.as_member('11');
select pg_temp.works('coach comments on a team goal', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e6', 'Box out drills Tuesday') $s$);
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot comment on team goals', $s$ select public.add_team_game_goal_comment('00000000-0000-0000-0000-0000000000e6', 'Go team') $s$);
select pg_temp.fails('guardian cannot remove a comment', format('select public.delete_team_game_goal_comment(%L)', (select id from public.team_game_goal_comments where body = 'Second thought')));
select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot remove the coach''s comment', format('select public.delete_team_game_goal_comment(%L)', (select id from public.team_game_goal_comments where body = 'Box out drills Tuesday')));
select pg_temp.works('athlete removes their own comment', format('select public.delete_team_game_goal_comment(%L)', (select id from public.team_game_goal_comments where body = 'Second thought')));
select pg_temp.ok('own comment removed', (select count(*) = 0 from public.team_game_goal_comments where body = 'Second thought'), true);
select pg_temp.as_member('11');
select pg_temp.works('coach removes the athlete''s comment', format('select public.delete_team_game_goal_comment(%L)', (select id from public.team_game_goal_comments where body = 'We will next time')));
select pg_temp.ok('athlete''s comment removed by the coach', (select count(*) = 1 from public.team_game_goal_comments), true);
select pg_temp.works('removing a missing comment does nothing', $s$ select public.delete_team_game_goal_comment('00000000-0000-0000-0000-0000000000ee') $s$);

-- Who reads team goals and their comments.
set role authenticated;
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads the team and squad goals and comments', (select count(*) = 6 from public.team_game_goals) and (select count(*) = 1 from public.team_game_goal_comments), true);
select pg_temp.as_member('32');
select pg_temp.ok('squad athlete outside the team reads only the squad''s team goal', (select count(*) = 1 and bool_and(fixture_id = '00000000-0000-0000-0000-0000000000f7') from public.team_game_goals), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio reads no team goals', (select count(*) = 0 from public.team_game_goals), true);
reset role;

-- An archived team's game still opens for an athlete with goals on it.
update public.teams set archived = true where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.as_member('31');
select pg_temp.ok('archived team''s game with goals still opens', (select count(*) = 1 from public.goal_game('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f5')), true);
select pg_temp.ok('archived team''s game without goals does not', (select count(*) = 0 from public.goal_game('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000f6')), true);
select pg_temp.ok('archived team drops out of played games', (select count(*) = 1 from public.goal_past_games('00000000-0000-0000-0000-000000000031', 10, 0)), true);
select pg_temp.ok('archived team has no next game', (select count(*) = 0 from public.goal_next_game('00000000-0000-0000-0000-000000000031')), true);
