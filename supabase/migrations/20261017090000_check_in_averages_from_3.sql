-- Check-in averages for the committee, admins and physios show from 3
-- athletes instead of 5 (Matt, 17 October 2026). Teams have 11 or 12
-- athletes, so 5 check-ins in a group hid the Trends too often. The committee,
-- admins and physios never see who checked in, only counts and averages.
--
-- The rule that also hid a group when the club, its squad or one of its
-- teams was within 4 check-ins of it is dropped (Matt): an athlete is in one
-- team at a time, and working out one athlete's scores from two groups'
-- averages would take more effort than anyone is likely to spend. A window
-- now shows whenever 3 or more athletes checked in.
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
    c.n >= 3 as visible
  from counts c;
$$;

revoke execute on function public.check_in_visible_days(date, date, int) from public, anon, authenticated;

commit;
