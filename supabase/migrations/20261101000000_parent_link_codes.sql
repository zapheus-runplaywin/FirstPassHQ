-- Parents and guardians link to their child with a code (Matt, 20 October
-- 2026).
--
-- 1. A child (an athlete under 18) who has asked to join, or who is approved
--    with no verified parent or guardian, gets a link code: six characters
--    from an alphabet with no look-alikes (no 0, O, 1, I or L), shown as
--    7KQ-4MD. It works once, lasts 7 days, and making a new one stops the
--    old one. Nobody can read the codes table; the child reads only their
--    own code, through my_link_code. The code is kept as it is (not hashed)
--    so the child can see it again each time they open the app.
-- 2. A parent or guardian enters the code (enter_child_code). That makes a
--    request to be linked to exactly that child, with no searching by name.
--    Five wrong codes in an hour lock out more tries for the rest of the
--    hour.
-- 3. Approving a parent or guardian needs them verified and at least one
--    approved child who gave them a code; approving them links them to those
--    children. A parent or guardian approved already is linked from the
--    request on Members (admin_accept_guardian_link). An admin can still link
--    a verified guardian by hand from the child's page. Approving a child no
--    longer needs a guardian first.
-- 4. Locked: an approved athlete under 18 with no approved, verified parent
--    or guardian linked. The database treats them as not approved
--    (is_approved, has_role, is_team_member, is_message_recipient,
--    can_work_with_children and the captain checks), so they can't read or
--    write club data. Everyone else's view of them is unchanged: they stay on
--    rosters and registers. It's worked out each time, so it ends when a
--    guardian is linked or they turn 18, and starts again if their last
--    verified guardian goes; then every admin gets a notice in Messages.
-- 5. Approved guardians follow their child into and out of squads, as they
--    already do for teams, and saving a guardian on their member page keeps
--    those squad places as it keeps the team ones (20261029100000).
--
-- Additive only: three new tables, new and replaced functions (same
-- signatures), one policy. The only rows written are new squad places for
-- approved guardians of children already in a squad. Nothing is deleted or
-- changed. Existing approved members keep their approval; children with no
-- verified guardian are locked from now on, because it's worked out.

begin;

-- ---------------------------------------------------------------------------
-- Locked children
-- ---------------------------------------------------------------------------

-- An approved athlete under 18 with no approved, verified parent or guardian
-- linked.
create or replace function public.is_locked_child(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.status = 'approved'
      and 'athlete' = any (public.roles_of(p.role, p.extra_roles))
      and public.is_minor(p.date_of_birth, p.under_17)
      and not exists (
        select 1
        from public.guardianships g
        join public.profiles gp on gp.id = g.guardian_id
        where g.athlete_id = p.id
          and gp.status = 'approved'
          and gp.verified_at is not null
          and 'guardian' = any (public.roles_of(gp.role, gp.extra_roles))
      )
  );
$$;
revoke execute on function public.is_locked_child(uuid) from public, anon, authenticated;

-- Squads, calendars, awards, training, check-ins and goals all check this, so
-- volunteers see none of them, and nor does a locked child.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved' and p.role <> 'volunteer'
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
  );
$$;

-- A locked child holds no role they can use.
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
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
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

-- A member of the squad or team: an athlete or a parent or guardian placed in
-- it, or a coach, manager or physio placed in it who may work with children
-- right now. Not a locked child.
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id and tm.profile_id = auth.uid() and p.status = 'approved'
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
      and (tm.team_role::text in ('athlete', 'guardian') or public.can_work_with_children())
  );
$$;

create or replace function public.is_message_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.message_recipients
    where message_id = p_message_id and profile_id = auth.uid()
  ) and not exists (
    -- Guests and temporary volunteers never see messages, including ones
    -- from before. Members who are only physios see messages to their role,
    -- and whole-club messages only while admins send them those.
    select 1 from public.profiles
    where id = auth.uid()
      and (role in ('guest', 'volunteer') or (
        public.is_view_only_member(role, extra_roles)
        and not public.physios_get_club_messages()
        and not exists (
          select 1 from public.messages m
          where m.id = p_message_id
            and ((m.audience = 'role' and m.audience_role = 'physio')
              -- Physios in a squad or team get its messages.
              or m.audience = 'group')
        )
      ))
  ) and (
    not public.is_stood_down() or public.reached_me_outside_paused_roles(p_message_id)
  ) and not public.is_locked_child(auth.uid());
