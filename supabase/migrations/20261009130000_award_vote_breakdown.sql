-- Full voting results for closed awards.
--
-- Once an award has closed, admins can export its full result: for each
-- squad or team, and each match or the preseason vote, how many first,
-- second and third places (and so on) each nominee got and the points they
-- add up to. Ballots stay secret: nothing here says who voted for whom.
--
-- Additive only: one new function.

begin;

-- Each nominee's votes at each place on the ballot, for each group, match
-- and preseason vote of a closed award. Admins only.
create or replace function public.award_vote_breakdown(p_award_id uuid)
returns table (
  team_id uuid,
  fixture_id uuid,
  fixture_label text,
  starts_at timestamptz,
  preseason boolean,
  nominee_key text,
  nominee_name text,
  rank smallint,
  votes integer,
  points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select * from public.awards
    where id = p_award_id and closes_at <= now() and public.is_admin()
  )
  select
    b.team_id,
    b.fixture_id,
    case when f.id is not null then public.fixture_label(f) end,
    f.starts_at,
    b.preseason,
    -- A nominee who has left is told apart by name, as in award_results.
    coalesce(v.nominee_id::text, v.candidate_id::text, 'left:' || v.nominee_name),
    (array_agg(v.nominee_name order by b.updated_at desc))[1],
    v.rank,
    count(*)::int,
    sum(v.points)::int
  from a
  join public.award_ballots b on b.award_id = a.id
  join public.award_votes v on v.ballot_id = b.id
  left join public.fixtures f on f.id = b.fixture_id
  group by b.team_id, b.fixture_id, f.id, b.preseason, 6, v.rank
  order by b.team_id, b.preseason desc, f.starts_at, v.rank;
$$;

revoke execute on function public.award_vote_breakdown(uuid) from public, anon;
grant execute on function public.award_vote_breakdown(uuid) to authenticated;

commit;
