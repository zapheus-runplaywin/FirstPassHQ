-- Athletes who never sign in: a child with no phone, or who won't use the
-- app, run by their parent or guardian (Matt, 19 November 2026, design
-- "Parent-run athlete profiles").
--
-- Every record in HQ hangs off a sign-in (profiles.id references
-- auth.users), so a child who never signs in had nowhere to be: no squad or
-- team, register, injury, consent or guardian link. Now an admin can add one:
--
-- - The child is a sign-in record with no email, no Google or Apple login
--   (no identity) and sign-in blocked (banned_until 'infinity'), made the
--   same way supabase/demo-club.sql makes its sample people. The sign-up
--   trigger makes their profile, marked no_sign_in, so every existing rule
--   (consent, injuries, attendance, guardian copies of messages, deleting a
--   member, keep periods) works for them unchanged.
-- - Only an admin adds one, only for a parent or guardian who is verified,
--   and the child is linked to that parent in the same step, so a no-app
--   child is never without a verified parent. A parent asking to join is
--   approved with them. No link code is needed: nobody claims a child.
-- - A parent can ask for it: when joining, or later from Home, they give the
--   child's name, date of birth and squad or team (no_app_child_requests).
--   An admin checks it and adds the child, or turns it down.
-- - The under-13 rule (20261118100000) still turns away anyone under 13 who
--   signs in; an admin may approve a no-app child under 13, who never does.
-- - What only the child does in person is left out for them: they're not on
--   the coach's check-in board or game goals board, and they don't vote in
--   awards. Message receipts show them as read once a parent has read their
--   copy. A parent can answer a survey sent to their no-app child, marked as
--   answered by that parent.
--
-- Additive only: a new column with a default, a new table, new functions,
-- and replaced functions (admin_save_member from 20261118100000,
-- check_in_board from 20261013010000, goal_board from 20261017040000,
-- award_voters from 20261019000000, message_receipts from 20261017120000,
-- survey_detail from 20261019120000). No rows are changed.

begin;

alter table public.profiles
  add column if not exists no_sign_in boolean not null default false;
comment on column public.profiles.no_sign_in is
  'An athlete with no way to sign in, run by their parent or guardian. Set only by admin_add_no_app_child.';

-- A parent or guardian's request to add a child who won't use the app.
-- Reached only through the functions below. Removed when the child is added,
-- the request is turned down or withdrawn, or the parent's account goes.
create table if not exists public.no_app_child_requests (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 80),
  date_of_birth date not null,
  team_id uuid references public.teams (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists no_app_child_requests_guardian_idx
  on public.no_app_child_requests (guardian_id);
alter table public.no_app_child_requests enable row level security;
revoke all on public.no_app_child_requests from public, anon, authenticated;
grant all on public.no_app_child_requests to service_role;

-- Whether the signed-in member may ask for a child to be added: someone
-- asking to join as a parent or guardian, or an approved adult member (a
-- parent already approved, or a coach who is also a parent). The same people
-- who may enter a child's link code (enter_child_code).
create or replace function public.can_ask_for_child()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and not me.no_sign_in
      and (
        (me.status = 'pending' and me.join_requested_at is not null and me.requested_role = 'guardian')
        or (me.status = 'approved' and me.role not in ('guest', 'volunteer')
          and not public.is_minor(me.date_of_birth, me.under_17))
      )
  );
$$;
revoke execute on function public.can_ask_for_child() from public, anon, authenticated;

