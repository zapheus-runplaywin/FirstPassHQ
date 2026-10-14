-- Live game stats: games, the event log, pairing and break snapshots.
--
-- Matt (2026-10-14): FirstPass Vantage (the statistician's tablet) and
-- FirstPass Vision (the coach's live view) use the club's own database, so
-- one sign-in, one set of roles, teams and fixtures serves all three apps.
--
-- How it works:
-- - A statistician (or an admin) starts a game in Vantage, usually from one
--   of the team's PlayHQ fixtures. The tablet makes the game's id, so a game
--   can be set up with no signal, and takes the recorder lease: the one
--   device allowed to write the game's primary stream.
-- - Every tap is an event. The tablet keeps them and sends them in batches to
--   append_events, which ignores duplicates (a resend after a timeout is
--   harmless) and returns the highest unbroken seq stored. Corrections are
--   events too; nothing is ever updated or deleted.
-- - Each primary event is broadcast on the private Realtime topic game:<id>.
--   A coach's phone pairs with the game's six-digit code and subscribes.
--   Pairing only works with a role in this club, so a guessed code is
--   useless to anyone else, and five misses in ten minutes lock the account
--   out of pairing.
-- - A shadow statistician (practising, or for comparison) pairs with the
--   same code and writes their own stream, which is stored but not
--   broadcast.
-- - At each break the tablet saves a snapshot of the derived stats, so a
--   late joiner needs only the events after it.
--
-- Who sees a game: admins and statisticians see every game in the club;
-- the coaches and managers of the game's squad or team see its games. Stats
-- are team records about a game, like attendance; athletes and guardians
-- don't see them in this release. The lineup in a game's setup names
-- players; a player can be linked to a member or be a name only (opposition
-- players always are).
--
-- Additive only: new tables, functions and policies. No rows change.

begin;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- A stand-down pauses the Statistician role too, like every role that works
-- with athletes. Same as before otherwise.
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved'
      and (p.role = p_role or p_role = any (p.extra_roles))
      and case
        when p_role in ('coach', 'manager', 'physio') then
          p.stood_down_at is null and public.is_cleared(p.id)
        when p_role = 'committee' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and current_date < coalesce(public.committee_checks_from(), current_date + 1)
            )
            or public.has_current_wwcc(p.id)
          )
        when p_role in ('admin', 'statistician') then p.stood_down_at is null
        else true
      end
  );
$$;

revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

