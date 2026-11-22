-- Tests for 20261118000000_game_helper_role.sql and
-- 20261118000100_game_helper.sql: the statistician recording a game turns its
-- helper on (set_game_helper), a second statistician joins with the pair code
-- (pair_game_helper) and writes substitutions and corrections only to their
-- own stream (append_game_events), one helper per game, and whoever reads the
-- game's primary stream reads the helper's events too, Studio included.
-- Covers every kind of member. Run on a fresh database with the migrations
-- and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.g(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-000000000d0' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Fails unless the error has exactly these words and this code.
create or replace function pg_temp.refused(label text, statement text, words text, code text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm = words and sqlstate = code then 'PASS ' else 'FAIL ' end
       || label || ' (' || sqlstate || ' ' || sqlerrm || ')'; end $$;
create or replace function pg_temp.role_in(p_game uuid, n text) returns text language sql as
$$ select game_role::text from public.game_members where game_id = p_game and profile_id = pg_temp.m(n) $$;
create or replace function pg_temp.attempts(n text) returns bigint language sql as
$$ select count(*) from public.game_pair_attempts where profile_id = pg_temp.m(n) $$;
-- One event of a type, as Vantage sends it.
create or replace function pg_temp.ev(p_seq int, p_type text) returns jsonb language sql as
$$ select jsonb_build_object('seq', p_seq, 'id', gen_random_uuid(), 'type', p_type, 'payload', jsonb_build_object('n', p_seq), 'recordedAt', now()) $$;
-- The signed-in member appends to their own helper stream.
create or replace function pg_temp.helper_append(p_game uuid, p_events jsonb) returns int language sql as
$$ select public.append_game_events(p_game, 'helper:' || auth.uid()::text, p_events) $$;
-- Reads as the app does, through row level security: how many of a game's
-- events of each kind the signed-in member sees.
create or replace function pg_temp.reads(p_game uuid, p_like text) returns bigint language plpgsql as
$$ declare r bigint; begin
     set local role authenticated;
     select count(*) into r from public.game_events where game_id = p_game and stream like p_like;
     reset role;
     return r;
   end $$;
-- The stub realtime.send does nothing; keep what would be broadcast.
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as
$$ insert into realtime.messages (topic, extension, payload, event, private) values ($3, 'broadcast', $1, $2, $4) $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- 61 Sam records the games, 62 Quinn a stood-down statistician, 63 Hana and
-- 64 Ira statisticians who help, 65 Uma a guest, 66 Vic a pending newcomer,
-- 67 Nico Studio.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'stats@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'stats.stood-down@example.test', now()),
  ('00000000-0000-0000-0000-000000000063', 'stats.helper@example.test', now()),
  ('00000000-0000-0000-0000-000000000064', 'stats.helper2@example.test', now()),
  ('00000000-0000-0000-0000-000000000065', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000066', 'pending@example.test', now()),
  ('00000000-0000-0000-0000-000000000067', 'studio@example.test', now());
update public.profiles p set status = v.status::public.member_status, full_name = v.name,
  role = v.role::public.app_role, wwcc_exempt_reason = v.reason, stood_down_at = v.stood,
  date_of_birth = public.club_today() - interval '40 years', verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000061', 'Sam Stats', 'statistician', 'approved', 'Opens games only', null::timestamptz),
  ('00000000-0000-0000-0000-000000000062', 'Quinn Paused', 'statistician', 'approved', 'Opens games only', now()),
  ('00000000-0000-0000-0000-000000000063', 'Hana Helper', 'statistician', 'approved', 'Opens games only', null),
  ('00000000-0000-0000-0000-000000000064', 'Ira Helper', 'statistician', 'approved', 'Opens games only', null),
  ('00000000-0000-0000-0000-000000000065', 'Uma Guest', 'guest', 'approved', null, null),
  ('00000000-0000-0000-0000-000000000066', 'Vic Newcomer', 'guest', 'pending', null, null),
  ('00000000-0000-0000-0000-000000000067', 'Nico Studio', 'studio', 'approved', null, null)
) as v(id, name, role, status, reason, stood)
where p.id = v.id::uuid;

-- Game 1 live for Sample Team with a PlayHQ game (code 314159), game 2
-- finished (271828), game 3 live with the helper never turned on (161803).
-- Sam records all three; the head coach follows game 1.
insert into public.games (id, team_id, playhq_game_id, config, status, recorder_id, pair_code, created_by) values
  (pg_temp.g(1), '00000000-0000-0000-0000-0000000000a2', 'PHQ-H1', '{}', 'live', pg_temp.m('61'), '314159', pg_temp.m('61')),
  (pg_temp.g(2), '00000000-0000-0000-0000-0000000000a2', 'PHQ-H2', '{}', 'final', pg_temp.m('61'), '271828', pg_temp.m('61')),
  (pg_temp.g(3), '00000000-0000-0000-0000-0000000000a2', null, '{}', 'live', pg_temp.m('61'), '161803', pg_temp.m('61'));
insert into public.game_members (game_id, profile_id, game_role)
select pg_temp.g(n), pg_temp.m('61'), 'recorder' from generate_series(1, 3) n;
insert into public.game_members (game_id, profile_id, game_role) values (pg_temp.g(1), pg_temp.m('11'), 'viewer');
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(1), 'primary', s, gen_random_uuid(), 'action', '{}', now(), pg_temp.m('61') from generate_series(1, 3) s;
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by) values
  (pg_temp.g(1), 'shadow:' || pg_temp.m('64'), 1, gen_random_uuid(), 'action', '{}', now(), pg_temp.m('64'));

-- ---------------------------------------------------------------------------
-- What the migrations made
-- ---------------------------------------------------------------------------
select pg_temp.ok('helper is a game role', 'helper' = any (enum_range(null::public.game_role)::text[]), true);
select pg_temp.ok('a game takes no helper until its recorder says so', (select bool_and(not helper_allowed) from public.games), true);
select pg_temp.ok('members can call set_game_helper (it checks the role)', has_function_privilege('authenticated', 'public.set_game_helper(uuid, boolean)', 'execute'), true);
select pg_temp.ok('anon cannot call set_game_helper', has_function_privilege('anon', 'public.set_game_helper(uuid, boolean)', 'execute'), false);
select pg_temp.ok('members can call pair_game_helper (it checks the role)', has_function_privilege('authenticated', 'public.pair_game_helper(text)', 'execute'), true);
select pg_temp.ok('anon cannot call pair_game_helper', has_function_privilege('anon', 'public.pair_game_helper(text)', 'execute'), false);
select pg_temp.ok('anon cannot append events', has_function_privilege('anon', 'public.append_game_events(uuid, text, jsonb)', 'execute'), false);
select pg_temp.ok('anon cannot call studio_live', has_function_privilege('anon', 'public.studio_live(uuid, int)', 'execute'), false);
select pg_temp.ok('no overloads of the game functions',
  (select count(*) = 5 from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('set_game_helper', 'pair_game_helper', 'append_game_events', 'studio_live', 'pair_game')), true);
select pg_temp.ok('members still can''t write game events directly',
  has_table_privilege('authenticated', 'public.game_events', 'insert') or has_table_privilege('authenticated', 'public.game_events', 'update')
  or has_table_privilege('authenticated', 'public.game_members', 'update') or has_table_privilege('authenticated', 'public.games', 'update'), false);
select pg_temp.refused('a stream that is neither primary, shadow nor helper is still refused by the table',
  format($$insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at) values (%L, 'other:x', 1, gen_random_uuid(), 'action', '{}', now())$$, pg_temp.g(1)),
  'new row for relation "game_events" violates check constraint "game_events_stream_check"', '23514');

