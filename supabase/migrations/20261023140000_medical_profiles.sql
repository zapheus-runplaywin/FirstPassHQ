-- Medical and emergency details (customer review C10 and R4, Matt, 23
-- October 2026).
--
-- Each athlete has one medical and emergency profile: up to three emergency
-- contacts, conditions, allergies, medications and an action plan (what to
-- do if, say, they have an asthma attack or a reaction).
--
-- * An athlete 18 or over keeps their own. For an under 18, their verified
--   parents and guardians keep it, and the athlete can read it.
-- * The coaches, managers and physios of the athlete's current squads and
--   teams (and the Head Physio) read it, on the same terms as their other
--   access: approved, not stood down, screened, and for a coach or manager
--   not a squad whose selections are complete. For an under 18 only once a
--   parent or guardian has given health consent, the consent that already
--   covers injuries. Admins and the committee don't see it.
-- * Every time anyone other than the athlete or their guardians opens it,
--   the view is written to the record access log (kind 'medical'), for
--   adults as well as children, and the athlete (18 or over) or their
--   guardians see who looked. The log is removed under the club's "Who
--   viewed a child's records" keep period like the rest of it.
-- * The profile goes when the athlete's account is deleted.
-- * Once a year whoever keeps it (the athlete 18 or over, or a parent or
--   guardian) checks it's still right (Matt, 23 October 2026). Saving counts
--   as a check, and so does tapping "Still correct". It's due a year after
--   the last check; a to-do appears 30 days before. Admins get a compliance
--   report of who is current, due, overdue or has nothing saved, without
--   any of the details themselves.
--
-- Additive: one new table reached only through functions, new functions,
-- and the access log accepts one more kind. No rows are changed or removed.

begin;

create table if not exists public.medical_profiles (
  athlete_id uuid primary key references public.profiles (id) on delete cascade,
  -- [{"name": ..., "relationship": ..., "phone": ...}], at most three.
  emergency_contacts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(emergency_contacts) = 'array' and jsonb_array_length(emergency_contacts) <= 3),
  conditions text not null default '' check (char_length(conditions) <= 2000),
  allergies text not null default '' check (char_length(allergies) <= 2000),
  medications text not null default '' check (char_length(medications) <= 2000),
  action_plan text not null default '' check (char_length(action_plan) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_by_name text,
  -- The last yearly check: a save or a "Still correct".
  checked_at timestamptz not null default now(),
  checked_by uuid references public.profiles (id) on delete set null,
  checked_by_name text
);

alter table public.medical_profiles enable row level security;
-- Reached only through the functions below.
revoke all on public.medical_profiles from public, anon, authenticated;
grant all on public.medical_profiles to service_role;

