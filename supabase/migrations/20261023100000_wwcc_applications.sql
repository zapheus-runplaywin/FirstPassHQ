-- A lodged Working With Children Check application counts as screening for
-- now (Matt's decision of 22 October 2026).
--
-- In WA, someone who has applied for a check, new or a renewal, can start or
-- keep doing child-related work while the application is being assessed,
-- as long as they have the receipt. That stops if they get a Negative Notice
-- or an Interim Negative Notice, if they're charged with or convicted of a
-- Class 1 offence as an adult, or if they withdraw the application
-- (https://www.wa.gov.au/organisation/department-of-communities/working-children-check-application-and-renewal-process).
--
-- 1. An admin records the application: its number, the day it was lodged,
--    whether it's new or a renewal, and the receipt.
-- 2. The member accepts a declaration that none of those things applies.
-- 3. Until their card is recorded, it counts as screening wherever a current
--    check does: coach, manager and physio roles, committee and admin
--    approval, safeguarding contacts and children's injuries (is_cleared and
--    has_role).
-- 4. An admin confirms it's still being assessed every 30 days. If nobody
--    has for 90 days, it lapses. Recording a current card ends it, and so
--    does a Screening Unit notice that bars the member.
--
-- Additive: one new table and one storage bucket reached only through
-- functions and admin policies, new functions, and three replaced ones
-- (is_cleared, has_role and admin_save_member are unchanged apart from also
-- accepting an application). No rows are changed or removed.

begin;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table if not exists public.wwcc_applications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  application_number text not null check (length(application_number) between 1 and 40),
  lodged_on date not null,
  kind text not null check (kind in ('new', 'renewal')),
  -- The receipt, in the wwcc-receipts bucket under the member's folder.
  receipt_path text not null,
  receipt_name text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_by_name text,
  -- The member's declaration, in the words they accepted.
  declaration_text text,
  declared_at timestamptz,
  -- An admin last confirmed it's still being assessed.
  checked_at timestamptz,
  checked_by_name text,
  ended_at timestamptz,
  ended_reason text check (ended_reason in ('card_recorded', 'withdrawn', 'refused', 'replaced', 'other')),
  ended_by_name text,
  end_note text check (length(end_note) <= 500)
);

create index if not exists wwcc_applications_profile_idx
  on public.wwcc_applications (profile_id) where ended_at is null;

-- Reached only through the functions below.
alter table public.wwcc_applications enable row level security;
revoke all on public.wwcc_applications from public, anon, authenticated;
grant all on public.wwcc_applications to service_role;

-- Receipts: admins add and open them; members see theirs through the app's
-- functions, never the file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wwcc-receipts', 'wwcc-receipts', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

drop policy if exists "Admins add WWC application receipts" on storage.objects;
create policy "Admins add WWC application receipts"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'wwcc-receipts' and public.is_admin());

drop policy if exists "Admins open WWC application receipts" on storage.objects;
create policy "Admins open WWC application receipts"
  on storage.objects for select to authenticated
  using (bucket_id = 'wwcc-receipts' and public.is_admin());

-- Days an application stays in force after an admin last confirmed it, and
-- how often they're asked to confirm it.
create or replace function public.wwcc_application_lapse_days()
returns integer language sql immutable set search_path = '' as $$ select 90 $$;
create or replace function public.wwcc_application_check_days()
returns integer language sql immutable set search_path = '' as $$ select 30 $$;
revoke execute on function public.wwcc_application_lapse_days() from public, anon;
revoke execute on function public.wwcc_application_check_days() from public, anon;
grant execute on function public.wwcc_application_lapse_days() to authenticated;
grant execute on function public.wwcc_application_check_days() to authenticated;

