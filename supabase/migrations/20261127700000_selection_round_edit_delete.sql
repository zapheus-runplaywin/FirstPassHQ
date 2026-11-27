-- Admins edit and delete selection rounds (27 November 2026).
--
-- Adds a nullable description to a round, a table that keeps a short record
-- of each deleted round, and two more kinds of round change ('description',
-- 'team'). No existing row is changed or removed by the migration itself.
--
--   admin_save_selection_round now also takes a description and a squad or
--     team. The squad or team can change only until assessing starts (no
--     observation, summary, feedback or release yet); the no-overlap rule
--     and the phase and round order still apply.
--   admin_delete_selection_round deletes a round that isn't running and has
--     no assessment written in it. A running round is closed first; a round
--     with assessments is refused, never cascaded, so no assessment is lost.
--     A short record of the deleted round (names, dates and its change
--     history; never an athlete) is kept for the Selection register.
begin;

alter table public.selection_rounds
  add column if not exists description text check (description is null or length(description) <= 500);

alter table public.selection_round_events drop constraint if exists selection_round_events_kind_check;
alter table public.selection_round_events add constraint selection_round_events_kind_check
  check (kind in ('opened', 'renamed', 'dates', 'phase', 'criteria', 'closed', 'reopened', 'description', 'team'));

-- A deleted round, kept so the season's register still shows it was set up
-- and who removed it. Staff names and dates only.
create table if not exists public.selection_round_deletions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  season integer not null,
  team_id uuid references public.teams (id) on delete set null,
  team_name text not null,
  name text not null,
  description text,
  phase smallint,
  round_number smallint,
  starts_on date not null,
  ends_on date not null,
  closed_at timestamptz,
  opened_at timestamptz,
  opened_by_name text,
  criteria_set_name text,
  criteria_set_version integer,
  history jsonb not null default '[]'::jsonb,
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);
create index if not exists selection_round_deletions_season_idx on public.selection_round_deletions (season, deleted_at);
alter table public.selection_round_deletions enable row level security;
revoke all on table public.selection_round_deletions from public, anon, authenticated;
grant all on table public.selection_round_deletions to service_role;

-- Whether anything has been written about an athlete in this round.
create or replace function public.selection_round_has_assessments(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.assessment_observations o where o.round_id = p_round_id)
    or exists (select 1 from public.assessment_summaries s where s.round_id = p_round_id)
    or exists (select 1 from public.assessment_feedback f where f.round_id = p_round_id)
    or exists (select 1 from public.assessment_releases x where x.round_id = p_round_id);
$$;
revoke execute on function public.selection_round_has_assessments(uuid) from public, anon, authenticated;

-- Running today: open, started and not yet ended.
create or replace function public.selection_round_running(p_round public.selection_rounds)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_round.closed_at is null
    and p_round.starts_on <= public.club_today()
    and p_round.ends_on >= public.club_today();
