-- Selection rounds, part 5 (release an assessment, Matt 27 November 2026).
--
-- The head coach of a round's squad or team can release an athlete's
-- assessment to them, taken from the head coach's own signed summary: the
-- parts they tick (criteria groups, strengths, development priorities,
-- comments, recommendation), never an observation, evidence or another
-- selector's summary. An under 18's verified parents and guardians read it at
-- the same time. Nobody can reply. The head coach can take it back, and
-- reopening the summary takes it back. Every release and taking back is kept;
-- admins and the round's auditors see the record (admins never the words).
-- What an athlete reads is filtered here, in the database.
--
-- Additive: two new tables, new functions, and three redefined
-- (reopen_assessment_summary, auditor_athlete_assessment,
-- admin_selection_register), each copied from its latest migration.

begin;

-- What the head coach has released to an athlete from their signed summary.
-- One row per athlete per round.
create table if not exists public.assessment_releases (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- The head coach's summary it is taken from.
  summary_id uuid not null references public.assessment_summaries (id) on delete cascade,
  -- {"groups": ["technical"], "strengths": true, "priorities": true,
  --  "comments": false, "recommendation": false}
  parts jsonb not null check (jsonb_typeof(parts) = 'object'),
  -- Null after it was taken back.
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null,
  released_by_name text not null,
  -- The first time the athlete or a verified guardian read it since it was last released.
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists assessment_releases_one_each
  on public.assessment_releases (round_id, athlete_id);
create index if not exists assessment_releases_athlete_idx on public.assessment_releases (athlete_id);
create index if not exists assessment_releases_summary_idx on public.assessment_releases (summary_id);

-- Every release and taking back, kept for the audit.
create table if not exists public.assessment_release_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.assessment_releases (id) on delete cascade,
  kind text not null check (kind in ('released', 'withdrawn')),
  parts jsonb,
  detail text,
  by_id uuid references public.profiles (id) on delete set null,
  by_name text not null,
  at timestamptz not null default now()
);
create index if not exists assessment_release_events_release_idx
  on public.assessment_release_events (release_id);

alter table public.assessment_releases enable row level security;
alter table public.assessment_release_events enable row level security;
-- Reached only through the functions below.
revoke all on table public.assessment_releases from public, anon, authenticated;
revoke all on table public.assessment_release_events from public, anon, authenticated;
grant all on table public.assessment_releases to service_role;
grant all on table public.assessment_release_events to service_role;

-- ---------------------------------------------------------------------------
-- Helpers (not granted)
-- ---------------------------------------------------------------------------

-- Checks the parts a head coach ticked and returns them with exactly five keys.
create or replace function public.check_release_parts(p_round_id uuid, p_parts jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_groups jsonb;
  v_out jsonb;
  v_key text;
begin
  if p_parts is null or jsonb_typeof(p_parts) <> 'object' then
    raise exception 'Choose what to release';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  v_groups := coalesce(p_parts -> 'groups', '[]'::jsonb);
  if jsonb_typeof(v_groups) <> 'array' then
    raise exception 'Choose what to release';
  end if;
  for v_key in select e #>> '{}' from jsonb_array_elements(v_groups) e loop
    if v_key is null or not exists (
      select 1 from jsonb_array_elements(coalesce(v_round.criteria -> 'groups', '[]'::jsonb)) c where c ->> 'key' = v_key
    ) then
      raise exception 'One of the criteria groups isn’t in this round';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_groups)) <> (select count(distinct x) from jsonb_array_elements(v_groups) x) then
    raise exception 'One of the criteria groups is ticked twice';
  end if;
  if exists (
    select 1 from unnest(array['strengths', 'priorities', 'comments', 'recommendation']) k
    where p_parts ? k and jsonb_typeof(p_parts -> k) <> 'boolean'
  ) then
    raise exception 'Choose what to release';
  end if;
  v_out := jsonb_build_object(
    'groups', v_groups,
    'strengths', coalesce((p_parts ->> 'strengths')::boolean, false),
    'priorities', coalesce((p_parts ->> 'priorities')::boolean, false),
    'comments', coalesce((p_parts ->> 'comments')::boolean, false),
    'recommendation', coalesce((p_parts ->> 'recommendation')::boolean, false)
  );
  if jsonb_array_length(v_groups) = 0 and not ((v_out ->> 'strengths')::boolean or (v_out ->> 'priorities')::boolean
      or (v_out ->> 'comments')::boolean or (v_out ->> 'recommendation')::boolean) then
    raise exception 'Tick at least one part to release';
  end if;
  return v_out;