-- Where an open application is up to: 'waiting_for_declaration', 'in_force',
-- 'lapsed' (nobody confirmed it for 90 days) or 'stopped' (a barring
-- notice since it was lodged). Ended applications are 'ended'.
create or replace function public.wwcc_application_status(a public.wwcc_applications)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.ended_at is not null then 'ended'
    when exists (
      select 1 from public.screening_notices n
      where n.profile_id = a.profile_id
        and n.kind in ('interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled')
        and n.received_on >= a.lodged_on
    ) then 'stopped'
    when coalesce(a.checked_at, a.recorded_at)
      < now() - make_interval(days => public.wwcc_application_lapse_days()) then 'lapsed'
    when a.declared_at is null then 'waiting_for_declaration'
    else 'in_force'
  end;
$$;

revoke execute on function public.wwcc_application_status(public.wwcc_applications) from public, anon, authenticated;

-- The member has an application in force today.
create or replace function public.wwcc_application_valid(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wwcc_applications a
    where a.profile_id = p_profile_id and a.ended_at is null
      and public.wwcc_application_status(a) = 'in_force'
  );
$$;

revoke execute on function public.wwcc_application_valid(uuid) from public, anon, authenticated;

-- The declaration a member accepts, in the words they see.
create or replace function public.wwcc_application_declaration(
  p_application_number text,
  p_lodged_on date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'I applied for a Working With Children Check on '
    || to_char(p_lodged_on, 'FMDD FMMonth YYYY') || ' (application ' || p_application_number
    || ') and it hasn''t been decided yet. I haven''t been given a Negative Notice or an Interim '
    || 'Negative Notice, I haven''t withdrawn the application, and I haven''t been charged with '
    || 'or convicted of a Class 1 offence as an adult. I''ll tell a club admin straight away if '
    || 'any of that changes, and when my card arrives.';
$$;

revoke execute on function public.wwcc_application_declaration(text, date) from public, anon;
grant execute on function public.wwcc_application_declaration(text, date) to authenticated;

-- Recording a current card ends any open application.
create or replace function public.end_wwcc_application_on_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(new.wwcc_number), '') <> '' and new.wwcc_expires_on >= current_date
     and (new.wwcc_number is distinct from old.wwcc_number
       or new.wwcc_expires_on is distinct from old.wwcc_expires_on) then
    update public.wwcc_applications
    set ended_at = now(), ended_reason = 'card_recorded', ended_by_name = public.my_display_name()
    where profile_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;

revoke execute on function public.end_wwcc_application_on_card() from public, anon, authenticated;

