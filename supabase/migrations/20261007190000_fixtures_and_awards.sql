-- Match fixtures from PlayHQ, and club awards voting.
--
-- Fixtures: an admin points the app at a PlayHQ competition (its season page,
-- such as playhq.com/netball-australia/org/<association>/<season>/<id>) and
-- links the club's teams in it to its squads and teams. The app reads the
-- games from PlayHQ's public API and saves them here, and the admin can
-- refresh them when PlayHQ changes. They show in the team's calendar and can
-- be voted on for match awards.
--
-- Awards: an admin creates an award with who votes (the whole club, or chosen
-- squads and teams, and which roles), who can be voted for, how many places a
-- ballot has (1 vote, or 3-2-1 and so on) and when voting closes. An award can
-- have a winner per squad or team, and be voted on after every match, with an
-- optional preseason vote weighted against the season's matches. Annual
-- awards can be copied into the next season. Ballots are secret: members see
-- only their own, and only admins see the results.
--
-- Additive only: new types, tables, functions and policies. No rows change.

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- PlayHQ competition seasons the club's fixtures come from.
create table if not exists public.playhq_seasons (
  playhq_season_id text primary key,
  name text not null,
  url text not null,
  -- The club year the competition is for, as in teams.season.
  season int not null,
  imported_at timestamptz,
  created_at timestamptz not null default now()
);