end;
$$;
revoke execute on function public.check_release_parts(uuid, jsonb) from public, anon, authenticated;

-- The parts left once those the summary has nothing in are switched off.
create or replace function public.release_parts_for(p_round_id uuid, p_summary public.assessment_summaries, p_parts jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(c ->> 'key' order by o)
      from public.selection_rounds r,
        jsonb_array_elements(coalesce(r.criteria -> 'groups', '[]'::jsonb)) with ordinality g(c, o)
      where r.id = p_round_id
        and (p_parts -> 'groups') ? (c ->> 'key')
        and exists (
          select 1 from jsonb_array_elements(coalesce(c -> 'items', '[]'::jsonb)) i,
            jsonb_array_elements(coalesce(p_summary.ratings, '[]'::jsonb)) ra
          where ra ->> 'item_key' = i ->> 'key' and (ra ->> 'rating') is not null
        )
    ), '[]'::jsonb),
    'strengths', (p_parts ->> 'strengths')::boolean and trim(coalesce(p_summary.strengths, '')) <> '',
    'priorities', (p_parts ->> 'priorities')::boolean and trim(coalesce(p_summary.priorities, '')) <> '',
    'comments', (p_parts ->> 'comments')::boolean and trim(coalesce(p_summary.comments, '')) <> '',
    'recommendation', (p_parts ->> 'recommendation')::boolean and trim(coalesce(p_summary.recommendation, '')) <> ''
  );
$$;
revoke execute on function public.release_parts_for(uuid, public.assessment_summaries, jsonb) from public, anon, authenticated;

create or replace function public.release_parts_empty(p_parts jsonb)
returns boolean language sql immutable security definer set search_path = '' as $$
  select jsonb_array_length(p_parts -> 'groups') = 0
    and not ((p_parts ->> 'strengths')::boolean or (p_parts ->> 'priorities')::boolean
      or (p_parts ->> 'comments')::boolean or (p_parts ->> 'recommendation')::boolean);
$$;
revoke execute on function public.release_parts_empty(jsonb) from public, anon, authenticated;