drop trigger if exists end_wwcc_application_on_card on public.profiles;
create trigger end_wwcc_application_on_card
  after update of wwcc_number, wwcc_expires_on on public.profiles
  for each row execute function public.end_wwcc_application_on_card();

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Records an application, replacing any open one. The receipt must already
-- be in the wwcc-receipts bucket under the member's folder.
create or replace function public.admin_record_wwcc_application(
  p_profile_id uuid,
  p_application_number text,
  p_lodged_on date,
  p_kind text,
  p_receipt_path text,
  p_receipt_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_number text := upper(nullif(trim(p_application_number), ''));
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record a Working With Children Check application';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if public.is_minor(v_member.date_of_birth, v_member.under_17) then
    raise exception 'Members under 18 don''t need a Working With Children Check';
  end if;
  if v_number is null or length(v_number) > 40 then
    raise exception 'Enter the application number from the receipt';
  end if;
  if p_lodged_on is null or p_lodged_on > current_date
     or p_lodged_on < current_date - public.wwcc_application_lapse_days() then
    raise exception 'Enter the day it was lodged, within the last % days', public.wwcc_application_lapse_days();
  end if;
  if p_kind is null or p_kind not in ('new', 'renewal') then
    raise exception 'Choose whether it''s a new check or a renewal';
  end if;
  if p_receipt_path is null
     or split_part(p_receipt_path, '/', 1) <> p_profile_id::text
     or not exists (
       select 1 from storage.objects where bucket_id = 'wwcc-receipts' and name = p_receipt_path
     ) then
    raise exception 'Attach the receipt from the Screening Unit';
  end if;
  if exists (
    select 1 from public.screening_notices n
    where n.profile_id = p_profile_id
      and n.kind in ('interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled')
      and n.received_on >= p_lodged_on
  ) then
    raise exception 'A Screening Unit notice since then bars them, so the application doesn''t count';
  end if;

  update public.wwcc_applications
  set ended_at = now(), ended_reason = 'replaced', ended_by_name = public.my_display_name()
  where profile_id = p_profile_id and ended_at is null;

  insert into public.wwcc_applications (
    profile_id, application_number, lodged_on, kind, receipt_path, receipt_name,
    recorded_by, recorded_by_name
  )
  values (
    p_profile_id, v_number, p_lodged_on, p_kind, p_receipt_path,
    nullif(trim(p_receipt_name), ''), auth.uid(), public.my_display_name()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.admin_record_wwcc_application(uuid, text, date, text, text, text) from public, anon;
grant execute on function public.admin_record_wwcc_application(uuid, text, date, text, text, text) to authenticated;

-- An admin confirms the application is still being assessed, for example on
-- the Screening Unit's online status check.
create or replace function public.admin_confirm_wwcc_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.wwcc_applications;
begin
  if not public.is_admin() then
    raise exception 'Only admins can confirm a Working With Children Check application';
  end if;
  select * into v_application from public.wwcc_applications where id = p_application_id;
  if v_application.id is null or v_application.ended_at is not null then
    raise exception 'That application has ended';
  end if;
  if v_application.profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  if public.wwcc_application_status(v_application) = 'stopped' then
    raise exception 'A Screening Unit notice bars them, so the application doesn''t count';
  end if;
  update public.wwcc_applications
  set checked_at = now(), checked_by_name = public.my_display_name()
  where id = p_application_id;
end;
$$;

revoke execute on function public.admin_confirm_wwcc_application(uuid) from public, anon;
grant execute on function public.admin_confirm_wwcc_application(uuid) to authenticated;

-- An admin ends an application: withdrawn, refused, or for another reason.
create or replace function public.admin_end_wwcc_application(
  p_application_id uuid,
  p_reason text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.wwcc_applications;
begin
  if not public.is_admin() then
    raise exception 'Only admins can end a Working With Children Check application';
  end if;
  select * into v_application from public.wwcc_applications where id = p_application_id;
  if v_application.id is null or v_application.ended_at is not null then
    raise exception 'That application has already ended';
  end if;
  if p_reason is null or p_reason not in ('withdrawn', 'refused', 'other') then
    raise exception 'Choose why it ended';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;
  update public.wwcc_applications
  set ended_at = now(), ended_reason = p_reason, ended_by_name = public.my_display_name(),
    end_note = nullif(trim(p_note), '')
  where id = p_application_id;
end;
$$;

revoke execute on function public.admin_end_wwcc_application(uuid, text, text) from public, anon;
grant execute on function public.admin_end_wwcc_application(uuid, text, text) to authenticated;

-- Every application an admin needs to see: open ones, and ones that ended in
-- the last year.
create or replace function public.admin_wwcc_applications()
returns table (
  id uuid,
  profile_id uuid,
  member_name text,
  application_number text,
  lodged_on date,
  kind text,
  receipt_path text,
  receipt_name text,
  recorded_at timestamptz,
  recorded_by_name text,
  declared_at timestamptz,
  checked_at timestamptz,
  checked_by_name text,
  check_due_on date,
  lapses_on date,
  status text,
  ended_at timestamptz,
  ended_reason text,
  ended_by_name text,
  end_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.profile_id,
    coalesce(nullif(p.full_name, ''), p.email, 'Unnamed member'),
    a.application_number, a.lodged_on, a.kind, a.receipt_path, a.receipt_name,
    a.recorded_at, a.recorded_by_name, a.declared_at, a.checked_at, a.checked_by_name,
    (coalesce(a.checked_at, a.recorded_at) at time zone 'Australia/Perth')::date
      + public.wwcc_application_check_days(),
    (coalesce(a.checked_at, a.recorded_at) at time zone 'Australia/Perth')::date
      + public.wwcc_application_lapse_days(),
    public.wwcc_application_status(a),
    a.ended_at, a.ended_reason, a.ended_by_name, a.end_note
  from public.wwcc_applications a
  join public.profiles p on p.id = a.profile_id
  where public.is_admin()
    and (a.ended_at is null or a.ended_at > now() - interval '1 year')
  order by a.ended_at is not null, a.lodged_on desc;
$$;

revoke execute on function public.admin_wwcc_applications() from public, anon;
grant execute on function public.admin_wwcc_applications() to authenticated;

-- ---------------------------------------------------------------------------
-- The member
-- ---------------------------------------------------------------------------

-- The member's open application, if they have one.
create or replace function public.my_wwcc_application()
returns table (
  id uuid,
  application_number text,
  lodged_on date,
  kind text,
  declaration_text text,
  declared_at timestamptz,
  lapses_on date,
  status text,
  valid boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.application_number, a.lodged_on, a.kind,
    coalesce(a.declaration_text, public.wwcc_application_declaration(a.application_number, a.lodged_on)),
    a.declared_at,
    (coalesce(a.checked_at, a.recorded_at) at time zone 'Australia/Perth')::date
      + public.wwcc_application_lapse_days(),
    public.wwcc_application_status(a),
    public.wwcc_application_status(a) = 'in_force'
  from public.wwcc_applications a
  where a.profile_id = auth.uid() and a.ended_at is null
  order by a.recorded_at desc
  limit 1;
$$;

revoke execute on function public.my_wwcc_application() from public, anon;
grant execute on function public.my_wwcc_application() to authenticated;

-- The member accepts the declaration for their open application.
create or replace function public.accept_wwcc_application_declaration()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.wwcc_applications;
begin
  select * into v_application from public.wwcc_applications
  where profile_id = auth.uid() and ended_at is null
  order by recorded_at desc limit 1;
  if v_application.id is null then
    raise exception 'You don''t have a Working With Children Check application recorded';
  end if;
  if v_application.declared_at is not null then
    raise exception 'You''ve already accepted this';
  end if;
  if public.wwcc_application_status(v_application) = 'stopped' then
    raise exception 'A Screening Unit notice means this application doesn''t count. Talk to a club admin.';
  end if;
  update public.wwcc_applications
  set declared_at = now(),
    declaration_text = public.wwcc_application_declaration(application_number, lodged_on)
  where id = v_application.id;
end;
$$;

revoke execute on function public.accept_wwcc_application_declaration() from public, anon;
grant execute on function public.accept_wwcc_application_declaration() to authenticated;

-- ---------------------------------------------------------------------------
-- Counting it as screening
-- ---------------------------------------------------------------------------

create or replace function public.is_cleared(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_current_wwcc(p_profile_id)
    or coalesce((select s.valid from public.volunteer_exemption_state(p_profile_id) s), false)
    or public.wwcc_application_valid(p_profile_id);
$$;

revoke execute on function public.is_cleared(uuid) from public, anon, authenticated;

-- Committee members with an application in force keep the role, as they
-- would with a current check. Same as before otherwise.
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
        when p_role in ('admin', 'statistician') then p.stood_down_at is null
        else true
      end
  );
$$;

revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

-- The member has an application that hasn't ended, lapsed or been stopped.
-- One still waiting for their declaration lets an admin approve them; the
-- roles stay paused until they accept it.
create or replace function public.wwcc_application_open(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wwcc_applications a
    where a.profile_id = p_profile_id and a.ended_at is null
      and public.wwcc_application_status(a) in ('in_force', 'waiting_for_declaration')
  );
$$;

revoke execute on function public.wwcc_application_open(uuid) from public, anon, authenticated;

-- Approving a coach, manager or physio, or a new committee member or admin,
-- also accepts an application. Same as before otherwise.
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
