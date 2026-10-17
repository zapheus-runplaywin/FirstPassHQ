-- Access ends when a Working With Children Check does, and admins can stand
-- someone down.
--
-- Child-safety audit, 12 October 2026, finding 1. Until now a check was only
-- looked at when an admin approved someone. A coach, manager or physio whose
-- check expired, or who the Working with Children Screening Unit told the club
-- to remove from child-related work, kept reading children's injuries and
-- check-ins and messaging their squads until an admin remembered to act.
--
-- - Coach, manager and physio rights now need a current check every time they
--   are used, so they stop on the day it expires and come back when an admin
--   records the renewed one. Their squad and team places stay.
-- - A committee member whose recorded check has expired loses committee
--   rights the same way. Committee members with no check recorded and no
--   exemption (approved before checks were needed) are unchanged for now.
-- - An admin can stand a member down, with the reason: an interim negative
--   notice, a negative notice, an interstate decision, an allegation being
--   looked into, or another reason they write down. A stood-down member's
--   coach, manager, physio, committee and admin rights stop straight away, and
--   they're taken out of the squads and teams they coach, manage or treat.
--   Their athlete and guardian rights are unchanged. Lifting the stand-down
--   puts those places back. Every stand-down is kept with who started and
--   lifted it, even if the member is later deleted.
-- - Admins hear about checks 60 days before they expire instead of 30, since
--   a renewal takes weeks.
--
-- Additive only: a new column, a new table, a new trigger and replaced
-- functions. No existing rows are changed.

begin;

alter table public.profiles
  add column if not exists stood_down_at timestamptz;

create table if not exists public.stand_downs (
  id uuid primary key default gen_random_uuid(),
  -- Kept when the member is deleted, so the record of the stand-down stays.
  profile_id uuid references public.profiles (id) on delete set null,
  member_name text not null,
  reason text not null check (reason in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'allegation', 'other'
  )),
  note text check (length(note) <= 1000),
  -- The squad and team places taken away, to put back when it's lifted.
  placements jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  started_by uuid references public.profiles (id) on delete set null,
  started_by_name text,
  lifted_at timestamptz,
  lifted_by uuid references public.profiles (id) on delete set null,
  lifted_by_name text,
  lift_note text check (length(lift_note) <= 1000)
);

create unique index if not exists stand_downs_one_open_idx
  on public.stand_downs (profile_id) where lifted_at is null;

-- Changed only through admin_stand_down and admin_lift_stand_down.
alter table public.stand_downs enable row level security;

drop policy if exists "Admins see stand-downs" on public.stand_downs;
create policy "Admins see stand-downs"
  on public.stand_downs for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Who may use a role right now
-- ---------------------------------------------------------------------------

-- Whether the signed-in member may work with children as a coach, manager or
-- physio right now: approved, not stood down, and holding a current check.
create or replace function public.can_work_with_children()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and stood_down_at is null
  ) and public.has_current_wwcc(auth.uid());
$$;

revoke execute on function public.can_work_with_children() from public, anon;
grant execute on function public.can_work_with_children() to authenticated;

-- Whether the signed-in, approved member holds a role they may use now.
-- Coach, manager and physio need a current check; committee members lose the
-- role when a check they had recorded expires, unless they're exempt; and a
-- stood-down member can't use any of those or admin. Athlete, guardian and
-- guest are unaffected.
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
          p.stood_down_at is null and public.has_current_wwcc(p.id)
        when p_role = 'committee' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or coalesce(trim(p.wwcc_number), '') = ''
            or public.has_current_wwcc(p.id)
          )
        when p_role = 'admin' then p.stood_down_at is null
        else true
      end
  );
$$;

-- ---------------------------------------------------------------------------
-- Rights that come from a squad or team place: the same as before, plus
-- can_work_with_children()
-- ---------------------------------------------------------------------------

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
  ) and public.is_approved() and public.can_work_with_children();
$$;

create or replace function public.leads_group(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role in ('coach', 'manager')
      and not t.archived
  );
$$;

