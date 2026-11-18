-- Nobody under 13 joins FirstPass HQ this year (Matt, 18 November 2026;
-- design tab D7 "Sign-in age", work item W11).
--
-- Apple's sign-in isn't available to children under 13, and Google Play's
-- Families Policy doesn't accept an app whose only ways in are Google and
-- Apple sign-in once an under-13 age group is ticked. So both stores are told
-- the app is for people aged 13 and over, and:
--
-- - submit_join_request refuses a date of birth under 13 today, after the
--   club password check, and saves nothing from the request. The refusal
--   comes back as a message, like a wrong club password, so the join screen
--   shows it and a parent who typed their child's date can correct it.
-- - admin_save_member refuses to approve someone under 13, by the date the
--   admin checked or the date given at join.
-- - A person can join from their 13th birthday, by the database's date
--   (UTC), the same as the under-18 rule.
--
-- No existing member is changed: members already approved keep their
-- approval, and no rows are touched. Additive only: a new function and two
-- replaced ones (submit_join_request from 20261013020000, admin_save_member
-- from 20261101000000), each with one new check.

begin;

-- Whether a date of birth makes someone under 13 today. No date: not known,
-- so no.
create or replace function public.is_under_13(p_date_of_birth date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_date_of_birth > current_date - interval '13 years', false);
$$;

