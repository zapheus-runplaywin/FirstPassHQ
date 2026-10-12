-- Guardian links leave a trail, and families are told
-- (child-safety audit finding 9).
--
-- Until now "Checked against PlayHQ" recorded nothing about what was checked,
-- each save deleted and re-added a child's guardian links so there was no
-- history, and nobody was told when a guardian was added or removed.
--
-- Now:
-- - profiles.verification_method ('code', 'playhq', 'id_sighted') and
--   verification_note record how a member was verified and what was checked.
--   admin_record_verification replaces the bare "Checked against PlayHQ" tap.
-- - guardianship_history keeps every link and unlink: whose, by whom, when
--   and the reason. A trigger on guardianships writes it, so no path can skip
--   it. Only admins can read it.
-- - When a guardian is linked or unlinked, the child's guardians, and the
--   child if they're 13 or over, get a notice in Messages naming the guardian
--   and the admin. The reason stays with admins.
-- - admin_save_member only adds and removes the links that change, takes an
--   optional reason, and refuses when the admin is one of the child's
--   guardians.
--
-- The message audience gains a value. Nothing is deleted or changed in
-- existing rows.

-- Outside the transaction: a new enum value can't be used in the transaction
-- that adds it.
alter type public.message_audience add value if not exists 'notice';

begin;

