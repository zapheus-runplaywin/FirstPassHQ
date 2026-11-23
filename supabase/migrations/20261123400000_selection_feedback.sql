-- Selection assessments, phase 4 (Matt, 23 November 2026): feedback the head
-- coach chooses to share with an athlete, and the record of when it was
-- shared and first read.
--
-- The head coach of a round's squad or team writes feedback for an athlete:
-- what went well, and what to work on. It is a draft only they see until
-- they share it. Shared feedback is read by the athlete and, for an athlete
-- under 18, their verified parents and guardians at the same time, under
-- Selection, and by the round's panel. Nobody can answer it in the app. The
-- head coach can take shared feedback back to change it; every sharing and
-- taking back is kept, and so is the first time the athlete or a parent
-- read it.
--
-- Admins still read no assessment: they see for whom feedback was shared,
-- when, by whom and whether it has been read, never the words.
--
-- Additive: two new tables and new functions. Nothing existing is changed
-- or removed.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.assessment_feedback (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  went_well text not null default '',
  work_on text not null default '',
  -- Null while it is a draft, or after it was taken back.
  shared_at timestamptz,
  -- The first time the athlete or one of their verified guardians read it
  -- since it was last shared.
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_feedback_lengths check (length(went_well) <= 1000 and length(work_on) <= 1000)
);
create unique index if not exists assessment_feedback_one_each on public.assessment_feedback (round_id, athlete_id);
create index if not exists assessment_feedback_athlete_idx on public.assessment_feedback (athlete_id);

-- Every sharing and taking back, kept for the audit.
create table if not exists public.assessment_feedback_events (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.assessment_feedback (id) on delete cascade,
  kind text not null check (kind in ('shared', 'withdrawn')),
  by_id uuid references public.profiles (id) on delete set null,
  by_name text not null,
  at timestamptz not null default now()
);
create index if not exists assessment_feedback_events_feedback_idx on public.assessment_feedback_events (feedback_id);

alter table public.assessment_feedback enable row level security;
alter table public.assessment_feedback_events enable row level security;
-- Reached only through the functions below.
revoke all on public.assessment_feedback from public, anon, authenticated;
revoke all on public.assessment_feedback_events from public, anon, authenticated;
grant all on public.assessment_feedback to service_role;
grant all on public.assessment_feedback_events to service_role;

-- ---------------------------------------------------------------------------
-- The panel: reading, writing, sharing and taking back
-- ---------------------------------------------------------------------------

-- An athlete's feedback in a round, for a panel member who can assess them.
-- The head coach sees their draft; the rest of the panel sees feedback only
-- once it is shared. Opening an under 18's goes in their record views.
create or replace function public.athlete_feedback(p_round_id uuid, p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_feedback public.assessment_feedback;
  v_leads boolean;
begin
  if not public.can_assess_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  v_leads := public.leads_selection_round(p_round_id);
  select * into v_feedback from public.assessment_feedback f
  where f.round_id = p_round_id and f.athlete_id = p_athlete_id
    and (v_leads or f.shared_at is not null);

  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_name', v_round.name,
    'closed', v_round.closed_at is not null,
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    -- So the head coach is told who will read it: an under 18's verified
    -- parents and guardians too.
    'is_minor', public.athlete_is_minor(p_athlete_id),
    -- Only the head coach writes, shares and takes back, while the round is open.
    'can_write', v_leads and v_round.closed_at is null,
    'feedback', case when v_feedback.id is null then null else jsonb_build_object(
      'went_well', v_feedback.went_well,
      'work_on', v_feedback.work_on,
      'author_name', coalesce(public.member_display_name(v_feedback.author_id), v_feedback.author_name),
      'shared_at', v_feedback.shared_at,
      'seen_at', v_feedback.seen_at,
      'updated_at', v_feedback.updated_at
    ) end
  );
end;
$$;
revoke execute on function public.athlete_feedback(uuid, uuid) from public, anon;
grant execute on function public.athlete_feedback(uuid, uuid) to authenticated;

