-- Injury management.
--
-- An athlete (or their guardian) reports an injury and adds physio updates as
-- it heals. When the athlete is ready to return they ask for clearance and
-- attach proof, such as a physio clearance letter. A coach of the athlete
-- endorses it, then a committee member accepts it and the injury is cleared.
-- Either can send it back with a note.
--
-- Injury records are private: only the athlete, their guardians, their coaches
-- and the committee (which includes admins) can see them. Proof documents are
-- kept in a private storage bucket with the same rule, and can't be changed or
-- removed once uploaded, so the club keeps a record for governance.
--
-- Additive only: two new tables, a storage bucket and new functions.

create type public.injury_status as enum (
  'injured', 'clearance_requested', 'coach_endorsed', 'cleared'
);

create type public.injury_update_kind as enum (
  'reported', 'physio_update', 'clearance_requested', 'coach_endorsed', 'sent_back', 'cleared'
);

create table public.injuries (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  reported_by uuid references public.profiles (id) on delete set null,
  body_area text not null check (length(body_area) between 1 and 100),
  description text not null check (length(description) between 1 and 4000),
  injured_on date not null,
  -- What the athlete can't do yet, such as "No jumping or diving".
  restrictions text check (length(restrictions) <= 1000),
  expected_return date,
  status public.injury_status not null default 'injured',
  coach_endorsed_by uuid references public.profiles (id) on delete set null,
  coach_endorsed_at timestamptz,
  cleared_by uuid references public.profiles (id) on delete set null,
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index injuries_athlete_id_idx on public.injuries (athlete_id, created_at desc);
create index injuries_status_idx on public.injuries (status);

create trigger injuries_touch_updated_at
  before update on public.injuries
  for each row execute function public.touch_updated_at();

-- The injury's history: the report, physio updates and each sign-off step.
create table public.injury_updates (
  id uuid primary key default gen_random_uuid(),
  injury_id uuid not null references public.injuries (id) on delete cascade,
  -- Kept when the author leaves, with their name as it was.
  author_id uuid references public.profiles (id) on delete set null,
  author_name text,
  kind public.injury_update_kind not null,
  notes text check (length(notes) <= 4000),
  restrictions text check (length(restrictions) <= 1000),
  expected_return date,
  -- A file in the injury-documents bucket, such as a physio letter.
  document_path text,
  document_name text,
  created_at timestamptz not null default now()
);

create index injury_updates_injury_id_idx on public.injury_updates (injury_id, created_at);

-- Written only through the functions below.
alter table public.injuries enable row level security;
alter table public.injury_updates enable row level security;

-- ---------------------------------------------------------------------------
-- Who can see and do what
-- ---------------------------------------------------------------------------

create function public.is_guardian_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.guardianships
    where guardian_id = auth.uid() and athlete_id = p_athlete_id
  );
$$;

-- The signed-in member coaches a squad or team the athlete is in.
create function public.coaches_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members coach
    join public.team_members athlete
      on athlete.team_id = coach.team_id and athlete.profile_id = p_athlete_id
    join public.teams t on t.id = coach.team_id
    where coach.profile_id = auth.uid()
      and coach.team_role = 'coach'
      and athlete.team_role = 'athlete'
      and not t.archived
  ) and public.is_approved();
$$;

-- Athletes report their own injuries; guardians report for their athletes.
create function public.can_report_for(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and exists (
      select 1 from public.profiles
      where id = p_athlete_id and role = 'athlete' and status = 'approved'
    )
    and (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id));
$$;

create function public.can_view_athlete_injuries(p_athlete_id uuid)
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
    or public.is_committee()
  );
$$;

revoke execute on function public.is_guardian_of(uuid) from public, anon;
revoke execute on function public.coaches_athlete(uuid) from public, anon;
revoke execute on function public.can_report_for(uuid) from public, anon;
revoke execute on function public.can_view_athlete_injuries(uuid) from public, anon;
grant execute on function public.is_guardian_of(uuid) to authenticated;
grant execute on function public.coaches_athlete(uuid) to authenticated;
grant execute on function public.can_report_for(uuid) to authenticated;
grant execute on function public.can_view_athlete_injuries(uuid) to authenticated;

create policy "Athletes, guardians, coaches and committee see injuries"
  on public.injuries for select to authenticated
  using (public.can_view_athlete_injuries(athlete_id));

