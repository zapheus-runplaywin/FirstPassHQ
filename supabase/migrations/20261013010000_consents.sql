-- Club policies and a parent's consent for their child's data
-- (child-safety audit finding 5).
--
-- Until now a parent was linked to their child by an admin and nothing was
-- ever put in front of them to agree to, and the club had nowhere to publish
-- its privacy policy or code of conduct.
--
-- Now:
-- - Admins add links to the club's privacy policy and code of conduct (the
--   safeguarding policy link already exists) and a policy version. Anyone,
--   signed in, including people waiting for approval, can read the links, so
--   they show on Join.
-- - A verified parent or guardian gives, or withdraws, two consents for their
--   child under 18: "data" (daily check-ins: answers and notes) and "health"
--   (injury details, physio updates and documents). Each is kept with who
--   gave it, when, and the policy version; a withdrawal is kept too.
-- - Until a consent is given, only the child, their guardians and admins see
--   that information (Matt's decision, 12 October 2026). Without data consent
--   coaches don't see the child's check-ins, on the board or in the counts;
--   without health consent coaches, physios and the committee don't see the
--   child's injuries at all, so they can't sign off a clearance either.
--
-- Nothing is deleted or changed in existing rows.
--
-- Additive only: new columns with defaults, a new type, table and functions,
-- replaced functions, and two select policies replaced by stricter ones.

begin;

-- ---------------------------------------------------------------------------
-- Club policies
-- ---------------------------------------------------------------------------

alter table public.safeguarding_settings
  add column if not exists privacy_policy_url text
    check (privacy_policy_url ~ '^https://' and length(privacy_policy_url) <= 500),
  add column if not exists code_of_conduct_url text
    check (code_of_conduct_url ~ '^https://' and length(code_of_conduct_url) <= 500),
  add column if not exists policy_version text not null default '1'
    check (length(policy_version) between 1 and 30);

-- The club's policy links, for everyone signed in, including people asking to join.
create or replace function public.club_policies()
returns table (
  privacy_policy_url text,
  safeguarding_policy_url text,
  code_of_conduct_url text,
  policy_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.privacy_policy_url, s.policy_url, s.code_of_conduct_url, s.policy_version
  from public.safeguarding_settings s
  where s.id;
$$;

revoke execute on function public.club_policies() from public, anon;
grant execute on function public.club_policies() to authenticated;

-- Saves the privacy policy and code of conduct links and the policy version.
-- Blank text clears a link.
create or replace function public.admin_set_policies(
  p_privacy_policy_url text,
  p_code_of_conduct_url text,
  p_policy_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_privacy text := nullif(trim(p_privacy_policy_url), '');
  v_conduct text := nullif(trim(p_code_of_conduct_url), '');
  v_version text := nullif(trim(p_policy_version), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the club’s policies';
  end if;
  if (v_privacy is not null and v_privacy !~ '^https://')
    or (v_conduct is not null and v_conduct !~ '^https://') then
    raise exception 'Links must start with https://';
  end if;
  if v_version is null or length(v_version) > 30 then
    raise exception 'Give the policy version, such as 2026-1';
  end if;
  update public.safeguarding_settings
  set privacy_policy_url = v_privacy, code_of_conduct_url = v_conduct,
      policy_version = v_version, updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_policies(text, text, text) from public, anon;
grant execute on function public.admin_set_policies(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Consents
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'consent_kind' and typnamespace = 'public'::regnamespace) then
    create type public.consent_kind as enum ('data', 'health');
  end if;
end;
$$;

create table if not exists public.child_consents (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  kind public.consent_kind not null,
  given_by uuid references public.profiles (id) on delete set null,
  given_by_name text,
  policy_version text not null,
  given_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles (id) on delete set null,
  withdrawn_by_name text
);

-- One consent of each kind in force for a child at a time.
create unique index if not exists child_consents_one_active
  on public.child_consents (athlete_id, kind) where withdrawn_at is null;

-- No policies: read and written only through the functions below.
alter table public.child_consents enable row level security;

-- Whether a consent is in force. Adults don't need one.
create or replace function public.has_child_consent(p_athlete_id uuid, p_kind public.consent_kind)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.athlete_is_minor(p_athlete_id)
    or exists (
      select 1 from public.child_consents c
      where c.athlete_id = p_athlete_id and c.kind = p_kind and c.withdrawn_at is null
    );
$$;

revoke execute on function public.has_child_consent(uuid, public.consent_kind)
  from public, anon, authenticated;

-- A verified parent or guardian gives or withdraws each consent for their
-- child. Unchanged consents are left as they are.
create or replace function public.set_child_consent(
  p_athlete_id uuid,
  p_data boolean,
  p_health boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.consent_kind;
  v_want boolean;
  v_version text := (select policy_version from public.safeguarding_settings where id);
begin
  if not public.is_verified_guardian_of(p_athlete_id) then
    raise exception 'Only a verified parent or guardian of an athlete under 18 can give consent';
  end if;
  if p_data is null or p_health is null then
    raise exception 'Choose yes or no for each consent';
  end if;
  foreach v_kind in array array['data', 'health']::public.consent_kind[] loop
    v_want := case v_kind when 'data' then p_data else p_health end;
    if v_want then
      insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
      values (p_athlete_id, v_kind, auth.uid(), public.my_display_name(), coalesce(v_version, '1'))
      on conflict (athlete_id, kind) where withdrawn_at is null do nothing;
    else
      update public.child_consents
      set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_by_name = public.my_display_name()
      where athlete_id = p_athlete_id and kind = v_kind and withdrawn_at is null;
    end if;
  end loop;
end;
$$;

revoke execute on function public.set_child_consent(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_child_consent(uuid, boolean, boolean) to authenticated;

-- Every consent given and withdrawn for a child, newest first, for the child,
-- their guardians and admins.
create or replace function public.child_consent_history(p_athlete_id uuid)
returns table (
  kind public.consent_kind,
  given_by_name text,
  policy_version text,
  given_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (p_athlete_id = auth.uid() or public.is_guardian_of(p_athlete_id) or public.is_admin()) then
    raise exception 'Only the athlete, their guardians and admins see consents';
  end if;
  return query
    select c.kind, c.given_by_name, c.policy_version, c.given_at, c.withdrawn_at, c.withdrawn_by_name
    from public.child_consents c
    where c.athlete_id = p_athlete_id
    order by c.given_at desc;
end;
$$;

revoke execute on function public.child_consent_history(uuid) from public, anon;
grant execute on function public.child_consent_history(uuid) to authenticated;

-- The signed-in guardian's children under 18 and which consents are in
-- force, for the home screen and to-do list.
create or replace function public.my_child_consents()
returns table (athlete_id uuid, full_name text, data boolean, health boolean, can_consent boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id, a.full_name,
    public.has_child_consent(a.profile_id, 'data'),
    public.has_child_consent(a.profile_id, 'health'),
    public.is_verified_guardian_of(a.profile_id)
  from public.my_athletes() a;
$$;

revoke execute on function public.my_child_consents() from public, anon;
grant execute on function public.my_child_consents() to authenticated;

-- Consents in force for every athlete under 18, for admins' reports.
create or replace function public.admin_child_consents()
returns table (athlete_id uuid, data boolean, health boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins see consents for every athlete';
  end if;
  return query
    select p.id, public.has_child_consent(p.id, 'data'), public.has_child_consent(p.id, 'health')
    from public.profiles p
    where public.is_minor(p.date_of_birth, p.under_17);
end;
$$;

revoke execute on function public.admin_child_consents() from public, anon;
grant execute on function public.admin_child_consents() to authenticated;

-- ---------------------------------------------------------------------------
-- What waits on consent
-- ---------------------------------------------------------------------------

-- Check-ins: the athlete and their guardians always; coaches once a guardian
-- has given data consent.
create or replace function public.can_view_check_ins(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or (public.coaches_athlete(p_athlete_id) and public.has_child_consent(p_athlete_id, 'data'))
  );
$$;

-- As before, without children whose guardians haven't given data consent.
create or replace function public.check_in_board(p_team_id uuid, p_day date)
returns table (
  athlete_id uuid,
  full_name text,
  sleep smallint,
  soreness smallint,
  stress smallint,
  mood smallint,
  note text,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, coalesce(nullif(p.full_name, ''), p.email),
    c.sleep, c.soreness, c.stress, c.mood, c.note, c.updated_at
  from public.team_members a
  join public.profiles p on p.id = a.profile_id and p.status = 'approved'
  left join public.check_ins c on c.athlete_id = p.id and c.day = p_day
  where a.team_id = p_team_id
    and a.team_role = 'athlete'
    and public.has_child_consent(p.id, 'data')
    and public.is_approved()
    and public.can_work_with_children()
    and exists (
      select 1 from public.team_members coach
      join public.teams t on t.id = coach.team_id
      where coach.team_id = p_team_id
        and coach.profile_id = auth.uid()
        and coach.team_role = 'coach'
        and t.selections_completed_at is null
    )
  order by p.full_name;
$$;

-- As before, counting only athletes whose check-ins the coach can see, so a
-- child's low score doesn't show through the counts.
create or replace function public.check_in_summary(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_count integer,
  checked_in_count integer,
  flagged_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.kind::text,
    count(a.profile_id)::int,
    count(c.id)::int,
    count(c.id) filter (
      where least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    )::int
  from public.team_members coach
  join public.teams t on t.id = coach.team_id and not t.archived
    and t.selections_completed_at is null
  left join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
    and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
    and public.has_child_consent(a.profile_id, 'data')
  left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
  where public.is_approved()
    and public.can_work_with_children()
    and coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
  group by t.id, t.name, t.kind, t.sort_order
  order by t.kind, t.sort_order, t.name;
$$;

-- A child's injuries: the athlete, their guardians and admins always;
-- coaches, physios and the committee once a guardian has given health
-- consent.
create or replace function public.can_view_injury_details(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_athlete_injuries(p_athlete_id) and (
    p_athlete_id = auth.uid()
    or public.is_guardian_of(p_athlete_id)
    or public.is_admin()
    or public.has_child_consent(p_athlete_id, 'health')
  );
$$;

revoke execute on function public.can_view_injury_details(uuid) from public, anon;
grant execute on function public.can_view_injury_details(uuid) to authenticated;

drop policy if exists "Athletes, guardians, coaches and committee see injuries" on public.injuries;
create policy "Athletes, guardians, coaches and committee see injuries"
  on public.injuries for select to authenticated
  using (public.can_view_injury_details(athlete_id));

drop policy if exists "Athletes, guardians, coaches and committee see injury updates" on public.injury_updates;
create policy "Athletes, guardians, coaches and committee see injury updates"
  on public.injury_updates for select to authenticated
  using (
    exists (
      select 1 from public.injuries i
      where i.id = injury_id and public.can_view_injury_details(i.athlete_id)
    )
  );

-- As before, without children whose guardians haven't given health consent.
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
  waiting_for_me boolean
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
        and (public.coaches_athlete(i.athlete_id) or public.physio_looks_after(i.athlete_id)))
      or (i.status = 'coach_endorsed' and public.is_committee()
        and i.coach_endorsed_by is distinct from auth.uid())
    )
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  where public.can_view_injury_details(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_include_cleared or i.athlete_left_at is null or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;

-- Documents: as before, and only with health consent.
create or replace function public.can_view_injury_document(p_name text)
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
    and public.can_view_injury_details(v_injury.athlete_id)
    and exists (
      select 1 from public.injury_document_events e
      where e.viewer_id = auth.uid() and e.document_path = p_name
        and e.created_at > now() - interval '5 minutes'
    );
end;
$$;

create or replace function public.open_injury_document(p_path text, p_share boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries := public.injury_document_injury(p_path);
begin
  if v_injury.id is null
    or not public.can_view_injury_details(v_injury.athlete_id)
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'injury-documents' and name = p_path
    ) then
    raise exception 'That document couldn’t be opened';
  end if;
  if coalesce(p_share, false) and not public.can_share_injury_documents(v_injury) then
    raise exception 'Only the committee member accepting this clearance can share its documents';
  end if;
  insert into public.injury_document_events (
    injury_id, document_path, viewer_id, viewer_name, viewer_role, kind
  )
  values (
    v_injury.id, p_path, auth.uid(), public.my_display_name(),
    public.injury_viewer_role(v_injury.athlete_id),
    case when coalesce(p_share, false) then 'shared' else 'viewed' end
  );
end;
$$;

-- Signing off a clearance waits for health consent too.
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
    raise exception 'A coach needs to endorse this first';
  end if;
  if v_injury.coach_endorsed_by = auth.uid() or v_injury.athlete_id = auth.uid() then
    raise exception 'Someone other than the endorsing coach needs to accept this';
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

commit;
