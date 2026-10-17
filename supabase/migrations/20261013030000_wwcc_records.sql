-- Working With Children Check records an auditor can rely on
-- (child-safety audit finding 7).
--
-- Until now the app kept a card number and an expiry an admin could type as
-- anything. The Working with Children Screening Unit and the governing body
-- expect more: the name on the card, how and when it was checked and by
-- whom, regular re-checks, the card linked to the club with the Screening
-- Unit, a named WWC Registration Officer, and a record of every notice.
--
-- Now:
-- - An expiry more than three years away is refused (cards last three
--   years).
-- - An admin records each card's validation: the name on the card, how it
--   was checked (online, card sighted, or a letter from the Screening Unit)
--   and whether the card is linked to the club with the Screening Unit. The
--   app keeps who validated it and when. A new card number or expiry starts
--   a new validation. Nobody validates their own card.
-- - The club names a WWC Registration Officer (an admin or committee member
--   who can work with children).
-- - Screening Unit notices are recorded per member: kind, date received and
--   the action taken. An interim negative notice, negative notice,
--   interstate decision or cancelled card stands the member down at once if
--   they aren't already, and stays on the to-do list until an admin records
--   telling the governing body.
-- - Admin to-dos: cards to validate (never, or over a year ago), cards not
--   linked with the Screening Unit, notices to report, and no Registration
--   Officer.
--
-- Nothing is deleted or changed in existing rows.
--
-- Additive only: new nullable columns, a new table and functions, replaced
-- functions.

begin;

alter table public.profiles
  add column if not exists wwcc_card_name text check (length(wwcc_card_name) <= 120),
  add column if not exists wwcc_validated_at timestamptz,
  add column if not exists wwcc_validated_by uuid references public.profiles (id) on delete set null,
  add column if not exists wwcc_validation_method text
    check (wwcc_validation_method in ('online', 'card_sighted', 'unit_letter')),
  add column if not exists wwcc_unit_linked_at timestamptz;

comment on column public.profiles.wwcc_unit_linked_at is
  'When an admin recorded that the card is linked to the club with the Working with Children Screening Unit, so the Unit tells the club of any change.';

alter table public.safeguarding_settings
  add column if not exists wwc_officer_id uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Card number and expiry: three years at most, and a new card needs a new
