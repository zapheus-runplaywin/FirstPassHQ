-- Parent and under-18 volunteers don't need a Working With Children Check.
--
-- In WA a parent volunteering at the club their own child is involved in, and
-- any volunteer under 18, are exempt from the check and can't apply for one.
-- Until now the app demanded a card from every coach, manager and physio, so
-- these volunteers couldn't be approved without a made-up card.
--
-- An admin now records an exemption instead: "parent volunteer" (with the
-- child, who must be an approved athlete under 18 they're a guardian of) or
-- "under-18 volunteer" (who needs a date of birth showing they're under 18).
-- The volunteer then accepts a declaration in the app, like the Screening
-- Unit's volunteer declaration: no notice, no adverse interstate decision,
-- unpaid, and they'll tell the club if that changes. Until they accept it,
-- their coach, manager and physio roles stay paused.
--
-- The exemption ends by itself when the child turns 18, stops being an
-- athlete at the club or is unlinked, or when the volunteer turns 18. Their
-- roles then pause like an expired check, and admins hear about it 60 days
-- ahead. Every exemption is kept, with who recorded it, the declaration they
-- accepted and when it ended.
--
-- Committee exemptions (wwcc_exempt_reason) are unchanged.
--
-- Additive only: a new type, a new table, new functions, and new versions of
-- can_work_with_children, has_role, admin_save_member and admin_safety_todos
-- (whose result gains a column, so it's dropped and created again; it holds
-- no data).

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'volunteer_exemption'
                 and typnamespace = 'public'::regnamespace) then
    create type public.volunteer_exemption as enum ('parent_volunteer', 'under_18_volunteer');
  end if;
end;
$$;

create table if not exists public.volunteer_exemptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  basis public.volunteer_exemption not null,
  -- The volunteer's child, for a parent volunteer.
  child_id uuid references public.profiles (id) on delete set null,
  child_name text,
  set_by uuid references public.profiles (id) on delete set null,
  set_by_name text,
  set_at timestamptz not null default now(),
  -- The declaration the volunteer accepted, word for word.
  declared_at timestamptz,
  declaration_text text,
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  ended_by_name text,
  end_note text check (length(end_note) <= 1000),
  check ((basis = 'parent_volunteer') = (child_name is not null))
);

create unique index if not exists volunteer_exemptions_one_open_idx
  on public.volunteer_exemptions (profile_id) where ended_at is null;

alter table public.volunteer_exemptions enable row level security;

drop policy if exists "Volunteers and admins see exemptions" on public.volunteer_exemptions;
create policy "Volunteers and admins see exemptions"
  on public.volunteer_exemptions for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Whether an exemption still applies
-- ---------------------------------------------------------------------------

