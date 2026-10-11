-- Guardians only view game goals.
--
-- Matt (2026-10-09): "Guardians should only see goals and reflections.
-- Athletes and coaches set the goals and reflect on them in the app."
--
-- - acts_for_athlete is now the athlete themselves. Guardians keep seeing
--   their athlete's goals, reflections, coach comments and team goals
--   (can_view_game_goals is unchanged), but can no longer add, change,
--   remove or reflect on goals.
-- - save_game_goal, delete_game_goal and reflect_on_game_goal are the same
--   as before apart from their messages, which no longer mention guardians.
-- - Goals a guardian already set stay as they are: the athlete can change or
--   remove them before the game, as with their own.
--
-- Additive only: functions are replaced. No rows change.

begin;

-- The athlete themselves (an approved member with the athlete role).
create or replace function public.acts_for_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and p_athlete_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = p_athlete_id and status = 'approved'
        and (role = 'athlete' or 'athlete' = any (extra_roles))
    );
$$;

-- Adds a goal (p_goal_id null) or changes one, before the game. The athlete
-- or their coach can add one; only coaches change a coach's goal, and only
-- the athlete changes theirs.
create or replace function public.save_game_goal(
  p_goal_id uuid,
  p_athlete_id uuid,
  p_fixture_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.game_goals;
  v_fixture public.fixtures;
  v_is_coach boolean;
  v_id uuid;
begin
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write the goal first';
  end if;
  if length(btrim(p_body)) > 300 then
    raise exception 'Keep a goal under 300 characters';
  end if;

  if p_goal_id is not null then
    select * into v_goal from public.game_goals where id = p_goal_id for update;
    if v_goal.id is null then
      raise exception 'That goal has been removed';
    end if;
    p_athlete_id := v_goal.athlete_id;
    p_fixture_id := v_goal.fixture_id;
  end if;

  v_is_coach := public.coaches_athlete(p_athlete_id) and p_athlete_id <> auth.uid();
  if not (v_is_coach or public.acts_for_athlete(p_athlete_id)) then
    raise exception 'Only the athlete and their coaches can set goals';
  end if;

  select * into v_fixture from public.fixtures where id = p_fixture_id;
  if v_fixture.id is null
    or not exists (select 1 from public.athlete_games(p_athlete_id) g where g.id = p_fixture_id) then
    raise exception 'That game isn’t one of the athlete’s';
  end if;
  if now() >= public.fixture_goals_close_at(v_fixture) then
    raise exception 'Goals close when the game starts';
  end if;
  if v_fixture.starts_at > now() + interval '7 days' then
    raise exception 'Goals open 7 days before the game';
  end if;

  if v_goal.id is null then
    if not exists (select 1 from public.next_goal_game(p_athlete_id) n where n.id = p_fixture_id) then
      raise exception 'Goals can only be set for the next game';
    end if;
    if (select count(*) from public.game_goals
        where athlete_id = p_athlete_id and fixture_id = p_fixture_id) >= 5 then
      raise exception 'A game can have up to 5 goals';
    end if;
    insert into public.game_goals (athlete_id, fixture_id, body, set_by, set_by_name, set_by_coach)
    values (p_athlete_id, p_fixture_id, btrim(p_body), auth.uid(), public.my_display_name(), v_is_coach)
    returning id into v_id;
    return v_id;
  end if;

  if v_goal.set_by_coach and not v_is_coach then
    raise exception 'Only a coach can change a coach’s goal';
  end if;
  if not v_goal.set_by_coach and not public.acts_for_athlete(p_athlete_id) then
    raise exception 'Only the athlete can change this goal';
  end if;
  update public.game_goals set body = btrim(p_body) where id = v_goal.id;
  return v_goal.id;
end;
$$;

-- Removes a goal before the game, with the same rules as changing it.
create or replace function public.delete_game_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.game_goals;
  v_fixture public.fixtures;
begin
  select * into v_goal from public.game_goals where id = p_goal_id for update;
  if v_goal.id is null then
    return;
  end if;
  if v_goal.set_by_coach then
    if not (public.coaches_athlete(v_goal.athlete_id) and v_goal.athlete_id <> auth.uid()) then
      raise exception 'Only a coach can remove a coach’s goal';
    end if;
  elsif not public.acts_for_athlete(v_goal.athlete_id) then
    raise exception 'Only the athlete can remove this goal';
  end if;
  select * into v_fixture from public.fixtures where id = v_goal.fixture_id;
  if now() >= public.fixture_goals_close_at(v_fixture) then
    raise exception 'Goals can’t be removed once the game starts';
  end if;
  delete from public.game_goals where id = v_goal.id;
end;
$$;

-- The athlete says how a goal went, after the game. It can be changed later.
create or replace function public.reflect_on_game_goal(
  p_goal_id uuid,
  p_outcome text,
  p_reflection text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.game_goals;
  v_fixture public.fixtures;
begin
  select * into v_goal from public.game_goals where id = p_goal_id for update;
  if v_goal.id is null or not public.acts_for_athlete(v_goal.athlete_id) then
    raise exception 'Only the athlete can reflect on this goal';
  end if;
  select * into v_fixture from public.fixtures where id = v_goal.fixture_id;
  if now() < public.fixture_played_at(v_fixture) then
    raise exception 'Reflections open after the game';
  end if;
  if p_outcome is not null and p_outcome not in ('achieved', 'partly', 'not_yet') then
    raise exception 'Pick how the goal went';
  end if;
  if length(coalesce(p_reflection, '')) > 1000 then
    raise exception 'Keep a reflection under 1000 characters';
  end if;
  if p_outcome is null and coalesce(btrim(p_reflection), '') = '' then
    raise exception 'Pick how it went or write a reflection';
  end if;

  update public.game_goals
  set outcome = p_outcome,
      reflection = nullif(btrim(p_reflection), ''),
      reflected_by = auth.uid(),
      reflected_at = now()
  where id = v_goal.id;
end;
$$;

commit;
