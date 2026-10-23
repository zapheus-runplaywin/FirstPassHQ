-- Wellbeing flags for the Child Safety Officer (customer review C9, Matt,
-- 23 October 2026).
--
-- A check-in score of 2 or less flags an athlete to their coaches. Athletes
-- who aren't selected drop out of every coach's check-ins once their squad's
-- selections are done, so a run of low scores could go unseen. The club's
-- Child Safety Officer now sees every athlete's flags: the day and the lowest
-- score only, never the four answers or the note. They get a to-do when the
-- same athlete is flagged on 3 days in 7.
--
-- Consent rules don't change: a child's flags show only once their parent or
-- guardian has given data consent, the same consent that lets coaches see
-- their check-ins. Opening an under 18's flags goes in that child's record
-- access log.
--
-- Additive only: new functions, no tables, no changed rows.

begin;

-- Whether the signed-in member is the club's Child Safety Officer and can act
-- as one right now. The Complaints Manager isn't included.
create or replace function public.is_child_safety_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.safeguarding_settings s
    where s.child_safety_officer_id = auth.uid()
  ) and public.can_be_safeguarding_contact(auth.uid());
$$;

revoke execute on function public.is_child_safety_officer() from public, anon;
grant execute on function public.is_child_safety_officer() to authenticated;

-- Every flagged check-in in the last p_days days (1 to 60, default 14), for
-- approved athletes whose flags the Child Safety Officer may see: adults, and
-- under 18s with data consent. Closed to everyone; the two functions below
-- call it.
create or replace function public.wellbeing_flag_rows(p_days int)
returns table (athlete_id uuid, athlete_name text, day date, lowest_score smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.athlete_id,
    coalesce(public.member_display_name(c.athlete_id), 'Athlete'),
    c.day,
    least(c.sleep, c.soreness, c.stress, c.mood)
  from public.check_ins c
  join public.profiles p on p.id = c.athlete_id
  where c.day > current_date - least(greatest(coalesce(p_days, 14), 1), 60)
    and least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    and p.status = 'approved'
    and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
    and public.has_child_consent(c.athlete_id, 'data');
$$;

revoke execute on function public.wellbeing_flag_rows(int) from public, anon, authenticated;

-- The flags themselves, newest first, with how many days each athlete was
-- flagged in the last 7. Only for the Child Safety Officer. Each under 18
-- shown is logged as a view of their check-ins.
create or replace function public.wellbeing_flags(p_days int default 14)
returns table (
  athlete_id uuid,
  athlete_name text,
  day date,
  lowest_score smallint,
  flags_in_7_days int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete uuid;
begin
  if not public.is_approved() or not public.is_child_safety_officer() then
    raise exception 'Only the Child Safety Officer sees wellbeing flags';
  end if;

  for v_athlete in select distinct f.athlete_id from public.wellbeing_flag_rows(p_days) f loop
    perform public.write_record_access(v_athlete, 'check_ins', null);
  end loop;

  return query
    select f.athlete_id, f.athlete_name, f.day, f.lowest_score,
      (select count(*)::int from public.wellbeing_flag_rows(7) w where w.athlete_id = f.athlete_id)
    from public.wellbeing_flag_rows(p_days) f
    order by f.day desc, f.athlete_name;
end;
$$;

revoke execute on function public.wellbeing_flags(int) from public, anon;
grant execute on function public.wellbeing_flags(int) to authenticated;

-- For the Child Safety Officer's to-do list: how many athletes were flagged
-- on 3 or more days in the last 7. Null for anyone else, so the app knows
-- not to show wellbeing flags at all.
create or replace function public.wellbeing_flag_alerts()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_approved() and public.is_child_safety_officer() then (
      select count(*)::int from (
        select f.athlete_id from public.wellbeing_flag_rows(7) f
        group by f.athlete_id
        having count(*) >= 3
      ) repeated
    )
  end;
$$;

revoke execute on function public.wellbeing_flag_alerts() from public, anon;
grant execute on function public.wellbeing_flag_alerts() to authenticated;

commit;
