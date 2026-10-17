-- Check-in averages for the committee, admins and physios show from 3
-- athletes instead of 5 (Matt, 17 October 2026). Teams have 11 or 12
-- athletes, so 5 check-ins in a group hid the Trends too often. The committee,
-- admins and physios never see who checked in, only counts and averages.
--
-- The rule otherwise stays the same, scaled to the new minimum: a window
-- shows with 3 or more athletes, and is hidden when a related group (the
-- club, its squad or one of its teams) that also shows differs from it by 1
-- or 2 check-ins, so one group can't be subtracted from another to give one
-- or two athletes' scores.
--
-- Additive only: the function is replaced with the same signature, no table
-- or row changes.

begin;

create or replace function public.check_in_visible_days(p_since date, p_until date, p_days int)
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
    c.n >= 3 and not exists (
      select 1
      from counts r
      left join public.teams tc on tc.id = c.team_id
      left join public.teams tr on tr.id = r.team_id
      where r.day = c.day
        and r.team_id is distinct from c.team_id
        and r.n >= 3
        and abs(r.n - c.n) between 1 and 2
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

commit;
