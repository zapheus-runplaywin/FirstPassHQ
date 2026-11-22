-- Game stats beside game goals, and a games list for admins.
--
-- An athlete's own figures from a game recorded in FirstPass Vantage (shots,
-- gains, turnovers, time on court) show on that game's goals page in HQ, to
-- the people who already see the athlete's goals for it: the athlete, their
-- verified guardians and their coaches (can_view_game_goals). Net Points,
-- one plus or minus score for the athlete, show to their coaches only.
--
-- Nothing new is stored. The figures are worked out from the game's events
-- by the game-stats function (supabase/functions/game-stats), with the same
-- engine Vantage and Vision use, and only that one athlete's figures leave
-- it. This migration gives the function what it needs to decide:
--
--   goal_game_stats_access(athlete, fixture)  whether the caller may see the
--     athlete's goals for that game and it has a finished recording, and if
--     so which game, the names the athlete may be recorded under, and
--     whether the caller is one of their coaches.
--
-- The game's events themselves stay closed to athletes and guardians (row
-- level security on game_events is unchanged): the function reads them with
-- the service role after this check.
--
--   admin_games(limit, offset)  the club's recorded games, newest first, for
--     the Games page in Administration. Admins only.
--
-- Additive: two functions, no table, no data changed.

begin;

-- A name as the lineup holds it, for matching: lower case, single spaces.
create or replace function public.plain_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '');
$$;

-- Only goal_game_stats_access uses it, as its owner.
revoke execute on function public.plain_name(text) from public, anon, authenticated;

create or replace function public.goal_game_stats_access(p_athlete_id uuid, p_fixture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_game public.games;
  v_names text[];
  v_clash boolean;
begin
  if auth.uid() is null or not public.can_view_game_goals(p_athlete_id) then
    return null;
  end if;
  -- One of the athlete's own games, as the goals pages list them.
  select f.* into v_fixture from public.athlete_games(p_athlete_id) f where f.id = p_fixture_id;
  if v_fixture.id is null then
    return null;
  end if;
  -- Its finished recording, the latest when it was recorded twice. A game
  -- still being played shows nothing: the figures are for reflecting after.
  select g.* into v_game
  from public.games g
  where g.fixture_id = p_fixture_id
    and g.team_id = v_fixture.team_id
    and g.status = 'final'
  order by g.finished_at desc nulls last, g.created_at desc
  limit 1;
  if v_game.id is null then
    return null;
  end if;

  -- The names the statistician's lineup may hold for this athlete.
  select array(
    select distinct n from (
      select public.plain_name(p.preferred_name) as n from public.profiles p where p.id = p_athlete_id
      union all
      select public.plain_name(p.full_name) from public.profiles p where p.id = p_athlete_id
    ) names where n is not null
  ) into v_names;

  -- Two athletes of the team under one name can't be told apart in the
  -- lineup, so neither is shown figures that might be the other's.
  select exists (
    select 1
    from public.team_members tm
    join public.profiles o on o.id = tm.profile_id
    where tm.team_id = v_fixture.team_id
      and tm.team_role = 'athlete'
      and tm.profile_id <> p_athlete_id
      and (public.plain_name(o.preferred_name) = any (v_names) or public.plain_name(o.full_name) = any (v_names))
  ) into v_clash;

  return jsonb_build_object(
    'game_id', v_game.id,
    'config', v_game.config,
    'names', case when v_clash then '[]'::jsonb else to_jsonb(v_names) end,
    -- Net Points are for the athlete's coaches only.
    'net_points', public.coaches_athlete(p_athlete_id)
  );
end;
$$;

comment on function public.goal_game_stats_access(uuid, uuid) is
  'For the game-stats function: whether the caller may see this athlete''s goals for the game and it has a finished recording; then the game, the names the lineup may hold for the athlete (none when a team mate shares one) and whether the caller coaches them (Net Points).';

revoke execute on function public.goal_game_stats_access(uuid, uuid) from public, anon;
grant execute on function public.goal_game_stats_access(uuid, uuid) to authenticated;

-- The club's recorded games, newest first, for admins.
create or replace function public.admin_games(p_limit int default 50, p_offset int default 0)
returns table (
  id uuid,
  team_name text,
  us text,
  them text,
  round_name text,
  status public.game_status,
  created_at timestamptz,
  finished_at timestamptz,
  recorder_name text,
  events int,
  from_fixture boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id,
    t.name,
    g.config ->> 'us',
    g.config ->> 'them',
    f.round_name,
    g.status,
    g.created_at,
    g.finished_at,
    coalesce(nullif(trim(r.preferred_name), ''), r.full_name),
    (select count(*)::int from public.game_events e where e.game_id = g.id and e.stream = 'primary'),
    g.fixture_id is not null
  from public.games g
  left join public.teams t on t.id = g.team_id
  left join public.fixtures f on f.id = g.fixture_id
  left join public.profiles r on r.id = g.recorder_id
  where public.is_admin()
  order by g.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.admin_games(int, int) is
  'The club''s games recorded in FirstPass Vantage, newest first, with who recorded each and how many events it holds. Admins only; everyone else gets no rows.';

revoke execute on function public.admin_games(int, int) from public, anon;
grant execute on function public.admin_games(int, int) to authenticated;

commit;