create policy "Athletes, guardians, coaches and committee see injury updates"
  on public.injury_updates for select to authenticated
  using (
    exists (
      select 1 from public.injuries i
      where i.id = injury_id and public.can_view_athlete_injuries(i.athlete_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Proof documents
-- ---------------------------------------------------------------------------

-- Private: files are only reachable through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'injury-documents', 'injury-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- Files are stored as <athlete id>/<injury id>/<file name>. Returns the injury
-- a path belongs to, or null when the path isn't in that shape.
create function public.injury_document_injury(p_name text)
returns public.injuries
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_injury public.injuries;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(v_parts, 1), 0) <> 3
    or v_parts[1] !~ v_uuid or v_parts[2] !~ v_uuid or v_parts[3] = '' then
    return null;
  end if;
  select * into v_injury from public.injuries
  where id = v_parts[2]::uuid and athlete_id = v_parts[1]::uuid;
  return v_injury;
end;
$$;

-- Athletes and guardians upload to injuries that haven't been cleared yet.
create function public.can_upload_injury_document(p_name text)
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
    and public.can_report_for(v_injury.athlete_id);
end;
$$;

create function public.can_view_injury_document(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_name);
begin
  return v_injury.id is not null and public.can_view_athlete_injuries(v_injury.athlete_id);
end;
$$;

revoke execute on function public.injury_document_injury(text) from public, anon, authenticated;
revoke execute on function public.can_upload_injury_document(text) from public, anon;
revoke execute on function public.can_view_injury_document(text) from public, anon;
grant execute on function public.can_upload_injury_document(text) to authenticated;
grant execute on function public.can_view_injury_document(text) to authenticated;

-- No update or delete policies, so uploaded proof can't be changed or removed.
create policy "Athletes and guardians upload injury documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'injury-documents' and public.can_upload_injury_document(name));

create policy "Athletes, guardians, coaches and committee see injury documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'injury-documents' and public.can_view_injury_document(name));

-- ---------------------------------------------------------------------------
-- Changing injuries
-- ---------------------------------------------------------------------------

create function public.my_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid();
$$;

revoke execute on function public.my_display_name() from public, anon, authenticated;

-- Checks a document belongs to the injury and was uploaded. Null is allowed.
create function public.check_injury_document(p_injury public.injuries, p_path text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_path is null then
    return;
  end if;
  if not (p_path like p_injury.athlete_id::text || '/' || p_injury.id::text || '/%')
    or not exists (
      select 1 from storage.objects where bucket_id = 'injury-documents' and name = p_path
    ) then
    raise exception 'That document wasn’t uploaded. Try attaching it again.';
  end if;
end;
$$;

revoke execute on function public.check_injury_document(public.injuries, text)
  from public, anon, authenticated;

create function public.report_injury(
  p_athlete_id uuid,
  p_body_area text,
  p_description text,
  p_injured_on date,
  p_restrictions text default null,
  p_expected_return date default null
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
    athlete_id, reported_by, body_area, description, injured_on, restrictions, expected_return
  )
  values (
    p_athlete_id, auth.uid(), trim(p_body_area), trim(p_description), p_injured_on,
    nullif(trim(p_restrictions), ''), p_expected_return
  )
  returning id into v_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, restrictions, expected_return
  )
  values (
    v_id, auth.uid(), public.my_display_name(), 'reported', trim(p_description),
    nullif(trim(p_restrictions), ''), p_expected_return
  );
  return v_id;
end;
$$;

revoke execute on function public.report_injury(uuid, text, text, date, text, date)
  from public, anon;
grant execute on function public.report_injury(uuid, text, text, date, text, date)
  to authenticated;

-- A physio update. Restrictions and the expected return date replace the
-- injury's current ones.
create function public.add_injury_update(
  p_injury_id uuid,
  p_notes text,
  p_restrictions text default null,
  p_expected_return date default null,
  p_document_path text default null,
  p_document_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.can_report_for(v_injury.athlete_id) then
    raise exception 'Only the athlete and their guardians can add physio updates';
  end if;
  if v_injury.status <> 'injured' then
    raise exception 'This injury is waiting for sign-off, so it can’t be updated now';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Write what the physio said';
  end if;
  perform public.check_injury_document(v_injury, p_document_path);

  update public.injuries
  set restrictions = nullif(trim(p_restrictions), ''),
      expected_return = p_expected_return
  where id = p_injury_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, restrictions, expected_return,
    document_path, document_name
  )
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'physio_update', trim(p_notes),
    nullif(trim(p_restrictions), ''), p_expected_return,
    p_document_path, case when p_document_path is null then null else p_document_name end
  );
end;
$$;

revoke execute on function public.add_injury_update(uuid, text, text, date, text, text)
  from public, anon;
grant execute on function public.add_injury_update(uuid, text, text, date, text, text)
  to authenticated;

-- The athlete is ready to return. Proof of clearance is required.
create function public.request_clearance(
  p_injury_id uuid,
  p_notes text,
  p_document_path text,
  p_document_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.can_report_for(v_injury.athlete_id) then
    raise exception 'Only the athlete and their guardians can ask for clearance';
  end if;
  if v_injury.status <> 'injured' then
    raise exception 'Clearance has already been asked for';
  end if;
  if p_document_path is null then
    raise exception 'Attach proof of clearance, such as a letter from the physio';
  end if;
  perform public.check_injury_document(v_injury, p_document_path);

  update public.injuries set status = 'clearance_requested' where id = p_injury_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, document_path, document_name
  )
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'clearance_requested',
    nullif(trim(p_notes), ''), p_document_path, p_document_name
  );