$$;

-- Whether the signed-in member may work with children as a coach, manager or
-- physio right now: approved, not stood down, not a locked child, and holding
-- a current check or an exemption that applies.
create or replace function public.can_work_with_children()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved' and p.stood_down_at is null
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
  ) and public.is_cleared(auth.uid());
$$;

create or replace function public.is_club_captain()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_captains cc
    join public.profiles p on p.id = cc.profile_id
    where cc.profile_id = auth.uid()
      and p.status = 'approved'
      and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
      and exists (
        select 1 from public.teams t where t.season = cc.season and not t.archived
      )
  );
$$;

-- A captain or vice captain of the group who is still an athlete in it.
create or replace function public.is_group_captain(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_captains tc
    join public.team_members tm
      on tm.team_id = tc.team_id and tm.profile_id = tc.profile_id and tm.team_role = 'athlete'
    join public.profiles p on p.id = tc.profile_id
    join public.teams t on t.id = tc.team_id
    where tc.team_id = p_team_id
      and tc.profile_id = auth.uid()
      and p.status = 'approved'
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
      and not t.archived
  );
$$;

-- ---------------------------------------------------------------------------
-- Link codes and requests
-- ---------------------------------------------------------------------------

create table if not exists public.guardian_link_codes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  code text not null check (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null,
  replaced_at timestamptz
);
-- A code that still works belongs to one child only.
create unique index if not exists guardian_link_codes_open_code
  on public.guardian_link_codes (code) where used_at is null and replaced_at is null;
create index if not exists guardian_link_codes_athlete_idx
  on public.guardian_link_codes (athlete_id, created_at desc);
alter table public.guardian_link_codes enable row level security;
-- Only reached through the functions below.
revoke all on public.guardian_link_codes from public, anon, authenticated;
grant all on public.guardian_link_codes to service_role;

