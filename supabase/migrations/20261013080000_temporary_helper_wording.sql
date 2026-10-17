-- The temporary volunteer role is now called Temporary helper in the app,
-- since the people in it may be paid. This changes only the wording of the
-- messages these functions show; the role's stored value stays 'volunteer'.
-- Only functions are replaced; no rows are touched.

begin;

CREATE OR REPLACE FUNCTION public.send_group_message(p_body text, p_audience message_audience, p_role app_role DEFAULT NULL::app_role, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if p_audience = 'club' then
    -- is_committee() is true for admins too.
    if not (public.is_committee() or public.is_club_captain()) then
      raise exception 'Only admins, the committee and club captains can message the whole club';
    end if;
  elsif p_audience = 'role' then
    if not public.is_admin() then
      raise exception 'Only admins can message a role';
    end if;
    if p_role is null then
      raise exception 'Choose a role to message';
    end if;
    if p_role in ('guest', 'volunteer') then
      raise exception 'Guests and temporary helpers don''t get messages';
    end if;
  else
    select * into v_team from public.teams where id = p_team_id and not archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team to message';
    end if;
    if not public.can_message_group(v_team.id) then
      raise exception 'You can only message squads and teams you coach, manage or captain';
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
    select p.id, p.role, p.extra_roles, p.date_of_birth, p.under_17
    from public.profiles p
    where p.status = 'approved'
      and p.role not in ('guest', 'volunteer')
      and (not public.is_view_only_member(p.role, p.extra_roles)
        or p_audience = 'role'
        or p_audience = 'group'
        or (p_audience = 'club' and public.physios_get_club_messages()))
      and case p_audience
        when 'club' then true
        when 'role' then p.role = p_role or p_role = any (p.extra_roles)
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
    where (a.role = 'athlete' or 'athlete' = any (a.extra_roles))
      and public.is_minor(a.date_of_birth, a.under_17)
  ) r
  where r.id <> v_sender.id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- Undoes the message too.
    raise exception 'Nobody else is in that group yet';
  end if;

  -- Guardians of a child who sends a message (a captain or junior coach) get a copy too.
  if (v_sender.role = 'athlete' or 'athlete' = any (v_sender.extra_roles))
     and public.is_minor(v_sender.date_of_birth, v_sender.under_17) then
    insert into public.message_recipients (message_id, profile_id)
    select v_message_id, g.guardian_id
    from public.guardianships g
    join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
    where g.athlete_id = v_sender.id
    on conflict (message_id, profile_id) do nothing;
  end if;

  return v_message_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.role_combination_problem(p_roles app_role[], p_date_of_birth date, p_under_18 boolean)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when 'partner' = any (p_roles)
      then 'The Partner role has been removed. Use Guest instead.'
    when 'guest' = any (p_roles) and cardinality(p_roles) > 1
      then 'Guests can''t have another role'
    when 'volunteer' = any (p_roles) and cardinality(p_roles) > 1
      then 'Temporary helpers can''t have another role'
    when 'admin' = any (p_roles) and 'athlete' = any (p_roles)
      then 'Admins can''t also be athletes'
    when 'athlete' = any (p_roles) and 'manager' = any (p_roles)
      then 'Athletes can''t also be managers'
    when 'athlete' = any (p_roles) and 'physio' = any (p_roles)
      then 'Athletes can''t also be physios'
    when 'athlete' = any (p_roles) and public.is_minor(p_date_of_birth, p_under_18)
      and not p_roles <@ array['athlete', 'coach']::public.app_role[]
      then 'Athletes under 18 can only also be a coach'
    when 'guardian' = any (p_roles) and p_date_of_birth is not null
      and public.is_minor(p_date_of_birth, false)
      then 'Parents and guardians must be 18 or over'
  end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_stand_down(p_profile_id uuid, p_reason text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_note text := nullif(trim(p_note), '');
  v_placements jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can stand members down';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if not public.roles_of(v_member.role, v_member.extra_roles)
     && array['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer']::public.app_role[] then
    raise exception 'Only coaches, managers, physios, committee members, admins and temporary helpers can be stood down';
  end if;
  if v_member.stood_down_at is not null then
    raise exception 'They''re already stood down';
  end if;
  if p_reason is null or p_reason not in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'allegation', 'other'
  ) then
    raise exception 'Choose why they''re being stood down';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'Say why they''re being stood down';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', tm.team_id, 'team_role', tm.team_role, 'coach_title', tm.coach_title
  )), '[]'::jsonb)
  into v_placements
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  update public.profiles set stood_down_at = now() where id = p_profile_id;

  insert into public.stand_downs (
    profile_id, member_name, reason, note, placements, started_by, started_by_name
  )
  values (
    p_profile_id,
    coalesce(nullif(v_member.full_name, ''), v_member.email, 'Unnamed member'),
    p_reason,
    v_note,
    v_placements,
    auth.uid(),
    public.my_display_name()
  );
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.volunteer_details_problem(p_task text, p_from date, p_until date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when coalesce(trim(p_task), '') = '' then 'Say what you''ll help with'
    when length(trim(p_task)) > 200 then 'Keep what you''ll help with under 200 characters'
    when p_from is null or p_until is null then 'Give your first and last day'
    when p_until < p_from then 'The last day is before the first day'
    when p_until > p_from + interval '12 months' then
      'Temporary helpers help for up to 12 months. For longer, ask to join in another role.'
  end;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_volunteer_details(p_task text, p_from date, p_until date, p_screening text, p_card_number text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_problem text := public.volunteer_details_problem(p_task, p_from, p_until);
  v_card text := nullif(upper(trim(coalesce(p_card_number, ''))), '');
begin
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if p_until < current_date then
    raise exception 'Your last day has already passed';
  end if;
  if p_screening is null
     or p_screening not in ('card', 'visitor', 'national_event', 'parent', 'under_18', 'none') then
    raise exception 'Choose how you''re screened to work with children';
  end if;
  if p_screening = 'card' and v_card is null then
    raise exception 'Enter your Working With Children Check card number';
  end if;
  if length(v_card) > 30 then
    raise exception 'That card number is too long';
  end if;
  update public.profiles
  set volunteer_task = trim(p_task),
      volunteer_from = p_from,
      volunteer_until = p_until,
      volunteer_screening = p_screening,
      declared_wwcc_number = case when p_screening = 'card' then v_card end
  where id = auth.uid() and status <> 'approved' and requested_role = 'volunteer';
  if not found then
    raise exception 'Ask to join as a temporary helper first';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_volunteer_details(p_profile_id uuid, p_task text, p_from date, p_until date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_problem text := public.volunteer_details_problem(p_task, p_from, p_until);
begin
  if not public.is_admin() then
    raise exception 'Only admins can change temporary helpers';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  if v_problem is not null then
    raise exception '%', replace(replace(v_problem, 'you''ll', 'they''ll'), 'your', 'their');
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_member.status = 'approved' and v_member.role = 'volunteer'
     and (p_from is distinct from v_member.volunteer_from or p_until is distinct from v_member.volunteer_until)
     and not public.volunteer_covered(p_profile_id, p_from, p_until) then
    raise exception 'Their check or exemption doesn''t cover those dates';
  end if;
  update public.profiles
  set volunteer_task = trim(p_task), volunteer_from = p_from, volunteer_until = p_until
  where id = p_profile_id;
end;
$function$;

revoke execute on function public.send_group_message(text, message_audience, app_role, uuid) from public, anon;
grant execute on function public.send_group_message(text, message_audience, app_role, uuid) to authenticated;
revoke execute on function public.role_combination_problem(app_role[], date, boolean) from public, anon;
grant execute on function public.role_combination_problem(app_role[], date, boolean) to authenticated;
revoke execute on function public.admin_stand_down(uuid, text, text) from public, anon;
grant execute on function public.admin_stand_down(uuid, text, text) to authenticated;
revoke execute on function public.admin_save_member(uuid, app_role, member_status, jsonb, boolean, uuid[], rejection_reason, app_role[], text) from public, anon;
grant execute on function public.admin_save_member(uuid, app_role, member_status, jsonb, boolean, uuid[], rejection_reason, app_role[], text) to authenticated;
revoke execute on function public.volunteer_details_problem(text, date, date) from public, anon;
grant execute on function public.volunteer_details_problem(text, date, date) to authenticated;
revoke execute on function public.set_my_volunteer_details(text, date, date, text, text) from public, anon;
grant execute on function public.set_my_volunteer_details(text, date, date, text, text) to authenticated;
revoke execute on function public.admin_set_volunteer_details(uuid, text, date, date) from public, anon;
grant execute on function public.admin_set_volunteer_details(uuid, text, date, date) to authenticated;

commit;
