-- Game goals by team.
--
-- Matt (2026-10-08): game goals were too much for the home page and belong in
-- a team's context; PlayHQ games belong to teams, not squads. The app now
-- shows them on each team's page, so game rows carry their team, and played
-- games can be listed for one team.
--
-- Functions only: the reading functions change their columns, so they are
-- dropped and created again. No table or row changes.

begin;

drop function if exists public.goal_next_game(uuid);
drop function if exists public.goal_past_games(uuid, int, int);
drop function if exists public.goal_past_games(uuid, int, int, uuid);
drop function if exists public.goal_game(uuid, uuid);
drop function if exists public.goal_game_rows(uuid, public.fixtures[]);

-- One row per game, with its goal counts. Shared by the two lists below.
create or replace function public.goal_game_rows(p_athlete_id uuid, p_games public.fixtures[])
returns table (
  fixture_id uuid,
  team_id uuid,
  team_name text,
  round_name text,
  opponent text,
  starts_at timestamptz,
  time_tbc boolean,
  venue text,
  court text,
  is_home boolean,
  goals_close_at timestamptz,
  played_at timestamptz,
  goal_count int,
  reflected_count int,
  comment_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id, g.team_id, g.team_name, g.round_name, g.opponent, g.starts_at, g.time_tbc, g.venue, g.court,
    g.is_home, public.fixture_goals_close_at(g), public.fixture_played_at(g),
    (select count(*)::int from public.game_goals x
      where x.athlete_id = p_athlete_id and x.fixture_id = g.id),
    (select count(*)::int from public.game_goals x
      where x.athlete_id = p_athlete_id and x.fixture_id = g.id
        and (x.outcome is not null or x.reflection is not null)),
    (select count(*)::int from public.game_goal_comments c
      join public.game_goals x on x.id = c.goal_id
      where x.athlete_id = p_athlete_id and x.fixture_id = g.id)
  from unnest(p_games) g
  order by g.starts_at desc;
$$;

revoke execute on function public.goal_game_rows(uuid, public.fixtures[]) from public, anon, authenticated;

-- The athlete's next game in the coming 7 days, if there is one.
create or replace function public.goal_next_game(p_athlete_id uuid)
returns table (
  fixture_id uuid, team_id uuid, team_name text, round_name text, opponent text, starts_at timestamptz,
  time_tbc boolean, venue text, court text, is_home boolean, goals_close_at timestamptz,
  played_at timestamptz, goal_count int, reflected_count int, comment_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.goal_game_rows(
    p_athlete_id,
    array(select n from public.next_goal_game(p_athlete_id) n)
  ) r
  where public.can_view_game_goals(p_athlete_id);
$$;

-- The athlete's played games this season, newest first, a page at a time,
-- for one squad or team when p_team_id is given.
create or replace function public.goal_past_games(
  p_athlete_id uuid,
  p_limit int,
  p_offset int,
  p_team_id uuid default null
)
returns table (
  fixture_id uuid, team_id uuid, team_name text, round_name text, opponent text, starts_at timestamptz,
  time_tbc boolean, venue text, court text, is_home boolean, goals_close_at timestamptz,
  played_at timestamptz, goal_count int, reflected_count int, comment_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.goal_game_rows(
    p_athlete_id,
    array(
      select g from public.athlete_games(p_athlete_id) g
      where public.fixture_played_at(g) <= now()
        and (p_team_id is null or g.team_id = p_team_id)
      order by g.starts_at desc, g.id
      limit least(greatest(coalesce(p_limit, 10), 1), 50)
      offset greatest(coalesce(p_offset, 0), 0)
    )
  ) r
  where public.can_view_game_goals(p_athlete_id);
$$;

-- One game for one athlete, even when it has dropped out of the lists (such
-- as a past season's game opened from a link).
create or replace function public.goal_game(p_athlete_id uuid, p_fixture_id uuid)
returns table (
  fixture_id uuid, team_id uuid, team_name text, round_name text, opponent text, starts_at timestamptz,
  time_tbc boolean, venue text, court text, is_home boolean, goals_close_at timestamptz,
  played_at timestamptz, goal_count int, reflected_count int, comment_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.goal_game_rows(
    p_athlete_id,
    array(select f from public.fixtures f where f.id = p_fixture_id)
  ) r
  where public.can_view_game_goals(p_athlete_id)
    and (
      exists (select 1 from public.athlete_games(p_athlete_id) g where g.id = p_fixture_id)
      or exists (
        select 1 from public.game_goals x
        where x.athlete_id = p_athlete_id and x.fixture_id = p_fixture_id
      )
    );
$$;

revoke execute on function public.goal_next_game(uuid) from public, anon;
revoke execute on function public.goal_past_games(uuid, int, int, uuid) from public, anon;
revoke execute on function public.goal_game(uuid, uuid) from public, anon;
grant execute on function public.goal_next_game(uuid) to authenticated;
grant execute on function public.goal_past_games(uuid, int, int, uuid) to authenticated;
grant execute on function public.goal_game(uuid, uuid) to authenticated;

commit;
