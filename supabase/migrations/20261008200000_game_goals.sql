-- Goals for PlayHQ games.
--
-- Matt (2026-10-08): "Where there is a fixtured game in the next 7 days allow
-- an athlete to set goals against that game. Also allow the coaches to add
-- goals for the athlete. After the game is complete, allow the athlete to
-- reflect and comment on their goals, and for the coaches to also comment."
-- Only one game is open for goals at a time; played games are listed a page
-- at a time and stay until an admin archives the season.
--
-- - A game belongs to an athlete when it is a PlayHQ fixture of a current
--   (not archived) squad or team they are an athlete in. Byes are left out.
-- - Goals can be set from 7 days before the game until it starts (for a game
--   whose time PlayHQ hasn't set, until the end of that day).
-- - The game counts as played 90 minutes after it starts (the day after, for
--   a game with no time). Then the athlete rates and reflects on each goal and
--   their coaches comment.
-- - Who sees goals: the athlete, their guardians and their coaches, as for
--   check-ins. Guardians can do everything the athlete can. Committee, admins
--   and physios don't see individual goals.
-- - Team goals (Matt, 2026-10-08: "Also allow the coach to set Team goals
--   prior to the game"): the squad or team's coaches set them in the same
--   window and say how each went after the game. Everyone who sees the
--   fixture sees them, plus the guardians of its athletes.
--
-- Additive only: new tables, functions and policies. No rows change.

begin;

create table if not exists public.game_goals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  fixture_id uuid not null references public.fixtures (id),
  body text not null check (length(btrim(body)) between 1 and 300),
  -- Who wrote it, and whether a coach did (only coaches change coaches' goals).
  set_by uuid references public.profiles (id) on delete set null,
  set_by_name text not null,
  set_by_coach boolean not null default false,
  -- After the game: how it went, in the athlete's words.
  outcome text check (outcome in ('achieved', 'partly', 'not_yet')),
  reflection text check (length(reflection) <= 1000),
  reflected_by uuid references public.profiles (id) on delete set null,
  reflected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_goals_athlete_fixture_idx on public.game_goals (athlete_id, fixture_id);
create index if not exists game_goals_fixture_idx on public.game_goals (fixture_id);

drop trigger if exists game_goals_touch_updated_at on public.game_goals;
create trigger game_goals_touch_updated_at
  before update on public.game_goals
  for each row execute function public.touch_updated_at();

-- Coaches' comments on a goal after the game.
create table if not exists public.game_goal_comments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.game_goals (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists game_goal_comments_goal_idx on public.game_goal_comments (goal_id);

alter table public.game_goals enable row level security;
alter table public.game_goal_comments enable row level security;

-- ---------------------------------------------------------------------------
-- Who can see and do what
-- ---------------------------------------------------------------------------

-- The athlete, their guardians and their coaches.
create or replace function public.can_view_game_goals(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or public.coaches_athlete(p_athlete_id)
  );
$$;

-- The athlete themselves, or their guardian acting for them.
create or replace function public.acts_for_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.profiles
      where id = p_athlete_id and role = 'athlete' and status = 'approved'
    )
    and (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id));
$$;

-- When goals for a game close: its start, or the end of the day when PlayHQ
-- hasn't set a time (starts_at is then midnight).
create or replace function public.fixture_goals_close_at(p_fixture public.fixtures)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_fixture.time_tbc then p_fixture.starts_at + interval '1 day'
              else p_fixture.starts_at end;
$$;

-- When a game counts as played and reflections open.
create or replace function public.fixture_played_at(p_fixture public.fixtures)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_fixture.time_tbc then p_fixture.starts_at + interval '1 day'
              else p_fixture.starts_at + interval '90 minutes' end;
$$;

-- The games an athlete plays: fixtures (not byes) of the current squads and
-- teams they are an athlete in.
create or replace function public.athlete_games(p_athlete_id uuid)
returns setof public.fixtures
language sql
stable
security definer
set search_path = ''
as $$
  select distinct f.*
  from public.fixtures f
  join public.team_members m
    on m.team_id = f.team_id and m.profile_id = p_athlete_id and m.team_role = 'athlete'
  join public.teams t on t.id = f.team_id and not t.archived
  where f.opponent is not null;
$$;

-- The one game open for goals: the athlete's next game in the coming 7 days.
create or replace function public.next_goal_game(p_athlete_id uuid)
returns setof public.fixtures
language sql
stable
security definer
set search_path = ''
as $$
  select g.*
  from public.athlete_games(p_athlete_id) g
  where public.fixture_played_at(g) > now()
    and g.starts_at <= now() + interval '7 days'
  order by g.starts_at, g.id
  limit 1;
$$;

revoke execute on function public.can_view_game_goals(uuid) from public, anon;
revoke execute on function public.acts_for_athlete(uuid) from public, anon;
revoke execute on function public.fixture_goals_close_at(public.fixtures) from public, anon;
revoke execute on function public.fixture_played_at(public.fixtures) from public, anon;
revoke execute on function public.athlete_games(uuid) from public, anon, authenticated;
revoke execute on function public.next_goal_game(uuid) from public, anon, authenticated;
grant execute on function public.can_view_game_goals(uuid) to authenticated;
grant execute on function public.acts_for_athlete(uuid) to authenticated;
grant execute on function public.fixture_goals_close_at(public.fixtures) to authenticated;
grant execute on function public.fixture_played_at(public.fixtures) to authenticated;

drop policy if exists "Athletes, guardians and coaches see goals" on public.game_goals;
create policy "Athletes, guardians and coaches see goals"
  on public.game_goals for select to authenticated
  using (public.can_view_game_goals(athlete_id));

drop policy if exists "Athletes, guardians and coaches see goal comments" on public.game_goal_comments;
create policy "Athletes, guardians and coaches see goal comments"
  on public.game_goal_comments for select to authenticated
  using (exists (
    select 1 from public.game_goals g
    where g.id = goal_id and public.can_view_game_goals(g.athlete_id)
  ));

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- One row per game, with its goal counts. Shared by the two lists below.
create or replace function public.goal_game_rows(p_athlete_id uuid, p_games public.fixtures[])
returns table (
  fixture_id uuid,
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
    g.id, g.team_name, g.round_name, g.opponent, g.starts_at, g.time_tbc, g.venue, g.court,
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
  fixture_id uuid, team_name text, round_name text, opponent text, starts_at timestamptz,
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

-- The athlete's played games this season, newest first, a page at a time.
create or replace function public.goal_past_games(p_athlete_id uuid, p_limit int, p_offset int)
returns table (
  fixture_id uuid, team_name text, round_name text, opponent text, starts_at timestamptz,
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
  fixture_id uuid, team_name text, round_name text, opponent text, starts_at timestamptz,
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

-- For coaches: each athlete in the current squads and teams they coach, with
-- their next game's goal count and the reflections no coach has answered yet.
create or replace function public.goal_board()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_id uuid,
  athlete_name text,
  next_fixture_id uuid,
  next_label text,
  next_starts_at timestamptz,
  next_goal_count int,
  reflections_to_answer int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.kind::text, p.id, coalesce(nullif(p.full_name, ''), p.email),
    n.id, case when n.id is null then null else public.fixture_label(n) end, n.starts_at,
    (select count(*)::int from public.game_goals x
      where x.athlete_id = p.id and x.fixture_id = n.id),
    (select count(*)::int from public.game_goals x
      join public.athlete_games(p.id) g on g.id = x.fixture_id
      where x.athlete_id = p.id
        and (x.outcome is not null or x.reflection is not null)
        and not exists (select 1 from public.game_goal_comments c where c.goal_id = x.id))
  from public.team_members coach
  join public.teams t on t.id = coach.team_id
  join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
  join public.profiles p on p.id = a.profile_id and p.status = 'approved'
  left join lateral (select * from public.next_goal_game(p.id)) n on true
  where coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
    and not t.archived
    and t.selections_completed_at is null
    and public.is_approved()
  order by t.kind, t.sort_order, t.name, p.full_name;
$$;

revoke execute on function public.goal_next_game(uuid) from public, anon;
revoke execute on function public.goal_past_games(uuid, int, int) from public, anon;
revoke execute on function public.goal_game(uuid, uuid) from public, anon;
revoke execute on function public.goal_board() from public, anon;
grant execute on function public.goal_next_game(uuid) to authenticated;
grant execute on function public.goal_past_games(uuid, int, int) to authenticated;
grant execute on function public.goal_game(uuid, uuid) to authenticated;
grant execute on function public.goal_board() to authenticated;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Adds a goal (p_goal_id null) or changes one, before the game. The athlete
-- or their guardian, or the athlete's coach, can add one; only coaches change
-- a coach's goal, and only the athlete's side changes theirs.
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
    raise exception 'Only the athlete, their guardians and their coaches can set goals';
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
    -- A coach who is also the athlete's guardian adds goals as the guardian.
    v_is_coach := v_is_coach and not public.acts_for_athlete(p_athlete_id);
    insert into public.game_goals (athlete_id, fixture_id, body, set_by, set_by_name, set_by_coach)
    values (p_athlete_id, p_fixture_id, btrim(p_body), auth.uid(), public.my_display_name(), v_is_coach)
    returning id into v_id;
    return v_id;
  end if;

  if v_goal.set_by_coach and not v_is_coach then
    raise exception 'Only a coach can change a coach’s goal';
  end if;
  if not v_goal.set_by_coach and not public.acts_for_athlete(p_athlete_id) then
    raise exception 'Only the athlete or their guardian can change this goal';
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
    raise exception 'Only the athlete or their guardian can remove this goal';
  end if;
  select * into v_fixture from public.fixtures where id = v_goal.fixture_id;
  if now() >= public.fixture_goals_close_at(v_fixture) then
    raise exception 'Goals can’t be removed once the game starts';
  end if;
  delete from public.game_goals where id = v_goal.id;
end;
$$;

-- The athlete (or their guardian) says how a goal went, after the game. It
-- can be changed later.
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
    raise exception 'Only the athlete or their guardian can reflect on this goal';
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

-- A coach of the athlete comments on a goal after the game.
create or replace function public.add_game_goal_comment(p_goal_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.game_goals;
  v_fixture public.fixtures;
  v_id uuid;
begin
  select * into v_goal from public.game_goals where id = p_goal_id;
  if v_goal.id is null
    or not public.coaches_athlete(v_goal.athlete_id)
    or v_goal.athlete_id = auth.uid() then
    raise exception 'Only the athlete’s coaches can comment on goals';
  end if;
  select * into v_fixture from public.fixtures where id = v_goal.fixture_id;
  if now() < public.fixture_played_at(v_fixture) then
    raise exception 'Comments open after the game';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a comment first';
  end if;
  if length(btrim(p_body)) > 1000 then
    raise exception 'Keep a comment under 1000 characters';
  end if;

  insert into public.game_goal_comments (goal_id, author_id, author_name, body)
  values (v_goal.id, auth.uid(), public.my_display_name(), btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.save_game_goal(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.delete_game_goal(uuid) from public, anon;
revoke execute on function public.reflect_on_game_goal(uuid, text, text) from public, anon;
revoke execute on function public.add_game_goal_comment(uuid, text) from public, anon;
grant execute on function public.save_game_goal(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.delete_game_goal(uuid) to authenticated;
grant execute on function public.reflect_on_game_goal(uuid, text, text) to authenticated;
grant execute on function public.add_game_goal_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Team goals
-- ---------------------------------------------------------------------------

create table if not exists public.team_game_goals (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures (id),
  body text not null check (length(btrim(body)) between 1 and 300),
  set_by uuid references public.profiles (id) on delete set null,
  set_by_name text not null,
  -- After the game: how it went, in the coaches' words.
  outcome text check (outcome in ('achieved', 'partly', 'not_yet')),
  review text check (length(review) <= 1000),
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_game_goals_fixture_idx on public.team_game_goals (fixture_id);

drop trigger if exists team_game_goals_touch_updated_at on public.team_game_goals;
create trigger team_game_goals_touch_updated_at
  before update on public.team_game_goals
  for each row execute function public.touch_updated_at();

alter table public.team_game_goals enable row level security;

-- The signed-in member coaches the current squad or team a game is for.
create or replace function public.coaches_fixture_team(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1
    from public.fixtures f
    join public.teams t on t.id = f.team_id
    join public.team_members coach
      on coach.team_id = t.id and coach.profile_id = auth.uid() and coach.team_role = 'coach'
    where f.id = p_fixture_id
      and not t.archived
      and t.selections_completed_at is null
  );
$$;

-- Everyone who sees the game, plus the guardians of its squad or team's athletes.
create or replace function public.can_view_team_goals(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1 from public.fixtures f
    where f.id = p_fixture_id
      and f.team_id is not null
      and (
        public.is_admin()
        or public.is_team_member(f.team_id)
        or exists (
          select 1 from public.team_members a
          where a.team_id = f.team_id and a.team_role = 'athlete'
            and public.is_guardian_of(a.profile_id)
        )
      )
  );
$$;

revoke execute on function public.coaches_fixture_team(uuid) from public, anon;
revoke execute on function public.can_view_team_goals(uuid) from public, anon;
grant execute on function public.coaches_fixture_team(uuid) to authenticated;
grant execute on function public.can_view_team_goals(uuid) to authenticated;

drop policy if exists "Members of the team see its goals" on public.team_game_goals;
create policy "Members of the team see its goals"
  on public.team_game_goals for select to authenticated
  using (public.can_view_team_goals(fixture_id));

-- For coaches: each current squad and team they coach, with its next game in
-- the coming 7 days and its last played game, and their team goal counts.
create or replace function public.coach_team_games()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  fixture_id uuid,
  is_next boolean,
  round_name text,
  opponent text,
  starts_at timestamptz,
  time_tbc boolean,
  goals_close_at timestamptz,
  played_at timestamptz,
  goal_count int,
  reviewed_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.kind::text, g.id, g.is_next, g.round_name, g.opponent, g.starts_at,
    g.time_tbc, public.fixture_goals_close_at(g.f), public.fixture_played_at(g.f),
    (select count(*)::int from public.team_game_goals x where x.fixture_id = g.id),
    (select count(*)::int from public.team_game_goals x
      where x.fixture_id = g.id and (x.outcome is not null or x.review is not null))
  from public.team_members coach
  join public.teams t on t.id = coach.team_id
  cross join lateral (
    (select f, f.id, true as is_next, f.round_name, f.opponent, f.starts_at, f.time_tbc
     from public.fixtures f
     where f.team_id = t.id and f.opponent is not null
       and public.fixture_played_at(f) > now() and f.starts_at <= now() + interval '7 days'
     order by f.starts_at limit 1)
    union all
    (select f, f.id, false, f.round_name, f.opponent, f.starts_at, f.time_tbc
     from public.fixtures f
     where f.team_id = t.id and f.opponent is not null and public.fixture_played_at(f) <= now()
     order by f.starts_at desc limit 1)
  ) g
  where coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
    and not t.archived
    and t.selections_completed_at is null
    and public.is_approved()
  order by t.kind, t.sort_order, t.name, g.is_next desc;
$$;

revoke execute on function public.coach_team_games() from public, anon;
grant execute on function public.coach_team_games() to authenticated;

-- A coach adds a team goal (p_goal_id null) or changes one, in the 7 days
-- before the game until it starts.
create or replace function public.save_team_game_goal(p_goal_id uuid, p_fixture_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.team_game_goals;
  v_fixture public.fixtures;
  v_id uuid;
begin
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write the goal first';
  end if;
  if length(btrim(p_body)) > 300 then
    raise exception 'Keep a goal under 300 characters';
  end if;
  if p_goal_id is not null then
    select * into v_goal from public.team_game_goals where id = p_goal_id for update;
    if v_goal.id is null then
      raise exception 'That goal has been removed';
    end if;
    p_fixture_id := v_goal.fixture_id;
  end if;
  if not public.coaches_fixture_team(p_fixture_id) then
    raise exception 'Only the team’s coaches can set team goals';
  end if;
  select * into v_fixture from public.fixtures where id = p_fixture_id;
  if v_fixture.opponent is null then
    raise exception 'There’s no game to set goals for';
  end if;
  if now() >= public.fixture_goals_close_at(v_fixture) then
    raise exception 'Goals close when the game starts';
  end if;
  if v_fixture.starts_at > now() + interval '7 days' then
    raise exception 'Goals open 7 days before the game';
  end if;

  if v_goal.id is null then
    if (select count(*) from public.team_game_goals where fixture_id = p_fixture_id) >= 5 then
      raise exception 'A game can have up to 5 team goals';
    end if;
    insert into public.team_game_goals (fixture_id, body, set_by, set_by_name)
    values (p_fixture_id, btrim(p_body), auth.uid(), public.my_display_name())
    returning id into v_id;
    return v_id;
  end if;

  update public.team_game_goals set body = btrim(p_body) where id = v_goal.id;
  return v_goal.id;
end;
$$;

create or replace function public.delete_team_game_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.team_game_goals;
  v_fixture public.fixtures;
begin
  select * into v_goal from public.team_game_goals where id = p_goal_id for update;
  if v_goal.id is null then
    return;
  end if;
  if not public.coaches_fixture_team(v_goal.fixture_id) then
    raise exception 'Only the team’s coaches can remove team goals';
  end if;
  select * into v_fixture from public.fixtures where id = v_goal.fixture_id;
  if now() >= public.fixture_goals_close_at(v_fixture) then
    raise exception 'Goals can’t be removed once the game starts';
  end if;
  delete from public.team_game_goals where id = v_goal.id;
end;
$$;

-- A coach says how a team goal went, after the game.
create or replace function public.review_team_game_goal(p_goal_id uuid, p_outcome text, p_review text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.team_game_goals;
  v_fixture public.fixtures;
begin
  select * into v_goal from public.team_game_goals where id = p_goal_id for update;
  if v_goal.id is null or not public.coaches_fixture_team(v_goal.fixture_id) then
    raise exception 'Only the team’s coaches can review team goals';
  end if;
  select * into v_fixture from public.fixtures where id = v_goal.fixture_id;
  if now() < public.fixture_played_at(v_fixture) then
    raise exception 'Reviews open after the game';
  end if;
  if p_outcome is not null and p_outcome not in ('achieved', 'partly', 'not_yet') then
    raise exception 'Pick how the goal went';
  end if;
  if length(coalesce(p_review, '')) > 1000 then
    raise exception 'Keep a review under 1000 characters';
  end if;
  if p_outcome is null and coalesce(btrim(p_review), '') = '' then
    raise exception 'Pick how it went or write a few words';
  end if;

  update public.team_game_goals
  set outcome = p_outcome,
      review = nullif(btrim(p_review), ''),
      reviewed_by_name = public.my_display_name(),
      reviewed_at = now()
  where id = v_goal.id;
end;
$$;

revoke execute on function public.save_team_game_goal(uuid, uuid, text) from public, anon;
revoke execute on function public.delete_team_game_goal(uuid) from public, anon;
revoke execute on function public.review_team_game_goal(uuid, text, text) from public, anon;
grant execute on function public.save_team_game_goal(uuid, uuid, text) to authenticated;
grant execute on function public.delete_team_game_goal(uuid) to authenticated;
grant execute on function public.review_team_game_goal(uuid, text, text) to authenticated;

commit;
