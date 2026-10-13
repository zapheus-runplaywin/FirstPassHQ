-- Child safety finding 12: families see attendance and report absences.
--
-- An athlete and their parents or guardians (until the athlete turns 18) can
-- see the athlete's own attendance: each session, and whether they were
-- marked present or absent. They can't see anyone else on the register.
-- Either can tell the club in advance, or soon after, that the athlete will
-- be or was away. Coaches and managers see reported absences when they take
-- attendance and on the Attendance page, so an unexplained absence stands out.
--
-- Additive only: a new table and new functions. athlete_attendance is
-- replaced with the same columns and one more rule for who can read it, and
-- purge_expired_records also removes absences older than the attendance
-- keep period (only while "Remove old records" is on).

begin;

create table if not exists public.attendance_absences (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  from_day date not null,
  to_day date not null,
  reason text check (reason is null or length(reason) <= 200),
  reported_by uuid references public.profiles (id) on delete set null,
  reported_by_name text,
  -- 'athlete' or 'guardian', as they were when it was reported.
  reported_as text not null check (reported_as in ('athlete', 'guardian')),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles (id) on delete set null,
  constraint attendance_absences_days check (to_day >= from_day)
);

create index if not exists attendance_absences_athlete
  on public.attendance_absences (athlete_id, from_day desc);
create index if not exists attendance_absences_days
  on public.attendance_absences (to_day, from_day);

alter table public.attendance_absences enable row level security;
-- Read and written only through the functions below.
revoke all on public.attendance_absences from public, anon, authenticated;

-- The athlete themselves, or their parent or guardian while they're under 18.
create or replace function public.is_athlete_or_guardian(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and p_athlete_id is not null
    and (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id));
$$;

revoke execute on function public.is_athlete_or_guardian(uuid) from public, anon;
grant execute on function public.is_athlete_or_guardian(uuid) to authenticated;