-- Statistician stacks with any other role (a manager, or an athlete helping
-- at a game they aren't playing in), like the rules before it. Only
-- Temporary helpers now refuse other roles here, as the app always has.
create or replace function public.role_combination_problem(
  p_roles public.app_role[],
  p_date_of_birth date,
  p_under_18 boolean
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when 'partner' = any (p_roles)
      then 'The Partner role has been removed. Use Guest instead.'
    when 'guest' = any (p_roles) and cardinality(p_roles) > 1
      then 'Guests can''t have another role'
    when 'volunteer' = any (p_roles) and cardinality(p_roles) > 1
      then 'Temporary helpers can''t have another role'
    when 'admin' = any (p_roles) and 'athlete' = any (p_roles)
      then 'Admins can''t also be athletes'
    when 'athlete' = any (p_roles) and 'manager' = any (p_roles)
      then 'Athletes can''t also be managers'
    when 'athlete' = any (p_roles) and 'physio' = any (p_roles)
      then 'Athletes can''t also be physios'
    when 'athlete' = any (p_roles) and public.is_minor(p_date_of_birth, p_under_18)
      and not p_roles <@ array['athlete', 'coach']::public.app_role[]
      then 'Athletes under 18 can only also be a coach'
    when 'guardian' = any (p_roles) and p_date_of_birth is not null
      and public.is_minor(p_date_of_birth, false)
      then 'Parents and guardians must be 18 or over'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create type public.game_status as enum ('setup', 'live', 'final');
create type public.game_role as enum ('recorder', 'shadow', 'viewer');

create table if not exists public.games (
  -- Made on the tablet (a UUID), so a game can be set up with no signal.
  id uuid primary key,
  -- The squad or team whose statistician recorded it. Kept if the team goes.
  team_id uuid references public.teams (id) on delete set null,
  -- The PlayHQ fixture it was started from, when it was.
  fixture_id uuid references public.fixtures (id) on delete set null,
  playhq_game_id text,
  -- Teams, lineup, quarter length and the other setup choices, as Vantage saves them.
  config jsonb not null,
  status public.game_status not null default 'setup',
  -- The one device allowed to write the primary stream.
  recorder_id uuid references public.profiles (id) on delete set null,
  recorder_device_id text,
  lease_taken_at timestamptz,
  pair_code char(6),
  pair_code_expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists games_team_idx on public.games (team_id, created_at desc);
create index if not exists games_fixture_idx on public.games (fixture_id);
create unique index if not exists games_pair_code_idx on public.games (pair_code) where pair_code is not null;

-- Who has paired with a game, and how.
create table if not exists public.game_members (
  game_id uuid not null references public.games (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  game_role public.game_role not null,
  paired_at timestamptz not null default now(),
  primary key (game_id, profile_id)
);

create index if not exists game_members_profile_idx on public.game_members (profile_id);

-- The log. One writer per stream: 'primary' is the game's record; a shadow
-- statistician writes 'shadow:<their profile id>'.
create table if not exists public.game_events (
  game_id uuid not null references public.games (id) on delete cascade,
  stream text not null check (stream = 'primary' or stream like 'shadow:%'),
  seq int not null check (seq > 0),
  id uuid not null unique,
  type text not null,
  payload jsonb not null,
  -- The tablet's clock when the event was recorded.
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  primary key (game_id, stream, seq)
);

-- Derived stats at each break and full time, so a late joiner needs only the tail.
create table if not exists public.game_snapshots (
  game_id uuid not null references public.games (id) on delete cascade,
  through_seq int not null,
  engine_version text not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, through_seq)
);

-- Failed pairing attempts, for the five-in-ten-minutes limit.
create table if not exists public.game_pair_attempts (
  profile_id uuid not null,
  attempted_at timestamptz not null default now()
);

create index if not exists game_pair_attempts_idx on public.game_pair_attempts (profile_id, attempted_at);

alter table public.games enable row level security;
alter table public.game_members enable row level security;
alter table public.game_events enable row level security;
alter table public.game_snapshots enable row level security;
alter table public.game_pair_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------------

-- Whether the signed-in member can record games: statisticians and admins.
create or replace function public.is_statistician()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('statistician') or public.is_admin();
$$;

revoke execute on function public.is_statistician() from public, anon;
grant execute on function public.is_statistician() to authenticated;

-- Admins and statisticians see every game; a squad or team's coaches and
-- managers see its games.
create or replace function public.may_view_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_statistician() or exists (
    select 1
    from public.games g
    join public.team_members tm on tm.team_id = g.team_id
    join public.profiles p on p.id = tm.profile_id
    where g.id = p_game_id
      and tm.profile_id = auth.uid()
      and tm.team_role in ('coach', 'manager')
      and p.status = 'approved'
  );
$$;

revoke execute on function public.may_view_game(uuid) from public, anon;
grant execute on function public.may_view_game(uuid) to authenticated;

-- Paired with the game, and still allowed to see it.
create or replace function public.is_game_member(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_members gm
    where gm.game_id = p_game_id and gm.profile_id = auth.uid()
  ) and public.may_view_game(p_game_id);
$$;

revoke execute on function public.is_game_member(uuid) from public, anon;
grant execute on function public.is_game_member(uuid) to authenticated;

-- Statisticians see every fixture, so they can start a game from one.
drop policy if exists "Statisticians see fixtures" on public.fixtures;
create policy "Statisticians see fixtures"
  on public.fixtures for select to authenticated
  using (public.is_statistician());

-- This season's athletes in a squad or team, for the lineup in Vantage:
-- their name as they like it, and whether they're a final team athlete or a
-- training partner. Statisticians and admins only.
create or replace function public.game_lineup(p_team_id uuid)
returns table (
  profile_id uuid,
  name text,
  selection public.team_selection
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id, coalesce(nullif(trim(p.preferred_name), ''), p.full_name), tm.selection
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  join public.teams t on t.id = tm.team_id
  where tm.team_id = p_team_id
    and tm.team_role = 'athlete'
    and p.status = 'approved'
    and not t.archived
    and public.is_statistician()
  order by
    case tm.selection when 'touring' then 0 when 'training_partner' then 1 else 2 end,
    p.full_name;
$$;

revoke execute on function public.game_lineup(uuid) from public, anon;
grant execute on function public.game_lineup(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Starting, pairing and finishing a game
-- ---------------------------------------------------------------------------

create or replace function public.new_game_pair_code()
returns char(6)
language plpgsql
set search_path = ''
as $$
declare
  v_code char(6);
begin
  loop
    v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.games where pair_code = v_code);
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.new_game_pair_code() from public, anon, authenticated;

-- Vantage creates the game and takes the recorder lease in one call. Calling
-- it again for the same game from the same member renews the lease, which is
-- how a swap to another tablet works. Started from a fixture, the game takes
-- the fixture's team and PlayHQ game.
create or replace function public.create_game(
  p_id uuid,
  p_config jsonb,
  p_device_id text,
  p_team_id uuid default null,
  p_fixture_id uuid default null
)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_team_id uuid := p_team_id;
  g public.games;
begin
  if not public.is_statistician() then
    raise exception 'Only statisticians and admins can record games' using errcode = '42501';
  end if;
  if p_fixture_id is not null then
    select * into v_fixture from public.fixtures where id = p_fixture_id;
    if not found then
      raise exception 'That fixture isn''t in the club''s games' using errcode = 'P0002';
    end if;
    v_team_id := coalesce(v_team_id, v_fixture.team_id);
  end if;
  if v_team_id is not null and not exists (
    select 1 from public.teams t where t.id = v_team_id and not t.archived
  ) then
    raise exception 'Games can only be recorded for this season''s squads and teams' using errcode = '42501';
  end if;

  insert into public.games (
    id, team_id, fixture_id, playhq_game_id, config, status,
    recorder_id, recorder_device_id, lease_taken_at, pair_code, created_by
  )
  values (
    p_id, v_team_id, p_fixture_id, v_fixture.playhq_game_id, p_config, 'live',
    auth.uid(), p_device_id, now(), public.new_game_pair_code(), auth.uid()
  )
  on conflict (id) do update set
    recorder_id = auth.uid(),
    recorder_device_id = excluded.recorder_device_id,
    lease_taken_at = now()
  returning * into g;

  insert into public.game_members (game_id, profile_id, game_role)
  values (p_id, auth.uid(), 'recorder')
  on conflict (game_id, profile_id) do update set game_role = 'recorder';
  return g;
end;
$$;

revoke execute on function public.create_game(uuid, jsonb, text, uuid, uuid) from public, anon;
grant execute on function public.create_game(uuid, jsonb, text, uuid, uuid) to authenticated;

-- A coach pairs with a live game by its six-digit code; a shadow
-- statistician pairs the same way with p_as_shadow. Only works for someone
-- allowed to see the game. A miss returns null (raising would roll back the
-- attempt record); five misses in ten minutes lock the member out.
create or replace function public.pair_game(p_code text, p_as_shadow boolean default false)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_game_role public.game_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if (
    select count(*) from public.game_pair_attempts
    where profile_id = auth.uid() and attempted_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Too many tries. Wait ten minutes and try again' using errcode = '54000';
  end if;

  select * into g from public.games
  where pair_code = regexp_replace(p_code, '\D', '', 'g')
    and (pair_code_expires_at is null or pair_code_expires_at > now());

  if g.id is null or not public.may_view_game(g.id) then
    insert into public.game_pair_attempts (profile_id) values (auth.uid());
    return null;
  end if;

  if p_as_shadow then
    if not public.is_statistician() then
      raise exception 'Only statisticians can shadow a game' using errcode = '42501';
    end if;
    v_game_role := 'shadow';
  else
    v_game_role := 'viewer';
  end if;

  insert into public.game_members (game_id, profile_id, game_role)
  values (g.id, auth.uid(), v_game_role)
  on conflict (game_id, profile_id) do update
    set game_role = case
      when public.game_members.game_role = 'recorder' then 'recorder'::public.game_role
      else excluded.game_role
    end;
  return g;
end;
$$;

revoke execute on function public.pair_game(text, boolean) from public, anon;
grant execute on function public.pair_game(text, boolean) to authenticated;

-- The recorder (or an admin) moves the game on. Full time starts the pair
-- code's 24-hour expiry.
create or replace function public.set_game_status(p_game_id uuid, p_status public.game_status)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    raise exception 'No such game' using errcode = 'P0002';
  end if;
  if g.recorder_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only the recording tablet can change the game' using errcode = '42501';
  end if;
  update public.games
  set status = p_status,
      finished_at = case when p_status = 'final' then coalesce(finished_at, now()) else finished_at end,
      pair_code_expires_at = case
        when p_status = 'final' then coalesce(pair_code_expires_at, now() + interval '24 hours')
        else pair_code_expires_at
      end
  where id = p_game_id
  returning * into g;
  return g;
end;
$$;

revoke execute on function public.set_game_status(uuid, public.game_status) from public, anon;
grant execute on function public.set_game_status(uuid, public.game_status) to authenticated;

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

-- Appends a batch of events. Duplicates are ignored, so a resend after a
-- timeout is harmless. Returns the highest seq with no gap below it, which
-- the tablet uses to clear its outbox. Each event is {seq, id, type,
-- payload, recordedAt}.
create or replace function public.append_game_events(p_game_id uuid, p_stream text, p_events jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  v_last int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    raise exception 'No such game' using errcode = 'P0002';
  end if;
  if g.status = 'final' and not public.is_admin() then
    raise exception 'The game has finished' using errcode = '55000';
  end if;

  if p_stream = 'primary' then
    if g.recorder_id is distinct from auth.uid() then
      raise exception 'Another device holds the recorder lease' using errcode = '42501';
    end if;
  elsif p_stream = 'shadow:' || auth.uid()::text then
    if not exists (
      select 1 from public.game_members
      where game_id = p_game_id and profile_id = auth.uid() and game_role in ('shadow', 'recorder')
    ) then
      raise exception 'Not paired as a shadow statistician' using errcode = '42501';
    end if;
  else
    raise exception 'That stream belongs to someone else' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'Expected a list of events';
  end if;

  insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
  select p_game_id, p_stream, (e->>'seq')::int, (e->>'id')::uuid, e->>'type',
         coalesce(e->'payload', '{}'::jsonb), (e->>'recordedAt')::timestamptz, auth.uid()
  from jsonb_array_elements(p_events) e
  order by (e->>'seq')::int
  on conflict do nothing;

  select coalesce(max(seq), 0) into v_last
  from (
    select seq, row_number() over (order by seq) as rn
    from public.game_events
    where game_id = p_game_id and stream = p_stream
  ) s
  where seq = rn;
  return v_last;
end;
$$;

revoke execute on function public.append_game_events(uuid, text, jsonb) from public, anon;
grant execute on function public.append_game_events(uuid, text, jsonb) to authenticated;

-- Primary events reach Vision through the private Realtime topic game:<id>.
-- Shadow events are stored, never broadcast.
create or replace function public.broadcast_game_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stream = 'primary' then
    perform realtime.send(
      jsonb_build_object(
        'id', new.id, 'gameId', new.game_id, 'stream', new.stream, 'seq', new.seq,
        'type', new.type, 'payload', new.payload, 'recordedAt', new.recorded_at
      ),
      'event',
      'game:' || new.game_id::text,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists game_events_broadcast on public.game_events;
create trigger game_events_broadcast
  after insert on public.game_events
  for each row execute function public.broadcast_game_event();

create or replace function public.save_game_snapshot(
  p_game_id uuid,
  p_through_seq int,
  p_engine_version text,
  p_state jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    raise exception 'No such game' using errcode = 'P0002';
  end if;
  if g.recorder_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only the recording tablet saves snapshots' using errcode = '42501';
  end if;
  insert into public.game_snapshots (game_id, through_seq, engine_version, state)
  values (p_game_id, p_through_seq, p_engine_version, p_state)
  on conflict (game_id, through_seq) do update
    set engine_version = excluded.engine_version, state = excluded.state, created_at = now();
end;
$$;

revoke execute on function public.save_game_snapshot(uuid, int, text, jsonb) from public, anon;
grant execute on function public.save_game_snapshot(uuid, int, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Who can see what. Rows are made and changed through the functions above.
-- ---------------------------------------------------------------------------

drop policy if exists "Coaches and statisticians see games" on public.games;
create policy "Coaches and statisticians see games"
  on public.games for select to authenticated
  using (public.may_view_game(id));

drop policy if exists "Members see who paired with their games" on public.game_members;
create policy "Members see who paired with their games"
  on public.game_members for select to authenticated
  using (profile_id = auth.uid() or public.may_view_game(game_id));

-- Paired members read the primary stream, a shadow also their own; admins
-- read everything.
drop policy if exists "Paired members see the game's events" on public.game_events;
create policy "Paired members see the game's events"
  on public.game_events for select to authenticated
  using (
    public.is_admin()
    or (public.is_game_member(game_id) and (stream = 'primary' or stream = 'shadow:' || auth.uid()::text))
  );

drop policy if exists "Paired members see the game's snapshots" on public.game_snapshots;
create policy "Paired members see the game's snapshots"
  on public.game_snapshots for select to authenticated
  using (public.is_admin() or public.is_game_member(game_id));

-- No direct writes from the apps; game_pair_attempts has no policy, so
-- nobody reads it.
revoke insert, update, delete on public.games from anon, authenticated;
revoke insert, update, delete on public.game_members from anon, authenticated;
revoke insert, update, delete on public.game_events from anon, authenticated;
revoke insert, update, delete on public.game_snapshots from anon, authenticated;
revoke all on public.game_pair_attempts from anon, authenticated;

-- A paired member may subscribe to their game's Realtime topic.
drop policy if exists "Paired members follow their game" on realtime.messages;
create policy "Paired members follow their game"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'game:%'
    and public.is_game_member(substring(realtime.topic() from 6)::uuid)
  );

commit;
