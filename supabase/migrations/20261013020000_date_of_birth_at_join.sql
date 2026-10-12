-- Date of birth at Join, checked by an admin before an athlete is approved
-- (child-safety audit finding 6).
--
-- Until now nothing asked a new member's age. An admin could leave the date
-- of birth blank and the "18 or over" choice stood, so one missed field
-- approved a child as an adult: no guardian, no copies of messages, no
-- consent.
--
-- Now:
-- - Everyone gives their date of birth when they ask to join. It is kept as
--   declared_date_of_birth, what they said, and never decides anything on
--   its own.
-- - An athlete under 18 also gives a parent's or guardian's email, so the
--   admin knows who to look for.
-- - An admin checks the date (against PlayHQ or ID) and records it as
--   date_of_birth, with who recorded it and when. An athlete can't be
--   approved without it. The "Under 18 / 18 or over" choice is gone from the
--   app; under_17 stays only for members approved before this change.
-- - Admins get a to-do for approved athletes with no date of birth.
--
-- Nothing is deleted or changed in existing rows.
--
-- Additive only: new nullable columns, replaced functions.

begin;

alter table public.profiles
  add column if not exists declared_date_of_birth date,
  add column if not exists guardian_email text
    check (guardian_email is null or (guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(guardian_email) <= 254)),
  add column if not exists date_of_birth_recorded_by uuid references public.profiles (id) on delete set null,
  add column if not exists date_of_birth_recorded_at timestamptz;

comment on column public.profiles.declared_date_of_birth is
  'The date of birth the member gave when asking to join. Not checked; date_of_birth is the one an admin checked.';
comment on column public.profiles.guardian_email is
  'A parent''s or guardian''s email given by an athlete under 18 when asking to join.';

-- ---------------------------------------------------------------------------
-- Join asks for a date of birth, and a guardian's email from under 18s
-- ---------------------------------------------------------------------------

drop function if exists public.submit_join_request(text, text, public.app_role, uuid, text);

create or replace function public.submit_join_request(
  p_full_name text,
  p_playhq_email text,
  p_requested_role public.app_role,
  p_requested_team_id uuid,
  p_join_password text default null,
  p_date_of_birth date default null,
  p_guardian_email text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_attempt public.join_password_attempts;
  v_max_failures constant integer := 5;
  v_lockout constant interval := interval '15 minutes';
  v_guardian_email text := nullif(lower(trim(coalesce(p_guardian_email, ''))), '');
  v_child boolean := p_requested_role = 'athlete' and public.is_minor(p_date_of_birth, false);
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Admins match people to PlayHQ by this email, so it must be one the
  -- person actually controls.
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email address before asking to join';
  end if;
  if char_length(coalesce(trim(p_full_name), '')) > 80 then
    raise exception 'Keep your name to 80 characters';
  end if;
  select join_password_hash into v_hash from public.club_settings;
  if v_hash is not null then
    select * into v_attempt from public.join_password_attempts where profile_id = auth.uid();
    if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
      return 'Too many wrong club passwords. Try again in '
        || ceil(extract(epoch from (v_attempt.locked_until - now())) / 60)::integer
        || ' minutes.';
    end if;
    if extensions.crypt(coalesce(trim(p_join_password), ''), v_hash) <> v_hash then
      insert into public.join_password_attempts as a (profile_id, failures, locked_until, updated_at)
      values (
        auth.uid(),
        1,
        null,
        now()
      )
      on conflict (profile_id) do update
        set failures = case
              when a.locked_until is not null and a.locked_until <= now() then 1
              else a.failures + 1
            end,
            locked_until = case
              when a.locked_until is not null and a.locked_until <= now() then null
              when a.failures + 1 >= v_max_failures then now() + v_lockout
              else null
            end,
            updated_at = now();
      return 'That club password is not right. Ask a club admin for it.';
    end if;
    -- A right password clears the count.
    delete from public.join_password_attempts where profile_id = auth.uid();
  end if;
  if p_requested_role = 'admin' then
    raise exception 'Admin access cannot be requested';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;
  if p_requested_role = 'guardian' and coalesce(trim(p_playhq_email), '') = '' then
    raise exception 'Guardians need to give the email they used to register with PlayHQ';
  end if;
  -- Older versions of the app don't send a date of birth; the admin still
  -- has to record one before approving an athlete.
  if p_date_of_birth is not null
     and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'That date of birth doesn''t look right';
  end if;
  if v_child and v_guardian_email is null then
    raise exception 'Give the email of a parent or guardian, so the club can link them to you';
  end if;
  if v_guardian_email is not null
     and (v_guardian_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_guardian_email) > 254) then
    raise exception 'That parent or guardian email doesn''t look right';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      playhq_email = nullif(lower(trim(p_playhq_email)), ''),
      requested_role = p_requested_role,
      requested_team_id = p_requested_team_id,
      join_requested_at = now(),
      declared_date_of_birth = coalesce(p_date_of_birth, declared_date_of_birth),
      -- Only kept for a child; an adult's request clears it.
      guardian_email = case
        when v_child then v_guardian_email
        when p_date_of_birth is null then guardian_email
      end,
      -- A rejected member can ask again.
      status = case when status = 'rejected' then 'pending'::public.member_status else status end
  where id = auth.uid() and status <> 'approved';
  return null;