$$;
revoke execute on function public.selection_round_running(public.selection_rounds) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saving a round: name, description, dates, phase and round, squad or team
-- ---------------------------------------------------------------------------
drop function if exists public.admin_save_selection_round(uuid, text, date, date, integer, integer);
create or replace function public.admin_save_selection_round(
  p_round_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_phase integer default null,
  p_round_number integer default null,
  -- null keeps the description, and an empty one clears it.
  p_description text default null,
  -- null keeps the squad or team.
  p_team_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_team public.teams;
  v_old_team text;
  v_phase integer;
  v_number integer;
  v_name text := trim(coalesce(p_name, ''));
  v_description text;
  v_team_id uuid;
  v_team_changed boolean;
  v_set public.assessment_criteria_sets;
  v_problem text;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection round';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id for update;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if (p_phase is null) <> (p_round_number is null) then
    raise exception 'Choose a phase and a round';
  end if;
  if p_phase is not null and (p_phase not between 1 and 9 or p_round_number not between 1 and 20) then
    raise exception 'Choose a phase from 1 to 9 and a round from 1 to 20';
  end if;
  v_phase := coalesce(p_phase, v_round.phase);
  v_number := coalesce(p_round_number, v_round.round_number);
  if v_name = '' and v_phase is not null then
    v_name := public.selection_round_label(v_phase, v_number);
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Name the round, in up to 80 characters';
  end if;
  v_description := case when p_description is null then v_round.description
    else nullif(trim(p_description), '') end;
  if length(coalesce(v_description, '')) > 500 then
    raise exception 'Keep the description to 500 characters';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose when the round starts and ends';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'The round ends before it starts';
  end if;
  if p_ends_on > p_starts_on + 366 then
    raise exception 'Keep a round to a year or less';
  end if;
  if exists (
    select 1 from public.assessment_observations o
    where o.round_id = p_round_id and o.observed_on < p_starts_on
  ) then
    raise exception 'Observations were made before that start date. Choose an earlier one.';
  end if;
  if exists (
    select 1 from public.assessment_observations o
    where o.round_id = p_round_id and o.observed_on > p_ends_on
  ) then
    raise exception 'Observations were made after that end date. Choose a later one.';
  end if;

  v_team_id := coalesce(p_team_id, v_round.team_id);
  v_team_changed := v_team_id is distinct from v_round.team_id;
  if v_team_changed then
    v_old_team := coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name);
    if v_round.closed_at is not null then
      raise exception 'This round is closed. Open it again to change its squad or team.';
    end if;
    if public.selection_round_has_assessments(p_round_id) then
      raise exception 'Assessing has started, so this round stays with %', v_old_team;
    end if;
    select * into v_team from public.teams t where t.id = v_team_id and not t.archived;
    if v_team.id is null then
      raise exception 'Choose a squad or team from this season';
    end if;
    if v_team.season is distinct from v_round.season then
      raise exception 'Choose a squad or team from the round’s season';
    end if;
  end if;

  if v_team_id is not null then
    v_problem := public.selection_round_order_problem(v_team_id, v_round.season, v_phase, v_number,
      p_starts_on, p_round_id);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
  end if;

  -- A round moving to a squad its criteria set isn't for takes that squad's set.
  if v_team_changed and not coalesce(public.criteria_set_fits(v_round.criteria_set_id, v_team_id), false) then
    select * into v_set from public.assessment_criteria_sets s
    where s.id = public.criteria_set_default(v_team_id);
    if v_set.id is null then
      raise exception 'No criteria set is for %. Change who a set is for first.', v_team.name;
    end if;
  end if;

  -- The overlap trigger checks the new squad or team and dates.
  update public.selection_rounds r
  set name = v_name, description = v_description, starts_on = p_starts_on, ends_on = p_ends_on,
    phase = v_phase, round_number = v_number,
    team_id = v_team_id,
    team_name = case when v_team_changed then v_team.name else r.team_name end,
    criteria = case when v_set.id is not null then v_set.criteria else r.criteria end,
    criteria_set_id = case when v_set.id is not null then v_set.id else r.criteria_set_id end,
    criteria_set_name = case when v_set.id is not null then v_set.name else r.criteria_set_name end,
    criteria_set_version = case when v_set.id is not null then v_set.version else r.criteria_set_version end
  where r.id = p_round_id;

  if v_name is distinct from v_round.name then
    insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
    values (p_round_id, 'renamed', format('From “%s” to “%s”', v_round.name, v_name), auth.uid(), v_me);
  end if;
  if v_description is distinct from v_round.description then
    insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
    values (p_round_id, 'description',
      case when v_description is null then 'Description taken off'
        when v_round.description is null then 'Description added'
        else 'Description changed' end, auth.uid(), v_me);
  end if;
  if p_starts_on <> v_round.starts_on or p_ends_on <> v_round.ends_on then
    insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
    values (p_round_id, 'dates', format('From %s to %s, now %s to %s',
      to_char(v_round.starts_on, 'FMDD Mon YYYY'), to_char(v_round.ends_on, 'FMDD Mon YYYY'),
      to_char(p_starts_on, 'FMDD Mon YYYY'), to_char(p_ends_on, 'FMDD Mon YYYY')), auth.uid(), v_me);
  end if;
  if v_phase is distinct from v_round.phase or v_number is distinct from v_round.round_number then
    insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
    values (p_round_id, 'phase', format('From %s to %s',
      coalesce(public.selection_round_label(v_round.phase, v_round.round_number), 'no phase'),
      public.selection_round_label(v_phase, v_number)), auth.uid(), v_me);
  end if;

  if v_team_changed then
    insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
    values (p_round_id, 'team', format('From %s to %s', v_old_team, v_team.name), auth.uid(), v_me);
    if v_set.id is not null then
      insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
      values (p_round_id, 'criteria', format('From “%s” to “%s, version %s”, the set for %s',
        coalesce(v_round.criteria_set_name, 'no set'), v_set.name, v_set.version, v_team.name), auth.uid(), v_me);
    end if;
    -- The old group's coaches leave the panel (kept as removed), and the new
    -- group's coaches with a current check join it, as when a round opens.
    -- Someone auditing this round is never put on its panel.
    update public.selection_round_panel p
    set removed_at = now(), removed_by = auth.uid(), removed_by_name = v_me
    where p.round_id = p_round_id and p.removed_at is null
      and exists (select 1 from public.team_members m
        where m.team_id = v_round.team_id and m.profile_id = p.profile_id and m.team_role = 'coach')
      and not exists (select 1 from public.team_members m
        where m.team_id = v_team_id and m.profile_id = p.profile_id and m.team_role = 'coach');
    insert into public.selection_round_panel (round_id, profile_id, profile_name, added_by, added_by_name)
    select p_round_id, m.profile_id, coalesce(public.member_display_name(m.profile_id), 'Member'), auth.uid(), v_me
    from public.team_members m
    where m.team_id = v_team_id and m.team_role = 'coach'
      and public.can_join_selection_panel(m.profile_id)
      and not exists (select 1 from public.selection_round_panel p
        where p.round_id = p_round_id and p.profile_id = m.profile_id and p.removed_at is null)
      and not exists (select 1 from public.selection_round_auditors a
        where a.round_id = p_round_id and a.profile_id = m.profile_id and a.removed_at is null);
  end if;