end;
$$;

revoke execute on function public.request_clearance(uuid, text, text, text) from public, anon;
grant execute on function public.request_clearance(uuid, text, text, text) to authenticated;

-- A coach of the athlete endorses the request. Admins can too, for athletes
-- who have no coach yet.
create function public.endorse_clearance(p_injury_id uuid, p_notes text default null)
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
    or not (public.coaches_athlete(v_injury.athlete_id) or public.is_admin()) then
    raise exception 'Only the athlete’s coaches can endorse clearance';
  end if;
  if v_injury.status <> 'clearance_requested' then
    raise exception 'This injury isn’t waiting for a coach';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t endorse your own clearance';
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

revoke execute on function public.endorse_clearance(uuid, text) from public, anon;
grant execute on function public.endorse_clearance(uuid, text) to authenticated;

-- A committee member accepts the endorsed request. It has to be someone other
-- than the person who endorsed it, so two people always sign off.
create function public.accept_clearance(p_injury_id uuid, p_notes text default null)
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
    raise exception 'A coach needs to endorse this first';
  end if;
  if v_injury.coach_endorsed_by = auth.uid() or v_injury.athlete_id = auth.uid() then
    raise exception 'Someone other than the endorsing coach needs to accept this';
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

revoke execute on function public.accept_clearance(uuid, text) from public, anon;
grant execute on function public.accept_clearance(uuid, text) to authenticated;

-- A coach (before endorsing) or the committee sends the request back, saying
-- why. The injury goes back to injured so more updates can be added.
create function public.send_back_clearance(p_injury_id uuid, p_notes text)
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
      and (public.coaches_athlete(v_injury.athlete_id) or public.is_committee()))
    or (v_injury.status = 'coach_endorsed' and public.is_committee())
  ) then
    raise exception 'You can’t send this back';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t send back your own clearance';
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

revoke execute on function public.send_back_clearance(uuid, text) from public, anon;
grant execute on function public.send_back_clearance(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading injuries
-- ---------------------------------------------------------------------------

-- Injuries the signed-in member can see, with the athlete's name (coaches
-- can't read profiles directly). `waiting_for_me` marks the ones they need to
-- sign off.
create function public.visible_injuries(
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
  waiting_for_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.athlete_id, coalesce(nullif(p.full_name, ''), p.email), i.body_area,
    i.description, i.injured_on, i.restrictions, i.expected_return, i.status,
    i.coach_endorsed_by, i.cleared_at, i.created_at,
    (select max(u.created_at) from public.injury_updates u where u.injury_id = i.id),
    public.can_report_for(i.athlete_id),
    i.athlete_id <> auth.uid() and (
      (i.status = 'clearance_requested'
        and (public.coaches_athlete(i.athlete_id)
          or (public.is_admin() and not exists (
            select 1 from public.team_members c
            join public.team_members a on a.team_id = c.team_id
            join public.teams t on t.id = c.team_id
            where a.profile_id = i.athlete_id and a.team_role = 'athlete'
              and c.team_role = 'coach' and not t.archived
          ))))
      or (i.status = 'coach_endorsed' and public.is_committee()
        and i.coach_endorsed_by is distinct from auth.uid())
    )
  from public.injuries i
  join public.profiles p on p.id = i.athlete_id
  where public.can_view_athlete_injuries(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;

revoke execute on function public.visible_injuries(boolean, uuid) from public, anon;
grant execute on function public.visible_injuries(boolean, uuid) to authenticated;

-- Every injury reported, still open or cleared, since a date, for the admin
-- report and its CSV export.
create function public.injury_report(p_since date)
returns table (
  id uuid,
  athlete_name text,
  athlete_email text,
  body_area text,
  injured_on date,
  reported_at timestamptz,
  status public.injury_status,
  restrictions text,
  expected_return date,
  coach_endorsed_by_name text,
  cleared_by_name text,
  cleared_at timestamptz,
  update_count int,
  document_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, coalesce(nullif(p.full_name, ''), p.email), p.email, i.body_area, i.injured_on,
    i.created_at, i.status, i.restrictions, i.expected_return,
    coalesce(nullif(e.full_name, ''), e.email), coalesce(nullif(c.full_name, ''), c.email),
    i.cleared_at,
    (select count(*)::int from public.injury_updates u where u.injury_id = i.id),
    (select count(u.document_path)::int from public.injury_updates u where u.injury_id = i.id)
  from public.injuries i
  join public.profiles p on p.id = i.athlete_id
  left join public.profiles e on e.id = i.coach_endorsed_by
  left join public.profiles c on c.id = i.cleared_by
  where public.is_admin()
    and (i.created_at >= p_since or i.status <> 'cleared' or i.cleared_at >= p_since)
  order by i.created_at desc;
$$;

revoke execute on function public.injury_report(date) from public, anon;
grant execute on function public.injury_report(date) to authenticated;
