-- Fixes from the coach guide audit (17 October 2026).
--
-- 1. Check-in averages respect parents' consent. The Day by day board and the
--    home-screen counts already leave out an athlete under 18 until a parent
--    or guardian has given consent for their check-ins; the Trends graphs,
--    the committee's overview and the "days visible" rule did not. Now every
--    check-in view counts the same athletes. Trends also become a rolling
--    3-day average, so small groups with patchy check-ins still get a line.
-- 2. Team game goals are for the team's coaches and athletes. Managers and
--    physios placed in a team could read its team goals and comment on them;
--    now only its coaches and athletes can (admins and the athletes' parents
--    and guardians still read them).
-- 3. A coach's goal board counts reflections to answer per team, so an
--    athlete in two fixtured teams isn't counted twice.
-- 4. The home-screen check-in totals know which squad a team belongs to, so
--    a team of a completed squad is counted alongside another squad.
-- 5. The role rule says "Temporary helpers", the name the app uses.
--
-- Additive only: functions are replaced, no table or row changes. The
-- check_in_summary return type gains a column, so it is dropped and recreated.

begin;

-- ---------------------------------------------------------------------------
-- 1. Consent gates every check-in view
-- ---------------------------------------------------------------------------

-- Counts now cover a window of days ending on each day (p_days = 1 for one
-- day), so Trends can average over three days: a small team whose athletes
-- don't all check in every day still reaches 5 across three days. The rule
-- is unchanged otherwise: a window shows only with 5 or more athletes and
-- when no related group's window is within 1 to 4 of it.
drop function if exists public.check_in_visible_days(date, date);
drop function if exists public.check_in_visible_days(date, date, int);
create function public.check_in_visible_days(p_since date, p_until date, p_days int)
returns table (team_id uuid, day date, checked_in int, visible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with athletes as (
    select a.team_id, a.profile_id
    from public.team_members a
    join public.teams t on t.id = a.team_id and not t.archived
    join public.profiles p on p.id = a.profile_id and p.status = 'approved'
    where a.team_role = 'athlete'
      and public.has_child_consent(a.profile_id, 'data')
  ),
  days as (
    select d::date as day from generate_series(p_since, p_until, interval '1 day') d
  ),
  groups as (
    select distinct a.team_id from athletes a
    union all
    select null::uuid
  ),
  counts as (
    select
      g.team_id,
      d.day,
      (
        select count(distinct c.athlete_id)::int
        from public.check_ins c
        where c.day between d.day - (greatest(p_days, 1) - 1) and d.day
          and c.athlete_id in (
            select a.profile_id from athletes a
            where g.team_id is null or a.team_id = g.team_id
          )
      ) as n
    from groups g
    cross join days d
  )
  select
    c.team_id,
    c.day,
    c.n,
    c.n >= 5 and not exists (
      select 1
      from counts r
      left join public.teams tc on tc.id = c.team_id
      left join public.teams tr on tr.id = r.team_id
      where r.day = c.day
        and r.team_id is distinct from c.team_id
        and r.n >= 5
        and abs(r.n - c.n) between 1 and 4
        and (
          -- the club against any group
          r.team_id is null or c.team_id is null
          -- a squad against its teams
          or tc.squad_id = r.team_id
          or tr.squad_id = c.team_id
        )
    ) as visible
  from counts c;
$$;

revoke execute on function public.check_in_visible_days(date, date, int) from public, anon, authenticated;

-- Each day's averages are a rolling average of that day and the two before
-- it (Matt, 17 October 2026): a team of 12 whose athletes don't check in
-- every day rarely reaches 5 on one day, but usually does across three.
-- The bar shows the day's own check-ins; the averages, the flagged count
-- and the new window_count cover the three days, and show only when at
-- least 5 athletes checked in across them.
drop function if exists public.check_in_trend(uuid, date, date);
create function public.check_in_trend(p_team_id uuid, p_since date, p_until date)
returns table (
  day date,
  checked_in_count int,
  window_count int,
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.is_approved() and p_until - p_since between 0 and 366 and (
      public.is_committee()
      or public.is_physio()
      or (p_team_id is not null and exists (
        select 1 from public.team_members coach
        join public.teams t on t.id = coach.team_id
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
          and public.can_work_with_children()
          and not t.archived
          and t.selections_completed_at is null
      ))
    ) as ok
  ),
  athletes as (
    select distinct a.profile_id
    from public.team_members a
    join public.teams t on t.id = a.team_id and not t.archived
    join public.profiles p on p.id = a.profile_id and p.status = 'approved'
    where a.team_role = 'athlete'
      and (p_team_id is null or a.team_id = p_team_id)
      and public.has_child_consent(a.profile_id, 'data')
  ),
  days as (
    select d::date as day from generate_series(p_since, p_until, interval '1 day') d
  ),
  scores as (
    select
      d.day,
      count(c.id) filter (where c.day = d.day)::int as checked_in,
      count(c.id)::int as in_window,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from days d
    left join public.check_ins c on c.day between d.day - 2 and d.day
      and c.athlete_id in (select profile_id from athletes)
    group by d.day
  ),
  shown as (
    select v.day, v.visible
    from public.check_in_visible_days(p_since, p_until, 3) v
    where v.team_id is not distinct from p_team_id
  )
  select
    s.day, s.checked_in, s.in_window,
    case when v.visible then s.flagged end,
    case when v.visible then round(s.sleep, 1) end,
    case when v.visible then round(s.soreness, 1) end,
    case when v.visible then round(s.stress, 1) end,
    case when v.visible then round(s.mood, 1) end
  from scores s
  left join shown v on v.day = s.day, allowed
  where allowed.ok
  order by s.day;
$$;

revoke execute on function public.check_in_trend(uuid, date, date) from public, anon;
grant execute on function public.check_in_trend(uuid, date, date) to authenticated;

create or replace function public.check_in_overview(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  season int,
  athlete_count int,
  checked_in_count int,
  -- Null when the group's averages are hidden that day.
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with groups as (
    select t.id, t.name, t.kind, t.season, t.sort_order, coalesce(s.sort_order, t.sort_order) as squad_order
    from public.teams t
    left join public.teams s on s.id = t.squad_id
    where not t.archived
      and (
        (t.kind = 'squad' and t.selections_completed_at is null)
        or (t.kind = 'team' and (t.squad_id is null or s.selections_completed_at is not null))
      )
  ),
  scores as (
    select
      g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order,
      count(a.profile_id)::int as athletes,
      count(c.id)::int as checked_in,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from groups g
    left join public.team_members a on a.team_id = g.id and a.team_role = 'athlete'
      and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
      and public.has_child_consent(a.profile_id, 'data')
    left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
    group by g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order
  ),
  shown as (
    select v.team_id, v.visible from public.check_in_visible_days(p_day, p_day, 1) v
  )
  select
    s.id, s.name, s.kind::text, s.season, s.athletes, s.checked_in,
    case when v.visible then s.flagged end,
    case when v.visible then round(s.sleep, 1) end,
    case when v.visible then round(s.soreness, 1) end,
    case when v.visible then round(s.stress, 1) end,
    case when v.visible then round(s.mood, 1) end
  from scores s
  left join shown v on v.team_id = s.id
  where public.is_committee() or public.is_physio()
  order by s.season desc, s.squad_order, s.kind, s.sort_order, s.name;
$$;

-- ---------------------------------------------------------------------------
-- 2. Team goals are for the team's coaches and athletes
-- ---------------------------------------------------------------------------

-- The team's coaches and athletes, the athletes' guardians, and admins.
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
        or exists (
          select 1 from public.team_members m
          where m.team_id = f.team_id
            and m.profile_id = auth.uid()
            and m.team_role in ('coach', 'athlete')
        )
        or exists (
          select 1 from public.team_members a
          where a.team_id = f.team_id and a.team_role = 'athlete'
            and public.is_guardian_of(a.profile_id)
        )
      )
  );
