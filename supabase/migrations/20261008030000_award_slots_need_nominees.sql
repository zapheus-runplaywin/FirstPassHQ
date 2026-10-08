-- Award votes on the home screen and the Awards screen.
--
-- Matt (2026-10-08): members shouldn't see an award vote unless it's open and
-- they can vote in it. award_slots() already only returns open votes the
-- member is a voter for; it now also leaves out votes with nobody to vote for,
-- since a ballot can't be cast there.
--
-- Additive only: one replaced function. No rows change.

begin;

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

commit;
