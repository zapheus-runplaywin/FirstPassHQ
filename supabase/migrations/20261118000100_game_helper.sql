-- A helper statistician: substitutions and corrections from a second person
-- count in a game's live stats.
--
-- Matt (2026-11-17): each game is recorded by one statistician, or by one
-- with a helper. The statistician recording the game turns the helper on for
-- that game (it is off unless they do). A second statistician then joins in
-- Vantage with the game's pair code and does two jobs only: rolling
-- substitutions and corrections to what was recorded. Their changes count at
-- once for everyone following the game. Two people recording the same play
-- and comparing notes at the breaks was considered and dropped as too hard;
-- shadowing (a private second record for practice) stays as it was.
--
-- How it works:
-- - games.helper_allowed says whether the game takes a helper.
--   set_game_helper(game, on) is for the statistician recording the game, or
--   an admin. Turning it off makes the helper a viewer again.
-- - pair_game_helper(code) joins a statistician or admin to a live game as
--   its helper. One helper per game: a new helper takes over and the one
--   before becomes a viewer, the way a second tablet takes the recorder
--   lease. The statistician recording the game can't be its helper. A wrong
--   code returns null and counts toward the same five-in-ten-minutes limit as
--   pair_game.
-- - The helper writes their own stream, 'helper:<their profile id>', through
--   append_game_events, which takes only substitutions (lineup_change) and
--   corrections from a helper, checks the Statistician role on every call
--   like every other game write, and stops when the game has finished.
-- - Helper events are part of the game's record: they are broadcast on the
--   game's private Realtime topic and can be read by everyone who reads the
--   primary stream (paired members, and Studio for the games it may read;
--   studio_live returns them as "helperEvents"). A shadow statistician's
--   stream is still private to them.
--
-- Additive only: one new column with a default, a wider check on
-- game_events.stream (every existing row passes it), two new functions and
-- four replaced ones with the same signatures, so there are no overloads. No
-- rows change.

begin;

alter table public.games
  add column if not exists helper_allowed boolean not null default false;

comment on column public.games.helper_allowed is
  'Whether a second statistician may join this game as its helper (substitutions and corrections). Off unless the recorder turns it on.';

alter table public.game_events drop constraint if exists game_events_stream_check;
alter table public.game_events add constraint game_events_stream_check
  check (stream = 'primary' or stream like 'shadow:%' or stream like 'helper:%');

-- ---------------------------------------------------------------------------
-- Turning the helper on and off, and joining as the helper
-- ---------------------------------------------------------------------------

create or replace function public.set_game_helper(p_game_id uuid, p_on boolean)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.is_statistician() then
    raise exception 'Only statisticians and admins can record games' using errcode = '42501';
  end if;
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    raise exception 'No such game' using errcode = 'P0002';
  end if;
  if g.recorder_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only the recording tablet can change the game' using errcode = '42501';
  end if;
  update public.games set helper_allowed = coalesce(p_on, false)
  where id = p_game_id
  returning * into g;
  if not g.helper_allowed then
    update public.game_members set game_role = 'viewer'
    where game_id = p_game_id and game_role = 'helper';
  end if;
  return g;
end;
$$;

comment on function public.set_game_helper(uuid, boolean) is
  'Vantage: the statistician recording a game (or an admin) turns its helper on or off. Off makes the helper a viewer.';

revoke execute on function public.set_game_helper(uuid, boolean) from public, anon;
grant execute on function public.set_game_helper(uuid, boolean) to authenticated;

create or replace function public.pair_game_helper(p_code text)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.is_statistician() then
    raise exception 'Only statisticians can help with a game' using errcode = '42501';
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

  if g.id is null then
    insert into public.game_pair_attempts (profile_id) values (auth.uid());
    return null;
  end if;
  if g.status = 'final' then
    raise exception 'The game has finished' using errcode = '55000';
  end if;
  if g.recorder_id is not distinct from auth.uid() then
    raise exception 'You are recording this game' using errcode = '42501';
  end if;
  if not g.helper_allowed then
    raise exception 'The helper is turned off for this game. Ask the statistician recording it to turn it on' using errcode = '42501';
  end if;

  update public.game_members set game_role = 'viewer'
  where game_id = g.id and game_role = 'helper' and profile_id <> auth.uid();
  insert into public.game_members (game_id, profile_id, game_role)
  values (g.id, auth.uid(), 'helper')
  on conflict (game_id, profile_id) do update set game_role = 'helper';
  return g;
end;
$$;

comment on function public.pair_game_helper(text) is
  'Vantage: a second statistician joins a live game as its helper by the pair code, when the recorder has turned the helper on. One helper per game; a new one takes over.';

