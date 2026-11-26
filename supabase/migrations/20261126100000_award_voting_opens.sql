-- Awards get an optional voting period (Matt, 26 November 2026: "Awards
-- should have an optional voting period. Admin can set a start and end date.
-- At the moment they can only set the end date which is closes.").
--
-- awards.opens_at is when voting opens. Empty (every award saved before this)
-- means voting is open as soon as the award is saved, exactly as before.
-- Before it opens:
--   * award_slots() offers no vote, so the award isn't on Today, the Awards
--     screen or the to-do list, and no "Vote for ..." push goes out until it
--     opens;
--   * save_award_ballot() refuses a ballot, whichever app version sends it;
--   * for a match award, only matches that start once voting has opened get
--     a vote, and the preseason vote opens with it too;
--   * award_turnout() leaves out matches that started before it opened.
--
-- The opening time is set by a new function, admin_set_award_opens, called
-- after admin_save_award the way admin_set_award_ages is, so admin_save_award
-- and its callers in older app versions are unchanged. It must be before the
-- award closes (and before the preseason vote closes), and it can't change
-- once anyone has voted.
--
-- Additive only: one new nullable column, one new function, three functions
-- replaced with the same signatures (save_award_ballot and award_slots from
-- 20261008010000_fixtures_and_awards.sql and 20261008030000_award_slots_need_nominees.sql,
-- award_turnout from 20261023190000_committee_reports.sql). No rows change.

begin;

alter table public.awards add column if not exists opens_at timestamptz;

comment on column public.awards.opens_at is
  'When voting opens. Null: open as soon as the award is saved.';

-- Sets or clears when voting opens on an award, for admins.
create or replace function public.admin_set_award_opens(p_award_id uuid, p_opens_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.awards;
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage awards';
  end if;
  select * into v_award from public.awards where id = p_award_id for update;
  if not found then
    raise exception 'That award no longer exists';
  end if;
  if v_award.opens_at is not distinct from p_opens_at then
    return;
  end if;
  if exists (select 1 from public.award_ballots b where b.award_id = p_award_id) then
    raise exception 'People have voted, so the day voting opens can''t change';
  end if;
  if p_opens_at is not null and p_opens_at >= v_award.closes_at then
    raise exception 'Voting must open before it closes';
  end if;
  if p_opens_at is not null and v_award.by_match and v_award.preseason_weight > 0
    and p_opens_at >= v_award.preseason_closes_at then
    raise exception 'Voting must open before the preseason vote closes';
  end if;

  update public.awards set opens_at = p_opens_at where id = p_award_id;
end;
$$;
revoke execute on function public.admin_set_award_opens(uuid, timestamptz) from public, anon;
grant execute on function public.admin_set_award_opens(uuid, timestamptz) to authenticated;

-- As before, leaving out awards that haven't opened yet, and matches that
-- started before the award opened.
create or replace function public.award_slots()
returns table (
  award_id uuid,
  award_name text,
  description text,
  points smallint[],
  nominees text,
  team_id uuid,
  team_name text,
  fixture_id uuid,
  fixture_label text,
  preseason boolean,
  closes_at timestamptz,
  voted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with groups as (
    -- (award, group) pairs the member votes in. The group is null when the
    -- award has one winner.
    select a.*, g.team_id as group_id
    from public.awards a
    cross join lateral (
      select g.team_id from public.award_groups g where a.per_group and g.award_id = a.id
      union all
      select null::uuid where not a.per_group
    ) g
    where public.is_approved()
      and (a.opens_at is null or now() >= a.opens_at)
      and now() < a.closes_at
      and auth.uid() in (select public.award_voters(a.id, g.team_id))
  ),
  slots as (
    select g.id, g.name, g.description, g.points, g.nominees, g.group_id,
      null::uuid as fixture_id, null::text as fixture_label, false as preseason, g.closes_at
    from groups g
    where not g.by_match
    union all
    select g.id, g.name, g.description, g.points, g.nominees, g.group_id,
      null, null, true, g.preseason_closes_at
    from groups g
    where g.by_match and g.preseason_weight > 0 and now() < g.preseason_closes_at
    union all
    select g.id, g.name, g.description, g.points, g.nominees, g.group_id,
      f.id, public.fixture_label(f), false,
      least(g.closes_at, f.starts_at + make_interval(hours => g.match_vote_hours))
    from groups g
    join public.fixtures f on f.team_id = g.group_id
    where g.by_match
      and f.opponent is not null
      and coalesce(f.status, '') !~* 'cancel|abandon|forfeit'
      and (g.opens_at is null or f.starts_at >= g.opens_at)
      and now() >= f.starts_at
      and now() < f.starts_at + make_interval(hours => g.match_vote_hours)
  )
  select
    s.id, s.name, s.description, s.points, s.nominees::text, s.group_id, t.name,
    s.fixture_id, s.fixture_label, s.preseason, s.closes_at,
    exists (
      select 1 from public.award_ballots b
      where b.award_id = s.id and b.voter_id = auth.uid()
        and b.team_id is not distinct from s.group_id
        and b.fixture_id is not distinct from s.fixture_id
        and b.preseason = s.preseason
    )
  from slots s
  left join public.teams t on t.id = s.group_id
  -- A vote with nobody to vote for (an empty team, or a coach who is their
  -- team's only coach) can't be cast, so it isn't offered.
  where exists (select 1 from public.award_nominee_rows(s.id, s.group_id))
  order by s.closes_at, s.name, t.sort_order;
$$;

revoke execute on function public.award_slots() from public, anon;
grant execute on function public.award_slots() to authenticated;

-- As before, refusing a ballot before voting opens, and for a match that
-- started before it opened.
create or replace function public.save_award_ballot(
  p_award_id uuid,
  p_team_id uuid,
  p_fixture_id uuid,
  p_preseason boolean,
  p_picks uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.awards;
  v_fixture public.fixtures;
  v_ballot uuid;
  v_needed int;
  v_pick uuid;
  v_rank int := 0;
  v_name text;
  v_is_candidate boolean;
begin
  select * into v_award from public.awards where id = p_award_id;
  if not found or not public.is_approved() then
    raise exception 'Award not found';
  end if;

  if v_award.per_group then
    if p_team_id is null
      or not exists (select 1 from public.award_groups where award_id = p_award_id and team_id = p_team_id)
    then
      raise exception 'Choose a squad or team to vote in';
    end if;
  elsif p_team_id is not null then
    raise exception 'This award has one winner for the club';
  end if;

  if auth.uid() not in (select public.award_voters(p_award_id, p_team_id)) then
    raise exception 'You can''t vote for this award';
  end if;

  if v_award.opens_at is not null and now() < v_award.opens_at then
    raise exception 'Voting hasn''t opened yet';
  end if;

  if now() >= v_award.closes_at then
    raise exception 'Voting has closed';
  end if;

  if p_fixture_id is not null then
    select * into v_fixture from public.fixtures where id = p_fixture_id;
    if not found or not v_award.by_match or coalesce(p_preseason, false)
      or v_fixture.team_id is distinct from p_team_id or v_fixture.opponent is null
    then
      raise exception 'That match isn''t part of this award';
    end if;
    if v_award.opens_at is not null and v_fixture.starts_at < v_award.opens_at then
      raise exception 'That match was played before voting opened';
    end if;
    if now() < v_fixture.starts_at then
      raise exception 'Voting opens when the match starts';
    end if;
    if now() >= v_fixture.starts_at + make_interval(hours => v_award.match_vote_hours) then
      raise exception 'Voting for this match has closed';
    end if;
  elsif coalesce(p_preseason, false) then
    if not v_award.by_match or v_award.preseason_weight = 0 then
      raise exception 'This award has no preseason vote';
    end if;
    if now() >= v_award.preseason_closes_at then
      raise exception 'The preseason vote has closed';
    end if;
  elsif v_award.by_match then
    raise exception 'Choose a match to vote on';
  end if;

  select least(cardinality(v_award.points), count(*)) into v_needed
  from public.award_nominee_rows(p_award_id, p_team_id);
  if v_needed = 0 then
    raise exception 'There''s nobody to vote for yet';
  end if;
  if coalesce(cardinality(p_picks), 0) <> v_needed then
    raise exception 'Choose % %', v_needed, case when v_needed = 1 then 'nominee' else 'nominees' end;
  end if;
  if (select count(distinct x) from unnest(p_picks) x) <> v_needed then
    raise exception 'Choose a different nominee for each place';
  end if;

  select b.id into v_ballot
  from public.award_ballots b
  where b.award_id = p_award_id and b.voter_id = auth.uid()
    and b.team_id is not distinct from p_team_id
    and b.fixture_id is not distinct from p_fixture_id
    and b.preseason = coalesce(p_preseason, false)
  for update;

  if v_ballot is null then
    insert into public.award_ballots (award_id, team_id, fixture_id, preseason, voter_id)
    values (p_award_id, p_team_id, p_fixture_id, coalesce(p_preseason, false), auth.uid())
    returning id into v_ballot;
  else
    update public.award_ballots set updated_at = now() where id = v_ballot;
    delete from public.award_votes where ballot_id = v_ballot;
  end if;

  foreach v_pick in array p_picks loop
    v_rank := v_rank + 1;
    select n.name, n.is_candidate into v_name, v_is_candidate
    from public.award_nominee_rows(p_award_id, p_team_id) n
    where n.id = v_pick;
    if v_name is null then
      raise exception 'That nominee can''t be voted for in this award';
    end if;
    insert into public.award_votes (ballot_id, rank, points, nominee_id, candidate_id, nominee_name)
    values (
      v_ballot, v_rank, v_award.points[v_rank],
      case when v_is_candidate then null else v_pick end,
      case when v_is_candidate then v_pick end,
      v_name
    );
    v_name := null;
  end loop;
end;
$$;

revoke execute on function public.save_award_ballot(uuid, uuid, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.save_award_ballot(uuid, uuid, uuid, boolean, uuid[]) to authenticated;

-- As before, leaving out matches that started before voting opened.
create or replace function public.award_turnout(p_award_id uuid)
returns table (
  team_id uuid,
  team_name text,
  fixture_id uuid,
  fixture_label text,
  starts_at timestamptz,
  preseason boolean,
  ballots int,
  voters int
)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select * from public.awards where id = p_award_id and public.can_read_reports()
  ),
  groups as (
    select g.team_id from a join public.award_groups g on g.award_id = a.id where a.per_group
    union all
    select null::uuid from a where not a.per_group
  ),
  rounds as (
    select gr.team_id, null::uuid as fixture_id, false as preseason from groups gr, a
    where not a.by_match
    union all
    select gr.team_id, null, true from groups gr, a
    where a.by_match and a.preseason_weight > 0
    union all
    select gr.team_id, f.id, false from groups gr, a
    join public.fixtures f on true
    where a.by_match and f.team_id = gr.team_id and f.opponent is not null
      and f.starts_at <= now() and f.starts_at < a.closes_at
      and (a.opens_at is null or f.starts_at >= a.opens_at)
      and coalesce(f.status, '') !~* 'cancel|abandon|forfeit'
  )
  select
    r.team_id, t.name, r.fixture_id, case when f.id is not null then public.fixture_label(f) end,
    f.starts_at, r.preseason,
    (select count(*)::int from public.award_ballots b
      where b.award_id = p_award_id and b.team_id is not distinct from r.team_id
        and b.fixture_id is not distinct from r.fixture_id and b.preseason = r.preseason),
    (select count(*)::int from public.award_voters(p_award_id, r.team_id))
  from rounds r
  left join public.teams t on t.id = r.team_id
  left join public.fixtures f on f.id = r.fixture_id
  order by t.sort_order nulls first, t.name, r.preseason desc, f.starts_at;
$$;
revoke execute on function public.award_turnout(uuid) from public, anon;
grant execute on function public.award_turnout(uuid) to authenticated;

commit;
