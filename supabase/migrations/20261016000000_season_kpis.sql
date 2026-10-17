-- Season KPIs and OKRs (Matt, 2026-10-16).
--
-- Measures of what a person should achieve by the end of a season, separate
-- from game goals. They belong to one person in one squad or team, so they
-- stay with that season's group as history when it is archived.
--   - The committee and admins set them for the coaches and managers of any
--     squad or team.
--   - A head coach sets them for the assistant coaches of their group.
--   - A group's coaches set them for its athletes.
-- Each one is a KPI (one measure with a target) or an OKR (an objective with
-- 1 to 5 key results). A measure is a number with a target and unit, or done
-- or not done. The person and whoever can set them both record progress;
-- only a setter records the final result.
--
-- Reviews: admins set each season's review dates. From a week before a date,
-- whoever set a person's KPIs gets a to-do to write that review; once it's
-- written, the person gets a to-do to confirm it was done. The person can add
-- their own view, which a setter can remove.
--
-- Who can read them: the person; whoever can set them; admins; for athletes
-- under 18, their parents and guardians. The committee doesn't see athletes'.
-- Teammates never see each other's, and athletes and guardians never see
-- coaches' or managers'. Views of an under 18's KPIs by a coach or admin go
-- in the record access log.
--
-- The tables are read and written only through the functions below.
-- Additive only: new types, tables and functions; the access log gains a kind
-- and record removal also removes old athlete KPIs once a season is archived.

begin;

do $$ begin
  create type public.kpi_format as enum ('kpi', 'okr');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kpi_measure_kind as enum ('number', 'yes_no');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kpi_result as enum ('met', 'partly_met', 'not_met');
exception when duplicate_object then null; end $$;


create table if not exists public.season_kpis (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  -- The person's place in the group when it was set, kept if they leave it.
  team_role public.team_role not null,
  format public.kpi_format not null,
  -- The KPI's name, or the OKR's objective.
  title text not null check (length(btrim(title)) between 1 and 200),
  detail text check (length(detail) <= 1000),
  result public.kpi_result,
  result_note text check (length(result_note) <= 1000),
  result_by uuid references public.profiles (id) on delete set null,
  result_at timestamptz,
  set_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists season_kpis_person_idx on public.season_kpis (profile_id, team_id);
create index if not exists season_kpis_team_idx on public.season_kpis (team_id);

-- A KPI's one measure, or an OKR's key results.
create table if not exists public.season_kpi_measures (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.season_kpis (id) on delete cascade,
  sort_order int not null default 0,
  -- A key result's wording. A KPI's measure uses the KPI's title.
  title text check (length(btrim(title)) between 1 and 200),
  kind public.kpi_measure_kind not null,
  target numeric,
  unit text check (length(unit) <= 40),
  -- Such as "fewer than 3 turnovers a game".
  lower_is_better boolean not null default false,
  -- Where the person started, when it's known.
  baseline numeric,
  current_value numeric,
  done boolean not null default false,
  progress_by uuid references public.profiles (id) on delete set null,
  progress_at timestamptz,
  constraint season_kpi_measures_target check (kind <> 'number' or target is not null)
);

create index if not exists season_kpi_measures_kpi_idx on public.season_kpi_measures (kpi_id, sort_order);

-- The review dates an admin sets for a season, such as "Mid-season review".
create table if not exists public.season_kpi_review_points (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  due_on date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, name)
);

create index if not exists season_kpi_review_points_season_idx
  on public.season_kpi_review_points (season, due_on);

create table if not exists public.season_kpi_reviews (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  -- A review date can't be removed once a review is written for it.
  point_id uuid not null references public.season_kpi_review_points (id) on delete restrict,
  team_role public.team_role not null,
  note text check (length(note) <= 2000),
  noted_by uuid references public.profiles (id) on delete set null,
  noted_at timestamptz,
  -- The person confirms the review was done with them.
  confirmed_at timestamptz,
  -- The person's own view of how the season is going.
  self_review text check (length(self_review) <= 2000),
  self_reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, team_id, point_id)
);

create index if not exists season_kpi_reviews_team_idx on public.season_kpi_reviews (team_id);

