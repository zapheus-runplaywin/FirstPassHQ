-- Selection assessments, phase 3 (Matt, 23 November 2026): each selector's
-- signed summary of an athlete, and the panel's view of them side by side.
--
-- A summary is one selector's overall view of one athlete in a round: a step
-- for each of the criteria they choose to rate, a recommendation from the
-- club's list, key strengths, development priorities and comments. Signing
-- locks it. A selector sees the other selectors' summaries of an athlete only
-- once they have signed their own, so each view is independent. The group's
-- head coach or an admin can reopen a signed summary, and every signing and
-- reopening is kept.
--
-- Admins still read no assessment: they see who has signed for whom and
-- when, and reopen by name, never what a summary says.
--
-- Additive: two new tables, an optional list of recommendations in the
-- criteria, and new functions. Nothing existing is changed or removed.

begin;

-- ---------------------------------------------------------------------------
-- The criteria gain an optional list of recommendations
-- ---------------------------------------------------------------------------

-- As in 20261123100000_selection_assessments.sql, plus "recommendations".
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
  v_recommendations jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_choice text;
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

  -- The recommendations a selector chooses from when signing a summary:
  -- none, or 2 to 8 short choices, each different.
  if p_criteria ? 'recommendations' and jsonb_typeof(p_criteria -> 'recommendations') <> 'null' then
    if jsonb_typeof(p_criteria -> 'recommendations') <> 'array' then
      raise exception 'The recommendations must be a list';
    end if;
    for s in select * from jsonb_array_elements(p_criteria -> 'recommendations') loop
      v_choice := trim(coalesce(s #>> '{}', ''));
      if jsonb_typeof(s) <> 'string' or length(v_choice) not between 1 and 40 then
        raise exception 'Name each recommendation, in up to 40 characters';
      end if;
      if lower(v_choice) = any (v_seen) then
        raise exception 'Two recommendations are the same';
      end if;
      v_seen := v_seen || lower(v_choice);
      v_recommendations := v_recommendations || to_jsonb(v_choice);
    end loop;
    if jsonb_array_length(v_recommendations) = 1 or jsonb_array_length(v_recommendations) > 8 then
      raise exception 'Give between 2 and 8 recommendations, or none';
    end if;
  end if;

  return jsonb_build_object('groups', v_groups, 'recommendations', v_recommendations);
end;
$$;
revoke execute on function public.check_assessment_criteria(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.assessment_summaries (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  -- [{"item_key": "passing", "rating": 2}], steps 1 to 3.
  ratings jsonb not null default '[]'::jsonb,
  recommendation text,
  strengths text not null default '',
  priorities text not null default '',
  comments text not null default '',
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_summaries_lengths check (
    length(strengths) <= 1000 and length(priorities) <= 1000 and length(comments) <= 1000
  )
);
create unique index if not exists assessment_summaries_one_each
  on public.assessment_summaries (round_id, athlete_id, author_id);
create index if not exists assessment_summaries_athlete_idx on public.assessment_summaries (athlete_id);

-- Every signing and reopening, kept for the audit.
create table if not exists public.assessment_summary_events (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.assessment_summaries (id) on delete cascade,
  kind text not null check (kind in ('signed', 'reopened')),
  -- For 'signed': after the round's last day.
  late boolean not null default false,
  by_id uuid references public.profiles (id) on delete set null,
  by_name text not null,
  at timestamptz not null default now()
);
create index if not exists assessment_summary_events_summary_idx on public.assessment_summary_events (summary_id);

alter table public.assessment_summaries enable row level security;
alter table public.assessment_summary_events enable row level security;
-- Reached only through the functions below.
revoke all on public.assessment_summaries from public, anon, authenticated;
revoke all on public.assessment_summary_events from public, anon, authenticated;
grant all on public.assessment_summaries to service_role;
grant all on public.assessment_summary_events to service_role;

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- Whether the signed-in member is the head coach of the round's squad or
-- team and on its panel: the one selector who can reopen a signed summary.
create or replace function public.leads_selection_round(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.on_selection_panel(p_round_id)
    and exists (
      select 1
      from public.selection_rounds r
      join public.team_members m on m.team_id = r.team_id
      where r.id = p_round_id and m.profile_id = auth.uid()
        and m.team_role = 'coach' and m.coach_title = 'head_coach'
    );
$$;
revoke execute on function public.leads_selection_round(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The panel: reading, saving and signing a summary
-- ---------------------------------------------------------------------------

-- The signed-in selector's summary of an athlete, with what the app fills in
-- to start (their own latest step for each item), how many observations they
-- wrote and where, and, only once their own is signed, the other selectors'
-- signed summaries. Opening an under 18's goes in their record views.
create or replace function public.my_assessment_summary(p_round_id uuid, p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_mine public.assessment_summaries;
  v_signed boolean;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  select * into v_mine from public.assessment_summaries s
  where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.author_id = auth.uid();
  v_signed := v_mine.signed_at is not null;

  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_name', v_round.name,
    'team_name', v_round.team_name,
    'closed', v_round.closed_at is not null,
    'starts_on', v_round.starts_on,
    'ends_on', v_round.ends_on,
    'criteria', v_round.criteria,
    'today', public.club_today(),
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'my_name', public.member_display_name(auth.uid()),
    'mine', case when v_mine.id is null then null else jsonb_build_object(
      'id', v_mine.id,
      'ratings', v_mine.ratings,
      'recommendation', v_mine.recommendation,
      'strengths', v_mine.strengths,
      'priorities', v_mine.priorities,
      'comments', v_mine.comments,
      'signed_at', v_mine.signed_at,
      'updated_at', v_mine.updated_at
    ) end,
    -- The selector's own latest step for each item they have rated.
    'prefill', coalesce((
      select jsonb_agg(jsonb_build_object('item_key', l.item_key, 'rating', l.rating) order by l.item_key)
      from (
        select distinct on (ra.item_key) ra.item_key, ra.rating
        from public.assessment_observations o
        join public.assessment_observation_ratings ra on ra.observation_id = o.id
        where o.round_id = p_round_id and o.athlete_id = p_athlete_id
          and o.author_id = auth.uid() and ra.rating is not null
        order by ra.item_key, o.observed_on desc, o.created_at desc
      ) l
    ), '[]'::jsonb),
    'my_observations', (
      select jsonb_build_object(
        'total', count(*)::int,
        'training', (count(*) filter (where o.context = 'training'))::int,
        'game', (count(*) filter (where o.context = 'game'))::int,
        'trial', (count(*) filter (where o.context = 'trial'))::int,
        'other', (count(*) filter (where o.context = 'other'))::int
      )
      from public.assessment_observations o
      where o.round_id = p_round_id and o.athlete_id = p_athlete_id and o.author_id = auth.uid()
    ),
    'last_reopened', (
      select jsonb_build_object('by_name', e.by_name, 'at', e.at)
      from public.assessment_summary_events e
      where e.summary_id = v_mine.id and e.kind = 'reopened'
      order by e.at desc limit 1
    ),
    'can_reopen', public.leads_selection_round(p_round_id) and v_round.closed_at is null,
    'others_signed', (
      select count(*)::int from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id
        and s.author_id is distinct from auth.uid() and s.signed_at is not null
    ),
    -- Hidden until the selector has signed their own, so each view is independent.
    'others', case when not v_signed then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'author_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'ratings', s.ratings,
        'recommendation', s.recommendation,
        'strengths', s.strengths,
        'priorities', s.priorities,
        'comments', s.comments,
        'signed_at', s.signed_at
      ) order by s.signed_at)
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id
        and s.author_id is distinct from auth.uid() and s.signed_at is not null
    ), '[]'::jsonb) end
  );
end;
$$;
revoke execute on function public.my_assessment_summary(uuid, uuid) from public, anon;
grant execute on function public.my_assessment_summary(uuid, uuid) to authenticated;

-- A selector saves their summary of an athlete as a draft, or signs it
-- (p_sign), which locks it. p_ratings is [{"item_key": "passing", "rating": 2}].
-- Signing needs at least one step, and a recommendation when the round's
-- criteria list any. Returns the summary's id.
create or replace function public.save_assessment_summary(
  p_round_id uuid,
  p_athlete_id uuid,
  p_ratings jsonb,
  p_recommendation text,
  p_strengths text,
  p_priorities text,
  p_comments text,
  p_sign boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_mine public.assessment_summaries;
  v_ratings jsonb := '[]'::jsonb;
  v_keys text[] := '{}';
  v_recommendation text := nullif(trim(coalesce(p_recommendation, '')), '');
  v_choices jsonb;
  v_me text := public.member_display_name(auth.uid());
  v_id uuid;
  r jsonb;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t assess this athlete';
  end if;
  select * into v_round from public.selection_rounds x where x.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed, so nothing more can be added';
  end if;
  select * into v_mine from public.assessment_summaries s
  where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.author_id = auth.uid();
  if v_mine.signed_at is not null then
    raise exception 'This summary is signed. The head coach or an admin can reopen it.';
  end if;

  if p_ratings is not null and jsonb_typeof(p_ratings) <> 'array' then
    raise exception 'The steps must be a list';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
    if not exists (
      select 1 from public.selection_round_items(p_round_id) i where i.item_key = r ->> 'item_key'
    ) then
      raise exception 'One of the criteria isn’t in this round';
    end if;
    if (r ->> 'item_key') = any (v_keys) then
      raise exception 'One of the criteria is there twice';
    end if;
    if jsonb_typeof(r -> 'rating') is distinct from 'number' or (r ->> 'rating') not in ('1', '2', '3') then
      raise exception 'Choose one of the three steps for each of the criteria';
    end if;
    v_keys := v_keys || (r ->> 'item_key');
    v_ratings := v_ratings || jsonb_build_object('item_key', r ->> 'item_key', 'rating', (r ->> 'rating')::int);
  end loop;

  v_choices := coalesce(v_round.criteria -> 'recommendations', '[]'::jsonb);
  if v_recommendation is not null and not v_choices ? v_recommendation then
    raise exception 'Choose one of the round’s recommendations';
  end if;
  if length(coalesce(p_strengths, '')) > 1000 or length(coalesce(p_priorities, '')) > 1000
     or length(coalesce(p_comments, '')) > 1000 then
    raise exception 'Keep each box to 1,000 characters';
  end if;
  if coalesce(p_sign, false) then
    if jsonb_array_length(v_ratings) = 0 then
      raise exception 'Choose a step for at least one of the criteria before you sign';
    end if;
    if jsonb_array_length(v_choices) > 0 and v_recommendation is null then
      raise exception 'Choose a recommendation before you sign';
    end if;
  end if;

  if v_mine.id is null then
    insert into public.assessment_summaries (round_id, athlete_id, author_id, author_name, ratings,
      recommendation, strengths, priorities, comments, signed_at)
    values (p_round_id, p_athlete_id, auth.uid(), v_me, v_ratings, v_recommendation,
      trim(coalesce(p_strengths, '')), trim(coalesce(p_priorities, '')), trim(coalesce(p_comments, '')),
      case when coalesce(p_sign, false) then now() end)
    returning id into v_id;
  else
    update public.assessment_summaries s
    set ratings = v_ratings,
        recommendation = v_recommendation,
        strengths = trim(coalesce(p_strengths, '')),
        priorities = trim(coalesce(p_priorities, '')),
        comments = trim(coalesce(p_comments, '')),
        author_name = v_me,
        signed_at = case when coalesce(p_sign, false) then now() end,
        updated_at = now()
    where s.id = v_mine.id;
    v_id := v_mine.id;
  end if;

  if coalesce(p_sign, false) then
    insert into public.assessment_summary_events (summary_id, kind, late, by_id, by_name)
    values (v_id, 'signed', public.club_today() > v_round.ends_on, auth.uid(), v_me);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean) to authenticated;

-- Reopens a signed summary so its selector can change and sign it again:
-- the head coach of the round's squad or team (for an athlete they can
-- assess), or an admin. Kept with who did it and when.
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
end;
$$;
revoke execute on function public.reopen_assessment_summary(uuid) from public, anon;
grant execute on function public.reopen_assessment_summary(uuid) to authenticated;