-- ---------------------------------------------------------------------------
-- While the helper is off, nobody joins as one
-- ---------------------------------------------------------------------------
select pg_temp.as_member('63');
select pg_temp.refused('a statistician can''t help while the helper is off', $$select public.pair_game_helper('314159')$$,
  'The helper is turned off for this game. Ask the statistician recording it to turn it on', '42501');
select pg_temp.ok('and gets no role in the game', pg_temp.role_in(pg_temp.g(1), '63') is null, true);
select pg_temp.ok('a right code with the helper off counts no failed attempt', pg_temp.attempts('63') = 0, true);

-- ---------------------------------------------------------------------------
-- Who turns the helper on and off
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.refused('signed out: can''t turn the helper on', format('select public.set_game_helper(%L, true)', pg_temp.g(1)), 'Sign in first', '28000');
select pg_temp.refused('signed out: can''t join as the helper', $$select public.pair_game_helper('314159')$$, 'Sign in first', '28000');
-- Everyone who isn't a statistician or admin, by kind of member.
select pg_temp.as_member(v.n),
  pg_temp.refused(v.who || ' can''t turn the helper on', format('select public.set_game_helper(%L, true)', pg_temp.g(1)),
    'Only statisticians and admins can record games', '42501'),
  pg_temp.refused(v.who || ' can''t join as the helper', $$select public.pair_game_helper('314159')$$,
    'Only statisticians can help with a game', '42501'),
  pg_temp.refused(v.who || ' can''t write a helper stream',
    format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(1, %L)))', pg_temp.g(1), 'correction'),
    'Only statisticians and admins can record games', '42501')