create or replace function public.can_message_group(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.is_group_captain(p_team_id) or (
    public.can_work_with_children() and exists (
      select 1
      from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id
        and tm.profile_id = auth.uid()
        and tm.team_role in ('coach', 'manager')
        and p.status = 'approved'
    )
  );
$$;

create or replace function public.is_attendance_taker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_committee() or (
    public.is_approved() and (
      public.has_role('coach') or public.has_role('manager')
      or (public.can_work_with_children() and exists (
        select 1 from public.team_members
        where profile_id = auth.uid() and team_role in ('coach', 'manager')
      ))
    )
  );
$$;

create or replace function public.can_view_team_attendance(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_committee() or (
    public.is_approved() and public.can_work_with_children() and exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and team_role = 'coach'
    )
  );
$$;

create or replace function public.coaches_fixture_team(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and public.can_work_with_children() and exists (
    select 1
    from public.fixtures f
    join public.teams t on t.id = f.team_id
    join public.team_members coach
      on coach.team_id = t.id and coach.profile_id = auth.uid() and coach.team_role = 'coach'
    where f.id = p_fixture_id
      and not t.archived
      and t.selections_completed_at is null
  );
$$;

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
    and public.can_work_with_children()
    and exists (
      select 1 from public.team_members coach
      join public.teams t on t.id = coach.team_id
      where coach.team_id = p_team_id
        and coach.profile_id = auth.uid()
        and coach.team_role = 'coach'
        and t.selections_completed_at is null
    )
  order by p.full_name;
$$;

create or replace function public.check_in_summary(p_day date)
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_count integer,
  checked_in_count integer,
  flagged_count integer
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
    and public.can_work_with_children()
    and coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
  group by t.id, t.name, t.kind, t.sort_order
  order by t.kind, t.sort_order, t.name;
$$;

create or replace function public.coach_team_games()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  fixture_id uuid,
  is_next boolean,
  round_name text,
  opponent text,
  starts_at timestamptz,
  time_tbc boolean,
  goals_close_at timestamptz,
  played_at timestamptz,
  goal_count int,
  reviewed_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.kind::text, g.id, g.is_next, g.round_name, g.opponent, g.starts_at,
    g.time_tbc, public.fixture_goals_close_at(g.f), public.fixture_played_at(g.f),
    (select count(*)::int from public.team_game_goals x where x.fixture_id = g.id),
    (select count(*)::int from public.team_game_goals x
      where x.fixture_id = g.id and (x.outcome is not null or x.review is not null))
  from public.team_members coach
  join public.teams t on t.id = coach.team_id
  cross join lateral (
    (select f, f.id, true as is_next, f.round_name, f.opponent, f.starts_at, f.time_tbc
     from public.fixtures f
     where f.team_id = t.id and f.opponent is not null
       and public.fixture_played_at(f) > now() and f.starts_at <= now() + interval '7 days'
     order by f.starts_at limit 1)
    union all
    (select f, f.id, false, f.round_name, f.opponent, f.starts_at, f.time_tbc
     from public.fixtures f
     where f.team_id = t.id and f.opponent is not null and public.fixture_played_at(f) <= now()
     order by f.starts_at desc limit 1)
  ) g
  where coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
    and not t.archived
    and t.selections_completed_at is null
    and public.is_approved()
    and public.can_work_with_children()
  order by t.kind, t.sort_order, t.name, g.is_next desc;
$$;

create or replace function public.goal_board()
returns table (
  team_id uuid,
  team_name text,
  team_kind text,
  athlete_id uuid,
  athlete_name text,
  next_fixture_id uuid,
  next_label text,
  next_starts_at timestamptz,
  next_goal_count int,
  reflections_to_answer int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.kind::text, p.id, coalesce(nullif(p.full_name, ''), p.email),
    n.id, case when n.id is null then null else public.fixture_label(n) end, n.starts_at,
    (select count(*)::int from public.game_goals x
      where x.athlete_id = p.id and x.fixture_id = n.id),
    (select count(*)::int from public.game_goals x
      join public.athlete_games(p.id) g on g.id = x.fixture_id
      where x.athlete_id = p.id
        and (x.outcome is not null or x.reflection is not null)
        and not exists (select 1 from public.game_goal_comments c where c.goal_id = x.id))
  from public.team_members coach
  join public.teams t on t.id = coach.team_id
  join public.team_members a on a.team_id = t.id and a.team_role = 'athlete'
  join public.profiles p on p.id = a.profile_id and p.status = 'approved'
  left join lateral (select * from public.next_goal_game(p.id)) n on true
  where coach.profile_id = auth.uid()
    and coach.team_role = 'coach'
    and not t.archived
    and t.selections_completed_at is null
    and public.is_approved()
    and public.can_work_with_children()
  order by t.kind, t.sort_order, t.name, p.full_name;
$$;

-- Both versions of set_group_captains: the same as before, with the coach's
-- check needed too.
create or replace function public.set_group_captains(
  p_team_id uuid,
  p_captain_id uuid,
  p_vice_captain_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vice uuid[] := coalesce(p_vice_captain_ids, '{}');
  v_all uuid[];
begin
  if not exists (select 1 from public.teams where id = p_team_id and not archived) then
    raise exception 'Choose a current squad or team';
  end if;
  if not (public.is_admin() or (public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and p.status = 'approved'
  ))) then
    raise exception 'Only admins and this group''s coaches can choose its captains';
  end if;
  if p_captain_id is not null and p_captain_id = any (v_vice) then
    raise exception 'The captain can''t also be a vice captain';
  end if;

  v_all := v_vice || case when p_captain_id is null then '{}'::uuid[] else array[p_captain_id] end;
  if exists (
    select 1 from unnest(v_all) as i(id)
    where not exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id and tm.profile_id = i.id
        and tm.team_role = 'athlete' and p.status = 'approved'
    )
  ) then
    raise exception 'Captains must be athletes in this squad or team';
  end if;

  delete from public.team_captains where team_id = p_team_id;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'vice_captain'::public.captain_role
  from (select distinct unnest(v_vice) as id) i;

  if p_captain_id is not null then
    insert into public.team_captains (team_id, profile_id, captain_role)
    values (p_team_id, p_captain_id, 'captain');
  end if;
end;
$$;

create or replace function public.set_group_captains(
  p_team_id uuid,
  p_captain_ids uuid[],
  p_vice_captain_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captains uuid[] := coalesce(p_captain_ids, '{}');
  v_vice uuid[] := coalesce(p_vice_captain_ids, '{}');
begin
  if not exists (select 1 from public.teams where id = p_team_id and not archived) then
    raise exception 'Choose a current squad or team';
  end if;
  if not (public.is_admin() or (public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and p.status = 'approved'
  ))) then
    raise exception 'Only admins and this group''s coaches can choose its captains';
  end if;
  if v_captains && v_vice then
    raise exception 'A captain can''t also be a vice captain';
  end if;

  if exists (
    select 1 from unnest(v_captains || v_vice) as i(id)
    where not exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = p_team_id and tm.profile_id = i.id
        and tm.team_role = 'athlete' and p.status = 'approved'
    )
  ) then
    raise exception 'Captains must be athletes in this squad or team';
  end if;

  delete from public.team_captains where team_id = p_team_id;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'captain'::public.captain_role
  from (select distinct unnest(v_captains) as id) i;

  insert into public.team_captains (team_id, profile_id, captain_role)
  select p_team_id, i.id, 'vice_captain'::public.captain_role
  from (select distinct unnest(v_vice) as id) i;
end;
$$;

-- ---------------------------------------------------------------------------
-- Standing a member down
-- ---------------------------------------------------------------------------

-- A stood-down member can't be put back into a squad or team as a coach,
-- manager or physio until the stand-down is lifted.
create or replace function public.check_not_stood_down()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team_role in ('coach', 'manager', 'physio') and exists (
    select 1 from public.profiles where id = new.profile_id and stood_down_at is not null
  ) then
    raise exception 'They''re stood down. Lift the stand-down before placing them as a coach, manager or physio.';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_not_stood_down() from public, anon, authenticated;

drop trigger if exists team_members_not_stood_down on public.team_members;
create trigger team_members_not_stood_down
  before insert or update of team_role on public.team_members
  for each row execute function public.check_not_stood_down();

-- Stands a member down. Their coach, manager, physio, committee and admin
-- rights stop now, and their places in current squads and teams as a coach,
-- manager or physio are taken away and kept to put back later.
create or replace function public.admin_stand_down(p_profile_id uuid, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_note text := nullif(trim(p_note), '');
  v_placements jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can stand members down';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if not public.roles_of(v_member.role, v_member.extra_roles)
     && array['coach', 'manager', 'physio', 'committee', 'admin']::public.app_role[] then
    raise exception 'Only coaches, managers, physios, committee members and admins can be stood down';
  end if;
  if v_member.stood_down_at is not null then
    raise exception 'They''re already stood down';
  end if;
  if p_reason is null or p_reason not in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'allegation', 'other'
  ) then
    raise exception 'Choose why they''re being stood down';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'Say why they''re being stood down';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', tm.team_id, 'team_role', tm.team_role, 'coach_title', tm.coach_title
  )), '[]'::jsonb)
  into v_placements
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  update public.profiles set stood_down_at = now() where id = p_profile_id;

  insert into public.stand_downs (
    profile_id, member_name, reason, note, placements, started_by, started_by_name
  )
  values (
    p_profile_id,
    coalesce(nullif(v_member.full_name, ''), v_member.email, 'Unnamed member'),
    p_reason,
    v_note,
    v_placements,
    auth.uid(),
    public.my_display_name()
  );