$$;

-- The signed-in member's part in the current squad or team a game is for
-- (coach or athlete), or null if they aren't in it as one of those.
create or replace function public.fixture_team_role(p_fixture_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.team_role::text
  from public.fixtures f
  join public.teams t on t.id = f.team_id
  join public.team_members m on m.team_id = t.id and m.profile_id = auth.uid()
  where f.id = p_fixture_id
    and m.team_role in ('coach', 'athlete')
    and not t.archived
    and public.is_approved()
  order by case m.team_role when 'coach' then 1 else 2 end
  limit 1;
$$;

-- As before, with the message naming who can comment.
create or replace function public.add_team_game_goal_comment(p_goal_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.team_game_goals;
  v_role text;
  v_id uuid;
begin
  select * into v_goal from public.team_game_goals where id = p_goal_id;
  if v_goal.id is null then
    raise exception 'That goal has been removed';
  end if;
  v_role := public.fixture_team_role(v_goal.fixture_id);
  if v_role is null then
    raise exception 'Only the team’s coaches and athletes can comment on its goals';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a comment first';
  end if;
  if length(btrim(p_body)) > 1000 then
    raise exception 'Keep a comment under 1000 characters';
  end if;

  insert into public.team_game_goal_comments (goal_id, author_id, author_name, author_role, body)
  values (v_goal.id, auth.uid(), public.my_display_name(), v_role, btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reflections to answer, counted per team
-- ---------------------------------------------------------------------------

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
      join public.athlete_games(p.id) g on g.id = x.fixture_id and g.team_id = t.id
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
    and public.can_work_with_children()
  order by t.kind, t.sort_order, t.name, p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- 4. Home-screen check-in totals know each team's squad
-- ---------------------------------------------------------------------------

drop function if exists public.check_in_summary(date);
create function public.check_in_summary(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  squad_id uuid,
  athlete_count integer,
  checked_in_count integer,
  flagged_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.kind::text,
    t.squad_id,
    count(a.profile_id)::int,
    count(c.id)::int,
    count(c.id) filter (
      where least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    )::int
  from public.team_members coach
  join public.teams t on t.id = coach.team_id and not t.archived
    and t.selections_completed_at is null
  left join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
    and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
    and public.has_child_consent(a.profile_id, 'data')
  left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
  where public.is_approved()
    and public.can_work_with_children()
    and coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
  group by t.id, t.name, t.kind, t.squad_id, t.sort_order
  order by t.kind, t.sort_order, t.name;
$$;

revoke execute on function public.check_in_summary(date) from public, anon;
grant execute on function public.check_in_summary(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. "Temporary helpers" in the role rule
-- ---------------------------------------------------------------------------

create or replace function public.role_combination_problem(
  p_roles public.app_role[],
  p_date_of_birth date,
  p_under_18 boolean
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when 'partner' = any (p_roles)
      then 'The Partner role has been removed. Use Guest instead.'
    when 'guest' = any (p_roles) and cardinality(p_roles) > 1
      then 'Guests can''t have another role'
    when 'volunteer' = any (p_roles) and cardinality(p_roles) > 1
      then 'Temporary helpers can''t have another role'
    when 'admin' = any (p_roles) and 'athlete' = any (p_roles)
      then 'Admins can''t also be athletes'
    when 'athlete' = any (p_roles) and 'manager' = any (p_roles)
      then 'Athletes can''t also be managers'
    when 'athlete' = any (p_roles) and 'physio' = any (p_roles)
      then 'Athletes can''t also be physios'
    when 'athlete' = any (p_roles) and public.is_minor(p_date_of_birth, p_under_18)
      and not p_roles <@ array['athlete', 'coach']::public.app_role[]
      then 'Athletes under 18 can only also be a coach'
    when 'guardian' = any (p_roles) and p_date_of_birth is not null
      and public.is_minor(p_date_of_birth, false)
      then 'Parents and guardians must be 18 or over'
  end;
$$;

commit;
