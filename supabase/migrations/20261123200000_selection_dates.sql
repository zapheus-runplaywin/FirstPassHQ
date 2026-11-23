-- Selection assessments, phase 2: a round's dates, reminders for its
-- selectors, an attendance summary, and the criteria and dates for athletes
-- and their parents (Matt, 23 November 2026: "If the app can build in
-- process milestones and dates to help remind coaches that might be useful").
--
-- An admin gives a round its dates: the steps of the selection phase, such
-- as "Observations complete" or "Teams named", each with a day. They mark a
-- step done when it is. Nothing is ever erased: a date taken off stays in
-- the audit, with who took it off.
--
-- Who sees what:
--   - the round's panel see every date, and get a to-do for one that is due
--     within 7 days or overdue, and one in the last 14 days of the round
--     while athletes they can assess have nothing written;
--   - admins see and change the dates, get the same date to-dos, and read
--     them in the audit report with how late each was;
--   - the round's athletes, and the verified parents and guardians of those
--     under 18, see the round's criteria and the dates an admin chose to
--     share. They see no observation, rating or count;
--   - a panel member sees how many of the group's sessions an athlete was
--     marked at during the round, as two counts. Never an absence reason.
--
-- Additive: one new table and new functions. No existing rows change.

begin;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

-- One dated step of a round. A row is never removed: taking a date off
-- fills in removed_at, so the audit report still shows it.
create table if not exists public.selection_round_milestones (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  title text not null check (length(title) between 1 and 60),
  due_on date not null,
  -- Whether the round's athletes and their parents see it.
  shared boolean not null default true,
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  done_by_name text,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  removed_by_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists selection_round_milestones_round_idx
  on public.selection_round_milestones (round_id, due_on);

-- Read and written only through the functions below.
alter table public.selection_round_milestones enable row level security;
revoke all on table public.selection_round_milestones from public, anon, authenticated;
grant all on table public.selection_round_milestones to service_role;

-- ---------------------------------------------------------------------------
-- Admins: a round's dates
-- ---------------------------------------------------------------------------

-- Every date of a round for admins, soonest first, with the ones taken off.
create or replace function public.admin_selection_milestones(p_round_id uuid)
returns table (
  id uuid,
  title text,
  due_on date,
  shared boolean,
  done_at timestamptz,
  done_by_name text,
  removed_at timestamptz,
  removed_by_name text,
  created_by_name text,
  created_at timestamptz,
  -- Days past its day: when it was done, or today while it is still open.
  days_late integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see a selection round’s dates';
  end if;
  return query
  select m.id, m.title, m.due_on, m.shared, m.done_at,
    coalesce(public.member_display_name(m.done_by), m.done_by_name),
    m.removed_at,
    coalesce(public.member_display_name(m.removed_by), m.removed_by_name),
    coalesce(public.member_display_name(m.created_by), m.created_by_name),
    m.created_at,
    greatest(0, coalesce(public.club_day(m.done_at), public.club_day(m.removed_at), public.club_today()) - m.due_on)::int
  from public.selection_round_milestones m
  where m.round_id = p_round_id
  order by (m.removed_at is not null), m.due_on, m.created_at;
end;
$$;
revoke execute on function public.admin_selection_milestones(uuid) from public, anon;
grant execute on function public.admin_selection_milestones(uuid) to authenticated;

-- Admins add a date to a round (no id) or change one. A date that is done
-- or taken off can't be changed. Returns its id.
create or replace function public.admin_save_selection_milestone(
  p_id uuid,
  p_round_id uuid,
  p_title text,
  p_due_on date,
  p_shared boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_title text := btrim(coalesce(p_title, ''));
  v_id uuid;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection round’s dates';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if not found then
    raise exception 'Round not found';
  end if;
  if length(v_title) not between 1 and 60 then
    raise exception 'Name the step, in up to 60 characters';
  end if;
  if p_due_on is null then
    raise exception 'Choose the day';
  end if;
  if p_due_on < v_round.starts_on - 366 or p_due_on > v_round.ends_on + 366 then
    raise exception 'Choose a day within a year of the round';
  end if;

  if p_id is null then
    if (select count(*) from public.selection_round_milestones m
        where m.round_id = p_round_id and m.removed_at is null) >= 12 then
      raise exception 'Keep a round to 12 dates';
    end if;
    insert into public.selection_round_milestones (round_id, title, due_on, shared, created_by, created_by_name)
    values (p_round_id, v_title, p_due_on, coalesce(p_shared, true), auth.uid(), public.member_display_name(auth.uid()))
    returning id into v_id;
    return v_id;
  end if;

  update public.selection_round_milestones m
  set title = v_title, due_on = p_due_on, shared = coalesce(p_shared, true)
  where m.id = p_id and m.round_id = p_round_id and m.done_at is null and m.removed_at is null
  returning m.id into v_id;
  if v_id is null then
    raise exception 'This date is done or was taken off, so it can’t be changed';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.admin_save_selection_milestone(uuid, uuid, text, date, boolean) from public, anon;
grant execute on function public.admin_save_selection_milestone(uuid, uuid, text, date, boolean) to authenticated;

-- Admins mark a date done, or not done after all. Who and when are kept.
create or replace function public.admin_set_selection_milestone_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection round’s dates';
  end if;
  update public.selection_round_milestones m
  set done_at = case when p_done then coalesce(m.done_at, now()) end,
      done_by = case when p_done then coalesce(m.done_by, auth.uid()) end,
      done_by_name = case when p_done then coalesce(m.done_by_name, public.member_display_name(auth.uid())) end
  where m.id = p_id and m.removed_at is null;
  if not found then
    raise exception 'Date not found';
  end if;
end;
$$;
revoke execute on function public.admin_set_selection_milestone_done(uuid, boolean) from public, anon;
grant execute on function public.admin_set_selection_milestone_done(uuid, boolean) to authenticated;

-- Admins take a date off a round. It stays in the audit report.
create or replace function public.admin_remove_selection_milestone(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection round’s dates';
  end if;
  update public.selection_round_milestones m
  set removed_at = now(), removed_by = auth.uid(), removed_by_name = public.member_display_name(auth.uid())
  where m.id = p_id and m.removed_at is null;
  if not found then
    raise exception 'Date not found';
  end if;
end;
$$;
revoke execute on function public.admin_remove_selection_milestone(uuid) from public, anon;
grant execute on function public.admin_remove_selection_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The panel: dates, reminders and attendance
-- ---------------------------------------------------------------------------

-- A round's dates for its panel, soonest first.
create or replace function public.selection_round_dates(p_round_id uuid)
returns table (id uuid, title text, due_on date, done boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.on_selection_panel(p_round_id) then
    raise exception 'You aren’t on this round’s panel';
  end if;
  return query
  select m.id, m.title, m.due_on, m.done_at is not null
  from public.selection_round_milestones m
  where m.round_id = p_round_id and m.removed_at is null
  order by m.due_on, m.created_at;
end;
$$;
revoke execute on function public.selection_round_dates(uuid) from public, anon;
grant execute on function public.selection_round_dates(uuid) to authenticated;

-- The signed-in member's selection to-dos, for open rounds:
--   'date': a date that isn't done and is due within 7 days or overdue, for
--     the round's panel and for admins (for_admin, who mark it done);
--   'thin': in the last 14 days of a round, how many athletes the member can
--     assess have nothing written about them yet.
-- Nothing for anyone else, and nothing while the feature is off.
create or replace function public.my_selection_todos()
returns table (
  kind text,
  round_id uuid,
  round_name text,
  milestone_id uuid,
  title text,
  due_on date,
  athletes integer,
  for_admin boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with rounds as (
    select r.id, r.name, r.starts_on, r.ends_on, r.team_id,
      public.on_selection_panel(r.id) as on_panel,
      (public.is_admin() and public.selection_assessments_on()) as is_admin
    from public.selection_rounds r
    where r.closed_at is null
  )
  select 'date', r.id, r.name, m.id, m.title, m.due_on, null::int, not r.on_panel
  from rounds r
  join public.selection_round_milestones m on m.round_id = r.id
  where (r.on_panel or r.is_admin)
    and m.removed_at is null and m.done_at is null
    and m.due_on <= public.club_today() + 7
  union all
  select 'thin', r.id, r.name, null::uuid, null::text, r.ends_on, t.athletes, false
  from rounds r
  cross join lateral (
    select count(*)::int as athletes
    from public.team_members a
    where a.team_id = r.team_id and a.team_role = 'athlete'
      and public.can_assess_athlete(r.id, a.profile_id)
      and not exists (
        select 1 from public.assessment_observations o
        where o.round_id = r.id and o.athlete_id = a.profile_id
      )
  ) t
  where r.on_panel
    and public.club_today() between greatest(r.starts_on, r.ends_on - 14) and r.ends_on
    and t.athletes > 0
  order by 6, 3;
$$;
revoke execute on function public.my_selection_todos() from public, anon;
grant execute on function public.my_selection_todos() to authenticated;

-- How many of the group's sessions an athlete was marked at during the
-- round, for the panel: sessions of the round's squad or team, and of a
-- squad's teams, held from the round's first day to its last. Two counts
-- only: no absence, reason or injury.
create or replace function public.athlete_round_attendance(p_round_id uuid, p_athlete_id uuid)
returns table (sessions integer, attended integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  return query
  select count(*)::int, (count(*) filter (where k.present))::int
  from public.selection_rounds r
  join public.attendance_sessions s
    on (s.team_id = r.team_id
        or s.team_id in (select t.id from public.teams t where t.squad_id = r.team_id))
    and public.club_day(s.held_at) between r.starts_on and r.ends_on
  join public.attendance_marks k on k.session_id = s.id and k.profile_id = p_athlete_id
  where r.id = p_round_id;
end;
$$;
revoke execute on function public.athlete_round_attendance(uuid, uuid) from public, anon;
grant execute on function public.athlete_round_attendance(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Athletes and their parents: the criteria and the dates
-- ---------------------------------------------------------------------------

-- The open rounds of the squads and teams the signed-in member plays in,
-- and of those their children under 18 play in (verified parents and
-- guardians only): the round's criteria and the dates an admin shares.
-- No observation, rating or count is here, and nothing about who is on the
-- panel.
create or replace function public.my_selection_info()
returns table (
  round_id uuid,
  round_name text,
  team_name text,
  athlete_id uuid,
  athlete_name text,
  is_me boolean,
  starts_on date,
  ends_on date,
  criteria jsonb,
  dates jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, coalesce(t.name, r.team_name), a.profile_id,
    public.member_display_name(a.profile_id), a.profile_id = auth.uid(),
    r.starts_on, r.ends_on, r.criteria,
    coalesce((
      select jsonb_agg(jsonb_build_object('title', m.title, 'due_on', m.due_on, 'done', m.done_at is not null)
        order by m.due_on, m.created_at)
      from public.selection_round_milestones m
      where m.round_id = r.id and m.removed_at is null and m.shared
    ), '[]'::jsonb)
  from public.selection_rounds r
  join public.team_members a on a.team_id = r.team_id and a.team_role = 'athlete'
  left join public.teams t on t.id = r.team_id
  where r.closed_at is null
    and public.is_approved()
    and public.selection_assessments_on()
    and (a.profile_id = auth.uid() or public.is_verified_guardian_of(a.profile_id))
  order by (a.profile_id <> auth.uid()), 5, r.starts_on;
$$;
revoke execute on function public.my_selection_info() from public, anon;
grant execute on function public.my_selection_info() to authenticated;

commit;
