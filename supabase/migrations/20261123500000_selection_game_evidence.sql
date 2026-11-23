-- Selection assessments, phase 5 (Matt, 23 November 2026): evidence from
-- games. A round's panel sees which games an athlete played during the
-- round, and each selector who can assess the athlete sees the athlete's own
-- figures from a game recorded in FirstPass Vantage, the same figures the
-- athlete's coaches see beside game goals.
--
-- Until now only the athlete's current coaches were told a game's figures
-- (20261122100000). This adds the selectors on the panel of a round the
-- game was played in: on the panel, approved, with a current check, never
-- for their own child, and only for games between the round's first and
-- last day. The athlete and their guardians are still told nothing.
--
-- Nothing new is stored: two new functions, and goal_game_stats_access is
-- replaced with the wider rule. No table and no data change.

begin;

-- Whether the signed-in member is a selector who can assess this athlete in
-- a round that the game was played in.
create or replace function public.selects_athlete_for_game(p_athlete_id uuid, p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.selection_assessments_on() and exists (
    select 1
    from public.fixtures f
    join public.selection_rounds r
      on public.club_day(f.starts_at) between r.starts_on and r.ends_on
    where f.id = p_fixture_id
      and public.can_assess_athlete(r.id, p_athlete_id)
  );
$$;
-- Only goal_game_stats_access uses it, as its owner.
revoke execute on function public.selects_athlete_for_game(uuid, uuid) from public, anon, authenticated;

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
  -- The athlete's coaches, and the panel of a selection round the game was
  -- played in: not the athlete, not their guardians.
  if auth.uid() is null
     or not (public.coaches_athlete(p_athlete_id) or public.selects_athlete_for_game(p_athlete_id, p_fixture_id)) then
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
    -- Net Points go with the rest: everyone answered here coaches the athlete
    -- or is on their selection panel.
    'net_points', true
  );
end;
$$;

comment on function public.goal_game_stats_access(uuid, uuid) is
  'For the game-stats function: whether the caller coaches this athlete, or is a selector who can assess them in a selection round the game was played in, and the game has a finished recording; then the game and the names the lineup may hold for the athlete (none when a team mate shares one). The athlete and their guardians are answered nothing.';

revoke execute on function public.goal_game_stats_access(uuid, uuid) from public, anon;
grant execute on function public.goal_game_stats_access(uuid, uuid) to authenticated;

-- The games an athlete has played during a round, newest first, for a panel
-- member who can assess them: which game and when, and whether it has a
-- finished recording to draw figures from. No figures here. Opening an
-- under 18's is recorded in their record views.
create or replace function public.selection_round_games(p_round_id uuid, p_athlete_id uuid)
returns table (
  fixture_id uuid,
  team_name text,
  opponent text,
  round_name text,
  starts_at timestamptz,
  played_on date,
  recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);
  return query
  select f.id, f.team_name, f.opponent, f.round_name, f.starts_at, public.club_day(f.starts_at),
    exists (
      select 1 from public.games g
      where g.fixture_id = f.id and g.team_id = f.team_id and g.status = 'final'
    )
  from public.athlete_games(p_athlete_id) f
  where public.fixture_played_at(f) <= now()
    and public.club_day(f.starts_at) between v_round.starts_on and v_round.ends_on
  order by f.starts_at desc, f.id;
end;
$$;
revoke execute on function public.selection_round_games(uuid, uuid) from public, anon;
grant execute on function public.selection_round_games(uuid, uuid) to authenticated;

commit;