end;
$$;

revoke execute on function public.submit_join_request(text, text, public.app_role, uuid, text, date, text) from public, anon;
grant execute on function public.submit_join_request(text, text, public.app_role, uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The admin's checked date of birth, with who recorded it and when
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_member_details(
  p_profile_id uuid,
  p_date_of_birth date,
  p_wwcc_number text,
  p_wwcc_expires_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_date_of_birth is not null
     and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'That date of birth doesn''t look right';
  end if;

  update public.profiles
  set date_of_birth_recorded_by = case
        when date_of_birth is distinct from p_date_of_birth then auth.uid()
        else date_of_birth_recorded_by
      end,
      date_of_birth_recorded_at = case
        when date_of_birth is distinct from p_date_of_birth then now()
        else date_of_birth_recorded_at
      end,
      date_of_birth = p_date_of_birth,
      wwcc_number = nullif(upper(trim(p_wwcc_number)), ''),
      wwcc_expires_on = p_wwcc_expires_on
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

-- Who recorded a member's date of birth, for the admin's member screen.
create or replace function public.admin_date_of_birth_record(p_profile_id uuid)
returns table (recorded_by_name text, recorded_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select public.display_name(r), p.date_of_birth_recorded_at
  from public.profiles p
  left join public.profiles r on r.id = p.date_of_birth_recorded_by
  where p.id = p_profile_id and p.date_of_birth is not null and public.is_admin();
$$;

revoke execute on function public.admin_date_of_birth_record(uuid) from public, anon;
grant execute on function public.admin_date_of_birth_record(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- An athlete can't be approved without a checked date of birth
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null,
  p_extra_roles public.app_role[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles public.app_role[] := public.roles_of(p_role, coalesce(p_extra_roles, '{}'));
  v_extra public.app_role[];
  v_default_team_role public.team_role;
  v_placements jsonb;
  v_date_of_birth date;
  v_under_17 boolean;
  v_problem text;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
  v_was_committee boolean;
  v_exempt_reason text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  v_extra := v_roles[2:];
  select
    date_of_birth,
    status = 'approved' and 'committee' = any (public.roles_of(role, extra_roles)),
    wwcc_exempt_reason
  into v_date_of_birth, v_was_committee, v_exempt_reason
  from public.profiles where id = p_profile_id;
  v_under_17 := 'athlete' = any (v_roles) and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (not 'admin' = any (v_roles) or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  v_problem := public.role_combination_problem(v_roles, v_date_of_birth, p_under_17);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 18 have guardians';
  end if;
  if p_profile_id = any (v_guardian_ids) then
    raise exception 'A member cannot be their own guardian';
  end if;
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    where not exists (
      select 1 from public.profiles p
      where p.id = g.id and p.status = 'approved'
        and (p.role = 'guardian' or 'guardian' = any (p.extra_roles))
    )
  ) then
    raise exception 'Guardians must be approved members with the Guardian role';
  end if;
  -- Links that already exist are kept; new ones need a verified guardian.
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    join public.profiles p on p.id = g.id
    where p.verified_at is null
      and not exists (
        select 1 from public.guardianships l
        where l.guardian_id = g.id and l.athlete_id = p_profile_id
      )
  ) then
    raise exception 'Verify a guardian (code in person, or checked against PlayHQ) before linking them to a child';
  end if;
  -- Whether an athlete is a child is never guessed: approving one needs the
  -- date of birth an admin has checked.
  if p_status = 'approved' and 'athlete' = any (v_roles) and v_date_of_birth is null then
    raise exception 'Add their date of birth, checked against PlayHQ or ID, before approving an athlete';
  end if;
  if p_status = 'approved' and v_under_17 and cardinality(v_guardian_ids) = 0 then
    raise exception 'Link at least one verified guardian before approving an athlete under 18';
  end if;
  if p_status = 'approved' and v_roles && array['coach', 'manager', 'physio']::public.app_role[]
     and not public.has_current_wwcc(p_profile_id)
     and not exists (
       select 1 from public.volunteer_exemptions
       where profile_id = p_profile_id and ended_at is null
     ) then
    raise exception 'Record a current Working With Children Check, or a volunteer exemption, before approving a coach, manager or physio';
  end if;
  -- Committee members approved before checks were needed keep their access;
  -- the admin's to-do list asks for their check instead.
  if p_status = 'approved' and 'committee' = any (v_roles) and not coalesce(v_was_committee, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check, or exempt them with a reason, before making them a committee member';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_teams) as t
    where not exists (
      select 1 from public.teams g where g.id = (t ->> 'team_id')::uuid and not g.archived
    )
  ) then
    raise exception 'Members can only be added to this season''s squads and teams';
  end if;

  update public.profiles
  set role = p_role,
      extra_roles = v_extra,
      status = p_status,
      under_17 = v_under_17,
      rejection_reason = case when p_status = 'rejected' then p_rejection_reason end
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Guardian links: replace this athlete's guardians, and drop links from
  -- anyone who is no longer an approved guardian.
  delete from public.guardianships where athlete_id = p_profile_id;
  if not 'guardian' = any (v_roles) or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  if p_status = 'approved' then
    insert into public.guardianships (guardian_id, athlete_id)
    select distinct g.id, p_profile_id from unnest(v_guardian_ids) as g (id);
  end if;

  delete from public.team_members m
  using public.teams g
  where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived;

  if jsonb_array_length(p_teams) = 0 or p_status <> 'approved' then
    return;
  end if;

  select r::text::public.team_role into v_default_team_role
  from unnest(v_roles) with ordinality as x (r, n)
  where r in ('coach', 'manager', 'athlete', 'guardian', 'physio')
  order by n
  limit 1;
  if v_default_team_role is null then
    raise exception 'Only coaches, managers, physios, athletes and guardians can be added to a squad or team';
  end if;

  -- Each placement with its group's kind and squad, and the role it's in.
  select coalesce(jsonb_agg(t || jsonb_build_object(
    'team_role', coalesce(t ->> 'team_role', v_default_team_role::text),
    'kind', g.kind,
    'squad_id', g.squad_id
  )), '[]'::jsonb)
  into v_placements
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;

  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where not (p ->> 'team_role')::public.app_role = any (v_roles)
       or p ->> 'team_role' not in ('coach', 'manager', 'athlete', 'guardian', 'physio')
  ) then
    raise exception 'Give them that role before adding them to a squad or team with it';
  end if;

  -- A team named from a squad needs its members in the squad too, in the same role.
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where p ->> 'squad_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_placements) as s
        where s ->> 'team_id' = p ->> 'squad_id'
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    join jsonb_array_elements(v_placements) as s on s ->> 'team_id' = p ->> 'squad_id'
    where p ->> 'team_role' <> s ->> 'team_role'
  ) then
    raise exception 'Their role in a team must match their role in its squad';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    (p ->> 'team_id')::uuid,
    p_profile_id,
    (p ->> 'team_role')::public.team_role,
    case when p ->> 'team_role' = 'coach'
      then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
      then coalesce((p ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(v_placements) as p;
end;
$$;

-- Admin to-dos gain approved athletes with no date of birth, mostly members
-- approved before it was needed.
drop function if exists public.admin_safety_todos();
create function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer,
  exemptions_ending integer,
  athletes_without_date_of_birth integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select p.*, public.roles_of(p.role, p.extra_roles) as roles
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where public.needs_wwcc(m.roles, m.wwcc_exempt_reason)
        and not public.is_cleared(m.id)
    )::int,
    count(*) filter (
      where public.needs_wwcc(m.roles, m.wwcc_exempt_reason)
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 60
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and not exists (select 1 from public.guardianships g where g.athlete_id = m.id)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is not null
        and public.is_minor(m.date_of_birth, m.under_17)
        and m.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int,
    count(*) filter (
      where public.needs_wwcc(m.roles, m.wwcc_exempt_reason)
        and not public.has_current_wwcc(m.id)
        and exists (
          select 1 from public.volunteer_exemption_state(m.id) s
          where s.valid and s.ends_on < current_date + 60
        )
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is null
    )::int
  from members m;
$$;

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

commit;
