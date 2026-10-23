-- Injury records, customer review concerns C3 to C6 (Matt's decisions of
-- 22 October 2026):
--
-- 1. C3: physios write the record. A physio who looks after the athlete and
--    can see their injuries (the consent rules are unchanged) adds physio
--    updates and documents directly; the history marks them as the
--    physio's. A coach, manager or physio of one of the athlete's current
--    squads or teams can log an injury at the time it happens. The athlete
--    and their parents and guardians get a to-do to look at it, and the
--    parents' What's changed list says who logged it. Logging an injury
--    gives nobody new access: a manager still doesn't see injuries, and a
--    coach or physio still needs a parent's consent for an under 18.
-- 2. C4: a concussion pathway. An injury can be marked as a suspected
--    concussion. Its clearance can't be asked for until the club's minimum
--    days after the injury (21, or 12 for a club that runs an elite
--    program), needs a doctor's clearance, and only a physio can endorse
--    it. Anyone who can add to the record can mark it; only a physio can
--    say it isn't a concussion after all.
-- 3. C5: a club switch, off to start, "Only physios endorse clearances",
--    for every injury.
-- 4. C6: committee members see an under 18's injuries, and accept or send
--    back their clearances, only when they're screened: a current Working
--    With Children Check or a parent volunteer exemption. A committee
--    member exempted because they don't work with children no longer sees
--    them. Admins are unchanged (they keep the access they had, as decided
--    on 12 October), and so are adults' injuries.
--
-- Additive: new columns with defaults, one new table reached only through
-- functions, new and replaced functions. Four functions are dropped and
-- made again with one more argument, which has a default, so older app
-- builds still call them the same way. No rows are changed or removed.

begin;

-- ---------------------------------------------------------------------------
-- Columns and settings
-- ---------------------------------------------------------------------------

alter table public.injuries
  add column if not exists concussion boolean not null default false;
-- Set when a coach, manager or physio logged the injury for the athlete.
alter table public.injuries
  add column if not exists logged_by_role text
    check (logged_by_role in ('coach', 'manager', 'physio'));

-- Who wrote an update, when it wasn't the athlete or a guardian.
alter table public.injury_updates
  add column if not exists author_role text
    check (author_role in ('coach', 'manager', 'physio'));
-- The update marked (true) or unmarked (false) the injury as a concussion.
alter table public.injury_updates
  add column if not exists concussion boolean;
-- The proof sent with a clearance request was confirmed as a doctor's.
alter table public.injury_updates
  add column if not exists doctor_clearance boolean not null default false;

alter table public.safeguarding_settings
  add column if not exists physio_only_endorsement boolean not null default false;
alter table public.safeguarding_settings
  add column if not exists concussion_min_days integer not null default 21
    check (concussion_min_days in (12, 21));

-- Who has looked at an injury someone else logged for them or their child.
create table if not exists public.injury_log_seen (
  injury_id uuid not null references public.injuries (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (injury_id, member_id)
);
alter table public.injury_log_seen enable row level security;
-- Reached only through the functions below.
revoke all on public.injury_log_seen from public, anon, authenticated;
grant all on public.injury_log_seen to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A manager of a current squad or team the athlete is in, on the same terms
-- as coaches_athlete: not stood down, screened, and not a squad whose
-- selections are complete.
create or replace function public.manages_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members manager
    join public.team_members athlete
      on athlete.team_id = manager.team_id and athlete.profile_id = p_athlete_id
    join public.teams t on t.id = manager.team_id
    where manager.profile_id = auth.uid()
      and manager.team_role = 'manager'
      and athlete.team_role = 'athlete'
      and not t.archived
      and t.selections_completed_at is null
  ) and public.has_role('manager') and public.can_work_with_children();
$$;
revoke execute on function public.manages_athlete(uuid) from public, anon, authenticated;

