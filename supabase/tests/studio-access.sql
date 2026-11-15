-- Tests for 20261113010000_studio_role.sql and 20261113010100_studio_access.sql:
-- the read-only Studio role FirstPass Studio signs in with, and the consent to
-- show a child's stats on a live stream. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- A refusal by privileges or row level security (SQLSTATE 42501).
create or replace function pg_temp.refused(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when insufficient_privilege then return 'PASS ' || label || ' (' || sqlerrm || ')';
   when others then return 'FAIL ' || label || ' (wrong error: ' || sqlerrm || ')'; end $$;
-- Refused with a message that names the reason.
create or replace function pg_temp.fails_with(label text, statement text, pattern text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return case when sqlerrm ilike pattern then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.n(q text) returns bigint language plpgsql as
$$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r; end $$;
-- The game ids used below.
create or replace function pg_temp.g(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-000000000e0' || n)::uuid $$;

-- Sample people for this file: Nico (51) streams for the club with Studio as
-- their only role; Oakley (52) is a stood-down Studio operator; Parker (53)
-- asked to join as Studio and is still waiting; Emery the manager (13) also
-- runs the stream, with Studio as a second role.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'studio@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'studio.stood-down@example.test', now()),
  ('00000000-0000-0000-0000-000000000053', 'studio.pending@example.test', now());
update public.profiles set status = 'approved', full_name = 'Nico Studio', role = 'studio'
where id = pg_temp.m('51');
update public.profiles set status = 'approved', full_name = 'Oakley Studio', role = 'studio', stood_down_at = now()
where id = pg_temp.m('52');
update public.profiles set status = 'pending', full_name = 'Parker Studio', requested_role = 'studio', join_requested_at = now()
where id = pg_temp.m('53');
update public.profiles set extra_roles = '{studio}' where id = pg_temp.m('13');

-- Games: 1 live and 2 finished PlayHQ games (the stream's), 3 a scratch game
-- with no PlayHQ id, 4 a PlayHQ game still being set up, 5 a blank PlayHQ id.
insert into public.games (id, team_id, playhq_game_id, config, status, recorder_id, pair_code, created_by) values
  (pg_temp.g(1), '00000000-0000-0000-0000-0000000000a2', 'PHQ-1', '{"us":"Thunder","them":"Storm"}', 'live', pg_temp.m('01'), '111111', pg_temp.m('01')),
  (pg_temp.g(2), '00000000-0000-0000-0000-0000000000a1', 'PHQ-2', '{"us":"Thunder","them":"Lightning"}', 'final', pg_temp.m('01'), '222222', pg_temp.m('01')),
  (pg_temp.g(3), '00000000-0000-0000-0000-0000000000a2', null, '{}', 'live', pg_temp.m('01'), '333333', pg_temp.m('01')),
  (pg_temp.g(4), '00000000-0000-0000-0000-0000000000a2', 'PHQ-4', '{}', 'setup', pg_temp.m('01'), '444444', pg_temp.m('01')),
  (pg_temp.g(5), '00000000-0000-0000-0000-0000000000a2', '  ', '{}', 'live', pg_temp.m('01'), '555555', pg_temp.m('01'));
insert into public.game_members (game_id, profile_id, game_role) values
  (pg_temp.g(1), pg_temp.m('01'), 'recorder'),
  (pg_temp.g(1), pg_temp.m('11'), 'viewer');
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(1), 'primary', s, gen_random_uuid(), 'action', jsonb_build_object('n', s), now(), pg_temp.m('01')
from generate_series(1, 3) s;
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by) values
  (pg_temp.g(1), 'shadow:' || pg_temp.m('01'), 1, gen_random_uuid(), 'action', '{"shadow":true}', now(), pg_temp.m('01')),
  (pg_temp.g(3), 'primary', 1, gen_random_uuid(), 'action', '{}', now(), pg_temp.m('01')),
  (pg_temp.g(4), 'primary', 1, gen_random_uuid(), 'action', '{}', now(), pg_temp.m('01'));
-- Game 2 has 1001 events, more than one catch-up call returns.
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(2), 'primary', s, gen_random_uuid(), 'action', '{}', now(), pg_temp.m('01')
from generate_series(1, 1001) s;
insert into public.game_snapshots (game_id, through_seq, engine_version, state) values
  (pg_temp.g(1), 2, '1', '{"q":1}'),
  (pg_temp.g(3), 1, '1', '{}');

-- Realtime: the stub table has no row level security of its own. As on
-- Supabase, the policy is checked against the channel's topic
-- (realtime.topic()), so a member who may join reads the rows, and one who
-- may not reads none.
alter table realtime.messages enable row level security;
grant select on realtime.messages to authenticated;
insert into realtime.messages (topic, extension, payload, event) values
  ('game:' || pg_temp.g(1), 'broadcast', '{}', 'event'),
  ('game:' || pg_temp.g(3), 'broadcast', '{}', 'event');
create or replace function pg_temp.topic_rows(n int) returns bigint language plpgsql as
$$ declare r bigint; begin
     perform set_config('realtime.topic', 'game:' || pg_temp.g(n), false);
     select count(*) into r from realtime.messages;
     return r;
   end $$;

-- The code of conduct is on, to check who it asks.
update public.safeguarding_settings set conduct_each_season = true, code_of_conduct_url = 'https://example.com/conduct' where id;

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------
select pg_temp.as_member('51');
select pg_temp.ok('Studio operator holds the role', public.has_role('studio'), true);
select pg_temp.ok('Studio on its own isn''t an approved club member', public.is_approved(), false);
select pg_temp.ok('Studio isn''t a statistician', public.is_statistician(), false);
select pg_temp.ok('Studio isn''t an admin', public.is_admin(), false);
select pg_temp.ok('Studio needs no Working With Children Check', public.needs_wwcc('{studio}', null), false);
select pg_temp.ok('Studio on its own isn''t asked for the code of conduct', public.conduct_required(pg_temp.m('51')), false);
select pg_temp.ok('a manager who also runs Studio is still asked for it', public.conduct_required(pg_temp.m('13')), true);
select pg_temp.ok('Studio goes with other roles', public.role_combination_problem('{manager,studio}', null, false) is null, true);
select pg_temp.as_member('52');
select pg_temp.ok('a stand-down pauses Studio', public.has_role('studio'), false);
select pg_temp.as_member('53');
select pg_temp.ok('Studio waiting for approval doesn''t hold it', public.has_role('studio'), false);
select pg_temp.as_member('13');
select pg_temp.ok('manager with Studio holds it', public.has_role('studio'), true);
select pg_temp.ok('manager with Studio is still an approved member', public.is_approved(), true);

-- ---------------------------------------------------------------------------
-- Which games Studio reads
-- ---------------------------------------------------------------------------
select pg_temp.as_member('51');
select pg_temp.ok('Studio reads the live and the finished PlayHQ game, nothing else',
  (select array_agg(id order by id) = array[pg_temp.g(1), pg_temp.g(2)] from public.studio_game_ids() id), true);
select pg_temp.ok('can_studio_read_game: live PlayHQ game', public.can_studio_read_game(pg_temp.g(1)), true);
select pg_temp.ok('can_studio_read_game: finished PlayHQ game', public.can_studio_read_game(pg_temp.g(2)), true);
select pg_temp.ok('can_studio_read_game: not a scratch game', public.can_studio_read_game(pg_temp.g(3)), false);
select pg_temp.ok('can_studio_read_game: not a game being set up', public.can_studio_read_game(pg_temp.g(4)), false);
select pg_temp.ok('can_studio_read_game: not a blank PlayHQ id', public.can_studio_read_game(pg_temp.g(5)), false);
select pg_temp.ok('can_studio_read_game: not a game that doesn''t exist', public.can_studio_read_game(gen_random_uuid()), false);

-- Row level security, as the app's role.
set role authenticated;
select pg_temp.ok('Studio reads the primary events of its games (3 + 1001)',
  (select count(*) = 1004 from public.game_events), true);
select pg_temp.ok('Studio never reads a shadow stream',
  (select count(*) = 0 from public.game_events where stream <> 'primary'), true);
select pg_temp.ok('Studio reads no events of a scratch game or one being set up',
  (select count(*) = 0 from public.game_events where game_id in (pg_temp.g(3), pg_temp.g(4))), true);
select pg_temp.ok('Studio reads the snapshot of its game, not the scratch game''s',
  (select array_agg(game_id) = array[pg_temp.g(1)] from public.game_snapshots), true);
select pg_temp.ok('Studio can''t read the games table (pair codes, recorder)', (select count(*) = 0 from public.games), true);
select pg_temp.ok('Studio can''t see who paired', (select count(*) = 0 from public.game_members), true);
select pg_temp.ok('Studio can''t read fixtures', (select count(*) = 0 from public.fixtures), true);
select pg_temp.ok('Studio follows its live game on Realtime', pg_temp.topic_rows(1) > 0, true);
select pg_temp.ok('Studio can''t follow a scratch game on Realtime', pg_temp.topic_rows(3) = 0, true);
select pg_temp.ok('Studio can''t follow a game being set up on Realtime', pg_temp.topic_rows(4) = 0, true);
reset role;

-- Every other table: nothing but their own profile and the squad and team
-- names every signed-in member sees.
create temp table studio_reads (tbl text, n bigint);
grant all on studio_reads to authenticated;
do $$
declare t record; r bigint;
begin
  perform pg_temp.as_member('51');
  set local role authenticated;
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind in ('r', 'v', 'p')
      and has_table_privilege('authenticated', c.oid, 'select')
    order by 1
  loop
    execute format('select count(*) from public.%I', t.relname) into r;
    insert into studio_reads values (t.relname, r);
  end loop;
end $$;
reset role;
select pg_temp.ok('Studio reads only its own profile', (select n = 1 from studio_reads where tbl = 'profiles'), true);
select 'FAIL Studio reads ' || n || ' rows of ' || tbl from studio_reads
where n > 0 and tbl not in ('profiles', 'teams', 'game_events', 'game_snapshots');
select pg_temp.ok('Studio reads no other table (checked ' || count(*) || ')',
  count(*) filter (where n > 0 and tbl not in ('profiles', 'teams', 'game_events', 'game_snapshots')) = 0, true)
from studio_reads;

-- The club's other read functions give Studio nothing.
select pg_temp.as_member('51');
select pg_temp.ok('Vantage line-up: nothing for Studio', (select count(*) = 0 from public.game_lineup('00000000-0000-0000-0000-0000000000a2')), true);
select pg_temp.ok('no injuries for Studio', (select count(*) = 0 from public.visible_injuries()), true);
select pg_temp.ok('no squad roster for Studio', pg_temp.n($q$select * from public.team_roster('00000000-0000-0000-0000-0000000000a1')$q$) = 0, true);

-- ---------------------------------------------------------------------------
-- studio_games and studio_live
-- ---------------------------------------------------------------------------
select pg_temp.as_member('51');
select pg_temp.ok('studio_games lists the two streamed games, newest first',
  (select count(*) = 2 from public.studio_games()), true);
select pg_temp.ok('studio_games gives the PlayHQ id, team and setup',
  (select playhq_game_id = 'PHQ-1' and team_name = 'Sample Team' and config ->> 'them' = 'Storm' and status = 'live'
   from public.studio_games() where id = pg_temp.g(1)), true);
select pg_temp.ok('studio_games has no pair code, recorder, device or who made it',
  (select bool_and(not (to_jsonb(s) ?| array['pair_code', 'recorder_id', 'recorder_device_id', 'created_by', 'lease_taken_at']))
   from public.studio_games() s), true);
select pg_temp.ok('studio_live from the start: header, latest snapshot and the events after it',
  (select (r -> 'game' ->> 'playhq_game_id') = 'PHQ-1'
      and (r -> 'snapshot' ->> 'throughSeq')::int = 2
      and r -> 'snapshot' -> 'state' = '{"q":1}'
      and jsonb_array_length(r -> 'events') = 1
      and (r -> 'events' -> 0 ->> 'seq')::int = 3
      and r -> 'events' -> 0 ->> 'stream' = 'primary'
      and not (r ->> 'more')::boolean
      and not (r -> 'game' ? 'pair_code')
   from public.studio_live(pg_temp.g(1)) r), true);
select pg_temp.ok('studio_live after seq 2: no older snapshot, just event 3',
  (select r -> 'snapshot' = 'null'::jsonb and jsonb_array_length(r -> 'events') = 1
   from public.studio_live(pg_temp.g(1), 2) r), true);
select pg_temp.ok('studio_live after seq 3: nothing new',
  (select jsonb_array_length(r -> 'events') = 0 and not (r ->> 'more')::boolean
   from public.studio_live(pg_temp.g(1), 3) r), true);
select pg_temp.ok('studio_live never returns the shadow stream',
  (select bool_and(e ->> 'stream' = 'primary') from public.studio_live(pg_temp.g(1), 0) r, jsonb_array_elements(r -> 'events') e), true);
select pg_temp.ok('studio_live returns 1000 events at a time and says there are more',
  (select jsonb_array_length(r -> 'events') = 1000 and (r -> 'events' -> 999 ->> 'seq')::int = 1000 and (r ->> 'more')::boolean
   from public.studio_live(pg_temp.g(2)) r), true);
select pg_temp.ok('studio_live: the rest on the next call',
  (select jsonb_array_length(r -> 'events') = 1 and (r -> 'events' -> 0 ->> 'seq')::int = 1001 and not (r ->> 'more')::boolean
   from public.studio_live(pg_temp.g(2), 1000) r), true);
select pg_temp.refused('studio_live: not a scratch game', format('select public.studio_live(%L)', pg_temp.g(3)));
select pg_temp.refused('studio_live: not a game being set up', format('select public.studio_live(%L)', pg_temp.g(4)));
select pg_temp.refused('studio_live: not a blank PlayHQ id', format('select public.studio_live(%L)', pg_temp.g(5)));

-- ---------------------------------------------------------------------------
-- Studio writes nothing
-- ---------------------------------------------------------------------------
select pg_temp.as_member('51');
select pg_temp.fails('Studio can''t start a game', $$select public.create_game(gen_random_uuid(), '{}'::jsonb, 'studio-mac')$$);
select pg_temp.fails('Studio can''t take over a game', format($$select public.create_game(%L, '{}'::jsonb, 'studio-mac')$$, pg_temp.g(1)));
select pg_temp.fails('Studio can''t add events',
  format($$select public.append_game_events(%L, 'primary', '[{"seq":4,"id":"%s","type":"x","recordedAt":"2026-11-13T00:00:00Z"}]')$$, pg_temp.g(1), gen_random_uuid()));
select pg_temp.fails('Studio can''t write a shadow stream',
  format($$select public.append_game_events(%L, %L, '[{"seq":1,"id":"%s","type":"x","recordedAt":"2026-11-13T00:00:00Z"}]')$$, pg_temp.g(1), 'shadow:' || pg_temp.m('51'), gen_random_uuid()));
select pg_temp.fails('Studio can''t save a snapshot', format($$select public.save_game_snapshot(%L, 3, '1', '{}')$$, pg_temp.g(1)));
select pg_temp.fails('Studio can''t end a game', format($$select public.set_game_status(%L, 'final')$$, pg_temp.g(1)));
select pg_temp.ok('Studio can''t pair with a game''s code', (select g.id is null from public.pair_game('111111', true) g), true);
select pg_temp.fails('Studio can''t follow a game', format($$select public.follow_game(%L)$$, pg_temp.g(1)));
set role authenticated;
select pg_temp.refused('Studio can''t insert events directly',
  format($$insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at) values (%L, 'primary', 9, gen_random_uuid(), 'x', '{}', now())$$, pg_temp.g(1)));
select pg_temp.refused('Studio can''t change a game directly', format($$update public.games set status = 'final' where id = %L$$, pg_temp.g(1)));
select pg_temp.refused('Studio can''t change a snapshot directly', $$update public.game_snapshots set state = '{}'$$);
reset role;
select pg_temp.ok('the game is unchanged', (select status = 'live' and recorder_id = pg_temp.m('01') from public.games where id = pg_temp.g(1)), true);
select pg_temp.ok('no events were added', (select count(*) = 1 + 3 + 1 + 1 + 1001 from public.game_events), true);

-- ---------------------------------------------------------------------------
-- Everyone else, and Studio once paused
-- ---------------------------------------------------------------------------
create temp table others_studio (who text, problem text);
grant all on others_studio to authenticated;
do $$
declare who text;
begin
  foreach who in array array['01', '02', '11', '12', '14', '21', '22', '23', '31', '32', '41', '42', '52', '53'] loop
    perform pg_temp.as_member(who);
    if exists (select 1 from public.studio_game_ids()) then
      insert into others_studio values (who, 'reads games as Studio');
    end if;
    if public.can_studio_read_game(pg_temp.g(1)) then
      insert into others_studio values (who, 'can_studio_read_game is true');
    end if;
    begin
      perform public.studio_live(pg_temp.g(1));
      insert into others_studio values (who, 'called studio_live');
    exception when insufficient_privilege then null;
    end;
    begin
      perform * from public.studio_lineup(pg_temp.g(1));
      insert into others_studio values (who, 'called studio_lineup');
    exception when insufficient_privilege then null;
    end;
    if exists (select 1 from public.studio_games()) then
      insert into others_studio values (who, 'lists Studio games');
    end if;
  end loop;
end $$;
select 'FAIL member ' || who || ' ' || problem from others_studio;
select pg_temp.ok('no other member, nor Studio stood down or waiting, reads as Studio', (select count(*) = 0 from others_studio), true);
select pg_temp.as_member('52');
select pg_temp.ok('stood-down Studio: no games', (select count(*) = 0 from public.studio_games()), true);
set role authenticated;
select pg_temp.ok('stood-down Studio: no events', (select count(*) = 0 from public.game_events), true);
select pg_temp.ok('stood-down Studio: no Realtime', pg_temp.topic_rows(1) = 0, true);
reset role;
select pg_temp.as_member('53');
set role authenticated;
select pg_temp.ok('Studio waiting for approval: no events', (select count(*) = 0 from public.game_events), true);
reset role;
-- An admin stands a Studio operator down, which pauses the role.
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t stand Studio down', format('select public.admin_stand_down(%L, %L, null)', pg_temp.m('51'), 'allegation'));
select pg_temp.as_member('01');
select pg_temp.works('an admin can stand Studio down', format('select public.admin_stand_down(%L, %L, null)', pg_temp.m('51'), 'allegation'));
select pg_temp.as_member('51');
select pg_temp.ok('stood down by an admin: no games', (select count(*) = 0 from public.studio_game_ids()), true);
update public.profiles set stood_down_at = null where id = pg_temp.m('51');
-- Removing the role cuts Studio off at once.
update public.profiles set role = 'guest' where id = pg_temp.m('51');
select pg_temp.as_member('51');
select pg_temp.ok('without the role: no games', (select count(*) = 0 from public.studio_game_ids()), true);
select pg_temp.refused('without the role: no studio_live', format('select public.studio_live(%L)', pg_temp.g(1)));
update public.profiles set role = 'studio' where id = pg_temp.m('51');
-- A manager with Studio reads the same as Studio, on top of their own role.
select pg_temp.as_member('13');
select pg_temp.ok('manager with Studio reads the streamed games', (select count(*) = 2 from public.studio_game_ids()), true);
select pg_temp.ok('manager with Studio: studio_live works', (select jsonb_array_length(r -> 'events') = 1 from public.studio_live(pg_temp.g(1)) r), true);
set role authenticated;
select pg_temp.ok('manager with Studio: still no shadow stream', (select count(*) = 0 from public.game_events where stream <> 'primary'), true);
reset role;
-- Admins and coaches keep their own access, unchanged.
select pg_temp.as_member('01');
set role authenticated;
select pg_temp.ok('admin still reads every event, shadow included', (select count(*) = 1007 from public.game_events), true);
reset role;
select pg_temp.as_member('11');
set role authenticated;
select pg_temp.ok('paired coach still reads their game''s primary stream', (select count(*) = 3 from public.game_events where game_id = pg_temp.g(1)), true);
select pg_temp.ok('paired coach follows their game on Realtime', pg_temp.topic_rows(1) > 0, true);
select pg_temp.ok('coach doesn''t follow a game they haven''t paired with', pg_temp.topic_rows(3) = 0, true);
reset role;
-- Signed out.
set role anon;
select pg_temp.fails('signed-out visitors can''t call studio_live', format('select public.studio_live(%L)', pg_temp.g(1)));
select pg_temp.fails('signed-out visitors can''t call studio_games', 'select * from public.studio_games()');
select pg_temp.fails('signed-out visitors can''t call studio_lineup', format('select * from public.studio_lineup(%L)', pg_temp.g(1)));
select pg_temp.fails('signed-out visitors can''t give publish consent', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
reset role;

-- ---------------------------------------------------------------------------
-- Messages, surveys and awards leave a Studio-only member out
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.fails_with('admins can''t message the Studio role', $$select public.send_group_message('Hello', 'role', 'studio')$$, '%Studio don''t get messages%');
create temp table club_message as select public.send_group_message('Club news', 'club') as id;
select pg_temp.ok('a club message doesn''t reach Studio on its own',
  (select count(*) = 0 from public.message_recipients r join club_message m on m.id = r.message_id where r.profile_id = pg_temp.m('51')), true);
select pg_temp.ok('a club message reaches the manager who also runs Studio',
  (select count(*) = 1 from public.message_recipients r join club_message m on m.id = r.message_id where r.profile_id = pg_temp.m('13')), true);
select pg_temp.fails_with('admins can''t survey the Studio role',
  $$select public.create_survey_base('Poll', null, 'named', 'role', 'studio', null, now(), now() + interval '1 day', '[{"kind":"yes_no","prompt":"OK?"}]')$$,
  '%Studio don''t get surveys%');
insert into public.awards (id, season, name, description, closes_at, nominees, voter_roles)
values ('00000000-0000-0000-0000-0000000000f1', 2026, 'Club person of the year', 'For the whole club', now() + interval '7 days', 'members', '{member}');
select pg_temp.ok('Studio on its own isn''t nominated for a members'' award',
  (select count(*) = 0 from public.award_nominee_pool('00000000-0000-0000-0000-0000000000f1', null) where id = pg_temp.m('51')), true);
select pg_temp.ok('the manager who also runs Studio is',
  (select count(*) = 1 from public.award_nominee_pool('00000000-0000-0000-0000-0000000000f1', null) where id = pg_temp.m('13')), true);

-- ---------------------------------------------------------------------------
-- Line-ups and the publish consent
-- ---------------------------------------------------------------------------
select pg_temp.as_member('51');
select pg_temp.ok('line-up of the live game: Jordan, final team, not to be named with stats yet',
  (select array_agg(name || ':' || selection || ':' || may_publish) = array['Jordan Junior:touring:false']
   from public.studio_lineup(pg_temp.g(1))), true);
select pg_temp.ok('an adult athlete may be named with their stats without a consent',
  (select may_publish from public.studio_lineup(pg_temp.g(2)) where profile_id = pg_temp.m('32')), true);
select pg_temp.ok('the line-up gives names only: no date of birth, email or contact',
  (select bool_and(not (to_jsonb(l) ?| array['date_of_birth', 'email', 'phone', 'playhq_email'])) from public.studio_lineup(pg_temp.g(2)) l), true);
select pg_temp.refused('no line-up for a scratch game', format('select * from public.studio_lineup(%L)', pg_temp.g(3)));
select pg_temp.fails('Studio can''t give the publish consent', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t give it', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
select pg_temp.as_member('01');
select pg_temp.fails('an admin can''t give it', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
select pg_temp.as_member('31');
select pg_temp.fails('the child can''t give it', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
update public.profiles set verified_at = null where id = pg_temp.m('42');
select pg_temp.as_member('42');
select pg_temp.fails('an unverified guardian can''t give it', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
update public.profiles set verified_at = now() where id = pg_temp.m('42');
select pg_temp.as_member('41');
select pg_temp.fails('yes or no is needed', format('select public.set_child_publish_consent(%L, null)', pg_temp.m('31')));
select pg_temp.ok('before consent my_child_consents says no', (select not publish from public.my_child_consents() where athlete_id = pg_temp.m('31')), true);
select pg_temp.works('a verified guardian gives the publish consent', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
select pg_temp.works('giving it again changes nothing', format('select public.set_child_publish_consent(%L, true)', pg_temp.m('31')));
select pg_temp.ok('one publish consent in force', (select count(*) = 1 from public.child_consents where athlete_id = pg_temp.m('31') and kind = 'publish' and withdrawn_at is null), true);
select pg_temp.ok('my_child_consents shows it, and leaves the other two as they were',
  (select publish and not data and not health from public.my_child_consents() where athlete_id = pg_temp.m('31')), true);
select pg_temp.ok('the consent history keeps who gave it',
  (select given_by_name = 'Logan Parent' and withdrawn_at is null from public.child_consent_history(pg_temp.m('31')) where kind = 'publish'), true);
select pg_temp.as_member('51');
select pg_temp.ok('with consent Studio may name Jordan with their stats',
  (select may_publish from public.studio_lineup(pg_temp.g(1)) where profile_id = pg_temp.m('31')), true);
select pg_temp.as_member('42');
select pg_temp.works('the other guardian withdraws it', format('select public.set_child_publish_consent(%L, false)', pg_temp.m('31')));
select pg_temp.ok('the withdrawal is kept',
  (select withdrawn_by_name = 'Morgan Coach-Parent' from public.child_consent_history(pg_temp.m('31')) where kind = 'publish'), true);
select pg_temp.as_member('51');
select pg_temp.ok('withdrawn: team totals only again',
  (select not may_publish from public.studio_lineup(pg_temp.g(1)) where profile_id = pg_temp.m('31')), true);
-- The other consents are untouched by it, and it by them.
select pg_temp.as_member('41');
select pg_temp.works('data and health consents as before', format('select public.set_child_consent(%L, true, true)', pg_temp.m('31')));
select pg_temp.ok('set_child_consent leaves the publish consent alone',
  (select data and health and not publish from public.my_child_consents() where athlete_id = pg_temp.m('31')), true);