-- The access log gains medical and emergency details.
alter table public.record_access_log drop constraint if exists record_access_log_kind_check;
alter table public.record_access_log add constraint record_access_log_kind_check check (
  kind in (
    'injury', 'injury_document', 'injury_document_shared', 'check_ins', 'goals', 'member_record',
    'kpis', 'survey_answers', 'medical'
  )
);

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- How the signed-in member sees this athlete's medical details, or null
-- when they can't: 'self', 'guardian', 'physio', 'coach' or 'manager'.
create or replace function public.medical_profile_role(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_approved() then null
    when not exists (
      select 1 from public.profiles
      where id = p_athlete_id and status = 'approved'
        and (role = 'athlete' or 'athlete' = any (extra_roles))
    ) then null
    when p_athlete_id = auth.uid() then 'self'
    when public.is_verified_guardian_of(p_athlete_id) then 'guardian'
    when not public.can_work_with_children()
      or not public.has_child_consent(p_athlete_id, 'health') then null
    when public.physio_looks_after(p_athlete_id) then 'physio'
    when public.coaches_athlete(p_athlete_id) then 'coach'
    when public.manages_athlete(p_athlete_id) then 'manager'
  end;
$$;
revoke execute on function public.medical_profile_role(uuid) from public, anon, authenticated;

-- An athlete 18 or over keeps their own; an under 18's verified parents and
-- guardians keep theirs.
create or replace function public.can_edit_medical_profile(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.medical_profile_role(p_athlete_id)
    when 'self' then not public.athlete_is_minor(p_athlete_id)
    when 'guardian' then public.athlete_is_minor(p_athlete_id)
    else false
  end;
$$;
revoke execute on function public.can_edit_medical_profile(uuid) from public, anon, authenticated;

-- Who sees who has looked: the athlete 18 or over, and an under 18's
-- verified parents and guardians.
create or replace function public.can_see_medical_views(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_medical_profile(p_athlete_id);
$$;
revoke execute on function public.can_see_medical_views(uuid) from public, anon, authenticated;

-- The yearly check. 'missing' when nothing is saved, 'overdue' after the
-- year is up, 'due_soon' in its last 30 days, otherwise 'current'.
create or replace function public.medical_review_status(p_checked_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_checked_at is null then 'missing'
    when (p_checked_at + interval '1 year')::date < current_date then 'overdue'
    when (p_checked_at + interval '1 year')::date <= current_date + 30 then 'due_soon'
    else 'current'
  end;
$$;
revoke execute on function public.medical_review_status(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading and saving
-- ---------------------------------------------------------------------------

-- One athlete's medical and emergency details. Anyone other than the
-- athlete or their guardians is written to the record access log, once in
-- 30 minutes however often they open it.
create or replace function public.medical_profile(p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.medical_profile_role(p_athlete_id);
  v_profile public.medical_profiles;
begin
  if v_role is null then
    raise exception 'You can’t see this athlete’s medical details';
  end if;

  if v_role not in ('self', 'guardian') and not exists (
    select 1 from public.record_access_log l
    where l.viewer_id = auth.uid() and l.subject_id = p_athlete_id and l.kind = 'medical'
      and l.created_at > now() - interval '30 minutes'
  ) then
    insert into public.record_access_log (subject_id, viewer_id, viewer_name, viewer_role, kind, record_id)
    values (
      p_athlete_id, auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Member'),
      initcap(v_role), 'medical', null
    );
  end if;

  select * into v_profile from public.medical_profiles where athlete_id = p_athlete_id;

  return jsonb_build_object(
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'role', v_role,
    'can_edit', public.can_edit_medical_profile(p_athlete_id),
    'saved', v_profile.athlete_id is not null,
    'emergency_contacts', coalesce(v_profile.emergency_contacts, '[]'::jsonb),
    'conditions', coalesce(v_profile.conditions, ''),
    'allergies', coalesce(v_profile.allergies, ''),
    'medications', coalesce(v_profile.medications, ''),
    'action_plan', coalesce(v_profile.action_plan, ''),
    'updated_at', v_profile.updated_at,
    'updated_by_name', v_profile.updated_by_name,
    'checked_at', v_profile.checked_at,
    'checked_by_name', v_profile.checked_by_name,
    'check_due_on', (v_profile.checked_at + interval '1 year')::date,
    'check_status', public.medical_review_status(v_profile.checked_at)
  );
end;
$$;
revoke execute on function public.medical_profile(uuid) from public, anon;
grant execute on function public.medical_profile(uuid) to authenticated;

-- Saves the whole profile. Each contact needs a name and a phone number.
create or replace function public.save_medical_profile(
  p_athlete_id uuid,
  p_emergency_contacts jsonb,
  p_conditions text,
  p_allergies text,
  p_medications text,
  p_action_plan text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contacts jsonb := '[]'::jsonb;
  v_contact jsonb;
  v_name text;
  v_relationship text;
  v_phone text;
begin
  if not public.can_edit_medical_profile(p_athlete_id) then
    raise exception 'Only the athlete, or a parent or guardian for an under 18, can change these details';
  end if;
  if p_emergency_contacts is null or jsonb_typeof(p_emergency_contacts) <> 'array' then
    raise exception 'Emergency contacts must be a list';
  end if;
  if jsonb_array_length(p_emergency_contacts) > 3 then
    raise exception 'Add up to 3 emergency contacts';
  end if;

  for v_contact in select value from jsonb_array_elements(p_emergency_contacts) loop
    if jsonb_typeof(v_contact) <> 'object' then
      raise exception 'Each emergency contact needs a name and a phone number';
    end if;
    v_name := btrim(coalesce(v_contact ->> 'name', ''));
    v_relationship := btrim(coalesce(v_contact ->> 'relationship', ''));
    v_phone := btrim(coalesce(v_contact ->> 'phone', ''));
    if v_name = '' or v_phone = '' then
      raise exception 'Each emergency contact needs a name and a phone number';
    end if;
    if char_length(v_name) > 80 or char_length(v_relationship) > 40 or char_length(v_phone) > 30 then
      raise exception 'An emergency contact’s details are too long';
    end if;
    if v_phone !~ '^[0-9 +()-]+$' or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then
      raise exception 'Check the phone number for %', v_name;
    end if;
    v_contacts := v_contacts || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'relationship', v_relationship, 'phone', v_phone
    ));
  end loop;

  if char_length(coalesce(p_conditions, '')) > 2000
    or char_length(coalesce(p_allergies, '')) > 2000
    or char_length(coalesce(p_medications, '')) > 2000
    or char_length(coalesce(p_action_plan, '')) > 4000 then
    raise exception 'That’s too long. Keep each section short, or attach the full plan to an injury';
  end if;

  insert into public.medical_profiles as m (
    athlete_id, emergency_contacts, conditions, allergies, medications, action_plan,
    updated_at, updated_by, updated_by_name, checked_at, checked_by, checked_by_name
  )
  values (
    p_athlete_id, v_contacts,
    btrim(coalesce(p_conditions, '')), btrim(coalesce(p_allergies, '')),
    btrim(coalesce(p_medications, '')), btrim(coalesce(p_action_plan, '')),
    now(), auth.uid(), public.member_display_name(auth.uid()),
    now(), auth.uid(), public.member_display_name(auth.uid())
  )
  on conflict (athlete_id) do update set
    emergency_contacts = excluded.emergency_contacts,
    conditions = excluded.conditions,
    allergies = excluded.allergies,
    medications = excluded.medications,
    action_plan = excluded.action_plan,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name,
    checked_at = excluded.checked_at,
    checked_by = excluded.checked_by,
    checked_by_name = excluded.checked_by_name;
end;
$$;
revoke execute on function public.save_medical_profile(uuid, jsonb, text, text, text, text) from public, anon;
grant execute on function public.save_medical_profile(uuid, jsonb, text, text, text, text) to authenticated;

-- The yearly check without changing anything: "Still correct".
create or replace function public.confirm_medical_profile(p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_medical_profile(p_athlete_id) then
    raise exception 'Only the athlete, or a parent or guardian for an under 18, can check these details';
  end if;
  update public.medical_profiles
  set checked_at = now(), checked_by = auth.uid(), checked_by_name = public.member_display_name(auth.uid())
  where athlete_id = p_athlete_id;
  if not found then
    raise exception 'Add the details first';
  end if;
end;
$$;
revoke execute on function public.confirm_medical_profile(uuid) from public, anon;
grant execute on function public.confirm_medical_profile(uuid) to authenticated;

-- The signed-in member's own medical details, and an under 18's they keep,
-- that need adding or their yearly check (from 30 days before it's due).
create or replace function public.my_medical_reviews()
returns table (athlete_id uuid, athlete_name text, status text, due_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, coalesce(public.member_display_name(c.id), 'Unnamed member'),
    public.medical_review_status(m.checked_at), (m.checked_at + interval '1 year')::date
  from (
    select auth.uid() as id
    union
    select g.athlete_id from public.guardianships g where g.guardian_id = auth.uid()
  ) c
  left join public.medical_profiles m on m.athlete_id = c.id
  where public.can_edit_medical_profile(c.id)
    and public.medical_review_status(m.checked_at) <> 'current'
  order by 4 nulls first, 2;
$$;
revoke execute on function public.my_medical_reviews() from public, anon;
grant execute on function public.my_medical_reviews() to authenticated;

-- Admins' compliance report: every approved athlete, who keeps their
-- details, and where the yearly check is up to. Whether contacts are saved,
-- but never the details themselves.
create or replace function public.medical_review_compliance()
returns table (
  athlete_id uuid,
  athlete_name text,
  minor boolean,
  has_verified_guardian boolean,
  teams text,
  has_contacts boolean,
  checked_at timestamptz,
  checked_by_name text,
  due_on date,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the medical details check report';
  end if;
  return query
  select p.id,
    coalesce(public.member_display_name(p.id), 'Unnamed member'),
    public.athlete_is_minor(p.id),
    exists (
      select 1 from public.guardianships g
      join public.profiles gp on gp.id = g.guardian_id
      where g.athlete_id = p.id and gp.status = 'approved' and gp.verified_at is not null
    ),
    (
      select string_agg(t.name, ', ' order by t.name)
      from public.team_members tm join public.teams t on t.id = tm.team_id
      where tm.profile_id = p.id and tm.team_role = 'athlete' and not t.archived
    ),
    coalesce(jsonb_array_length(m.emergency_contacts), 0) > 0,
    m.checked_at,
    m.checked_by_name,
    (m.checked_at + interval '1 year')::date,
    public.medical_review_status(m.checked_at)
  from public.profiles p
  left join public.medical_profiles m on m.athlete_id = p.id
  where p.status = 'approved' and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
  order by 2;
end;
$$;
revoke execute on function public.medical_review_compliance() from public, anon;
grant execute on function public.medical_review_compliance() to authenticated;

-- Who has opened this athlete's medical details, newest first. Empty for
-- anyone but the athlete 18 or over and an under 18's guardians.
create or replace function public.medical_profile_views(p_athlete_id uuid)
returns table (viewer_name text, viewer_role text, viewed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(l.viewer_name, 'Former member'), l.viewer_role, l.created_at
  from public.record_access_log l
  where l.subject_id = p_athlete_id and l.kind = 'medical'
    and public.can_see_medical_views(p_athlete_id)
  order by l.created_at desc
  limit 200;
$$;
revoke execute on function public.medical_profile_views(uuid) from public, anon;
grant execute on function public.medical_profile_views(uuid) to authenticated;

-- A squad or team's athletes for its coaches, managers and physios, with
-- whether the caller can open each one's medical details and whether any
-- are saved. Never the details themselves, so the list isn't logged.
create or replace function public.team_medical_profiles(p_team_id uuid)
returns table (athlete_id uuid, athlete_name text, can_open boolean, has_contacts boolean, needs_consent boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.profile_id,
    coalesce(public.member_display_name(a.profile_id), 'Unnamed member'),
    public.medical_profile_role(a.profile_id) is not null,
    public.medical_profile_role(a.profile_id) is not null
      and coalesce(jsonb_array_length(m.emergency_contacts), 0) > 0,
    not public.has_child_consent(a.profile_id, 'health')
  from public.team_members a
  left join public.medical_profiles m on m.athlete_id = a.profile_id
  where a.team_id = p_team_id and a.team_role = 'athlete'
    and public.is_approved()
    and exists (
      select 1 from public.team_members me
      join public.teams t on t.id = me.team_id
      where me.team_id = p_team_id and me.profile_id = auth.uid()
        and me.team_role in ('coach', 'manager', 'physio') and not t.archived
    )
  order by 2;
$$;
revoke execute on function public.team_medical_profiles(uuid) from public, anon;
grant execute on function public.team_medical_profiles(uuid) to authenticated;

commit;
