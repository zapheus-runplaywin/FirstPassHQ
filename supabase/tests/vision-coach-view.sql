-- Tests for what FirstPass Vision, the coach's live view, reads from the
-- live game stats tables (20261015000100_game_stats.sql). Vision runs these
-- exact steps: list recent games (with the team's name), follow a game by
-- its id (follow_game, 20261115000400_follow_game.sql; no pair code since
-- then), read the primary stream after a seq in pages, and follow the
-- private Realtime topic game:<id>. Coaches and managers of the game's team
-- may; physios, athletes, guardians, other teams' coaches and signed-out
-- visitors may not. Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, pattern text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return case when sqlerrm ilike pattern then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.g(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-000000000f0' || n)::uuid $$;
-- Realtime: as on Supabase, the policy on realtime.messages is checked
-- against the channel's topic, so a member who may join reads rows.
create or replace function pg_temp.topic_rows(n int) returns bigint language plpgsql as
$$ declare r bigint; begin
     perform set_config('realtime.topic', 'game:' || pg_temp.g(n), false);
     select count(*) into r from realtime.messages;
     return r;
   end $$;
-- The game's id when following worked, null when it was refused.
create or replace function pg_temp.follow(p_game uuid) returns uuid language plpgsql as
$$ declare r uuid;
   begin select g.id into r from public.follow_game(p_game) g; return r;
   exception when others then return null; end $$;

-- Games: 1 is the Sample Team's live game (code 314159), 2 the Sample
-- Squad's (code 271828), 3 a finished game whose code has expired. Alex the
-- admin (01) is recording all three.
insert into public.games (id, team_id, config, status, recorder_id, pair_code, pair_code_expires_at, created_by) values
  (pg_temp.g(1), '00000000-0000-0000-0000-0000000000a2', '{"us":"Thunder","them":"Storm","quarterMs":600000}', 'live', pg_temp.m('01'), '314159', null, pg_temp.m('01')),
  (pg_temp.g(2), '00000000-0000-0000-0000-0000000000a1', '{"us":"Thunder","them":"Lightning"}', 'live', pg_temp.m('01'), '271828', null, pg_temp.m('01')),
  (pg_temp.g(3), '00000000-0000-0000-0000-0000000000a2', '{"us":"Thunder","them":"Hail"}', 'final', pg_temp.m('01'), '161803', now() - interval '1 hour', pg_temp.m('01'));
insert into public.game_members (game_id, profile_id, game_role)
select pg_temp.g(n), pg_temp.m('01'), 'recorder' from generate_series(1, 3) n;
-- Game 1: 1205 primary events (more than one page of 1000) and a shadow stream.
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(1), 'primary', s, gen_random_uuid(), 'action', jsonb_build_object('n', s), now(), pg_temp.m('01')
from generate_series(1, 1205) s;
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by) values
  (pg_temp.g(1), 'shadow:' || pg_temp.m('01'), 1, gen_random_uuid(), 'action', '{"shadow":true}', now(), pg_temp.m('01')),
  (pg_temp.g(2), 'primary', 1, gen_random_uuid(), 'period_start', '{}', now(), pg_temp.m('01')),
  (pg_temp.g(3), 'primary', 1, gen_random_uuid(), 'period_start', '{}', now(), pg_temp.m('01'));
-- Realtime: the stub table has no row level security of its own; turn it on
-- as Supabase does, with one stored message on each game's topic.
alter table realtime.messages enable row level security;
grant select on realtime.messages to authenticated;
insert into realtime.messages (topic, extension, payload, event)
select 'game:' || pg_temp.g(n), 'broadcast', '{}', 'event' from generate_series(1, 3) n;

-- ---------------------------------------------------------------------------
-- A coach of the game's team: Casey (11), head coach of both
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
set role authenticated;
select pg_temp.ok('coach lists the games of their teams', (select count(*) = 3 from public.games), true);
select pg_temp.ok('coach sees the team''s name with each game',
  (select count(*) = 3 from public.games g join public.teams t on t.id = g.team_id), true);
select pg_temp.ok('coach reads the setup Vantage saved', (select config->>'them' = 'Storm' from public.games where id = pg_temp.g(1)), true);
select pg_temp.ok('before following: no events', (select count(*) = 0 from public.game_events where game_id = pg_temp.g(1)), true);
select pg_temp.ok('before following: can''t follow on Realtime', pg_temp.topic_rows(1) = 0, true);
select pg_temp.ok('follows the game by its id', pg_temp.follow(pg_temp.g(1)) = pg_temp.g(1), true);
select pg_temp.ok('following again is harmless', pg_temp.follow(pg_temp.g(1)) = pg_temp.g(1), true);
select pg_temp.ok('follows as a viewer',
  (select game_role = 'viewer' from public.game_members where game_id = pg_temp.g(1) and profile_id = pg_temp.m('11')), true);
select pg_temp.ok('first page: 1000 events in seq order',
  (select count(*) = 1000 and min(seq) = 1 and max(seq) = 1000 from (
     select seq from public.game_events where game_id = pg_temp.g(1) and stream = 'primary' and seq > 0 order by seq limit 1000) p), true);
select pg_temp.ok('next page carries on after the last seq',
  (select count(*) = 205 and min(seq) = 1001 from (
     select seq from public.game_events where game_id = pg_temp.g(1) and stream = 'primary' and seq > 1000 order by seq limit 1000) p), true);
select pg_temp.ok('coach never reads the shadow stream',
  (select count(*) = 0 from public.game_events where game_id = pg_temp.g(1) and stream <> 'primary'), true);
select pg_temp.ok('follows the game on Realtime once following', pg_temp.topic_rows(1) > 0, true);
select pg_temp.ok('following one game opens only that game',
  (select count(*) = 0 from public.game_events where game_id <> pg_temp.g(1)), true);
select pg_temp.ok('and only that game''s topic', pg_temp.topic_rows(2) = 0, true);
select pg_temp.ok('a game that doesn''t exist can''t be followed', pg_temp.follow(gen_random_uuid()) is null, true);
select pg_temp.ok('the pair code no longer works for coaches',
  (select pg_temp.fails_with('x', $$select public.pair_game('314159')$$, '%Open the game from your games list%') like 'PASS%'), true);
select pg_temp.ok('coach can''t write events',
  (select pg_temp.fails_with('x', format($$insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at) values (%L, 'primary', 9999, gen_random_uuid(), 'x', '{}', now())$$, pg_temp.g(1)), '%permission denied%') like 'PASS%'), true);