end;
$$;
revoke execute on function public.admin_save_selection_round(uuid, text, date, date, integer, integer, text, uuid) from public, anon;
grant execute on function public.admin_save_selection_round(uuid, text, date, date, integer, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Deleting a round
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_selection_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can delete a selection round';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id for update;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if public.selection_round_running(v_round) then
    raise exception 'This round is running. Close it first, then delete it.';
  end if;
  if public.selection_round_has_assessments(p_round_id) then
    raise exception 'Assessments have been written in this round, so it can’t be deleted. Close it instead.';
  end if;

  insert into public.selection_round_deletions (round_id, season, team_id, team_name, name, description,
    phase, round_number, starts_on, ends_on, closed_at, opened_at, opened_by_name,
    criteria_set_name, criteria_set_version, history, deleted_by, deleted_by_name)
  values (v_round.id, v_round.season, v_round.team_id,
    coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
    v_round.name, v_round.description, v_round.phase, v_round.round_number, v_round.starts_on,
    v_round.ends_on, v_round.closed_at, v_round.created_at, v_round.created_by_name,
    v_round.criteria_set_name, v_round.criteria_set_version,
    coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at)
        order by e.at)
      from public.selection_round_events e where e.round_id = v_round.id
    ), '[]'::jsonb),
    auth.uid(), public.member_display_name(auth.uid()));

  -- Its panel, auditors, dates and change history go with it; nothing about
  -- an athlete exists to lose (checked above).
  delete from public.selection_rounds r where r.id = p_round_id;
end;
$$;
revoke execute on function public.admin_delete_selection_round(uuid) from public, anon;
grant execute on function public.admin_delete_selection_round(uuid) to authenticated;