-- A physio who can add to this athlete's record: they look after the
-- athlete and can already see their injuries.
create or replace function public.physio_writes_for(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_athlete_id <> auth.uid()
    and public.physio_looks_after(p_athlete_id)
    and public.can_view_injury_details(p_athlete_id);
$$;
revoke execute on function public.physio_writes_for(uuid) from public, anon, authenticated;

-- Whoever can add updates and documents: the athlete, their guardians, or a
-- physio who looks after them.
create or replace function public.can_add_injury_update(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_report_for(p_athlete_id) or public.physio_writes_for(p_athlete_id);
$$;
revoke execute on function public.can_add_injury_update(uuid) from public, anon, authenticated;

-- The role a member logs an injury for this athlete in, or null when they
-- can't: a physio who looks after them, or a coach or manager of one of
-- their current squads or teams. Not for their own injuries.
create or replace function public.injury_logger_role(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_approved() or p_athlete_id = auth.uid() then null
    when not exists (
      select 1 from public.profiles
      where id = p_athlete_id and status = 'approved'
        and (role = 'athlete' or 'athlete' = any (extra_roles))
    ) then null
    when public.physio_looks_after(p_athlete_id) then 'physio'
    when public.coaches_athlete(p_athlete_id) then 'coach'
    when public.manages_athlete(p_athlete_id) then 'manager'
  end;
$$;
revoke execute on function public.injury_logger_role(uuid) from public, anon, authenticated;

-- Whether the signed-in member sees this athlete's injuries as committee:
-- admins always; committee members for adults, and for under 18s only when
-- screened (a current check or a parent volunteer exemption).
create or replace function public.committee_sees_injuries_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin')
    or (public.has_role('committee')
      and (not public.athlete_is_minor(p_athlete_id) or public.is_cleared(auth.uid())));
$$;
revoke execute on function public.committee_sees_injuries_of(uuid) from public, anon, authenticated;

-- Whether only a physio may endorse this injury's clearance.
create or replace function public.endorsement_needs_physio(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_injury.concussion
    or coalesce((select s.physio_only_endorsement from public.safeguarding_settings s where s.id), false);
$$;
revoke execute on function public.endorsement_needs_physio(public.injuries) from public, anon, authenticated;

-- The first day a clearance can be asked for after a concussion.
create or replace function public.earliest_concussion_clearance(p_injury public.injuries)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_injury.concussion then
    p_injury.injured_on
      + coalesce((select s.concussion_min_days from public.safeguarding_settings s where s.id), 21)
  end;
$$;
revoke execute on function public.earliest_concussion_clearance(public.injuries) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. C6: who sees and signs off as committee
-- ---------------------------------------------------------------------------

create or replace function public.can_view_athlete_injuries(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or public.coaches_athlete(p_athlete_id)
    or public.committee_sees_injuries_of(p_athlete_id)
    -- Physios see current athletes they look after; records kept after
    -- someone leaves stay with the committee and admins.
    or public.physio_looks_after(p_athlete_id)
  );
$$;

create or replace function public.can_share_injury_documents(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.committee_sees_injuries_of(p_injury.athlete_id)
    and p_injury.status = 'coach_endorsed'
    and p_injury.coach_endorsed_by is distinct from auth.uid()
    and p_injury.athlete_id <> auth.uid()
    and not public.is_guardian_of(p_injury.athlete_id);
$$;
revoke execute on function public.can_share_injury_documents(public.injuries)
  from public, anon, authenticated;

create or replace function public.accept_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.is_committee() then
    raise exception 'Only the committee can accept clearance';
  end if;
  if v_injury.status <> 'coach_endorsed' then
    raise exception 'A coach or physio needs to endorse this first';
  end if;
  if not public.committee_sees_injuries_of(v_injury.athlete_id) then
    raise exception 'Only a committee member with a current Working With Children Check or a parent volunteer exemption can accept an under 18’s clearance';
  end if;
  if v_injury.coach_endorsed_by = auth.uid() or v_injury.athlete_id = auth.uid() then
    raise exception 'Someone other than the person who endorsed it needs to accept this';
  end if;
  if public.is_guardian_of(v_injury.athlete_id) then
    raise exception 'You can’t accept your own child’s clearance. Ask another committee member.';
  end if;
  if not public.can_view_injury_details(v_injury.athlete_id) then
    raise exception 'A parent or guardian needs to give consent before you can see this injury';
  end if;

  update public.injuries
  set status = 'cleared', cleared_by = auth.uid(), cleared_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'cleared', nullif(trim(p_notes), '')
  );
end;
$$;

create or replace function public.send_back_clearance(p_injury_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null then
    raise exception 'Injury not found';
  end if;
  if not (
    (v_injury.status = 'clearance_requested'
      and (public.coaches_athlete(v_injury.athlete_id)
        or public.committee_sees_injuries_of(v_injury.athlete_id)
        or public.physio_looks_after(v_injury.athlete_id)))
    or (v_injury.status = 'coach_endorsed' and public.committee_sees_injuries_of(v_injury.athlete_id))
  ) then
    raise exception 'You can’t send this back';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t send back your own clearance';
  end if;
  if not public.has_child_consent(v_injury.athlete_id, 'health') then
    raise exception 'A parent or guardian needs to give consent before you can see this injury';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Say why it’s being sent back';
  end if;

  update public.injuries
  set status = 'injured', coach_endorsed_by = null, coach_endorsed_at = null
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (p_injury_id, auth.uid(), public.my_display_name(), 'sent_back', trim(p_notes));
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. C3: reporting, logging and physio updates
-- ---------------------------------------------------------------------------

-- As before, plus whether it's a suspected concussion.
drop function if exists public.report_injury(uuid, text, text, date, text, date);
create or replace function public.report_injury(
  p_athlete_id uuid,
  p_body_area text,
  p_description text,
  p_injured_on date,
  p_restrictions text default null,
  p_expected_return date default null,
  p_concussion boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.can_report_for(p_athlete_id) then
    raise exception 'Only athletes and their guardians can report injuries';
  end if;
  if coalesce(trim(p_body_area), '') = '' or coalesce(trim(p_description), '') = '' then
    raise exception 'Say where the injury is and what happened';
  end if;
  if p_injured_on is null or p_injured_on > current_date then
    raise exception 'Choose the day it happened';
  end if;

  insert into public.injuries (
    athlete_id, reported_by, body_area, description, injured_on, restrictions, expected_return,
    concussion
  )
  values (
    p_athlete_id, auth.uid(), trim(p_body_area), trim(p_description), p_injured_on,
    nullif(trim(p_restrictions), ''), p_expected_return, coalesce(p_concussion, false)
  )
  returning id into v_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, restrictions, expected_return, concussion
  )
  values (
    v_id, auth.uid(), public.my_display_name(), 'reported', trim(p_description),
    nullif(trim(p_restrictions), ''), p_expected_return,
    case when coalesce(p_concussion, false) then true end
  );
  return v_id;
end;
$$;
revoke execute on function public.report_injury(uuid, text, text, date, text, date, boolean)
  from public, anon;
grant execute on function public.report_injury(uuid, text, text, date, text, date, boolean)
  to authenticated;

-- A coach, manager or physio logs an injury for an athlete at the time it
-- happens. It's the athlete's record from then on, as if they'd reported
-- it; the athlete and their guardians get a to-do to look at it. Returns
-- the injury, which the person who logged it may not be able to open.
create or replace function public.log_injury(
  p_athlete_id uuid,
  p_body_area text,
  p_description text,
  p_injured_on date,
  p_restrictions text default null,
  p_expected_return date default null,
  p_concussion boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.injury_logger_role(p_athlete_id);
  v_id uuid;
begin
  if v_role is null then
    raise exception 'Only the athlete’s coaches, managers and physios can log an injury for them';
  end if;
  if coalesce(trim(p_body_area), '') = '' or coalesce(trim(p_description), '') = '' then
    raise exception 'Say where the injury is and what happened';
  end if;
  if p_injured_on is null or p_injured_on > current_date then
    raise exception 'Choose the day it happened';
  end if;

  insert into public.injuries (
    athlete_id, reported_by, body_area, description, injured_on, restrictions, expected_return,
    concussion, logged_by_role, athlete_name
  )
  values (
    p_athlete_id, auth.uid(), trim(p_body_area), trim(p_description), p_injured_on,
    nullif(trim(p_restrictions), ''), p_expected_return, coalesce(p_concussion, false), v_role,
    public.member_display_name(p_athlete_id)
  )
  returning id into v_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, author_role, kind, notes, restrictions, expected_return,
    concussion
  )
  values (
    v_id, auth.uid(), public.my_display_name(), v_role, 'reported', trim(p_description),
    nullif(trim(p_restrictions), ''), p_expected_return,
    case when coalesce(p_concussion, false) then true end
  );
  return v_id;
end;
$$;
revoke execute on function public.log_injury(uuid, text, text, date, text, date, boolean)
  from public, anon;
grant execute on function public.log_injury(uuid, text, text, date, text, date, boolean)
  to authenticated;

-- The athletes the signed-in member can log an injury for, by name.
create or replace function public.injury_loggable_athletes()
returns table (athlete_id uuid, athlete_name text, logged_as text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email), public.injury_logger_role(p.id)
  from public.profiles p
  where p.id in (
      select a.profile_id from public.team_members me
      join public.team_members a on a.team_id = me.team_id and a.team_role = 'athlete'
      where me.profile_id = auth.uid() and me.team_role in ('coach', 'manager', 'physio')
    )
    or (public.is_head_physio() and (p.role = 'athlete' or 'athlete' = any (p.extra_roles)))
  group by p.id
  having public.injury_logger_role(p.id) is not null
  order by 2;
$$;
revoke execute on function public.injury_loggable_athletes() from public, anon;
grant execute on function public.injury_loggable_athletes() to authenticated;

-- A physio update, now also from the physio themselves. Restrictions and
-- the expected return date replace the injury's current ones. p_concussion
-- marks (true) or unmarks (false) a suspected concussion; null leaves it.
drop function if exists public.add_injury_update(uuid, text, text, date, text, text);
create or replace function public.add_injury_update(
  p_injury_id uuid,
  p_notes text,
  p_restrictions text default null,
  p_expected_return date default null,
  p_document_path text default null,
  p_document_name text default null,
  p_concussion boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
  v_physio boolean;
  v_concussion boolean;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.can_add_injury_update(v_injury.athlete_id) then
    raise exception 'Only the athlete, their guardians and their physios can add physio updates';
  end if;
  if v_injury.status <> 'injured' then
    raise exception 'This injury is waiting for sign-off, so it can’t be updated now';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Write what the physio said';
  end if;
  v_physio := public.physio_writes_for(v_injury.athlete_id);
  if p_concussion is not null and p_concussion is distinct from v_injury.concussion then
    v_concussion := p_concussion;
  end if;
  if v_concussion = false and not v_physio then
    raise exception 'Only a physio can say it isn’t a concussion';
  end if;
  perform public.check_injury_document(v_injury, p_document_path);

  update public.injuries
  set restrictions = nullif(trim(p_restrictions), ''),
      expected_return = p_expected_return,
      concussion = coalesce(v_concussion, concussion)
  where id = p_injury_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, author_role, kind, notes, restrictions, expected_return,
    document_path, document_name, concussion
  )
  values (
    p_injury_id, auth.uid(), public.my_display_name(),
    case when v_physio and not public.can_report_for(v_injury.athlete_id) then 'physio' end,
    'physio_update', trim(p_notes),
    nullif(trim(p_restrictions), ''), p_expected_return,
    p_document_path, case when p_document_path is null then null else p_document_name end,
    v_concussion
  );
end;
$$;
revoke execute on function public.add_injury_update(uuid, text, text, date, text, text, boolean)
  from public, anon;
grant execute on function public.add_injury_update(uuid, text, text, date, text, text, boolean)
  to authenticated;

-- Documents: a physio who can add updates can attach them too.
create or replace function public.can_upload_injury_document(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_name);
begin
  return v_injury.id is not null
    and v_injury.status <> 'cleared'
    and public.can_add_injury_update(v_injury.athlete_id)
    and public.injury_document_allowed(v_injury.athlete_id, p_name);
end;
$$;

-- As before; a physio attaches as an adult would for an adult athlete, and
-- only a photo of the letter or report for an under 18.
create or replace function public.injury_document_rule(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.athlete_is_minor(p_athlete_id) then 'photos'
    when public.minor_injury_photos_allowed() and public.is_verified_guardian_of(p_athlete_id)
      then 'consent'
    else 'letter'
  end
  where public.can_add_injury_update(p_athlete_id);
$$;

create or replace function public.confirm_injury_photo(p_path text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_path);
  v_rule text;
begin
  if v_injury.id is null or v_injury.status = 'cleared' then
    raise exception 'That injury isn’t open for documents';
  end if;
  v_rule := public.injury_document_rule(v_injury.athlete_id);
  if v_rule is null then
    raise exception 'Only the athlete, their guardians and their physios can add documents';
  end if;
  if p_kind = 'injury' and v_rule is distinct from 'consent' then
    raise exception 'Attach a photo of the letter or report, not of the injury';
  end if;
  if p_kind not in ('letter', 'injury') then
    raise exception 'Say what the photo shows';
  end if;
  insert into public.injury_photo_declarations (
    injury_id, document_path, kind, declared_by, declared_by_name, declared_by_role
  )
  values (
    v_injury.id, p_path, p_kind, auth.uid(), public.my_display_name(),
    case
      when v_injury.athlete_id = auth.uid() then 'Athlete'
      when public.is_guardian_of(v_injury.athlete_id) then 'Parent or guardian'
      else 'Physio'
    end
  )
  on conflict (document_path) do nothing;
end;
$$;

-- Injuries someone else logged that the signed-in athlete or guardian
-- hasn't looked at yet, for their to-do list.
create or replace function public.my_logged_injuries()
returns table (
  injury_id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text,
  logged_by_name text,
  logged_by_role text,
  logged_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.athlete_id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    i.body_area, u.author_name, i.logged_by_role, i.created_at
  from public.injuries i
  join public.profiles p on p.id = i.athlete_id
  left join lateral (
    select x.author_name from public.injury_updates x
    where x.injury_id = i.id and x.kind = 'reported'
    order by x.created_at limit 1
  ) u on true
  where i.logged_by_role is not null
    and i.athlete_left_at is null
    and i.reported_by is distinct from auth.uid()
    and public.can_report_for(i.athlete_id)
    and not exists (
      select 1 from public.injury_log_seen s
      where s.injury_id = i.id and s.member_id = auth.uid()
    )
  order by i.created_at desc;
$$;
revoke execute on function public.my_logged_injuries() from public, anon;
grant execute on function public.my_logged_injuries() to authenticated;

-- The athlete or a guardian has opened an injury someone else logged.
create or replace function public.mark_logged_injury_seen(p_injury_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id;
  if v_injury.id is null or v_injury.logged_by_role is null
    or not public.can_report_for(v_injury.athlete_id) then
    return;
  end if;
  insert into public.injury_log_seen (injury_id, member_id)
  values (p_injury_id, auth.uid())
  on conflict do nothing;
end;
$$;
revoke execute on function public.mark_logged_injury_seen(uuid) from public, anon;
grant execute on function public.mark_logged_injury_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2 and 3. C4 and C5: concussion and physio-only endorsement
-- ---------------------------------------------------------------------------

-- As before, plus the concussion rules: not before the club's minimum days,
-- and only with a doctor's clearance.
drop function if exists public.request_clearance(uuid, text, text, text);
create or replace function public.request_clearance(
  p_injury_id uuid,
  p_notes text,
  p_document_path text,
  p_document_name text,
  p_doctor_clearance boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
  v_earliest date;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.can_report_for(v_injury.athlete_id) then
    raise exception 'Only the athlete and their guardians can ask for clearance';
  end if;
  if v_injury.status <> 'injured' then
    raise exception 'Clearance has already been asked for';
  end if;
  v_earliest := public.earliest_concussion_clearance(v_injury);
  if v_earliest is not null and current_date < v_earliest then
    raise exception 'After a concussion, clearance can be asked for from %',
      to_char(v_earliest, 'FMDD FMMonth YYYY');
  end if;
  if p_document_path is null then
    raise exception 'Attach proof of clearance, such as a letter from the physio';
  end if;
  if v_injury.concussion and not coalesce(p_doctor_clearance, false) then
    raise exception 'After a concussion, attach a doctor’s clearance and confirm it’s from a doctor';
  end if;
  perform public.check_injury_document(v_injury, p_document_path);

  update public.injuries set status = 'clearance_requested' where id = p_injury_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, document_path, document_name, doctor_clearance
  )
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'clearance_requested',
    nullif(trim(p_notes), ''), p_document_path, p_document_name,
    coalesce(p_doctor_clearance, false)
  );
end;
$$;
revoke execute on function public.request_clearance(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.request_clearance(uuid, text, text, text, boolean) to authenticated;

create or replace function public.endorse_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null
    or not (public.coaches_athlete(v_injury.athlete_id)
      or public.physio_looks_after(v_injury.athlete_id)) then
    raise exception 'Only the athlete’s coaches or a physio can endorse clearance';
  end if;
  if public.endorsement_needs_physio(v_injury) and not public.physio_looks_after(v_injury.athlete_id) then
    raise exception '%', case when v_injury.concussion
      then 'After a concussion, only a physio can endorse clearance'
      else 'At this club, only a physio can endorse clearance' end;
  end if;
  if v_injury.status <> 'clearance_requested' then
    raise exception 'This injury isn’t waiting for a coach or physio';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t endorse your own clearance';
  end if;
  if public.is_guardian_of(v_injury.athlete_id) then
    raise exception 'You can’t endorse your own child’s clearance. Ask another coach or a physio.';
  end if;
  if not public.has_child_consent(v_injury.athlete_id, 'health') then
    raise exception 'A parent or guardian needs to give consent before you can see this injury';
  end if;

  update public.injuries
  set status = 'coach_endorsed', coach_endorsed_by = auth.uid(), coach_endorsed_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'coach_endorsed', nullif(trim(p_notes), '')
  );
end;
$$;

-- Whether a member could endorse this athlete's clearance today, as
-- could_endorse_clearance(member, athlete), and with p_physio_only only as
-- a physio.
create or replace function public.could_endorse_clearance(
  p_member_id uuid,
  p_athlete_id uuid,
  p_physio_only boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_member_id and p.id <> p_athlete_id
      and p.status = 'approved' and p.stood_down_at is null
      and public.is_cleared(p.id)
      and not exists (
        select 1 from public.guardianships g
        where g.guardian_id = p.id and g.athlete_id = p_athlete_id
      )
      and (
        (not p_physio_only and exists (
          select 1 from public.team_members coach
          join public.teams t on t.id = coach.team_id
          join public.team_members a on a.team_id = coach.team_id
          where coach.profile_id = p.id and coach.team_role = 'coach'
            and not t.archived and t.selections_completed_at is null
            and a.profile_id = p_athlete_id and a.team_role = 'athlete'
        ))
        or ('physio' = any (public.roles_of(p.role, p.extra_roles)) and (
          p.head_physio
          or exists (
            select 1 from public.team_members me
            join public.teams t on t.id = me.team_id
            join public.team_members a on a.team_id = me.team_id
            where me.profile_id = p.id and me.team_role = 'physio' and not t.archived
              and a.profile_id = p_athlete_id and a.team_role = 'athlete'
          )
        ))
      )
  );
$$;
revoke execute on function public.could_endorse_clearance(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.admin_unendorsable_clearances()
returns table (
  injury_id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.athlete_id, coalesce(nullif(p.full_name, ''), p.email), i.body_area
  from public.injuries i
  join public.profiles p on p.id = i.athlete_id
  where public.is_admin()
    and i.status = 'clearance_requested'
    and i.athlete_left_at is null
    and not exists (
      select 1 from public.profiles e
      where public.could_endorse_clearance(e.id, i.athlete_id, public.endorsement_needs_physio(i))
    )
  order by i.updated_at, i.id;
$$;

-- The injuries list, with the new rules: coaches aren't asked to endorse
-- when only a physio can, and committee members only sign off what they can
-- see. New columns at the end: whether it's a concussion, the first day its
-- clearance can be asked for, whether only a physio can endorse it, whether
-- the member can add updates, and who logged it.
drop function if exists public.visible_injuries(boolean, uuid);
create or replace function public.visible_injuries(
  p_include_cleared boolean default false,
  p_injury_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text,
  description text,
  injured_on date,
  restrictions text,
  expected_return date,
  status public.injury_status,
  coach_endorsed_by uuid,
  cleared_at timestamptz,
  created_at timestamptz,
  last_update_at timestamptz,
  can_report boolean,
  waiting_for_me boolean,
  concussion boolean,
  earliest_clearance date,
  needs_physio boolean,
  can_update boolean,
  logged_by_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.athlete_id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    i.body_area, i.description, i.injured_on, i.restrictions, i.expected_return, i.status,
    i.coach_endorsed_by, i.cleared_at, i.created_at,
    (select max(u.created_at) from public.injury_updates u where u.injury_id = i.id),
    public.can_report_for(i.athlete_id),
    i.athlete_left_at is null and i.athlete_id <> auth.uid()
      and not public.is_guardian_of(i.athlete_id) and (
      (i.status = 'clearance_requested'
        and (public.physio_looks_after(i.athlete_id)
          or (public.coaches_athlete(i.athlete_id) and not public.endorsement_needs_physio(i))))
      or (i.status = 'coach_endorsed' and public.committee_sees_injuries_of(i.athlete_id)
        and i.coach_endorsed_by is distinct from auth.uid())
    ),
    i.concussion,
    public.earliest_concussion_clearance(i),
    public.endorsement_needs_physio(i),
    i.athlete_left_at is null and public.can_add_injury_update(i.athlete_id),
    i.logged_by_role
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  where public.can_view_injury_details(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_include_cleared or i.athlete_left_at is null or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;
revoke execute on function public.visible_injuries(boolean, uuid) from public, anon;
grant execute on function public.visible_injuries(boolean, uuid) to authenticated;

-- The club's injury rules, for every signed-in member's screens.
create or replace function public.injury_rules()
returns table (physio_only_endorsement boolean, concussion_min_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.physio_only_endorsement, false), coalesce(s.concussion_min_days, 21)
  from (select true) x
  left join public.safeguarding_settings s on s.id
  where auth.uid() is not null;
$$;
revoke execute on function public.injury_rules() from public, anon;
grant execute on function public.injury_rules() to authenticated;

create or replace function public.admin_set_injury_rules(
  p_physio_only_endorsement boolean,
  p_concussion_min_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change safeguarding settings';
  end if;
  if p_physio_only_endorsement is null then
    raise exception 'Choose who can endorse clearances';
  end if;
  if p_concussion_min_days is null or p_concussion_min_days not in (12, 21) then
    raise exception 'Choose 21 days, or 12 for an elite program';
  end if;
  update public.safeguarding_settings
  set physio_only_endorsement = p_physio_only_endorsement,
      concussion_min_days = p_concussion_min_days,
      updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_injury_rules(boolean, integer) from public, anon;
grant execute on function public.admin_set_injury_rules(boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Parents' What's changed: an injury someone else logged
-- ---------------------------------------------------------------------------

create or replace function public.child_activity(p_athlete_id uuid, p_limit integer default 100)
returns table (kind text, summary text, happened_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.is_approved() and (public.is_guardian_of(p_athlete_id) or public.is_admin()) as ok
  ),
  child as (
    select coalesce(public.member_display_name(p_athlete_id), 'Your child') as name
  ),
  events as (
    -- Adults joining or leaving the child's squads and teams, from when the
    -- child joined.
    select 'adult'::text as kind,
      coalesce(g.member_name, 'Someone') || case g.change when 'added' then ' was added as ' else ' is no longer ' end
        || case g.team_role when 'coach' then 'a coach' when 'manager' then 'a manager' else 'a physio' end
        || case g.change when 'added' then ' of ' else ' in ' end
        || coalesce(g.team_name, 'a squad or team') || '.' as summary,
      g.changed_at as happened_at
    from public.group_membership_changes g
    join public.team_members tm
      on tm.team_id = g.team_id and tm.profile_id = p_athlete_id and tm.team_role = 'athlete'
    where g.team_role in ('coach', 'manager', 'physio')
      and g.profile_id is distinct from p_athlete_id
      and g.changed_at >= tm.created_at
    union all
    -- The child joining or leaving a squad or team.
    select 'group',
      (select name from child) || case g.change when 'added' then ' was added to ' else ' was removed from ' end
        || coalesce(g.team_name, 'a squad or team') || '.',
      g.changed_at
    from public.group_membership_changes g
    where g.profile_id = p_athlete_id and g.team_role = 'athlete'
    union all
    select 'guardian',
      coalesce(h.guardian_name, 'A parent or guardian')
        || case h.change when 'linked' then ' was linked as a parent or guardian'
          else ' was unlinked as a parent or guardian' end
        || coalesce(', by ' || h.changed_by_name, '') || '.',
      h.changed_at
    from public.guardianship_history h
    where h.athlete_id = p_athlete_id
    union all
    select 'consent',
      coalesce(c.given_by_name, 'A parent or guardian') || ' gave consent for '
        || case c.kind when 'data' then 'daily check-ins' else 'injuries and health information' end || '.',
      c.given_at
    from public.child_consents c
    where c.athlete_id = p_athlete_id
    union all
    select 'consent',
      coalesce(c.withdrawn_by_name, 'A parent or guardian') || ' withdrew consent for '
        || case c.kind when 'data' then 'daily check-ins' else 'injuries and health information' end || '.',
      c.withdrawn_at
    from public.child_consents c
    where c.athlete_id = p_athlete_id and c.withdrawn_at is not null
    union all
    select 'shared',
      coalesce(l.viewer_name, 'Someone')
        || coalesce(' (' || lower(l.viewer_role) || ')', '')
        || ' shared an injury document out of the app.',
      l.created_at
    from public.record_access_log l
    where l.subject_id = p_athlete_id and l.kind = 'injury_document_shared'
    union all
    -- An injury a coach, manager or physio logged for the child.
    select 'injury',
      coalesce(u.author_name, 'Someone') || ' (' || i.logged_by_role || ') logged an injury for '
        || (select name from child) || ': ' || i.body_area || '.',
      i.created_at
    from public.injuries i
    left join lateral (
      select x.author_name from public.injury_updates x
      where x.injury_id = i.id and x.kind = 'reported'
      order by x.created_at limit 1
    ) u on true
    where i.athlete_id = p_athlete_id and i.logged_by_role is not null
  )
  select e.kind, e.summary, e.happened_at
  from events e
  where (select ok from allowed)
  order by e.happened_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

commit;