select pg_temp.ok('coach can''t add to the stream through the function',
  (select pg_temp.fails_with('x', format($$select public.append_game_events(%L, 'primary', '[{"seq":1206,"id":"%s","type":"action","payload":{},"recordedAt":"2026-11-13T00:00:00Z"}]')$$, pg_temp.g(1), gen_random_uuid()), '%') like 'PASS%'), true);
reset role;

-- Emery (13) manages the Sample Squad, whose game is game 2.
select pg_temp.as_member('13');
set role authenticated;
select pg_temp.ok('manager follows the squad''s game', pg_temp.follow(pg_temp.g(2)) = pg_temp.g(2), true);
select pg_temp.ok('manager reads its primary stream', (select count(*) = 1 from public.game_events where game_id = pg_temp.g(2)), true);
select pg_temp.ok('manager follows it on Realtime', pg_temp.topic_rows(2) > 0, true);
select pg_temp.ok('manager can''t follow another team''s game', pg_temp.follow(pg_temp.g(1)) is null, true);
reset role;

-- A finished game whose old pair code expired still opens, and no number
-- of taps locks a coach out (revocation test section 5).
select pg_temp.as_member('11');
set role authenticated;
select pg_temp.ok('a finished game opens after its code expired', pg_temp.follow(pg_temp.g(3)) = pg_temp.g(3), true);
select pg_temp.ok('ten more taps all open it',
  (select bool_and(pg_temp.follow(pg_temp.g(3)) = pg_temp.g(3)) from generate_series(1, 10)), true);
