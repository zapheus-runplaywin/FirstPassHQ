-- A club chooses which committee members see injuries (customer review R7,
-- Matt, 23 October 2026: "Whole committee or chosen").
--
-- * Safeguarding settings get "Injuries are seen by": the whole committee
--   (the default, so nothing changes until an admin switches it) or chosen
--   committee members, whom an admin ticks.
-- * With chosen members, a committee member who isn't ticked sees no injury,
--   adult or child, and doesn't send back or accept clearances. A ticked one
--   follows the same rules as before: an under 18's injuries only with a
--   current check, an application in force or a volunteer exemption (C6).
-- * Admins aren't affected: they see injuries as admins (C8 still applies)
--   and accept clearances, so a club that ticks nobody still has someone to
--   sign off a return to play.
-- * Everything committee members see or sign off goes through
--   committee_sees_injuries_of, so that is the one rule that changes.
--
-- Additive: two columns with defaults on safeguarding_settings, new functions,
-- and a new version of committee_sees_injuries_of. No rows change.

begin;

alter table public.safeguarding_settings
  add column if not exists injury_committee_chosen boolean not null default false,
  add column if not exists injury_committee_ids uuid[] not null default '{}';

-- Whether this committee member is one who sees injuries under the club's
-- choice. Says nothing about whether they hold the committee role.
create or replace function public.committee_member_sees_injuries(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce(s.injury_committee_chosen, false)
    or p_member_id = any (coalesce(s.injury_committee_ids, '{}'))
  from (select true) x
  left join public.safeguarding_settings s on s.id;
$$;
revoke execute on function public.committee_member_sees_injuries(uuid) from public, anon, authenticated;

-- Whether the signed-in member sees this athlete's injuries as committee:
-- admins as before (an under 18's only while admin_sees_children_injuries);
-- committee members the club's choice includes, for adults, and for under
-- 18s only when screened.
create or replace function public.committee_sees_injuries_of(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.has_role('admin')
      and (not public.athlete_is_minor(p_athlete_id) or public.admin_sees_children_injuries(auth.uid())))
    or (public.has_role('committee')
      and public.committee_member_sees_injuries(auth.uid())
      and (not public.athlete_is_minor(p_athlete_id) or public.is_cleared(auth.uid())));
$$;
revoke execute on function public.committee_sees_injuries_of(uuid) from public, anon, authenticated;

-- For the app: whether the signed-in committee member has the Injuries
-- screen as committee. False for anyone not on the committee.
create or replace function public.my_committee_sees_injuries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('committee') and public.committee_member_sees_injuries(auth.uid());
$$;
revoke execute on function public.my_committee_sees_injuries() from public, anon;
grant execute on function public.my_committee_sees_injuries() to authenticated;

-- The club's choice, for admins.
create or replace function public.admin_injury_committee()
returns table (chosen boolean, member_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.injury_committee_chosen, false), coalesce(s.injury_committee_ids, '{}')
  from (select true) x
  left join public.safeguarding_settings s on s.id
  where public.is_admin();
$$;
revoke execute on function public.admin_injury_committee() from public, anon;
grant execute on function public.admin_injury_committee() to authenticated;

-- Admins set the choice and, for chosen members, who they are. Only approved
-- committee members can be chosen. The list is kept when switching back to
-- the whole committee, so switching again brings the same people back.
create or replace function public.admin_set_injury_committee(p_chosen boolean, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct unnest(coalesce(p_member_ids, '{}')));
begin
  if not public.is_admin() then
    raise exception 'Only admins can change safeguarding settings';
  end if;
  if p_chosen is null then
    raise exception 'Choose who on the committee sees injuries';
  end if;
  if exists (
    select 1 from unnest(v_ids) as m(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = m.id and p.status = 'approved'
        and (p.role = 'committee' or 'committee' = any (p.extra_roles))
    )
  ) then
    raise exception 'Only approved committee members can be chosen to see injuries';
  end if;
  insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;
  update public.safeguarding_settings
  set injury_committee_chosen = p_chosen,
      injury_committee_ids = v_ids,
      updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_injury_committee(boolean, uuid[]) from public, anon;
grant execute on function public.admin_set_injury_committee(boolean, uuid[]) to authenticated;

commit;
