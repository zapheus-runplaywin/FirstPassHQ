-- A child's kept injury records keep their under-18 rules after the child's
-- account is deleted (security audit run 1, 6 November 2026).
--
-- Injury records outlive the athlete's profile (20261007140000). Every
-- under-18 rule on injuries (committee and admin screening, C6 and C8, and
-- health consent) asks athlete_is_minor, which read the age from the
-- profile and counted a missing profile as an adult. Once a child deleted
-- their account, or an admin deleted it, the kept injuries, their updates
-- and their documents could be read by committee members who aren't
-- screened and admins whose check has lapsed, and coaches and physios no
-- longer needed health consent.
--
-- Now:
-- 1. When an athlete's profile is deleted, their date of birth and under-17
--    answer are kept on their injury records with the name and email, so a
--    child stays under 18 until their 18th birthday and an adult stays an
--    adult.
-- 2. athlete_is_minor uses the profile while there is one, then that kept
--    age. When neither tells (records kept before this change, or an id with
--    no profile and no kept age), it counts as under 18, so the stricter
--    rules apply.
--
-- Additive only: two new nullable columns and two replaced functions. No
-- existing rows are changed.

begin;

alter table public.injuries
  add column if not exists athlete_date_of_birth date,
  add column if not exists athlete_under_17 boolean;

create or replace function public.keep_injuries_of_leaving_athlete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.injuries
  set athlete_name = coalesce(nullif(old.full_name, ''), old.email),
      athlete_email = old.email,
      athlete_date_of_birth = old.date_of_birth,
      -- Never null once kept, so null on both columns means "kept before
      -- this change".
      athlete_under_17 = coalesce(old.under_17, false),
      athlete_left_at = now()
  where athlete_id = old.id and athlete_left_at is null;
  return old;
end;
$$;

revoke execute on function public.keep_injuries_of_leaving_athlete() from public, anon, authenticated;

-- Whether the athlete is under 18: from their profile, or, once it's gone,
-- from the age kept on their injury records. Unknown counts as under 18.
create or replace function public.athlete_is_minor(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.is_minor(p.date_of_birth, p.under_17)
     from public.profiles p where p.id = p_athlete_id),
    (select bool_or(
        case when i.athlete_date_of_birth is null and i.athlete_under_17 is null then true
             else public.is_minor(i.athlete_date_of_birth, i.athlete_under_17) end)
     from public.injuries i
     where i.athlete_id = p_athlete_id and i.athlete_left_at is not null),
    true
  );
$$;

revoke execute on function public.athlete_is_minor(uuid) from public, anon, authenticated;

commit;