-- For a round's list: where the signed-in selector's own summary of each
-- athlete stands, and how many selectors have signed one. Counts only.
create or replace function public.selection_round_summaries(p_round_id uuid)
returns table (athlete_id uuid, mine text, signed integer)
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
  select a.profile_id,
    coalesce((
      select case when s.signed_at is not null then 'signed' else 'draft' end
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = a.profile_id and s.author_id = auth.uid()
    ), 'none'),
    (select count(*)::int from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = a.profile_id and s.signed_at is not null)
  from public.selection_rounds r
  join public.team_members a on a.team_id = r.team_id and a.team_role = 'athlete'
  where r.id = p_round_id and public.can_assess_athlete(p_round_id, a.profile_id);
end;
$$;
revoke execute on function public.selection_round_summaries(uuid) from public, anon;
grant execute on function public.selection_round_summaries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admins: who has signed, and reopening, never what a summary says
-- ---------------------------------------------------------------------------

-- For the audit and for reopening: each selector's count of summaries
-- signed, signed late and still to sign; every signed summary by selector
-- and athlete with its date; and every reopening. No rating, recommendation
-- or word of a summary. Building it for a round with under 18s is recorded.
create or replace function public.admin_selection_summaries(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_child uuid;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see who has signed';
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
    'ends_on', v_round.ends_on,
    'closed', v_round.closed_at is not null,
    'selectors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', n.name,
        'on_panel', n.on_panel,
        -- Athletes in the round who aren't the selector or their own child.
        'athletes', (
          select count(*)::int from public.team_members a
          where a.team_id = v_round.team_id and a.team_role = 'athlete'
            and a.profile_id is distinct from n.profile_id
            and not exists (
              select 1 from public.guardianships g
              where g.guardian_id = n.profile_id and g.athlete_id = a.profile_id
            )
        ),
        'signed', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.author_id = n.profile_id and s.signed_at is not null
        ),
        'signed_late', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.author_id = n.profile_id and s.signed_at is not null
            and coalesce((select e.late from public.assessment_summary_events e
              where e.summary_id = s.id and e.kind = 'signed' order by e.at desc, e.id desc limit 1), false)
        ),
        'drafts', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.author_id = n.profile_id and s.signed_at is null
        ),
        'reopened', (
          select count(*)::int from public.assessment_summary_events e
          join public.assessment_summaries s on s.id = e.summary_id
          where s.round_id = p_round_id and s.author_id = n.profile_id and e.kind = 'reopened'
        )
      ) order by n.on_panel desc, n.name)
      from (
        select m.profile_id, coalesce(public.member_display_name(m.profile_id), m.profile_name) as name,
          true as on_panel
        from public.selection_round_panel m
        where m.round_id = p_round_id and m.removed_at is null and m.profile_id is not null
        union
        select s.author_id, coalesce(public.member_display_name(s.author_id), s.author_name), false
        from public.assessment_summaries s
        where s.round_id = p_round_id and s.author_id is not null
          and not exists (
            select 1 from public.selection_round_panel m
            where m.round_id = p_round_id and m.removed_at is null and m.profile_id = s.author_id
          )
      ) n
    ), '[]'::jsonb),
    'signed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'selector_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'athlete_name', public.member_display_name(s.athlete_id),
        'signed_at', s.signed_at,
        'late', coalesce((select e.late from public.assessment_summary_events e
              where e.summary_id = s.id and e.kind = 'signed' order by e.at desc, e.id desc limit 1), false)
      ) order by coalesce(public.member_display_name(s.author_id), s.author_name), public.member_display_name(s.athlete_id))
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.signed_at is not null
    ), '[]'::jsonb),
    'reopenings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'selector_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'athlete_name', public.member_display_name(s.athlete_id),
        'by_name', e.by_name,
        'at', e.at
      ) order by e.at)
      from public.assessment_summary_events e
      join public.assessment_summaries s on s.id = e.summary_id
      where s.round_id = p_round_id and e.kind = 'reopened'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_summaries(uuid) from public, anon;
