-- Two edge cases the randomised role tests found
-- (src/lib/__tests__/roles.property.test.ts), matching src/lib/roles.ts:
--
-- 1. A parent or guardian with no date of birth whom an admin marked as
--    under 18 was let through. The guardian rule now uses the same
--    under-18 test as the athlete rule: the date of birth when recorded,
--    otherwise the admin's choice.
-- 2. A role listed twice counted twice, so a guest or temporary helper
--    listed twice was refused for "another role". Each role now counts once.
--
-- Function change only; no rows change. Members already saved this way are
-- only asked to fix it the next time an admin saves them.

begin;

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
  with r as (select array(select distinct unnest(p_roles)) as roles)
  select case
    when 'partner' = any (r.roles)
      then 'The Partner role has been removed. Use Guest instead.'
    when 'guest' = any (r.roles) and cardinality(r.roles) > 1
      then 'Guests can''t have another role'
    when 'volunteer' = any (r.roles) and cardinality(r.roles) > 1
      then 'Temporary helpers can''t have another role'
    when 'admin' = any (r.roles) and 'athlete' = any (r.roles)
      then 'Admins can''t also be athletes'
    when 'athlete' = any (r.roles) and 'manager' = any (r.roles)
      then 'Athletes can''t also be managers'
    when 'athlete' = any (r.roles) and 'physio' = any (r.roles)
      then 'Athletes can''t also be physios'
    when 'athlete' = any (r.roles) and public.is_minor(p_date_of_birth, p_under_18)
      and not r.roles <@ array['athlete', 'coach']::public.app_role[]
      then 'Athletes under 18 can only also be a coach'
    when 'guardian' = any (r.roles) and public.is_minor(p_date_of_birth, p_under_18)
      then 'Parents and guardians must be 18 or over'
  end
  from r;
$$;

commit;
