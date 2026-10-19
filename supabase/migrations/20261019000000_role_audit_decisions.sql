-- Matt's decisions of 19 October 2026 on the physio, guest and temporary
-- helper guide audits (docs/user-guide-audits):
--
-- 1. A physio placed in a squad looks after its athletes only until the
--    squad's phase is complete, the same as a coach (physio audit A4). After
--    selections, a physio needs a team placement; the Head Physio still looks
--    after everyone.
-- 2. The Guest role is for adults: approving a guest needs a date of birth
--    and refuses anyone under 18 (guest audit A5).
-- 3. An admin records a parent-volunteer exemption for a temporary helper by
--    naming the child from the club's athletes under 18, with no guardian
--    link (temporary helper audit A1). Everyone else still needs the link.
-- 4. Club awards: parents and guardians, physios, statisticians, guests and
--    temporary helpers don't vote, since they needn't be club members. Someone
--    who also holds a voting role (athlete, coach, manager, committee, admin)
--    votes through that role (physio audit A3).
--
-- Additive only: five replaced functions, same signatures. No rows change.

begin;

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
          and t.selections_completed_at is null
          and a.profile_id = p_athlete_id and a.team_role = 'athlete'
      )
    );
$$;

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

create or replace function public.admin_set_volunteer_exemption(
  p_profile_id uuid,
  p_basis public.volunteer_exemption,
  p_child_id uuid default null,
  p_starts_on date default null,
  p_event_name text default null,
  p_organiser text default null
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
  v_event text := nullif(trim(coalesce(p_event_name, '')), '');
  v_organiser text := nullif(trim(coalesce(p_organiser, '')), '');
  v_dated boolean := p_basis in ('short_term_visitor', 'national_event');
  v_last date;
  v_earlier public.volunteer_exemptions;
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
  elsif p_basis = 'parent_volunteer' then
    select * into v_child from public.profiles where id = p_child_id;
    if not found or v_child.status <> 'approved'
       or not 'athlete' = any (public.roles_of(v_child.role, v_child.extra_roles))
       or not public.is_minor(v_child.date_of_birth, v_child.under_17) then
      raise exception 'Choose their child: an athlete under 18 in the club';
    end if;
    -- A temporary helper holds no other role, so can't be linked as a
    -- guardian; the admin names the child instead (Matt, 19 October 2026).
    if v_member.role <> 'volunteer' and not exists (
      select 1 from public.guardianships
      where guardian_id = p_profile_id and athlete_id = p_child_id
    ) then
      raise exception 'Link them as a guardian of that athlete first';
    end if;
  else
    p_child_id := null;
    if p_starts_on is null then
      raise exception '%', case p_basis
        when 'short_term_visitor' then 'Enter the day they arrived in WA'
        else 'Enter the first day of the event or tour' end;
    end if;
    v_last := public.exemption_last_day(p_basis, p_starts_on);
    if v_last < current_date then
      raise exception '%', case p_basis
        when 'short_term_visitor' then 'The two weeks after they arrived in WA have passed, so they need a Working With Children Check'
        else 'Those 30 days have passed, so they need a Working With Children Check' end;
    end if;
    if p_starts_on > current_date + interval '2 years' then
      raise exception 'That first day is too far ahead';
    end if;
    if p_basis = 'national_event' then
      if v_event is null or v_organiser is null then
        raise exception 'Enter the event or tour, and the body organising it';
      end if;
      if length(v_event) > 200 or length(v_organiser) > 200 then
        raise exception 'Keep the event and organiser under 200 characters each';
      end if;
    end if;
  end if;
  if not v_dated then
    p_starts_on := null;
  end if;
  if p_basis <> 'national_event' then
    v_event := null;
    v_organiser := null;
  end if;

  select * into v_open from public.volunteer_exemptions
  where profile_id = p_profile_id and ended_at is null
  for update;
  v_has_open := found;
  if v_has_open and v_open.basis = p_basis
     and v_open.child_id is not distinct from p_child_id
     and v_open.starts_on is not distinct from p_starts_on
     and v_open.event_name is not distinct from v_event
     and v_open.organiser is not distinct from v_organiser then
    return;
  end if;

  -- One visitor or national event exemption in any 12 months. One counts
  -- once they've accepted it and it has started; one replaced before its
  -- first day was never used.
  if v_dated then
    select * into v_earlier from public.volunteer_exemptions e
    where e.profile_id = p_profile_id
      and e.basis in ('short_term_visitor', 'national_event')
      and e.declared_at is not null
      and e.starts_on <= coalesce((e.ended_at at time zone 'Australia/Perth')::date, current_date)
      and p_starts_on <= public.exemption_last_day(e.basis, e.starts_on) + interval '12 months'
      and e.starts_on <= v_last + interval '12 months'
    order by e.starts_on desc
    limit 1;
    if found then
      raise exception 'They used the % exemption from % to %. Only one short-term visitor or national event exemption is allowed in 12 months, so they need a Working With Children Check.',
        case v_earlier.basis when 'short_term_visitor' then 'short-term visitor' else 'national event' end,
        to_char(v_earlier.starts_on, 'DD/MM/YYYY'),
        to_char(public.exemption_last_day(v_earlier.basis, v_earlier.starts_on), 'DD/MM/YYYY');
    end if;
  end if;

  v_me := public.member_display_name(auth.uid());

  if v_has_open then
    update public.volunteer_exemptions
    set ended_at = now(), ended_by = auth.uid(), ended_by_name = v_me,
        end_note = 'Replaced by a new exemption'
    where id = v_open.id;
  end if;

  insert into public.volunteer_exemptions (
    profile_id, basis, child_id, child_name, set_by, set_by_name, starts_on, event_name, organiser
  )
  values (
    p_profile_id, p_basis, p_child_id,
    case when p_basis = 'parent_volunteer'
      then coalesce(nullif(trim(v_child.preferred_name), ''), nullif(trim(v_child.full_name), ''), 'their child')
    end,
    auth.uid(), v_me, p_starts_on, v_event, v_organiser
  );
end;
$$;

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
        where c.id = e.child_id and c.status = 'approved'
          and 'athlete' = any (public.roles_of(c.role, c.extra_roles))
          and public.is_minor(c.date_of_birth, c.under_17)
          -- A temporary helper names their child; everyone else is linked as
          -- a guardian.
          and (v.role = 'volunteer' or exists (
            select 1 from public.guardianships g
            where g.athlete_id = c.id and g.guardian_id = e.profile_id
          ))
      )
      else current_date between e.starts_on and public.exemption_last_day(e.basis, e.starts_on)
    end,
    case e.basis
      when 'under_18_volunteer' then (v.date_of_birth + interval '18 years')::date
      when 'parent_volunteer' then (
        select (c.date_of_birth + interval '18 years')::date
        from public.profiles c where c.id = e.child_id
      )
      else public.exemption_last_day(e.basis, e.starts_on)
    end
  from public.volunteer_exemptions e
  join public.profiles v on v.id = e.profile_id
  where e.profile_id = p_profile_id and e.ended_at is null;
$$;

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
        -- Every member means everyone who holds a voting role: athlete, coach,
        -- manager, committee or admin. Guardians, physios, statisticians,
        -- guests and temporary helpers vote only through one of those.
        and exists (
          select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
          where r in ('athlete', 'coach', 'manager', 'committee', 'admin')
        )
        -- An award with a winner for each team or squad is for the people in it.
        and (not a.per_group or public.in_award_group(p.id, p_team_id)))
      -- Committee and admin aren't tied to a group.
      or exists (
        select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
        where r in ('athlete', 'coach', 'manager', 'committee', 'admin')
          and r::text = any (a.voter_roles)
          and (a.club_wide or r in ('committee', 'admin'))
      )
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = p.id
          and tm.team_role in ('athlete', 'coach', 'manager')
          and tm.team_role::text = any (a.voter_roles)
          and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
      )
    );
$$;

commit;
