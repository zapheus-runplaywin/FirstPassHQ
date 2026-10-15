-- Absence reasons: a reported absence says why, from a list the club keeps,
-- so the club can see why athletes miss sessions. The list starts with
-- Planned holidays, Personal illness, Caring duties, Planned event, National
-- team, Volunteering, West Coast Fever, School or uni exam, Work commitment
-- and Other. Admins turn reasons off and add their own. A reason is never
-- deleted, so absences keep theirs. The free-text reason stays, now optional
-- details.
--
-- Additive only: a new table, a new nullable column (absences reported before
-- it have no reason; no rows are changed), and new functions. report_absence
-- gets a second version that takes the reason; the old one stays for app
-- builds that don't send it. The three read functions are dropped and
-- recreated (no data is held in a function) because a function's columns
-- can't be changed in place; each returns what it did before plus the
-- reason's name, to the same people. absence_report gives admins the reasons
-- for the Attendance report. injured_on tells whoever takes attendance which
-- athletes are injured and when they're expected back, without details.

begin;

create table if not exists public.absence_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists absence_categories_name
  on public.absence_categories (lower(trim(name)));

alter table public.absence_categories enable row level security;

drop policy if exists "Members see absence reasons" on public.absence_categories;
create policy "Members see absence reasons"
  on public.absence_categories for select to authenticated
  using (public.is_approved());

drop policy if exists "Admins add absence reasons" on public.absence_categories;
create policy "Admins add absence reasons"
  on public.absence_categories for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins change absence reasons" on public.absence_categories;
create policy "Admins change absence reasons"
  on public.absence_categories for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Reasons are turned off, never deleted, so past absences keep them.
grant select, insert, update on public.absence_categories to authenticated;
revoke delete on public.absence_categories from anon, authenticated;

-- The starting list, only into an empty table so re-running never brings
-- back a reason an admin changed.
insert into public.absence_categories (name, sort_order)
select v.name, v.sort_order
from (values
  ('Planned holidays', 1),
  ('Personal illness', 2),
  ('Caring duties', 3),
  ('Planned event', 4),
  ('National team', 5),
  ('Volunteering', 6),
  ('West Coast Fever', 7),
  ('School or uni exam', 8),
  ('Work commitment', 9),
  ('Other', 10)
) as v(name, sort_order)
where not exists (select 1 from public.absence_categories);

alter table public.attendance_absences
  add column if not exists category_id uuid
    references public.absence_categories (id) on delete set null;

-- As report_absence(uuid, date, date, text) in 20261013120000_family_attendance.sql,
-- and a reason that's switched on is required while the club has any.
create or replace function public.report_absence(
  p_athlete_id uuid,
  p_from date,
  p_to date,
  p_category_id uuid,
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
  if p_category_id is null then
    if exists (select 1 from public.absence_categories where active) then
      raise exception 'Choose a reason for the absence';
    end if;
  elsif not exists (
    select 1 from public.absence_categories where id = p_category_id and active
  ) then
    raise exception 'That reason is no longer used. Choose another.';
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
    athlete_id, from_day, to_day, category_id, reason, reported_by, reported_by_name, reported_as
  )
  values (
    p_athlete_id, p_from, p_to, p_category_id, v_reason, auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    case when p_athlete_id = auth.uid() then 'athlete' else 'guardian' end
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.report_absence(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.report_absence(uuid, date, date, uuid, text) to authenticated;

-- As before, with the reason's name.
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
    a.created_at, a.withdrawn_at, c.name
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
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
    a.reported_by_name, c.name
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
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
    a.from_day, a.to_day, a.reason, a.reported_by_name, c.name
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
  where a.withdrawn_at is null
    and a.to_day >= current_date
    and a.from_day <= current_date + 28
    and public.can_see_absences_of(a.athlete_id)
  order by a.from_day, 3;
$$;

revoke execute on function public.upcoming_absences() from public, anon;
grant execute on function public.upcoming_absences() to authenticated;

-- Athletes injured on a day, for the register of a squad or team (or every
-- athlete, for a club event, p_team_id null), for whoever can take or see
-- that group's attendance. Injured athletes still come to support the team,
-- so this only says they're injured and when they're expected back (Matt,
-- 2026-10-15: everyone taking attendance sees it). No other injury details.
create or replace function public.injured_on(p_team_id uuid, p_day date)
returns table (
  profile_id uuid,
  expected_return date
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (i.athlete_id) i.athlete_id, i.expected_return
  from public.injuries i
  where i.athlete_left_at is null
    and i.injured_on <= p_day
    and (i.status <> 'cleared' or i.cleared_at is null or i.cleared_at::date > p_day)
    and (
      (p_team_id is null and public.is_attendance_taker() and public.is_club_athlete(i.athlete_id))
      or (p_team_id is not null
        and (public.can_take_attendance(p_team_id) or public.can_view_team_attendance(p_team_id)
          or public.leads_group(p_team_id))
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = p_team_id and tm.profile_id = i.athlete_id and tm.team_role = 'athlete'
        ))
    )
  order by i.athlete_id, i.injured_on desc, i.created_at desc;
$$;

revoke execute on function public.injured_on(uuid, date) from public, anon;
grant execute on function public.injured_on(uuid, date) to authenticated;

-- Absences overlapping a period, for the admins' Attendance report: who, when
-- and which reason (with its place in the list), without the free-text details.
create or replace function public.absence_report(p_from date, p_to date)
returns table (
  athlete_id uuid,
  from_day date,
  to_day date,
  category text,
  category_order int
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.athlete_id, a.from_day, a.to_day, c.name, c.sort_order
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
  where public.is_admin()
    and a.withdrawn_at is null
    and a.from_day <= p_to
    and a.to_day >= p_from
  order by a.from_day, a.athlete_id;
$$;

revoke execute on function public.absence_report(date, date) from public, anon;
grant execute on function public.absence_report(date, date) to authenticated;

commit;