from (values
  ('11', 'the game''s head coach'), ('12', 'a coach with a lapsed check'), ('13', 'a manager'), ('14', 'a physio'),
  ('21', 'a committee member'), ('23', 'an exempt committee member'), ('31', 'an athlete under 18'), ('32', 'an adult athlete'),
  ('41', 'a guardian'), ('42', 'a coach who is a guardian'), ('62', 'a stood-down statistician'), ('65', 'a guest'),
  ('66', 'a pending newcomer'), ('67', 'Studio')
) as v(n, who);
select pg_temp.ok('none of them left a mark on the game',
  (select not helper_allowed from public.games where id = pg_temp.g(1))
  and (select count(*) = 2 from public.game_members where game_id = pg_temp.g(1)), true);
select pg_temp.ok('a refusal by role counts no failed attempt', (select count(*) = 0 from public.game_pair_attempts), true);

-- Another statistician isn't the recording tablet.
select pg_temp.as_member('63');
select pg_temp.refused('a statistician who isn''t recording the game can''t turn its helper on',
  format('select public.set_game_helper(%L, true)', pg_temp.g(1)), 'Only the recording tablet can change the game', '42501');
select pg_temp.refused('no such game', format('select public.set_game_helper(%L, true)', gen_random_uuid()), 'No such game', 'P0002');
-- The recorder.
select pg_temp.as_member('61');
select pg_temp.ok('the recorder turns the helper on and gets the game back',
  (select g.id = pg_temp.g(1) and g.helper_allowed from public.set_game_helper(pg_temp.g(1), true) g), true);
select pg_temp.ok('only that game changed', (select count(*) = 1 from public.games where helper_allowed), true);
select pg_temp.refused('the recorder can''t be their own helper', $$select public.pair_game_helper('314159')$$, 'You are recording this game', '42501');
select pg_temp.ok('and stays the recorder', pg_temp.role_in(pg_temp.g(1), '61') = 'recorder', true);
select pg_temp.refused('the recorder can''t write a helper stream of their own',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(1, %L)))', pg_temp.g(1), 'correction'),
  'You are no longer this game''s helper', '42501');
-- An admin.
select pg_temp.as_member('01');
select pg_temp.ok('an admin turns the helper off', (select not g.helper_allowed from public.set_game_helper(pg_temp.g(1), false) g), true);
select pg_temp.ok('and on again', (select g.helper_allowed from public.set_game_helper(pg_temp.g(1), true) g), true);
select pg_temp.ok('no answer counts as off', (select not g.helper_allowed from public.set_game_helper(pg_temp.g(3), null) g), true);

-- ---------------------------------------------------------------------------
-- Joining as the helper
-- ---------------------------------------------------------------------------
select pg_temp.as_member('63');
select pg_temp.ok('a wrong code returns nothing', (select g.id is null from public.pair_game_helper('000000') g), true);
select pg_temp.ok('and counts a failed attempt', pg_temp.attempts('63') = 1, true);
select pg_temp.refused('the helper is off for game 3', $$select public.pair_game_helper('161803')$$,
  'The helper is turned off for this game. Ask the statistician recording it to turn it on', '42501');
select pg_temp.refused('a finished game takes no helper', $$select public.pair_game_helper('271828')$$, 'The game has finished', '55000');
select pg_temp.ok('a statistician joins game 1 as its helper, the code typed with a space',
  (select g.id = pg_temp.g(1) from public.pair_game_helper('314 159') g), true);
select pg_temp.ok('and is the helper', pg_temp.role_in(pg_temp.g(1), '63') = 'helper', true);
select pg_temp.ok('joining again changes nothing',
  (select g.id = pg_temp.g(1) from public.pair_game_helper('314159') g)
  and (select count(*) = 1 from public.game_members where game_id = pg_temp.g(1) and game_role = 'helper'), true);
select pg_temp.ok('the recorder is still the recorder', pg_temp.role_in(pg_temp.g(1), '61') = 'recorder', true);

