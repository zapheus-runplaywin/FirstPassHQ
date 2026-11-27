-- Selection rounds, part 6 (internal notes, 27 November 2026).
--
-- A selector can keep an internal note beside a criterion in their summary of
-- an athlete. Notes live in their own column, never inside ratings, so a
-- release (part 5) can't pick them up. The panel (others only once their own
-- is signed) and the round's auditors read them; admins get one count per
-- round; athletes and parents never. Nothing that feeds athletes, parents,
-- reports or the register selects the column.
--
-- save_assessment_summary gains a ninth parameter, so the eight-argument
-- version is dropped first (create or replace can't add one). An app that
-- hasn't updated still calls it by name without p_notes and keeps saved notes.

begin;

-- A selector's internal notes beside criteria: [{"item_key": "passing", "note": "…"}].
-- Read by the panel and the round's auditors only. Never released.
alter table public.assessment_summaries
  add column if not exists notes jsonb not null default '[]'::jsonb
  check (jsonb_typeof(notes) = 'array');

drop function if exists public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean);
create or replace function public.save_assessment_summary(
  p_round_id uuid,
  p_athlete_id uuid,
  p_ratings jsonb,
  p_recommendation text,
  p_strengths text,
  p_priorities text,
  p_comments text,
  p_sign boolean,
  p_notes jsonb default null
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
  v_notes jsonb := '[]'::jsonb;
  v_note_keys text[] := '{}';
  v_note text;
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

  if p_notes is not null then
    if jsonb_typeof(p_notes) <> 'array' then
      raise exception 'The internal notes must be a list';
    end if;
    for r in select * from jsonb_array_elements(p_notes) loop
      if jsonb_typeof(r) <> 'object' or not exists (
        select 1 from public.selection_round_items(p_round_id) i where i.item_key = r ->> 'item_key'
      ) then
        raise exception 'One of the criteria isn’t in this round';
      end if;
      if (r ->> 'item_key') = any (v_note_keys) then
        raise exception 'One of the criteria is there twice';
      end if;
      v_note_keys := v_note_keys || (r ->> 'item_key');
      v_note := trim(coalesce(r ->> 'note', ''));
      if length(v_note) > 500 then
        raise exception 'Keep each internal note to 500 characters';
      end if;
      if v_note <> '' then
        v_notes := v_notes || jsonb_build_object('item_key', r ->> 'item_key', 'note', v_note);
      end if;
    end loop;
  end if;

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
      recommendation, strengths, priorities, comments, signed_at, notes)
    values (p_round_id, p_athlete_id, auth.uid(), v_me, v_ratings, v_recommendation,
      trim(coalesce(p_strengths, '')), trim(coalesce(p_priorities, '')), trim(coalesce(p_comments, '')),
      case when coalesce(p_sign, false) then now() end, v_notes)
    returning id into v_id;
  else
    update public.assessment_summaries s
    set ratings = v_ratings,
        recommendation = v_recommendation,
        strengths = trim(coalesce(p_strengths, '')),
        priorities = trim(coalesce(p_priorities, '')),
        comments = trim(coalesce(p_comments, '')),
        notes = case when p_notes is null then s.notes else v_notes end,
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
revoke execute on function public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.save_assessment_summary(uuid, uuid, jsonb, text, text, text, text, boolean, jsonb) to authenticated;

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
      'notes', v_mine.notes,
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
        'notes', s.notes,
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
        'notes', s.notes,
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

create or replace function public.admin_selection_round_record(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_set public.assessment_criteria_sets;
  v_saved public.assessment_criteria_set_events;
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins and this round’s auditors can see the audit report';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if v_round.criteria_set_id is not null then
    select * into v_set from public.assessment_criteria_sets s where s.id = v_round.criteria_set_id;
    select * into v_saved from public.assessment_criteria_set_events e
    where e.set_id = v_round.criteria_set_id and e.version = v_round.criteria_set_version
      and e.kind in ('created', 'saved')
    order by e.at, e.id limit 1;
  end if;

  return jsonb_build_object(
    'criteria', jsonb_build_object(
      'set_name', coalesce(v_round.criteria_set_name,
        (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
      'version', v_round.criteria_set_version,
      'saved_at', v_saved.at,
      'saved_by_name', v_saved.by_name,
      'for_label', case when v_set.id is not null then public.criteria_set_for_label(v_set.id) end,
      'groups', jsonb_array_length(coalesce(v_round.criteria -> 'groups', '[]'::jsonb)),
      'items', public.criteria_item_count(v_round.criteria),
      'recommendations', jsonb_array_length(coalesce(v_round.criteria -> 'recommendations', '[]'::jsonb)),
      'set_state', case
        when v_round.criteria_set_id is null then 'legacy'
        when v_set.id is null then 'deleted'
        when v_set.archived_at is not null then 'archived'
        when v_set.version > coalesce(v_round.criteria_set_version, 0) then 'changed'
        else 'same'
      end,
      'set_version', v_set.version
    ),
    'internal_notes', (
      select jsonb_build_object(
        'notes', coalesce(sum(jsonb_array_length(s.notes)), 0)::int,
        'selectors', (count(distinct s.author_id) filter (where jsonb_array_length(s.notes) > 0))::int,
        'athletes', (count(distinct s.athlete_id) filter (where jsonb_array_length(s.notes) > 0))::int)
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.signed_at is not null
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at)
        order by e.at, e.id)
      from public.selection_round_events e where e.round_id = p_round_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_round_record(uuid) from public, anon;
grant execute on function public.admin_selection_round_record(uuid) to authenticated;

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
    'notes_count', case when v_leads and v_mine.signed_at is not null
      then jsonb_array_length(v_mine.notes) else 0 end,
    'release', case when v_release.id is null then null else jsonb_build_object(
      'parts', v_release.parts, 'released_at', v_release.released_at,
      'released_by_name', coalesce(public.member_display_name(v_release.released_by), v_release.released_by_name),
      'seen_at', v_release.seen_at) end
  );
end;
$$;
revoke execute on function public.athlete_release(uuid, uuid) from public, anon;
grant execute on function public.athlete_release(uuid, uuid) to authenticated;

commit;