alter table public.season_kpis enable row level security;
alter table public.season_kpi_measures enable row level security;
alter table public.season_kpi_reviews enable row level security;
alter table public.season_kpi_review_points enable row level security;
revoke all on public.season_kpis from public, anon, authenticated;
revoke all on public.season_kpi_review_points from public, anon, authenticated;
revoke all on public.season_kpi_measures from public, anon, authenticated;
revoke all on public.season_kpi_reviews from public, anon, authenticated;

-- The access log gains season KPIs.
alter table public.record_access_log drop constraint if exists record_access_log_kind_check;
alter table public.record_access_log add constraint record_access_log_kind_check check (
  kind in (
    'injury', 'injury_document', 'injury_document_shared', 'check_ins', 'goals', 'member_record',
    'kpis'
  )
);

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- Whether the signed-in member sets season KPIs for this person in this squad
-- or team (archived groups included, so past seasons can still be read).
create or replace function public.kpi_can_set(p_profile_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_profile_id is distinct from auth.uid()
    and public.is_approved()
    and exists (
      select 1 from public.team_members m
      where m.team_id = p_team_id and m.profile_id = p_profile_id
        and (
          (m.team_role in ('coach', 'manager') and public.is_committee())
          or (
            m.team_role = 'coach' and m.coach_title = 'assistant_coach'
            and public.can_work_with_children()
            and exists (
              select 1 from public.team_members me
              where me.team_id = p_team_id and me.profile_id = auth.uid()
                and me.team_role = 'coach' and me.coach_title = 'head_coach'
            )
          )
          or (
            m.team_role = 'athlete'
            and public.can_work_with_children()
            and exists (
              select 1 from public.team_members me
              where me.team_id = p_team_id and me.profile_id = auth.uid() and me.team_role = 'coach'
            )
          )
        )
    );
$$;

revoke execute on function public.kpi_can_set(uuid, uuid) from public, anon, authenticated;

-- Setting and changing KPIs stops once the group's season is archived.
create or replace function public.kpi_can_edit(p_profile_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.kpi_can_set(p_profile_id, p_team_id)
    and exists (select 1 from public.teams t where t.id = p_team_id and not t.archived);
$$;

revoke execute on function public.kpi_can_edit(uuid, uuid) from public, anon, authenticated;

-- How the signed-in member relates to a person's KPIs in a group: 'self',
-- 'setter', 'guardian' (of an athlete under 18), 'viewer' (an admin reading
-- an athlete's), or null for no access.
create or replace function public.kpi_relation(p_profile_id uuid, p_team_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not public.is_approved() then null
    when not exists (
      select 1 from public.team_members m
      where m.team_id = p_team_id and m.profile_id = p_profile_id
        and m.team_role in ('coach', 'manager', 'athlete')
    ) then null
    when p_profile_id = auth.uid() then 'self'
    when public.kpi_can_set(p_profile_id, p_team_id) then 'setter'
    when public.is_guardian_of(p_profile_id) and exists (
      select 1 from public.team_members m
      where m.team_id = p_team_id and m.profile_id = p_profile_id and m.team_role = 'athlete'
    ) then 'guardian'
    when public.is_admin() then 'viewer'
    else null
  end;
$$;

revoke execute on function public.kpi_relation(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The review dates set for a season, in date order.
create or replace function public.kpi_review_points(p_season int)
returns table (id uuid, season int, name text, due_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.season, p.name, p.due_on
  from public.season_kpi_review_points p
  where p.season = p_season and public.is_approved()
  order by p.due_on, p.name;
$$;

revoke execute on function public.kpi_review_points(int) from public, anon;
grant execute on function public.kpi_review_points(int) to authenticated;

-- Everyone whose KPIs the signed-in member can see: in this season's squads
-- and teams, and in archived ones where something was recorded.
create or replace function public.season_kpi_people()
returns table (
  profile_id uuid,
  full_name text,
  team_id uuid,
  team_name text,
  team_kind public.group_kind,
  season int,
  archived boolean,
  team_role public.team_role,
  coach_title public.coach_title,
  relation text,
  kpi_count int,
  result_count int,
  review_count int,
  reviews_written int,
  reviews_confirmed int
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select m.profile_id, m.team_id, m.team_role, m.coach_title, t.name, t.kind, t.season,
      t.archived, t.sort_order, public.kpi_relation(m.profile_id, m.team_id) as relation,
      (select count(*)::int from public.season_kpis k
        where k.profile_id = m.profile_id and k.team_id = m.team_id) as kpi_count
    from public.team_members m
    join public.teams t on t.id = m.team_id
    join public.profiles p on p.id = m.profile_id and p.status = 'approved'
    where m.team_role in ('coach', 'manager', 'athlete')
  )
  select x.profile_id, coalesce(public.member_display_name(x.profile_id), 'Unnamed member'),
    x.team_id, x.name, x.kind, x.season, x.archived, x.team_role, x.coach_title, x.relation,
    x.kpi_count,
    (select count(*)::int from public.season_kpis k
      where k.profile_id = x.profile_id and k.team_id = x.team_id and k.result is not null),
    (select count(*)::int from public.season_kpi_review_points rp where rp.season = x.season),
    (select count(*)::int from public.season_kpi_reviews r
      where r.profile_id = x.profile_id and r.team_id = x.team_id and r.note is not null),
    (select count(*)::int from public.season_kpi_reviews r
      where r.profile_id = x.profile_id and r.team_id = x.team_id and r.note is not null
        and r.confirmed_at is not null)
  from people x
  where x.relation is not null
    -- Past seasons, and admins reading athletes', only where there's something to read.
    and (
      (not x.archived and x.relation <> 'viewer')
      or x.kpi_count > 0
      or exists (select 1 from public.season_kpi_reviews r
        where r.profile_id = x.profile_id and r.team_id = x.team_id)
    )
  order by x.archived, x.season desc, x.sort_order, x.name, x.team_role, 2;
$$;

revoke execute on function public.season_kpi_people() from public, anon;
grant execute on function public.season_kpi_people() to authenticated;

-- One person's KPIs, progress and reviews in one group, with what the
-- signed-in member can do. Null when they can't see them.
create or replace function public.season_kpi_sheet(p_profile_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_relation text := public.kpi_relation(p_profile_id, p_team_id);
  v_team public.teams;
  v_member public.team_members;
begin
  if v_relation is null then
    return null;
  end if;
  select * into v_team from public.teams where id = p_team_id;
  select * into v_member from public.team_members where team_id = p_team_id and profile_id = p_profile_id;
  if v_relation in ('setter', 'viewer') then
    perform public.write_record_access(p_profile_id, 'kpis', p_team_id);
  end if;
  return jsonb_build_object(
    'profile_id', p_profile_id,
    'full_name', coalesce(public.member_display_name(p_profile_id), 'Unnamed member'),
    'team_id', v_team.id,
    'team_name', v_team.name,
    'team_kind', v_team.kind,
    'season', v_team.season,
    'archived', v_team.archived,
    'team_role', v_member.team_role,
    'coach_title', v_member.coach_title,
    'relation', v_relation,
    'can_edit', v_relation = 'setter' and not v_team.archived,
    'can_update', v_relation in ('self', 'setter') and not v_team.archived,
    'kpis', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'format', k.format,
        'title', k.title,
        'detail', k.detail,
        'result', k.result,
        'result_note', k.result_note,
        'result_by_name', public.member_display_name(k.result_by),
        'result_at', k.result_at,
        'set_by_name', public.member_display_name(k.set_by),
        'created_at', k.created_at,
        'measures', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ms.id,
            'title', ms.title,
            'kind', ms.kind,
            'target', ms.target,
            'unit', ms.unit,
            'lower_is_better', ms.lower_is_better,
            'baseline', ms.baseline,
            'current_value', ms.current_value,
            'done', ms.done,
            'progress_by_name', public.member_display_name(ms.progress_by),
            'progress_at', ms.progress_at
          ) order by ms.sort_order)
          from public.season_kpi_measures ms where ms.kpi_id = k.id
        ), '[]'::jsonb)
      ) order by k.created_at)
      from public.season_kpis k
      where k.profile_id = p_profile_id and k.team_id = p_team_id
    ), '[]'::jsonb),
    -- Every review date in the group's season, with what's been written.
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'point_id', rp.id,
        'name', rp.name,
        'due_on', rp.due_on,
        'note', r.note,
        'noted_by_name', public.member_display_name(r.noted_by),
        'noted_at', r.noted_at,
        'confirmed_at', r.confirmed_at,
        'self_review', r.self_review,
        'self_reviewed_at', r.self_reviewed_at
      ) order by rp.due_on, rp.name)
      from public.season_kpi_review_points rp
      left join public.season_kpi_reviews r
        on r.point_id = rp.id and r.profile_id = p_profile_id and r.team_id = p_team_id
      where rp.season = v_team.season
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.season_kpi_sheet(uuid, uuid) from public, anon;
grant execute on function public.season_kpi_sheet(uuid, uuid) to authenticated;