-- One athlete's sessions since a date. As before for coaches, the committee
-- and admins, and now also for the athlete and their parents or guardians.
create or replace function public.athlete_attendance(p_profile_id uuid, p_since date)
returns table (
  session_id uuid,
  team_name text,
  name text,
  held_at timestamptz,
  present boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.team_name, s.name, s.held_at, m.present
  from public.attendance_marks m
  join public.attendance_sessions s on s.id = m.session_id
  where m.profile_id = p_profile_id
    and s.held_at >= p_since
    and (
      public.is_committee()
      or (s.team_id is not null and public.can_view_team_attendance(s.team_id))
      -- Coaches see club events for the athletes they coach.
      or (s.club_wide and public.coaches_athlete(m.profile_id))
      or public.is_athlete_or_guardian(m.profile_id)
    )
  order by s.held_at desc;
$$;

revoke execute on function public.athlete_attendance(uuid, date) from public, anon;
grant execute on function public.athlete_attendance(uuid, date) to authenticated;

-- The athlete or a parent or guardian tells the club the athlete will be, or
-- was, away. Up to 14 days back, up to 12 months ahead, for up to 3 months.
create or replace function public.report_absence(
  p_athlete_id uuid,
  p_from date,
  p_to date,
  p_reason text default null
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
    raise exception 'Keep the reason under 200 characters';
  end if;
  insert into public.attendance_absences (
    athlete_id, from_day, to_day, reason, reported_by, reported_by_name, reported_as
  )
  values (
    p_athlete_id, p_from, p_to, v_reason, auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    case when p_athlete_id = auth.uid() then 'athlete' else 'guardian' end
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.report_absence(uuid, date, date, text) from public, anon;
grant execute on function public.report_absence(uuid, date, date, text) to authenticated;

-- The athlete or a parent or guardian takes an absence back, for example
-- when plans change. It's kept, marked as withdrawn.
create or replace function public.withdraw_absence(p_absence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete uuid;
begin
  select athlete_id into v_athlete
  from public.attendance_absences
  where id = p_absence_id and withdrawn_at is null;
  if v_athlete is null or not public.is_athlete_or_guardian(v_athlete) then
    raise exception 'Absence not found';
  end if;
  update public.attendance_absences
  set withdrawn_at = now(), withdrawn_by = auth.uid()
  where id = p_absence_id;
end;
$$;

revoke execute on function public.withdraw_absence(uuid) from public, anon;
grant execute on function public.withdraw_absence(uuid) to authenticated;

-- An athlete's absences in the last 12 months and ahead, newest first, for
-- the athlete and their parents or guardians.
create or replace function public.my_absences(p_athlete_id uuid)
returns table (
  id uuid,
  from_day date,
  to_day date,
  reason text,
  reported_by_name text,
  reported_as text,
  created_at timestamptz,
  withdrawn_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.from_day, a.to_day, a.reason, a.reported_by_name, a.reported_as,
    a.created_at, a.withdrawn_at
  from public.attendance_absences a
  where a.athlete_id = p_athlete_id
    and public.is_athlete_or_guardian(p_athlete_id)
    and a.to_day >= current_date - 365
  order by a.from_day desc, a.created_at desc;
$$;

revoke execute on function public.my_absences(uuid) from public, anon;
grant execute on function public.my_absences(uuid) to authenticated;

-- Whether the signed-in member takes or sees attendance for a group this
-- athlete is in, or is on the committee. They see the athlete's absences.
create or replace function public.can_see_absences_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_committee()
    or exists (
      select 1 from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.profile_id = p_athlete_id
        and tm.team_role = 'athlete'
        and not t.archived
        and (public.leads_group(tm.team_id) or public.can_view_team_attendance(tm.team_id))
    );
$$;

revoke execute on function public.can_see_absences_of(uuid) from public, anon, authenticated;

-- Reported absences covering a day, for the athletes on a squad or team's
-- register (or every athlete, for a club event, p_team_id null). For
-- whoever can take or see that group's attendance.
create or replace function public.absences_on(p_team_id uuid, p_day date)
returns table (
  profile_id uuid,
  reason text,
  from_day date,
  to_day date,
  reported_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (a.athlete_id) a.athlete_id, a.reason, a.from_day, a.to_day, a.reported_by_name
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

-- Absences from today for the next 4 weeks, for the athletes the signed-in
-- member coaches or manages (everyone, for the committee and admins).
create or replace function public.upcoming_absences()
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  from_day date,
  to_day date,
  reason text,
  reported_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.athlete_id, coalesce(public.member_display_name(a.athlete_id), 'Athlete'),
    a.from_day, a.to_day, a.reason, a.reported_by_name
  from public.attendance_absences a
  where a.withdrawn_at is null
    and a.to_day >= current_date
    and a.from_day <= current_date + 28
    and public.can_see_absences_of(a.athlete_id)
  order by a.from_day, 3;
$$;

revoke execute on function public.upcoming_absences() from public, anon;
grant execute on function public.upcoming_absences() to authenticated;

-- As in 20261013100000_record_retention.sql, and absences go with
-- attendance, counted from their last day.
create or replace function public.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_check_ins int := 0;
  v_goals int := 0;
  v_team_goals int := 0;
  v_messages int := 0;
  v_attendance int := 0;
  v_absences int := 0;
  v_certificates int := 0;
  v_access int := 0;
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;

  delete from public.check_ins
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date;
  get diagnostics v_check_ins = row_count;

  -- Goals, reflections and their comments go together, counted from the game.
  delete from public.game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_goals = row_count;
  delete from public.team_game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_team_goals = row_count;

  -- The message stays with who sent it, who it went to and who read it; only
  -- the text is replaced.
  update public.messages
  set body = 'This message was removed after the club''s keep period.', body_removed_at = now()
  where body_removed_at is null
    and created_at < now() - make_interval(months => s.retention_messages_months);
  get diagnostics v_messages = row_count;

  delete from public.attendance_sessions
  where held_at < now() - make_interval(months => s.retention_attendance_months);
  get diagnostics v_attendance = row_count;

  delete from public.attendance_absences
  where to_day < (current_date - make_interval(months => s.retention_attendance_months))::date;
  get diagnostics v_absences = row_count;

  delete from public.training_certificates c
  where c.created_at < now() - make_interval(months => s.retention_certificates_months)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'training-certificates' and o.name = c.document_path
    );
  get diagnostics v_certificates = row_count;

  delete from public.record_access_log
  where created_at < now() - make_interval(months => s.retention_access_log_months);
  get diagnostics v_access = row_count;

  return jsonb_build_object(
    'enabled', true,
    'check_ins', v_check_ins,
    'game_goals', v_goals,
    'team_goals', v_team_goals,
    'messages', v_messages,
    'attendance_sessions', v_attendance,
    'absences', v_absences,
    'certificates', v_certificates,
    'record_views', v_access
  );
end;
$$;

revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