select pg_temp.ok('it reads the finished game''s events', (select count(*) = 1 from public.game_events where game_id = pg_temp.g(3)), true);
reset role;
select pg_temp.ok('no failed attempts recorded for the coach',
  (select count(*) = 0 from public.game_pair_attempts where profile_id = pg_temp.m('11')), true);

-- ---------------------------------------------------------------------------
-- Members who may not follow the game
-- ---------------------------------------------------------------------------
-- Morgan (42) coaches the Sample Squad only.
select pg_temp.as_member('42');
set role authenticated;
select pg_temp.ok('another team''s coach doesn''t list the game', (select count(*) = 0 from public.games where id = pg_temp.g(1)), true);
select pg_temp.ok('another team''s coach lists their own team''s game', (select count(*) = 1 from public.games where id = pg_temp.g(2)), true);
select pg_temp.ok('another team''s coach can''t follow it', pg_temp.follow(pg_temp.g(1)) is null, true);
select pg_temp.ok('another team''s coach reads none of its events', (select count(*) = 0 from public.game_events where game_id = pg_temp.g(1)), true);
select pg_temp.ok('another team''s coach can''t follow it on Realtime', pg_temp.topic_rows(1) = 0, true);
reset role;

-- Finley the physio (14), Jordan the junior athlete (31), Kai the adult
-- athlete (32), Logan the parent (41): none of them see games.
create temp table let_in (who text, what text);
grant all on let_in to authenticated;
do $$
declare who text;
begin
  foreach who in array array['14', '31', '32', '41'] loop
    perform pg_temp.as_member(who);
    set local role authenticated;
    if (select count(*) from public.games) <> 0 then insert into let_in values (who, 'list'); end if;
    if pg_temp.follow(pg_temp.g(2)) is not null then insert into let_in values (who, 'follow_game'); end if;
    if (select count(*) from public.game_events) <> 0 then insert into let_in values (who, 'read'); end if;
    if pg_temp.topic_rows(2) <> 0 then insert into let_in values (who, 'follow'); end if;
    reset role;
  end loop;
end $$;
select pg_temp.ok('physio, athletes and parents can''t list, follow_game, read or follow: ' || coalesce((select string_agg(who || ' ' || what, ', ') from let_in), 'none let in'),
  (select count(*) = 0 from let_in), true);
select pg_temp.ok('and none of them became a game member',
  (select count(*) = 0 from public.game_members where profile_id in (pg_temp.m('14'), pg_temp.m('31'), pg_temp.m('32'), pg_temp.m('41'))), true);

-- A coach who leaves the team keeps their member row but loses the game.
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a2' and profile_id = pg_temp.m('11');
select pg_temp.as_member('11');
set role authenticated;
select pg_temp.ok('coach who left the team no longer lists its game', (select count(*) = 0 from public.games where id = pg_temp.g(1)), true);
select pg_temp.ok('coach who left the team reads none of its events', (select count(*) = 0 from public.game_events where game_id = pg_temp.g(1)), true);
select pg_temp.ok('coach who left the team can''t follow it on Realtime', pg_temp.topic_rows(1) = 0, true);
reset role;

-- Signed-out visitors reach nothing.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.ok('signed out: no games', (select pg_temp.fails_with('x', 'select count(*) from public.games', '%permission denied%') like 'PASS%'), true);
select pg_temp.ok('signed out: no events', (select pg_temp.fails_with('x', 'select count(*) from public.game_events', '%permission denied%') like 'PASS%'), true);
select pg_temp.ok('signed out: can''t pair', (select pg_temp.fails_with('x', $$select public.pair_game('314159', true)$$, '%permission denied%') like 'PASS%'), true);
select pg_temp.ok('signed out: can''t follow', (select pg_temp.fails_with('x', format('select public.follow_game(%L)', pg_temp.g(1)), '%permission denied%') like 'PASS%'), true);
reset role;