-- A parent or guardian who entered a child's code, waiting for an admin.
create table if not exists public.guardian_link_requests (
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  code_id uuid references public.guardian_link_codes (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (guardian_id, athlete_id),
  check (guardian_id <> athlete_id)
);
create index if not exists guardian_link_requests_athlete_idx
  on public.guardian_link_requests (athlete_id);
alter table public.guardian_link_requests enable row level security;
revoke all on public.guardian_link_requests from public, anon, authenticated;
grant select on public.guardian_link_requests to authenticated;
grant all on public.guardian_link_requests to service_role;
drop policy if exists "Admins and the guardian see link requests" on public.guardian_link_requests;
create policy "Admins and the guardian see link requests"
  on public.guardian_link_requests for select to authenticated
  using ((guardian_id = (select auth.uid())) or (select public.is_admin()));

-- Wrong codes, to stop guessing.
create table if not exists public.guardian_link_code_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists guardian_link_code_attempts_profile_idx
  on public.guardian_link_code_attempts (profile_id, attempted_at desc);
alter table public.guardian_link_code_attempts enable row level security;
revoke all on public.guardian_link_code_attempts from public, anon, authenticated;
grant all on public.guardian_link_code_attempts to service_role;

-- A child waiting for a parent or guardian: an athlete under 18 who has asked
-- to join and is waiting for approval, or a locked child.
create or replace function public.waits_for_guardian(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.status = 'pending'
      and p.join_requested_at is not null
      and p.requested_role = 'athlete'
      and public.is_minor(coalesce(p.date_of_birth, p.declared_date_of_birth), false)
  ) or public.is_locked_child(p_profile_id);
$$;
revoke execute on function public.waits_for_guardian(uuid) from public, anon, authenticated;

-- A new code for a child, ending any code they had.
create or replace function public.issue_link_code(p_athlete_id uuid)
returns public.guardian_link_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  v_bytes bytea;
  v_byte int;
  v_row public.guardian_link_codes;
  i int;
begin
  update public.guardian_link_codes set replaced_at = now()
  where athlete_id = p_athlete_id and used_at is null and replaced_at is null;
  loop
    v_code := '';
    while length(v_code) < 6 loop
      v_bytes := extensions.gen_random_bytes(12);
      for i in 0..11 loop
        v_byte := get_byte(v_bytes, i);
        -- 31 letters: bytes 248 and over are skipped so every letter is as likely.
        if v_byte < 248 and length(v_code) < 6 then
          v_code := v_code || substr(v_alphabet, (v_byte % 31) + 1, 1);
        end if;
      end loop;
    end loop;
    begin
      insert into public.guardian_link_codes (athlete_id, code, expires_at)
      values (p_athlete_id, v_code, now() + interval '7 days')
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- Another child has that code open; try another.
    end;
  end loop;
end;
$$;
revoke execute on function public.issue_link_code(uuid) from public, anon, authenticated;

-- The signed-in child's code, made if they have none that still works, and
-- the parents and guardians who have entered one and are waiting for an
-- admin. Nothing for anyone else.
create or replace function public.my_link_code()
returns table (waiting boolean, code text, expires_at timestamptz, parents_waiting text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.guardian_link_codes;
begin
  if auth.uid() is null or not public.waits_for_guardian(auth.uid()) then
    return query select false, null::text, null::timestamptz, '{}'::text[];
    return;
  end if;
  select * into v_row from public.guardian_link_codes c
  where c.athlete_id = auth.uid() and c.used_at is null and c.replaced_at is null
    and c.expires_at > now()
  order by c.created_at desc
  limit 1;
  if v_row.id is null then
    v_row := public.issue_link_code(auth.uid());
  end if;
  return query
  select true, v_row.code, v_row.expires_at,
    coalesce((
      select array_agg(public.member_display_name(r.guardian_id) order by r.created_at)
      from public.guardian_link_requests r where r.athlete_id = auth.uid()
    ), '{}'::text[]);
end;
$$;
revoke execute on function public.my_link_code() from public, anon;
grant execute on function public.my_link_code() to authenticated;

-- A new code for the signed-in child. The old one stops working.
create or replace function public.new_link_code()
returns table (waiting boolean, code text, expires_at timestamptz, parents_waiting text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.waits_for_guardian(auth.uid()) then
    raise exception 'Only an athlete under 18 waiting for a parent or guardian has a link code';
  end if;
  perform public.issue_link_code(auth.uid());
  return query select * from public.my_link_code();
end;
$$;
revoke execute on function public.new_link_code() from public, anon;
grant execute on function public.new_link_code() to authenticated;

-- A parent or guardian enters their child's code. Returns why it didn't work,
-- or null when the request was made. A wrong code is reported by returning,
-- not raising, so the count of wrong tries is kept.
create or replace function public.enter_child_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row public.guardian_link_codes;
  v_max_failures constant integer := 5;
  v_window constant interval := interval '1 hour';
  v_failures integer;
  v_oldest timestamptz;
  v_child text;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Not signed in';
  end if;
  -- Someone asking to join as a parent or guardian, or an approved member
  -- (a parent already approved, or a coach who is also a parent).
  if not (
    (v_me.status = 'pending' and v_me.join_requested_at is not null and v_me.requested_role = 'guardian')
    or (v_me.status = 'approved' and v_me.role not in ('guest', 'volunteer')
      and not public.is_minor(v_me.date_of_birth, v_me.under_17))
  ) then
    raise exception 'Ask to join as a parent or guardian first';
  end if;

  select count(*), min(attempted_at) into v_failures, v_oldest
  from public.guardian_link_code_attempts
  where profile_id = v_me.id and attempted_at > now() - v_window;
  if v_failures >= v_max_failures then
    return 'Too many wrong codes. Try again in '
      || greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())) / 60))::integer
      || ' minutes.';
  end if;

  select c.* into v_row from public.guardian_link_codes c
  where c.code = v_code and c.used_at is null and c.replaced_at is null and c.expires_at > now()
    and c.athlete_id <> v_me.id
    and public.waits_for_guardian(c.athlete_id);
  if v_row.id is null then
    insert into public.guardian_link_code_attempts (profile_id) values (v_me.id);
    return 'That code isn’t right, or it has expired. Check it with your child, or ask them to make a new one.';
  end if;

  v_child := coalesce(public.member_display_name(v_row.athlete_id), 'your child');
  if exists (
    select 1 from public.guardianships where guardian_id = v_me.id and athlete_id = v_row.athlete_id
  ) then
    return 'You’re already linked to ' || v_child || '.';
  end if;
  if exists (
    select 1 from public.guardian_link_requests where guardian_id = v_me.id and athlete_id = v_row.athlete_id
  ) then
    return 'You’ve already entered ' || v_child || '’s code. A club admin will check and link you.';
  end if;

  insert into public.guardian_link_requests (guardian_id, athlete_id, code_id)
  values (v_me.id, v_row.athlete_id, v_row.id);
  update public.guardian_link_codes set used_at = now(), used_by = v_me.id where id = v_row.id;
  return null;