end;
$$;

revoke execute on function public.admin_stand_down(uuid, text, text) from public, anon;
grant execute on function public.admin_stand_down(uuid, text, text) to authenticated;

-- Lifts a stand-down and puts back the squad and team places that are still
-- in the current season, for roles they still hold. A coach, manager or
-- physio still needs a current check before their rights come back.
create or replace function public.admin_lift_stand_down(p_profile_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_open public.stand_downs;
  v_note text := nullif(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can lift a stand-down';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  select * into v_open from public.stand_downs
  where profile_id = p_profile_id and lifted_at is null;
  if v_open.id is null then
    raise exception 'They aren''t stood down';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  update public.stand_downs
  set lifted_at = now(),
      lifted_by = auth.uid(),
      lifted_by_name = public.my_display_name(),
      lift_note = v_note
  where id = v_open.id;

  update public.profiles set stood_down_at = null where id = p_profile_id;

  -- Squads before teams, so a team place always finds its squad place.
  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select
    t.id,
    p_profile_id,
    (x ->> 'team_role')::public.team_role,
    (x ->> 'coach_title')::public.coach_title
  from jsonb_array_elements(v_open.placements) as x
  join public.teams t on t.id = (x ->> 'team_id')::uuid and not t.archived
  where (x ->> 'team_role')::public.app_role
    = any (public.roles_of(v_member.role, v_member.extra_roles))
  order by t.squad_id nulls first
  on conflict (team_id, profile_id) do nothing;
end;
$$;

revoke execute on function public.admin_lift_stand_down(uuid, text) from public, anon;
grant execute on function public.admin_lift_stand_down(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin to-dos: checks expiring within 60 days
-- ---------------------------------------------------------------------------

create or replace function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer
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
        and not public.has_current_wwcc(m.id)
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
    )::int
  from members m;
$$;

-- A coach's check-in trend also needs a current check and no stand-down.
create or replace function public.check_in_trend(p_team_id uuid, p_since date, p_until date)
returns table (
  day date,
  checked_in_count int,
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.is_approved() and p_until - p_since between 0 and 366 and (
      public.is_committee()
      or public.is_physio()
      or (p_team_id is not null and exists (
        select 1 from public.team_members coach
        join public.teams t on t.id = coach.team_id
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
          and public.can_work_with_children()
          and not t.archived
          and t.selections_completed_at is null
      ))
    ) as ok
  ),
  athletes as (
    select distinct a.profile_id
    from public.team_members a
    join public.teams t on t.id = a.team_id and not t.archived
    join public.profiles p on p.id = a.profile_id and p.status = 'approved'
    where a.team_role = 'athlete'
      and (p_team_id is null or a.team_id = p_team_id)
  ),
  days as (
    select d::date as day from generate_series(p_since, p_until, interval '1 day') d
  ),
  scores as (
    select
      d.day,
      count(c.id)::int as checked_in,
      count(c.id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from days d
    left join public.check_ins c on c.day = d.day
      and c.athlete_id in (select profile_id from athletes)
    group by d.day
  ),
  shown as (
    select v.day, v.visible
    from public.check_in_visible_days(p_since, p_until) v
    where v.team_id is not distinct from p_team_id
  )
  select
    s.day, s.checked_in,
    case when v.visible then s.flagged end,
    case when v.visible then round(s.sleep, 1) end,
    case when v.visible then round(s.soreness, 1) end,
    case when v.visible then round(s.stress, 1) end,
    case when v.visible then round(s.mood, 1) end
  from scores s
  left join shown v on v.day = s.day, allowed
  where allowed.ok
  order by s.day;
$$;

commit;
