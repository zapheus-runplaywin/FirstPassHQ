-- Temporary volunteers, and the visitor and national event exemptions.
--
-- Clubs often have someone help for a day or a short time: a visiting
-- coach, a parent on the bench at a carnival, a helper at a clinic. In WA
-- there's no time-based exemption, and being supervised by a cardholder
-- doesn't remove the need for a Working With Children Check, so the club has
-- to screen them like anyone else. This gives the club one place to do it.
--
-- - A new Volunteer role. Someone asks to join as a temporary volunteer and
--   says what they'll help with, their dates and how they're screened. They
--   read and accept the club's code of conduct and safeguarding policy, and
--   accept the declaration for any exemption. An admin approves them only
--   when a current check or an accepted exemption covers all of their dates.
-- - The role has no club features: volunteers aren't "approved members" for
--   squads, calendars, awards, training or check-ins, get no messages and
--   can't be messaged. They can still raise a concern. Their time ends by
--   itself on their last day.
-- - Two more exemptions, for people not ordinarily resident in WA:
--   - Short-term visitor: the two weeks after they arrive in WA.
--   - National event or tour: up to 30 days in a row at an event run by a
--     recognised body with children from more than one state, territory or
--     country.
--   Each records its first day, ends by itself, and is refused when the
--   person has used either of them in the 12 months before or after.
-- - policy_acknowledgements keeps who accepted which version of the club's
--   policies, word for word.
-- - Volunteers can be stood down and have screening notices recorded, and
--   concerns can be raised about them.
--
-- Additive only: new enum values, new columns, a new table, new functions
-- and new versions of existing ones. Nothing is deleted or changed in
-- existing rows.

-- Outside the transaction: a new enum value can't be used in the transaction
-- that adds it.
alter type public.app_role add value if not exists 'volunteer';
alter type public.volunteer_exemption add value if not exists 'short_term_visitor';
alter type public.volunteer_exemption add value if not exists 'national_event';

begin;