-- The head coach saves feedback for an athlete as a draft, or shares it
-- (p_share) with the athlete and their verified guardians. Shared feedback
-- can't be changed until it is taken back. Returns the feedback's id.
create or replace function public.save_assessment_feedback(
  p_round_id uuid,
  p_athlete_id uuid,
  p_went_well text,
  p_work_on text,
  p_share boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_feedback public.assessment_feedback;
  v_went_well text := trim(coalesce(p_went_well, ''));
  v_work_on text := trim(coalesce(p_work_on, ''));
  v_id uuid;
begin
  if not (public.leads_selection_round(p_round_id) and public.can_assess_athlete(p_round_id, p_athlete_id)) then
    raise exception 'Only the head coach can write feedback for this athlete';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  if length(v_went_well) > 1000 or length(v_work_on) > 1000 then
    raise exception 'Keep each box to 1000 characters';
  end if;
  if coalesce(p_share, false) and v_went_well = '' and v_work_on = '' then
    raise exception 'Write some feedback before you share it';
  end if;
  select * into v_feedback from public.assessment_feedback f
  where f.round_id = p_round_id and f.athlete_id = p_athlete_id;
  if v_feedback.shared_at is not null then
    raise exception 'This feedback is shared. Take it back to change it.';
  end if;

  if v_feedback.id is null then
    insert into public.assessment_feedback (round_id, athlete_id, author_id, author_name, went_well, work_on, shared_at)
    values (p_round_id, p_athlete_id, auth.uid(), public.member_display_name(auth.uid()), v_went_well, v_work_on,
      case when coalesce(p_share, false) then now() end)
    returning id into v_id;
  else
    update public.assessment_feedback f
    set went_well = v_went_well, work_on = v_work_on,
        author_id = auth.uid(), author_name = public.member_display_name(auth.uid()),
        shared_at = case when coalesce(p_share, false) then now() end,
        seen_at = null, updated_at = now()
    where f.id = v_feedback.id
    returning f.id into v_id;
  end if;
  if coalesce(p_share, false) then
    insert into public.assessment_feedback_events (feedback_id, kind, by_id, by_name)
    values (v_id, 'shared', auth.uid(), public.member_display_name(auth.uid()));
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_assessment_feedback(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.save_assessment_feedback(uuid, uuid, text, text, boolean) to authenticated;

-- The head coach takes shared feedback back, so the athlete and their
-- guardians no longer see it and it can be changed and shared again.
create or replace function public.withdraw_assessment_feedback(p_round_id uuid, p_athlete_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_feedback public.assessment_feedback;
begin
  if not (public.leads_selection_round(p_round_id) and public.can_assess_athlete(p_round_id, p_athlete_id)) then
    raise exception 'Only the head coach can take feedback back';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  select * into v_feedback from public.assessment_feedback f
  where f.round_id = p_round_id and f.athlete_id = p_athlete_id;
  if v_feedback.shared_at is null then
    raise exception 'This feedback isn’t shared';
  end if;
  update public.assessment_feedback f set shared_at = null, seen_at = null, updated_at = now()
  where f.id = v_feedback.id;
  insert into public.assessment_feedback_events (feedback_id, kind, by_id, by_name)
  values (v_feedback.id, 'withdrawn', auth.uid(), public.member_display_name(auth.uid()));
end;
$$;
revoke execute on function public.withdraw_assessment_feedback(uuid, uuid) from public, anon;
grant execute on function public.withdraw_assessment_feedback(uuid, uuid) to authenticated;

-- For a round's list: where each athlete's feedback stands. A draft shows
-- only to the head coach. No words.
create or replace function public.selection_round_feedback(p_round_id uuid)
returns table (athlete_id uuid, state text, seen boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_leads boolean := public.leads_selection_round(p_round_id);
begin
  if not public.on_selection_panel(p_round_id) then
    raise exception 'You are not on this round’s panel';
  end if;
  return query
  select f.athlete_id,
    case when f.shared_at is not null then 'shared' else 'draft' end,
    f.seen_at is not null
  from public.assessment_feedback f
  where f.round_id = p_round_id
    and public.can_assess_athlete(p_round_id, f.athlete_id)
    and (f.shared_at is not null or v_leads);
end;
$$;
revoke execute on function public.selection_round_feedback(uuid) from public, anon;
grant execute on function public.selection_round_feedback(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Athletes and their parents: reading shared feedback
-- ---------------------------------------------------------------------------

-- Feedback shared with the signed-in athlete, or with a child the signed-in
-- member is a verified guardian of, in open and closed rounds. Never a
-- draft, and nothing else a selector wrote.
create or replace function public.my_selection_feedback()
returns table (
  round_id uuid,
  round_name text,
  team_name text,
  athlete_id uuid,
  athlete_name text,
  is_me boolean,
  went_well text,
  work_on text,
  shared_on date,
  from_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, coalesce(t.name, r.team_name), f.athlete_id,
    public.member_display_name(f.athlete_id), f.athlete_id = auth.uid(),
    f.went_well, f.work_on, public.club_day(f.shared_at),
    coalesce(public.member_display_name(f.author_id), f.author_name)
  from public.assessment_feedback f
  join public.selection_rounds r on r.id = f.round_id
  left join public.teams t on t.id = r.team_id
  where f.shared_at is not null
    and public.is_approved()
    and public.selection_assessments_on()
    and (f.athlete_id = auth.uid() or public.is_verified_guardian_of(f.athlete_id))
  order by (f.athlete_id <> auth.uid()), 5, f.shared_at desc;
$$;
revoke execute on function public.my_selection_feedback() from public, anon;
grant execute on function public.my_selection_feedback() to authenticated;

-- Records the first time the athlete, or a verified guardian of theirs,
-- read feedback shared with them. Anyone else changes nothing.
create or replace function public.mark_selection_feedback_seen(p_round_id uuid, p_athlete_id uuid)
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
  update public.assessment_feedback f set seen_at = now()
  where f.round_id = p_round_id and f.athlete_id = p_athlete_id
    and f.shared_at is not null and f.seen_at is null;
end;
$$;
revoke execute on function public.mark_selection_feedback_seen(uuid, uuid) from public, anon;
grant execute on function public.mark_selection_feedback_seen(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admins: the record of who was given feedback and when
-- ---------------------------------------------------------------------------

-- For the audit: how many athletes are in the round, and for each athlete
-- whose feedback was ever shared, when it was last shared and by whom,
-- when it was first read, and how many times it was taken back. No words.
-- Building it for a round with under 18s is recorded.
create or replace function public.admin_selection_feedback(p_round_id uuid)
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
    raise exception 'Only admins can see the feedback record';
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
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object(
        'athlete_name', public.member_display_name(f.athlete_id),
        'shared_at', f.shared_at,
        'shared_by_name', (
          select e.by_name from public.assessment_feedback_events e
          where e.feedback_id = f.id and e.kind = 'shared' order by e.at desc, e.id desc limit 1
        ),
        'seen_at', f.seen_at,
        'withdrawn', (
          select count(*)::int from public.assessment_feedback_events e
          where e.feedback_id = f.id and e.kind = 'withdrawn'
        )
      ) order by public.member_display_name(f.athlete_id))
      from public.assessment_feedback f
      where f.round_id = p_round_id
        and exists (select 1 from public.assessment_feedback_events e where e.feedback_id = f.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_feedback(uuid) from public, anon;
grant execute on function public.admin_selection_feedback(uuid) to authenticated;

commit;
