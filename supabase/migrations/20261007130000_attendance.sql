-- Attendance.
--
-- Coaches and managers take attendance for a squad or team they lead: they
-- name the session (often from the calendar) and mark each athlete present or
-- absent. Admins can too. Coaches, the committee and admins can see athletes'
-- attendance records; managers see the sessions for the squads and teams they
-- manage, so they can check and correct them.
--
-- Additive only: two new tables and new functions.

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Kept if the squad or team is removed, with its name as it was.
  team_id uuid references public.teams (id) on delete set null,
  team_name text not null,
  name text not null check (length(name) between 1 and 100),
  -- When the session was held: the calendar event's start, or when it was taken.
  held_at timestamptz not null default now(),
  -- Kept when the person leaves, with their name as it was.
  taken_by uuid references public.profiles (id) on delete set null,
  taken_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attendance_sessions_team_idx on public.attendance_sessions (team_id, held_at desc);
create index attendance_sessions_held_at_idx on public.attendance_sessions (held_at desc);

create trigger attendance_sessions_touch_updated_at
  before update on public.attendance_sessions
  for each row execute function public.touch_updated_at();

create table public.attendance_marks (
  session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  present boolean not null,
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (session_id, profile_id)
);

create index attendance_marks_profile_idx on public.attendance_marks (profile_id);

-- Written only through save_attendance().
alter table public.attendance_sessions enable row level security;
alter table public.attendance_marks enable row level security;

-- ---------------------------------------------------------------------------
-- Who can see and do what
-- ---------------------------------------------------------------------------

-- The signed-in member coaches or manages this squad or team, or is an admin.
create function public.can_take_attendance(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (
    public.is_approved() and exists (
      select 1
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.team_id = p_team_id
        and tm.profile_id = auth.uid()
        and tm.team_role in ('coach', 'manager')
        and not t.archived
    )
  );
$$;

-- The signed-in member coaches this squad or team (any season), or is on the
-- committee (which includes admins).
create function public.can_view_team_attendance(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_committee() or (
    public.is_approved() and exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and team_role = 'coach'
    )
  );
$$;

-- Sessions are visible to whoever can take or view attendance for the group.
create function public.can_see_attendance_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_sessions s
    where s.id = p_session_id
      and (
        public.is_committee()
        or (s.team_id is not null
          and (public.can_view_team_attendance(s.team_id) or public.can_take_attendance(s.team_id)))
      )
  );
$$;

revoke execute on function public.can_take_attendance(uuid) from public, anon;
revoke execute on function public.can_view_team_attendance(uuid) from public, anon;
revoke execute on function public.can_see_attendance_session(uuid) from public, anon;
grant execute on function public.can_take_attendance(uuid) to authenticated;
grant execute on function public.can_view_team_attendance(uuid) to authenticated;
grant execute on function public.can_see_attendance_session(uuid) to authenticated;

create policy "Coaches, managers and the committee see attendance sessions"
  on public.attendance_sessions for select to authenticated
  using (public.can_see_attendance_session(id));

create policy "Coaches, managers and the committee see attendance marks"
  on public.attendance_marks for select to authenticated
  using (public.can_see_attendance_session(session_id));

-- ---------------------------------------------------------------------------
-- Taking attendance
-- ---------------------------------------------------------------------------