end;
$$;
revoke execute on function public.enter_child_code(text) from public, anon;
grant execute on function public.enter_child_code(text) to authenticated;

-- The children whose code the signed-in parent or guardian entered, waiting
-- for an admin to link them.
create or replace function public.my_link_requests()
returns table (athlete_id uuid, athlete_name text, requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.athlete_id, public.member_display_name(r.athlete_id), r.created_at
  from public.guardian_link_requests r
  where r.guardian_id = auth.uid()
  order by r.created_at;
$$;
revoke execute on function public.my_link_requests() from public, anon;
grant execute on function public.my_link_requests() to authenticated;

-- An admin links an approved, verified parent or guardian to the child whose
-- code they entered.
create or replace function public.admin_accept_guardian_link(p_guardian_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can link parents and guardians';
  end if;
  if not exists (
    select 1 from public.guardian_link_requests
    where guardian_id = p_guardian_id and athlete_id = p_athlete_id
  ) then
    raise exception 'They haven’t entered this child’s code';
  end if;
  -- A parent who is also an admin doesn't decide who is their child's
  -- guardian: another admin does.
  if auth.uid() = p_guardian_id or exists (
    select 1 from public.guardianships where athlete_id = p_athlete_id and guardian_id = auth.uid()
  ) then
    raise exception 'You''re one of their guardians, so another admin needs to change who their guardians are';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_guardian_id and p.status = 'approved' and p.verified_at is not null
      and 'guardian' = any (public.roles_of(p.role, p.extra_roles))
  ) then
    raise exception 'Verify and approve them as a parent or guardian before linking them';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_athlete_id and p.status = 'approved'
      and 'athlete' = any (public.roles_of(p.role, p.extra_roles))
      and public.is_minor(p.date_of_birth, p.under_17)
  ) then
    raise exception 'Approve the child first, as an athlete under 18';
  end if;
  perform set_config('app.guardian_reason', 'Entered the child’s link code', true);
  insert into public.guardianships (guardian_id, athlete_id)
  values (p_guardian_id, p_athlete_id)
  on conflict do nothing;
  perform set_config('app.guardian_reason', '', true);
  delete from public.guardian_link_requests
  where guardian_id = p_guardian_id and athlete_id = p_athlete_id;
end;
$$;
revoke execute on function public.admin_accept_guardian_link(uuid, uuid) from public, anon;
grant execute on function public.admin_accept_guardian_link(uuid, uuid) to authenticated;

