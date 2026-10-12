-- Security follow-ups decided after the 12 October review (findings 8, 9, 11,
-- 14 and 17). Only functions are replaced; no rows are touched.

-- ---------------------------------------------------------------------------
-- A physio sees only their own squads and teams; only the Head Physio sees
-- every athlete. A physio who is in no squad or team sees nobody until an
-- admin places them or makes them Head Physio.
-- ---------------------------------------------------------------------------

create or replace function public.physio_looks_after(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_physio()
    and exists (select 1 from public.profiles where id = p_athlete_id)
    and (
      public.is_head_physio()
      or exists (
        select 1 from public.team_members me
        join public.teams t on t.id = me.team_id
        join public.team_members a on a.team_id = me.team_id
        where me.profile_id = auth.uid() and me.team_role = 'physio' and not t.archived
          and a.profile_id = p_athlete_id and a.team_role = 'athlete'
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Admins can't check or record their own date of birth, card or identity
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
declare
  v_number text := nullif(upper(trim(p_wwcc_number)), '');
  v_member public.profiles;
  v_new_card boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_date_of_birth is not null
     and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'That date of birth doesn''t look right';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to change your date of birth or card details';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  v_new_card := v_member.wwcc_number is distinct from v_number
    or v_member.wwcc_expires_on is distinct from p_wwcc_expires_on;
  -- Cards last three years, so a later expiry is a typing mistake.
  if v_new_card and p_wwcc_expires_on > (current_date + interval '3 years')::date then
    raise exception 'A Working With Children Check lasts three years. Check the expiry date on the card';
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
      wwcc_number = v_number,
      wwcc_expires_on = p_wwcc_expires_on,
      -- A different card hasn't been validated or linked yet.
      wwcc_validated_at = case when v_new_card then null else wwcc_validated_at end,
      wwcc_validated_by = case when v_new_card then null else wwcc_validated_by end,
      wwcc_validation_method = case when v_new_card then null else wwcc_validation_method end,
      wwcc_unit_linked_at = case when v_new_card then null else wwcc_unit_linked_at end
  where id = p_profile_id;
end;
$$;

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
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to verify you';
  end if;
  update public.profiles
  set verified_at = now(), verified_by = auth.uid()
  where id = p_profile_id and verified_at is null;
  delete from public.verification_codes where profile_id = p_profile_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A member always has a name before they are approved, so other members never
-- see an email address in its place
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
  v_was_admin boolean;
  v_exempt_reason text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_status = 'approved' and not exists (
    select 1 from public.profiles where id = p_profile_id and nullif(trim(full_name), '') is not null
  ) then
    raise exception 'They have no name yet. Ask them to add their name before approving them';
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

-- ---------------------------------------------------------------------------
-- A push token held by another member isn't moved: signing out of the app
-- releases it, so the phone's next member registers it then.
-- ---------------------------------------------------------------------------

create or replace function public.register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'Not an Expo push token';
  end if;
  if exists (
    select 1 from public.push_tokens where token = p_token and profile_id <> auth.uid()
  ) then
    raise exception 'This phone is still signed in to another member';
  end if;
  insert into public.push_tokens (token, profile_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set platform = excluded.platform,
        updated_at = now()
    where public.push_tokens.profile_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Awards with a winner for each team or squad are for the people in it: only
-- they vote, and "all members" means the members of that squad or team. Club
-- awards stay open to everyone, or to the roles chosen.
-- ---------------------------------------------------------------------------

-- True when the member is in this squad or team: in it directly, in the squad
-- it belongs to, or in one of its teams.
create or replace function public.in_award_group(p_profile_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams g on g.id = p_team_id
    where tm.profile_id = p_profile_id
      and (tm.team_id = g.id or tm.team_id = g.squad_id
        or tm.team_id in (select c.id from public.teams c where c.squad_id = g.id))
  );
$$;
revoke execute on function public.in_award_group(uuid, uuid) from public, anon, authenticated;

create or replace function public.award_voters(p_award_id uuid, p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.awards a
  join public.profiles p
    on p.status = 'approved' and not public.is_view_only_member(p.role, p.extra_roles)
  where a.id = p_award_id
    and (
      ('member' = any (a.voter_roles)
        -- An award with a winner for each team or squad is for the people in it.
        and (not a.per_group or public.in_award_group(p.id, p_team_id)))
      -- Committee, admin and partner aren't tied to a group.
      or exists (
        select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
        where r::text = any (a.voter_roles)
          and (a.club_wide or r in ('committee', 'admin', 'partner'))
      )
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = p.id
          and tm.team_role::text = any (a.voter_roles)
          and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
      )
    );
$$;

create or replace function public.award_nominee_pool(p_award_id uuid, p_team_id uuid)
returns table (id uuid, is_candidate boolean, name text, date_of_birth date)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, false, coalesce(nullif(p.full_name, ''), p.email), p.date_of_birth
  from public.awards a
  join public.team_members tm
    on tm.team_role = case a.nominees when 'coaches' then 'coach'::public.team_role
                                      else 'athlete'::public.team_role end
  join public.profiles p on p.id = tm.profile_id and p.status = 'approved'
  where a.id = p_award_id
    and a.nominees in ('athletes', 'coaches')
    and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
    and p.id is distinct from auth.uid()
  union all
  select p.id, false, coalesce(nullif(p.full_name, ''), p.email), p.date_of_birth
  from public.awards a
  join public.profiles p on p.status = 'approved' and p.role <> 'guest'
  where a.id = p_award_id
    and a.nominees = 'members'
    and (not a.per_group or exists (
      select 1 from public.team_members tm
      join public.teams g on g.id = p_team_id
      where tm.profile_id = p.id
        and (tm.team_id = g.id or tm.team_id in (select c.id from public.teams c where c.squad_id = g.id))
    ))
    and p.id is distinct from auth.uid()
  union all
  select c.id, true, c.name, null::date
  from public.awards a
  join public.award_candidates c on c.award_id = a.id
  where a.id = p_award_id
    and a.nominees = 'listed';
$$;
revoke execute on function public.award_nominee_pool(uuid, uuid) from public, anon, authenticated;