-- ---------------------------------------------------------------------------
-- What a temporary volunteer does, and when
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists volunteer_task text,
  add column if not exists volunteer_from date,
  add column if not exists volunteer_until date,
  add column if not exists volunteer_screening text,
  add column if not exists declared_wwcc_number text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_volunteer_task_length') then
    alter table public.profiles add constraint profiles_volunteer_task_length
      check (length(volunteer_task) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_volunteer_dates') then
    alter table public.profiles add constraint profiles_volunteer_dates
      check (volunteer_until >= volunteer_from);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_volunteer_screening_check') then
    alter table public.profiles add constraint profiles_volunteer_screening_check
      check (volunteer_screening in ('card', 'visitor', 'national_event', 'parent', 'under_18', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_declared_wwcc_number_length') then
    alter table public.profiles add constraint profiles_declared_wwcc_number_length
      check (length(declared_wwcc_number) <= 30);
  end if;
end;
$$;

-- The same rules for the volunteer and for admins.
create or replace function public.volunteer_details_problem(
  p_task text,
  p_from date,
  p_until date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(trim(p_task), '') = '' then 'Say what you''ll help with'
    when length(trim(p_task)) > 200 then 'Keep what you''ll help with under 200 characters'
    when p_from is null or p_until is null then 'Give your first and last day'
    when p_until < p_from then 'The last day is before the first day'
    when p_until > p_from + interval '12 months' then
      'Temporary volunteers help for up to 12 months. For longer, ask to join in another role.'
  end;
$$;

revoke execute on function public.volunteer_details_problem(text, date, date) from public, anon;
grant execute on function public.volunteer_details_problem(text, date, date) to authenticated;

-- The volunteer fills these in after asking to join, until they're approved.
create or replace function public.set_my_volunteer_details(
  p_task text,
  p_from date,
  p_until date,
  p_screening text,
  p_card_number text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    raise exception 'Ask to join as a volunteer first';
  end if;
end;
$$;

revoke execute on function public.set_my_volunteer_details(text, date, date, text, text) from public, anon;
grant execute on function public.set_my_volunteer_details(text, date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Visitor and national event exemptions
-- ---------------------------------------------------------------------------

alter table public.volunteer_exemptions
  add column if not exists starts_on date,
  add column if not exists event_name text,
  add column if not exists organiser text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'volunteer_exemptions_starts_on_check') then
    alter table public.volunteer_exemptions add constraint volunteer_exemptions_starts_on_check
      check ((basis in ('short_term_visitor', 'national_event')) = (starts_on is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'volunteer_exemptions_event_check') then
    alter table public.volunteer_exemptions add constraint volunteer_exemptions_event_check
      check ((basis = 'national_event') = (event_name is not null and organiser is not null)
             and length(event_name) <= 200 and length(organiser) <= 200);
  end if;
end;
$$;

-- The last day a dated exemption covers: two weeks for a visitor, 30 days in
-- a row for a national event or tour.
create or replace function public.exemption_last_day(p_basis public.volunteer_exemption, p_starts_on date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_basis
    when 'short_term_visitor' then p_starts_on + 13
    when 'national_event' then p_starts_on + 29
  end;
$$;

revoke execute on function public.exemption_last_day(public.volunteer_exemption, date) from public, anon;
grant execute on function public.exemption_last_day(public.volunteer_exemption, date) to authenticated;

-- A member's open exemption: whether it applies today, and the day it ends.
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

-- The declaration for an exemption, with its names and dates.
create or replace function public.exemption_declaration(p_exemption public.volunteer_exemptions)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_exemption.basis
    when 'short_term_visitor' then
      'I''m not ordinarily resident in Western Australia. I arrived in WA for this visit on '
      || to_char(p_exemption.starts_on, 'DD/MM/YYYY')
      || ', and I''ll only do child-related work under this exemption until '
      || to_char(public.exemption_last_day(p_exemption.basis, p_exemption.starts_on), 'DD/MM/YYYY')
      || ', two weeks after I arrived. I haven''t used the short-term visitor exemption or the '
      || 'national event and tour exemption anywhere in WA in the last 12 months. I''m not paid '
      || 'by this club for this work. '
    when 'national_event' then
      'I''m not ordinarily resident in Western Australia. I''m in WA for ' || p_exemption.event_name
      || ', organised by ' || p_exemption.organiser || ', with children from more than one state, '
      || 'territory or country taking part. I''ll only do child-related work under this exemption '
      || 'at that event or tour, from ' || to_char(p_exemption.starts_on, 'DD/MM/YYYY') || ' to '
      || to_char(public.exemption_last_day(p_exemption.basis, p_exemption.starts_on), 'DD/MM/YYYY')
      || '. I haven''t used the national event and tour exemption or the short-term visitor '
      || 'exemption anywhere in WA in the last 12 months. '
    else public.volunteer_declaration(p_exemption.basis, p_exemption.child_name)
  end
  || case when p_exemption.basis in ('short_term_visitor', 'national_event') then
      'I don''t have a Negative Notice or an Interim Negative Notice under the Working with '
      || 'Children (Screening) Act 2004 (WA), and no other state or territory has refused, '
      || 'suspended or cancelled a working with children clearance for me. I''ll tell a club '
      || 'admin straight away if any of that changes. I understand this exemption ends on '
      || to_char(public.exemption_last_day(p_exemption.basis, p_exemption.starts_on), 'DD/MM/YYYY')
      || ', and that I can''t use either exemption again in WA for 12 months after that.'
    else ''
  end;
$$;

revoke execute on function public.exemption_declaration(public.volunteer_exemptions) from public, anon;

-- Records a volunteer exemption. Visitor and national event exemptions need
-- their first day, and only one of them is allowed in any 12 months.
drop function if exists public.admin_set_volunteer_exemption(uuid, public.volunteer_exemption, uuid);

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
    if not exists (
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

revoke execute on function public.admin_set_volunteer_exemption(uuid, public.volunteer_exemption, uuid, date, text, text) from public, anon;
grant execute on function public.admin_set_volunteer_exemption(uuid, public.volunteer_exemption, uuid, date, text, text) to authenticated;

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
      declaration_text = public.exemption_declaration(v_open)
  where id = v_open.id;
end;
$$;

-- Their result gains the first day, event and organiser.
drop function if exists public.my_volunteer_exemption();

create or replace function public.my_volunteer_exemption()
returns table (
  basis public.volunteer_exemption,
  child_name text,
  declared_at timestamptz,
  declaration_text text,
  valid boolean,
  ends_on date,
  starts_on date,
  event_name text,
  organiser text
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
    coalesce(e.declaration_text, public.exemption_declaration(e)),
    s.valid,
    s.ends_on,
    e.starts_on,
    e.event_name,
    e.organiser
  from public.volunteer_exemptions e
  join public.volunteer_exemption_state(auth.uid()) s on s.exemption_id = e.id;
$$;

revoke execute on function public.my_volunteer_exemption() from public, anon;
grant execute on function public.my_volunteer_exemption() to authenticated;

drop function if exists public.admin_volunteer_exemptions();

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
  ends_on date,
  starts_on date,
  event_name text,
  organiser text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.profile_id, e.basis, e.child_id, e.child_name, e.set_by_name, e.set_at,
    e.declared_at, e.declaration_text, e.ended_at, e.ended_by_name, e.end_note,
    coalesce(s.valid, false),
    coalesce(s.ends_on, public.exemption_last_day(e.basis, e.starts_on)),
    e.starts_on, e.event_name, e.organiser
  from public.volunteer_exemptions e
  left join lateral public.volunteer_exemption_state(e.profile_id) s
    on s.exemption_id = e.id
  where public.is_admin()
  order by e.ended_at is not null, e.set_at desc;
$$;

revoke execute on function public.admin_volunteer_exemptions() from public, anon;
grant execute on function public.admin_volunteer_exemptions() to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting the club's policies
-- ---------------------------------------------------------------------------

create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  policy_version text not null,
  code_of_conduct_url text,
  safeguarding_policy_url text,
  -- What they accepted, word for word.
  statement text not null,
  acknowledged_at timestamptz not null default now(),
  unique (profile_id, policy_version)
);

-- Written only by acknowledge_club_policies.
alter table public.policy_acknowledgements enable row level security;

drop policy if exists "Members and admins see policy acknowledgements" on public.policy_acknowledgements;
create policy "Members and admins see policy acknowledgements"
  on public.policy_acknowledgements for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

grant select on public.policy_acknowledgements to authenticated;

create or replace function public.policy_statement()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'I''ve read the club''s code of conduct and child safeguarding policy, and I''ll follow '
    || 'them. I''ll tell the club''s Child Safety Officer about anything that worries me about a '
    || 'child''s safety, and call 000 if a child is in danger.';
$$;

revoke execute on function public.policy_statement() from public, anon;
grant execute on function public.policy_statement() to authenticated;

-- The signed-in member accepts the club's current policies.
create or replace function public.acknowledge_club_policies()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.safeguarding_settings;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into v_settings from public.safeguarding_settings where id;
  insert into public.policy_acknowledgements (
    profile_id, policy_version, code_of_conduct_url, safeguarding_policy_url, statement
  )
  values (
    auth.uid(), coalesce(v_settings.policy_version, '1'), v_settings.code_of_conduct_url,
    v_settings.policy_url, public.policy_statement()
  )
  on conflict (profile_id, policy_version) do nothing;
end;
$$;

revoke execute on function public.acknowledge_club_policies() from public, anon;
grant execute on function public.acknowledge_club_policies() to authenticated;

-- Whether a member has accepted the club's current policies.
create or replace function public.has_acknowledged_policies(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.policy_acknowledgements a
    where a.profile_id = p_profile_id
      and a.policy_version = coalesce(
        (select s.policy_version from public.safeguarding_settings s where s.id), '1')
  );
$$;

revoke execute on function public.has_acknowledged_policies(uuid) from public, anon;
grant execute on function public.has_acknowledged_policies(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Whether a check or exemption covers a volunteer's dates
-- ---------------------------------------------------------------------------

-- A current card that lasts to their last day, or an exemption they've
-- accepted that covers every day from their first to their last.
create or replace function public.volunteer_covered(p_profile_id uuid, p_from date, p_until date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and public.has_current_wwcc(p.id)
      and p.wwcc_expires_on >= p_until
  ) or exists (
    select 1
    from public.volunteer_exemptions e
    join public.volunteer_exemption_state(p_profile_id) s on s.exemption_id = e.id
    where e.declared_at is not null
      and case
        when e.basis in ('short_term_visitor', 'national_event') then
          e.starts_on <= p_from and p_until <= s.ends_on
        else s.valid and (s.ends_on is null or p_until < s.ends_on)
      end
  );
$$;

revoke execute on function public.volunteer_covered(uuid, date, date) from public, anon;
grant execute on function public.volunteer_covered(uuid, date, date) to authenticated;

-- An admin changes a volunteer's task or dates. Once they're approved, their
-- check or exemption has to cover the new dates too.
create or replace function public.admin_set_volunteer_details(
  p_profile_id uuid,
  p_task text,
  p_from date,
  p_until date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_problem text := public.volunteer_details_problem(p_task, p_from, p_until);
begin
  if not public.is_admin() then
    raise exception 'Only admins can change volunteers';
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
$$;

revoke execute on function public.admin_set_volunteer_details(uuid, text, date, date) from public, anon;
grant execute on function public.admin_set_volunteer_details(uuid, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The Volunteer role: screening only, no club features
-- ---------------------------------------------------------------------------

-- Volunteers always need a check or an exemption.
create or replace function public.needs_wwcc(p_roles public.app_role[], p_exempt_reason text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_roles && array['coach', 'manager', 'physio', 'volunteer']::public.app_role[]
    or (p_roles && array['committee', 'admin']::public.app_role[]
        and coalesce(trim(p_exempt_reason), '') = '');
$$;

-- Squads, calendars, awards, training, check-ins and goals all check this, so
-- volunteers see none of them.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and role <> 'volunteer'
  );
$$;

-- Volunteers, like guests, don't vote for awards.
create or replace function public.is_view_only_role(p_role public.app_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('guest', 'physio', 'volunteer');
$$;

create or replace function public.is_view_only_member(p_role public.app_role, p_extra public.app_role[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.is_view_only_role(p_role)
    and coalesce(p_extra, '{}') <@ array['guest', 'physio', 'volunteer']::public.app_role[];
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
  );
$$;

create or replace function public.role_combination_problem(
  p_roles public.app_role[],
  p_date_of_birth date,
  p_under_18 boolean
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when 'partner' = any (p_roles)
      then 'The Partner role has been removed. Use Guest instead.'
    when 'guest' = any (p_roles) and cardinality(p_roles) > 1
      then 'Guests can''t have another role'
    when 'volunteer' = any (p_roles) and cardinality(p_roles) > 1
      then 'Temporary volunteers can''t have another role'
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
$$;

-- A volunteer whose time has ended, or hasn't started, isn't counted as
-- missing a check; one who has finished drops off the check to-dos. Visitor
-- and national event exemptions are short by design, so they aren't flagged
-- as ending.

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
  wwc_officer_missing integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select p.*, public.roles_of(p.role, p.extra_roles) as roles,
      public.needs_wwcc(public.roles_of(p.role, p.extra_roles), p.wwcc_exempt_reason)
        and not (p.role = 'volunteer' and p.volunteer_until < current_date) as needs_check
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where m.needs_check
        and not (m.role = 'volunteer' and m.volunteer_from > current_date)
        and not public.is_cleared(m.id)
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 60
        and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until)
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
     where s.id and s.wwc_officer_id is null and public.is_admin())::int
  from members m;
$$;

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

-- ---------------------------------------------------------------------------
-- Existing functions that now know about volunteers
-- ---------------------------------------------------------------------------

-- Temporary volunteers aren't messaged.
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
      raise exception 'Guests and temporary volunteers don''t get messages';
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

-- Nor nominated for awards.
CREATE OR REPLACE FUNCTION public.award_nominee_pool(p_award_id uuid, p_team_id uuid)
 RETURNS TABLE(id uuid, is_candidate boolean, name text, date_of_birth date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  join public.profiles p on p.status = 'approved' and p.role not in ('guest', 'volunteer')
  where a.id = p_award_id
    and a.nominees = 'members'
    and p.id is distinct from auth.uid()
  union all
  select c.id, true, c.name, null::date
  from public.awards a
  join public.award_candidates c on c.award_id = a.id
  where a.id = p_award_id
    and a.nominees = 'listed';
$function$;

-- Volunteers can be stood down, and a barring notice stands them down.
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
    raise exception 'Only coaches, managers, physios, committee members, admins and temporary volunteers can be stood down';
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

CREATE OR REPLACE FUNCTION public.admin_record_screening_notice(p_profile_id uuid, p_kind text, p_received_on date, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_action text := nullif(trim(p_action), '');
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record a Screening Unit notice';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if p_kind is null or p_kind not in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled', 'other'
  ) then
    raise exception 'Choose what kind of notice it is';
  end if;
  if p_received_on is null or p_received_on > current_date or p_received_on < date '2000-01-01' then
    raise exception 'Enter the date the notice arrived';
  end if;
  if v_action is null then
    raise exception 'Say what the club did about it';
  end if;
  if length(v_action) > 1000 then
    raise exception 'Keep it under 1000 characters';
  end if;

  insert into public.screening_notices (
    profile_id, member_name, kind, received_on, action, recorded_by, recorded_by_name
  )
  values (
    p_profile_id,
    coalesce(nullif(v_member.full_name, ''), v_member.email, 'Unnamed member'),
    p_kind, p_received_on, v_action, auth.uid(), public.my_display_name()
  )
  returning id into v_id;

  if p_kind <> 'other' and v_member.stood_down_at is null
     and public.roles_of(v_member.role, v_member.extra_roles)
       && array['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer']::public.app_role[] then
    perform public.admin_stand_down(
      p_profile_id,
      case when p_kind = 'card_cancelled' then 'other' else p_kind end,
      case when p_kind = 'card_cancelled'
        then 'Card cancelled or suspended by the Screening Unit. ' || v_action
        else v_action
      end
    );
  end if;
  return v_id;
end;
$function$;

-- Concerns can be raised about them.
CREATE OR REPLACE FUNCTION public.concern_people()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, public.display_name(p)
  from public.profiles p
  where auth.uid() is not null and p.status = 'approved'
    and public.roles_of(p.role, p.extra_roles)
      && array['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer']::public.app_role[]
  order by 2;
$function$;

-- Approving a temporary volunteer.
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
  -- A temporary volunteer is approved once they've accepted the club's
  -- policies and a check or an accepted exemption covers every day they'll
  -- help. One already approved keeps their approval.
  if p_status = 'approved' and 'volunteer' = any (v_roles) then
    select * into v_volunteer from public.profiles where id = p_profile_id;
    if not (v_volunteer.status = 'approved' and v_volunteer.role = 'volunteer') then
      if public.volunteer_details_problem(
           v_volunteer.volunteer_task, v_volunteer.volunteer_from, v_volunteer.volunteer_until
         ) is not null then
        raise exception 'Add what they''ll help with and their first and last day before approving a temporary volunteer';
      end if;
      if v_volunteer.volunteer_until < current_date then
        raise exception 'Their last day has passed. Change their dates before approving them.';
      end if;
      if not public.has_acknowledged_policies(p_profile_id) then
        raise exception 'They need to accept the club''s code of conduct and safeguarding policy in the app before you approve them';
      end if;
      if not public.volunteer_covered(p_profile_id, v_volunteer.volunteer_from, v_volunteer.volunteer_until) then
        raise exception 'Record a current Working With Children Check that lasts to their last day, or an exemption they''ve accepted that covers all their dates, before approving a temporary volunteer';
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