grant execute on function public.admin_selection_summaries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- To-dos: summaries still to sign
-- ---------------------------------------------------------------------------

-- As in 20261123200000_selection_dates.sql, plus:
--   'summaries': from 7 days before a round's last day until it is closed,
--     how many athletes the member can assess whose summary they haven't
--     signed.
create or replace function public.my_selection_todos()
returns table (
  kind text,
  round_id uuid,
  round_name text,
  milestone_id uuid,
  title text,
  due_on date,
  athletes integer,
  for_admin boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with rounds as (
    select r.id, r.name, r.starts_on, r.ends_on, r.team_id,
      public.on_selection_panel(r.id) as on_panel,
      (public.is_admin() and public.selection_assessments_on()) as is_admin
    from public.selection_rounds r
    where r.closed_at is null
  )
  select 'date', r.id, r.name, m.id, m.title, m.due_on, null::int, not r.on_panel
  from rounds r
  join public.selection_round_milestones m on m.round_id = r.id
  where (r.on_panel or r.is_admin)
    and m.removed_at is null and m.done_at is null
    and m.due_on <= public.club_today() + 7
  union all
  select 'thin', r.id, r.name, null::uuid, null::text, r.ends_on, t.athletes, false
  from rounds r
  cross join lateral (
    select count(*)::int as athletes
    from public.team_members a
    where a.team_id = r.team_id and a.team_role = 'athlete'
      and public.can_assess_athlete(r.id, a.profile_id)
      and not exists (
        select 1 from public.assessment_observations o
        where o.round_id = r.id and o.athlete_id = a.profile_id
      )
  ) t
  where r.on_panel
    and public.club_today() between greatest(r.starts_on, r.ends_on - 14) and r.ends_on
    and t.athletes > 0
  union all
  select 'summaries', r.id, r.name, null::uuid, null::text, r.ends_on, u.athletes, false
  from rounds r
  cross join lateral (
    select count(*)::int as athletes
    from public.team_members a
    where a.team_id = r.team_id and a.team_role = 'athlete'
      and public.can_assess_athlete(r.id, a.profile_id)
      and not exists (
        select 1 from public.assessment_summaries s
        where s.round_id = r.id and s.athlete_id = a.profile_id
          and s.author_id = auth.uid() and s.signed_at is not null
      )
  ) u
  where r.on_panel
    and public.club_today() >= r.ends_on - 7
    and u.athletes > 0
  order by 6, 3;
$$;
revoke execute on function public.my_selection_todos() from public, anon;
grant execute on function public.my_selection_todos() to authenticated;

commit;