-- Releases one athlete's assessment from the caller's signed summary, with
-- the parts already checked. Returns the release's id, or null when nothing
-- in those parts of the summary is left to release. The callers check who
-- may and when.
create or replace function public.release_one(p_round_id uuid, p_athlete_id uuid, p_parts jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary public.assessment_summaries;
  v_parts jsonb;
  v_id uuid;
begin
  select * into v_summary from public.assessment_summaries s
  where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.author_id = auth.uid() and s.signed_at is not null;
  if v_summary.id is null then
    return null;
  end if;
  v_parts := public.release_parts_for(p_round_id, v_summary, p_parts);
  if public.release_parts_empty(v_parts) then
    return null;
  end if;
  insert into public.assessment_releases as x (round_id, athlete_id, summary_id, parts, released_at, released_by, released_by_name)
  values (p_round_id, p_athlete_id, v_summary.id, v_parts, now(), auth.uid(), public.member_display_name(auth.uid()))
  on conflict (round_id, athlete_id) do update
    set summary_id = excluded.summary_id, parts = excluded.parts, released_at = excluded.released_at,
        released_by = excluded.released_by, released_by_name = excluded.released_by_name,
        seen_at = null, updated_at = now()
  returning x.id into v_id;
  insert into public.assessment_release_events (release_id, kind, parts, by_id, by_name)
  values (v_id, 'released', v_parts, auth.uid(), public.member_display_name(auth.uid()));
  return v_id;
end;
$$;
revoke execute on function public.release_one(uuid, uuid, jsonb) from public, anon, authenticated;

-- What an athlete and their verified guardians read of one release: only the
-- ticked parts of the summary, steps as the scale's words. No keys, step
-- numbers, ids or other selectors.
create or replace function public.released_assessment_json(p_release public.assessment_releases)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'round_id', r.id,
    'round_name', r.name,
    'phase', r.phase,
    'round_number', r.round_number,
    'team_name', coalesce(t.name, r.team_name),
    'criteria_set_name', coalesce(r.criteria_set_name,
      (select cs.name from public.assessment_criteria_sets cs where cs.legacy limit 1)),
    'athlete_id', p_release.athlete_id,
    'athlete_name', public.member_display_name(p_release.athlete_id),
    'is_me', p_release.athlete_id = auth.uid(),
    'from_name', coalesce(public.member_display_name(p_release.released_by), p_release.released_by_name),
    'released_on', public.club_day(p_release.released_at),
    'is_new', p_release.seen_at is null,
    'strengths', case when (p_release.parts ->> 'strengths')::boolean then nullif(trim(s.strengths), '') end,
    'priorities', case when (p_release.parts ->> 'priorities')::boolean then nullif(trim(s.priorities), '') end,
    'comments', case when (p_release.parts ->> 'comments')::boolean then nullif(trim(s.comments), '') end,
    'recommendation', case when (p_release.parts ->> 'recommendation')::boolean then nullif(trim(s.recommendation), '') end,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('name', c ->> 'name', 'scale', c -> 'scale', 'items', items) order by o)
      from jsonb_array_elements(coalesce(r.criteria -> 'groups', '[]'::jsonb)) with ordinality g(c, o),
        lateral (
          select jsonb_agg(jsonb_build_object('name', i ->> 'name', 'step', c -> 'scale' ->> ((ra ->> 'rating')::int - 1)) order by io) as items
          from jsonb_array_elements(coalesce(c -> 'items', '[]'::jsonb)) with ordinality ii(i, io)
          join jsonb_array_elements(coalesce(s.ratings, '[]'::jsonb)) ra on ra ->> 'item_key' = i ->> 'key'
          where (ra ->> 'rating') is not null
        ) x
      where coalesce(p_release.parts -> 'groups', '[]'::jsonb) ? (c ->> 'key') and x.items is not null
    ), '[]'::jsonb)
  )
  from public.selection_rounds r
  join public.assessment_summaries s on s.id = p_release.summary_id
  left join public.teams t on t.id = r.team_id
  where r.id = p_release.round_id;
$$;
revoke execute on function public.released_assessment_json(public.assessment_releases) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The head coach
-- ---------------------------------------------------------------------------

-- An athlete's release, for any panel member who can assess them. The head
-- coach also gets their own signed summary, for the ticks and the preview.
create or replace function public.athlete_release(p_round_id uuid, p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_release public.assessment_releases;
  v_mine public.assessment_summaries;
  v_leads boolean;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  v_leads := public.leads_selection_round(p_round_id);
  select * into v_mine from public.assessment_summaries s
  where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.author_id = auth.uid();
  select * into v_release from public.assessment_releases x
  where x.round_id = p_round_id and x.athlete_id = p_athlete_id
    and (v_leads or x.released_at is not null);

  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_name', v_round.name,
    'phase', v_round.phase,
    'round_number', v_round.round_number,
    'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
    'criteria_set_name', coalesce(v_round.criteria_set_name,
      (select cs.name from public.assessment_criteria_sets cs where cs.legacy limit 1)),
    'closed', v_round.closed_at is not null,
    'criteria', v_round.criteria,
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'is_minor', public.athlete_is_minor(p_athlete_id),
    'can_release', v_leads and v_round.closed_at is null,
    'my_summary_signed', v_mine.signed_at is not null,
    'my_name', public.member_display_name(auth.uid()),
    'summary', case when v_leads and v_mine.signed_at is not null then jsonb_build_object(
      'ratings', v_mine.ratings, 'recommendation', v_mine.recommendation,
      'strengths', v_mine.strengths, 'priorities', v_mine.priorities, 'comments', v_mine.comments) end,
    'release', case when v_release.id is null then null else jsonb_build_object(
      'parts', v_release.parts, 'released_at', v_release.released_at,
      'released_by_name', coalesce(public.member_display_name(v_release.released_by), v_release.released_by_name),
      'seen_at', v_release.seen_at) end
  );