-- ---------------------------------------------------------------------------
-- What the helper writes: substitutions and corrections, nothing else
-- ---------------------------------------------------------------------------
select pg_temp.ok('the helper saves a substitution and a correction',
  pg_temp.helper_append(pg_temp.g(1), jsonb_build_array(pg_temp.ev(1, 'lineup_change'), pg_temp.ev(2, 'correction'))) = 2, true);
select pg_temp.ok('both are stored on the helper''s own stream, by the helper',
  (select count(*) = 2 and bool_and(recorded_by = pg_temp.m('63')) from public.game_events
   where game_id = pg_temp.g(1) and stream = 'helper:' || pg_temp.m('63')), true);
select pg_temp.ok('sending them again changes nothing',
  pg_temp.helper_append(pg_temp.g(1), jsonb_build_array(pg_temp.ev(1, 'lineup_change'), pg_temp.ev(2, 'correction'))) = 2
  and (select count(*) = 2 from public.game_events where game_id = pg_temp.g(1) and stream like 'helper:%'), true);
select pg_temp.ok('both were broadcast once on the game''s private topic, marked as the helper''s',
  (select count(*) = 2 and bool_and(private and event = 'event' and payload ->> 'type' in ('lineup_change', 'correction'))
   from realtime.messages where topic = 'game:' || pg_temp.g(1) and payload ->> 'stream' = 'helper:' || pg_temp.m('63')), true);
select pg_temp.ok('a shadow statistician''s events are still never broadcast',
  (select count(*) = 0 from realtime.messages where payload ->> 'stream' like 'shadow:%'), true);
select pg_temp.refused(v.type || ' is refused from a helper',
    format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(3, %L)))', pg_temp.g(1), v.type),
    'A helper records substitutions and corrections only', '42501')
from (values ('action'), ('flag'), ('clock_start'), ('clock_stop'), ('period_start'), ('period_end'), ('anything')) as v(type);
select pg_temp.refused('one stat hidden in a batch of corrections refuses the whole batch',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(3, %L), pg_temp.ev(4, %L)))', pg_temp.g(1), 'correction', 'action'),
  'A helper records substitutions and corrections only', '42501');
select pg_temp.refused('an event with no type is refused',
  format($$select pg_temp.helper_append(%L, '[{"seq": 3, "id": "%s", "recordedAt": "2026-11-18T00:00:00Z"}]')$$, pg_temp.g(1), gen_random_uuid()),
  'A helper records substitutions and corrections only', '42501');
select pg_temp.ok('nothing refused was stored', (select count(*) = 2 from public.game_events where game_id = pg_temp.g(1) and stream like 'helper:%'), true);
select pg_temp.refused('the helper can''t write the primary stream',
  format('select public.append_game_events(%L, %L, jsonb_build_array(pg_temp.ev(4, %L)))', pg_temp.g(1), 'primary', 'action'),
  'Another device holds the recorder lease', '42501');
select pg_temp.refused('the helper can''t write someone else''s helper stream',
  format('select public.append_game_events(%L, %L, jsonb_build_array(pg_temp.ev(1, %L)))', pg_temp.g(1), 'helper:' || pg_temp.m('64'), 'correction'),
  'That stream belongs to someone else', '42501');
select pg_temp.refused('the helper of game 1 isn''t the helper of game 3',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(1, %L)))', pg_temp.g(3), 'correction'),
  'You are no longer this game''s helper', '42501');
select pg_temp.refused('helper events must be a list',
  format($$select pg_temp.helper_append(%L, '{}')$$, pg_temp.g(1)), 'Expected a list of events', 'P0001');
-- The recorder is not held up by any of it.
select pg_temp.as_member('61');
select pg_temp.ok('the recorder keeps recording',
  public.append_game_events(pg_temp.g(1), 'primary', jsonb_build_array(pg_temp.ev(4, 'action'))) = 4, true);

-- ---------------------------------------------------------------------------
-- One helper per game: a new one takes over
-- ---------------------------------------------------------------------------
select pg_temp.as_member('64');
select pg_temp.ok('a second statistician joins as the helper', (select g.id = pg_temp.g(1) from public.pair_game_helper('314159') g), true);
select pg_temp.ok('and is now the helper', pg_temp.role_in(pg_temp.g(1), '64') = 'helper', true);
select pg_temp.ok('the helper before is a viewer', pg_temp.role_in(pg_temp.g(1), '63') = 'viewer', true);
select pg_temp.ok('there is one helper', (select count(*) = 1 from public.game_members where game_id = pg_temp.g(1) and game_role = 'helper'), true);
select pg_temp.ok('the new helper starts their own stream at 1',
  pg_temp.helper_append(pg_temp.g(1), jsonb_build_array(pg_temp.ev(1, 'correction'))) = 1, true);