-- A team in a PlayHQ competition and the club squad or team it plays as. A
-- null team_id means it isn't one of ours.
create table if not exists public.playhq_teams (
  playhq_team_id text primary key,
  playhq_season_id text not null references public.playhq_seasons (playhq_season_id) on delete cascade,
  playhq_name text not null,
  team_id uuid references public.teams (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.playhq_seasons enable row level security;
alter table public.playhq_teams enable row level security;

-- Admins read them; writes go through the functions below.
drop policy if exists "Admins see PlayHQ competitions" on public.playhq_seasons;
create policy "Admins see PlayHQ competitions"
  on public.playhq_seasons for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins see PlayHQ teams" on public.playhq_teams;
create policy "Admins see PlayHQ teams"
  on public.playhq_teams for select to authenticated
  using (public.is_admin());

create table if not exists public.fixtures (
  id uuid primary key default gen_random_uuid(),
  -- A game between two of our teams is saved once for each of them.
  playhq_game_id text,
  playhq_team_id text,
  -- Kept if the squad or team is removed, with its name as it was.
  team_id uuid references public.teams (id) on delete set null,
  team_name text not null,
  -- Null for a bye.
  opponent text,
  round_name text,
  grade_name text,
  starts_at timestamptz not null,
  -- PlayHQ hasn't set a time yet: starts_at is midnight on the day.
  time_tbc boolean not null default false,
  venue text,
  court text,
  is_home boolean,
  is_final boolean not null default false,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playhq_game_id, playhq_team_id)
);

create index if not exists fixtures_team_starts_idx on public.fixtures (team_id, starts_at);
create index if not exists fixtures_starts_idx on public.fixtures (starts_at);

drop trigger if exists fixtures_touch_updated_at on public.fixtures;
create trigger fixtures_touch_updated_at
  before update on public.fixtures
  for each row execute function public.touch_updated_at();

alter table public.fixtures enable row level security;

-- The same people who see a team's calendar.
drop policy if exists "Members see their teams' fixtures" on public.fixtures;
create policy "Members see their teams' fixtures"
  on public.fixtures for select to authenticated
  using (
    public.is_admin()
    or (team_id is not null and public.is_approved() and public.is_team_member(team_id))
  );

-- Adds or updates a PlayHQ competition and its teams. p_teams is a list of
-- {playhq_team_id, playhq_name, team_id}; team_id is null or empty for teams
-- that aren't ours.
create or replace function public.admin_save_playhq_season(
  p_season_id text,
  p_name text,
  p_url text,
  p_season int,
  p_teams jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can add PlayHQ competitions';
  end if;
  if coalesce(btrim(p_season_id), '') = '' then
    raise exception 'That isn''t a PlayHQ competition link';
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'Expected a list of teams';
  end if;

  insert into public.playhq_seasons as g (playhq_season_id, name, url, season)
  values (p_season_id, coalesce(nullif(btrim(p_name), ''), 'PlayHQ competition'), p_url, p_season)
  on conflict (playhq_season_id) do update set
    name = excluded.name, url = excluded.url, season = excluded.season;

  insert into public.playhq_teams as l (playhq_team_id, playhq_season_id, playhq_name, team_id, updated_at)
  select x->>'playhq_team_id', p_season_id, x->>'playhq_name', nullif(x->>'team_id', '')::uuid, now()
  from jsonb_array_elements(p_teams) x
  where coalesce(x->>'playhq_team_id', '') <> '' and coalesce(x->>'playhq_name', '') <> ''
  on conflict (playhq_team_id) do update set
    playhq_season_id = excluded.playhq_season_id,
    playhq_name = excluded.playhq_name,
    team_id = excluded.team_id,
    updated_at = now();
end;
$$;

-- Saves the games PlayHQ lists for one linked team, adding new ones and
-- updating changed times and venues. Each game is {id, date, time, timezone,
-- round, is_final, grade, venue, court, opponent, is_home, status}; date and
-- time are local to timezone (Perth when it's missing). Returns how many games
-- were saved.
create or replace function public.save_playhq_fixtures(p_playhq_team_id text, p_games jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_season text;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import fixtures';
  end if;

  select t.* into v_team
  from public.playhq_teams l
  join public.teams t on t.id = l.team_id
  where l.playhq_team_id = p_playhq_team_id;
  if not found then
    raise exception 'That PlayHQ team isn''t linked to a squad or team';
  end if;

  insert into public.fixtures as f (
    playhq_game_id, playhq_team_id, team_id, team_name, opponent, round_name, grade_name,
    starts_at, time_tbc, venue, court, is_home, is_final, status
  )
  select
    g->>'id', p_playhq_team_id, v_team.id, v_team.name,
    nullif(g->>'opponent', ''), nullif(g->>'round', ''), nullif(g->>'grade', ''),
    ((g->>'date') || ' ' || coalesce(nullif(g->>'time', ''), '00:00'))::timestamp
      at time zone coalesce(nullif(g->>'timezone', ''), 'Australia/Perth'),
    coalesce(g->>'time', '') = '',
    nullif(g->>'venue', ''), nullif(g->>'court', ''),
    (g->>'is_home')::boolean, coalesce((g->>'is_final')::boolean, false),
    nullif(g->>'status', '')
  from jsonb_array_elements(p_games) g
  where coalesce(g->>'id', '') <> '' and coalesce(g->>'date', '') <> ''
  on conflict (playhq_game_id, playhq_team_id) do update set
    team_id = excluded.team_id,
    team_name = excluded.team_name,
    opponent = excluded.opponent,
    round_name = excluded.round_name,
    grade_name = excluded.grade_name,
    starts_at = excluded.starts_at,
    time_tbc = excluded.time_tbc,
    venue = excluded.venue,
    court = excluded.court,
    is_home = excluded.is_home,
    is_final = excluded.is_final,
    status = excluded.status;
  get diagnostics v_count = row_count;

  select playhq_season_id into v_season from public.playhq_teams where playhq_team_id = p_playhq_team_id;
  update public.playhq_seasons set imported_at = now() where playhq_season_id = v_season;
  return v_count;
end;
$$;

revoke execute on function public.admin_save_playhq_season(text, text, text, int, jsonb) from public, anon;
revoke execute on function public.save_playhq_fixtures(text, jsonb) from public, anon;
grant execute on function public.admin_save_playhq_season(text, text, text, int, jsonb) to authenticated;
grant execute on function public.save_playhq_fixtures(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Awards
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'award_nominees') then
    -- Who can be voted for: athletes or coaches in the voting groups, any
    -- approved member, or names an admin lists (such as umpires).
    create type public.award_nominees as enum ('athletes', 'coaches', 'members', 'listed');
  end if;
end;
$$;

create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  -- The club year it's awarded for, as in teams.season.
  season int not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  closes_at timestamptz not null,
  -- Voters from the whole club, or only from the squads and teams in award_groups.
  club_wide boolean not null default true,
  -- A separate winner for each squad or team in award_groups, voted on by its members.
  per_group boolean not null default false,
  -- Team roles (athlete, coach, manager, guardian) count inside the voting
  -- groups; committee, admin and partner count anywhere; member is everyone.
  voter_roles text[] not null check (
    cardinality(voter_roles) > 0
    and voter_roles <@ array['athlete', 'coach', 'manager', 'guardian', 'committee', 'admin', 'partner', 'member']
  ),
  nominees public.award_nominees not null default 'athletes',
  -- Points for each place on a ballot: {1} is a single vote, {3,2,1} is 3-2-1.
  points smallint[] not null default '{1}' check (
    cardinality(points) between 1 and 5 and 0 < all (points) and 100 >= all (points)
  ),
  -- Voted on after every match of the group's team.
  by_match boolean not null default false,
  -- How long after a match starts its votes stay open.
  match_vote_hours int not null default 48 check (match_vote_hours between 1 and 336),
  -- Percentage of the result from a preseason vote, the rest from the matches.
  preseason_weight smallint not null default 0 check (preseason_weight between 0 and 90),
  preseason_closes_at timestamptz,
  -- Offered for copying into the next season.
  annual boolean not null default false,
  copied_from uuid references public.awards (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint per_group_awards_name_groups check (not (per_group and club_wide)),
  constraint match_awards_are_per_group check (not by_match or per_group),
  constraint preseason_votes_are_for_match_awards check (
    preseason_weight = 0 or (by_match and preseason_closes_at is not null)
  )
);

create index if not exists awards_season_idx on public.awards (season, closes_at);

drop trigger if exists awards_touch_updated_at on public.awards;
create trigger awards_touch_updated_at
  before update on public.awards
  for each row execute function public.touch_updated_at();

create table if not exists public.award_groups (
  award_id uuid not null references public.awards (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  primary key (award_id, team_id)
);

-- Names an admin lists for an award that isn't voted on from the app's members.
create table if not exists public.award_candidates (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.awards (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (award_id, name)
);

-- One member's ballot for an award: for one group, and for one match or the
-- preseason vote when the award is voted on per match.
create table if not exists public.award_ballots (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.awards (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  fixture_id uuid references public.fixtures (id),
  preseason boolean not null default false,
  -- Kept when the voter leaves, so the result doesn't change.
  voter_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preseason_ballots_have_no_match check (not (preseason and fixture_id is not null))
);

create unique index if not exists award_ballots_one_per_voter_idx
  on public.award_ballots (award_id, voter_id, team_id, fixture_id, preseason) nulls not distinct
  where voter_id is not null;
create index if not exists award_ballots_voter_idx on public.award_ballots (voter_id);

create table if not exists public.award_votes (
  ballot_id uuid not null references public.award_ballots (id) on delete cascade,
  -- 1 is first place.
  rank smallint not null check (rank between 1 and 5),
  points smallint not null,
  nominee_id uuid references public.profiles (id) on delete set null,
  candidate_id uuid references public.award_candidates (id) on delete cascade,
  -- The nominee's name when the vote was cast, kept if they leave.
  nominee_name text not null,
  primary key (ballot_id, rank)
);

create index if not exists award_votes_nominee_idx on public.award_votes (nominee_id);

alter table public.awards enable row level security;
alter table public.award_groups enable row level security;
alter table public.award_candidates enable row level security;
alter table public.award_ballots enable row level security;
alter table public.award_votes enable row level security;

-- Awards themselves aren't secret. Ballots are: each member sees only theirs.
drop policy if exists "Members see awards" on public.awards;
create policy "Members see awards"
  on public.awards for select to authenticated
  using (public.is_approved());

drop policy if exists "Members see award groups" on public.award_groups;
create policy "Members see award groups"
  on public.award_groups for select to authenticated
  using (public.is_approved());

drop policy if exists "Members see award candidates" on public.award_candidates;
create policy "Members see award candidates"
  on public.award_candidates for select to authenticated
  using (public.is_approved());

drop policy if exists "Members see their own ballots" on public.award_ballots;
create policy "Members see their own ballots"
  on public.award_ballots for select to authenticated
  using (voter_id = auth.uid());

drop policy if exists "Members see their own votes" on public.award_votes;
create policy "Members see their own votes"
  on public.award_votes for select to authenticated
  using (exists (
    select 1 from public.award_ballots b where b.id = ballot_id and b.voter_id = auth.uid()
  ));

-- The squads and teams an award draws voters and nominees from: one group when
-- it has a winner per group, its chosen groups, or every current group of its
-- season when the whole club votes.
create or replace function public.award_group_ids(p_award_id uuid, p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.awards a
  join public.teams t on t.season = a.season or exists (
    select 1 from public.award_groups g where g.award_id = a.id and g.team_id = t.id
  )
  where a.id = p_award_id
    and case
      when a.per_group then t.id = p_team_id
        and exists (select 1 from public.award_groups g where g.award_id = a.id and g.team_id = t.id)
      when a.club_wide then t.season = a.season and not t.archived
      else exists (select 1 from public.award_groups g where g.award_id = a.id and g.team_id = t.id)
    end;
$$;

-- Everyone who can vote for an award, in one group when it has a winner per group.
create or replace function public.award_voters(p_award_id uuid, p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.awards a
  join public.profiles p on p.status = 'approved'
  where a.id = p_award_id
    and (
      'member' = any (a.voter_roles)
      -- Committee, admin and partner aren't tied to a group.
      or (p.role::text = any (a.voter_roles)
        and (a.club_wide or p.role in ('committee', 'admin', 'partner')))
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = p.id
          and tm.team_role::text = any (a.voter_roles)
          and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
      )
    );
$$;

-- Who can be voted for in one group of an award, leaving out the signed-in
-- member: nobody votes for themselves.
create or replace function public.award_nominee_rows(p_award_id uuid, p_team_id uuid)
returns table (id uuid, is_candidate boolean, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, false, coalesce(nullif(p.full_name, ''), p.email)
  from public.awards a
  join public.team_members tm
    on tm.team_role = case a.nominees when 'coaches' then 'coach'::public.team_role
                                      else 'athlete'::public.team_role end
  join public.profiles p on p.id = tm.profile_id and p.status = 'approved'
  where a.id = p_award_id
    and a.nominees in ('athletes', 'coaches')
    and tm.team_id in (select public.award_group_ids(a.id, p_team_id))
    and p.id is distinct from auth.uid()
  union all
  select p.id, false, coalesce(nullif(p.full_name, ''), p.email)
  from public.awards a
  join public.profiles p on p.status = 'approved' and p.role <> 'guest'
  where a.id = p_award_id
    and a.nominees = 'members'
    and p.id is distinct from auth.uid()
  union all
  select c.id, true, c.name
  from public.awards a
  join public.award_candidates c on c.award_id = a.id
  where a.id = p_award_id
    and a.nominees = 'listed';
$$;

-- Internal helpers: called only by the functions below.
revoke execute on function public.award_group_ids(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.award_voters(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.award_nominee_rows(uuid, uuid) from public, anon, authenticated;

-- How a match reads in the app: "Round 3 v Rockets".
create or replace function public.fixture_label(p_fixture public.fixtures)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' v ', coalesce(p_fixture.round_name, 'Match'), p_fixture.opponent);
$$;

revoke execute on function public.fixture_label(public.fixtures) from public, anon;
grant execute on function public.fixture_label(public.fixtures) to authenticated;

-- Every vote open to the signed-in member right now: one row per award and
-- group, or per match and preseason vote for match awards. voted says whether
-- they've already voted (they can change it until it closes).
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
  order by s.closes_at, s.name, t.sort_order;
$$;

-- Who the signed-in member can vote for in one group of an award. Admins can
-- see the list for any group.
create or replace function public.award_nominees(p_award_id uuid, p_team_id uuid)
returns table (id uuid, is_candidate boolean, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.is_candidate, n.name
  from public.award_nominee_rows(p_award_id, p_team_id) n
  where public.is_admin()
    or (public.is_approved() and auth.uid() in (select public.award_voters(p_award_id, p_team_id)))
  order by n.name;
$$;

-- Casts or changes the signed-in member's ballot. p_picks lists nominee ids
-- (members or listed names) in order, first place first. A ballot needs every
-- place filled, or every nominee when there are fewer of them.
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

-- Creates (p_id null) or changes an award. Once anyone has voted, only its
-- name, description, closing times, match voting window, the annual flag and
-- added names can change, so votes already cast keep their meaning. Listed
-- names that have votes are kept. Returns the award's id.
create or replace function public.admin_save_award(
  p_id uuid,
  p_season int,
  p_name text,
  p_description text,
  p_closes_at timestamptz,
  p_club_wide boolean,
  p_per_group boolean,
  p_voter_roles text[],
  p_nominees public.award_nominees,
  p_points smallint[],
  p_by_match boolean,
  p_match_vote_hours int,
  p_preseason_weight smallint,
  p_preseason_closes_at timestamptz,
  p_annual boolean,
  p_group_ids uuid[],
  p_candidates text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_old public.awards;
  v_voted boolean := false;
  v_groups uuid[] := coalesce(p_group_ids, '{}');
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage awards';
  end if;

  if not p_club_wide and cardinality(v_groups) = 0 then
    raise exception 'Choose the squads or teams that vote';
  end if;
  if exists (
    select 1 from unnest(v_groups) g
    where not exists (select 1 from public.teams t where t.id = g and t.season = p_season)
  ) then
    raise exception 'Choose squads and teams from the award''s season';
  end if;
  if p_nominees = 'listed' and coalesce(cardinality(array_remove(p_candidates, '')), 0) = 0 then
    raise exception 'Add the names that can be voted for';
  end if;

  if v_id is not null then
    select * into v_old from public.awards where id = v_id for update;
    if not found then
      raise exception 'Award not found';
    end if;
    v_voted := exists (select 1 from public.award_ballots where award_id = v_id);
    if v_voted and (
      v_old.season <> p_season
      or v_old.club_wide <> p_club_wide
      or v_old.per_group <> p_per_group
      or v_old.voter_roles <> p_voter_roles
      or v_old.nominees <> p_nominees
      or v_old.points <> p_points
      or v_old.by_match <> p_by_match
      or v_old.preseason_weight <> p_preseason_weight
      or (select coalesce(array_agg(team_id order by team_id), '{}') from public.award_groups where award_id = v_id)
        <> (select coalesce(array_agg(distinct g order by g), '{}') from unnest(v_groups) g)
    ) then
      raise exception 'People have voted, so only the name, description, closing dates and listed names can change';
    end if;

    update public.awards set
      season = p_season,
      name = btrim(p_name),
      description = btrim(coalesce(p_description, '')),
      closes_at = p_closes_at,
      club_wide = p_club_wide,
      per_group = p_per_group,
      voter_roles = p_voter_roles,
      nominees = p_nominees,
      points = p_points,
      by_match = p_by_match,
      match_vote_hours = p_match_vote_hours,
      preseason_weight = p_preseason_weight,
      preseason_closes_at = p_preseason_closes_at,
      annual = p_annual
    where id = v_id;
  else
    insert into public.awards (
      season, name, description, closes_at, club_wide, per_group, voter_roles, nominees,
      points, by_match, match_vote_hours, preseason_weight, preseason_closes_at, annual, created_by
    ) values (
      p_season, btrim(p_name), btrim(coalesce(p_description, '')), p_closes_at, p_club_wide,
      p_per_group, p_voter_roles, p_nominees, p_points, p_by_match, p_match_vote_hours,
      p_preseason_weight, p_preseason_closes_at, p_annual, auth.uid()
    )
    returning id into v_id;
  end if;

  if not v_voted then
    delete from public.award_groups where award_id = v_id and team_id <> all (v_groups);
    insert into public.award_groups (award_id, team_id)
    select v_id, g from unnest(v_groups) g
    on conflict do nothing;
  end if;

  -- Names that were removed go, unless someone has voted for them.
  delete from public.award_candidates c
  where c.award_id = v_id
    and c.name <> all (coalesce(p_candidates, '{}'))
    and not exists (select 1 from public.award_votes v where v.candidate_id = c.id);
  insert into public.award_candidates (award_id, name)
  select distinct v_id, btrim(n) from unnest(coalesce(p_candidates, '{}')) n
  where btrim(n) <> ''
  on conflict do nothing;

  return v_id;
end;
$$;

-- Removes an award nobody has voted for yet.
create or replace function public.admin_delete_award(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage awards';
  end if;
  if exists (select 1 from public.award_ballots where award_id = p_id) then
    raise exception 'People have voted for this award, so it can''t be removed';
  end if;
  delete from public.awards where id = p_id;
end;
$$;

-- Copies awards into a later season, with the same settings, closing dates
-- moved by the same number of years, and the squads and teams of that season
-- with the same names. Awards already copied into that season are skipped.
-- Returns each new award and how many of its groups had no match by name
-- (teams are named at selections, so they may not exist yet).
create or replace function public.admin_copy_awards(p_award_ids uuid[], p_season int)
returns table (award_id uuid, award_name text, missing_groups int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.awards;
  v_new uuid;
  v_years interval;
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage awards';
  end if;

  for v_award in
    select a.* from public.awards a
    where a.id = any (p_award_ids)
      and a.season < p_season
      and not exists (
        select 1 from public.awards c where c.copied_from = a.id and c.season = p_season
      )
    order by a.name
  loop
    v_years := make_interval(years => p_season - v_award.season);
    insert into public.awards (
      season, name, description, closes_at, club_wide, per_group, voter_roles, nominees,
      points, by_match, match_vote_hours, preseason_weight, preseason_closes_at, annual,
      copied_from, created_by
    ) values (
      p_season, v_award.name, v_award.description, v_award.closes_at + v_years,
      v_award.club_wide, v_award.per_group, v_award.voter_roles, v_award.nominees,
      v_award.points, v_award.by_match, v_award.match_vote_hours, v_award.preseason_weight,
      v_award.preseason_closes_at + v_years, v_award.annual, v_award.id, auth.uid()
    )
    returning id into v_new;

    insert into public.award_groups (award_id, team_id)
    select distinct v_new, n.id
    from public.award_groups g
    join public.teams o on o.id = g.team_id
    join public.teams n on n.season = p_season and n.kind = o.kind and n.name = o.name
      and not n.archived
    where g.award_id = v_award.id;

    insert into public.award_candidates (award_id, name)
    select v_new, c.name from public.award_candidates c where c.award_id = v_award.id;

    award_id := v_new;
    award_name := v_award.name;
    select count(*)::int into missing_groups
    from public.award_groups g
    join public.teams o on o.id = g.team_id
    where g.award_id = v_award.id
      and not exists (
        select 1 from public.teams n
        where n.season = p_season and n.kind = o.kind and n.name = o.name and not n.archived
      );
    return next;
  end loop;
end;
$$;

-- The standings for an award, for admins: each nominee's points in each
-- group. For a match award with a preseason vote, score weighs the share of
-- preseason points against the share of match points (as a percentage);
-- otherwise score is the points.
create or replace function public.award_results(p_award_id uuid)
returns table (
  team_id uuid,
  team_name text,
  nominee_name text,
  preseason_points int,
  match_points int,
  votes int,
  score numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select * from public.awards where id = p_award_id and public.is_admin()
  ),
  tallies as (
    select
      b.team_id,
      -- A nominee who has left is told apart by name.
      coalesce(v.nominee_id::text, v.candidate_id::text, 'left:' || v.nominee_name) as nominee,
      -- The name as it was last voted for.
      (array_agg(v.nominee_name order by b.updated_at desc))[1] as name,
      coalesce(sum(v.points) filter (where b.preseason), 0)::int as pre,
      coalesce(sum(v.points) filter (where not b.preseason), 0)::int as main,
      count(*)::int as votes
    from a
    join public.award_ballots b on b.award_id = a.id
    join public.award_votes v on v.ballot_id = b.id
    group by b.team_id, 2
  ),
  totals as (
    select t.team_id, sum(t.pre) as pre, sum(t.main) as main
    from tallies t group by t.team_id
  )
  select
    t.team_id, g.name, t.name, t.pre, t.main, t.votes,
    case when a.preseason_weight > 0 then round(
      a.preseason_weight * coalesce(t.pre::numeric / nullif(s.pre, 0), 0)
      + (100 - a.preseason_weight) * coalesce(t.main::numeric / nullif(s.main, 0), 0), 1)
    else (t.pre + t.main)::numeric end as score
  from tallies t
  cross join a
  join totals s on s.team_id is not distinct from t.team_id
  left join public.teams g on g.id = t.team_id
  order by g.sort_order nulls first, g.name, score desc, t.name;
$$;

-- How many people have voted in each group, match and preseason vote of an
-- award, out of how many can, for admins.
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
    select * from public.awards where id = p_award_id and public.is_admin()
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

revoke execute on function public.award_slots() from public, anon;
revoke execute on function public.award_nominees(uuid, uuid) from public, anon;
revoke execute on function public.save_award_ballot(uuid, uuid, uuid, boolean, uuid[]) from public, anon;
revoke execute on function public.admin_save_award(uuid, int, text, text, timestamptz, boolean, boolean, text[], public.award_nominees, smallint[], boolean, int, smallint, timestamptz, boolean, uuid[], text[]) from public, anon;
revoke execute on function public.admin_delete_award(uuid) from public, anon;
revoke execute on function public.admin_copy_awards(uuid[], int) from public, anon;
revoke execute on function public.award_results(uuid) from public, anon;
revoke execute on function public.award_turnout(uuid) from public, anon;
grant execute on function public.award_slots() to authenticated;
grant execute on function public.award_nominees(uuid, uuid) to authenticated;
grant execute on function public.save_award_ballot(uuid, uuid, uuid, boolean, uuid[]) to authenticated;
grant execute on function public.admin_save_award(uuid, int, text, text, timestamptz, boolean, boolean, text[], public.award_nominees, smallint[], boolean, int, smallint, timestamptz, boolean, uuid[], text[]) to authenticated;
grant execute on function public.admin_delete_award(uuid) to authenticated;
grant execute on function public.admin_copy_awards(uuid[], int) to authenticated;
grant execute on function public.award_results(uuid) to authenticated;
grant execute on function public.award_turnout(uuid) to authenticated;