revoke execute on function public.pair_game_helper(text) from public, anon;
grant execute on function public.pair_game_helper(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

-- As in 20261115000300_game_writes_recheck_role.sql, plus the helper's
-- stream: substitutions and corrections only, from the game's one helper,
-- while the helper is turned on.
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
  if not public.is_statistician() then
    raise exception 'Only statisticians and admins can record games' using errcode = '42501';
  end if;
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    raise exception 'No such game' using errcode = 'P0002';
  end if;
  if g.status = 'final' and not public.is_admin() then
    raise exception 'The game has finished' using errcode = '55000';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Expected a list of events';
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
  elsif p_stream = 'helper:' || auth.uid()::text then
    if not g.helper_allowed or not exists (
      select 1 from public.game_members
      where game_id = p_game_id and profile_id = auth.uid() and game_role = 'helper'
    ) then
      raise exception 'You are no longer this game''s helper' using errcode = '42501';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_events) e
      where coalesce(e->>'type', '') not in ('lineup_change', 'correction')
    ) then
      raise exception 'A helper records substitutions and corrections only' using errcode = '42501';
    end if;
  else
    raise exception 'That stream belongs to someone else' using errcode = '42501';
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

comment on function public.append_game_events(uuid, text, jsonb) is
  'Appends a batch of game events to the primary stream (the recorder), a shadow stream, or the helper''s stream (substitutions and corrections only). Asks is_statistician() on every call (F5).';

revoke execute on function public.append_game_events(uuid, text, jsonb) from public, anon;
grant execute on function public.append_game_events(uuid, text, jsonb) to authenticated;

-- Primary and helper events reach Vision and Studio through the private
-- Realtime topic game:<id>. Shadow events are stored, never broadcast.
create or replace function public.broadcast_game_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stream = 'primary' or new.stream like 'helper:%' then
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

-- ---------------------------------------------------------------------------
-- Who reads the helper's events: whoever reads the primary stream
-- ---------------------------------------------------------------------------

alter policy "Paired members see the game's events" on public.game_events
  using (
    (select public.is_admin())
    or (
      public.is_game_member(game_id)
      and (stream = 'primary' or stream like 'helper:%' or stream = 'shadow:' || (select auth.uid())::text)
    )
  );

alter policy "Studio reads streamed games' events" on public.game_events
  using ((stream = 'primary' or stream like 'helper:%') and game_id in (select public.studio_game_ids()));

-- As in 20261113010100_studio_access.sql, plus "helperEvents": every helper
-- event of the game, oldest first (a game has a few dozen at most, so they
-- aren't paged). The snapshot and "events" are the primary stream, as before.
create or replace function public.studio_live(p_game_id uuid, p_after_seq int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_game jsonb;
  v_snapshot public.game_snapshots;
  v_from int := greatest(coalesce(p_after_seq, 0), 0);
  v_events jsonb;
  v_helper jsonb;
  v_more boolean;
begin
  if not public.can_studio_read_game(p_game_id) then
    raise exception 'Studio can only read live and finished PlayHQ games' using errcode = '42501';
  end if;

  select to_jsonb(s) into v_game
  from public.studio_games() s
  where s.id = p_game_id;

  select * into v_snapshot
  from public.game_snapshots
  where game_id = p_game_id and through_seq > v_from
  order by through_seq desc
  limit 1;
  if v_snapshot.game_id is not null then
    v_from := v_snapshot.through_seq;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'gameId', e.game_id, 'stream', e.stream, 'seq', e.seq,
           'type', e.type, 'payload', e.payload, 'recordedAt', e.recorded_at
         ) order by e.seq), '[]'::jsonb)
  into v_events
  from (
    select * from public.game_events
    where game_id = p_game_id and stream = 'primary' and seq > v_from
    order by seq
    limit 1000
  ) e;

  select exists (
    select 1 from public.game_events
    where game_id = p_game_id and stream = 'primary'
      and seq > coalesce((select max((x ->> 'seq')::int) from jsonb_array_elements(v_events) x), v_from)
  ) into v_more;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'gameId', e.game_id, 'stream', e.stream, 'seq', e.seq,
           'type', e.type, 'payload', e.payload, 'recordedAt', e.recorded_at
         ) order by e.recorded_at, e.stream, e.seq), '[]'::jsonb)
  into v_helper
  from public.game_events e
  where e.game_id = p_game_id and e.stream like 'helper:%';

  return jsonb_build_object(
    'game', v_game,
    'snapshot', case when v_snapshot.game_id is null then null else jsonb_build_object(
      'throughSeq', v_snapshot.through_seq,
      'engineVersion', v_snapshot.engine_version,
      'state', v_snapshot.state,
      'createdAt', v_snapshot.created_at
    ) end,
    'events', v_events,
    'helperEvents', v_helper,
    'more', v_more
  );
end;
$$;

revoke execute on function public.studio_live(uuid, int) from public, anon;
grant execute on function public.studio_live(uuid, int) to authenticated;

commit;
