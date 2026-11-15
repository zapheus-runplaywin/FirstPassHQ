-- Tests for 20261115000400_follow_game.sql: anyone who may see a game
-- (may_view_game) follows it by id with follow_game, with no pair code,
-- expiry or attempt count; everyone else is refused with the same message
-- whether or not the game exists; pair_game keeps the code only for shadow
-- statisticians. Covers every kind of member. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.g(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-000000000f0' || n)::uuid $$;
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
create or replace function pg_temp.follow_refused(label text, p_game uuid) returns text language sql as
$$ select pg_temp.refused(label, format('select public.follow_game(%L)', p_game), 'You can''t follow this game', '42501') $$;
create or replace function pg_temp.role_in(p_game uuid, n text) returns text language sql as
$$ select game_role::text from public.game_members where game_id = p_game and profile_id = pg_temp.m(n) $$;
-- Reads as the app does, through row level security.
create or replace function pg_temp.reads_events(p_game uuid) returns bigint language plpgsql as
$$ declare r bigint; begin
     set local role authenticated;
     select count(*) into r from public.game_events where game_id = p_game;
     reset role;
     return r;
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- 61 Sam a statistician, 62 Quinn a stood-down statistician, 65 Uma a guest,
-- 66 Vic a pending newcomer, 67 Nico Studio.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'stats@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'stats.stood-down@example.test', now()),
  ('00000000-0000-0000-0000-000000000065', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000066', 'pending@example.test', now()),
  ('00000000-0000-0000-0000-000000000067', 'studio@example.test', now());
update public.profiles p set status = v.status::public.member_status, full_name = v.name,
  role = v.role::public.app_role, wwcc_exempt_reason = v.reason, stood_down_at = v.stood,
  date_of_birth = current_date - interval '40 years', verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000061', 'Sam Stats', 'statistician', 'approved', 'Opens games only', null::timestamptz),
  ('00000000-0000-0000-0000-000000000062', 'Quinn Paused', 'statistician', 'approved', 'Opens games only', now()),
  ('00000000-0000-0000-0000-000000000065', 'Uma Guest', 'guest', 'approved', null, null),
  ('00000000-0000-0000-0000-000000000066', 'Vic Newcomer', 'guest', 'pending', null, null),
  ('00000000-0000-0000-0000-000000000067', 'Nico Studio', 'studio', 'approved', null, null)
) as v(id, name, role, status, reason, stood)
where p.id = v.id::uuid;

-- Game 1 for Sample Team (code 314159), game 2 for Sample Squad (271828),
-- game 3 Sample Team, finished, code expired. Sam records all three.
insert into public.games (id, team_id, config, status, recorder_id, pair_code, pair_code_expires_at, created_by) values
  (pg_temp.g(1), '00000000-0000-0000-0000-0000000000a2', '{}', 'live', pg_temp.m('61'), '314159', null, pg_temp.m('61')),
  (pg_temp.g(2), '00000000-0000-0000-0000-0000000000a1', '{}', 'live', pg_temp.m('61'), '271828', null, pg_temp.m('61')),
  (pg_temp.g(3), '00000000-0000-0000-0000-0000000000a2', '{}', 'final', pg_temp.m('61'), '161803', now() - interval '1 hour', pg_temp.m('61'));
insert into public.game_members (game_id, profile_id, game_role)
select pg_temp.g(n), pg_temp.m('61'), 'recorder' from generate_series(1, 3) n;
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(n), 'primary', 1, gen_random_uuid(), 'period_start', '{}', now(), pg_temp.m('61') from generate_series(1, 3) n;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members can call follow_game (it checks may_view_game)', has_function_privilege('authenticated', 'public.follow_game(uuid)', 'execute'), true);
select pg_temp.ok('anon cannot call follow_game', has_function_privilege('anon', 'public.follow_game(uuid)', 'execute'), false);
select pg_temp.ok('one follow_game', (select count(*) = 1 from pg_proc where proname = 'follow_game' and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('one pair_game', (select count(*) = 1 from pg_proc where proname = 'pair_game' and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('follow_game returns a games row',
  (select prorettype = 'public.games'::regtype from pg_proc where proname = 'follow_game' and pronamespace = 'public'::regnamespace), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.refused('signed out: follow refused', format('select public.follow_game(%L)', pg_temp.g(1)), 'Sign in first', '28000');

-- ---------------------------------------------------------------------------
-- Who may follow game 1 (Sample Team) and game 2 (Sample Squad)
-- ---------------------------------------------------------------------------
-- Admin
select pg_temp.as_member('01');
select pg_temp.works('admin follows game 1', format('select public.follow_game(%L)', pg_temp.g(1)));
select pg_temp.ok('admin follows as a viewer', pg_temp.role_in(pg_temp.g(1), '01') = 'viewer', true);
-- Statistician who records it: never lowered to a viewer
select pg_temp.as_member('61');
select pg_temp.works('recorder follows their own game', format('select public.follow_game(%L)', pg_temp.g(1)));
select pg_temp.ok('the recorder stays the recorder', pg_temp.role_in(pg_temp.g(1), '61') = 'recorder', true);
-- Stood-down statistician
select pg_temp.as_member('62');
select pg_temp.follow_refused('stood-down statistician refused', pg_temp.g(1));
-- Head coach of Sample Team and Sample Squad
select pg_temp.as_member('11');
select pg_temp.ok('head coach follows game 1 and gets the game back',
  (select g.id = pg_temp.g(1) and g.team_id = '00000000-0000-0000-0000-0000000000a2' from public.follow_game(pg_temp.g(1)) g), true);
select pg_temp.ok('head coach follows as a viewer', pg_temp.role_in(pg_temp.g(1), '11') = 'viewer', true);
select pg_temp.ok('head coach then reads its events', pg_temp.reads_events(pg_temp.g(1)) = 1, true);
select pg_temp.works('head coach follows the squad''s game 2', format('select public.follow_game(%L)', pg_temp.g(2)));
select pg_temp.works('head coach follows finished game 3 after its code expired', format('select public.follow_game(%L)', pg_temp.g(3)));
select pg_temp.ok('and reads it', pg_temp.reads_events(pg_temp.g(3)) = 1, true);
select pg_temp.ok('twenty taps in a row all work',
  (select bool_and(g.id = pg_temp.g(3)) from generate_series(1, 20), public.follow_game(pg_temp.g(3)) g), true);
select pg_temp.ok('following records no failed attempts',
  (select count(*) = 0 from public.game_pair_attempts where profile_id = pg_temp.m('11')), true);
select pg_temp.ok('one member row per game, however many taps',
  (select count(*) = 1 from public.game_members where game_id = pg_temp.g(3) and profile_id = pg_temp.m('11')), true);
select pg_temp.follow_refused('a game that doesn''t exist gets the same refusal', gen_random_uuid());
select pg_temp.follow_refused('no game id gets the same refusal', null);
select pg_temp.refused('the pair code is refused for a coach', $$select public.pair_game('314159')$$, 'Open the game from your games list', '42501');
select pg_temp.refused('and when asked for as a viewer', $$select public.pair_game('314159', false)$$, 'Open the game from your games list', '42501');
select pg_temp.ok('refusing the code counts no failed attempt',
  (select count(*) = 0 from public.game_pair_attempts where profile_id = pg_temp.m('11')), true);
select pg_temp.refused('a coach asking to shadow with the code is refused', $$select public.pair_game('314159', true)$$,
  'Only statisticians can shadow a game', '42501');
select pg_temp.ok('and isn''t made a shadow', pg_temp.role_in(pg_temp.g(1), '11') = 'viewer', true);
-- Coach whose check lapsed (assistant coach of the squad)
select pg_temp.as_member('12');
select pg_temp.follow_refused('coach whose check lapsed refused game 2', pg_temp.g(2));
-- Manager of Sample Squad
select pg_temp.as_member('13');
select pg_temp.works('squad manager follows the squad''s game 2', format('select public.follow_game(%L)', pg_temp.g(2)));
select pg_temp.works('squad manager follows game 1 of a team in the squad (20261115000500)', format('select public.follow_game(%L)', pg_temp.g(1)));
-- Assistant coach of Sample Squad who is also a guardian
select pg_temp.as_member('42');
select pg_temp.works('squad assistant coach follows game 2', format('select public.follow_game(%L)', pg_temp.g(2)));
select pg_temp.works('squad assistant coach follows game 1 of a team in the squad (20261115000500)', format('select public.follow_game(%L)', pg_temp.g(1)));
-- Everyone else, for both games
create temp table others (n text, who text);
insert into others values
  ('14', 'physio'), ('21', 'committee, check expired'), ('22', 'committee, no check'),
  ('23', 'committee, exempt'), ('31', 'athlete under 18'), ('32', 'adult athlete'),
  ('41', 'guardian'), ('65', 'guest'), ('66', 'pending newcomer'), ('67', 'Studio');
create or replace function pg_temp.check_others() returns setof text language plpgsql as
$$ declare r record;
   begin
     for r in select * from others order by n loop
       perform pg_temp.as_member(r.n);
       return next pg_temp.follow_refused(r.who || ': game 1 refused', pg_temp.g(1));
       return next pg_temp.follow_refused(r.who || ': game 2 refused', pg_temp.g(2));
       return next pg_temp.refused(r.who || ': pair code refused', $q$select public.pair_game('314159')$q$, 'Open the game from your games list', '42501');
       return next pg_temp.ok(r.who || ': reads no events', pg_temp.reads_events(pg_temp.g(1)) + pg_temp.reads_events(pg_temp.g(2)) = 0, true);
     end loop;
   end $$;
select pg_temp.check_others();
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('no refused member became a game member',
  (select count(*) = 0 from public.game_members where profile_id in (select pg_temp.m(n) from others)
     or profile_id in (pg_temp.m('12'), pg_temp.m('62'))), true);

-- ---------------------------------------------------------------------------
-- Shadow statisticians still pair by code
-- ---------------------------------------------------------------------------
update public.profiles set stood_down_at = null where id = pg_temp.m('62');
select pg_temp.as_member('62');
select pg_temp.ok('a statistician pairs as a shadow with the code',
  (select g.id = pg_temp.g(1) from public.pair_game('314 159', true) g), true);
select pg_temp.ok('as a shadow', pg_temp.role_in(pg_temp.g(1), '62') = 'shadow', true);
select pg_temp.works('following the game afterwards keeps the shadow', format('select public.follow_game(%L)', pg_temp.g(1)));
select pg_temp.ok('still a shadow', pg_temp.role_in(pg_temp.g(1), '62') = 'shadow', true);
select pg_temp.ok('an expired code doesn''t pair a shadow', (select g.id is null from public.pair_game('161803', true) g), true);
select pg_temp.ok('a wrong code doesn''t pair a shadow', (select g.id is null from public.pair_game('000000', true) g), true);
select pg_temp.ok('misses still count for codes',
  (select count(*) = 2 from public.game_pair_attempts where profile_id = pg_temp.m('62')), true);
select (select g.id from public.pair_game('999991', true) g), (select g.id from public.pair_game('999992', true) g), (select g.id from public.pair_game('999993', true) g);
select pg_temp.refused('after five misses even the right code waits ten minutes', $$select public.pair_game('314159', true)$$,
  'Too many tries. Wait ten minutes and try again', '54000');
select pg_temp.works('but follow_game still works for them', format('select public.follow_game(%L)', pg_temp.g(2)));

-- ---------------------------------------------------------------------------
-- Following doesn't outlast the right to see the game
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('admin stands Casey down', $$select public.admin_stand_down(pg_temp.m('11'), 'allegation', null)$$);
select pg_temp.as_member('11');
select pg_temp.ok('stood-down coach reads none of a game they followed', pg_temp.reads_events(pg_temp.g(1)) = 0, true);
select pg_temp.follow_refused('stood-down coach can''t follow again', pg_temp.g(1));
select pg_temp.as_member('01');
select pg_temp.works('admin lifts it', $$select public.admin_lift_stand_down(pg_temp.m('11'), 'Cleared')$$);
select pg_temp.as_member('11');
select pg_temp.ok('lifted: reads the game again', pg_temp.reads_events(pg_temp.g(1)) = 1, true);
-- Leaving the team and its squad (squad staff see the squad's team games).
delete from public.team_members where team_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2') and profile_id = pg_temp.m('11');
select pg_temp.ok('coach who left the team reads none of its game', pg_temp.reads_events(pg_temp.g(1)) = 0, true);
select pg_temp.follow_refused('coach who left the team can''t follow it again', pg_temp.g(1));
