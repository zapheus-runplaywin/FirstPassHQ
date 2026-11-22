-- Tests for 20261115000300_game_writes_recheck_role.sql (security audit
-- finding F5): append_game_events (primary and shadow streams),
-- set_game_status and save_game_snapshot ask is_statistician() on every
-- call, so a statistician who is stood down, loses the role or lets their
-- check lapse in the middle of a game stops recording at once, and every
-- other kind of member is refused too. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Fails unless the error message contains the expected words.
create or replace function pg_temp.fails_with(label text, statement text, words text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when position(words in sqlerrm) > 0 then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
-- The refusal Vantage shows: these exact words and code 42501. Keep them
-- stable; Vantage matches on them.
create or replace function pg_temp.refused(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm = 'Only statisticians and admins can record games' and sqlstate = '42501'
       then 'PASS ' else 'FAIL ' end || label || ' (' || sqlstate || ' ' || sqlerrm || ')'; end $$;
-- One event at the next free seq in a stream.
create or replace function pg_temp.next_event(p_game uuid, p_stream text) returns jsonb language sql as
$$ select jsonb_build_array(jsonb_build_object(
     'seq', (select coalesce(max(seq), 0) + 1 from public.game_events where game_id = p_game and stream = p_stream),
     'id', gen_random_uuid(), 'type', 'note', 'payload', '{}'::jsonb, 'recordedAt', now())) $$;
-- The four calls a recording tablet keeps making, as the current member.
create or replace function pg_temp.append_primary(p_game uuid) returns int language sql as
$$ select public.append_game_events(p_game, 'primary', pg_temp.next_event(p_game, 'primary')) $$;
create or replace function pg_temp.append_shadow(p_game uuid) returns int language sql as
$$ select public.append_game_events(p_game, 'shadow:' || auth.uid()::text,
     pg_temp.next_event(p_game, 'shadow:' || auth.uid()::text)) $$;
create or replace function pg_temp.events(p_game uuid) returns bigint language sql as
$$ select count(*) from public.game_events where game_id = p_game $$;
create or replace function pg_temp.snapshots(p_game uuid) returns bigint language sql as
$$ select count(*) from public.game_snapshots where game_id = p_game $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- Statisticians: 61 Sam records game G1, 62 Quinn shadows it, 63 Rory
-- records G2 and loses the role, 64 Toby records G3 and his check lapses,
-- 65 Uma a guest who never held the role, 66 Vic a pending newcomer who
-- asked to be a statistician.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'stats.recorder@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'stats.shadow@example.test', now()),
  ('00000000-0000-0000-0000-000000000063', 'stats.removed@example.test', now()),
  ('00000000-0000-0000-0000-000000000064', 'stats.lapsing@example.test', now()),
  ('00000000-0000-0000-0000-000000000065', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000066', 'stats.pending@example.test', now());
update public.profiles p set status = v.status::public.member_status, full_name = v.name,
  role = v.role::public.app_role, wwcc_number = v.wwcc, wwcc_expires_on = v.exp,
  wwcc_exempt_reason = v.reason, date_of_birth = public.club_today() - interval '40 years', verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000061', 'Sam Stats', 'statistician', 'approved', 'WWC0061', public.club_today() + 400, null),
  ('00000000-0000-0000-0000-000000000062', 'Quinn Shadow', 'statistician', 'approved', null, null::date, 'Opens games only'),
  ('00000000-0000-0000-0000-000000000063', 'Rory Removed', 'statistician', 'approved', 'WWC0063', public.club_today() + 400, null),
  ('00000000-0000-0000-0000-000000000064', 'Toby Lapsing', 'statistician', 'approved', 'WWC0064', public.club_today() + 400, null),
  ('00000000-0000-0000-0000-000000000065', 'Uma Guest', 'guest', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000066', 'Vic Newcomer', 'guest', 'pending', null, null, null)
) as v(id, name, role, status, wwcc, exp, reason)
where p.id = v.id::uuid;
update public.profiles set requested_role = 'statistician', join_requested_at = now()
where id = pg_temp.id('66');

create temp table t (g1 uuid, g2 uuid, g3 uuid, g4 uuid);
insert into t values (
  '00000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000e02',
  '00000000-0000-0000-0000-000000000e03', '00000000-0000-0000-0000-000000000e04');
grant select on t to authenticated;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon cannot append events', has_function_privilege('anon', 'public.append_game_events(uuid, text, jsonb)', 'execute'), false);
select pg_temp.ok('anon cannot change a game', has_function_privilege('anon', 'public.set_game_status(uuid, public.game_status)', 'execute'), false);
select pg_temp.ok('anon cannot save snapshots', has_function_privilege('anon', 'public.save_game_snapshot(uuid, int, text, jsonb)', 'execute'), false);
select pg_temp.ok('members can call append (it checks the role)', has_function_privilege('authenticated', 'public.append_game_events(uuid, text, jsonb)', 'execute'), true);
select pg_temp.ok('members can call set status (it checks the role)', has_function_privilege('authenticated', 'public.set_game_status(uuid, public.game_status)', 'execute'), true);
select pg_temp.ok('members can call snapshot (it checks the role)', has_function_privilege('authenticated', 'public.save_game_snapshot(uuid, int, text, jsonb)', 'execute'), true);
select pg_temp.ok('no second append_game_events overload',
  (select count(*) from pg_proc where proname = 'append_game_events' and pronamespace = 'public'::regnamespace) = 1, true);
select pg_temp.ok('no second set_game_status overload',
  (select count(*) from pg_proc where proname = 'set_game_status' and pronamespace = 'public'::regnamespace) = 1, true);
select pg_temp.ok('no second save_game_snapshot overload',
  (select count(*) from pg_proc where proname = 'save_game_snapshot' and pronamespace = 'public'::regnamespace) = 1, true);

-- Signed out: the sign-in message still comes first.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails_with('signed out: append refused', $$select pg_temp.append_primary((select g1 from t))$$, 'Sign in first');

-- ---------------------------------------------------------------------------
-- Games under way
-- ---------------------------------------------------------------------------
select pg_temp.as_member('61');
select pg_temp.works('Sam creates G1 for Sample Team',
  $$select public.create_game((select g1 from t), '{}'::jsonb, 'tablet-1', '00000000-0000-0000-0000-0000000000a2')$$);
select pg_temp.works('Sam records on G1', $$select pg_temp.append_primary((select g1 from t))$$);
select pg_temp.works('Sam saves a snapshot on G1', $$select public.save_game_snapshot((select g1 from t), 1, '0.1.0', '{}')$$);
select pg_temp.works('Sam moves G1 to final and back', $$select public.set_game_status((select g1 from t), 'final'), public.set_game_status((select g1 from t), 'live')$$);
select pg_temp.works('Sam records on his own shadow stream (the recorder may)', $$select pg_temp.append_shadow((select g1 from t))$$);
select pg_temp.as_member('62');
select pg_temp.works('Quinn pairs with G1 as a shadow',
  $$select public.pair_game((select pair_code from public.games where id = (select g1 from t)), true)$$);
select pg_temp.works('Quinn records on her shadow stream', $$select pg_temp.append_shadow((select g1 from t))$$);
select pg_temp.as_member('63');
select pg_temp.works('Rory creates and records G2',
  $$select public.create_game((select g2 from t), '{}'::jsonb, 'tablet-2'), pg_temp.append_primary((select g2 from t))$$);
select pg_temp.as_member('64');
select pg_temp.works('Toby creates and records G3',
  $$select public.create_game((select g3 from t), '{}'::jsonb, 'tablet-3'), pg_temp.append_primary((select g3 from t))$$);
select pg_temp.as_member('01');
select pg_temp.works('Alex (admin) creates and records G4',
  $$select public.create_game((select g4 from t), '{}'::jsonb, 'tablet-4'), pg_temp.append_primary((select g4 from t))$$);
select pg_temp.works('Alex saves a snapshot on Sam''s G1 (admins may)', $$select public.save_game_snapshot((select g1 from t), 2, '0.1.0', '{}')$$);
select pg_temp.works('Alex changes Sam''s G1 (admins may)', $$select public.set_game_status((select g1 from t), 'live')$$);
select pg_temp.fails_with('Alex can''t write Sam''s primary stream (lease rule unchanged)',
  $$select pg_temp.append_primary((select g1 from t))$$, 'Another device holds the recorder lease');
select pg_temp.works('Alex records on his own shadow of G1 after pairing',
  $$select public.pair_game((select pair_code from public.games where id = (select g1 from t)), true), pg_temp.append_shadow((select g1 from t))$$);

-- ---------------------------------------------------------------------------
-- 1. Sam (recorder) and Quinn (shadow) are stood down mid-game
-- ---------------------------------------------------------------------------
create temp table before_stand_down as select pg_temp.events((select g1 from t)) as events, pg_temp.snapshots((select g1 from t)) as snapshots;
select pg_temp.as_member('01');
select pg_temp.works('Alex stands Sam down', $$select public.admin_stand_down(pg_temp.id('61'), 'allegation', null)$$);
select pg_temp.works('Alex stands Quinn down', $$select public.admin_stand_down(pg_temp.id('62'), 'interim_negative_notice', null)$$);

select pg_temp.as_member('61');
select pg_temp.ok('stood down: Sam no longer is_statistician', public.is_statistician(), false);
select pg_temp.refused('stood down: Sam''s primary events refused at once', $$select pg_temp.append_primary((select g1 from t))$$);
select pg_temp.refused('stood down: Sam''s shadow events refused', $$select pg_temp.append_shadow((select g1 from t))$$);
select pg_temp.refused('stood down: Sam''s snapshot refused', $$select public.save_game_snapshot((select g1 from t), 3, '0.1.0', '{}')$$);
select pg_temp.refused('stood down: Sam can''t finish the game', $$select public.set_game_status((select g1 from t), 'final')$$);
select pg_temp.refused('stood down: Sam can''t start a new game', $$select public.create_game(gen_random_uuid(), '{}'::jsonb, 'tablet-1')$$);
select pg_temp.refused('stood down: the role refusal comes before "No such game"', $$select public.set_game_status(gen_random_uuid(), 'final')$$);
select pg_temp.refused('stood down: a resend of an already stored event is refused too',
  $$select public.append_game_events((select g1 from t), 'primary', jsonb_build_array(jsonb_build_object('seq', 1, 'id', gen_random_uuid(), 'type', 'note', 'payload', '{}'::jsonb, 'recordedAt', now())))$$);
select pg_temp.as_member('62');
select pg_temp.refused('stood down: Quinn''s shadow events refused at once', $$select pg_temp.append_shadow((select g1 from t))$$);
select pg_temp.refused('stood down: Quinn can''t take over the primary stream', $$select pg_temp.append_primary((select g1 from t))$$);
select pg_temp.refused('stood down: Quinn''s snapshot refused', $$select public.save_game_snapshot((select g1 from t), 3, '0.1.0', '{}')$$);
select pg_temp.refused('stood down: Quinn can''t change the game', $$select public.set_game_status((select g1 from t), 'final')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nothing was written to G1 while they were stood down',
  pg_temp.events((select g1 from t)) = (select events from before_stand_down)
  and pg_temp.snapshots((select g1 from t)) = (select snapshots from before_stand_down), true);
select pg_temp.ok('G1 is still live (Sam could not finish it)',
  (select status::text from public.games where id = (select g1 from t)) = 'live', true);
select pg_temp.ok('what Sam and Quinn recorded before stays',
  (select count(*) from public.game_events where game_id = (select g1 from t) and recorded_by in (pg_temp.id('61'), pg_temp.id('62'))) >= 3, true);

-- An admin can still finish a game a stood-down statistician was recording.
select pg_temp.as_member('01');
select pg_temp.works('Alex saves a snapshot on G1 after the stand-down', $$select public.save_game_snapshot((select g1 from t), 3, '0.1.0', '{}')$$);
select pg_temp.works('Alex finishes G1 after the stand-down', $$select public.set_game_status((select g1 from t), 'final')$$);
select pg_temp.works('Alex moves G1 back to live', $$select public.set_game_status((select g1 from t), 'live')$$);

-- Lifting the stand-down gives the role back.
select pg_temp.works('Alex lifts Sam''s stand-down', $$select public.admin_lift_stand_down(pg_temp.id('61'), 'Cleared')$$);
select pg_temp.works('Alex lifts Quinn''s stand-down', $$select public.admin_lift_stand_down(pg_temp.id('62'), 'Cleared')$$);
select pg_temp.as_member('61');
select pg_temp.works('lifted: Sam records on G1 again', $$select pg_temp.append_primary((select g1 from t))$$);
select pg_temp.works('lifted: Sam saves a snapshot again', $$select public.save_game_snapshot((select g1 from t), 4, '0.1.0', '{}')$$);
select pg_temp.works('lifted: Sam changes the game again', $$select public.set_game_status((select g1 from t), 'live')$$);
select pg_temp.as_member('62');
select pg_temp.works('lifted: Quinn shadows again', $$select pg_temp.append_shadow((select g1 from t))$$);

-- ---------------------------------------------------------------------------
-- 2. Rory's statistician role is removed mid-game
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('Alex makes Rory a guest', $$select public.admin_save_member(pg_temp.id('63'), 'guest', 'approved')$$);
select pg_temp.as_member('63');
select pg_temp.refused('role removed: Rory''s primary events refused', $$select pg_temp.append_primary((select g2 from t))$$);
select pg_temp.refused('role removed: Rory''s shadow events refused', $$select pg_temp.append_shadow((select g2 from t))$$);
select pg_temp.refused('role removed: Rory''s snapshot refused', $$select public.save_game_snapshot((select g2 from t), 1, '0.1.0', '{}')$$);
select pg_temp.refused('role removed: Rory can''t change the game', $$select public.set_game_status((select g2 from t), 'final')$$);

-- ---------------------------------------------------------------------------
-- 3. Toby's check lapses mid-game (after the club's checks date)
-- ---------------------------------------------------------------------------
update public.profiles set wwcc_expires_on = public.club_today() - 1 where id = pg_temp.id('64');
select pg_temp.as_member('64');
select pg_temp.refused('check lapsed: Toby''s primary events refused', $$select pg_temp.append_primary((select g3 from t))$$);
select pg_temp.refused('check lapsed: Toby''s snapshot refused', $$select public.save_game_snapshot((select g3 from t), 1, '0.1.0', '{}')$$);
select pg_temp.refused('check lapsed: Toby can''t change the game', $$select public.set_game_status((select g3 from t), 'final')$$);
update public.profiles set wwcc_expires_on = public.club_today() + 400 where id = pg_temp.id('64');
select pg_temp.works('check renewed: Toby records again', $$select pg_temp.append_primary((select g3 from t))$$);

-- ---------------------------------------------------------------------------
-- 4. An admin stood down by another admin
-- ---------------------------------------------------------------------------
select pg_temp.as_member('02');
select pg_temp.works('Blair stands Alex down', $$select public.admin_stand_down(pg_temp.id('01'), 'allegation', null)$$);
select pg_temp.as_member('01');
select pg_temp.refused('stood-down admin: Alex''s own game refused', $$select pg_temp.append_primary((select g4 from t))$$);
select pg_temp.refused('stood-down admin: Alex''s shadow refused', $$select pg_temp.append_shadow((select g1 from t))$$);
select pg_temp.refused('stood-down admin: Alex''s snapshot refused', $$select public.save_game_snapshot((select g1 from t), 5, '0.1.0', '{}')$$);
select pg_temp.refused('stood-down admin: Alex can''t change another''s game', $$select public.set_game_status((select g1 from t), 'final')$$);
select pg_temp.as_member('02');
select pg_temp.works('Blair (admin) still changes G1', $$select public.set_game_status((select g1 from t), 'live')$$);
select pg_temp.works('Blair lifts Alex''s stand-down', $$select public.admin_lift_stand_down(pg_temp.id('01'), 'Cleared')$$);
select pg_temp.as_member('01');
select pg_temp.works('lifted: Alex records on G4 again', $$select pg_temp.append_primary((select g4 from t))$$);

-- ---------------------------------------------------------------------------
-- 5. Every other kind of member is refused all four writes, even on a game
--    they can see or have paired with
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('Casey (head coach of Sample Team) follows G1 as a viewer',
  $$select public.follow_game((select g1 from t))$$);
create temp table others (n text, who text);
insert into others values
  ('11', 'head coach (following as a viewer)'), ('12', 'coach whose check lapsed'), ('13', 'manager'),
  ('14', 'physio'), ('21', 'committee, check expired'), ('22', 'committee, no check'),
  ('23', 'committee, exempt'), ('31', 'athlete under 18'), ('32', 'adult athlete'),
  ('41', 'guardian'), ('42', 'coach who is also a guardian'), ('65', 'guest'),
  ('66', 'pending newcomer who asked to be a statistician');
grant select on others to authenticated;
create or replace function pg_temp.check_others() returns setof text language plpgsql as
$$ declare r record;
   begin
     for r in select * from others order by n loop
       perform pg_temp.as_member(r.n);
       return next pg_temp.refused(r.who || ': primary events refused', $q$select pg_temp.append_primary((select g1 from t))$q$);
       return next pg_temp.refused(r.who || ': shadow events refused', $q$select pg_temp.append_shadow((select g1 from t))$q$);
       return next pg_temp.refused(r.who || ': snapshot refused', $q$select public.save_game_snapshot((select g1 from t), 9, '0.1.0', '{}')$q$);
       return next pg_temp.refused(r.who || ': game change refused', $q$select public.set_game_status((select g1 from t), 'final')$q$);
     end loop;
   end $$;
create temp table before_others as select pg_temp.events((select g1 from t)) as events, pg_temp.snapshots((select g1 from t)) as snapshots;
select pg_temp.check_others();
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('other members wrote nothing to G1',
  pg_temp.events((select g1 from t)) = (select events from before_others)
  and pg_temp.snapshots((select g1 from t)) = (select snapshots from before_others), true);

-- The rules this file covers are described on the functions.
select pg_temp.ok('append_game_events says it re-checks the role',
  obj_description('public.append_game_events(uuid, text, jsonb)'::regprocedure) like '%is_statistician%', true);
