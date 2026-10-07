-- Child safety.
--
-- Anyone under 18 is a minor. An admin records each athlete's date of birth,
-- and an athlete under 18 can't be approved until at least one verified
-- guardian is linked to them. When no date of birth is recorded yet, the
-- admin's "under 18" choice (the under_17 column, which now means under 18)
-- is used instead.
--
-- Coaches and managers need a current Working With Children Check before an
-- admin can approve them or change their squads.
--
-- Guardians get a copy of every group message sent to their child.
--
-- Additive only: new columns, new functions and replaced functions. No rows
-- are changed.

alter table public.profiles
  add column if not exists date_of_birth date,
  -- Working With Children Check, recorded by admins for coaches and managers.
  add column if not exists wwcc_number text check (length(wwcc_number) <= 30),
  add column if not exists wwcc_expires_on date;

-- ---------------------------------------------------------------------------
-- Who is a minor
-- ---------------------------------------------------------------------------

-- Under 18 today, from the date of birth when there is one, otherwise from the
-- admin's "under 18" choice.
create or replace function public.is_minor(p_date_of_birth date, p_under_18 boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_date_of_birth is not null then p_date_of_birth > current_date - interval '18 years'
    else coalesce(p_under_18, false)
  end;
$$;

revoke execute on function public.is_minor(date, boolean) from public, anon;
grant execute on function public.is_minor(date, boolean) to authenticated;

-- A Working With Children Check that is recorded and not expired.
create or replace function public.has_current_wwcc(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_profile_id
      and coalesce(trim(wwcc_number), '') <> ''
      and wwcc_expires_on >= current_date
  );
$$;

revoke execute on function public.has_current_wwcc(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Records a member's date of birth and Working With Children Check. Called
-- before admin_save_member, which checks them.
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
  set date_of_birth = p_date_of_birth,
      wwcc_number = nullif(upper(trim(p_wwcc_number)), ''),
      wwcc_expires_on = p_wwcc_expires_on
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

revoke execute on function public.admin_set_member_details(uuid, date, text, date) from public, anon;
grant execute on function public.admin_set_member_details(uuid, date, text, date) to authenticated;

-- For when an admin has matched someone to their PlayHQ registration instead
-- of checking a code in person. Guardians must be verified one way or the
-- other before they can be linked to a child.
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
  set verified_at = now(), verified_by = auth.uid()
  where id = p_profile_id and verified_at is null;
  delete from public.verification_codes where profile_id = p_profile_id;
end;
$$;

revoke execute on function public.admin_mark_verified(uuid) from public, anon;
grant execute on function public.admin_mark_verified(uuid) to authenticated;

-- Same as before, plus the child-safety rules:
-- - an athlete is a minor by date of birth, or by the admin's choice when
--   there is none (p_under_17 now means under 18);
-- - an approved minor needs at least one guardian;
-- - a newly linked guardian must be verified;
-- - approved coaches and managers need a current Working With Children Check.
create or replace function public.admin_save_member(
  p_profile_id uuid,
  p_role public.app_role,
  p_status public.member_status,
  p_teams jsonb default '[]'::jsonb,
  p_under_17 boolean default false,
  p_guardian_ids uuid[] default '{}',
  p_rejection_reason public.rejection_reason default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_role public.team_role;
  v_date_of_birth date;
  v_under_17 boolean;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  select date_of_birth into v_date_of_birth from public.profiles where id = p_profile_id;
  v_under_17 := p_role = 'athlete' and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
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
      where p.id = g.id and p.role = 'guardian' and p.status = 'approved'
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
  if p_status = 'approved' and v_under_17 and cardinality(v_guardian_ids) = 0 then
    raise exception 'Link at least one verified guardian before approving an athlete under 18';
  end if;
  if p_status = 'approved' and p_role in ('coach', 'manager')
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check before approving a coach or manager';
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
  if p_role <> 'guardian' or p_status <> 'approved' then
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
  if p_role not in ('coach', 'manager', 'athlete', 'guardian') then
    raise exception 'Only coaches, managers, athletes and guardians can be added to a squad or team';
  end if;
  v_team_role := p_role::text::public.team_role;

  -- Teams are named from a squad, so a member of a team must be in its squad.
  if exists (
    select 1
    from jsonb_array_elements(p_teams) as t
    join public.teams g on g.id = (t ->> 'team_id')::uuid
    where g.kind = 'team'
      and not exists (
        select 1 from jsonb_array_elements(p_teams) as s
        where (s ->> 'team_id')::uuid = g.squad_id
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    g.id,
    p_profile_id,
    v_team_role,
    case when p_role = 'coach'
      then coalesce((t ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p_role = 'athlete' and g.kind = 'team'
      then coalesce((t ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(p_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;
end;
$$;

-- What admins need to follow up, for their to-do list.
create or replace function public.admin_safety_todos()
returns table (
  wwcc_missing int,
  wwcc_expiring int,
  minors_without_guardian int,
  turning_18 int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (
      where p.role in ('coach', 'manager') and not public.has_current_wwcc(p.id)
    )::int,
    count(*) filter (
      where p.role in ('coach', 'manager') and public.has_current_wwcc(p.id)
        and p.wwcc_expires_on < current_date + 30
    )::int,
    count(*) filter (
      where p.role = 'athlete' and public.is_minor(p.date_of_birth, p.under_17)
        and not exists (select 1 from public.guardianships g where g.athlete_id = p.id)
    )::int,
    count(*) filter (
      where p.role = 'athlete' and p.date_of_birth is not null
        and public.is_minor(p.date_of_birth, p.under_17)
        and p.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int
  from public.profiles p
  where p.status = 'approved' and public.is_admin();
$$;

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

-- ---------------------------------------------------------------------------
-- Guardians get a copy of group messages sent to their child
-- ---------------------------------------------------------------------------

create or replace function public.send_group_message(
  p_body text,
  p_audience public.message_audience,
  p_role public.app_role default null,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_sender public.profiles;
  v_team public.teams;
  v_message_id uuid;
  v_count int;
begin
  select * into v_sender from public.profiles where id = auth.uid();
  if v_sender.id is null or v_sender.status <> 'approved' then
    raise exception 'Only approved members can send messages';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Messages can be up to 4000 characters';
  end if;

  if p_audience in ('club', 'role') then
    if not public.is_admin() then
      raise exception 'Only admins can message the whole club or a role';
    end if;
    if p_audience = 'role' and p_role is null then
      raise exception 'Choose a role to message';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach or manage';
    end if;
  end if;

  insert into public.messages (
    sender_id, sender_name, body, audience, audience_role, team_id, audience_label
  )
  values (
    v_sender.id,
    coalesce(nullif(v_sender.full_name, ''), v_sender.email),
    v_body,
    p_audience,
    case when p_audience = 'role' then p_role end,
    v_team.id,
    v_team.name
  )
  returning id into v_message_id;

  with audience as (
    select p.id, p.role, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role
        else exists (
          select 1 from public.team_members tm
          where tm.team_id = v_team.id and tm.profile_id = p.id
        )
      end
  )
  insert into public.message_recipients (message_id, profile_id)
  select v_message_id, r.id
  from (
    select a.id from audience a
    union
    -- Guardians of children who received it.
    select g.guardian_id
    from audience a
    join public.guardianships g on g.athlete_id = a.id
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where a.role = 'athlete' and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  return v_message_id;
end;
$$;