revoke execute on function public.is_under_13(date) from public, anon;
grant execute on function public.is_under_13(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Join: turned away under 13. Same as 20261013020000_date_of_birth_at_join,
-- with one new check after the club password.
-- ---------------------------------------------------------------------------

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
  -- Nobody under 13 joins this year (Matt, 18 November 2026). Asked after the
  -- club password, so someone without it learns nothing new, and before
  -- anything about them is saved. A date in the future is answered below.
  if p_date_of_birth <= current_date and public.is_under_13(p_date_of_birth) then
    return 'FirstPass HQ is for members aged 13 and over. If you’re a parent or guardian, enter your own date of birth.';
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


-- ---------------------------------------------------------------------------
-- Approval: nobody under 13. Same as 20261101000000_parent_link_codes, with
-- one new check near the top.
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_member(p_profile_id uuid, p_role app_role, p_status member_status, p_teams jsonb DEFAULT '[]'::jsonb, p_under_17 boolean DEFAULT false, p_guardian_ids uuid[] DEFAULT '{}'::uuid[], p_rejection_reason rejection_reason DEFAULT NULL::rejection_reason, p_extra_roles app_role[] DEFAULT '{}'::app_role[], p_guardian_reason text DEFAULT NULL::text)
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
  v_was_statistician boolean;
  v_was_guardian boolean;
  v_verified boolean;
  v_current_guardians uuid[];
  v_new_guardians uuid[];
  v_exempt_reason text;
  v_volunteer public.profiles;
  v_teams jsonb;
  v_followed uuid[] := '{}';
  v_was_approved boolean;
  v_declared_date_of_birth date;
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
    status = 'approved' and 'guardian' = any (public.roles_of(role, extra_roles)),
    verified_at is not null,
    wwcc_exempt_reason,
    status = 'approved',
    declared_date_of_birth
  into v_date_of_birth, v_was_committee, v_was_admin, v_was_statistician, v_was_guardian, v_verified, v_exempt_reason,
    v_was_approved, v_declared_date_of_birth
  from public.profiles where id = p_profile_id;
  -- Nobody under 13 joins this year (Matt, 18 November 2026), whichever date
  -- says so: the one the admin checked or the one given at join. Members
  -- already approved keep their approval.
  if p_status = 'approved' and not coalesce(v_was_approved, false)
     and (public.is_under_13(v_date_of_birth) or public.is_under_13(v_declared_date_of_birth)) then
    raise exception 'They''re under 13. FirstPass HQ is for members aged 13 and over, so decline their request';
  end if;
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
  -- An athlete under 18 can be approved before a guardian is linked: they're
  -- locked (is_locked_child) until a verified guardian is (Matt, 20 October
  -- 2026).
  -- A parent or guardian is approved after their child: verified, with at
  -- least one approved child who gave them their code or is linked to them.
  -- Guardians approved before keep their approval.
  if p_status = 'approved' and 'guardian' = any (v_roles) and not coalesce(v_was_guardian, false) then
    if not coalesce(v_verified, false) then
      raise exception 'Verify who they are (their code in person, or checked against PlayHQ or ID) before approving a parent or guardian';
    end if;
    if not exists (
      select 1 from (
        select r.athlete_id from public.guardian_link_requests r where r.guardian_id = p_profile_id
        union
        select g.athlete_id from public.guardianships g where g.guardian_id = p_profile_id
      ) c
      join public.profiles child on child.id = c.athlete_id
      where child.status = 'approved'
        and 'athlete' = any (public.roles_of(child.role, child.extra_roles))
        and public.is_minor(child.date_of_birth, child.under_17)
    ) then
      if exists (select 1 from public.guardian_link_requests r where r.guardian_id = p_profile_id) then
        raise exception 'Approve their child first. A parent or guardian is approved after at least one of their children';
      end if;
      raise exception 'They haven’t entered their child’s link code yet. Their child sees the code in the app; a parent or guardian needs at least one approved child before they''re approved';
    end if;
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
  -- A parent or guardian approved now is linked to the approved children who
  -- gave them their code.
  if p_status = 'approved' and 'guardian' = any (v_roles) and not coalesce(v_was_guardian, false) then
    perform set_config('app.guardian_reason', 'Entered the child’s link code', true);
    insert into public.guardianships (guardian_id, athlete_id)
    select p_profile_id, r.athlete_id
    from public.guardian_link_requests r
    join public.profiles child on child.id = r.athlete_id
    where r.guardian_id = p_profile_id
      and child.status = 'approved'
      and 'athlete' = any (public.roles_of(child.role, child.extra_roles))
      and public.is_minor(child.date_of_birth, child.under_17)
    on conflict do nothing;
  end if;
  perform set_config('app.guardian_reason', '', true);


  if p_status <> 'approved' then
    delete from public.team_members m
    using public.teams g
    where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived;
    return;
  end if;

  -- A guardian's placement in a squad or team their child under 18 is in is
  -- the database's (guardians follow their child into teams, 20 October, and
  -- squads, 20261101000000), not the admin's.
  -- The member page sends it back like any other, so it is set aside here:
  -- it stays without the squad (guardian data audit, 29 October: saving a
  -- guardian or a coach-parent failed the squad rules below) and isn't
  -- removed by a save that leaves it out.
  if 'guardian' = any (v_roles) then
    select coalesce(array_agg(distinct a.team_id), '{}') into v_followed
    from public.guardianships l
    join public.profiles c on c.id = l.athlete_id
    join public.team_members a on a.profile_id = l.athlete_id and a.team_role = 'athlete'
    join public.teams t on t.id = a.team_id and not t.archived
    where l.guardian_id = p_profile_id
      and public.is_minor(c.date_of_birth, c.under_17);
  end if;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_teams
  from jsonb_array_elements(p_teams) as t
  where not (t ->> 'team_role' = 'guardian'
             and (t ->> 'team_id')::uuid = any (v_followed));

  if jsonb_array_length(v_teams) > 0 then
    select r::text::public.team_role into v_default_team_role
    from unnest(v_roles) with ordinality as x (r, n)
    where r in ('coach', 'manager', 'athlete', 'guardian', 'physio')
    order by n
    limit 1;
    if v_default_team_role is null then
      raise exception 'Only coaches, managers, physios, athletes and guardians can be added to a squad or team';
    end if;
  end if;

  select coalesce(jsonb_agg(t || jsonb_build_object(
    'team_role', coalesce(t ->> 'team_role', v_default_team_role::text),
    'kind', g.kind,
    'squad_id', g.squad_id
  )), '[]'::jsonb)
  into v_placements
  from jsonb_array_elements(v_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;

  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where not (p ->> 'team_role')::public.app_role = any (v_roles)
       or p ->> 'team_role' not in ('coach', 'manager', 'athlete', 'guardian', 'physio')
  ) then
    raise exception 'Give them that role before adding them to a squad or team with it';
  end if;

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

  -- Only the placements that change are removed and added, so a save that
  -- changes nothing doesn't tell parents their child left their team and
  -- rejoined it (What's changed). A followed team stays unless the admin
  -- names the guardian in it in another role (a coach-parent made its coach).
  delete from public.team_members m
  using public.teams g
  where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived
    and not exists (
      select 1 from jsonb_array_elements(v_placements) as p
      where (p ->> 'team_id')::uuid = m.team_id and p ->> 'team_role' = m.team_role::text
    )
    and not (
      m.team_role = 'guardian'
      and m.team_id = any (v_followed)
      and not exists (
        select 1 from jsonb_array_elements(v_placements) as p
        where (p ->> 'team_id')::uuid = m.team_id
      )
    );

  update public.team_members m
  set coach_title = case when p ->> 'team_role' = 'coach'
        then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach')
      end,
      selection = case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
        then coalesce((p ->> 'selection')::public.team_selection, 'touring')
      end
  from jsonb_array_elements(v_placements) as p
  where m.profile_id = p_profile_id
    and m.team_id = (p ->> 'team_id')::uuid
    and m.team_role::text = p ->> 'team_role'
    and (m.coach_title is distinct from case when p ->> 'team_role' = 'coach'
           then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach') end
      or m.selection is distinct from case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
           then coalesce((p ->> 'selection')::public.team_selection, 'touring') end);

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
  from jsonb_array_elements(v_placements) as p
  where not exists (
    select 1 from public.team_members m
    where m.team_id = (p ->> 'team_id')::uuid and m.profile_id = p_profile_id
  );

  -- A parent or guardian is placed in their children's squads and teams, so
  -- one approved now, or saved after a coaching place ended, is with them.
  if 'guardian' = any (v_roles) then
    perform public.place_guardians_with_athlete(m.team_id, g.athlete_id)
    from public.guardianships g
    join public.team_members m on m.profile_id = g.athlete_id and m.team_role = 'athlete'
    join public.teams t on t.id = m.team_id and not t.archived
    where g.guardian_id = p_profile_id;
  end if;
end;
$$;


revoke execute on function public.submit_join_request(text, text, public.app_role, uuid, text, date, text) from public, anon;
grant execute on function public.submit_join_request(text, text, public.app_role, uuid, text, date, text) to authenticated;
revoke execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text) from public, anon;
grant execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text) to authenticated;

commit;