select pg_temp.as_member('63');
select pg_temp.refused('the helper before can''t save any more',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(3, %L)))', pg_temp.g(1), 'correction'),
  'You are no longer this game''s helper', '42501');
select pg_temp.ok('what they saved before stays with the game',
  (select count(*) = 2 from public.game_events where game_id = pg_temp.g(1) and stream = 'helper:' || pg_temp.m('63')), true);
-- An admin can help too.
select pg_temp.as_member('02');
select pg_temp.ok('an admin joins as the helper', (select g.id = pg_temp.g(1) from public.pair_game_helper('314159') g), true);
select pg_temp.ok('and the statistician before is a viewer', pg_temp.role_in(pg_temp.g(1), '64') = 'viewer', true);
select pg_temp.as_member('64');
select pg_temp.works('the statistician takes it back', $$select public.pair_game_helper('314159')$$);

-- ---------------------------------------------------------------------------
-- Turning the helper off, a stand-down and full time all stop the helper
-- ---------------------------------------------------------------------------
select pg_temp.as_member('61');
select pg_temp.works('the recorder turns the helper off', format('select public.set_game_helper(%L, false)', pg_temp.g(1)));
select pg_temp.ok('the helper is a viewer again', pg_temp.role_in(pg_temp.g(1), '64') = 'viewer', true);
select pg_temp.ok('nobody else''s role changed',
  pg_temp.role_in(pg_temp.g(1), '61') = 'recorder' and pg_temp.role_in(pg_temp.g(1), '11') = 'viewer', true);
select pg_temp.as_member('64');
select pg_temp.refused('the helper can''t save once it is off',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(2, %L)))', pg_temp.g(1), 'correction'),
  'You are no longer this game''s helper', '42501');
select pg_temp.as_member('61');
select pg_temp.works('the recorder turns it on again', format('select public.set_game_helper(%L, true)', pg_temp.g(1)));
select pg_temp.as_member('64');
select pg_temp.refused('turning it on again doesn''t bring the old helper back',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(2, %L)))', pg_temp.g(1), 'correction'),
  'You are no longer this game''s helper', '42501');
select pg_temp.works('they join again with the code', $$select public.pair_game_helper('314159')$$);
select pg_temp.ok('and save again', pg_temp.helper_append(pg_temp.g(1), jsonb_build_array(pg_temp.ev(2, 'correction'))) = 2, true);
-- A helper stood down mid-game stops at once.
update public.profiles set stood_down_at = now() where id = pg_temp.m('64');
select pg_temp.refused('a helper stood down mid-game can''t save another change',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(3, %L)))', pg_temp.g(1), 'correction'),
  'Only statisticians and admins can record games', '42501');
select pg_temp.refused('or join again', $$select public.pair_game_helper('314159')$$, 'Only statisticians can help with a game', '42501');
update public.profiles set stood_down_at = null where id = pg_temp.m('64');
select pg_temp.ok('with the stand-down lifted they carry on', pg_temp.helper_append(pg_temp.g(1), jsonb_build_array(pg_temp.ev(3, 'lineup_change'))) = 3, true);
-- Five wrong codes lock a member out of joining, as for a shadow.
select pg_temp.as_member('63');
select pg_temp.ok('four more wrong codes', (select count(*) = 4 from generate_series(1, 4) n, public.pair_game_helper('99999' || n::text) g where g.id is null), true);
select pg_temp.refused('the sixth try is locked out, even with the right code', $$select public.pair_game_helper('314159')$$,
  'Too many tries. Wait ten minutes and try again', '54000');

-- ---------------------------------------------------------------------------
-- Who reads the helper's events: whoever reads the primary stream
-- ---------------------------------------------------------------------------
-- Game 1 now holds 4 primary events, 5 helper events (2 from Hana, 3 from
-- Ira, none from the admin) and Ira's 1 shadow event.
select pg_temp.ok('game 1 holds 4 primary, 5 helper and 1 shadow event',
  (select count(*) filter (where stream = 'primary') = 4 and count(*) filter (where stream like 'helper:%') = 5
     and count(*) filter (where stream like 'shadow:%') = 1 from public.game_events where game_id = pg_temp.g(1)), true);
