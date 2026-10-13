-- Child safety finding 16: a date from which every committee member needs a
-- Working With Children Check.
--
-- Committee members approved before committee checks were needed (PR #80)
-- kept their role with no check recorded, and admins were reminded with no
-- end date. Each club now has a "Committee checks required from" date,
-- 90 days after this migration runs. From that day a committee member with
-- no check recorded and no exemption has their committee role paused, the
-- same as an expired check. Admins can bring the date forward but not push it
-- back; a committee member who never works with children is exempted with a
-- reason instead, as before.
--
-- Additive only: a new column with a default, new functions, and a new
-- version of has_role whose only change is the committee rule.

begin;

alter table public.safeguarding_settings
  add column if not exists committee_checks_from date not null default (current_date + 90);

-- The day from which committee members need a check or an exemption.
create or replace function public.committee_checks_from()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select s.committee_checks_from from public.safeguarding_settings s where s.id;
$$;

revoke execute on function public.committee_checks_from() from public, anon;
grant execute on function public.committee_checks_from() to authenticated;

-- Brings the date forward. It can't be pushed back, so the club can't keep
-- putting it off.
create or replace function public.admin_set_committee_checks_from(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current date := public.committee_checks_from();
begin
  if not public.is_admin() then
    raise exception 'Only admins can change safeguarding settings';
  end if;
  if p_date is null then
    raise exception 'Choose the date committee checks are required from';
  end if;
  if v_current is not null and p_date > v_current then
    raise exception 'The date can only be brought forward. Exempt a committee member with a reason if they never work with children';
  end if;
  update public.safeguarding_settings
  set committee_checks_from = p_date, updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_committee_checks_from(date) from public, anon;
grant execute on function public.admin_set_committee_checks_from(date) to authenticated;

-- As before, except a committee member with no check recorded only keeps the
-- role until the club's committee checks date.
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
          )
        when p_role = 'admin' then p.stood_down_at is null
        else true
      end
  );
$$;

revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

commit;