-- The rounds deleted in a season, for the Selection register. Admins only.
create or replace function public.admin_selection_round_deletions(p_season integer default null)
returns table (
  id uuid,
  team_name text,
  name text,
  phase smallint,
  round_number smallint,
  starts_on date,
  ends_on date,
  opened_by_name text,
  deleted_by_name text,
  deleted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the selection register';
  end if;
  return query
  select d.id, d.team_name, d.name, d.phase, d.round_number, d.starts_on, d.ends_on, d.opened_by_name,
    d.deleted_by_name, d.deleted_at
  from public.selection_round_deletions d
  where p_season is null or d.season = p_season
  order by d.deleted_at desc;
end;
$$;
revoke execute on function public.admin_selection_round_deletions(integer) from public, anon;
grant execute on function public.admin_selection_round_deletions(integer) to authenticated;

-- Admin rounds list, now with the description and what can still change.
drop function if exists public.admin_selection_rounds();
create or replace function public.admin_selection_rounds()
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  season integer,
  name text,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  created_at timestamptz,
  athletes integer,
  observations integer,
  panel jsonb,
  criteria_set_id uuid,
  criteria_set_name text,
  criteria_set_version integer,
  can_change_criteria boolean,
  phase smallint,
  round_number smallint,
  auditors integer,
  description text,
  -- Not running and nothing written about an athlete in it.
  can_delete boolean,
  -- Open, with nothing written about an athlete in it.
  can_change_team boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the selection rounds';
  end if;
  return query
  select r.id, r.team_id, coalesce(t.name, r.team_name), r.season, r.name, r.starts_on, r.ends_on,
    r.closed_at, r.created_at,
    (select count(*)::int from public.team_members m
      where m.team_id = r.team_id and m.team_role = 'athlete'),
    (select count(*)::int from public.assessment_observations o where o.round_id = r.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', m.profile_id,
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at,
        'added_by_name', m.added_by_name,
        'removed_at', m.removed_at,
        'removed_by_name', m.removed_by_name,
        'declared_conflict', exists (
          select 1 from public.conflict_declarations d
          where d.profile_id = m.profile_id and d.season = r.season and d.has_conflict
        ),
        'can_assess', m.profile_id is not null and public.can_join_selection_panel(m.profile_id),
        'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id),
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = r.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by (m.removed_at is not null), m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = r.id
    ), '[]'::jsonb),
    r.criteria_set_id,
    coalesce(r.criteria_set_name, (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
    r.criteria_set_version,
    r.closed_at is null
      and not exists (select 1 from public.assessment_observations o where o.round_id = r.id)
      and not exists (select 1 from public.assessment_summaries su where su.round_id = r.id),
    r.phase, r.round_number,
    (select count(*)::int from public.selection_round_auditors a where a.round_id = r.id and a.removed_at is null),
    r.description,
    not public.selection_round_running(r) and not public.selection_round_has_assessments(r.id),
    r.closed_at is null and not public.selection_round_has_assessments(r.id)
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  order by (r.closed_at is not null), r.starts_on desc, r.created_at desc;
end;
$$;
revoke execute on function public.admin_selection_rounds() from public, anon;
grant execute on function public.admin_selection_rounds() to authenticated;

-- The panel's round sheet, now with the round's description.
create or replace function public.selection_round_sheet(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
begin
  if not public.on_selection_panel(p_round_id) then
    raise exception 'You aren’t on this round’s panel';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;

  return jsonb_build_object(
    'id', v_round.id,
    'name', v_round.name,
    'description', v_round.description,
    'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
    'starts_on', v_round.starts_on,
    'ends_on', v_round.ends_on,
    'closed', v_round.closed_at is not null,
    'criteria', v_round.criteria,
    'phase', v_round.phase,
    'round_number', v_round.round_number,
    'criteria_set_name', coalesce(v_round.criteria_set_name,
      (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
    'today', public.club_today(),
    -- Athletes hidden from this member because they are their own child.
    'hidden', (
      select count(*)::int from public.team_members m
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
        and not public.can_assess_athlete(p_round_id, m.profile_id)
    ),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', public.display_name(p),
        'is_minor', public.is_minor(p.date_of_birth, p.under_17),
        'observations', (
          select count(*)::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'my_observations', (
          select count(*)::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id and o.author_id = auth.uid()
        ),
        'assessors', (
          select count(distinct coalesce(o.author_id::text, o.author_name))::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'groups_covered', (
          select count(distinct i.group_key)::int
          from public.assessment_observations o
          join public.assessment_observation_ratings ra on ra.observation_id = o.id
          join public.selection_round_items(p_round_id) i on i.item_key = ra.item_key
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'last_observed_on', (
          select max(o.observed_on) from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        )
      ) order by public.display_name(p))
      from public.team_members m
      join public.profiles p on p.id = m.profile_id
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
        and public.can_assess_athlete(p_round_id, m.profile_id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.selection_round_sheet(uuid) from public, anon;
grant execute on function public.selection_round_sheet(uuid) to authenticated;

commit;
