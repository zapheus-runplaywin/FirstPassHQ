-- Selection assessments, release 2, part 2: phase and round number on a
-- round, rounds set up ahead of time, no two rounds for the same athletes on
-- the same days, observations dated inside their round, every change to a
-- round kept. Adds two nullable columns; no row is changed or removed.
begin;

alter table public.selection_rounds
  add column if not exists phase smallint check (phase between 1 and 9),
  add column if not exists round_number smallint check (round_number between 1 and 20);

-- The last day a round counts as running: its end date, or the day it was
-- closed when that was earlier.
create or replace function public.selection_round_last_day(p_ends_on date, p_closed_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select case when p_closed_at is null then p_ends_on else least(p_ends_on, public.club_day(p_closed_at)) end;
$$;
revoke execute on function public.selection_round_last_day(date, timestamptz) from public, anon, authenticated;

-- The rounds that would run on the same days for the same athletes.
create or replace function public.selection_round_clashes(
  p_team_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_ignore_round_id uuid default null
)
returns table (round_id uuid, round_name text, team_name text, starts_on date, last_day date, criteria_set_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, coalesce(t.name, r.team_name), r.starts_on,
    public.selection_round_last_day(r.ends_on, r.closed_at), r.criteria_set_name
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  where r.id is distinct from p_ignore_round_id
    and r.team_id is not null
    and (
      r.team_id = p_team_id
      or t.squad_id = p_team_id
      or r.team_id = (select g.squad_id from public.teams g where g.id = p_team_id)
    )
    and r.starts_on <= p_ends_on
    and public.selection_round_last_day(r.ends_on, r.closed_at) >= p_starts_on
    -- A round closed before it started never ran, so it clashes with nothing.
    and public.selection_round_last_day(r.ends_on, r.closed_at) >= r.starts_on
  order by r.starts_on, r.name;
$$;
revoke execute on function public.selection_round_clashes(uuid, date, date, uuid) from public, anon, authenticated;

create or replace function public.check_selection_round_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clash record;
begin
  if new.team_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.team_id is not distinct from old.team_id
     and new.starts_on = old.starts_on
     and new.ends_on = old.ends_on
     and new.closed_at is not distinct from old.closed_at then
    return new;
  end if;
  -- One at a time, so two admins can't each save a round that overlaps the other's.
  perform pg_advisory_xact_lock(hashtext('selection_rounds_overlap'));
  select * into v_clash
  from public.selection_round_clashes(
    new.team_id, new.starts_on, public.selection_round_last_day(new.ends_on, new.closed_at), new.id)
  limit 1;
  if found and public.selection_round_last_day(new.ends_on, new.closed_at) >= new.starts_on then
    raise exception 'These dates overlap “%” for % (% to %). The same athletes can’t be in two rounds at once.',
      v_clash.round_name, v_clash.team_name,
      to_char(v_clash.starts_on, 'FMDD Mon YYYY'), to_char(v_clash.last_day, 'FMDD Mon YYYY');
  end if;
  return new;
end;
$$;
revoke execute on function public.check_selection_round_overlap() from public, anon, authenticated;

drop trigger if exists selection_rounds_no_overlap on public.selection_rounds;
create trigger selection_rounds_no_overlap
  before insert or update of team_id, starts_on, ends_on, closed_at on public.selection_rounds
  for each row execute function public.check_selection_round_overlap();

drop index if exists public.selection_rounds_one_open;

-- One "Phase 1, Round 2" per squad or team a season.
create unique index if not exists selection_rounds_phase_round_key
  on public.selection_rounds (team_id, season, phase, round_number)
  where team_id is not null and phase is not null and round_number is not null;

-- "Phase 1, Round 2", or null for a round opened before phases.
create or replace function public.selection_round_label(p_phase integer, p_round_number integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phase is null or p_round_number is null then null
    else 'Phase ' || p_phase || ', Round ' || p_round_number end;
$$;
revoke execute on function public.selection_round_label(integer, integer) from public, anon, authenticated;

-- Why this phase and round number can't be used for these dates, or null
-- when they can: the number is taken, or it would start before an earlier
-- number or after a later one in the same squad or team and season.
create or replace function public.selection_round_order_problem(
  p_team_id uuid,
  p_season integer,
  p_phase integer,
  p_round_number integer,
  p_starts_on date,
  p_ignore_round_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_other public.selection_rounds;
begin
  if p_phase is null or p_round_number is null then
    return null;
  end if;
  select * into v_other from public.selection_rounds r
  where r.team_id = p_team_id and r.season = p_season and r.id is distinct from p_ignore_round_id
    and r.phase = p_phase and r.round_number = p_round_number;
  if found then
    return format('%s already has %s this season (“%s”)', v_other.team_name,
      public.selection_round_label(p_phase, p_round_number), v_other.name);
  end if;
  select * into v_other from public.selection_rounds r
  where r.team_id = p_team_id and r.season = p_season and r.id is distinct from p_ignore_round_id
    and r.phase is not null and (r.phase, r.round_number) < (p_phase, p_round_number)
    and r.starts_on > p_starts_on
  order by r.starts_on desc limit 1;
  if found then
    return format('%s can’t start before %s, which starts on %s',
      public.selection_round_label(p_phase, p_round_number),
      public.selection_round_label(v_other.phase, v_other.round_number), to_char(v_other.starts_on, 'FMDD Mon YYYY'));
  end if;
  select * into v_other from public.selection_rounds r
  where r.team_id = p_team_id and r.season = p_season and r.id is distinct from p_ignore_round_id
    and r.phase is not null and (r.phase, r.round_number) > (p_phase, p_round_number)
    and r.starts_on < p_starts_on
  order by r.starts_on limit 1;
  if found then
    return format('%s can’t start after %s, which starts on %s',
      public.selection_round_label(p_phase, p_round_number),
      public.selection_round_label(v_other.phase, v_other.round_number), to_char(v_other.starts_on, 'FMDD Mon YYYY'));
  end if;
  return null;
end;
$$;
revoke execute on function public.selection_round_order_problem(uuid, integer, integer, integer, date, uuid) from public, anon, authenticated;

-- For the admin's screen as dates are picked: what these dates would clash
-- with, and the first day after the clashing rounds.
create or replace function public.admin_selection_round_clashes(
  p_team_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_round_id uuid default null
)
returns table (round_name text, team_name text, starts_on date, last_day date, criteria_set_name text, free_from date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can set up a selection round';
  end if;
  return query
  select c.round_name, c.team_name, c.starts_on, c.last_day, c.criteria_set_name,
    (max(c.last_day) over () + 1)::date
  from public.selection_round_clashes(p_team_id, p_starts_on, p_ends_on, p_round_id) c;
end;
$$;
revoke execute on function public.admin_selection_round_clashes(uuid, date, date, uuid) from public, anon;
grant execute on function public.admin_selection_round_clashes(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening a round: phase and round number, no "one open round" rule
-- ---------------------------------------------------------------------------
drop function if exists public.admin_open_selection_round(uuid, text, date, date, uuid);
create or replace function public.admin_open_selection_round(
  p_team_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_set_id uuid default null,
  p_phase integer default null,
  p_round_number integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_set public.assessment_criteria_sets;
  v_set_id uuid;
  v_id uuid;
  v_me text := public.member_display_name(auth.uid());
  v_label text;
  v_name text := trim(coalesce(p_name, ''));
  v_problem text;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can open a selection round';
  end if;
  select * into v_team from public.teams t where t.id = p_team_id and not t.archived;
  if v_team.id is null then
    raise exception 'Choose a squad or team from this season';
  end if;
  if (p_phase is null) <> (p_round_number is null) then
    raise exception 'Choose a phase and a round';
  end if;
  if p_phase is not null and (p_phase not between 1 and 9 or p_round_number not between 1 and 20) then
    raise exception 'Choose a phase from 1 to 9 and a round from 1 to 20';
  end if;
  v_label := public.selection_round_label(p_phase, p_round_number);
  if v_name = '' and v_label is not null then
    v_name := v_label;
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Name the round, in up to 80 characters';
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
  v_problem := public.selection_round_order_problem(p_team_id, v_team.season, p_phase, p_round_number, p_starts_on);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if not exists (
    select 1 from public.assessment_criteria_sets s
    where s.archived_at is null and jsonb_array_length(coalesce(s.criteria -> 'groups', '[]'::jsonb)) > 0
  ) then
    raise exception 'Add a criteria set first';
  end if;
  v_set_id := coalesce(p_set_id, public.criteria_set_default(p_team_id));
  if v_set_id is null then
    raise exception 'Choose the criteria for this round';
  end if;
  if not public.criteria_set_fits(v_set_id, p_team_id) then
    raise exception 'That criteria set isn’t for %', v_team.name;
  end if;
  select * into v_set from public.assessment_criteria_sets s where s.id = v_set_id;

  insert into public.selection_rounds (team_id, team_name, season, name, starts_on, ends_on, criteria,
    criteria_set_id, criteria_set_name, criteria_set_version, created_by, created_by_name, phase, round_number)
  values (p_team_id, v_team.name, v_team.season, v_name, p_starts_on, p_ends_on, v_set.criteria,
    v_set.id, v_set.name, v_set.version, auth.uid(), v_me, p_phase, p_round_number)
  returning id into v_id;

  insert into public.selection_round_panel (round_id, profile_id, profile_name, added_by, added_by_name)
  select v_id, m.profile_id, coalesce(public.member_display_name(m.profile_id), 'Member'), auth.uid(), v_me
  from public.team_members m
  where m.team_id = p_team_id and m.team_role = 'coach'
    and public.can_join_selection_panel(m.profile_id);

  insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
  values (v_id, 'opened',
    concat_ws(' · ', v_label, format('%s, version %s', v_set.name, v_set.version)), auth.uid(), v_me);

  return v_id;
end;
$$;
revoke execute on function public.admin_open_selection_round(uuid, text, date, date, uuid, integer, integer) from public, anon;
grant execute on function public.admin_open_selection_round(uuid, text, date, date, uuid, integer, integer) to authenticated;

-- Admins change a round's name, dates, phase and round number. Each change is kept.
drop function if exists public.admin_save_selection_round(uuid, text, date, date);
create or replace function public.admin_save_selection_round(
  p_round_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_phase integer default null,
  p_round_number integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_phase integer;
  v_number integer;
  v_name text := trim(coalesce(p_name, ''));
  v_problem text;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection round';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
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
  if v_round.team_id is not null then
    v_problem := public.selection_round_order_problem(v_round.team_id, v_round.season, v_phase, v_number,
      p_starts_on, p_round_id);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
  end if;

  update public.selection_rounds r
  set name = v_name, starts_on = p_starts_on, ends_on = p_ends_on, phase = v_phase, round_number = v_number
  where r.id = p_round_id;

  if v_name is distinct from v_round.name then
    insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
    values (p_round_id, 'renamed', format('From “%s” to “%s”', v_round.name, v_name), auth.uid(), v_me);
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
end;
$$;
revoke execute on function public.admin_save_selection_round(uuid, text, date, date, integer, integer) from public, anon;
grant execute on function public.admin_save_selection_round(uuid, text, date, date, integer, integer) to authenticated;

-- Admins close a round or open it again. The overlap trigger refuses a
-- reopening that would clash with a later round.
create or replace function public.admin_close_selection_round(p_round_id uuid, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can close a selection round';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if coalesce(p_closed, true) then
    if v_round.closed_at is null then
      update public.selection_rounds r set closed_at = now(), closed_by = auth.uid() where r.id = p_round_id;
      insert into public.selection_round_events (round_id, kind, by_id, by_name)
      values (p_round_id, 'closed', auth.uid(), v_me);
    end if;
  elsif v_round.closed_at is not null then
    update public.selection_rounds r set closed_at = null, closed_by = null where r.id = p_round_id;
    insert into public.selection_round_events (round_id, kind, by_id, by_name)
    values (p_round_id, 'reopened', auth.uid(), v_me);
  end if;
end;
$$;
revoke execute on function public.admin_close_selection_round(uuid, boolean) from public, anon;
grant execute on function public.admin_close_selection_round(uuid, boolean) to authenticated;

-- Observations are dated inside their round.
create or replace function public.save_assessment_observation(
  p_id uuid,
  p_round_id uuid,
  p_athlete_id uuid,
  p_context text,
  p_observed_on date,
  p_note text,
  p_ratings jsonb,
  p_corrects_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_old public.assessment_observations;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
  r jsonb;
  v_keys text[] := '{}';
  v_rated boolean := false;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t assess this athlete';
  end if;
  select * into v_round from public.selection_rounds x where x.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  if p_context is null or p_context not in ('training', 'game', 'trial', 'other') then
    raise exception 'Choose where you saw it';
  end if;
  if p_observed_on is null then
    raise exception 'Choose the day you saw it';
  end if;
  if p_observed_on > public.club_today() then
    raise exception 'The day can’t be in the future';
  end if;
  if p_observed_on < v_round.starts_on then
    raise exception 'The round started on %', to_char(v_round.starts_on, 'FMDD Mon YYYY');
  end if;
  if p_observed_on > v_round.ends_on then
    raise exception 'The round ended on %. Choose a day in the round.', to_char(v_round.ends_on, 'FMDD Mon YYYY');
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the evidence to 1,000 characters';
  end if;

  if p_ratings is null or jsonb_typeof(p_ratings) <> 'array' or jsonb_array_length(p_ratings) = 0 then
    raise exception 'Choose at least one of the criteria';
  end if;
  for r in select * from jsonb_array_elements(p_ratings) loop
    if not exists (
      select 1 from public.selection_round_items(p_round_id) i where i.item_key = r ->> 'item_key'
    ) then
      raise exception 'That isn’t one of this round’s criteria';
    end if;
    if (r ->> 'item_key') = any (v_keys) then
      raise exception 'A criterion is listed twice';
    end if;
    v_keys := v_keys || (r ->> 'item_key');
    if jsonb_typeof(r -> 'rating') = 'number' then
      if (r ->> 'rating') not in ('1', '2', '3') then
        raise exception 'A rating is one of the three steps on the scale';
      end if;
      v_rated := true;
    elsif r -> 'rating' is not null and jsonb_typeof(r -> 'rating') <> 'null' then
      raise exception 'A rating is one of the three steps on the scale';
    end if;
  end loop;
  if v_note is null and not v_rated then
    raise exception 'Write what you saw, or rate at least one of the criteria';
  end if;

  if p_corrects_id is not null and not exists (
    select 1 from public.assessment_observations o
    where o.id = p_corrects_id and o.round_id = p_round_id and o.athlete_id = p_athlete_id
      and o.id is distinct from p_id
  ) then
    raise exception 'The observation this corrects isn’t in this athlete’s assessment';
  end if;

  if p_id is null then
    insert into public.assessment_observations (round_id, athlete_id, author_id, author_name, context,
      observed_on, note, corrects_id)
    values (p_round_id, p_athlete_id, auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Member'),
      p_context, p_observed_on, v_note, p_corrects_id)
    returning id into v_id;
  else
    select * into v_old from public.assessment_observations o
    where o.id = p_id and o.round_id = p_round_id and o.athlete_id = p_athlete_id;
    if v_old.id is null or v_old.author_id is distinct from auth.uid() then
      raise exception 'You can only change your own observations';
    end if;
    if not public.observation_is_open(v_old.created_at) then
      raise exception 'This observation can’t be changed any more. Add a correction instead.';
    end if;
    update public.assessment_observations o
    set context = p_context, observed_on = p_observed_on, note = v_note, corrects_id = p_corrects_id,
      updated_at = now()
    where o.id = p_id;
    delete from public.assessment_observation_ratings ra where ra.observation_id = p_id;
    v_id := p_id;
  end if;

  insert into public.assessment_observation_ratings (observation_id, item_key, rating)
  select v_id, x ->> 'item_key',
    case when jsonb_typeof(x -> 'rating') = 'number' then (x ->> 'rating')::smallint end
  from jsonb_array_elements(p_ratings) x;

  return v_id;
end;
$$;
revoke execute on function public.save_assessment_observation(uuid, uuid, uuid, text, date, text, jsonb, uuid) from public, anon;
grant execute on function public.save_assessment_observation(uuid, uuid, uuid, text, date, text, jsonb, uuid) to authenticated;

-- Admin rounds list, now with phase and round number.
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
  round_number smallint
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
    r.phase, r.round_number
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  order by (r.closed_at is not null), r.starts_on desc, r.created_at desc;
end;
$$;
revoke execute on function public.admin_selection_rounds() from public, anon;
grant execute on function public.admin_selection_rounds() to authenticated;

-- The rounds whose panel the signed-in member is on, with phase, round
-- number and the criteria set's name. Never the set's id.
drop function if exists public.my_selection_rounds();
create or replace function public.my_selection_rounds()
returns table (
  id uuid,
  name text,
  team_name text,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  athletes integer,
  my_observations integer,
  phase smallint,
  round_number smallint,
  criteria_set_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, coalesce(t.name, r.team_name), r.starts_on, r.ends_on, r.closed_at,
    (select count(*)::int from public.team_members m
      where m.team_id = r.team_id and m.team_role = 'athlete'
        and public.can_assess_athlete(r.id, m.profile_id)),
    (select count(*)::int from public.assessment_observations o
      where o.round_id = r.id and o.author_id = auth.uid()),
    r.phase, r.round_number,
    coalesce(r.criteria_set_name, (select s.name from public.assessment_criteria_sets s where s.legacy limit 1))
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  where public.on_selection_panel(r.id)
  order by (r.closed_at is not null), r.starts_on, r.name;
$$;
revoke execute on function public.my_selection_rounds() from public, anon;
grant execute on function public.my_selection_rounds() to authenticated;

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

-- Athletes and verified parents: open rounds, now with phase, round number
-- and the criteria set's name. Nothing else about sets.
drop function if exists public.my_selection_info();
create or replace function public.my_selection_info()
returns table (
  round_id uuid,
  round_name text,
  team_name text,
  athlete_id uuid,
  athlete_name text,
  is_me boolean,
  starts_on date,
  ends_on date,
  criteria jsonb,
  dates jsonb,
  phase smallint,
  round_number smallint,
  criteria_set_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, coalesce(t.name, r.team_name), a.profile_id,
    public.member_display_name(a.profile_id), a.profile_id = auth.uid(),
    r.starts_on, r.ends_on, r.criteria,
    coalesce((
      select jsonb_agg(jsonb_build_object('title', m.title, 'due_on', m.due_on, 'done', m.done_at is not null)
        order by m.due_on, m.created_at)
      from public.selection_round_milestones m
      where m.round_id = r.id and m.removed_at is null and m.shared
    ), '[]'::jsonb),
    r.phase, r.round_number,
    coalesce(r.criteria_set_name, (select s.name from public.assessment_criteria_sets s where s.legacy limit 1))
  from public.selection_rounds r
  join public.team_members a on a.team_id = r.team_id and a.team_role = 'athlete'
  left join public.teams t on t.id = r.team_id
  where r.closed_at is null
    and public.is_approved()
    and public.selection_assessments_on()
    and (a.profile_id = auth.uid() or public.is_verified_guardian_of(a.profile_id))
  order by (a.profile_id <> auth.uid()), 5, r.starts_on;
$$;
revoke execute on function public.my_selection_info() from public, anon;
grant execute on function public.my_selection_info() to authenticated;

-- An athlete's assessment for the panel, now with the round's end date so
-- the date field stops at it.
create or replace function public.athlete_assessment(p_round_id uuid, p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;

  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_name', v_round.name,
    'closed', v_round.closed_at is not null,
    'starts_on', v_round.starts_on,
    'ends_on', v_round.ends_on,
    'criteria', v_round.criteria,
    'today', public.club_today(),
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'author_name', coalesce(public.member_display_name(o.author_id), o.author_name),
        'mine', o.author_id = auth.uid(),
        'can_change', o.author_id = auth.uid() and v_round.closed_at is null
          and public.observation_is_open(o.created_at),
        'context', o.context,
        'observed_on', o.observed_on,
        'note', o.note,
        'corrects_id', o.corrects_id,
        'created_at', o.created_at,
        'ratings', coalesce((
          select jsonb_agg(jsonb_build_object('item_key', ra.item_key, 'rating', ra.rating) order by ra.item_key)
          from public.assessment_observation_ratings ra where ra.observation_id = o.id
        ), '[]'::jsonb)
      ) order by o.observed_on desc, o.created_at desc)
      from public.assessment_observations o
      where o.round_id = p_round_id and o.athlete_id = p_athlete_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.athlete_assessment(uuid, uuid) from public, anon;
grant execute on function public.athlete_assessment(uuid, uuid) to authenticated;

commit;