-- An admin turns down a request, for example when PlayHQ doesn't show them as
-- the child's parent.
create or replace function public.admin_decline_guardian_link(p_guardian_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can turn down link requests';
  end if;
  delete from public.guardian_link_requests
  where guardian_id = p_guardian_id and athlete_id = p_athlete_id;
  if not found then
    raise exception 'They haven’t entered this child’s code';
  end if;
end;
$$;
revoke execute on function public.admin_decline_guardian_link(uuid, uuid) from public, anon;
grant execute on function public.admin_decline_guardian_link(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guardian links: history and notices, as before, plus a notice to every
-- admin when a child is locked again, and the request goes once linked.
-- ---------------------------------------------------------------------------

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

  -- Linked: their request to be linked is done.
  if tg_op = 'INSERT' then
    delete from public.guardian_link_requests
    where guardian_id = new.guardian_id and athlete_id = new.athlete_id;
  end if;

  -- No notice when the child is leaving or has left the club, or isn't
  -- approved.
  select * into v_athlete from public.profiles where id = v_athlete_id;
  if v_athlete.id is null or v_athlete.status <> 'approved'
     or v_athlete_id::text = current_setting('app.deleting_profile', true) then
    return null;
  end if;

  -- The child's last verified parent or guardian went (unlinked, no longer
  -- approved, or deleted their account), so the child is locked again: every
  -- admin is told.
  if tg_op = 'DELETE'
     and exists (select 1 from public.profiles where id = v_guardian_id and verified_at is not null)
     and public.is_locked_child(v_athlete_id) then
    insert into public.messages (sender_id, sender_name, body, audience, audience_label)
    values (
      null,
      'Club safeguarding',
      v_athlete_name || ' is under 18 and no longer has a verified parent or guardian linked ('
      || v_guardian || ' was the last). Their app is locked until one is: they see only a link '
      || 'code to share with a parent or guardian. Approve the parent or guardian who enters it, '
      || 'or link one from ' || v_athlete_name || '’s page in Members.',
      'notice',
      'Admins'
    )
    returning id into v_message_id;
    insert into public.message_recipients (message_id, profile_id)
    select v_message_id, p.id from public.profiles p
    where p.status = 'approved' and 'admin' = any (public.roles_of(p.role, p.extra_roles))
    on conflict do nothing;
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

-- ---------------------------------------------------------------------------
-- Guardians follow their child into and out of squads as well as teams.
-- ---------------------------------------------------------------------------

-- Places the approved guardians of an athlete under 18 in a squad or team
-- alongside them. A guardian already in it in another role (a coach-parent)
-- keeps that role.
create or replace function public.place_guardians_with_athlete(p_team_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.teams t where t.id = p_team_id) then
    return;
  end if;
  insert into public.team_members (team_id, profile_id, team_role)
  select p_team_id, g.guardian_id, 'guardian'
  from public.guardianships g
  join public.profiles child on child.id = g.athlete_id
  join public.profiles guardian on guardian.id = g.guardian_id
  where g.athlete_id = p_athlete_id
    and public.is_minor(child.date_of_birth, child.under_17)
    and guardian.status = 'approved'
    and 'guardian' = any (public.roles_of(guardian.role, guardian.extra_roles))
  on conflict (team_id, profile_id) do nothing;
end;
$$;
revoke execute on function public.place_guardians_with_athlete(uuid, uuid) from public, anon, authenticated;

create or replace function public.sync_guardian_team_placements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'team_members' then
    if tg_op = 'INSERT' and new.team_role = 'athlete' then
      perform public.place_guardians_with_athlete(new.team_id, new.profile_id);
    elsif tg_op = 'DELETE' and old.team_role = 'athlete' then
      perform public.remove_guardians_left_behind(
        old.team_id,
        (select coalesce(array_agg(guardian_id), '{}') from public.guardianships where athlete_id = old.profile_id)
      );
    elsif tg_op = 'DELETE' and old.team_role <> 'guardian' then
      -- A coach-parent taken off the team as a coach stays with their child
      -- as a guardian. Removing a guardian placement itself is left alone.
      perform public.place_guardians_with_athlete(old.team_id, g.athlete_id)
      from public.guardianships g
      join public.team_members child on child.team_id = old.team_id
        and child.profile_id = g.athlete_id and child.team_role = 'athlete'
      where g.guardian_id = old.profile_id;
    end if;
  elsif tg_table_name = 'guardianships' then
    if tg_op = 'INSERT' then
      perform public.place_guardians_with_athlete(m.team_id, new.athlete_id)
      from public.team_members m
      join public.teams t on t.id = m.team_id and not t.archived
      where m.profile_id = new.athlete_id and m.team_role = 'athlete';
    elsif tg_op = 'DELETE' then
      perform public.remove_guardians_left_behind(m.team_id, array[old.guardian_id])
      from public.team_members m
      where m.profile_id = old.athlete_id and m.team_role = 'athlete';
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.sync_guardian_team_placements() from public, anon, authenticated;

-- Guardians of the athletes already in this season's squads are placed with
-- them now, as teams were on 20 October. Nothing is removed.
select public.place_guardians_with_athlete(m.team_id, m.profile_id)
from public.team_members m
join public.teams t on t.id = m.team_id and t.kind = 'squad' and not t.archived
where m.team_role = 'athlete';

-- ---------------------------------------------------------------------------
-- The admin's to-do: children locked for want of a verified guardian. Same
-- columns as 20261018230000; only minors_without_guardian changes.
-- ---------------------------------------------------------------------------

create or replace function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer,
  exemptions_ending integer,
  athletes_without_date_of_birth integer,
  wwcc_to_validate integer,
  wwcc_to_link integer,
  notices_to_report integer,
  wwc_officer_missing integer,
  wwcc_people integer,
  child_safety_officer_missing integer,
  complaints_manager_missing integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select p.*, public.roles_of(p.role, p.extra_roles) as roles,
      -- A temporary helper needs a check only while helping: not before
      -- their first day, nor after their last.
      public.needs_wwcc(public.roles_of(p.role, p.extra_roles), p.wwcc_exempt_reason)
        and not (p.role = 'volunteer'
          and (p.volunteer_until < current_date or p.volunteer_from > current_date)) as needs_check
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where m.needs_check and not public.is_cleared(m.id)
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 60
        and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until)
    )::int,
    -- Locked: under 18 with no approved, verified parent or guardian linked.
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and public.is_locked_child(m.id)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is not null
        and public.is_minor(m.date_of_birth, m.under_17)
        and m.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int,
    count(*) filter (
      where m.needs_check
        and not public.has_current_wwcc(m.id)
        and exists (
          select 1 from public.volunteer_exemption_state(m.id) s
          where s.valid and s.ends_on < current_date + 60
            and s.basis not in ('short_term_visitor', 'national_event')
            and not (m.role = 'volunteer' and s.ends_on > m.volunteer_until)
        )
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is null
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and (m.wwcc_validated_at is null or m.wwcc_validated_at < now() - interval '1 year')
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_unit_linked_at is null
    )::int,
    (select count(*) from public.screening_notices n
     where n.kind in ('interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled')
       and n.governing_body_told_on is null and public.is_admin())::int,
    (select count(*) from public.safeguarding_settings s
     where s.id and s.wwc_officer_id is null and public.is_admin())::int,
    -- Members behind wwcc_missing, wwcc_expiring, wwcc_to_validate or
    -- wwcc_to_link, each counted once. Keep these in step with those counts.
    count(*) filter (
      where m.needs_check and (
        not public.is_cleared(m.id)
        or (public.has_current_wwcc(m.id) and (
          (m.wwcc_expires_on < current_date + 60
            and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until))
          or m.wwcc_validated_at is null
          or m.wwcc_validated_at < now() - interval '1 year'
          or m.wwcc_unit_linked_at is null))
      )
    )::int,
    (select count(*) from public.safeguarding_settings s
     where s.id and public.is_admin()
       and (s.child_safety_officer_id is null
         or not public.can_be_safeguarding_contact(s.child_safety_officer_id)))::int,
    (select count(*) from public.safeguarding_settings s
     where s.id and public.is_admin()
       and (s.complaints_manager_id is null
         or not public.can_be_safeguarding_contact(s.complaints_manager_id)))::int
  from members m;