-- Sessions for the same squad or team within 3 hours of a time, so the app can
-- warn before a second record is started for what is probably one session.
create function public.nearby_attendance_sessions(
  p_team_id uuid,
  p_held_at timestamptz,
  p_exclude_session_id uuid default null
)
returns table (id uuid, name text, held_at timestamptz, taken_by_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.held_at, s.taken_by_name
  from public.attendance_sessions s
  where s.team_id = p_team_id
    and s.held_at between p_held_at - interval '3 hours' and p_held_at + interval '3 hours'
    and s.id is distinct from p_exclude_session_id
    and (public.can_take_attendance(p_team_id) or public.can_view_team_attendance(p_team_id))
  order by abs(extract(epoch from s.held_at - p_held_at));
$$;

revoke execute on function public.nearby_attendance_sessions(uuid, timestamptz, uuid)
  from public, anon;
grant execute on function public.nearby_attendance_sessions(uuid, timestamptz, uuid)
  to authenticated;

-- Creates a session (p_session_id null) or updates one, with its marks.
-- p_marks is [{"profile_id": "...", "present": true}, ...]. Only athletes in
-- the squad or team, or already on the record, can be marked.
create function public.save_attendance(
  p_session_id uuid,
  p_team_id uuid,
  p_name text,
  p_held_at timestamptz,
  p_marks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.attendance_sessions;
  v_team_id uuid;
  v_id uuid;
  v_bad int;
begin
  if p_session_id is null then
    v_team_id := p_team_id;
  else
    select * into v_session from public.attendance_sessions where id = p_session_id for update;
    if v_session.id is null then
      raise exception 'Attendance record not found';
    end if;
    v_team_id := v_session.team_id;
  end if;

  if v_team_id is null or not public.can_take_attendance(v_team_id) then
    raise exception 'Only coaches and managers of this squad or team can take attendance';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name the session, for example Tuesday training';
  end if;
  if p_held_at is null or p_held_at > now() + interval '1 day' then
    raise exception 'Attendance can’t be taken for a session that hasn’t happened yet';
  end if;
  if jsonb_typeof(p_marks) <> 'array' then
    raise exception 'Mark each athlete present or absent';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_marks) m
  where jsonb_typeof(m -> 'present') <> 'boolean'
    or not (
      exists (
        select 1 from public.team_members tm
        where tm.team_id = v_team_id
          and tm.team_role = 'athlete'
          and tm.profile_id = (m ->> 'profile_id')::uuid
      )
      or exists (
        select 1 from public.attendance_marks am
        where am.session_id = p_session_id and am.profile_id = (m ->> 'profile_id')::uuid
      )
    );
  if v_bad > 0 then
    raise exception 'Only athletes in this squad or team can be marked';
  end if;

  if p_session_id is null then
    insert into public.attendance_sessions (team_id, team_name, name, held_at, taken_by, taken_by_name)
    select t.id, t.name, trim(p_name), p_held_at, auth.uid(),
      (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid())
    from public.teams t
    where t.id = v_team_id
    returning id into v_id;
  else
    v_id := p_session_id;
    update public.attendance_sessions
    set name = trim(p_name), held_at = p_held_at
    where id = v_id;
  end if;

  insert into public.attendance_marks (session_id, profile_id, present, marked_by)
  select v_id, (m ->> 'profile_id')::uuid, (m ->> 'present')::boolean, auth.uid()
  from jsonb_array_elements(p_marks) m
  on conflict (session_id, profile_id) do update
    set present = excluded.present,
        marked_by = excluded.marked_by,
        marked_at = now()
    where public.attendance_marks.present is distinct from excluded.present;

  return v_id;
end;
$$;

revoke execute on function public.save_attendance(uuid, uuid, text, timestamptz, jsonb)
  from public, anon;
grant execute on function public.save_attendance(uuid, uuid, text, timestamptz, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reading attendance
-- ---------------------------------------------------------------------------

-- Recent sessions the member can see, with counts. Optionally for one group.
create function public.attendance_sessions_list(p_team_id uuid default null)
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  name text,
  held_at timestamptz,
  taken_by_name text,
  present_count int,
  marked_count int,
  can_edit boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id, s.team_id, s.team_name, s.name, s.held_at, s.taken_by_name,
    (select count(*)::int from public.attendance_marks m where m.session_id = s.id and m.present),
    (select count(*)::int from public.attendance_marks m where m.session_id = s.id),
    s.team_id is not null and public.can_take_attendance(s.team_id)
  from public.attendance_sessions s
  where public.can_see_attendance_session(s.id)
    and (p_team_id is null or s.team_id = p_team_id)
  order by s.held_at desc
  limit 200;
$$;

revoke execute on function public.attendance_sessions_list(uuid) from public, anon;
grant execute on function public.attendance_sessions_list(uuid) to authenticated;

-- Everyone on a session's register: the marks saved, plus athletes now in the
-- squad or team who weren't marked (present is null for them).
create function public.attendance_register(p_session_id uuid)
returns table (profile_id uuid, full_name text, present boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.attendance_sessions
    where id = p_session_id and public.can_see_attendance_session(p_session_id)
  ),
  people as (
    select m.profile_id, m.present from public.attendance_marks m
    where m.session_id = (select id from s)
    union all
    select tm.profile_id, null::boolean
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = (select team_id from s)
      and tm.team_role = 'athlete'
      and p.status = 'approved'
      and not exists (
        select 1 from public.attendance_marks m
        where m.session_id = (select id from s) and m.profile_id = tm.profile_id
      )
  )
  select people.profile_id, coalesce(nullif(p.full_name, ''), p.email), people.present
  from people
  join public.profiles p on p.id = people.profile_id
  order by p.full_name;
$$;

revoke execute on function public.attendance_register(uuid) from public, anon;
grant execute on function public.attendance_register(uuid) to authenticated;

-- Each athlete's attendance since a date: sessions they were marked at and how
-- many they were present for. For coaches (their squads and teams), the
-- committee and admins (everyone). Optionally for one squad or team.
create function public.athlete_attendance_summary(p_since date, p_team_id uuid default null)
returns table (
  profile_id uuid,
  full_name text,
  session_count int,
  present_count int,
  last_present_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.profile_id,
    coalesce(nullif(p.full_name, ''), p.email),
    count(*)::int,
    count(*) filter (where m.present)::int,
    max(s.held_at) filter (where m.present)
  from public.attendance_marks m
  join public.attendance_sessions s on s.id = m.session_id
  join public.profiles p on p.id = m.profile_id
  where s.held_at >= p_since
    and (p_team_id is null or s.team_id = p_team_id)
    and (public.is_committee() or (s.team_id is not null and public.can_view_team_attendance(s.team_id)))
  group by m.profile_id, p.full_name, p.email
  order by p.full_name;
$$;

revoke execute on function public.athlete_attendance_summary(date, uuid) from public, anon;
grant execute on function public.athlete_attendance_summary(date, uuid) to authenticated;

-- One athlete's sessions since a date, for coaches, the committee and admins.
create function public.athlete_attendance(p_profile_id uuid, p_since date)
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
    and (public.is_committee() or (s.team_id is not null and public.can_view_team_attendance(s.team_id)))
  order by s.held_at desc;
$$;

revoke execute on function public.athlete_attendance(uuid, date) from public, anon;
grant execute on function public.athlete_attendance(uuid, date) to authenticated;
