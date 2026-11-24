-- Concern clocks and escalation (Matt, 24 November 2026; plan
-- https://claude.ai/artifact/LjyN58dwBgNJKiVFNfaBR5).
--
-- Every open concern runs on the club's clock. Each recorded step (a note, a
-- referral, a status change) restarts it:
--   new        raised, nothing recorded yet (the Urgent "Look at N new
--              concerns" to-do, as before)
--   new_late   nothing recorded for concern_first_action_hours (24)
--   refer      a concern about a child's safety with nothing recorded for
--              concern_refer_hours (48): refer it or record why not
--   in_progress
--   important  no new step for concern_important_days (7)
--   urgent     no new step for concern_urgent_days (14)
-- new_late, refer and urgent are "urgent": from then, the concern escalates
-- along its lead post's chain.
--
-- Lead post: the Child Safety Officer when the person raising it said a
-- child's safety is involved, otherwise the Complaints Manager. The lead
-- post's people (or the admins acting in it) get the Important and Urgent
-- to-dos and pushes.
--
-- Escalation chains: admins set up to 4 steps for each lead post. A step is a
-- post (Child Safety Officer, Complaints Manager, Admins) or one named adult
-- who could hold a post, with the days to wait before it. Admins are always
-- the last stop. An hourly job records each step reached. A step whose people
-- are all named in the concern, or can't act, is skipped and recorded, and the
-- next step follows straight away. Saving a chain is refused if it comes back
-- to its own lead post or to any post or person twice. A named person
-- reached by escalation handles that concern (only that one) while it's open.
--
-- Requests to read messages turn Important after request_important_hours
-- (24) and Urgent after request_urgent_hours (48), for whoever can answer.
-- Clearances waiting for sign-off turn Important after
-- clearance_important_days (3) and Urgent after clearance_urgent_days (7);
-- the app works that out from the club's times.
--
-- Additive: new columns with defaults, new tables (with their own grants),
-- new functions, can_handle_concern replaced, member_todos wrapped (the old
-- one is kept under a new name and called first). No rows are changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. The club's times
-- ---------------------------------------------------------------------------

alter table public.club_settings
  add column if not exists concern_first_action_hours integer not null default 24,
  add column if not exists concern_refer_hours integer not null default 48,
  add column if not exists concern_important_days integer not null default 7,
  add column if not exists concern_urgent_days integer not null default 14,
  add column if not exists concern_escalate_days integer not null default 7,
  add column if not exists request_important_hours integer not null default 24,
  add column if not exists request_urgent_hours integer not null default 48,
  add column if not exists clearance_important_days integer not null default 3,
  add column if not exists clearance_urgent_days integer not null default 7;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_settings_concern_times_check') then
    alter table public.club_settings add constraint club_settings_concern_times_check check (
      concern_first_action_hours between 1 and 720
      and concern_refer_hours between 1 and 720
      and concern_important_days between 1 and 30
      and concern_urgent_days between 1 and 30
      and concern_urgent_days > concern_important_days
      and concern_escalate_days between 1 and 30
      and request_important_hours between 1 and 720
      and request_urgent_hours between 1 and 720
      and request_urgent_hours > request_important_hours
      and clearance_important_days between 1 and 30
      and clearance_urgent_days between 1 and 30
      and clearance_urgent_days > clearance_important_days
    );
  end if;
end;
$$;

-- The club's times, for everyone signed in (the app works out clearance
-- alerts from them).
create or replace function public.club_concern_times()
returns table (
  concern_first_action_hours integer,
  concern_refer_hours integer,
  concern_important_days integer,
  concern_urgent_days integer,
  concern_escalate_days integer,
  request_important_hours integer,
  request_urgent_hours integer,
  clearance_important_days integer,
  clearance_urgent_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.concern_first_action_hours, s.concern_refer_hours, s.concern_important_days,
    s.concern_urgent_days, s.concern_escalate_days, s.request_important_hours,
    s.request_urgent_hours, s.clearance_important_days, s.clearance_urgent_days
  from public.club_settings s
  where s.id and auth.uid() is not null;
$$;

revoke execute on function public.club_concern_times() from public, anon;
grant execute on function public.club_concern_times() to authenticated;

-- Admins change the times. Each is checked here with a plain message, and
-- again by the table check.
create or replace function public.admin_set_concern_times(
  p_first_action_hours integer,
  p_refer_hours integer,
  p_important_days integer,
  p_urgent_days integer,
  p_escalate_days integer,
  p_request_important_hours integer,
  p_request_urgent_hours integer,
  p_clearance_important_days integer,
  p_clearance_urgent_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change these times';
  end if;
  if p_first_action_hours not between 1 and 720 or p_refer_hours not between 1 and 720
    or p_request_important_hours not between 1 and 720 or p_request_urgent_hours not between 1 and 720 then
    raise exception 'Hours must be between 1 and 720 (30 days)';
  end if;
  if p_important_days not between 1 and 30 or p_urgent_days not between 1 and 30
    or p_escalate_days not between 1 and 30
    or p_clearance_important_days not between 1 and 30 or p_clearance_urgent_days not between 1 and 30 then
    raise exception 'Days must be between 1 and 30';
  end if;
  if p_urgent_days <= p_important_days or p_request_urgent_hours <= p_request_important_hours
    or p_clearance_urgent_days <= p_clearance_important_days then
    raise exception 'Urgent must come after Important';
  end if;
  update public.club_settings
  set concern_first_action_hours = p_first_action_hours,
      concern_refer_hours = p_refer_hours,
      concern_important_days = p_important_days,
      concern_urgent_days = p_urgent_days,
      concern_escalate_days = p_escalate_days,
      request_important_hours = p_request_important_hours,
      request_urgent_hours = p_request_urgent_hours,
      clearance_important_days = p_clearance_important_days,
      clearance_urgent_days = p_clearance_urgent_days,
      updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_concern_times(integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_set_concern_times(integer, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lead post and the concern's clock
-- ---------------------------------------------------------------------------

-- The post that leads a concern.
create or replace function public.concern_lead_post(p_concern_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.involves_child = 'yes' then 'child_safety_officer' else 'complaints_manager' end
  from public.concerns c where c.id = p_concern_id;
$$;

revoke execute on function public.concern_lead_post(uuid) from public, anon, authenticated;

-- Whether this member can act in the post now: they hold it and can act, or
-- they're an admin acting in it (20261124200000).
create or replace function public.in_safeguarding_post(p_post text, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.holds_safeguarding_post(p_post, p_profile_id)
      and public.can_be_safeguarding_contact(p_profile_id))
    or public.acting_in_safeguarding_post(p_post, p_profile_id);
$$;

revoke execute on function public.in_safeguarding_post(text, uuid) from public, anon, authenticated;

-- Where the concern's clock stands at p_now. clock_from: the last recorded
-- step (or when it was raised); urgent_from: when it became (or will become)
-- urgent, which is when escalation starts counting.
create or replace function public.concern_clock(p_concern_id uuid, p_now timestamptz default now())
returns table (stage text, clock_from timestamptz, urgent_from timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select c.id, c.created_at, c.status, c.involves_child,
      (select max(e.created_at) from public.concern_events e where e.concern_id = c.id) as last_step
    from public.concerns c where c.id = p_concern_id
  ), s as (
    select * from public.club_settings where id
  )
  select
    case
      when c.status = 'closed' then 'closed'
      when c.last_step is null and c.involves_child = 'yes'
        and p_now >= c.created_at + make_interval(hours => s.concern_refer_hours) then 'refer'
      when c.last_step is null
        and p_now >= c.created_at + make_interval(hours => s.concern_first_action_hours) then 'new_late'
      when c.last_step is null then 'new'
      when p_now >= c.last_step + make_interval(days => s.concern_urgent_days) then 'urgent'
      when p_now >= c.last_step + make_interval(days => s.concern_important_days) then 'important'
      else 'in_progress'
    end,
    coalesce(c.last_step, c.created_at),
    case
      when c.status = 'closed' then null
      when c.last_step is null then c.created_at + make_interval(hours => s.concern_first_action_hours)
      else c.last_step + make_interval(days => s.concern_urgent_days)
    end
  from c cross join s;
$$;

revoke execute on function public.concern_clock(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Escalation chains
-- ---------------------------------------------------------------------------

create table if not exists public.escalation_steps (
  id uuid primary key default gen_random_uuid(),
  lead_post text not null check (lead_post in ('child_safety_officer', 'complaints_manager')),
  step_no integer not null check (step_no between 1 and 4),
  target_post text check (target_post in ('child_safety_officer', 'complaints_manager', 'admins')),
  target_person uuid references public.profiles (id) on delete cascade,
  wait_days integer not null check (wait_days between 1 and 30),
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  unique (lead_post, step_no),
  check ((target_post is null) <> (target_person is null)),
  check (target_post is distinct from lead_post)
);

-- Reached only through the functions below.
alter table public.escalation_steps enable row level security;
revoke all on table public.escalation_steps from public, anon, authenticated;
grant all on table public.escalation_steps to service_role;

-- Each step a concern reached (or skipped), kept for good with the concern.
create table if not exists public.concern_escalations (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns (id) on delete cascade,
  clock_from timestamptz not null,
  step_no integer not null,
  target_post text check (target_post in ('child_safety_officer', 'complaints_manager', 'admins')),
  target_person uuid references public.profiles (id) on delete set null,
  target_name text not null,
  reached_at timestamptz not null,
  skipped boolean not null default false,
  reason text,
  unique (concern_id, clock_from, step_no)
);

create index if not exists concern_escalations_person on public.concern_escalations (target_person)
  where target_person is not null and not skipped;

alter table public.concern_escalations enable row level security;
revoke all on table public.concern_escalations from public, anon, authenticated;
grant all on table public.concern_escalations to service_role;

-- Looks at a concern by someone who handles it only because it was escalated
-- to them by name, kept with the concern.
create table if not exists public.concern_escalated_views (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns (id) on delete cascade,
  viewer_id uuid references public.profiles (id) on delete set null,
  viewer_name text not null,
  viewed_at timestamptz not null default now()
);

alter table public.concern_escalated_views enable row level security;
revoke all on table public.concern_escalated_views from public, anon, authenticated;
grant all on table public.concern_escalated_views to service_role;

-- Whether the concern was escalated to this person by name, they can act, and
-- it's still open.
create or replace function public.escalated_to_person(p_concern_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null
    and exists (
      select 1 from public.concern_escalations x
      join public.concerns c on c.id = x.concern_id
      where x.concern_id = p_concern_id and x.target_person = p_profile_id
        and not x.skipped and c.status <> 'closed'
    )
    and public.can_be_safeguarding_contact(p_profile_id);
$$;

revoke execute on function public.escalated_to_person(uuid, uuid) from public, anon, authenticated;

-- Admins, the Child Safety Officers and Complaints Managers, as before, and
-- now anyone a concern was escalated to by name; never anyone it names.
create or replace function public.can_handle_concern(p_concern_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.concerns c where c.id = p_concern_id)
    and not public.is_named_in_concern(p_concern_id, auth.uid())
    and (public.is_admin() or public.is_safeguarding_officer()
      or public.escalated_to_person(p_concern_id, auth.uid()));
$$;

revoke execute on function public.can_handle_concern(uuid) from public, anon, authenticated;

-- Whether the signed-in member handles any concern only because it was
-- escalated to them by name: the app then shows them Concerns.
create or replace function public.has_escalated_concerns()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.concern_escalations x
    where x.target_person = auth.uid() and not x.skipped
      and public.escalated_to_person(x.concern_id, auth.uid())
      and not public.is_named_in_concern(x.concern_id, auth.uid())
  );
$$;

revoke execute on function public.has_escalated_concerns() from public, anon;
grant execute on function public.has_escalated_concerns() to authenticated;

-- Who a step reaches for this concern: the post's people (holders who can act,
-- or admins acting), every admin for Admins, or the named person. Never anyone
-- the concern names.
create or replace function public.escalation_step_people(
  p_concern_id uuid,
  p_target_post text,
  p_target_person uuid
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.status = 'approved' and p.stood_down_at is null
    and not public.is_named_in_concern(p_concern_id, p.id)
    and (
      (p_target_person is not null and p.id = p_target_person and public.can_be_safeguarding_contact(p.id))
      or (p_target_post = 'admins' and 'admin' = any (public.roles_of(p.role, p.extra_roles)))
      or (p_target_post in ('child_safety_officer', 'complaints_manager')
        and public.in_safeguarding_post(p_target_post, p.id))
    );
$$;

revoke execute on function public.escalation_step_people(uuid, text, uuid) from public, anon, authenticated;

-- A post's name as people read it.
create or replace function public.post_label(p_post text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_post
    when 'child_safety_officer' then 'Child Safety Officer'
    when 'complaints_manager' then 'Complaints Manager'
    when 'admins' then 'Admins'
    when 'wwc_officer' then 'WWC Registration Officer'
  end;
$$;

revoke execute on function public.post_label(text) from public, anon;
grant execute on function public.post_label(text) to authenticated;

-- The chains, for the admin screen: each step with its name and whether the
-- person named can act now.
create or replace function public.admin_escalation_chains()
returns table (
  lead_post text,
  step_no integer,
  target_post text,
  target_person uuid,
  target_name text,
  wait_days integer,
  can_act boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.lead_post, s.step_no, s.target_post, s.target_person,
    coalesce(public.post_label(s.target_post), public.display_name(p)),
    s.wait_days,
    s.target_post is not null or public.can_be_safeguarding_contact(s.target_person)
  from public.escalation_steps s
  left join public.profiles p on p.id = s.target_person
  where public.is_admin()
  order by s.lead_post, s.step_no;
$$;

revoke execute on function public.admin_escalation_chains() from public, anon;
grant execute on function public.admin_escalation_chains() to authenticated;

-- The people an admin can name as a step, for the picker: anyone who could
-- hold a safeguarding post (an approved adult with a current check, not
-- stood down), with no details beyond their name.
create or replace function public.admin_escalation_people()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p)
  from public.profiles p
  where public.is_admin() and public.can_be_safeguarding_contact(p.id)
  order by 2;
$$;

revoke execute on function public.admin_escalation_people() from public, anon;
grant execute on function public.admin_escalation_people() to authenticated;

-- Replaces one lead post's chain. p_steps is a list of
--   {"post": "child_safety_officer" | "complaints_manager" | "admins", "wait_days": 7}
--   {"person": "<profile id>", "wait_days": 7}
-- in order, at most 4. Refused when the chain comes back to its own lead post
-- (or to someone who holds it), names any post or person twice, or names
-- someone who couldn't hold a post. Admins is the last stop anyway, so a step
-- after Admins is refused too.
create or replace function public.admin_set_escalation_chain(p_lead_post text, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step jsonb;
  v_pos integer := 0;
  v_post text;
  v_person uuid;
  v_wait integer;
  v_seen text[] := array[p_lead_post];
  v_node text;
  v_after_admins boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set escalation';
  end if;
  if p_lead_post not in ('child_safety_officer', 'complaints_manager') then
    raise exception 'Choose the Child Safety Officer''s or the Complaints Manager''s chain';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Send the steps as a list';
  end if;
  if jsonb_array_length(p_steps) > 4 then
    raise exception 'A chain has at most 4 steps';
  end if;

  delete from public.escalation_steps where lead_post = p_lead_post;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_pos := v_pos + 1;
    if v_after_admins then
      raise exception 'Admins are the last stop, so nothing can come after them';
    end if;
    v_post := nullif(v_step ->> 'post', '');
    v_person := nullif(v_step ->> 'person', '')::uuid;
    v_wait := coalesce((v_step ->> 'wait_days')::integer, 7);
    if (v_post is null) = (v_person is null) then
      raise exception 'Each step is a post or a person';
    end if;
    if v_wait not between 1 and 30 then
      raise exception 'Wait between 1 and 30 days before each step';
    end if;
    if v_post is not null and v_post not in ('child_safety_officer', 'complaints_manager', 'admins') then
      raise exception 'Choose the Child Safety Officer, the Complaints Manager or Admins';
    end if;
    if v_person is not null then
      if not public.can_be_safeguarding_contact(v_person) then
        raise exception 'Each person named must be an approved adult with a current Working With Children Check';
      end if;
      if public.holds_safeguarding_post(p_lead_post, v_person) then
        raise exception 'They already hold the post this chain starts from, so it would come back to them';
      end if;
    end if;
    v_node := coalesce(v_post, v_person::text);
    if v_node = any (v_seen) then
      raise exception 'A chain can''t come back to a post or person already in it';
    end if;
    v_seen := v_seen || v_node;
    if v_post = 'admins' then
      v_after_admins := true;
    end if;
    insert into public.escalation_steps (lead_post, step_no, target_post, target_person, wait_days, added_by)
    values (p_lead_post, v_pos, v_post, v_person, v_wait, auth.uid());
  end loop;
end;
$$;

revoke execute on function public.admin_set_escalation_chain(text, jsonb) from public, anon;
grant execute on function public.admin_set_escalation_chain(text, jsonb) to authenticated;

-- A lead post's steps, with Admins added as the last stop when the chain
-- doesn't end there (waiting concern_escalate_days).
create or replace function public.escalation_chain(p_lead_post text)
returns table (step_no integer, target_post text, target_person uuid, wait_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.step_no, s.target_post, s.target_person, s.wait_days
  from public.escalation_steps s where s.lead_post = p_lead_post
  union all
  select coalesce((select max(s.step_no) from public.escalation_steps s where s.lead_post = p_lead_post), 0) + 1,
    'admins', null, (select concern_escalate_days from public.club_settings where id)
  where not exists (
    select 1 from public.escalation_steps s where s.lead_post = p_lead_post and s.target_post = 'admins'
  )
  order by 1;
$$;

revoke execute on function public.escalation_chain(text) from public, anon, authenticated;

-- Records every step each urgent concern has reached by p_now. Run hourly.
-- Returns how many steps were recorded.
create or replace function public.escalate_concerns(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  st record;
  v_clock record;
  v_at timestamptz;
  v_skipped_before boolean;
  v_reached boolean;
  v_n integer := 0;
  v_name text;
begin
  for c in select id from public.concerns where status <> 'closed' loop
    select * into v_clock from public.concern_clock(c.id, p_now);
    if v_clock.stage not in ('new_late', 'refer', 'urgent') or v_clock.urgent_from is null then
      continue;
    end if;
    v_at := v_clock.urgent_from;
    v_skipped_before := false;
    for st in select * from public.escalation_chain(public.concern_lead_post(c.id)) loop
      -- A skipped step passes straight to the next: no wait after a skip.
      if not v_skipped_before then
        v_at := v_at + make_interval(days => st.wait_days);
      end if;
      exit when v_at > p_now;
      -- Already recorded for this clock: carry on from it.
      select x.skipped into v_skipped_before
      from public.concern_escalations x
      where x.concern_id = c.id and x.clock_from = v_clock.clock_from and x.step_no = st.step_no;
      if found then
        continue;
      end if;
      v_reached := exists (select 1 from public.escalation_step_people(c.id, st.target_post, st.target_person));
      select coalesce(public.post_label(st.target_post), public.display_name(p)) into v_name
      from (select 1) one left join public.profiles p on p.id = st.target_person;
      insert into public.concern_escalations (concern_id, clock_from, step_no, target_post, target_person,
        target_name, reached_at, skipped, reason)
      values (c.id, v_clock.clock_from, st.step_no, st.target_post, st.target_person,
        coalesce(v_name, 'Someone no longer in the club'), v_at, not v_reached,
        case when not v_reached then 'Nobody in this step could take it: everyone is named in the concern or can''t act' end)
      on conflict (concern_id, clock_from, step_no) do nothing;
      v_n := v_n + 1;
      v_skipped_before := not v_reached;
    end loop;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.escalate_concerns(timestamptz) from public, anon, authenticated;

-- The escalation steps of a concern, for those who handle it, oldest first.
create or replace function public.concern_escalation_history(p_concern_id uuid)
returns table (reached_at timestamptz, target_name text, skipped boolean, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.reached_at, x.target_name, x.skipped, x.reason
  from public.concern_escalations x
  where x.concern_id = p_concern_id and public.can_handle_concern(p_concern_id)
  order by x.reached_at, x.step_no;
$$;

revoke execute on function public.concern_escalation_history(uuid) from public, anon;
grant execute on function public.concern_escalation_history(uuid) to authenticated;

-- Notes a look by someone who handles this concern only because it was
-- escalated to them by name. Does nothing for anyone else.
create or replace function public.note_escalated_concern_view(p_concern_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.can_handle_concern(p_concern_id)
    and not public.is_admin() and not public.is_safeguarding_officer()
    and public.escalated_to_person(p_concern_id, auth.uid()) then
    insert into public.concern_escalated_views (concern_id, viewer_id, viewer_name)
    select p_concern_id, p.id, public.display_name(p) from public.profiles p where p.id = auth.uid();
  end if;
end;
$$;

revoke execute on function public.note_escalated_concern_view(uuid) from public, anon;
grant execute on function public.note_escalated_concern_view(uuid) to authenticated;

-- Those looks, for those who handle the concern, newest first.
create or replace function public.concern_escalated_view_log(p_concern_id uuid)
returns table (viewer_name text, viewed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.viewer_name, v.viewed_at
  from public.concern_escalated_views v
  where v.concern_id = p_concern_id and public.can_handle_concern(p_concern_id)
  order by v.viewed_at desc;
$$;

revoke execute on function public.concern_escalated_view_log(uuid) from public, anon;
grant execute on function public.concern_escalated_view_log(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What each member is chased about
-- ---------------------------------------------------------------------------

-- The concerns the signed-in member should act on now: late, needing
-- referral, Important or Urgent, for the lead post's people; and any concern
-- escalated to them (by post, by name, or as an admin at the last stop).
-- References only, never details.
create or replace function public.my_concern_clocks(p_now timestamptz default now())
returns table (
  concern_id uuid,
  reference text,
  stage text,
  clock_from timestamptz,
  escalated boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, public.concern_reference(c.ref_no), k.stage, k.clock_from,
    exists (
      select 1 from public.concern_escalations x
      where x.concern_id = c.id and x.clock_from = k.clock_from and not x.skipped
        and (x.target_person = auth.uid()
          or (x.target_post = 'admins' and public.is_admin())
          or (x.target_post in ('child_safety_officer', 'complaints_manager')
            and public.in_safeguarding_post(x.target_post, auth.uid())))
    )
  from public.concerns c
  cross join lateral public.concern_clock(c.id, p_now) k
  where auth.uid() is not null
    and c.status <> 'closed'
    and k.stage in ('new_late', 'refer', 'important', 'urgent')
    and public.can_handle_concern(c.id)
    and (
      public.in_safeguarding_post(public.concern_lead_post(c.id), auth.uid())
      or exists (
        select 1 from public.concern_escalations x
        where x.concern_id = c.id and x.clock_from = k.clock_from and not x.skipped
          and (x.target_person = auth.uid()
            or (x.target_post = 'admins' and public.is_admin())
            or (x.target_post in ('child_safety_officer', 'complaints_manager')
              and public.in_safeguarding_post(x.target_post, auth.uid())))
      )
    )
  order by c.created_at;
$$;

revoke execute on function public.my_concern_clocks(timestamptz) from public, anon;
grant execute on function public.my_concern_clocks(timestamptz) to authenticated;

-- How late the oldest request to read messages the signed-in member can
-- answer is: 'urgent', 'important' or null.
create or replace function public.message_access_late(p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when min(r.created_at) <= p_now - make_interval(hours => s.request_urgent_hours) then 'urgent'
    when min(r.created_at) <= p_now - make_interval(hours => s.request_important_hours) then 'important'
  end
  from public.message_access_requests r
  cross join (select * from public.club_settings where id) s
  where r.status = 'pending' and public.message_access_can_decide(r)
  group by s.request_urgent_hours, s.request_important_hours;
$$;

revoke execute on function public.message_access_late(timestamptz) from public, anon;
grant execute on function public.message_access_late(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pushes: the to-do push job's list, with these added
-- ---------------------------------------------------------------------------

-- The to-do list every push is worked out from stays as it was, under a new
-- name, and the clocks are added after it.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'member_todos_before_clocks'
  ) then
    alter function public.member_todos(uuid, timestamptz) rename to member_todos_before_clocks;
  end if;
end;
$$;

revoke execute on function public.member_todos_before_clocks(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.member_todos(p_profile_id uuid, p_now timestamptz default now())
returns table (todo_key text, title text, detail text, href text)
language plpgsql
set search_path = ''
as $$
declare
  v_old_claims text;
  v_old_sub text;
  v_today date;
  v_late text;
  r record;
begin
  return query select * from public.member_todos_before_clocks(p_profile_id, p_now);

  v_old_claims := current_setting('request.jwt.claims', true);
  v_old_sub := current_setting('request.jwt.claim.sub', true);
  v_today := (p_now at time zone public.club_timezone())::date;
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);

  if public.is_approved() then
    -- Important once; late, refer and Urgent once a day until something is
    -- recorded (a step restarts the clock, so the key changes).
    for r in select * from public.my_concern_clocks(p_now) loop
      todo_key := 'concern-clock:' || r.concern_id || ':' || r.stage || ':'
        || (extract(epoch from r.clock_from) * 1000000)::bigint
        || case when r.stage = 'important' then '' else ':' || v_today end;
      title := case r.stage
        when 'refer' then 'Refer ' || r.reference || ' or record why not'
        when 'new_late' then 'Nothing recorded on ' || r.reference || ' yet'
        when 'important' then r.reference || ' has had nothing recorded for a while'
        else r.reference || ' is urgent: nothing recorded for too long'
      end;
      detail := case when r.escalated then 'Escalated to you' else 'You lead this concern' end;
      href := '/concerns/' || r.concern_id;
      return next;
    end loop;

    v_late := public.message_access_late(p_now);
    if v_late is not null then
      todo_key := 'message-access-late:' || v_late || ':' || v_today;
      title := 'A request to read messages is waiting';
      detail := case when v_late = 'urgent' then 'Urgent: answer it now' else 'Answer it soon' end;
      href := '/concerns/message-access';
      return next;
    end if;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
end;
$$;

revoke execute on function public.member_todos(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Every hour
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('escalate-concerns', '7 * * * *', 'select public.escalate_concerns()');
  else
    raise notice 'pg_cron is not available here, so concern escalation is not scheduled';
  end if;
end;
$$;

commit;