$$;

-- ---------------------------------------------------------------------------
-- Saving a member. Same as 20261029100000 except:
-- - approving an athlete under 18 no longer needs a guardian (they're locked
--   until one is linked);
-- - approving a parent or guardian needs them verified and at least one
--   approved child whose code they entered or who is linked to them, and
--   links them to the approved children whose code they entered;
-- - the places a guardian follows their child into, set aside on save, are
--   squads as well as teams, and a guardian is placed with their children
--   once saved.
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
    wwcc_exempt_reason
  into v_date_of_birth, v_was_committee, v_was_admin, v_was_statistician, v_was_guardian, v_verified, v_exempt_reason
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

-- ---------------------------------------------------------------------------
-- Lifting a stand-down. Same as 20261012220000, except a place the member
-- has as a guardian (now in squads too) gives way to the place put back.
-- ---------------------------------------------------------------------------

create or replace function public.admin_lift_stand_down(p_profile_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_open public.stand_downs;
  v_note text := nullif(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can lift a stand-down';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  select * into v_open from public.stand_downs
  where profile_id = p_profile_id and lifted_at is null;
  if v_open.id is null then
    raise exception 'They aren''t stood down';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  update public.stand_downs
  set lifted_at = now(),
      lifted_by = auth.uid(),
      lifted_by_name = public.my_display_name(),
      lift_note = v_note
  where id = v_open.id;

  update public.profiles set stood_down_at = null where id = p_profile_id;

  -- Squads before teams, so a team place always finds its squad place.
  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select
    t.id,
    p_profile_id,
    (x ->> 'team_role')::public.team_role,
    (x ->> 'coach_title')::public.coach_title
  from jsonb_array_elements(v_open.placements) as x
  join public.teams t on t.id = (x ->> 'team_id')::uuid and not t.archived
  where (x ->> 'team_role')::public.app_role
    = any (public.roles_of(v_member.role, v_member.extra_roles))
  order by t.squad_id nulls first
  -- A coach-parent was placed back in their child's squads and teams as a
  -- guardian while stood down; their coaching place takes over again.
  on conflict (team_id, profile_id) do update
    set team_role = excluded.team_role, coach_title = excluded.coach_title
    where public.team_members.team_role = 'guardian';
end;
$$;

commit;
