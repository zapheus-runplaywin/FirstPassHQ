-- Fixes from the manager guide audit (17 October 2026), decided by Matt.
--
-- 1. A paused coach, manager or physio (expired check, exemption ended or
--    not yet accepted) loses their groups' rosters, captains, team calendars,
--    fixtures and games at the database, not only on the home screen:
--    is_team_member and may_view_game now need can_work_with_children() for
--    staff placements. Athletes, guardians and admins are unchanged.
-- 2. Code of conduct acceptances and coaches' and managers' season KPI
--    sheets outlive the member's account, as the guide promises: the foreign
--    keys to profiles are dropped (like injuries), the member's name and
--    leaving time are stamped on the rows when the profile goes, and the
--    admin Season KPIs report lists people who have left.
--
-- Additive only: new columns, a trigger, replaced functions and dropped
-- foreign keys. No rows are changed or deleted when this migration runs.

begin;

-- ---------------------------------------------------------------------------
-- 1. Paused staff lose group access at the database
-- ---------------------------------------------------------------------------

-- A member of the squad or team: an athlete placed in it, or a coach,
-- manager or physio placed in it who may work with children right now.
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id and tm.profile_id = auth.uid() and p.status = 'approved'
      and (tm.team_role = 'athlete' or public.can_work_with_children())
  );
$$;

create or replace function public.may_view_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_statistician() or (
    public.can_work_with_children()
    and exists (
      select 1
      from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = p_game_id
        and tm.profile_id = auth.uid()
        and tm.team_role in ('coach', 'manager')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Conduct acceptances and KPI sheets outlive the account
-- ---------------------------------------------------------------------------

alter table public.conduct_acceptances
  add column if not exists member_name text,
  -- When the member's account was deleted. Null while they are a member.
  add column if not exists member_left_at timestamptz;
alter table public.conduct_acceptances drop constraint if exists conduct_acceptances_profile_id_fkey;

alter table public.season_kpis
  add column if not exists person_name text,
  add column if not exists person_left_at timestamptz;
alter table public.season_kpis drop constraint if exists season_kpis_profile_id_fkey;

alter table public.season_kpi_reviews
  add column if not exists person_name text,
  add column if not exists person_left_at timestamptz;
alter table public.season_kpi_reviews drop constraint if exists season_kpi_reviews_profile_id_fkey;

create or replace function public.keep_records_of_leaving_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(nullif(trim(old.preferred_name), ''), nullif(trim(old.full_name), ''), old.email);
begin
  update public.conduct_acceptances
  set member_name = v_name, member_left_at = now()
  where profile_id = old.id and member_left_at is null;
  update public.season_kpis
  set person_name = v_name, person_left_at = now()
  where profile_id = old.id and person_left_at is null;
  update public.season_kpi_reviews
  set person_name = v_name, person_left_at = now()
  where profile_id = old.id and person_left_at is null;
  return old;
end;
$$;

revoke execute on function public.keep_records_of_leaving_member() from public, anon, authenticated;

drop trigger if exists profiles_keep_records on public.profiles;
create trigger profiles_keep_records
  before delete on public.profiles
  for each row execute function public.keep_records_of_leaving_member();

-- The admin report now also lists coaches and managers who have left the
-- club but whose KPI sheets the club keeps, with when they left.
drop function if exists public.season_kpi_report(int);
create function public.season_kpi_report(p_season int)
returns table (
  team_id uuid,
  team_name text,
  team_kind public.group_kind,
  profile_id uuid,
  full_name text,
  team_role public.team_role,
  coach_title public.coach_title,
  left_at timestamptz,
  kpi_id uuid,
  format public.kpi_format,
  title text,
  measures jsonb,
  result public.kpi_result,
  result_note text,
  set_by_name text,
  reviews jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select m.profile_id, m.team_id, m.team_role, m.coach_title,
      null::text as left_name, null::timestamptz as left_at
    from public.team_members m
    where m.team_role in ('coach', 'manager')
    union all
    select k.profile_id, k.team_id, k.team_role, null::public.coach_title,
      max(k.person_name), max(k.person_left_at)
    from public.season_kpis k
    where k.person_left_at is not null and k.team_role in ('coach', 'manager')
      and not exists (
        select 1 from public.team_members m
        where m.profile_id = k.profile_id and m.team_id = k.team_id
      )
    group by k.profile_id, k.team_id, k.team_role
  )
  select t.id, t.name, t.kind, x.profile_id,
    coalesce(public.member_display_name(x.profile_id), x.left_name, 'Former member'),
    x.team_role, x.coach_title, x.left_at, k.id, k.format, k.title,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', ms.title, 'kind', ms.kind, 'target', ms.target, 'unit', ms.unit,
        'lower_is_better', ms.lower_is_better, 'current_value', ms.current_value, 'done', ms.done
      ) order by ms.sort_order)
      from public.season_kpi_measures ms where ms.kpi_id = k.id
    ), '[]'::jsonb),
    k.result, k.result_note, public.member_display_name(k.set_by),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rp.name,
        'due_on', rp.due_on,
        'written', r.note is not null,
        'confirmed', r.confirmed_at is not null
      ) order by rp.due_on, rp.name)
      from public.season_kpi_review_points rp
      left join public.season_kpi_reviews r
        on r.point_id = rp.id and r.profile_id = x.profile_id and r.team_id = t.id
      where rp.season = t.season
    ), '[]'::jsonb)
  from public.teams t
  join people x on x.team_id = t.id
  left join public.season_kpis k on k.profile_id = x.profile_id and k.team_id = t.id
  where public.is_admin() and t.season = p_season
  order by t.sort_order, t.name, x.team_role, 5, k.created_at;
$$;

revoke execute on function public.season_kpi_report(int) from public, anon;
grant execute on function public.season_kpi_report(int) to authenticated;

commit;