-- A member's open exemption: whether it applies today (declared, and the
-- child or volunteer still under 18 and still linked), and the day it ends
-- by itself, when that's known.
create or replace function public.volunteer_exemption_state(p_profile_id uuid)
returns table (
  exemption_id uuid,
  basis public.volunteer_exemption,
  declared boolean,
  valid boolean,
  ends_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.basis,
    e.declared_at is not null,
    e.declared_at is not null and case e.basis
      when 'under_18_volunteer' then
        v.date_of_birth is not null and public.is_minor(v.date_of_birth, false)
      when 'parent_volunteer' then exists (
        select 1 from public.profiles c
        join public.guardianships g on g.athlete_id = c.id and g.guardian_id = e.profile_id
        where c.id = e.child_id and c.status = 'approved'
          and 'athlete' = any (public.roles_of(c.role, c.extra_roles))
          and public.is_minor(c.date_of_birth, c.under_17)
      )
    end,
    case e.basis
      when 'under_18_volunteer' then (v.date_of_birth + interval '18 years')::date
      else (select (c.date_of_birth + interval '18 years')::date
            from public.profiles c where c.id = e.child_id)
    end
  from public.volunteer_exemptions e
  join public.profiles v on v.id = e.profile_id
  where e.profile_id = p_profile_id and e.ended_at is null;
$$;

revoke execute on function public.volunteer_exemption_state(uuid) from public, anon, authenticated;

-- Screened for working with children: a current check, or an exemption that
-- still applies.
create or replace function public.is_cleared(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_current_wwcc(p_profile_id)
    or coalesce((select s.valid from public.volunteer_exemption_state(p_profile_id) s), false);
$$;

revoke execute on function public.is_cleared(uuid) from public, anon, authenticated;

-- The declaration a volunteer accepts, in the words they see.
create or replace function public.volunteer_declaration(
  p_basis public.volunteer_exemption,
  p_child_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_basis
    when 'parent_volunteer' then
      'I volunteer at this club because my child, ' || coalesce(p_child_name, 'my child')
      || ', is involved in it, and I''m not paid for this role. '
    else
      'I''m under 18 and I volunteer at this club without being paid. '
  end
  || 'I don''t have a Negative Notice or an Interim Negative Notice under the Working with '
  || 'Children (Screening) Act 2004 (WA), and no other state or territory has refused, '
  || 'suspended or cancelled a working with children clearance for me. I''ll tell a club '
  || 'admin straight away if any of that changes. '
  || case p_basis
    when 'parent_volunteer' then
      'I understand this exemption ends when ' || coalesce(p_child_name, 'my child')
      || ' turns 18 or leaves the club, and doesn''t cover overnight camps.'
    else
      'I understand this exemption ends on my 18th birthday, and I''ll need a Working With '
      || 'Children Check to keep volunteering after that.'
  end;
$$;

revoke execute on function public.volunteer_declaration(public.volunteer_exemption, text) from public, anon;
grant execute on function public.volunteer_declaration(public.volunteer_exemption, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording, accepting and ending exemptions
-- ---------------------------------------------------------------------------

-- Records an exemption for a member. Ends any other exemption they have. The
-- same exemption again changes nothing. Admins can't exempt themselves.
create or replace function public.admin_set_volunteer_exemption(
  p_profile_id uuid,
  p_basis public.volunteer_exemption,
  p_child_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_child public.profiles;
  v_open public.volunteer_exemptions;
  v_has_open boolean;
  v_me text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record exemptions';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  if p_basis = 'under_18_volunteer' then
    if v_member.date_of_birth is null then
      raise exception 'Add their date of birth first';
    end if;
    if not public.is_minor(v_member.date_of_birth, false) then
      raise exception 'They''re 18 or over, so they need a Working With Children Check';
    end if;
    p_child_id := null;
  else
    select * into v_child from public.profiles where id = p_child_id;
    if not found or v_child.status <> 'approved'
       or not 'athlete' = any (public.roles_of(v_child.role, v_child.extra_roles))
       or not public.is_minor(v_child.date_of_birth, v_child.under_17) then
      raise exception 'Choose their child: an athlete under 18 in the club';
    end if;
    if not exists (
      select 1 from public.guardianships
      where guardian_id = p_profile_id and athlete_id = p_child_id
    ) then
      raise exception 'Link them as a guardian of that athlete first';
    end if;
  end if;

  select * into v_open from public.volunteer_exemptions
  where profile_id = p_profile_id and ended_at is null
  for update;
  v_has_open := found;
  if v_has_open and v_open.basis = p_basis and v_open.child_id is not distinct from p_child_id then
    return;
  end if;

  select coalesce(nullif(trim(full_name), ''), email) into v_me
  from public.profiles where id = auth.uid();

  if v_has_open then
    update public.volunteer_exemptions
    set ended_at = now(), ended_by = auth.uid(), ended_by_name = v_me,
        end_note = 'Replaced by a new exemption'
    where id = v_open.id;
  end if;

  insert into public.volunteer_exemptions (profile_id, basis, child_id, child_name, set_by, set_by_name)
  values (
    p_profile_id, p_basis, p_child_id,
    case when p_basis = 'parent_volunteer'
      then coalesce(nullif(trim(v_child.preferred_name), ''), nullif(trim(v_child.full_name), ''), 'their child')
    end,
    auth.uid(), v_me
  );
end;
$$;

revoke execute on function public.admin_set_volunteer_exemption(uuid, public.volunteer_exemption, uuid) from public, anon;
grant execute on function public.admin_set_volunteer_exemption(uuid, public.volunteer_exemption, uuid) to authenticated;

-- Ends a member's exemption, for example once they record a check.
create or replace function public.admin_end_volunteer_exemption(p_profile_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can end exemptions';
  end if;
  if length(p_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;
  update public.volunteer_exemptions
  set ended_at = now(),
      ended_by = auth.uid(),
      ended_by_name = (select coalesce(nullif(trim(full_name), ''), email)
                       from public.profiles where id = auth.uid()),
      end_note = nullif(trim(p_note), '')
  where profile_id = p_profile_id and ended_at is null;
end;
$$;

revoke execute on function public.admin_end_volunteer_exemption(uuid, text) from public, anon;
grant execute on function public.admin_end_volunteer_exemption(uuid, text) to authenticated;

-- The signed-in member accepts the declaration for their exemption. The
-- words are kept with the exemption.
create or replace function public.accept_volunteer_declaration()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.volunteer_exemptions;
begin
  select * into v_open from public.volunteer_exemptions
  where profile_id = auth.uid() and ended_at is null
  for update;
  if not found then
    raise exception 'There''s no exemption waiting for you to accept';
  end if;
  if v_open.declared_at is not null then
    return;
  end if;
  update public.volunteer_exemptions
  set declared_at = now(),
      declaration_text = public.volunteer_declaration(v_open.basis, v_open.child_name)
  where id = v_open.id;
end;
$$;

revoke execute on function public.accept_volunteer_declaration() from public, anon;
grant execute on function public.accept_volunteer_declaration() to authenticated;

-- The signed-in member's exemption: what it is, the declaration (accepted,
-- or waiting to be), whether it applies today and when it ends.
create or replace function public.my_volunteer_exemption()
returns table (
  basis public.volunteer_exemption,
  child_name text,
  declared_at timestamptz,
  declaration_text text,
  valid boolean,
  ends_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.basis,
    e.child_name,
    e.declared_at,
    coalesce(e.declaration_text, public.volunteer_declaration(e.basis, e.child_name)),
    s.valid,
    s.ends_on
  from public.volunteer_exemptions e
  join public.volunteer_exemption_state(auth.uid()) s on s.exemption_id = e.id;
$$;

revoke execute on function public.my_volunteer_exemption() from public, anon;
grant execute on function public.my_volunteer_exemption() to authenticated;

-- Every exemption, open ones first, with whether each open one applies today,
-- for the admin's member screens and the check report.
create or replace function public.admin_volunteer_exemptions()
returns table (
  id uuid,
  profile_id uuid,
  basis public.volunteer_exemption,
  child_id uuid,
  child_name text,
  set_by_name text,
  set_at timestamptz,
  declared_at timestamptz,
  declaration_text text,
  ended_at timestamptz,
  ended_by_name text,
  end_note text,
  valid boolean,
  ends_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.profile_id, e.basis, e.child_id, e.child_name, e.set_by_name, e.set_at,
    e.declared_at, e.declaration_text, e.ended_at, e.ended_by_name, e.end_note,
    coalesce(s.valid, false), s.ends_on
  from public.volunteer_exemptions e
  left join lateral public.volunteer_exemption_state(e.profile_id) s
    on s.exemption_id = e.id
  where public.is_admin()
  order by e.ended_at is not null, e.set_at desc;
$$;

revoke execute on function public.admin_volunteer_exemptions() from public, anon;
grant execute on function public.admin_volunteer_exemptions() to authenticated;

-- ---------------------------------------------------------------------------
-- Rights: a current check or an exemption that applies
-- ---------------------------------------------------------------------------

-- Whether the signed-in member may work with children as a coach, manager or
-- physio right now: approved, not stood down, and holding a current check or
-- an exemption that applies.
create or replace function public.can_work_with_children()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and stood_down_at is null
  ) and public.is_cleared(auth.uid());
$$;

-- As before, except coach, manager and physio accept an exemption that
-- applies in place of a check.
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved'
      and (p.role = p_role or p_role = any (p.extra_roles))
      and case
        when p_role in ('coach', 'manager', 'physio') then
          p.stood_down_at is null and public.is_cleared(p.id)
        when p_role = 'committee' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or coalesce(trim(p.wwcc_number), '') = ''
            or public.has_current_wwcc(p.id)
          )
        when p_role = 'admin' then p.stood_down_at is null
        else true
      end
  );
$$;

-- As before, except a coach, manager or physio can be approved with a
-- volunteer exemption instead of a check. Their roles stay paused until the
-- exemption applies (they've accepted the declaration).
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

-- Admin to-dos gain exemptions ending within 60 days. Members whose exemption
-- doesn't apply (not accepted yet, or ended) count as missing a check.
drop function if exists public.admin_safety_todos();
create function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer,
  exemptions_ending integer
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
    )::int
  from members m;
$$;

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

commit;
