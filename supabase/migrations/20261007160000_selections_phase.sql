-- Selections Phase 2 complete.
--
-- Once admins have named the teams from a squad, they mark the squad's
-- Selections Phase 2 complete. From then on the squad is no longer a coaching
-- group: coaches look after the athletes in their teams (touring athletes and
-- training partners), not everyone left in the squad. So their to-dos (check-in
-- flags and injury sign-offs) only cover their team's athletes.
--
-- Nobody is removed from the squad, so squad calendars, rosters and messages
-- still reach people, and admins can undo it.
--
-- Additive only: two new nullable columns and new or replaced functions.

alter table public.teams
  add column if not exists selections_completed_at timestamptz,
  add column if not exists selections_completed_by uuid
    references public.profiles (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'selections_complete_only_for_squads'
  ) then
    alter table public.teams
      add constraint selections_complete_only_for_squads
        check (selections_completed_at is null or kind = 'squad');
  end if;
end;
$$;

-- An admin marks a squad's Selections Phase 2 complete, or undoes it. A squad
-- needs at least one team named from it first.
create or replace function public.set_selections_complete(p_squad_id uuid, p_complete boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can complete selections';
  end if;
  if not exists (
    select 1 from public.teams where id = p_squad_id and kind = 'squad' and not archived
  ) then
    raise exception 'Squad not found';
  end if;
  if p_complete and not exists (
    select 1 from public.teams where squad_id = p_squad_id and not archived
  ) then
    raise exception 'Name the teams from this squad first';
  end if;

  update public.teams
  set selections_completed_at = case when p_complete then now() end,
      selections_completed_by = case when p_complete then auth.uid() end
  where id = p_squad_id;
end;
$$;

revoke execute on function public.set_selections_complete(uuid, boolean) from public, anon;
grant execute on function public.set_selections_complete(uuid, boolean) to authenticated;

-- Same as before, but a squad whose selections are complete no longer counts:
-- coaches only coach the athletes in their teams.
create or replace function public.coaches_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members coach
    join public.team_members athlete
      on athlete.team_id = coach.team_id and athlete.profile_id = p_athlete_id
    join public.teams t on t.id = coach.team_id
    where coach.profile_id = auth.uid()
      and coach.team_role = 'coach'
      and athlete.team_role = 'athlete'
      and not t.archived
      and t.selections_completed_at is null
  ) and public.is_approved();
$$;

-- Same as before, but when an athlete's only coaches are in a completed squad,
-- the clearance falls to admins, as it does for athletes with no coach.
create or replace function public.visible_injuries(
  p_include_cleared boolean default false,
  p_injury_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text,
  description text,
  injured_on date,
  restrictions text,
  expected_return date,
  status public.injury_status,
  coach_endorsed_by uuid,
  cleared_at timestamptz,
  created_at timestamptz,
  last_update_at timestamptz,
  can_report boolean,
  waiting_for_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.athlete_id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    i.body_area,
    i.description, i.injured_on, i.restrictions, i.expected_return, i.status,
    i.coach_endorsed_by, i.cleared_at, i.created_at,
    (select max(u.created_at) from public.injury_updates u where u.injury_id = i.id),
    public.can_report_for(i.athlete_id),
    i.athlete_left_at is null and i.athlete_id <> auth.uid() and (
      (i.status = 'clearance_requested'
        and (public.coaches_athlete(i.athlete_id)
          or (public.is_admin() and not exists (
            select 1 from public.team_members c
            join public.team_members a on a.team_id = c.team_id
            join public.teams t on t.id = c.team_id
            where a.profile_id = i.athlete_id and a.team_role = 'athlete'
              and c.team_role = 'coach' and not t.archived
              and t.selections_completed_at is null
          ))))
      or (i.status = 'coach_endorsed' and public.is_committee()
        and i.coach_endorsed_by is distinct from auth.uid())
    )
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  where public.can_view_athlete_injuries(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_include_cleared or i.athlete_left_at is null or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;

-- Same as before, leaving out squads whose selections are complete.
create or replace function public.check_in_summary(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_count int,
  checked_in_count int,
  flagged_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.kind::text,
    count(a.profile_id)::int,
    count(c.id)::int,
    count(c.id) filter (
      where least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    )::int
  from public.team_members coach
  join public.teams t on t.id = coach.team_id and not t.archived
    and t.selections_completed_at is null
  left join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
    and exists (select 1 from public.profiles p where p.id = a.profile_id and p.status = 'approved')
  left join public.check_ins c on c.athlete_id = a.profile_id and c.day = p_day
  where public.is_approved()
    and coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
  group by t.id, t.name, t.kind, t.sort_order
  order by t.kind, t.sort_order, t.name;
$$;

-- Same as before, but a completed squad's board is for admins only.
create or replace function public.check_in_board(p_team_id uuid, p_day date)
returns table (
  athlete_id uuid,
  full_name text,
  sleep smallint,
  soreness smallint,
  stress smallint,
  mood smallint,
  note text,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, coalesce(nullif(p.full_name, ''), p.email),
    c.sleep, c.soreness, c.stress, c.mood, c.note, c.updated_at
  from public.team_members a
  join public.profiles p on p.id = a.profile_id and p.status = 'approved'
  left join public.check_ins c on c.athlete_id = p.id and c.day = p_day
  where a.team_id = p_team_id
    and a.team_role = 'athlete'
    and public.is_approved()
    and (
      public.is_admin()
      or exists (
        select 1 from public.team_members coach
        join public.teams t on t.id = coach.team_id
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
          and t.selections_completed_at is null
      )
    )
  order by p.full_name;
$$;
