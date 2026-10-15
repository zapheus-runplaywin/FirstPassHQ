-- Absence categories: a reported absence says what kind it is (Holiday, Sick,
-- Injured, School or work, Day off, Personal, Other), so the club can see why
-- athletes miss sessions. The free-text reason stays, now optional details.
--
-- Additive only: a new nullable column, and absences reported before it have
-- no category (no rows are changed). report_absence gets a second version
-- that takes the category; the old one stays for app builds that don't send
-- it. The three read functions are dropped and recreated (no data is held in
-- a function) because a function's columns can't be changed in place; each
-- returns what it did before plus the category, to the same people.
-- absence_report gives admins the categories for the Attendance report.

begin;

alter table public.attendance_absences
  add column if not exists category text
    constraint attendance_absences_category check (
      category is null
      or category in ('holiday', 'sick', 'injured', 'school_work', 'day_off', 'personal', 'other')
    );

-- As report_absence(uuid, date, date, text) in 20261013120000_family_attendance.sql,
-- and the category is required.
create or replace function public.report_absence(
  p_athlete_id uuid,
  p_from date,
  p_to date,
  p_category text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_athlete_or_guardian(p_athlete_id) then
    raise exception 'Only the athlete or their parent or guardian can report an absence';
  end if;
  if not public.is_club_athlete(p_athlete_id) then
    raise exception 'Absences can only be reported for athletes';
  end if;
  if p_category is null
    or p_category not in ('holiday', 'sick', 'injured', 'school_work', 'day_off', 'personal', 'other') then
    raise exception 'Choose what kind of absence it is';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Choose the first and last day away';
  end if;
  if p_to < p_from then
    raise exception 'The last day can’t be before the first day';
  end if;
  if p_from < current_date - 14 then
    raise exception 'Absences can be reported up to 14 days after';
  end if;
  if p_to > current_date + 365 then
    raise exception 'Absences can be reported up to 12 months ahead';
  end if;
  if p_to - p_from > 92 then
    raise exception 'An absence can be up to 3 months long';
  end if;
  if length(coalesce(v_reason, '')) > 200 then
    raise exception 'Keep the details under 200 characters';
  end if;
  insert into public.attendance_absences (
    athlete_id, from_day, to_day, category, reason, reported_by, reported_by_name, reported_as
  )
  values (
    p_athlete_id, p_from, p_to, p_category, v_reason, auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    case when p_athlete_id = auth.uid() then 'athlete' else 'guardian' end
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.report_absence(uuid, date, date, text, text) from public, anon;
grant execute on function public.report_absence(uuid, date, date, text, text) to authenticated;

-- As before, with the category.
drop function if exists public.my_absences(uuid);
create function public.my_absences(p_athlete_id uuid)
returns table (
  id uuid,
  from_day date,
  to_day date,
  reason text,
  reported_by_name text,
  reported_as text,
  created_at timestamptz,
  withdrawn_at timestamptz,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.from_day, a.to_day, a.reason, a.reported_by_name, a.reported_as,
    a.created_at, a.withdrawn_at, a.category
  from public.attendance_absences a
  where a.athlete_id = p_athlete_id
    and public.is_athlete_or_guardian(p_athlete_id)
    and a.to_day >= current_date - 365
  order by a.from_day desc, a.created_at desc;
$$;

revoke execute on function public.my_absences(uuid) from public, anon;
grant execute on function public.my_absences(uuid) to authenticated;

drop function if exists public.absences_on(uuid, date);
create function public.absences_on(p_team_id uuid, p_day date)
returns table (
  profile_id uuid,
  reason text,
  from_day date,
  to_day date,
  reported_by_name text,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (a.athlete_id) a.athlete_id, a.reason, a.from_day, a.to_day,
    a.reported_by_name, a.category
  from public.attendance_absences a
  where a.withdrawn_at is null
    and p_day between a.from_day and a.to_day
    and (
      (p_team_id is null and public.is_attendance_taker() and public.is_club_athlete(a.athlete_id))
      or (p_team_id is not null
        and (public.can_take_attendance(p_team_id) or public.can_view_team_attendance(p_team_id)
          or public.leads_group(p_team_id))
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = p_team_id and tm.profile_id = a.athlete_id and tm.team_role = 'athlete'
        ))
    )
  order by a.athlete_id, a.created_at desc;
$$;

revoke execute on function public.absences_on(uuid, date) from public, anon;
grant execute on function public.absences_on(uuid, date) to authenticated;

drop function if exists public.upcoming_absences();
create function public.upcoming_absences()
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  from_day date,
  to_day date,
  reason text,
  reported_by_name text,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.athlete_id, coalesce(public.member_display_name(a.athlete_id), 'Athlete'),
    a.from_day, a.to_day, a.reason, a.reported_by_name, a.category
  from public.attendance_absences a
  where a.withdrawn_at is null
    and a.to_day >= current_date
    and a.from_day <= current_date + 28
    and public.can_see_absences_of(a.athlete_id)
  order by a.from_day, 3;
$$;

revoke execute on function public.upcoming_absences() from public, anon;
grant execute on function public.upcoming_absences() to authenticated;

-- Absences overlapping a period, for the admins' Attendance report: who, when
-- and what kind, without the free-text details.
create or replace function public.absence_report(p_from date, p_to date)
returns table (
  athlete_id uuid,
  from_day date,
  to_day date,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.athlete_id, a.from_day, a.to_day, a.category
  from public.attendance_absences a
  where public.is_admin()
    and a.withdrawn_at is null
    and a.from_day <= p_to
    and a.to_day >= p_from
  order by a.from_day, a.athlete_id;
$$;

revoke execute on function public.absence_report(date, date) from public, anon;
grant execute on function public.absence_report(date, date) to authenticated;

commit;
