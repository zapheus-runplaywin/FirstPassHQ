-- Follow-ups from the staff review of #170 to #172 (Matt, 23 October 2026).
--
-- 1. Wellbeing flags stop at the database when the club turns off Daily
--    check-ins, not only in the app.
-- 2. An index on who a concern is about, which the nightly clean-up asks
--    once per candidate row through on_legal_hold.
-- 3. A note on has_role saying why statisticians and committee members are
--    screened differently, so nobody "harmonises" them later.
--
-- Additive only: one new index, one replaced function that returns the same
-- or fewer rows, and a comment. No rows are changed or removed.

begin;

-- As before, and nothing at all while the club has Daily check-ins off
-- (Club settings, on unless switched off).
create or replace function public.wellbeing_flag_rows(p_days int)
returns table (athlete_id uuid, athlete_name text, day date, lowest_score smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.athlete_id,
    coalesce(public.member_display_name(c.athlete_id), 'Athlete'),
    c.day,
    least(c.sleep, c.soreness, c.stress, c.mood)
  from public.check_ins c
  join public.profiles p on p.id = c.athlete_id
  where coalesce(
      (select (s.features ->> 'checkIns')::boolean is distinct from false
       from public.club_settings s where s.id),
      true
    )
    and c.day > current_date - least(greatest(coalesce(p_days, 14), 1), 60)
    and least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    and p.status = 'approved'
    and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
    and public.has_child_consent(c.athlete_id, 'data');
$$;

revoke execute on function public.wellbeing_flag_rows(int) from public, anon, authenticated;

create index if not exists concerns_about_member_idx on public.concerns (about_member_id);

comment on function public.has_role(public.app_role) is
  'Whether the signed-in member holds this role and can use it now. Coaches, managers, physios and statisticians '
  'are screened by is_cleared (a current check, a lodged application or a volunteer exemption such as a parent at '
  'their child''s games); committee members by a current check or a lodged application only, since a volunteer '
  'exemption does not cover committee work. Committee members and statisticians may instead be exempt with a '
  'written reason, or keep the role without a card until the club''s checks date for that role.';

commit;
