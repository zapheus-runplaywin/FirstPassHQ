-- Fixes from the guest and temporary helper guide audits (18 October 2026).
--
-- 1. Guests and temporary helpers can't be named Child Safety Officer or
--    Complaints Manager (the screen already offered only cleared adults; the
--    database rule now also excludes the two roles that hold no club access).
-- 2. The admin's Working With Children Check to-dos leave out a temporary
--    helper whose first day is still ahead in every count, not only the
--    missing-check count, as the guide says.
--
-- Additive only: two replaced functions. No rows are changed.

begin;

create or replace function public.can_be_safeguarding_contact(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.status = 'approved' and p.stood_down_at is null
      and p.role not in ('guest', 'volunteer')
      and not public.is_minor(p.date_of_birth, p.under_17)
  ) and public.is_cleared(p_profile_id);
$$;

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

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

commit;