end;
$$;
revoke execute on function public.athlete_release(uuid, uuid) from public, anon;
grant execute on function public.athlete_release(uuid, uuid) to authenticated;

create or replace function public.release_assessment(p_round_id uuid, p_athlete_id uuid, p_parts jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_parts jsonb;
  v_id uuid;
begin
  if not (public.leads_selection_round(p_round_id) and public.can_assess_athlete(p_round_id, p_athlete_id)) then
    raise exception 'Only the head coach can release an assessment';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  if not exists (
    select 1 from public.assessment_summaries s
    where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.author_id = auth.uid() and s.signed_at is not null
  ) then
    raise exception 'Sign your summary of this athlete first';
  end if;
  if exists (
    select 1 from public.assessment_releases x
    where x.round_id = p_round_id and x.athlete_id = p_athlete_id and x.released_at is not null
  ) then
    raise exception 'This assessment is released. Take it back to change it.';
  end if;
  v_parts := public.check_release_parts(p_round_id, p_parts);
  v_id := public.release_one(p_round_id, p_athlete_id, v_parts);
  if v_id is null then
    raise exception 'There is nothing in those parts of your summary to release';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.release_assessment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.release_assessment(uuid, uuid, jsonb) to authenticated;

create or replace function public.withdraw_assessment_release(p_round_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_release public.assessment_releases;
begin
  if not (public.leads_selection_round(p_round_id) and public.can_assess_athlete(p_round_id, p_athlete_id)) then
    raise exception 'Only the head coach can take an assessment back';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  select * into v_release from public.assessment_releases x
  where x.round_id = p_round_id and x.athlete_id = p_athlete_id;
  if v_release.released_at is null then
    raise exception 'This assessment isn’t released';
  end if;
  update public.assessment_releases x set released_at = null, seen_at = null, updated_at = now()
  where x.id = v_release.id;
  insert into public.assessment_release_events (release_id, kind, parts, by_id, by_name)
  values (v_release.id, 'withdrawn', v_release.parts, auth.uid(), public.member_display_name(auth.uid()));
end;
$$;
revoke execute on function public.withdraw_assessment_release(uuid, uuid) from public, anon;
grant execute on function public.withdraw_assessment_release(uuid, uuid) to authenticated;

-- Releases to every athlete whose summary the head coach has signed and who
-- has nothing released now. Returns how many were released.
create or replace function public.release_assessments(p_round_id uuid, p_parts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_parts jsonb;
  v_athlete uuid;
  v_count integer := 0;
begin
  if not public.leads_selection_round(p_round_id) then
    raise exception 'Only the head coach can release assessments';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  v_parts := public.check_release_parts(p_round_id, p_parts);
  for v_athlete in
    select s.athlete_id from public.assessment_summaries s
    where s.round_id = p_round_id and s.author_id = auth.uid() and s.signed_at is not null
      and public.can_assess_athlete(p_round_id, s.athlete_id)
      and not exists (
        select 1 from public.assessment_releases x
        where x.round_id = p_round_id and x.athlete_id = s.athlete_id and x.released_at is not null
      )
  loop
    if public.release_one(p_round_id, v_athlete, v_parts) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.release_assessments(uuid, jsonb) from public, anon;
grant execute on function public.release_assessments(uuid, jsonb) to authenticated;

-- Whether the signed-in member leads a round they are on the panel of, so the
-- round's list can offer the head coach "Release to everyone signed". Says
-- nothing about anyone else.
create or replace function public.i_lead_selection_round(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.on_selection_panel(p_round_id) and public.leads_selection_round(p_round_id);
$$;
revoke execute on function public.i_lead_selection_round(uuid) from public, anon;
grant execute on function public.i_lead_selection_round(uuid) to authenticated;

-- For a round's list: whose assessment is released, and whether it was read.
create or replace function public.selection_round_releases(p_round_id uuid)
returns table (athlete_id uuid, seen boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.on_selection_panel(p_round_id) then
    raise exception 'You are not on this round’s panel';
  end if;
  return query
  select x.athlete_id, x.seen_at is not null
  from public.assessment_releases x
  where x.round_id = p_round_id and x.released_at is not null
    and public.can_assess_athlete(p_round_id, x.athlete_id);
end;
$$;
revoke execute on function public.selection_round_releases(uuid) from public, anon;
grant execute on function public.selection_round_releases(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Athletes and their parents
-- ---------------------------------------------------------------------------

-- Assessments released to the signed-in athlete, or to a child the member is
-- a verified guardian of, in open and closed rounds.
create or replace function public.my_released_assessments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.released_assessment_json(x)
    order by (x.athlete_id <> auth.uid()), public.member_display_name(x.athlete_id), x.released_at desc), '[]'::jsonb)
  from public.assessment_releases x
  join public.assessment_summaries s on s.id = x.summary_id
  where x.released_at is not null
    and s.signed_at is not null
    and public.is_approved()
    and public.selection_assessments_on()
    and (x.athlete_id = auth.uid() or public.is_verified_guardian_of(x.athlete_id));
$$;
revoke execute on function public.my_released_assessments() from public, anon;
grant execute on function public.my_released_assessments() to authenticated;

-- Records the first time the athlete, or a verified guardian, read it.
-- Anyone else changes nothing.
create or replace function public.mark_assessment_release_seen(p_round_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_approved() and public.selection_assessments_on()
          and (p_athlete_id = auth.uid() or public.is_verified_guardian_of(p_athlete_id))) then
    return;
  end if;
  update public.assessment_releases x set seen_at = now()
  where x.round_id = p_round_id and x.athlete_id = p_athlete_id
    and x.released_at is not null and x.seen_at is null;
end;
$$;
revoke execute on function public.mark_assessment_release_seen(uuid, uuid) from public, anon;
grant execute on function public.mark_assessment_release_seen(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The record, for admins and the round's auditors: no words and no steps
-- ---------------------------------------------------------------------------

create or replace function public.admin_selection_releases(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_child uuid;
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins and this round’s auditors can see the release record';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  for v_child in
    select m.profile_id from public.team_members m
    where m.team_id = v_round.team_id and m.team_role = 'athlete'
  loop
    perform public.write_record_access(v_child, 'assessment_audit', p_round_id);
  end loop;

  return jsonb_build_object(
    'athletes', (
      select count(*)::int from public.team_members m
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
    ),
    'released', coalesce((
      select jsonb_agg(jsonb_build_object(
        'athlete_name', public.member_display_name(x.athlete_id),
        'released_at', x.released_at,
        'released_by_name', (
          select e.by_name from public.assessment_release_events e
          where e.release_id = x.id and e.kind = 'released' order by e.at desc, e.id desc limit 1
        ),
        'seen_at', x.seen_at,
        'withdrawn', (
          select count(*)::int from public.assessment_release_events e
          where e.release_id = x.id and e.kind = 'withdrawn'
        ),
        'groups', jsonb_array_length(coalesce(x.parts -> 'groups', '[]'::jsonb)),
        'groups_total', jsonb_array_length(coalesce(v_round.criteria -> 'groups', '[]'::jsonb)),
        'strengths', coalesce((x.parts ->> 'strengths')::boolean, false),
        'priorities', coalesce((x.parts ->> 'priorities')::boolean, false),
        'comments', coalesce((x.parts ->> 'comments')::boolean, false),
        'recommendation', coalesce((x.parts ->> 'recommendation')::boolean, false)
      ) order by public.member_display_name(x.athlete_id))
      from public.assessment_releases x
      where x.round_id = p_round_id
        and exists (select 1 from public.assessment_release_events e where e.release_id = x.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_releases(uuid) from public, anon;
grant execute on function public.admin_selection_releases(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Redefined: reopening a summary takes its release back
-- (from 20261123300000_selection_summaries.sql)
-- ---------------------------------------------------------------------------

create or replace function public.reopen_assessment_summary(p_summary_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary public.assessment_summaries;
  v_round public.selection_rounds;
begin
  select * into v_summary from public.assessment_summaries s where s.id = p_summary_id;
  if v_summary.id is null
     or not (
       (public.is_admin() and public.selection_assessments_on())
       or (public.leads_selection_round(v_summary.round_id)
           and public.can_assess_athlete(v_summary.round_id, v_summary.athlete_id))
     ) then
    raise exception 'Only the head coach or an admin can reopen a summary';
  end if;
  select * into v_round from public.selection_rounds r where r.id = v_summary.round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed. Open it again first.';
  end if;
  if v_summary.signed_at is null then
    raise exception 'This summary isn’t signed';
  end if;
  update public.assessment_summaries s set signed_at = null, updated_at = now() where s.id = p_summary_id;
  insert into public.assessment_summary_events (summary_id, kind, by_id, by_name)
  values (p_summary_id, 'reopened', auth.uid(), public.member_display_name(auth.uid()));
  -- Part 5: an athlete never reads a summary that is being changed.
  insert into public.assessment_release_events (release_id, kind, parts, detail, by_id, by_name)
  select x.id, 'withdrawn', x.parts, 'The summary was reopened', auth.uid(), public.member_display_name(auth.uid())
  from public.assessment_releases x
  where x.summary_id = p_summary_id and x.released_at is not null;
  update public.assessment_releases x set released_at = null, seen_at = null, updated_at = now()
  where x.summary_id = p_summary_id and x.released_at is not null;
end;
$$;
revoke execute on function public.reopen_assessment_summary(uuid) from public, anon;
grant execute on function public.reopen_assessment_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Redefined: the auditor sees the release and its history
-- (from 20261127300000_selection_auditors.sql)
-- ---------------------------------------------------------------------------

create or replace function public.auditor_athlete_assessment(p_round_id uuid, p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_feedback public.assessment_feedback;
  v_release public.assessment_releases;
begin
  if not public.can_audit_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  select * into v_feedback from public.assessment_feedback f
  where f.round_id = p_round_id and f.athlete_id = p_athlete_id
  order by f.updated_at desc limit 1;
  select * into v_release from public.assessment_releases x
  where x.round_id = p_round_id and x.athlete_id = p_athlete_id;

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_name', v_round.name,
    'phase', v_round.phase,
    'round_number', v_round.round_number,
    'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
    'starts_on', v_round.starts_on,
    'ends_on', v_round.ends_on,
    'closed', v_round.closed_at is not null,
    'criteria', v_round.criteria,
    'today', public.club_today(),
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'is_minor', (select public.is_minor(p.date_of_birth, p.under_17) from public.profiles p where p.id = p_athlete_id),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'author_name', coalesce(public.member_display_name(o.author_id), o.author_name),
        'mine', false,
        'can_change', false,
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
    ), '[]'::jsonb),
    'summaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'author_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'ratings', s.ratings, 'recommendation', s.recommendation,
        'strengths', s.strengths, 'priorities', s.priorities, 'comments', s.comments,
        'signed_at', s.signed_at
      ) order by s.signed_at)
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.signed_at is not null
    ), '[]'::jsonb),
    'unsigned', (
      select count(*)::int from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.signed_at is null
    ),
    'summary_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'author_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'kind', e.kind, 'late', e.late, 'by_name', e.by_name, 'at', e.at
      ) order by e.at)
      from public.assessment_summary_events e
      join public.assessment_summaries s on s.id = e.summary_id
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id
    ), '[]'::jsonb),
    'feedback', case
      when v_feedback.id is null then null
      when v_feedback.shared_at is null then jsonb_build_object('draft', true)
      else jsonb_build_object(
        'went_well', v_feedback.went_well, 'work_on', v_feedback.work_on,
        'author_name', coalesce(public.member_display_name(v_feedback.author_id), v_feedback.author_name),
        'shared_at', v_feedback.shared_at, 'seen_at', v_feedback.seen_at)
    end,
    'feedback_events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'by_name', e.by_name, 'at', e.at) order by e.at)
      from public.assessment_feedback_events e
      where e.feedback_id = v_feedback.id
    ), '[]'::jsonb),
    -- Part 5: what the head coach released, also when taken back.
    'release', case when v_release.id is null then null else jsonb_build_object(
      'parts', v_release.parts, 'released_at', v_release.released_at,
      'released_by_name', coalesce(public.member_display_name(v_release.released_by), v_release.released_by_name),
      'seen_at', v_release.seen_at) end,
    'release_events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'parts', e.parts, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at)
        order by e.at, e.id)
      from public.assessment_release_events e where e.release_id = v_release.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.auditor_athlete_assessment(uuid, uuid) from public, anon;
