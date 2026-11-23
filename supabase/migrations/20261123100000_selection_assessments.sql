-- Selection assessments, phase 1: criteria, rounds, observations and the
-- admins' audit report (Matt, 23 November 2026: "allow coaches to add to the
-- overall assessment bit by bit, building a picture over time").
--
-- The club's paper assessment sheet becomes a running record. An admin sets
-- up the club's own criteria (groups of items, each group with three scale
-- labels) and opens a selection round for a squad or team. The round takes
-- its own copy of the criteria, so the criteria athletes were assessed
-- against never change under it. Its panel starts as the group's coaches; an
-- admin can add other coaches, admins or guests who hold a current check.
-- Panel members add short observations about the round's athletes: where it
-- was seen, the criteria it is about, a step on the scale if they want to
-- rate it, and a line of evidence.
--
-- Who sees what (Matt, 23 November 2026):
--   - panel members read every observation about the round's athletes and
--     write their own, never for an athlete they are a parent or guardian of;
--   - admins don't read assessments. They build an audit report that shows
--     how the work was done (who wrote how much, about whom, when), never
--     what was said: no ratings, evidence or names of criteria rated;
--   - the committee, managers, physios, other coaches, athletes and parents
--     see nothing in this phase;
--   - a stood-down panel member, or one whose check lapses, loses access
--     with the rest of their coaching access;
--   - every time a panel member opens an under 18's assessment, and every
--     time an admin builds the audit report for a round with under 18s, it
--     goes in the child's record views.
--
-- There is no score, total or ranking anywhere, and nothing here reads
-- wellbeing check-ins, training load or injuries.
--
-- The app shows it only when an admin turns on "Selection assessments" in
-- Club features (off by default; it can be on for pilot teams only).
--
-- An observation can be changed or removed by its author until the end of
-- the next club day. After that it stands, and a correction is a new
-- observation that points at the one it corrects.
--
-- Additive: five new tables and new functions, and two more kinds of record
-- view. No existing rows change.

begin;

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

