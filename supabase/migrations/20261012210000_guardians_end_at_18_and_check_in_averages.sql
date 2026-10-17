-- Security review, 12 October 2026, two decisions from Matt. Nothing here
-- removes data.
--
-- 1. A guardian's access ends on the athlete's 18th birthday. Message copies
--    already stopped then (send_group_message checks is_minor), but every
--    other guardian right only checked that a link row existed, so a parent
--    kept reading an adult's injuries, check-ins, goals and certificates until
--    an admin happened to re-save the member. The link row stays until an
--    admin removes it; it just no longer grants anything.
-- 2. Check-in averages for the committee and physios showed once 3 athletes
--    had checked in. A squad and one of its teams, or the club and a group,
--    could both show, and subtracting one from the other gave one athlete's
--    exact scores. Averages now show once 5 have checked in, and a group is
--    hidden on any day it differs from the club, its squad or one of its teams
--    (when that one shows too) by fewer than 5 check-ins.

begin;

-- ---------------------------------------------------------------------------
-- 1. Guardians of adults
-- ---------------------------------------------------------------------------

create or replace function public.is_guardian_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guardianships g
    join public.profiles p on p.id = g.athlete_id
    where g.guardian_id = auth.uid()
      and g.athlete_id = p_athlete_id
      and public.is_minor(p.date_of_birth, p.under_17)
  );
$$;

-- The guardian's home screen lists only athletes still under 18.
create or replace function public.my_athletes()
returns table (profile_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.guardianships g
  join public.profiles p on p.id = g.athlete_id
  where g.guardian_id = auth.uid()
    and p.status = 'approved'
    and public.is_minor(p.date_of_birth, p.under_17)
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- 2. Check-in averages that can't be subtracted from each other
-- ---------------------------------------------------------------------------

-- For each day, how many approved athletes in each current squad or team (and
-- in the whole club, team_id null) checked in, and whether that group's
-- averages may be shown that day. Shared by check_in_trend and
-- check_in_overview so both apply the same rule.
create or replace function public.check_in_visible_days(p_since date, p_until date)
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
        where c.day = d.day
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

-- Only reached through the two functions below.
revoke execute on function public.check_in_visible_days(date, date) from public, anon, authenticated;

-- Same as before, with the new rule for when averages show.
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
      or public.is_physio()
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
  ),
  shown as (
    select v.day, v.visible
    from public.check_in_visible_days(p_since, p_until) v
    where v.team_id is not distinct from p_team_id
  )
  select
    s.day, s.checked_in,
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

-- Same as before, with the new rule for when averages show.
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
    left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
    group by g.id, g.name, g.kind, g.season, g.sort_order, g.squad_order
  ),
  shown as (
    select v.team_id, v.visible from public.check_in_visible_days(p_day, p_day) v
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

commit;
