-- A stood-down statistician stops recording at once (security audit finding
-- F5, cross-product review 2026-11-15).
--
-- create_game asks is_statistician(), but the calls a tablet keeps making
-- once a game is under way only checked the recorder lease or the shadow
-- pairing: append_game_events (primary and shadow streams), set_game_status
-- and save_game_snapshot. So a statistician who was stood down, lost the
-- role, or whose Working With Children Check lapsed mid-game kept writing to
-- the game until it ended. Each of the four now asks is_statistician()
-- (statisticians who hold the role today, and admins) on every call, before
-- anything else about the game, and refuses with the same words and code as
-- create_game:
--
--   'Only statisticians and admins can record games'  (errcode 42501)
--
-- Vantage shows that message, so keep the wording stable.
--
-- Nothing else changes: the lease, shadow pairing, finished-game and
-- duplicate rules, and who can read, are as in 20261015000100_game_stats.sql.
-- No table or row is touched; the functions keep their signatures, so there
-- are no new overloads and the grants carry over (restated below).

begin;

create or replace function public.set_game_status(p_game_id uuid, p_status public.game_status)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
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
  if not public.is_statistician() then
    raise exception 'Only statisticians and admins can record games' using errcode = '42501';
  end if;
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

comment on function public.append_game_events(uuid, text, jsonb) is
  'Appends a batch of game events. Asks is_statistician() on every call, so a stand-down, a removed role or a lapsed check stops recording at once (F5).';
comment on function public.set_game_status(uuid, public.game_status) is
  'The recorder (or an admin) moves the game on. Asks is_statistician() on every call (F5).';
comment on function public.save_game_snapshot(uuid, int, text, jsonb) is
  'The recorder (or an admin) saves a break snapshot. Asks is_statistician() on every call (F5).';

commit;