grant execute on function public.auditor_athlete_assessment(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Redefined: the register counts releases (from 20261127400000_selection_register.sql)
-- ---------------------------------------------------------------------------

create or replace function public.admin_selection_register(p_season integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season integer;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the selection register';
  end if;
  v_season := coalesce(p_season,
    (select max(t.season) from public.teams t where not t.archived),
    (select max(r.season) from public.selection_rounds r));

  return jsonb_build_object(
    'season', v_season,
    'today', public.club_today(),
    'seasons', (
      select coalesce(jsonb_agg(x.season order by x.season desc), '[]'::jsonb)
      from (
        select distinct r.season from public.selection_rounds r where r.season is not null
        union select v_season where v_season is not null
      ) x
    ),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'kind', t.kind, 'squad_id', t.squad_id,
        'athletes', (select count(*)::int from public.team_members m where m.team_id = t.id and m.team_role = 'athlete')
      ) order by t.sort_order, t.name)
      from public.teams t where t.season = v_season and not t.archived
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'team_id', r.team_id,
        'team_name', coalesce(t.name, r.team_name),
        'name', r.name,
        'phase', r.phase,
        'round_number', r.round_number,
        'starts_on', r.starts_on,
        'ends_on', r.ends_on,
        'last_day', public.selection_round_last_day(r.ends_on, r.closed_at),
        'closed_at', r.closed_at,
        'opened_at', r.created_at,
        'opened_by_name', r.created_by_name,
        'criteria_set_id', r.criteria_set_id,
        'criteria_set_name', coalesce(r.criteria_set_name,
          (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
        'criteria_set_version', r.criteria_set_version,
        'set_fits', (
          select case when s.id is null or g.id is null or s.archived_at is not null then null
            else s.for_all or exists (
              select 1 from public.assessment_criteria_set_groups x
              left join public.teams sq on sq.id = g.squad_id
              where x.set_id = s.id
                and (x.team_id in (g.id, g.squad_id)
                  or lower(x.team_name) in (lower(g.name), lower(sq.name)))
            ) end
          from (select 1) one
          left join public.assessment_criteria_sets s on s.id = r.criteria_set_id
          left join public.teams g on g.id = r.team_id
        ),
        'panel', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
            'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id)
          ) order by coalesce(public.member_display_name(m.profile_id), m.profile_name))
          from public.selection_round_panel m where m.round_id = r.id and m.removed_at is null
        ), '[]'::jsonb),
        'declared_conflicts', (
          select count(*)::int from public.selection_round_panel m
          where m.round_id = r.id and m.removed_at is null
            and exists (
              select 1 from public.conflict_declarations d
              where d.profile_id = m.profile_id and d.season = r.season and d.has_conflict
            )
        ),
        'auditors', coalesce((
          select jsonb_agg(coalesce(public.member_display_name(a.profile_id), a.profile_name)
            order by coalesce(public.member_display_name(a.profile_id), a.profile_name))
          from public.selection_round_auditors a where a.round_id = r.id and a.removed_at is null
        ), '[]'::jsonb),
        'athletes', (select count(*)::int from public.team_members m where m.team_id = r.team_id and m.team_role = 'athlete'),
        'observations', (select count(*)::int from public.assessment_observations o where o.round_id = r.id),
        'athletes_observed', (
          select count(*)::int from public.team_members m
          where m.team_id = r.team_id and m.team_role = 'athlete'
            and exists (select 1 from public.assessment_observations o where o.round_id = r.id and o.athlete_id = m.profile_id)
        ),
        'summaries_signed', (
          select count(*)::int from public.assessment_summaries s where s.round_id = r.id and s.signed_at is not null
        ),
        'summaries_expected', (
          select coalesce(sum((
            select count(*)::int from public.team_members a
            where a.team_id = r.team_id and a.team_role = 'athlete'
              and a.profile_id is distinct from p.profile_id
              and not exists (
                select 1 from public.guardianships g
                where g.guardian_id = p.profile_id and g.athlete_id = a.profile_id
              )
          )), 0)::int
          from public.selection_round_panel p
          where p.round_id = r.id and p.removed_at is null and p.profile_id is not null
        ),
        'feedback_shared', (
          select count(*)::int from public.assessment_feedback f where f.round_id = r.id and f.shared_at is not null
        ),
        'released', (
          select count(*)::int from public.assessment_releases x where x.round_id = r.id and x.released_at is not null
        ),
        'clashes', case when r.team_id is null then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object('round_name', c.round_name, 'starts_on', c.starts_on, 'last_day', c.last_day))
          from public.selection_round_clashes(r.team_id, r.starts_on,
            public.selection_round_last_day(r.ends_on, r.closed_at), r.id) c
        ), '[]'::jsonb) end
      ) order by coalesce(t.name, r.team_name), r.starts_on)
      from public.selection_rounds r
      left join public.teams t on t.id = r.team_id
      where r.season = v_season
    ), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'for_label', public.criteria_set_for_label(s.id),
        'version', s.version,
        'archived_at', s.archived_at,
        'rounds_season', (
          select count(*)::int from public.selection_rounds r
          where r.season = v_season
            and (r.criteria_set_id = s.id or (r.criteria_set_id is null and s.legacy))
        ),
        'rounds_ever', public.criteria_set_rounds(s.id)
      ) order by (s.archived_at is not null), s.name)
      from public.assessment_criteria_sets s
    ), '[]'::jsonb),
    'set_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'set_name', e.set_name, 'kind', e.kind, 'version', e.version, 'detail', e.detail,
        'by_name', e.by_name, 'at', e.at
      ) order by e.at desc, e.id)
      from public.assessment_criteria_set_events e
    ), '[]'::jsonb),
    'round_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round_id', e.round_id, 'kind', e.kind, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at
      ) order by e.at desc, e.id)
      from public.selection_round_events e
      join public.selection_rounds r on r.id = e.round_id
      where r.season = v_season and e.kind <> 'opened'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_register(integer) from public, anon;
grant execute on function public.admin_selection_register(integer) to authenticated;

commit;
