-- Customer review, Batch G (Matt, 23 October 2026).
--
-- 1. Statisticians need a Working With Children Check, like managers. In WA a
--    check is needed for work that usually involves, or is likely to involve,
--    contact with children, and a statistician often sits courtside at
--    junior games. A current check, a lodged application or a volunteer
--    exemption (such as a parent at their child's games) counts, and an admin
--    can exempt a statistician with a reason, such as "opens games only", as
--    for committee members. Statisticians approved before this keep the role
--    until the club's "Statistician checks required from" date, 90 days after
--    this migration runs, which admins can bring forward but not push back.
--    The statistician role then pauses without one, in HQ and in Vantage
--    (which asks has_role through is_statistician).
--
-- 2. C8: an admin whose check has expired, or who has none, keeps every admin
--    power (the club is never locked out) but stops seeing under 18s'
--    injuries, and accepting their clearances, 30 days after the card expired
--    or, with no card recorded, 30 days after the club's committee checks
--    date. A current check, a lodged application in force or a volunteer
--    exemption that applies brings it back. As for committee members (C6), an
--    exemption with a written reason doesn't count for children's injuries.
--    Admins never saw individual check-ins, so nothing else changes.
--
-- Additive only: a new column with a default, new functions, and new
-- versions of needs_wwcc, has_role, committee_sees_injuries_of and
-- admin_save_member. No rows are changed or removed.

begin;

alter table public.safeguarding_settings
  add column if not exists statistician_checks_from date not null default (current_date + 90);

-- The day from which statisticians need a check or an exemption.
create or replace function public.statistician_checks_from()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select s.statistician_checks_from from public.safeguarding_settings s where s.id;
$$;

revoke execute on function public.statistician_checks_from() from public, anon;
grant execute on function public.statistician_checks_from() to authenticated;

-- Brings the date forward. It can't be pushed back, so the club can't keep
-- putting it off.
create or replace function public.admin_set_statistician_checks_from(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current date := public.statistician_checks_from();
begin
  if not public.is_admin() then
    raise exception 'Only admins can change safeguarding settings';
  end if;
  if p_date is null then
    raise exception 'Choose the date statistician checks are required from';
  end if;
  if v_current is not null and p_date > v_current then
    raise exception 'The date can only be brought forward. Exempt a statistician with a reason if they never work with children';
  end if;
  update public.safeguarding_settings
  set statistician_checks_from = p_date, updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_statistician_checks_from(date) from public, anon;
grant execute on function public.admin_set_statistician_checks_from(date) to authenticated;

-- Statisticians need a check unless exempt, like committee members and admins.
create or replace function public.needs_wwcc(p_roles public.app_role[], p_exempt_reason text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_roles && array['coach', 'manager', 'physio', 'volunteer']::public.app_role[]
    or (p_roles && array['committee', 'admin', 'statistician']::public.app_role[]
        and coalesce(trim(p_exempt_reason), '') = '');
$$;

-- As before, with the statistician rule: exempt with a reason, screened, or
-- no card recorded before the club's statistician checks date.
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
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and current_date < coalesce(public.committee_checks_from(), current_date + 1)
            )
            or public.has_current_wwcc(p.id)
            or public.wwcc_application_valid(p.id)
          )
        when p_role = 'statistician' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and current_date < coalesce(public.statistician_checks_from(), current_date + 1)
            )
            or public.is_cleared(p.id)
          )
        when p_role = 'admin' then p.stood_down_at is null
        else true
      end
  );
$$;

revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

-- Whether an admin still sees under 18s' injuries: screened now, or within
-- 30 days of their card expiring, or, with no card recorded, within 30 days
-- of the club's committee checks date.
create or replace function public.admin_sees_children_injuries(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_cleared(p_profile_id) or exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and (
      (coalesce(trim(p.wwcc_number), '') <> '' and p.wwcc_expires_on >= current_date - 30)
      or (
        coalesce(trim(p.wwcc_number), '') = ''
        and current_date < coalesce(public.committee_checks_from() + 30, current_date + 1)
      )
    )
  );
$$;

revoke execute on function public.admin_sees_children_injuries(uuid) from public, anon, authenticated;

-- The signed-in member's own answer, for the notice on their home screen.
create or replace function public.my_admin_sees_children_injuries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_sees_children_injuries(auth.uid());
$$;

revoke execute on function public.my_admin_sees_children_injuries() from public, anon;
grant execute on function public.my_admin_sees_children_injuries() to authenticated;

-- As before, except an admin sees an under 18's injuries only while
-- admin_sees_children_injuries holds.
create or replace function public.committee_sees_injuries_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.has_role('admin')
      and (not public.athlete_is_minor(p_athlete_id) or public.admin_sees_children_injuries(auth.uid())))
    or (public.has_role('committee')
      and (not public.athlete_is_minor(p_athlete_id) or public.is_cleared(auth.uid())));