select pg_temp.as_member('11');
select pg_temp.ok('the game''s coach, following it, reads the helper''s events with the primary stream',
  pg_temp.reads(pg_temp.g(1), 'primary') = 4 and pg_temp.reads(pg_temp.g(1), 'helper:%') = 5, true);
select pg_temp.ok('but never a shadow statistician''s', pg_temp.reads(pg_temp.g(1), 'shadow:%') = 0, true);
select pg_temp.as_member('61');
select pg_temp.ok('the recorder reads the helper''s events', pg_temp.reads(pg_temp.g(1), 'helper:%') = 5, true);
select pg_temp.as_member('63');
select pg_temp.ok('a helper who was replaced still reads the game as a viewer', pg_temp.reads(pg_temp.g(1), '%') = 9, true);
select pg_temp.as_member('64');
select pg_temp.ok('the helper reads everything and their own shadow stream', pg_temp.reads(pg_temp.g(1), '%') = 10, true);
select pg_temp.as_member('01');
select pg_temp.ok('an admin reads every stream', pg_temp.reads(pg_temp.g(1), '%') = 10, true);
select pg_temp.as_member(v.n), pg_temp.ok(v.who || ' reads none of the game''s events', pg_temp.reads(pg_temp.g(1), '%') = 0, true)
from (values
  ('12', 'a coach with a lapsed check'), ('13', 'a manager who hasn''t opened the game'), ('14', 'a physio'), ('21', 'a committee member'),
  ('31', 'an athlete under 18'), ('32', 'an adult athlete'), ('41', 'a guardian'), ('62', 'a stood-down statistician'),
  ('65', 'a guest'), ('66', 'a pending newcomer')
) as v(n, who);
-- Studio reads the helper's events of the games it may read, and no shadow.
select pg_temp.as_member('67');
select pg_temp.ok('Studio reads the helper''s events of a live PlayHQ game, and no shadow stream',
  pg_temp.reads(pg_temp.g(1), 'primary') = 4 and pg_temp.reads(pg_temp.g(1), 'helper:%') = 5 and pg_temp.reads(pg_temp.g(1), 'shadow:%') = 0, true);
select pg_temp.ok('studio_live returns the helper''s events beside the primary ones',
  (select jsonb_array_length(r -> 'events') = 4 and jsonb_array_length(r -> 'helperEvents') = 5 and not (r -> 'more')::boolean
   from public.studio_live(pg_temp.g(1)) r), true);
select pg_temp.ok('events are still the primary stream only',
  (select bool_and(e ->> 'stream' = 'primary') from public.studio_live(pg_temp.g(1)) r, jsonb_array_elements(r -> 'events') e), true);
select pg_temp.ok('helperEvents are the helpers'' streams only, each with its id, seq, type and time',
  (select bool_and(e ->> 'stream' like 'helper:%' and e ? 'id' and e ? 'seq' and e ? 'recordedAt' and e ->> 'type' in ('lineup_change', 'correction'))
   from public.studio_live(pg_temp.g(1)) r, jsonb_array_elements(r -> 'helperEvents') e), true);
select pg_temp.ok('asked for after a later seq, every helper event still comes',
  (select jsonb_array_length(r -> 'events') = 0 and jsonb_array_length(r -> 'helperEvents') = 5 from public.studio_live(pg_temp.g(1), 4) r), true);
select pg_temp.ok('a game with no helper has an empty list',
  (select r -> 'helperEvents' = '[]'::jsonb from public.studio_live(pg_temp.g(2)) r), true);

-- ---------------------------------------------------------------------------
-- Full time
-- ---------------------------------------------------------------------------
select pg_temp.as_member('61');
select pg_temp.works('the recorder finishes the game', format($$select public.set_game_status(%L, 'final')$$, pg_temp.g(1)));
select pg_temp.as_member('64');
select pg_temp.refused('the helper can''t change a finished game',
  format('select pg_temp.helper_append(%L, jsonb_build_array(pg_temp.ev(4, %L)))', pg_temp.g(1), 'correction'),
  'The game has finished', '55000');
select pg_temp.ok('row counts: 4 primary, 5 helper and 1 shadow event at the end',
  (select count(*) = 10 from public.game_events where game_id = pg_temp.g(1)), true);