-- A parent or guardian asks the club to add their child who won't use the
-- app. The admin checks the details against PlayHQ before adding them.
create or replace function public.request_no_app_child(
  p_full_name text,
  p_date_of_birth date,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.can_ask_for_child() then
    raise exception 'Ask to join as a parent or guardian first';
  end if;
  if v_name = '' then
    raise exception 'Enter your child’s name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep your child’s name to 80 characters';
  end if;
  if p_date_of_birth is null or p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01' then
    raise exception 'That date of birth doesn''t look right';
  end if;
  if not public.is_minor(p_date_of_birth, false) then
    raise exception 'Only children under 18 can be added without their own sign-in. At 18 they join with their own account';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams where id = p_team_id and not archived
  ) then
    raise exception 'Choose one of this season''s squads or teams';
  end if;
  if (select count(*) from public.no_app_child_requests where guardian_id = auth.uid()) >= 6 then
    raise exception 'You’ve asked for 6 children already. A club admin will check them first';
  end if;
  if exists (
    select 1 from public.no_app_child_requests
    where guardian_id = auth.uid() and lower(full_name) = lower(v_name) and date_of_birth = p_date_of_birth
  ) then
    raise exception 'You’ve already asked for %. A club admin will check and add them', v_name;
  end if;
  insert into public.no_app_child_requests (guardian_id, full_name, date_of_birth, team_id)
  values (auth.uid(), v_name, p_date_of_birth, p_team_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.request_no_app_child(text, date, uuid) from public, anon;
grant execute on function public.request_no_app_child(text, date, uuid) to authenticated;

-- The signed-in parent's requests still waiting for an admin.
create or replace function public.my_no_app_child_requests()
returns table (id uuid, full_name text, date_of_birth date, team_name text, requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.full_name, r.date_of_birth, t.name, r.created_at
  from public.no_app_child_requests r
  left join public.teams t on t.id = r.team_id
  where r.guardian_id = auth.uid()
  order by r.created_at;
$$;
revoke execute on function public.my_no_app_child_requests() from public, anon;
grant execute on function public.my_no_app_child_requests() to authenticated;

-- A parent takes back a request they made.
create or replace function public.withdraw_no_app_child_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.no_app_child_requests where id = p_request_id and guardian_id = auth.uid();
  if not found then
    raise exception 'Request not found';
  end if;
end;
$$;
revoke execute on function public.withdraw_no_app_child_request(uuid) from public, anon;
grant execute on function public.withdraw_no_app_child_request(uuid) to authenticated;

-- Requests waiting for admins: one parent's, or everyone's.
create or replace function public.admin_no_app_child_requests(p_guardian_id uuid default null)
returns table (
  id uuid,
  guardian_id uuid,
  full_name text,
  date_of_birth date,
  team_id uuid,
  team_name text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see these requests';
  end if;
  return query
  select r.id, r.guardian_id, r.full_name, r.date_of_birth, r.team_id, t.name, r.created_at
  from public.no_app_child_requests r
  left join public.teams t on t.id = r.team_id and not t.archived
  where p_guardian_id is null or r.guardian_id = p_guardian_id
  order by r.created_at;
end;
$$;
revoke execute on function public.admin_no_app_child_requests(uuid) from public, anon;
grant execute on function public.admin_no_app_child_requests(uuid) to authenticated;

-- An admin turns a request down, for example when PlayHQ doesn't show them
-- as the child's parent.
create or replace function public.admin_decline_no_app_child_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can turn down requests';
  end if;
  delete from public.no_app_child_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;
end;
$$;
revoke execute on function public.admin_decline_no_app_child_request(uuid) from public, anon;
grant execute on function public.admin_decline_no_app_child_request(uuid) to authenticated;

-- An admin adds a child who won't sign in, linked to their verified parent
-- or guardian, approved as an athlete in the squads and teams chosen (a
-- team's squad is added with it). A parent still asking to join is approved
-- as a parent or guardian in the same step. Returns the child's id.
create or replace function public.admin_add_no_app_child(
  p_guardian_id uuid,
  p_full_name text,
  p_date_of_birth date,
  p_team_ids uuid[] default '{}',
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_parent public.profiles;
  v_parent_approved boolean;
  v_child uuid := gen_random_uuid();
  v_teams jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add members';
  end if;
  select * into v_parent from public.profiles where id = p_guardian_id;
  if v_parent.id is null or v_parent.no_sign_in then
    raise exception 'Parent or guardian not found';
  end if;
  -- A parent who is also an admin doesn't decide who is their own child's
  -- guardian: another admin does.
  if p_guardian_id = auth.uid() then
    raise exception 'You can’t add your own child. Ask another admin';
  end if;
  v_parent_approved := v_parent.status = 'approved'
    and 'guardian' = any (public.roles_of(v_parent.role, v_parent.extra_roles));
  if not (
    v_parent_approved
    or (v_parent.status = 'pending' and v_parent.join_requested_at is not null
        and v_parent.requested_role = 'guardian')
  ) then
    raise exception 'They need to ask to join as a parent or guardian, or have the Guardian role, before you add their child';
  end if;
  if v_parent.verified_at is null then
    raise exception 'Verify who they are (their code in person, or checked against PlayHQ or ID) before adding their child';
  end if;
  if v_name = '' then
    raise exception 'Enter the child’s name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the child’s name to 80 characters';
  end if;
  if p_date_of_birth is null or p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01' then
    raise exception 'Add the child’s date of birth, checked against PlayHQ or ID';
  end if;
  if not public.is_minor(p_date_of_birth, false) then
    raise exception 'Only children under 18 can be added without their own sign-in. At 18 they join with their own account';
  end if;
  if p_request_id is not null and not exists (
    select 1 from public.no_app_child_requests where id = p_request_id and guardian_id = p_guardian_id
  ) then
    raise exception 'Request not found';
  end if;
  -- This season's squads and teams only; a team's squad comes with it.
  if exists (
    select 1 from unnest(coalesce(p_team_ids, '{}')) as x (id)
    where not exists (select 1 from public.teams t where t.id = x.id and not t.archived)
  ) then
    raise exception 'Members can only be added to this season''s squads and teams';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('team_id', g.id, 'team_role', 'athlete')), '[]'::jsonb)
  into v_teams
  from (
    select t.id from public.teams t where t.id = any (coalesce(p_team_ids, '{}'))
    union
    select t.squad_id from public.teams t
    where t.id = any (coalesce(p_team_ids, '{}')) and t.squad_id is not null
  ) g;

  -- The sign-in record, with no email, no login and sign-in blocked. The
  -- empty token columns are what Supabase's own sign-up writes.
  insert into auth.users (
    instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
    banned_until, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_child, 'authenticated', 'authenticated', null,
    '{"no_sign_in": true}'::jsonb, jsonb_build_object('full_name', v_name),
    'infinity', now(), now(), '', '', '', ''
  );
  -- The sign-up trigger made the profile.
  update public.profiles
  set full_name = v_name,
      date_of_birth = p_date_of_birth,
      declared_date_of_birth = p_date_of_birth,
      no_sign_in = true,
      requested_role = 'athlete',
      join_requested_at = now()
  where id = v_child;

  -- Approved as an athlete, the same way as any member. Locked
  -- (is_locked_child) for the moment, until the parent is linked below.
  perform public.admin_save_member(v_child, 'athlete', 'approved', v_teams);

  perform set_config('app.guardian_reason', 'Added by an admin as a child who won’t use the app', true);
  insert into public.guardianships (guardian_id, athlete_id) values (p_guardian_id, v_child);
  perform set_config('app.guardian_reason', '', true);

  -- A parent still asking to join is approved now, as a parent or guardian.
  if not v_parent_approved then
    perform public.admin_save_member(p_guardian_id, 'guardian', 'approved');
  end if;

  if p_request_id is not null then
    delete from public.no_app_child_requests where id = p_request_id;
  end if;
  return v_child;
end;
$$;
revoke execute on function public.admin_add_no_app_child(uuid, text, date, uuid[], uuid) from public, anon;
grant execute on function public.admin_add_no_app_child(uuid, text, date, uuid[], uuid) to authenticated;

-- A parent answers a survey sent to their child who doesn't use the app. The
-- answers go in as the child's (named surveys show the parent who answered),
-- and the child's copy is marked answered.
create or replace function public.submit_survey_response_for_child(
  p_survey_id uuid,
  p_child_id uuid,
  p_answers jsonb,
  p_give_name boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_me_name text := public.member_display_name(auth.uid());
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if v_me is null or not public.is_approved() then
    raise exception 'Survey not found';
  end if;
  -- Their own copy of it, sent for this child.
  if not exists (
    select 1 from public.survey_recipients
    where survey_id = p_survey_id and profile_id = v_me and p_child_id = any (for_children)
  ) or not public.is_guardian_of(p_child_id) then
    raise exception 'Survey not found';
  end if;
  if not exists (select 1 from public.profiles where id = p_child_id and no_sign_in) then
    raise exception 'This survey is for your child to answer';
  end if;

  -- Answer as the child, the way member_todos acts as a member, so every
  -- rule in submit_survey_response applies to the child's own copy.
  perform set_config('request.jwt.claims', json_build_object('sub', p_child_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_child_id::text, true);
  perform public.submit_survey_response(p_survey_id, p_answers, p_give_name);
  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);

  update public.survey_responses
  set respondent_name = respondent_name || ' (answered by ' || coalesce(v_me_name, 'a parent') || ')'
  where survey_id = p_survey_id and respondent_id = p_child_id;
end;
$$;
revoke execute on function public.submit_survey_response_for_child(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.submit_survey_response_for_child(uuid, uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Approval: a child who never signs in may be under 13, and is only ever an
-- athlete. Same as 20261118100000_join_age_13, with those two checks and a
-- clearer message for a parent whose child is waiting to be added.
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
  v_no_sign_in boolean;
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
    declared_date_of_birth,
    no_sign_in
  into v_date_of_birth, v_was_committee, v_was_admin, v_was_statistician, v_was_guardian, v_verified, v_exempt_reason,
    v_was_approved, v_declared_date_of_birth, v_no_sign_in
  from public.profiles where id = p_profile_id;
  -- Nobody under 13 joins this year (Matt, 18 November 2026), whichever date
  -- says so: the one the admin checked or the one given at join. Members
  -- already approved keep their approval. A child who never signs in (added
  -- by admin_add_no_app_child) may be under 13 (19 November 2026).
  if p_status = 'approved' and not coalesce(v_was_approved, false)
     and not coalesce(v_no_sign_in, false)
     and (public.is_under_13(v_date_of_birth) or public.is_under_13(v_declared_date_of_birth)) then
    raise exception 'They''re under 13. FirstPass HQ is for members aged 13 and over, so decline their request';
  end if;
  v_under_17 := 'athlete' = any (v_roles) and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (not 'admin' = any (v_roles) or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  if coalesce(v_no_sign_in, false) and v_roles <> array['athlete']::public.app_role[] then
    raise exception 'A child who doesn''t use the app can only be an athlete';
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
      if exists (select 1 from public.no_app_child_requests r where r.guardian_id = p_profile_id) then
        raise exception 'Add their child who won’t use the app first, under Children to add on this page. They''re approved with them';
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
revoke execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text) from public, anon;
grant execute on function public.admin_save_member(uuid, public.app_role, public.member_status, jsonb, boolean, uuid[], public.rejection_reason, public.app_role[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Coaches' check-in board: children who don't use the app aren't listed as
-- not checked in. Same as 20261013010000_consents otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.check_in_board(p_team_id uuid, p_day date)
returns table (
  athlete_id uuid,
  full_name text,
  sleep smallint,
  soreness smallint,
  stress smallint,
  mood smallint,
  note text,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, coalesce(nullif(p.full_name, ''), p.email),
    c.sleep, c.soreness, c.stress, c.mood, c.note, c.updated_at
  from public.team_members a
  join public.profiles p on p.id = a.profile_id and p.status = 'approved' and not p.no_sign_in
  left join public.check_ins c on c.athlete_id = p.id and c.day = p_day
  where a.team_id = p_team_id
    and a.team_role = 'athlete'
    and public.has_child_consent(p.id, 'data')
    and public.is_approved()
    and public.can_work_with_children()
    and exists (
      select 1 from public.team_members coach
      join public.teams t on t.id = coach.team_id
      where coach.team_id = p_team_id
        and coach.profile_id = auth.uid()
        and coach.team_role = 'coach'
        and t.selections_completed_at is null
    )
  order by p.full_name;
$$;
revoke execute on function public.check_in_board(uuid, date) from public, anon;
grant execute on function public.check_in_board(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Coaches' game goals board: children who don't use the app set no goals,
-- so they aren't listed. Same as 20261017040000_coach_guide_audit otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.goal_board()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_id uuid,
  athlete_name text,
  next_fixture_id uuid,
  next_label text,
  next_starts_at timestamptz,
  next_goal_count int,
  reflections_to_answer int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.kind::text, p.id, coalesce(nullif(p.full_name, ''), p.email),
    n.id, case when n.id is null then null else public.fixture_label(n) end, n.starts_at,
    (select count(*)::int from public.game_goals x
      where x.athlete_id = p.id and x.fixture_id = n.id),
    (select count(*)::int from public.game_goals x
      join public.athlete_games(p.id) g on g.id = x.fixture_id and g.team_id = t.id
      where x.athlete_id = p.id
        and (x.outcome is not null or x.reflection is not null)
        and not exists (select 1 from public.game_goal_comments c where c.goal_id = x.id))
  from public.team_members coach
  join public.teams t on t.id = coach.team_id
  join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
  join public.profiles p on p.id = a.profile_id and p.status = 'approved' and not p.no_sign_in
  left join lateral (select * from public.next_goal_game(p.id)) n on true
  where coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
    and not t.archived
    and t.selections_completed_at is null
    and public.is_approved()
    and public.can_work_with_children()
  order by t.kind, t.sort_order, t.name, p.full_name;
$$;
revoke execute on function public.goal_board() from public, anon;
grant execute on function public.goal_board() to authenticated;

-- ---------------------------------------------------------------------------
-- Award voters: a child who doesn't use the app can't vote, and their parent
-- doesn't vote for them (guardians don't vote). Same as
-- 20261019000000_role_audit_decisions otherwise.
-- ---------------------------------------------------------------------------

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
    on p.status = 'approved' and not p.no_sign_in
    and not public.is_view_only_member(p.role, p.extra_roles)
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


-- ---------------------------------------------------------------------------
-- Read receipts: a child who doesn't use the app shows as read once one of
-- their parents has read their copy. Same as 20261017120000_retention_gaps
-- otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.message_receipts(p_message_id uuid)
returns table (profile_id uuid, full_name text, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id,
    coalesce(nullif(p.full_name, ''), p.email, r.member_name || ' (deleted)')
      || case when p.no_sign_in then ' (no app, parents copied)' else '' end,
    -- A child who doesn't use the app has read it once a parent read their copy.
    case when p.no_sign_in then (
      select min(gr.read_at) from public.message_recipients gr
      join public.guardianships g on g.guardian_id = gr.profile_id and g.athlete_id = r.profile_id
      where gr.message_id = r.message_id
    ) else r.read_at end
  from public.message_recipients r
  left join public.profiles p on p.id = r.profile_id
  where r.message_id = p_message_id
    and (p.id is not null or r.member_left_at is not null)
    and (public.is_message_sender(p_message_id) or public.is_admin())
  order by 3 is null, 3 desc, 2;
$$;


-- ---------------------------------------------------------------------------
-- Survey details: the children who don't use the app whose copy this parent
-- can answer. Same as 20261019120000_guardian_guide_audit otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.survey_detail(p_survey_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.surveys;
  r public.survey_recipients;
  v_manager boolean := public.survey_can_see_results(p_survey_id);
  v_mine uuid;
  v_children jsonb := '[]'::jsonb;
  v_answer_for jsonb := '[]'::jsonb;
begin
  select * into s from public.surveys where id = p_survey_id;
  select * into r from public.survey_recipients where survey_id = p_survey_id and profile_id = auth.uid();
  if s.id is null or not public.is_approved() or not public.surveys_on()
     or not (v_manager or (r.profile_id is not null and s.opens_at <= now())) then
    raise exception 'Survey not found';
  end if;

  if s.identity <> 'anonymous' then
    select id into v_mine from public.survey_responses
    where survey_id = s.id and respondent_id = auth.uid();
  end if;

  -- A parent or guardian reads each child's named answers while they're
  -- still that child's parent or guardian, which ends on the child's 18th
  -- birthday.
  if r.for_children is not null and s.identity <> 'anonymous' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.name,
      'responded', exists (
        select 1 from public.survey_recipients cr
        where cr.survey_id = s.id and cr.profile_id = c.child_id and cr.responded
      ),
      'answers', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'question_id', a.question_id, 'choices', a.choices, 'rating', a.rating, 'text', a.text_answer
        )), '[]'::jsonb)
        from public.survey_responses sr
        join public.survey_answers a on a.response_id = sr.id
        where sr.survey_id = s.id and sr.respondent_id = c.child_id
      )
    ) order by c.name), '[]'::jsonb)
    into v_children
    from unnest(r.for_children, r.for_child_names) as c(child_id, name)
    where c.child_id is distinct from s.created_by
      -- Until the child turns 18, like every other guardian right.
      and public.is_guardian_of(c.child_id);
  end if;

  -- Children who don't use the app, whose copy this parent can answer while
  -- it's open (submit_survey_response_for_child).
  if r.for_children is not null and now() >= s.opens_at and now() < s.closes_at then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.child_id, 'name', c.name) order by c.name), '[]'::jsonb)
    into v_answer_for
    from unnest(r.for_children, r.for_child_names) as c(child_id, name)
    join public.profiles cp on cp.id = c.child_id and cp.no_sign_in
    join public.survey_recipients cr
      on cr.survey_id = s.id and cr.profile_id = c.child_id and not cr.responded
    where public.is_guardian_of(c.child_id);
  end if;

  return jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'intro', s.intro,
    'identity', s.identity,
    'audience', s.audience,
    'audience_role', s.audience_role,
    'audience_label', s.audience_label,
    'opens_at', s.opens_at,
    'closes_at', s.closes_at,
    'created_by', s.created_by,
    'created_by_name', s.created_by_name,
    'created_at', s.created_at,
    'is_open', now() >= s.opens_at and now() < s.closes_at,
    'is_scheduled', now() < s.opens_at,
    'is_recipient', r.profile_id is not null,
    'can_see_results', v_manager,
    'sent_as', s.sent_as,
    'share_with_committee', s.share_with_committee,
    'share_with_admins', s.share_with_admins,
    'everyone_answers', s.everyone_answers,
    'results_at_percent', s.results_at_percent,
    'results_to_group', s.results_to_group,
    'can_close', v_manager and public.survey_can_close(s.id) and now() < s.closes_at,
    'for_child_names', r.for_child_names,
    'from_child', coalesce(s.created_by = any (r.for_children), false),
    'can_answer', r.profile_id is not null and r.for_children is null and not r.responded
      and now() >= s.opens_at and now() < s.closes_at,
    'responded', coalesce(r.responded, false),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options,
        'rating_max', q.rating_max, 'required', q.required
      ) order by q.sort_order), '[]'::jsonb)
      from public.survey_questions q where q.survey_id = s.id
    ),
    'my_answers', case when v_mine is null then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'question_id', a.question_id, 'choices', a.choices, 'rating', a.rating, 'text', a.text_answer
      )), '[]'::jsonb)
      from public.survey_answers a where a.response_id = v_mine
    ) end,
    'children', v_children,
    'answer_for', v_answer_for
  );
end;
$$;


commit;