$$;
revoke execute on function public.committee_sees_injuries_of(uuid) from public, anon, authenticated;

-- Approving someone as a new statistician needs a check, an application, a
-- volunteer exemption or an exemption with a reason. Same as before otherwise.
CREATE OR REPLACE FUNCTION public.admin_save_member(p_profile_id uuid, p_role app_role, p_status member_status, p_teams jsonb DEFAULT '[]'::jsonb, p_under_17 boolean DEFAULT false, p_guardian_ids uuid[] DEFAULT '{}'::uuid[], p_rejection_reason rejection_reason DEFAULT NULL::rejection_reason, p_extra_roles app_role[] DEFAULT '{}'::app_role[], p_guardian_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_was_statistician boolean;
  v_current_guardians uuid[];
  v_new_guardians uuid[];
  v_exempt_reason text;
  v_volunteer public.profiles;
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
    status = 'approved' and 'statistician' = any (public.roles_of(role, extra_roles)),
    wwcc_exempt_reason
  into v_date_of_birth, v_was_committee, v_was_admin, v_was_statistician, v_exempt_reason
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
  -- Guests get no child-safety protections (no guardian link, copies or
  -- consents), so the Guest role is for adults (Matt, 19 October 2026).
  if p_status = 'approved' and 'guest' = any (v_roles) then
    if v_date_of_birth is null then
      raise exception 'Add their date of birth, checked against PlayHQ or ID, before approving a guest';
    end if;
    if public.is_minor(v_date_of_birth, false) then
      raise exception 'Guests must be 18 or over. Approve them as an athlete with a parent or guardian linked instead';
    end if;
  end if;
  if p_status = 'approved' and v_under_17 and cardinality(v_guardian_ids) = 0 then
    raise exception 'Link at least one verified guardian before approving an athlete under 18';
  end if;
  if p_status = 'approved' and v_roles && array['coach', 'manager', 'physio']::public.app_role[]
     and not public.has_current_wwcc(p_profile_id)
     and not exists (
       select 1 from public.volunteer_exemptions
       where profile_id = p_profile_id and ended_at is null
     )
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check, an application they''ve lodged, or a volunteer exemption, before approving a coach, manager or physio';
  end if;
  -- Committee members approved before checks were needed keep their access;
  -- the admin's to-do list asks for their check instead.
  if p_status = 'approved' and 'committee' = any (v_roles) and not coalesce(v_was_committee, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id)
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check or an application they''ve lodged, or exempt them with a reason, before making them a committee member';
  end if;
  -- The same for admins, who can read every child's records. Admins approved
  -- before this keep their access; the to-do list asks for their check.
  if p_status = 'approved' and 'admin' = any (v_roles) and not coalesce(v_was_admin, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id)
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check or an application they''ve lodged, or exempt them with a reason, before making them an admin';
  end if;
  -- And for statisticians, who may sit courtside at junior games. Those
  -- approved before this keep the role until the club's statistician checks
  -- date; the to-do list asks for their check.
  if p_status = 'approved' and 'statistician' = any (v_roles) and not coalesce(v_was_statistician, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.is_cleared(p_profile_id)
     and not exists (
       select 1 from public.volunteer_exemptions
       where profile_id = p_profile_id and ended_at is null
     )
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check, an application they''ve lodged or a volunteer exemption, or exempt them with a reason, before making them a statistician';
  end if;
  -- A temporary helper is approved once they've accepted the club's
  -- policies and a check or an accepted exemption covers every day they'll
  -- help. One already approved keeps their approval.
  if p_status = 'approved' and 'volunteer' = any (v_roles) then
    select * into v_volunteer from public.profiles where id = p_profile_id;
    if not (v_volunteer.status = 'approved' and v_volunteer.role = 'volunteer') then
      if public.volunteer_details_problem(
           v_volunteer.volunteer_task, v_volunteer.volunteer_from, v_volunteer.volunteer_until
         ) is not null then
        raise exception 'Add what they''ll help with and their first and last day before approving a temporary helper';
      end if;
      if v_volunteer.volunteer_until < current_date then
        raise exception 'Their last day has passed. Change their dates before approving them.';
      end if;
      if not public.has_acknowledged_policies(p_profile_id) then
        raise exception 'They need to accept the club''s code of conduct and safeguarding policy in the app before you approve them';
      end if;
      if not public.volunteer_covered(p_profile_id, v_volunteer.volunteer_from, v_volunteer.volunteer_until) then
        raise exception 'Record a current Working With Children Check that lasts to their last day, or an exemption they''ve accepted that covers all their dates, before approving a temporary helper';
      end if;
    end if;
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
$function$;

commit;