-- Whether selection assessments are on for the signed-in member: off by
-- default, and off outside the pilot teams while it is pilot-only.
create or replace function public.selection_assessments_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.member_features() ->> 'selectionAssessments')::boolean, false);
$$;
revoke execute on function public.selection_assessments_on() from public, anon;
grant execute on function public.selection_assessments_on() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The club's criteria: one row, as
--   {"groups": [{"key": "technical", "name": "Technical ability",
--                "scale": ["Below standard", "Meets standard", "Exceeds standard"],
--                "items": [{"key": "passing", "name": "Passing and delivery"}]}]}
create table if not exists public.assessment_criteria (
  id boolean primary key default true check (id),
  criteria jsonb not null default '{"groups": []}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- A selection round for a squad or team, with its own copy of the criteria.
-- The group's name is kept so the record still reads if the group is removed.
create table if not exists public.selection_rounds (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete set null,
  team_name text not null,
  season integer not null,
  name text not null check (length(trim(name)) between 1 and 80),
  starts_on date not null,
  ends_on date not null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- One open round for a group at a time.
create unique index if not exists selection_rounds_one_open
  on public.selection_rounds (team_id) where closed_at is null;

-- Who is, or was, on a round's panel. A row is never removed: taking someone
-- off the panel fills in removed_at, so the audit report shows every change.
create table if not exists public.selection_round_panel (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  profile_name text not null,
  added_by uuid references public.profiles (id) on delete set null,
  added_by_name text,
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete set null,
  removed_by_name text,
  removed_at timestamptz
);

create unique index if not exists selection_round_panel_one_active
  on public.selection_round_panel (round_id, profile_id) where removed_at is null;
create index if not exists selection_round_panel_profile_idx
  on public.selection_round_panel (profile_id) where removed_at is null;

-- One thing a panel member saw. It goes when the athlete's account does; the
-- author's name stays if the author leaves.
create table if not exists public.assessment_observations (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  context text not null check (context in ('training', 'game', 'trial', 'other')),
  observed_on date not null,
  note text check (length(note) <= 1000),
  corrects_id uuid references public.assessment_observations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessment_observations_round_athlete_idx
  on public.assessment_observations (round_id, athlete_id);
create index if not exists assessment_observations_author_idx
  on public.assessment_observations (author_id);
create index if not exists assessment_observations_athlete_idx
  on public.assessment_observations (athlete_id);

-- The criteria an observation is about, each with a step on its group's
-- scale (1 to 3) when the author rated it.
create table if not exists public.assessment_observation_ratings (
  observation_id uuid not null references public.assessment_observations (id) on delete cascade,
  item_key text not null,
  rating smallint check (rating between 1 and 3),
  primary key (observation_id, item_key)
);

-- All five are read and written only through the functions below.
alter table public.assessment_criteria enable row level security;
alter table public.selection_rounds enable row level security;
alter table public.selection_round_panel enable row level security;
alter table public.assessment_observations enable row level security;
alter table public.assessment_observation_ratings enable row level security;

revoke all on table public.assessment_criteria from public, anon, authenticated;
revoke all on table public.selection_rounds from public, anon, authenticated;
revoke all on table public.selection_round_panel from public, anon, authenticated;
revoke all on table public.assessment_observations from public, anon, authenticated;
revoke all on table public.assessment_observation_ratings from public, anon, authenticated;

grant all on table public.assessment_criteria to service_role;
grant all on table public.selection_rounds to service_role;
grant all on table public.selection_round_panel to service_role;
grant all on table public.assessment_observations to service_role;
grant all on table public.assessment_observation_ratings to service_role;

-- A child's record views gain assessments opened by a panel member and audit
-- reports built by an admin.
alter table public.record_access_log drop constraint if exists record_access_log_kind_check;
alter table public.record_access_log add constraint record_access_log_kind_check check (
  kind in (
    'injury', 'injury_document', 'injury_document_shared', 'check_ins', 'goals', 'member_record',
    'kpis', 'survey_answers', 'medical', 'assessment', 'assessment_audit'
  )
);

-- ---------------------------------------------------------------------------
-- Criteria
-- ---------------------------------------------------------------------------

-- Checks criteria sent by the app and returns them tidied: up to 20 groups,
-- each with a name, three scale labels and 1 to 12 items; keys are short
-- slugs, unique across the whole set.
create or replace function public.check_assessment_criteria(p_criteria jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_groups jsonb := '[]'::jsonb;
  v_items jsonb;
  v_keys text[] := '{}';
  v_scale jsonb;
  g jsonb;
  i jsonb;
  s jsonb;
  v_key text;
  v_name text;
begin
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'object'
     or jsonb_typeof(p_criteria -> 'groups') is distinct from 'array' then
    raise exception 'The criteria must be a list of groups';
  end if;
  if jsonb_array_length(p_criteria -> 'groups') > 20 then
    raise exception 'Keep the criteria to 20 groups';
  end if;

  for g in select * from jsonb_array_elements(p_criteria -> 'groups') loop
    v_key := g ->> 'key';
    v_name := trim(coalesce(g ->> 'name', ''));
    if v_key is null or v_key !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
      raise exception 'A group of criteria has no key';
    end if;
    if v_key = any (v_keys) then
      raise exception 'Two criteria share a key';
    end if;
    v_keys := v_keys || v_key;
    if length(v_name) not between 1 and 60 then
      raise exception 'Name each group, in up to 60 characters';
    end if;

    if jsonb_typeof(g -> 'scale') is distinct from 'array' or jsonb_array_length(g -> 'scale') <> 3 then
      raise exception 'Give “%” three steps on its scale', v_name;
    end if;
    v_scale := '[]'::jsonb;
    for s in select * from jsonb_array_elements(g -> 'scale') loop
      if jsonb_typeof(s) <> 'string' or length(trim(s #>> '{}')) not between 1 and 30 then
        raise exception 'Name each step on the scale for “%”, in up to 30 characters', v_name;
      end if;
      v_scale := v_scale || to_jsonb(trim(s #>> '{}'));
    end loop;

    if jsonb_typeof(g -> 'items') is distinct from 'array'
       or jsonb_array_length(g -> 'items') not between 1 and 12 then
      raise exception 'Give “%” between 1 and 12 items', v_name;
    end if;
    v_items := '[]'::jsonb;
    for i in select * from jsonb_array_elements(g -> 'items') loop
      if (i ->> 'key') is null or (i ->> 'key') !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
        raise exception 'An item in “%” has no key', v_name;
      end if;
      if (i ->> 'key') = any (v_keys) then
        raise exception 'Two criteria share a key';
      end if;
      v_keys := v_keys || (i ->> 'key');
      if length(trim(coalesce(i ->> 'name', ''))) not between 1 and 60 then
        raise exception 'Name each item in “%”, in up to 60 characters', v_name;
      end if;
      v_items := v_items || jsonb_build_object('key', i ->> 'key', 'name', trim(i ->> 'name'));
    end loop;

    v_groups := v_groups || jsonb_build_object('key', v_key, 'name', v_name, 'scale', v_scale, 'items', v_items);
  end loop;

  return jsonb_build_object('groups', v_groups);
end;
$$;
revoke execute on function public.check_assessment_criteria(jsonb) from public, anon, authenticated;

-- The club's criteria, for the admins who set them up.
create or replace function public.admin_assessment_criteria()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the assessment criteria';
  end if;
  return coalesce(
    (select c.criteria from public.assessment_criteria c where c.id),
    '{"groups": []}'::jsonb
  );
end;
$$;
revoke execute on function public.admin_assessment_criteria() from public, anon;
grant execute on function public.admin_assessment_criteria() to authenticated;

-- Admins save the club's criteria. Rounds already opened keep their own copy.
create or replace function public.admin_save_assessment_criteria(p_criteria jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_criteria jsonb;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change the assessment criteria';
  end if;
  v_criteria := public.check_assessment_criteria(p_criteria);
  insert into public.assessment_criteria (id, criteria, updated_by, updated_at)
  values (true, v_criteria, auth.uid(), now())
  on conflict (id) do update
    set criteria = excluded.criteria, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke execute on function public.admin_save_assessment_criteria(jsonb) from public, anon;
grant execute on function public.admin_save_assessment_criteria(jsonb) to authenticated;

-- A round's criteria as rows, for the checks and counts below.
create or replace function public.selection_round_items(p_round_id uuid)
returns table (group_key text, group_name text, item_key text, item_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.value ->> 'key', g.value ->> 'name', i.value ->> 'key', i.value ->> 'name'
  from public.selection_rounds r
  cross join lateral jsonb_array_elements(r.criteria -> 'groups') g
  cross join lateral jsonb_array_elements(g.value -> 'items') i
  where r.id = p_round_id;
$$;
revoke execute on function public.selection_round_items(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- Whether someone could sit on a panel: an approved adult who isn't stood
-- down, is a coach, an admin or a guest, and holds a current check (or a
-- volunteer exemption or open application, as for coaching).
create or replace function public.can_join_selection_panel(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.status = 'approved'
      and p.stood_down_at is null
      and not public.is_minor(p.date_of_birth, p.under_17)
      and (
        exists (
          select 1 from unnest(array[p.role] || p.extra_roles) r where r in ('coach', 'admin', 'guest')
        )
        or exists (
          select 1 from public.team_members m where m.profile_id = p.id and m.team_role = 'coach'
        )
      )
  ) and public.is_cleared(p_profile_id);
$$;
revoke execute on function public.can_join_selection_panel(uuid) from public, anon, authenticated;

-- Whether the signed-in member is on this round's panel now. A stood-down
-- member, or one without a current check, isn't, whatever the panel says.
create or replace function public.on_selection_panel(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and public.selection_assessments_on()
    and public.can_work_with_children()
    and exists (
      select 1 from public.selection_round_panel m
      where m.round_id = p_round_id and m.profile_id = auth.uid() and m.removed_at is null
    );
$$;
revoke execute on function public.on_selection_panel(uuid) from public, anon;
grant execute on function public.on_selection_panel(uuid) to authenticated;

-- Whether this athlete is one of the round's: an athlete in its squad or team.
create or replace function public.in_selection_round(p_round_id uuid, p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.selection_rounds r
    join public.team_members m on m.team_id = r.team_id
    where r.id = p_round_id and m.profile_id = p_athlete_id and m.team_role = 'athlete'
  );
$$;
revoke execute on function public.in_selection_round(uuid, uuid) from public, anon, authenticated;

-- Whether the signed-in member can read and write this athlete's assessment
-- in this round: on the panel, the athlete is in the round, and the athlete
-- isn't them or their own child.
create or replace function public.can_assess_athlete(p_round_id uuid, p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.on_selection_panel(p_round_id)
    and public.in_selection_round(p_round_id, p_athlete_id)
    and p_athlete_id <> auth.uid()
    and not exists (
      select 1 from public.guardianships g
      where g.guardian_id = auth.uid() and g.athlete_id = p_athlete_id
    );
$$;
revoke execute on function public.can_assess_athlete(uuid, uuid) from public, anon;
grant execute on function public.can_assess_athlete(uuid, uuid) to authenticated;

-- Whether an observation can still be changed or removed: until the end of
-- the club day after it was written.
create or replace function public.observation_is_open(p_created_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.club_today() <= public.club_day(p_created_at) + 1;
$$;
revoke execute on function public.observation_is_open(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admins: rounds and panels
-- ---------------------------------------------------------------------------

-- Every round, newest first, with its panel as it stands and as it changed.
-- Counts only: an admin sees how many observations there are, never one.
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
  panel jsonb
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
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = r.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by (m.removed_at is not null), m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = r.id
    ), '[]'::jsonb)
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  order by (r.closed_at is not null), r.starts_on desc, r.created_at desc;
end;
$$;
revoke execute on function public.admin_selection_rounds() from public, anon;
grant execute on function public.admin_selection_rounds() to authenticated;

-- Admins open a round for a squad or team. It copies the club's criteria and
-- puts the group's coaches on the panel. Returns its id.
create or replace function public.admin_open_selection_round(
  p_team_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_criteria jsonb;
  v_id uuid;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can open a selection round';
  end if;
  select * into v_team from public.teams t where t.id = p_team_id and not t.archived;
  if v_team.id is null then
    raise exception 'Choose a squad or team from this season';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then
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
  select c.criteria into v_criteria from public.assessment_criteria c where c.id;
  if v_criteria is null or jsonb_array_length(v_criteria -> 'groups') = 0 then
    raise exception 'Set up the assessment criteria first';
  end if;
  if exists (
    select 1 from public.selection_rounds r where r.team_id = p_team_id and r.closed_at is null
  ) then
    raise exception '% already has an open round. Close it first.', v_team.name;
  end if;

  insert into public.selection_rounds (team_id, team_name, season, name, starts_on, ends_on, criteria,
    created_by, created_by_name)
  values (p_team_id, v_team.name, v_team.season, trim(p_name), p_starts_on, p_ends_on, v_criteria,
    auth.uid(), v_me)
  returning id into v_id;

  insert into public.selection_round_panel (round_id, profile_id, profile_name, added_by, added_by_name)
  select v_id, m.profile_id, coalesce(public.member_display_name(m.profile_id), 'Member'), auth.uid(), v_me
  from public.team_members m
  where m.team_id = p_team_id and m.team_role = 'coach'
    and public.can_join_selection_panel(m.profile_id);

  return v_id;
end;
$$;
revoke execute on function public.admin_open_selection_round(uuid, text, date, date) from public, anon;
grant execute on function public.admin_open_selection_round(uuid, text, date, date) to authenticated;

-- Admins change a round's name and dates.
create or replace function public.admin_save_selection_round(
  p_round_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection round';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then
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
  update public.selection_rounds r
  set name = trim(p_name), starts_on = p_starts_on, ends_on = p_ends_on
  where r.id = p_round_id;
  if not found then
    raise exception 'Round not found';
  end if;
end;
$$;
revoke execute on function public.admin_save_selection_round(uuid, text, date, date) from public, anon;
grant execute on function public.admin_save_selection_round(uuid, text, date, date) to authenticated;

-- Admins close a round (no more observations; the panel still reads it), or
-- open it again.
create or replace function public.admin_close_selection_round(p_round_id uuid, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can close a selection round';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if coalesce(p_closed, true) then
    update public.selection_rounds r
    set closed_at = coalesce(r.closed_at, now()), closed_by = coalesce(r.closed_by, auth.uid())
    where r.id = p_round_id;
  else
    if exists (
      select 1 from public.selection_rounds r
      where r.team_id = v_round.team_id and r.closed_at is null and r.id <> p_round_id
    ) then
      raise exception '% already has an open round. Close it first.', v_round.team_name;
    end if;
    update public.selection_rounds r set closed_at = null, closed_by = null where r.id = p_round_id;
  end if;
end;
$$;
revoke execute on function public.admin_close_selection_round(uuid, boolean) from public, anon;
grant execute on function public.admin_close_selection_round(uuid, boolean) to authenticated;

-- The people an admin could add to this round's panel: coaches, admins and
-- guests who aren't on it now, and whether each holds a current check.
create or replace function public.admin_selection_panel_choices(p_round_id uuid)
returns table (profile_id uuid, name text, roles public.app_role[], cleared boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection panel';
  end if;
  return query
  select p.id, public.display_name(p), array[p.role] || p.extra_roles, public.is_cleared(p.id)
  from public.profiles p
  where p.status = 'approved'
    and p.stood_down_at is null
    and not public.is_minor(p.date_of_birth, p.under_17)
    and (
      exists (select 1 from unnest(array[p.role] || p.extra_roles) r where r in ('coach', 'admin', 'guest'))
      or exists (select 1 from public.team_members m where m.profile_id = p.id and m.team_role = 'coach')
    )
    and not exists (
      select 1 from public.selection_round_panel m
      where m.round_id = p_round_id and m.profile_id = p.id and m.removed_at is null
    )
  order by public.display_name(p);
end;
$$;
revoke execute on function public.admin_selection_panel_choices(uuid) from public, anon;
grant execute on function public.admin_selection_panel_choices(uuid) to authenticated;

-- Admins put someone on a round's panel. This is the only way to gain access
-- to its assessments, and it is kept: who, by whom and when.
create or replace function public.admin_add_selection_panel_member(p_round_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection panel';
  end if;
  if not exists (select 1 from public.selection_rounds r where r.id = p_round_id) then
    raise exception 'Round not found';
  end if;
  if exists (
    select 1 from public.selection_round_panel m
    where m.round_id = p_round_id and m.profile_id = p_profile_id and m.removed_at is null
  ) then
    return;
  end if;
  if not public.can_join_selection_panel(p_profile_id) then
    raise exception 'A panel member must be an approved adult coach, admin or guest with a current Working With Children Check';
  end if;
  insert into public.selection_round_panel (round_id, profile_id, profile_name, added_by, added_by_name)
  values (p_round_id, p_profile_id, coalesce(public.member_display_name(p_profile_id), 'Member'),
    auth.uid(), public.member_display_name(auth.uid()));
end;
$$;
revoke execute on function public.admin_add_selection_panel_member(uuid, uuid) from public, anon;
grant execute on function public.admin_add_selection_panel_member(uuid, uuid) to authenticated;

-- Admins take someone off a round's panel. What they wrote stays.
create or replace function public.admin_remove_selection_panel_member(p_round_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection panel';
  end if;
  update public.selection_round_panel m
  set removed_at = now(), removed_by = auth.uid(), removed_by_name = public.member_display_name(auth.uid())
  where m.round_id = p_round_id and m.profile_id = p_profile_id and m.removed_at is null;
  if not found then
    raise exception 'They aren’t on this panel';
  end if;
end;
$$;
revoke execute on function public.admin_remove_selection_panel_member(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_selection_panel_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The panel: rounds, athletes and observations
-- ---------------------------------------------------------------------------

-- The rounds whose panel the signed-in member is on, open ones first.
create or replace function public.my_selection_rounds()
returns table (
  id uuid,
  name text,
  team_name text,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  athletes integer,
  my_observations integer
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
      where o.round_id = r.id and o.author_id = auth.uid())
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  where public.on_selection_panel(r.id)
  order by (r.closed_at is not null), r.ends_on desc, r.name;
$$;
revoke execute on function public.my_selection_rounds() from public, anon;
grant execute on function public.my_selection_rounds() to authenticated;

-- A round for its panel: the criteria, and each athlete the member can
-- assess with how much has been written about them. No ratings here.
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

-- One athlete's assessment in a round, for the panel: every observation with
-- its ratings, newest first. Opening an under 18's goes in their record views.
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

-- A panel member adds an observation (no id) or changes their own while it
-- is still open. p_ratings is [{"item_key": "passing", "rating": 2}], with
-- rating null for a criterion the note is about but that isn't rated.
-- Returns its id.
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

-- A panel member removes their own observation while it is still open.
create or replace function public.delete_assessment_observation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.assessment_observations;
begin
  select * into v_old from public.assessment_observations o where o.id = p_id;
  if v_old.id is null or v_old.author_id is distinct from auth.uid()
     or not public.can_assess_athlete(v_old.round_id, v_old.athlete_id) then
    raise exception 'You can only remove your own observations';
  end if;
  if exists (select 1 from public.selection_rounds r where r.id = v_old.round_id and r.closed_at is not null) then
    raise exception 'This round is closed';
  end if;
  if not public.observation_is_open(v_old.created_at) then
    raise exception 'This observation can’t be removed any more. Add a correction instead.';
  end if;
  delete from public.assessment_observations o where o.id = p_id;
end;
$$;
revoke execute on function public.delete_assessment_observation(uuid) from public, anon;
grant execute on function public.delete_assessment_observation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admins: the audit report
-- ---------------------------------------------------------------------------

-- How a round's work was done, for admins: the panel and its changes, what
-- each selector wrote (how much, about how many athletes, when, where), and
-- how much evidence there is about each athlete. Counts and dates only: no
-- ratings, no evidence text and no names of criteria. Building it for a
-- round with under 18s goes in each child's record views.
create or replace function public.admin_selection_audit(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_groups int;
  v_athletes int;
  v_child uuid;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can build the selection audit report';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  v_groups := jsonb_array_length(v_round.criteria -> 'groups');
  select count(*)::int into v_athletes
  from public.team_members m where m.team_id = v_round.team_id and m.team_role = 'athlete';

  for v_child in
    select m.profile_id from public.team_members m
    where m.team_id = v_round.team_id and m.team_role = 'athlete'
  loop
    perform public.write_record_access(v_child, 'assessment_audit', p_round_id);
  end loop;

  return jsonb_build_object(
    'round', jsonb_build_object(
      'id', v_round.id,
      'name', v_round.name,
      'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
      'season', v_round.season,
      'starts_on', v_round.starts_on,
      'ends_on', v_round.ends_on,
      'opened_at', v_round.created_at,
      'opened_by_name', v_round.created_by_name,
      'closed_at', v_round.closed_at,
      'closed_by_name', public.member_display_name(v_round.closed_by),
      'criteria_groups', v_groups,
      'criteria_items', (select count(*)::int from public.selection_round_items(p_round_id)),
      'athletes', v_athletes,
      'observations', (select count(*)::int from public.assessment_observations o where o.round_id = p_round_id),
      'today', public.club_today()
    ),
    'panel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at,
        'added_by_name', m.added_by_name,
        'removed_at', m.removed_at,
        'removed_by_name', m.removed_by_name,
        'declared_conflict', exists (
          select 1 from public.conflict_declarations d
          where d.profile_id = m.profile_id and d.season = v_round.season and d.has_conflict
        ),
        'can_assess', m.profile_id is not null and public.can_join_selection_panel(m.profile_id),
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = v_round.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = p_round_id
    ), '[]'::jsonb),
    -- Everyone who is on the panel now or wrote anything, by name.
    'selectors', coalesce((
      select jsonb_agg(to_jsonb(s) - 'profile_id' order by s.name)
      from (
        select
          n.profile_id,
          n.name,
          n.on_panel,
          count(o.id)::int as observations,
          count(distinct o.athlete_id)::int as athletes_covered,
          (
            select count(distinct i.group_key)::int
            from public.assessment_observations o2
            join public.assessment_observation_ratings ra on ra.observation_id = o2.id
            join public.selection_round_items(p_round_id) i on i.item_key = ra.item_key
            where o2.round_id = p_round_id
              and (o2.author_id = n.profile_id
                or (n.profile_id is null and o2.author_id is null and o2.author_name = n.name))
          ) as groups_covered,
          min(o.observed_on) as first_on,
          max(o.observed_on) as last_on,
          count(distinct date_trunc('week', o.observed_on::timestamp))::int as weeks_active,
          count(o.id) filter (where o.context = 'training')::int as training,
          count(o.id) filter (where o.context = 'game')::int as game,
          count(o.id) filter (where o.context = 'trial')::int as trial,
          count(o.id) filter (where o.context = 'other')::int as other,
          count(o.id) filter (where o.note is null)::int as without_evidence,
          count(o.id) filter (where o.observed_on < public.club_day(o.created_at) - 7)::int as written_late,
          count(o.id) filter (where o.corrects_id is not null)::int as corrections
        from (
          select m.profile_id, coalesce(public.member_display_name(m.profile_id), m.profile_name) as name,
            true as on_panel
          from public.selection_round_panel m
          where m.round_id = p_round_id and m.removed_at is null
          union all
          select distinct x.author_id, coalesce(public.member_display_name(x.author_id), x.author_name), false
          from public.assessment_observations x
          where x.round_id = p_round_id
            and not exists (
              select 1 from public.selection_round_panel m
              where m.round_id = p_round_id and m.removed_at is null
                and (m.profile_id = x.author_id
                  or (m.profile_id is null and x.author_id is null and m.profile_name = x.author_name))
            )
        ) n
        left join public.assessment_observations o
          on o.round_id = p_round_id
          and (o.author_id = n.profile_id
            or (n.profile_id is null and o.author_id is null and o.author_name = n.name))
        group by n.profile_id, n.name, n.on_panel
      ) s
    ), '[]'::jsonb),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', public.display_name(p),
        'is_minor', public.is_minor(p.date_of_birth, p.under_17),
        'observations', (
          select count(*)::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'selectors', (
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
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_audit(uuid) from public, anon;
grant execute on function public.admin_selection_audit(uuid) to authenticated;

commit;