-- ---------------------------------------------------------------------------
-- How a member was verified
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists verification_method text,
  add column if not exists verification_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_verification_method_check') then
    alter table public.profiles add constraint profiles_verification_method_check
      check (verification_method in ('code', 'playhq', 'id_sighted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_verification_note_length') then
    alter table public.profiles add constraint profiles_verification_note_length
      check (length(verification_note) <= 500);
  end if;
end;
$$;

-- An admin enters the code the member shows them, as before, and the method
-- is kept.
create or replace function public.admin_verify_member(p_profile_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can verify members';
  end if;
  if not exists (
    select 1 from public.verification_codes
    where profile_id = p_profile_id
      and code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g')
      and expires_at > now()
  ) then
    raise exception 'That code doesn''t match. Ask them to open the app and read out the code shown now.';
  end if;

  update public.profiles
  set verified_at = now(), verified_by = auth.uid(),
      verification_method = 'code', verification_note = null
  where id = p_profile_id;
  delete from public.verification_codes where profile_id = p_profile_id;
end;
$$;

-- Older app versions: still works, recorded as a PlayHQ match with no note.
create or replace function public.admin_mark_verified(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can verify members';
  end if;
  update public.profiles
  set verified_at = now(), verified_by = auth.uid(), verification_method = 'playhq'
  where id = p_profile_id and verified_at is null;
  delete from public.verification_codes where profile_id = p_profile_id;
end;
$$;

-- An admin records checking someone without a code: against the PlayHQ
-- registration or by sighting ID, and what they checked.
create or replace function public.admin_record_verification(
  p_profile_id uuid,
  p_method text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can verify members';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to verify you';
  end if;
  if p_method is null or p_method not in ('playhq', 'id_sighted') then
    raise exception 'Choose how you checked who they are';
  end if;
  if v_note is null then
    raise exception 'Write what you checked, for example which PlayHQ registration matched';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;
  update public.profiles
  set verified_at = now(), verified_by = auth.uid(),
      verification_method = p_method, verification_note = v_note
  where id = p_profile_id and verified_at is null;
  if not found then
    raise exception 'They''re already verified, or not a member';
  end if;
  delete from public.verification_codes where profile_id = p_profile_id;
end;
$$;

revoke execute on function public.admin_record_verification(uuid, text, text) from public, anon;
grant execute on function public.admin_record_verification(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Guardian link history
-- ---------------------------------------------------------------------------

-- Ids are kept without foreign keys so the record outlives the members;
-- names are kept as they were.
create table if not exists public.guardianship_history (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null,
  guardian_name text,
  athlete_id uuid not null,
  athlete_name text,
  change text not null check (change in ('linked', 'unlinked')),
  reason text check (length(reason) <= 500),
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index if not exists guardianship_history_athlete_idx
  on public.guardianship_history (athlete_id, changed_at desc);
create index if not exists guardianship_history_guardian_idx
  on public.guardianship_history (guardian_id, changed_at desc);

-- Written only by the trigger below.
alter table public.guardianship_history enable row level security;

drop policy if exists "Admins see guardian link history" on public.guardianship_history;
create policy "Admins see guardian link history"
  on public.guardianship_history for select to authenticated
  using (public.is_admin());

grant select on public.guardianship_history to authenticated;

-- A member's name for records and notices.
create or replace function public.member_display_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(p.preferred_name), ''), nullif(trim(p.full_name), ''), p.email)
  from public.profiles p where p.id = p_profile_id;
$$;

revoke execute on function public.member_display_name(uuid) from public, anon;

-- Records a link or unlink, and tells the family: the child's guardians, and
-- the child if they're 13 or over and a guardian is copied.
create or replace function public.guardianship_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guardian_id uuid := case when tg_op = 'INSERT' then new.guardian_id else old.guardian_id end;
  v_athlete_id uuid := case when tg_op = 'INSERT' then new.athlete_id else old.athlete_id end;
  v_change text := case when tg_op = 'INSERT' then 'linked' else 'unlinked' end;
  v_guardian text := coalesce(public.member_display_name(v_guardian_id), 'A former member');
  v_athlete public.profiles;
  v_athlete_name text := coalesce(public.member_display_name(v_athlete_id), 'A former member');
  v_by text := public.member_display_name(auth.uid());
  v_reason text := nullif(current_setting('app.guardian_reason', true), '');
  v_recipients uuid[];
  v_message_id uuid;
begin
  insert into public.guardianship_history (
    guardian_id, guardian_name, athlete_id, athlete_name, change, reason, changed_by, changed_by_name
  )
  values (
    v_guardian_id, v_guardian, v_athlete_id, v_athlete_name, v_change, v_reason, auth.uid(), v_by
  );

  -- No notice when the child is leaving or has left the club, or isn't
  -- approved.
  select * into v_athlete from public.profiles where id = v_athlete_id;
  if v_athlete.id is null or v_athlete.status <> 'approved'
     or v_athlete_id::text = current_setting('app.deleting_profile', true) then
    return null;
  end if;

  select coalesce(array_agg(g.guardian_id), '{}') into v_recipients
  from public.guardianships g
  join public.profiles p on p.id = g.guardian_id and p.status = 'approved'
  where g.athlete_id = v_athlete_id;
  if cardinality(v_recipients) = 0 then
    return null;
  end if;
  if v_athlete.date_of_birth is not null
     and v_athlete.date_of_birth <= current_date - interval '13 years' then
    v_recipients := v_recipients || v_athlete.id;
  end if;

  insert into public.messages (sender_id, sender_name, body, audience, audience_label)
  values (
    null,
    'Club safeguarding',
    case v_change
      when 'linked' then
        v_guardian || ' is now linked to ' || v_athlete_name || ' as a parent or guardian. '
        || 'Guardians can see ' || v_athlete_name
        || '''s injuries, check-ins, goals and messages from the club.'
      else
        v_guardian || ' is no longer linked to ' || v_athlete_name || ' as a parent or guardian.'
    end
    || case when v_by is not null
         then ' Changed by ' || v_by || ' on '
           || to_char(now() at time zone 'Australia/Perth', 'DD/MM/YYYY') || '.'
         else '' end
    || ' If this isn''t right, tell the club''s Child Safety Officer or an admin.',
    'notice',
    'Parents and guardians of ' || v_athlete_name
  )
  returning id into v_message_id;

  insert into public.message_recipients (message_id, profile_id)
  select v_message_id, r from unnest(v_recipients) as r
  on conflict do nothing;

  return null;
end;
$$;

revoke execute on function public.guardianship_changed() from public, anon;

drop trigger if exists guardianship_changed on public.guardianships;
create trigger guardianship_changed
  after insert or delete on public.guardianships
  for each row execute function public.guardianship_changed();

-- When a member is deleted, their links are removed first, while their name
-- can still be read, so the history keeps it.
create or replace function public.profile_deleting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.deleting_profile', old.id::text, true);
  delete from public.guardianships where guardian_id = old.id or athlete_id = old.id;
  perform set_config('app.deleting_profile', '', true);
  return old;
end;
$$;

revoke execute on function public.profile_deleting() from public, anon;

drop trigger if exists profile_deleting on public.profiles;
create trigger profile_deleting
  before delete on public.profiles
  for each row execute function public.profile_deleting();

-- ---------------------------------------------------------------------------
-- Saving a member: only real changes, with an optional reason, and never by
-- an admin who is one of the child's guardians
-- ---------------------------------------------------------------------------

drop function if exists public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[]
);

create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null,
  p_extra_roles public.app_role[] default '{}',
  p_guardian_reason text default null
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
  v_was_admin boolean;
  v_current_guardians uuid[];
  v_new_guardians uuid[];
  v_exempt_reason text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  v_extra := v_roles[2:];
  select
    date_of_birth,
    status = 'approved' and 'committee' = any (public.roles_of(role, extra_roles)),
    status = 'approved' and 'admin' = any (public.roles_of(role, extra_roles)),
    wwcc_exempt_reason
  into v_date_of_birth, v_was_committee, v_was_admin, v_exempt_reason
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
  -- The same for admins, who can read every child's records. Admins approved
  -- before this keep their access; the to-do list asks for their check.
  if p_status = 'approved' and 'admin' = any (v_roles) and not coalesce(v_was_admin, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check, or exempt them with a reason, before making them an admin';
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

  -- Guardian links: only the ones that change are added or removed, so the
  -- history (written by a trigger) shows real changes, with the reason.
  if length(p_guardian_reason) > 500 then
    raise exception 'Keep the reason under 500 characters';
  end if;
  perform set_config('app.guardian_reason', coalesce(nullif(trim(p_guardian_reason), ''), ''), true);
  select coalesce(array_agg(guardian_id order by guardian_id), '{}') into v_current_guardians
  from public.guardianships where athlete_id = p_profile_id;
  select coalesce(array_agg(distinct g.id order by g.id), '{}') into v_new_guardians
  from unnest(case when p_status = 'approved' then v_guardian_ids else '{}'::uuid[] end) as g (id);
  -- A parent who is also an admin doesn't decide who else is their child's
  -- guardian: another admin does.
  if v_current_guardians is distinct from v_new_guardians
     and auth.uid() = any (v_current_guardians || v_new_guardians) then
    raise exception 'You''re one of their guardians, so another admin needs to change who their guardians are';
  end if;
  delete from public.guardianships
  where athlete_id = p_profile_id and not guardian_id = any (v_new_guardians);
  if not 'guardian' = any (v_roles) or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  insert into public.guardianships (guardian_id, athlete_id)
  select g.id, p_profile_id from unnest(v_new_guardians) as g (id)
  on conflict do nothing;
  perform set_config('app.guardian_reason', '', true);

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

revoke execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text
) from public, anon;
grant execute on function public.admin_save_member(
  uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text
) to authenticated;

commit;
