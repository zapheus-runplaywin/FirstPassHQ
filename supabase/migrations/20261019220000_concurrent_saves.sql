-- Two saves at the same moment (supabase/tests/concurrency.sql).
--
-- Choosing captains: two coaches saving at once could leave the group with a
-- mix of both choices, because each save removes the old captains and adds
-- its own. The save now locks the group, so the second waits for the first
-- and then replaces it.
--
-- Taking attendance and reporting an absence: the same save sent twice (a
-- retry after a dropped connection, or a second tap) made two registers or
-- two absences. A repeat from the same member with the same details now
-- returns the first one instead. Function changes only; no rows change.

begin;

create or replace function public.set_group_captains(
  p_team_id uuid,
  p_captain_id uuid,
  p_vice_captain_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vice uuid[] := coalesce(p_vice_captain_ids, '{}');
  v_all uuid[];
begin
  -- Lock the group so two coaches saving at once take turns; otherwise
  -- the group could keep a mix of both choices.
  perform 1 from public.teams where id = p_team_id and not archived for update;
  if not found then
    raise exception 'Choose a current squad or team';
  end if;
  if not (public.is_admin() or (public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and p.status = 'approved'
  ))) then
    raise exception 'Only admins and this group''s coaches can choose its captains';
  end if;
  if p_captain_id is not null and p_captain_id = any (v_vice) then
    raise exception 'The captain can''t also be a vice captain';
  end if;

  v_all := v_vice || case when p_captain_id is null then '{}'::uuid[] else array[p_captain_id] end;
  if exists (
    select 1 from unnest(v_all) as i(id)
    where not exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id and tm.profile_id = i.id
        and tm.team_role = 'athlete' and p.status = 'approved'
    )
  ) then
    raise exception 'Captains must be athletes in this squad or team';
  end if;

  delete from public.team_captains where team_id = p_team_id;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'vice_captain'::public.captain_role
  from (select distinct unnest(v_vice) as id) i;

  if p_captain_id is not null then
    insert into public.team_captains (team_id, profile_id, captain_role)
    values (p_team_id, p_captain_id, 'captain');
  end if;
end;
$$;

create or replace function public.set_group_captains(
  p_team_id uuid,
  p_captain_ids uuid[],
  p_vice_captain_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captains uuid[] := coalesce(p_captain_ids, '{}');
  v_vice uuid[] := coalesce(p_vice_captain_ids, '{}');
begin
  -- Lock the group so two coaches saving at once take turns; otherwise
  -- the group could keep a mix of both choices.
  perform 1 from public.teams where id = p_team_id and not archived for update;
  if not found then
    raise exception 'Choose a current squad or team';
  end if;
  if not (public.is_admin() or (public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and p.status = 'approved'
  ))) then
    raise exception 'Only admins and this group''s coaches can choose its captains';
  end if;
  if v_captains && v_vice then
    raise exception 'A captain can''t also be a vice captain';
  end if;

  if exists (
    select 1 from unnest(v_captains || v_vice) as i(id)
    where not exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id and tm.profile_id = i.id
        and tm.team_role = 'athlete' and p.status = 'approved'
    )
  ) then
    raise exception 'Captains must be athletes in this squad or team';
  end if;

  delete from public.team_captains where team_id = p_team_id;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'captain'::public.captain_role
  from (select distinct unnest(v_captains) as id) i;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'vice_captain'::public.captain_role
  from (select distinct unnest(v_vice) as id) i;
end;
$$;

create or replace function public.save_attendance(
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
  v_club boolean;
  v_id uuid;
  v_bad int;
begin
  if p_session_id is null then
    v_team_id := p_team_id;
    v_club := p_team_id is null;
  else
    select * into v_session from public.attendance_sessions where id = p_session_id for update;
    if v_session.id is null then
      raise exception 'Attendance record not found';
    end if;
    v_team_id := v_session.team_id;
    v_club := v_session.club_wide;
  end if;

  if p_session_id is null then
    if not (case when v_club then public.is_attendance_taker()
      else public.can_take_attendance(v_team_id) end) then
      raise exception 'You can’t take attendance for this squad or team';
    end if;
  elsif not public.can_edit_attendance_session(p_session_id) then
    raise exception 'Only whoever took this attendance, the group’s coaches and managers, the committee for whole-club sessions, or an admin can change it';
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
      (v_club and public.is_club_athlete((m ->> 'profile_id')::uuid))
      or exists (
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
    raise exception 'Only athletes in this squad, team or club can be marked';
  end if;

  if p_session_id is null then
    -- The same register sent twice (a retry after a dropped connection, or
    -- a second tap) updates the first instead of making a second register.
    perform pg_advisory_xact_lock(hashtext('attendance:' || coalesce(v_team_id::text, 'club')));
    select id into v_id from public.attendance_sessions
    where team_id is not distinct from v_team_id and club_wide = v_club
      and taken_by = auth.uid() and name = trim(p_name) and held_at = p_held_at
    order by created_at limit 1;
  end if;

  if p_session_id is null and v_id is null then
    insert into public.attendance_sessions (
      club_wide, team_id, team_name, name, held_at, taken_by, taken_by_name
    )
    values (
      v_club,
      v_team_id,
      case when v_club then 'Whole club'
        else (select name from public.teams where id = v_team_id) end,
      trim(p_name),
      p_held_at,
      auth.uid(),
      (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid())
    )
    returning id into v_id;
  elsif p_session_id is not null then
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
  -- The same absence sent twice (a retry after a dropped connection, or a
  -- second tap) is kept once.
  perform pg_advisory_xact_lock(hashtext('absence:' || p_athlete_id::text));
  select id into v_id from public.attendance_absences
  where athlete_id = p_athlete_id and from_day = p_from and to_day = p_to
    and category_id is not distinct from p_category_id and reason is not distinct from v_reason
    and reported_by = auth.uid() and withdrawn_at is null
  order by created_at limit 1;
  if v_id is not null then
    return v_id;
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

commit;
