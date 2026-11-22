-- Tests for 20261120400000_session_plan_quiet_hours.sql: a session plan shared
-- in the quiet hours (8 pm to 7 am club time) is held and its notification
-- goes out at 7 am, so a coach planning late doesn't wake a child's phone.
-- Outside the quiet hours it still goes at once. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
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

-- Keep what would go to Expo, instead of sending it.
create table net.sent (id serial, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into net.sent (body) values (body) returning id::bigint $$;
-- Every message sent so far, one row each.
create or replace function pg_temp.messages() returns setof jsonb language sql as
$$ select m from net.sent s, jsonb_array_elements(s.body) m $$;
-- The members sent a message so far, as a sorted list of member numbers.
create or replace function pg_temp.sent_to() returns text language sql as
$$ select coalesce(string_agg(right(t.profile_id::text, 2), ',' order by t.profile_id::text), '')
   from pg_temp.messages() m join public.push_tokens t on t.token = m->>'to' $$;
-- The members whose notice for a plan is waiting, the same way.
create or replace function pg_temp.held(plan uuid) returns text language sql as
$$ select coalesce(string_agg(right(n.profile_id::text, 2), ',' order by n.profile_id::text), '')
   from public.session_plan_notices n where n.plan_id = plan and n.push_held $$;
-- Everyone noted for a plan, held or told.
create or replace function pg_temp.noted(plan uuid) returns text language sql as
$$ select coalesce(string_agg(right(n.profile_id::text, 2), ',' order by n.profile_id::text), '')
   from public.session_plan_notices n where n.plan_id = plan $$;

-- Sharing a plan reads the clock itself, so the tests move the club instead:
-- to a time zone where it is midday right now (not quiet hours), or midnight
-- (quiet hours). Whole-hour zones, so a run that crosses the hour stays well
-- inside either one.
create or replace function pg_temp.club_hour_is(h int) returns void language sql as
$$ update public.club_settings set timezone = (
     select case when o = 0 then 'Etc/GMT' when o <= 14 then 'Etc/GMT-' || o else 'Etc/GMT+' || (24 - o) end
     from (select ((h - extract(hour from now() at time zone 'UTC')::int) % 24 + 24) % 24 as o) x)
   where id $$;

-- Moving the club up to a day east or west moves its calendar day too
-- (club_today). Drew's card ended yesterday in Perth, which could be today
-- in the zone the club is moved to; end it well before, so Drew stays
-- without a current check whatever the hour.
update public.profiles set wwcc_expires_on = public.club_today() - 30 where id = pg_temp.id('12');

create temp table ids (k text primary key, v uuid);
grant all on ids to public;
create or replace function pg_temp.plan(k text) returns uuid language sql as $$ select v from ids where ids.k = plan.k $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('members cannot run the held-plans job', has_function_privilege('authenticated', 'public.send_held_session_plan_pushes(timestamptz)', 'execute'), false);
select pg_temp.ok('anon cannot run the held-plans job', has_function_privilege('anon', 'public.send_held_session_plan_pushes(timestamptz)', 'execute'), false);
select pg_temp.ok('members cannot send a plan''s notifications themselves', has_function_privilege('authenticated', 'public.notify_session_plan_shared(uuid)', 'execute'), false);
select pg_temp.ok('anon cannot either', has_function_privilege('anon', 'public.notify_session_plan_shared(uuid)', 'execute'), false);
select pg_temp.ok('members cannot call the quiet hours check', has_function_privilege('authenticated', 'public.push_quiet_hours(timestamptz)', 'execute'), false);
select pg_temp.ok('anon cannot call the quiet hours check', has_function_privilege('anon', 'public.push_quiet_hours(timestamptz)', 'execute'), false);
select pg_temp.ok('members have no direct access to who is waiting to be told', has_table_privilege('authenticated', 'public.session_plan_notices', 'select,insert,update,delete'), false);
select pg_temp.ok('signed-out visitors have none either', has_table_privilege('anon', 'public.session_plan_notices', 'select'), false);
select pg_temp.ok('people told before this change are not waiting', (select column_default = 'false' and is_nullable = 'NO' from information_schema.columns where table_name = 'session_plan_notices' and column_name = 'push_held'), true);

-- ---------------------------------------------------------------------------
-- The quiet hours: 8 pm to 7 am in the club's time zone
-- ---------------------------------------------------------------------------
select pg_temp.ok('the club is in Perth unless changed', (select timezone = 'Australia/Perth' from public.club_settings where id), true);
select pg_temp.ok('6:59 am is quiet', public.push_quiet_hours('2026-07-01 06:59:59+08'), true);
select pg_temp.ok('7:00 am is not', public.push_quiet_hours('2026-07-01 07:00:00+08'), false);
select pg_temp.ok('midday is not', public.push_quiet_hours('2026-07-01 12:00:00+08'), false);
select pg_temp.ok('7:59 pm is not', public.push_quiet_hours('2026-07-01 19:59:59+08'), false);
select pg_temp.ok('8:00 pm is quiet', public.push_quiet_hours('2026-07-01 20:00:00+08'), true);
select pg_temp.ok('midnight is quiet', public.push_quiet_hours('2026-07-01 00:00:00+08'), true);
update public.club_settings set timezone = 'Australia/Sydney' where id;
select pg_temp.ok('a Sydney club: 6:30 pm in Perth is 8:30 pm there, quiet', public.push_quiet_hours('2026-07-01 18:30:00+08'), true);
select pg_temp.ok('a Sydney club: 5:30 am in Perth is 7:30 am there, not quiet', public.push_quiet_hours('2026-07-01 05:30:00+08'), false);
update public.club_settings set timezone = 'Australia/Perth' where id;

-- To-do notifications use the same check: nothing at 9 pm, and the job
-- doesn't even look at anyone's list.
select pg_temp.ok('the to-do job sends nothing at 9 pm', public.send_todo_pushes('2026-07-01 21:00:00+08') = 0, true);
select pg_temp.ok('and notes nobody''s list then', (select count(*) = 0 from public.push_settings where baseline_at is not null), true);

-- ---------------------------------------------------------------------------
-- Phones: the child athlete (31), the adult athlete (32), the child's parent
-- (41), the assistant coach who is also the child's parent (42) and the head
-- coach (11), who writes the plans.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.works('the child registers a phone', $$select public.register_push_device('ExponentPushToken[child]', 'ios', 'THUNDER')$$);
select pg_temp.as_member('32');
select pg_temp.works('the adult athlete registers a phone', $$select public.register_push_device('ExponentPushToken[adult]', 'ios', 'THUNDER')$$);
select pg_temp.as_member('41');
select pg_temp.works('the parent registers a phone', $$select public.register_push_device('ExponentPushToken[parent]', 'android', 'THUNDER')$$);
select pg_temp.as_member('42');
select pg_temp.works('the assistant coach registers a phone', $$select public.register_push_device('ExponentPushToken[assistant]', 'ios', 'THUNDER')$$);
select pg_temp.as_member('11');
select pg_temp.works('the head coach registers a phone', $$select public.register_push_device('ExponentPushToken[head]', 'ios', 'THUNDER')$$);

-- ---------------------------------------------------------------------------
-- Shared in the daytime: everyone is told at once, as before
-- ---------------------------------------------------------------------------
select pg_temp.club_hour_is(12);
select pg_temp.as_member('11');
insert into ids values ('day', public.save_session_plan(
  null, pg_temp.id('a1'), 'Day plan', public.club_today() + 2, '18:00', '19:30', 'Main court', 'Footwork', null, true, true, '{}'));
select pg_temp.ok('a plan shared at midday tells everyone at once', pg_temp.sent_to() = '31,32,41,42', true);
select pg_temp.ok('the author is not told about their own plan', pg_temp.sent_to() like '%11%', false);
select pg_temp.ok('nobody is left waiting', pg_temp.held(pg_temp.plan('day')) = '', true);
select pg_temp.ok('everyone is noted as told', pg_temp.noted(pg_temp.plan('day')) = '31,32,41,42', true);
select pg_temp.ok('each notification says who shared what, for which group', (select bool_and(
  m->>'title' = 'New session plan' and m->>'body' like 'Casey Coach shared Day plan (Sample Squad, %).') from pg_temp.messages() m), true);
select pg_temp.ok('a tap opens the plan, in the right club', (select bool_and(
  m->'data'->>'planId' = pg_temp.plan('day')::text and m->'data'->>'club' = 'THUNDER') from pg_temp.messages() m), true);
select pg_temp.ok('the plan''s notes stay off the lock screen', (select bool_or(m::text like '%Footwork%') from pg_temp.messages() m), false);
select pg_temp.works('the coach changes the plan', format($$select public.save_session_plan(
  %L, pg_temp.id('a1'), 'Day plan', public.club_today() + 2, '18:00', '19:30', 'Court 2', 'Footwork', null, true, true, '{}')$$, pg_temp.plan('day')));
select pg_temp.ok('a change tells nobody again', (select count(*) = 4 from pg_temp.messages()), true);

-- ---------------------------------------------------------------------------
-- Shared in the quiet hours: held, for children and adults alike
-- ---------------------------------------------------------------------------
truncate net.sent;
select pg_temp.club_hour_is(0);
select pg_temp.as_member('11');
insert into ids values ('night', public.save_session_plan(
  null, pg_temp.id('a1'), 'Night plan', public.club_today() + 3, '18:00', '19:30', null, null, null, true, true, '{}'));
select pg_temp.ok('a plan shared at midnight sends nothing', (select count(*) = 0 from pg_temp.messages()), true);
select pg_temp.ok('the child''s phone is not woken', pg_temp.sent_to() like '%31%', false);
select pg_temp.ok('everyone it is shared with is waiting to be told', pg_temp.held(pg_temp.plan('night')) = '31,32,41,42', true);
select pg_temp.ok('the plan itself is shared straight away', (select count(*) = 1 from public.session_plans where id = pg_temp.plan('night')), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('the job sends nothing while it is still quiet', public.send_held_session_plan_pushes() = 0, true);
select pg_temp.ok('and they are still waiting', pg_temp.held(pg_temp.plan('night')) = '31,32,41,42', true);
select pg_temp.as_member('11');
select pg_temp.works('the coach changes the held plan', format($$select public.save_session_plan(
  %L, pg_temp.id('a1'), 'Night plan', public.club_today() + 3, '18:00', '19:30', 'Main court', null, null, true, true, '{}')$$, pg_temp.plan('night')));
select pg_temp.ok('a change to a held plan still sends nothing', (select count(*) = 0 from pg_temp.messages()), true);

-- A second plan the same night, for the coaches only.
insert into ids values ('coaches', public.save_session_plan(
  null, pg_temp.id('a1'), 'Coaches plan', public.club_today() + 4, null, null, null, null, null, true, false, '{}'));
select pg_temp.ok('the coaches-only plan waits for the assistant coach alone', pg_temp.held(pg_temp.plan('coaches')) = '42', true);

-- Before morning the coach stops sharing the night plan with athletes.
select pg_temp.works('the coach stops sharing the night plan with athletes', format($$select public.save_session_plan(
  %L, pg_temp.id('a1'), 'Night plan', public.club_today() + 3, '18:00', '19:30', 'Main court', null, null, true, false, '{}')$$, pg_temp.plan('night')));
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nothing is sent or forgotten until the quiet hours end', pg_temp.held(pg_temp.plan('night')) = '31,32,41,42'
  and (select count(*) = 0 from pg_temp.messages()), true);

-- 6:55 am and 7:00 am, back in Perth.
update public.club_settings set timezone = 'Australia/Perth' where id;
create temp table t as select
  (date_trunc('day', now() at time zone 'Australia/Perth') + interval '1 day 6 hours 55 minutes') at time zone 'Australia/Perth' as before_seven,
  (date_trunc('day', now() at time zone 'Australia/Perth') + interval '1 day 7 hours') at time zone 'Australia/Perth' as seven;
select pg_temp.ok('at 6:55 am the job still sends nothing', public.send_held_session_plan_pushes((select before_seven from t)) = 0
  and (select count(*) = 0 from pg_temp.messages()), true);
select pg_temp.ok('at 7 am it tells the one person both plans are still shared with', public.send_held_session_plan_pushes((select seven from t)) = 1, true);
select pg_temp.ok('only the assistant coach is sent anything', pg_temp.sent_to() = '42', true);
select pg_temp.ok('two plans arrive as one notification', (select count(*) = 1 and bool_and(
  m->>'title' = '2 new session plans' and m->>'body' = 'Night plan · Coaches plan'
  and m->'data'->>'href' = '/session-plans' and m->'data'->>'club' = 'THUNDER') from pg_temp.messages() m), true);
select pg_temp.ok('the athletes and the parent were never told about a plan taken back', pg_temp.sent_to() ~ '31|32|41', false);
select pg_temp.ok('and their notices are forgotten', pg_temp.noted(pg_temp.plan('night')) = '42', true);
select pg_temp.ok('nobody is waiting any more', (select count(*) = 0 from public.session_plan_notices where push_held), true);
select pg_temp.ok('the notice records when they were told', (select notified_at = (select seven from t) from public.session_plan_notices
  where plan_id = pg_temp.plan('night') and profile_id = pg_temp.id('42')), true);
select pg_temp.ok('running the job again sends nothing twice', public.send_held_session_plan_pushes((select seven from t) + interval '5 minutes') = 0
  and (select count(*) = 1 from pg_temp.messages()), true);

-- Shared with the athletes again, in the daytime: they are told now.
truncate net.sent;
select pg_temp.club_hour_is(12);
select pg_temp.as_member('11');
select pg_temp.works('the coach shares the night plan with athletes again', format($$select public.save_session_plan(
  %L, pg_temp.id('a1'), 'Night plan', public.club_today() + 3, '18:00', '19:30', 'Main court', null, null, true, true, '{}')$$, pg_temp.plan('night')));
select pg_temp.ok('the athletes and the parent are told, the assistant coach not twice', pg_temp.sent_to() = '31,32,41', true);

-- ---------------------------------------------------------------------------
-- Held overnight, then someone leaves or is stood down before 7 am
-- ---------------------------------------------------------------------------
truncate net.sent;
select pg_temp.club_hour_is(0);
select pg_temp.as_member('11');
insert into ids values ('late', public.save_session_plan(
  null, pg_temp.id('a1'), 'Late plan', public.club_today() + 5, null, null, null, null, null, true, true, '{}'));
insert into ids values ('staff', public.save_session_plan(
  null, pg_temp.id('a1'), 'Staff plan', public.club_today() + 6, null, null, null, null, null, true, false, '{}'));
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('everyone waits again', pg_temp.held(pg_temp.plan('late')) = '31,32,41,42'
  and pg_temp.held(pg_temp.plan('staff')) = '42', true);
-- The adult athlete leaves the squad, and the assistant coach is stood down.
-- They are still the child's parent, so the plan shared with athletes still
-- reaches them, but the coaches-only plan no longer does.
delete from public.team_members where team_id = pg_temp.id('a1') and profile_id = pg_temp.id('32');
update public.profiles set stood_down_at = now() where id = pg_temp.id('42');
update public.club_settings set timezone = 'Australia/Perth' where id;
select pg_temp.ok('at 7 am the child and both parents are told', public.send_held_session_plan_pushes((select seven from t)) = 3
  and pg_temp.sent_to() = '31,41,42', true);
select pg_temp.ok('the athlete who left is not', pg_temp.sent_to() like '%32%', false);
select pg_temp.ok('one plan arrives as itself, opening that plan', (select count(*) = 3 and bool_and(
  m->>'title' = 'New session plan' and m->>'body' like 'Casey Coach shared Late plan (Sample Squad, %).'
  and m->'data'->>'planId' = pg_temp.plan('late')::text) from pg_temp.messages() m), true);
select pg_temp.ok('the stood-down coach is never told about the coaches'' plan', pg_temp.noted(pg_temp.plan('staff')) = ''
  and (select bool_or(m::text like '%Staff plan%') from pg_temp.messages() m) is not true, true);
select pg_temp.ok('the athlete who left is forgotten', pg_temp.noted(pg_temp.plan('late')) = '31,41,42', true);

-- A held plan that is deleted takes its waiting notices with it.
truncate net.sent;
update public.profiles set stood_down_at = null where id = pg_temp.id('42');
select pg_temp.club_hour_is(0);
select pg_temp.as_member('11');
insert into ids values ('gone', public.save_session_plan(
  null, pg_temp.id('a1'), 'Deleted plan', public.club_today() + 6, null, null, null, null, null, true, true, '{}'));
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('the plan waits', pg_temp.held(pg_temp.plan('gone')) <> '', true);
delete from public.session_plans where id = pg_temp.plan('gone');
update public.club_settings set timezone = 'Australia/Perth' where id;
select pg_temp.ok('a deleted plan is never announced', public.send_held_session_plan_pushes((select seven from t)) = 0
  and (select count(*) = 0 from pg_temp.messages()), true);

-- Someone with no phone registered: noted as told, nothing to send.
delete from public.push_tokens where profile_id = pg_temp.id('41');
select pg_temp.club_hour_is(0);
select pg_temp.as_member('11');
insert into ids values ('nophone', public.save_session_plan(
  null, pg_temp.id('a1'), 'No phone plan', public.club_today() + 7, null, null, null, null, null, false, true, '{}'));
select set_config('request.jwt.claim.sub', '', false);
update public.club_settings set timezone = 'Australia/Perth' where id;
select pg_temp.ok('a parent with no phone is skipped, the others are told', public.send_held_session_plan_pushes((select seven from t)) = 2
  and pg_temp.sent_to() = '31,42', true);
select pg_temp.ok('and nobody is left waiting', (select count(*) = 0 from public.session_plan_notices where push_held), true);