-- For admins: every coach and manager in a season's squads and teams, with
-- each of their KPIs (one row per KPI; a row with no KPI when none are set).
create or replace function public.season_kpi_report(p_season int)
returns table (
  team_id uuid,
  team_name text,
  team_kind public.group_kind,
  profile_id uuid,
  full_name text,
  team_role public.team_role,
  coach_title public.coach_title,
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
  select t.id, t.name, t.kind, m.profile_id,
    coalesce(public.member_display_name(m.profile_id), 'Unnamed member'),
    m.team_role, m.coach_title, k.id, k.format, k.title,
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
        on r.point_id = rp.id and r.profile_id = m.profile_id and r.team_id = t.id
      where rp.season = t.season
    ), '[]'::jsonb)
  from public.teams t
  join public.team_members m on m.team_id = t.id and m.team_role in ('coach', 'manager')
  left join public.season_kpis k on k.profile_id = m.profile_id and k.team_id = t.id
  where public.is_admin() and t.season = p_season
  order by t.sort_order, t.name, m.team_role, 5, k.created_at;
$$;

revoke execute on function public.season_kpi_report(int) from public, anon;
grant execute on function public.season_kpi_report(int) to authenticated;

-- What the signed-in member owes for reviews: 'write' for each person whose
-- KPIs they set and whose review is due within a week or overdue; 'confirm'
-- for each of their own reviews written but not yet confirmed.
create or replace function public.kpi_review_todos()
returns table (
  kind text,
  point_id uuid,
  point_name text,
  due_on date,
  team_id uuid,
  team_name text,
  profile_id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'write', rp.id, rp.name, rp.due_on, t.id, t.name, m.profile_id,
    coalesce(public.member_display_name(m.profile_id), 'Unnamed member')
  from public.team_members m
  join public.teams t on t.id = m.team_id and not t.archived
  join public.season_kpi_review_points rp
    on rp.season = t.season and rp.due_on <= current_date + 7
  where public.is_approved()
    and exists (
      select 1 from public.season_kpis k
      where k.profile_id = m.profile_id and k.team_id = m.team_id and k.set_by = auth.uid()
    )
    and not exists (
      select 1 from public.season_kpi_reviews r
      where r.profile_id = m.profile_id and r.team_id = m.team_id and r.point_id = rp.id
        and r.note is not null
    )
    and public.kpi_can_edit(m.profile_id, m.team_id)
  union all
  select 'confirm', rp.id, rp.name, rp.due_on, t.id, t.name, r.profile_id,
    coalesce(public.member_display_name(r.profile_id), 'Unnamed member')
  from public.season_kpi_reviews r
  join public.teams t on t.id = r.team_id and not t.archived
  join public.season_kpi_review_points rp on rp.id = r.point_id
  where r.profile_id = auth.uid() and public.is_approved()
    and r.note is not null and r.confirmed_at is null
  order by 4, 6, 8;
$$;

revoke execute on function public.kpi_review_todos() from public, anon;
grant execute on function public.kpi_review_todos() to authenticated;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Adds a KPI or OKR (p_kpi_id null) or changes one. p_measures is a list of
-- {id?, title?, kind, target?, unit?, lower_is_better?, baseline?}: one for a
-- KPI, 1 to 5 key results for an OKR. Measures left out are removed; kept
-- ones keep their progress.
create or replace function public.save_season_kpi(
  p_kpi_id uuid,
  p_profile_id uuid,
  p_team_id uuid,
  p_format public.kpi_format,
  p_title text,
  p_detail text,
  p_measures jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_kpi_id;
  v_role public.team_role;
  v_count int;
  v_item jsonb;
  v_index int := 0;
  v_measure uuid;
  v_kind public.kpi_measure_kind;
  v_title text;
  v_target numeric;
  v_keep uuid[] := '{}';
begin
  if p_kpi_id is not null then
    select k.profile_id, k.team_id into p_profile_id, p_team_id
    from public.season_kpis k where k.id = p_kpi_id;
    if not found then
      raise exception 'This KPI isn''t there any more.';
    end if;
  end if;
  if not public.kpi_can_edit(p_profile_id, p_team_id) then
    raise exception 'You can''t set KPIs for this person.';
  end if;
  if p_format is null then
    raise exception 'Choose KPI or OKR.';
  end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'Give it a name.';
  end if;
  if p_measures is null or jsonb_typeof(p_measures) <> 'array' then
    raise exception 'Add what will be measured.';
  end if;
  v_count := jsonb_array_length(p_measures);
  if p_format = 'kpi' and v_count <> 1 then
    raise exception 'A KPI has one measure.';
  end if;
  if p_format = 'okr' and (v_count < 1 or v_count > 5) then
    raise exception 'An OKR has 1 to 5 key results.';
  end if;

  select m.team_role into v_role from public.team_members m
  where m.team_id = p_team_id and m.profile_id = p_profile_id;

  if v_id is null then
    if (
      select count(*) from public.season_kpis k
      where k.profile_id = p_profile_id and k.team_id = p_team_id
    ) >= 10 then
      raise exception 'A person can have up to 10 KPIs and OKRs in a squad or team.';
    end if;
    insert into public.season_kpis (profile_id, team_id, team_role, format, title, detail, set_by)
    values (
      p_profile_id, p_team_id, v_role, p_format, btrim(p_title),
      nullif(btrim(coalesce(p_detail, '')), ''), auth.uid()
    )
    returning id into v_id;
  else
    update public.season_kpis
    set format = p_format, title = btrim(p_title),
      detail = nullif(btrim(coalesce(p_detail, '')), ''), updated_at = now()
    where id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_measures) loop
    v_index := v_index + 1;
    v_kind := coalesce(nullif(v_item ->> 'kind', ''), 'number')::public.kpi_measure_kind;
    v_title := nullif(btrim(coalesce(v_item ->> 'title', '')), '');
    v_target := nullif(v_item ->> 'target', '')::numeric;
    if p_format = 'okr' and v_title is null then
      raise exception 'Give each key result a name.';
    end if;
    if v_kind = 'number' and v_target is null then
      raise exception 'Give each number a target.';
    end if;
    v_measure := nullif(v_item ->> 'id', '')::uuid;
    if v_measure is not null and exists (
      select 1 from public.season_kpi_measures ms where ms.id = v_measure and ms.kpi_id = v_id
    ) then
      update public.season_kpi_measures
      set sort_order = v_index,
        title = case when p_format = 'okr' then v_title else null end,
        kind = v_kind,
        target = case when v_kind = 'number' then v_target else null end,
        unit = case when v_kind = 'number' then nullif(btrim(coalesce(v_item ->> 'unit', '')), '') else null end,
        lower_is_better = v_kind = 'number' and coalesce((v_item ->> 'lower_is_better')::boolean, false),
        baseline = case when v_kind = 'number' then nullif(v_item ->> 'baseline', '')::numeric else null end
      where id = v_measure;
    else
      insert into public.season_kpi_measures (
        kpi_id, sort_order, title, kind, target, unit, lower_is_better, baseline
      )
      values (
        v_id, v_index,
        case when p_format = 'okr' then v_title else null end,
        v_kind,
        case when v_kind = 'number' then v_target else null end,
        case when v_kind = 'number' then nullif(btrim(coalesce(v_item ->> 'unit', '')), '') else null end,
        v_kind = 'number' and coalesce((v_item ->> 'lower_is_better')::boolean, false),
        case when v_kind = 'number' then nullif(v_item ->> 'baseline', '')::numeric else null end
      )
      returning id into v_measure;
    end if;
    v_keep := v_keep || v_measure;
  end loop;

  delete from public.season_kpi_measures ms where ms.kpi_id = v_id and not (ms.id = any (v_keep));
  return v_id;
end;
$$;

revoke execute on function public.save_season_kpi(uuid, uuid, uuid, public.kpi_format, text, text, jsonb) from public, anon;
grant execute on function public.save_season_kpi(uuid, uuid, uuid, public.kpi_format, text, text, jsonb) to authenticated;

create or replace function public.delete_season_kpi(p_kpi_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k public.season_kpis;
begin
  select * into k from public.season_kpis where id = p_kpi_id;
  if not found then
    return;
  end if;
  if not public.kpi_can_edit(k.profile_id, k.team_id) then
    raise exception 'You can''t remove this KPI.';
  end if;
  delete from public.season_kpis where id = p_kpi_id;
end;
$$;

revoke execute on function public.delete_season_kpi(uuid) from public, anon;
grant execute on function public.delete_season_kpi(uuid) to authenticated;

-- The person or a setter records where a measure is up to: a number, or done.
create or replace function public.record_kpi_progress(
  p_measure_id uuid,
  p_value numeric,
  p_done boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k public.season_kpis;
  v_kpi_id uuid;
  v_kind public.kpi_measure_kind;
begin
  select ms.kpi_id, ms.kind into v_kpi_id, v_kind
  from public.season_kpi_measures ms where ms.id = p_measure_id;
  select * into k from public.season_kpis where id = v_kpi_id;
  if k.id is null then
    raise exception 'This measure isn''t there any more.';
  end if;
  if not (
    (k.profile_id = auth.uid() and public.is_approved()
      and exists (select 1 from public.teams t where t.id = k.team_id and not t.archived))
    or public.kpi_can_edit(k.profile_id, k.team_id)
  ) then
    raise exception 'You can''t update this KPI.';
  end if;
  update public.season_kpi_measures
  set current_value = case when v_kind = 'number' then p_value else null end,
    done = v_kind = 'yes_no' and coalesce(p_done, false),
    progress_by = auth.uid(), progress_at = now()
  where id = p_measure_id;
  update public.season_kpis set updated_at = now() where id = k.id;
end;
$$;

revoke execute on function public.record_kpi_progress(uuid, numeric, boolean) from public, anon;
grant execute on function public.record_kpi_progress(uuid, numeric, boolean) to authenticated;

-- A setter records how a KPI ended up, or clears it with a null result.
create or replace function public.set_kpi_result(
  p_kpi_id uuid,
  p_result public.kpi_result,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k public.season_kpis;
begin
  select * into k from public.season_kpis where id = p_kpi_id;
  if not found then
    raise exception 'This KPI isn''t there any more.';
  end if;
  if not public.kpi_can_edit(k.profile_id, k.team_id) then
    raise exception 'Only the people who set this KPI record its result.';
  end if;
  update public.season_kpis
  set result = p_result,
    result_note = case when p_result is null then null else nullif(btrim(coalesce(p_note, '')), '') end,
    result_by = case when p_result is null then null else auth.uid() end,
    result_at = case when p_result is null then null else now() end,
    updated_at = now()
  where id = p_kpi_id;
end;
$$;

revoke execute on function public.set_kpi_result(uuid, public.kpi_result, text) from public, anon;
grant execute on function public.set_kpi_result(uuid, public.kpi_result, text) to authenticated;

-- An admin adds a season's review date (p_id null) or changes one.
create or replace function public.admin_save_kpi_review_point(
  p_id uuid,
  p_season int,
  p_name text,
  p_due_on date
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not public.is_admin() then
    raise exception 'Only admins set review dates.';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the review a name.';
  end if;
  if p_due_on is null then
    raise exception 'Choose the review date.';
  end if;
  if exists (
    select 1 from public.season_kpi_review_points p
    where p.season = coalesce(p_season, (select season from public.season_kpi_review_points where id = p_id))
      and lower(p.name) = lower(btrim(p_name)) and p.id is distinct from p_id
  ) then
    raise exception 'This season already has a review with that name.';
  end if;
  if v_id is null then
    if p_season is null then
      raise exception 'Choose the season.';
    end if;
    insert into public.season_kpi_review_points (season, name, due_on, created_by)
    values (p_season, btrim(p_name), p_due_on, auth.uid())
    returning id into v_id;
  else
    update public.season_kpi_review_points
    set name = btrim(p_name), due_on = p_due_on, updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'This review date isn''t there any more.';
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.admin_save_kpi_review_point(uuid, int, text, date) from public, anon;
grant execute on function public.admin_save_kpi_review_point(uuid, int, text, date) to authenticated;

-- An admin removes a review date nobody has written anything for yet.
create or replace function public.admin_delete_kpi_review_point(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins set review dates.';
  end if;
  if exists (select 1 from public.season_kpi_reviews r where r.point_id = p_id) then
    raise exception 'Reviews have been written for this date, so it can''t be removed. Change its date instead.';
  end if;
  delete from public.season_kpi_review_points where id = p_id;
end;
$$;

revoke execute on function public.admin_delete_kpi_review_point(uuid) from public, anon;
grant execute on function public.admin_delete_kpi_review_point(uuid) to authenticated;

-- Whether a review date belongs to the group's season.
create or replace function public.kpi_point_in_season(p_point_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.season_kpi_review_points rp
    join public.teams t on t.season = rp.season
    where rp.id = p_point_id and t.id = p_team_id
  );
$$;

revoke execute on function public.kpi_point_in_season(uuid, uuid) from public, anon, authenticated;

-- A setter writes a review. An empty note clears it. Changing the note asks
-- the person to confirm again.
create or replace function public.save_kpi_review(
  p_profile_id uuid,
  p_team_id uuid,
  p_point_id uuid,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_role public.team_role;
begin
  if not public.kpi_can_edit(p_profile_id, p_team_id) then
    raise exception 'You can''t review this person''s KPIs.';
  end if;
  if not public.kpi_point_in_season(p_point_id, p_team_id) then
    raise exception 'That review date isn''t in this season.';
  end if;
  select m.team_role into v_role from public.team_members m
  where m.team_id = p_team_id and m.profile_id = p_profile_id;
  insert into public.season_kpi_reviews (
    profile_id, team_id, point_id, team_role, note, noted_by, noted_at, updated_at
  )
  values (
    p_profile_id, p_team_id, p_point_id, v_role, v_note,
    case when v_note is null then null else auth.uid() end,
    case when v_note is null then null else now() end,
    now()
  )
  on conflict (profile_id, team_id, point_id) do update
  set note = excluded.note, noted_by = excluded.noted_by, noted_at = excluded.noted_at,
    confirmed_at = case
      when excluded.note is not distinct from public.season_kpi_reviews.note
        then public.season_kpi_reviews.confirmed_at
      else null
    end,
    updated_at = now();
end;
$$;

revoke execute on function public.save_kpi_review(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.save_kpi_review(uuid, uuid, uuid, text) to authenticated;

-- The person confirms a written review was done with them.
create or replace function public.confirm_kpi_review(p_team_id uuid, p_point_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() then
    raise exception 'You can''t confirm this review.';
  end if;
  update public.season_kpi_reviews r
  set confirmed_at = now(), updated_at = now()
  where r.profile_id = auth.uid() and r.team_id = p_team_id and r.point_id = p_point_id
    and r.note is not null and r.confirmed_at is null
    and exists (select 1 from public.teams t where t.id = r.team_id and not t.archived);
  if not found then
    raise exception 'There’s no written review to confirm.';
  end if;
end;
$$;

revoke execute on function public.confirm_kpi_review(uuid, uuid) from public, anon;
grant execute on function public.confirm_kpi_review(uuid, uuid) to authenticated;

-- The person writes their own view for a review. An empty text clears it.
create or replace function public.save_kpi_self_review(
  p_team_id uuid,
  p_point_id uuid,
  p_text text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_role public.team_role;
begin
  select m.team_role into v_role
  from public.team_members m
  join public.teams t on t.id = m.team_id and not t.archived
  where m.team_id = p_team_id and m.profile_id = auth.uid()
    and m.team_role in ('coach', 'manager', 'athlete');
  if v_role is null or not public.is_approved()
     or not public.kpi_point_in_season(p_point_id, p_team_id) then
    raise exception 'You can''t review KPIs here.';
  end if;
  insert into public.season_kpi_reviews (
    profile_id, team_id, point_id, team_role, self_review, self_reviewed_at, updated_at
  )
  values (
    auth.uid(), p_team_id, p_point_id, v_role, v_text,
    case when v_text is null then null else now() end, now()
  )
  on conflict (profile_id, team_id, point_id) do update
  set self_review = excluded.self_review, self_reviewed_at = excluded.self_reviewed_at,
    updated_at = now();
end;
$$;

revoke execute on function public.save_kpi_self_review(uuid, uuid, text) from public, anon;
grant execute on function public.save_kpi_self_review(uuid, uuid, text) to authenticated;

-- A setter removes what the person wrote, if it shouldn't be there.
create or replace function public.remove_kpi_self_review(
  p_profile_id uuid,
  p_team_id uuid,
  p_point_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.kpi_can_edit(p_profile_id, p_team_id) then
    raise exception 'You can''t change this person''s review.';
  end if;
  update public.season_kpi_reviews
  set self_review = null, self_reviewed_at = null, updated_at = now()
  where profile_id = p_profile_id and team_id = p_team_id and point_id = p_point_id;
end;
$$;

revoke execute on function public.remove_kpi_self_review(uuid, uuid, uuid) from public, anon;
grant execute on function public.remove_kpi_self_review(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Keeping records: athletes' KPIs and reviews go with game goals, counted from
-- their last change, once their season is archived. Coaches' and managers'
-- stay as the club's governance record.
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_check_ins int := 0;
  v_goals int := 0;
  v_team_goals int := 0;
  v_kpis int := 0;
  v_kpi_reviews int := 0;
  v_messages int := 0;
  v_attendance int := 0;
  v_absences int := 0;
  v_certificates int := 0;
  v_access int := 0;
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;

  delete from public.check_ins
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date;
  get diagnostics v_check_ins = row_count;

  -- Goals, reflections and their comments go together, counted from the game.
  delete from public.game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_goals = row_count;
  delete from public.team_game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_team_goals = row_count;

  delete from public.season_kpis k
  using public.teams t
  where t.id = k.team_id and t.archived and k.team_role = 'athlete'
    and k.updated_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_kpis = row_count;
  delete from public.season_kpi_reviews r
  using public.teams t
  where t.id = r.team_id and t.archived and r.team_role = 'athlete'
    and r.updated_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_kpi_reviews = row_count;

  -- The message stays with who sent it, who it went to and who read it; only
  -- the text is replaced.
  update public.messages
  set body = 'This message was removed after the club''s keep period.', body_removed_at = now()
  where body_removed_at is null
    and created_at < now() - make_interval(months => s.retention_messages_months);
  get diagnostics v_messages = row_count;

  delete from public.attendance_sessions
  where held_at < now() - make_interval(months => s.retention_attendance_months);
  get diagnostics v_attendance = row_count;

  delete from public.attendance_absences
  where to_day < (current_date - make_interval(months => s.retention_attendance_months))::date;
  get diagnostics v_absences = row_count;

  delete from public.training_certificates c
  where c.created_at < now() - make_interval(months => s.retention_certificates_months)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'training-certificates' and o.name = c.document_path
    );
  get diagnostics v_certificates = row_count;

  delete from public.record_access_log
  where created_at < now() - make_interval(months => s.retention_access_log_months);
  get diagnostics v_access = row_count;

  return jsonb_build_object(
    'enabled', true,
    'check_ins', v_check_ins,
    'game_goals', v_goals,
    'team_goals', v_team_goals,
    'season_kpis', v_kpis,
    'season_kpi_reviews', v_kpi_reviews,
    'messages', v_messages,
    'attendance_sessions', v_attendance,
    'absences', v_absences,
    'certificates', v_certificates,
    'record_views', v_access
  );
end;
$$;

revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