-- validation
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_member_details(
  p_profile_id uuid,
  p_date_of_birth date,
  p_wwcc_number text,
  p_wwcc_expires_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text := nullif(upper(trim(p_wwcc_number)), '');
  v_member public.profiles;
  v_new_card boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_date_of_birth is not null
     and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'That date of birth doesn''t look right';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  v_new_card := v_member.wwcc_number is distinct from v_number
    or v_member.wwcc_expires_on is distinct from p_wwcc_expires_on;
  -- Cards last three years, so a later expiry is a typing mistake.
  if v_new_card and p_wwcc_expires_on > (current_date + interval '3 years')::date then
    raise exception 'A Working With Children Check lasts three years. Check the expiry date on the card';
  end if;

  update public.profiles
  set date_of_birth_recorded_by = case
        when date_of_birth is distinct from p_date_of_birth then auth.uid()
        else date_of_birth_recorded_by
      end,
      date_of_birth_recorded_at = case
        when date_of_birth is distinct from p_date_of_birth then now()
        else date_of_birth_recorded_at
      end,
      date_of_birth = p_date_of_birth,
      wwcc_number = v_number,
      wwcc_expires_on = p_wwcc_expires_on,
      -- A different card hasn't been validated or linked yet.
      wwcc_validated_at = case when v_new_card then null else wwcc_validated_at end,
      wwcc_validated_by = case when v_new_card then null else wwcc_validated_by end,
      wwcc_validation_method = case when v_new_card then null else wwcc_validation_method end,
      wwcc_unit_linked_at = case when v_new_card then null else wwcc_unit_linked_at end
  where id = p_profile_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Validating a card
-- ---------------------------------------------------------------------------

create or replace function public.admin_validate_wwcc(
  p_profile_id uuid,
  p_card_name text,
  p_method text,
  p_unit_linked boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_card_name text := nullif(trim(p_card_name), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can validate a Working With Children Check';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to validate your card';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_member.wwcc_number is null or v_member.wwcc_expires_on is null then
    raise exception 'Save their card number and expiry first';
  end if;
  if v_member.wwcc_expires_on < current_date then
    raise exception 'That card has expired';
  end if;
  if v_card_name is null then
    raise exception 'Enter the name as it appears on the card';
  end if;
  if length(v_card_name) > 120 then
    raise exception 'Keep the name on the card to 120 characters';
  end if;
  if p_method is null or p_method not in ('online', 'card_sighted', 'unit_letter') then
    raise exception 'Choose how you checked the card';
  end if;

  update public.profiles
  set wwcc_card_name = v_card_name,
      wwcc_validated_at = now(),
      wwcc_validated_by = auth.uid(),
      wwcc_validation_method = p_method,
      wwcc_unit_linked_at = case
        when coalesce(p_unit_linked, false) then coalesce(wwcc_unit_linked_at, now())
      end
  where id = p_profile_id;
end;
$$;

revoke execute on function public.admin_validate_wwcc(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_validate_wwcc(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- WWC Registration Officer
-- ---------------------------------------------------------------------------

create or replace function public.admin_wwc_officer()
returns table (officer_id uuid, officer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p)
  from public.safeguarding_settings s
  join public.profiles p on p.id = s.wwc_officer_id
  where s.id and public.is_admin();
$$;

revoke execute on function public.admin_wwc_officer() from public, anon;
grant execute on function public.admin_wwc_officer() to authenticated;

create or replace function public.admin_set_wwc_officer(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose the WWC Registration Officer';
  end if;
  if p_profile_id is not null and not (
    public.can_be_safeguarding_contact(p_profile_id)
    and exists (
      select 1 from public.profiles p
      where p.id = p_profile_id
        and public.roles_of(p.role, p.extra_roles) && array['admin', 'committee']::public.app_role[]
    )
  ) then
    raise exception 'The WWC Registration Officer must be an admin or committee member with a current Working With Children Check';
  end if;
  update public.safeguarding_settings set wwc_officer_id = p_profile_id where id;
end;
$$;

revoke execute on function public.admin_set_wwc_officer(uuid) from public, anon;
grant execute on function public.admin_set_wwc_officer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Screening Unit notices
-- ---------------------------------------------------------------------------

create table if not exists public.screening_notices (
  id uuid primary key default gen_random_uuid(),
  -- Kept when the member is deleted, so the record stays.
  profile_id uuid references public.profiles (id) on delete set null,
  member_name text not null,
  kind text not null check (kind in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled', 'other'
  )),
  received_on date not null,
  action text not null check (length(action) between 1 and 1000),
  governing_body_told_on date,
  governing_body_told_by_name text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_by_name text
);

-- Changed only through the functions below.
alter table public.screening_notices enable row level security;

drop policy if exists "Admins see screening notices" on public.screening_notices;
create policy "Admins see screening notices"
  on public.screening_notices for select to authenticated
  using (public.is_admin());

grant select on public.screening_notices to authenticated;

-- Records a notice. One that bars the member from working with children
-- stands them down at once, unless they already are.
create or replace function public.admin_record_screening_notice(
  p_profile_id uuid,
  p_kind text,
  p_received_on date,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
       && array['coach', 'manager', 'physio', 'committee', 'admin']::public.app_role[] then
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
$$;

revoke execute on function public.admin_record_screening_notice(uuid, text, date, text) from public, anon;
grant execute on function public.admin_record_screening_notice(uuid, text, date, text) to authenticated;

-- Records the date the club told the governing body about a notice.
create or replace function public.admin_screening_notice_reported(p_notice_id uuid, p_told_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change a Screening Unit notice';
  end if;
  if p_told_on is null or p_told_on > current_date then
    raise exception 'Enter the date you told the governing body';
  end if;
  if p_told_on < (select received_on from public.screening_notices where id = p_notice_id) then
    raise exception 'That''s before the notice arrived';
  end if;
  update public.screening_notices
  set governing_body_told_on = p_told_on,
      governing_body_told_by_name = public.my_display_name()
  where id = p_notice_id and governing_body_told_on is null;
  if not found then
    raise exception 'That notice isn''t waiting to be reported';
  end if;
end;
$$;

revoke execute on function public.admin_screening_notice_reported(uuid, date) from public, anon;
grant execute on function public.admin_screening_notice_reported(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin to-dos
-- ---------------------------------------------------------------------------

drop function if exists public.admin_safety_todos();
create function public.admin_safety_todos()
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
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is null
    )::int,
    count(*) filter (
      where public.needs_wwcc(m.roles, m.wwcc_exempt_reason)
        and public.has_current_wwcc(m.id)
        and (m.wwcc_validated_at is null or m.wwcc_validated_at < now() - interval '1 year')
    )::int,
    count(*) filter (
      where public.needs_wwcc(m.roles, m.wwcc_exempt_reason)
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

commit;
