-- Check-in overview for the committee and admins.
--
-- Matt (2026-10-07): admins and the committee shouldn't see individual
-- check-ins. They see averages instead: for each squad until its Selections
-- Phase 2 is complete, then for each team named from it. Coaches keep seeing
-- their own athletes' check-ins (an admin who coaches still does, as a coach).
--
-- So that an average can't point at one athlete, scores and the flagged count
-- are only shown once at least 3 athletes in the group have checked in.
--
-- Coaches, the committee and admins also get daily averages over time, for
-- trend graphs, with the same rules.
--
-- Additive only: replaced functions and two new functions. No rows change.

-- Same as before without the admin rule: the athlete, their guardians and
-- their coaches.
create or replace function public.can_view_check_ins(p_athlete_id uuid)
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

-- Same as before without the admin rule: only the group's coaches, while the
-- group is one they coach.
create or replace function public.check_in_board(p_team_id uuid, p_day date)
returns table (
  athlete_id uuid,
  full_name text,
  sleep smallint,
  soreness smallint,
  stress smallint,
  mood smallint,
  note text,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, coalesce(nullif(p.full_name, ''), p.email),
    c.sleep, c.soreness, c.stress, c.mood, c.note, c.updated_at
  from public.team_members a
  join public.profiles p on p.id = a.profile_id and p.status = 'approved'
  left join public.check_ins c on c.athlete_id = p.id and c.day = p_day
  where a.team_id = p_team_id
    and a.team_role = 'athlete'
    and public.is_approved()
    and exists (
      select 1 from public.team_members coach
      join public.teams t on t.id = coach.team_id
      where coach.team_id = p_team_id
        and coach.profile_id = auth.uid()
        and coach.team_role = 'coach'
        and t.selections_completed_at is null
    )
  order by p.full_name;
$$;

-- Averages for p_day: each current squad until its selections are complete,
-- then each team named from it. For the committee and admins.
create or replace function public.check_in_overview(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  season int,
  athlete_count int,
  checked_in_count int,
  -- Null when fewer than 3 athletes have checked in.
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
        or (t.kind = 'team' and s.selections_completed_at is not null)
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
    left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
    group by g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order
  )
  select
    id, name, kind::text, season, athletes, checked_in,
    case when checked_in >= 3 then flagged end,
    case when checked_in >= 3 then round(sleep, 1) end,
    case when checked_in >= 3 then round(soreness, 1) end,
    case when checked_in >= 3 then round(stress, 1) end,
    case when checked_in >= 3 then round(mood, 1) end
  from scores
  where public.is_committee()
  order by season desc, squad_order, kind, sort_order, name;
$$;

revoke execute on function public.check_in_overview(date) from public, anon;
grant execute on function public.check_in_overview(date) to authenticated;

-- Daily averages from p_since to p_until (inclusive) for one squad or team, or
-- for the whole club when p_team_id is null, so trends can be graphed. The
-- group's current athletes are counted. A day with fewer than 3 check-ins has
-- no scores, so it can't point at one athlete.
--
-- The committee and admins can see any current group and the whole club.
-- Coaches can see the groups they coach (until a squad's selections are
-- complete, then their teams).
create or replace function public.check_in_trend(p_team_id uuid, p_since date, p_until date)
returns table (
  day date,
  checked_in_count int,
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
      or (p_team_id is not null and exists (
        select 1 from public.team_members coach
        join public.teams t on t.id = coach.team_id
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
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
  ),
  days as (
    select d::date as day from generate_series(p_since, p_until, interval '1 day') d
  ),
  scores as (
    select
      d.day,
      count(c.id)::int as checked_in,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from days d
    left join public.check_ins c on c.day = d.day
      and c.athlete_id in (select profile_id from athletes)
    group by d.day
  )
  select
    s.day, s.checked_in,
    case when s.checked_in >= 3 then s.flagged end,
    case when s.checked_in >= 3 then round(s.sleep, 1) end,
    case when s.checked_in >= 3 then round(s.soreness, 1) end,
    case when s.checked_in >= 3 then round(s.stress, 1) end,
    case when s.checked_in >= 3 then round(s.mood, 1) end
  from scores s, allowed
  where allowed.ok
  order by s.day;
$$;

revoke execute on function public.check_in_trend(uuid, date, date) from public, anon;
grant execute on function public.check_in_trend(uuid, date, date) to authenticated;
