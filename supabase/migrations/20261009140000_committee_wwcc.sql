-- Committee members need a Working With Children Check too.
--
-- Committee members now need a current check, like coaches, managers and
-- physios. An admin can exempt an individual committee member instead, with a
-- written reason; the app records who exempted them and when. The exemption
-- only covers the committee role: a committee member who also coaches still
-- needs a check.
--
-- Committee members who are already approved keep their access. Those
-- without a check or an exemption show on the admin's to-do list until one is
-- recorded. Only people newly made committee members are refused without one.
--
-- Additive only: three new nullable columns, a new function, and new
-- versions of admin_safety_todos and admin_save_member.

begin;

alter table public.profiles
  add column if not exists wwcc_exempt_reason text
    check (length(wwcc_exempt_reason) <= 500),
  add column if not exists wwcc_exempted_by uuid
    references public.profiles (id) on delete set null,
  add column if not exists wwcc_exempted_at timestamptz;

-- Whether someone holding these roles needs a current check. Same rule as
-- `needsWwcc` in src/lib/safety.ts.
create or replace function public.needs_wwcc(p_roles public.app_role[], p_exempt_reason text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_roles && array['coach', 'manager', 'physio']::public.app_role[]
    or ('committee' = any (p_roles) and coalesce(trim(p_exempt_reason), '') = '');
$$;

revoke execute on function public.needs_wwcc(public.app_role[], text) from public, anon;
grant execute on function public.needs_wwcc(public.app_role[], text) to authenticated;

-- Exempts a member from the committee check, with the reason. A blank reason
-- takes the exemption away. Admins can't exempt themselves.
create or replace function public.admin_set_wwcc_exemption(p_profile_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(p_reason), '');
  v_current text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can exempt members from the check';
  end if;
  select wwcc_exempt_reason into v_current from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_reason is not distinct from v_current then
    return;
  end if;
  if v_reason is not null and p_profile_id = auth.uid() then
    raise exception 'Ask another admin to exempt you from the check';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters';
  end if;

  update public.profiles
  set wwcc_exempt_reason = v_reason,
      wwcc_exempted_by = case when v_reason is null then null else auth.uid() end,
      wwcc_exempted_at = case when v_reason is null then null else now() end
  where id = p_profile_id;
end;
$$;

revoke execute on function public.admin_set_wwcc_exemption(uuid, text) from public, anon;
grant execute on function public.admin_set_wwcc_exemption(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin to-dos: committee members without a check or an exemption
-- ---------------------------------------------------------------------------

create or replace function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer
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
        and not public.has_current_wwcc(m.id)
    )::int,
    count(*) filter (
      where public.needs_wwcc(m.roles, m.wwcc_exempt_reason)
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 30
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and not exists (select 1 from public.guardianships g where g.athlete_id = m.id)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is not null
        and public.is_minor(m.date_of_birth, m.under_17)
        and m.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int
  from members m;
$$;

-- ---------------------------------------------------------------------------
-- Saving a member: new committee members need a check or an exemption
-- ---------------------------------------------------------------------------

-- p_teams is a list of {team_id, team_role?, coach_title?, selection?}. A
-- missing team_role means their main role, or their first other role that
-- belongs in a squad or team.
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
  if p_status = 'approved' and v_under_17 and cardinality(v_guardian_ids) = 0 then
    raise exception 'Link at least one verified guardian before approving an athlete under 18';
  end if;
  if p_status = 'approved' and v_roles && array['coach', 'manager', 'physio']::public.app_role[]
     and not public.has_current_wwcc(p_profile_id) then
    raise exception 'Record a current Working With Children Check before approving a coach, manager or physio';
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
  where r in ('coach', 'manager', 'athlete', 'guardian')
  order by n
  limit 1;
  if v_default_team_role is null then
    raise exception 'Only coaches, managers, athletes and guardians can be added to a squad or team';
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
       or p ->> 'team_role' not in ('coach', 'manager', 'athlete', 'guardian')
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

commit;
