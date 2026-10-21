-- Tests for 20261021010000_todo_push_notifications.sql. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Whether a member's to-do list has a key starting with this.
create or replace function pg_temp.has(n text, key_prefix text) returns boolean language sql as
$$ select exists (select 1 from public.member_todos(pg_temp.id(n)) m where m.todo_key like key_prefix || '%') $$;

-- Keep what would go to Expo, instead of sending it.
create table net.sent (id serial, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into net.sent (body) values (body) returning id::bigint $$;
-- Every message sent so far, one row each.
create or replace function pg_temp.messages() returns setof jsonb language sql as
$$ select m from net.sent s, jsonb_array_elements(s.body) m $$;

-- 10 am and 9 pm today, club time.
create temp table t as select
  (date_trunc('day', now() at time zone 'Australia/Perth') + interval '10 hours') at time zone 'Australia/Perth' as morning,
  (date_trunc('day', now() at time zone 'Australia/Perth') + interval '21 hours') at time zone 'Australia/Perth' as night;
grant select on t to public;

-- Who may call what.
select pg_temp.ok('members cannot work out someone else''s to-dos', has_function_privilege('authenticated', 'public.member_todos(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('members cannot run the send job', has_function_privilege('authenticated', 'public.send_todo_pushes(timestamptz)', 'execute'), false);
select pg_temp.ok('anon cannot run the send job', has_function_privilege('anon', 'public.send_todo_pushes(timestamptz)', 'execute'), false);
select pg_temp.ok('anon cannot register a phone', has_function_privilege('anon', 'public.register_push_device(text, text, text)', 'execute'), false);
select pg_temp.ok('members register their phone', has_function_privilege('authenticated', 'public.register_push_device(text, text, text)', 'execute'), true);
select pg_temp.ok('members change their switch', has_function_privilege('authenticated', 'public.set_todo_notifications(boolean)', 'execute'), true);
select pg_temp.ok('members have no direct access to their settings', has_table_privilege('authenticated', 'public.push_settings', 'select,insert,update,delete'), false);
select pg_temp.ok('members have no direct access to the sent log', has_table_privilege('authenticated', 'public.push_todo_log', 'select,insert,update,delete'), false);
select pg_temp.ok('signed-out visitors have none either', has_table_privilege('anon', 'public.push_settings', 'select') or has_table_privilege('anon', 'public.push_todo_log', 'select'), false);
select pg_temp.ok('the edge functions'' service role reaches both', has_table_privilege('service_role', 'public.push_settings', 'select,insert,update,delete') and has_table_privilege('service_role', 'public.push_todo_log', 'select,insert,update,delete'), true);
select pg_temp.ok('the sent log has no policies', exists (select 1 from pg_policies where tablename = 'push_todo_log'), false);

-- Registering a phone.
select pg_temp.as_member('32');
select pg_temp.works('athlete registers a phone', $$select public.register_push_device('ExponentPushToken[athlete]', 'ios', 'THUNDER')$$);
select pg_temp.ok('the token carries the club', (select club_code = 'THUNDER' and profile_id = pg_temp.id('32') from public.push_tokens where token = 'ExponentPushToken[athlete]'), true);
select pg_temp.fails('something that isn''t a push token is refused', $$select public.register_push_device('hello', 'ios', 'THUNDER')$$);
select pg_temp.fails('a bad club code is refused', $$select public.register_push_device('ExponentPushToken[x]', 'ios', 'thunder; drop')$$);
select pg_temp.as_member('11');
select pg_temp.works('a phone that changes hands moves to the new member', $$select public.register_push_device('ExponentPushToken[athlete]', 'ios', 'THUNDER')$$);
select pg_temp.ok('the token now belongs to the coach', (select profile_id = pg_temp.id('11') from public.push_tokens where token = 'ExponentPushToken[athlete]'), true);
select pg_temp.as_member('32');
select pg_temp.works('athlete registers it again', $$select public.register_push_device('ExponentPushToken[athlete]', 'ios', 'THUNDER')$$);
select pg_temp.as_member('01');
select pg_temp.works('admin registers a phone', $$select public.register_push_device('ExponentPushToken[admin]', 'android', 'THUNDER')$$);
select pg_temp.as_member('41');
select pg_temp.works('guardian registers a phone', $$select public.register_push_device('ExponentPushToken[guardian]', 'ios', 'THUNDER')$$);
select pg_temp.as_member('11');
select pg_temp.works('coach registers a phone', $$select public.register_push_device('ExponentPushToken[coach]', 'ios', 'THUNDER')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails('signed out cannot register', $$select public.register_push_device('ExponentPushToken[x]', 'ios', 'THUNDER')$$);

-- The switch.
select pg_temp.as_member('32');
select pg_temp.ok('on until changed', (select todos from public.my_push_settings()), true);
select pg_temp.fails('a missing choice is refused', $$select public.set_todo_notifications(null)$$);

-- Each member's list matches what their home screen shows.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('athlete has the daily check-in', pg_temp.has('32', 'check-in:'), true);
select pg_temp.ok('coach has no check-in of their own', pg_temp.has('11', 'check-in:'), false);
select pg_temp.ok('guardian is asked for consent for their child', pg_temp.has('41', 'consent:' || pg_temp.id('31')), true);
select pg_temp.ok('athlete is not asked for consent', pg_temp.has('32', 'consent:'), false);
select pg_temp.ok('admin has the Working With Children Check follow-up', pg_temp.has('01', 'wwcc:'), true);
select pg_temp.ok('coach has no admin follow-ups', pg_temp.has('11', 'wwcc:'), false);
select pg_temp.ok('admin is told old records are kept', pg_temp.has('01', 'records-removal-off:'), true);
select pg_temp.ok('a pending member has no list', (select count(*) = 0 from public.member_todos(gen_random_uuid())), true);
select pg_temp.ok('working out a list leaves nobody signed in', coalesce(current_setting('request.jwt.claim.sub', true), '') = '', true);

-- A new absence reaches the athlete's coach and manager, not the athlete.
insert into public.attendance_absences (athlete_id, from_day, to_day, reported_as)
values (pg_temp.id('32'), current_date, current_date, 'athlete');
select pg_temp.ok('coach is told about the absence', pg_temp.has('11', 'absences-to-review:'), true);
select pg_temp.ok('manager is told about the absence', pg_temp.has('13', 'absences-to-review:'), true);
select pg_temp.ok('the athlete isn''t', pg_temp.has('32', 'absences-to-review:'), false);

-- A concern reaches the people who handle them only.
insert into public.concerns (body) values ('Test concern');
select pg_temp.ok('admin is told about the concern', pg_temp.has('01', 'concerns:'), true);
select pg_temp.ok('a coach isn''t', pg_temp.has('11', 'concerns:'), false);
select pg_temp.ok('the concern''s words never go in a notification', exists (
  select 1 from public.member_todos(pg_temp.id('01')) m where m.title || m.detail like '%Test concern%'), false);

-- Injury details never go in a notification: they can show on a locked phone.
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, expected_return, athlete_name)
values (pg_temp.id('32'), pg_temp.id('32'), 'Left hamstring', 'Strain', current_date - 10, current_date - 1, 'Kai Senior');
select pg_temp.ok('athlete is asked to update an injury past its return day', pg_temp.has('32', 'injury-update:'), true);
select pg_temp.ok('no to-do names the body area', exists (
  select 1 from public.profiles p, public.member_todos(p.id) m
  where p.status = 'approved' and (m.title || m.detail) ilike '%hamstring%'), false);

-- A clearance nobody can endorse reaches the admin, without injury details.
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000e1', 'unplaced@example.test', now());
update public.profiles set status = 'approved', role = 'athlete', full_name = 'Riley Unplaced'
where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name, status)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'Right wrist', 'Sprain', current_date - 3, 'Riley Unplaced', 'clearance_requested');
select pg_temp.ok('admin is told nobody can endorse the clearance', exists (
  select 1 from public.member_todos(pg_temp.id('01')) m
  where m.todo_key like 'unendorsable-clearances:%' and m.title = 'Nobody can endorse Riley Unplaced’s clearance'
    and (m.title || m.detail) not ilike '%wrist%'), true);
select pg_temp.ok('a coach isn''t', pg_temp.has('11', 'unendorsable-clearances:'), false);

-- Sending.
select pg_temp.ok('nothing goes out at 9 pm', (select public.send_todo_pushes(night) = 0 from t), true);
select pg_temp.ok('nothing was sent at night', (select count(*) = 0 from pg_temp.messages()), true);
select pg_temp.ok('the first look sends nothing (no backlog)', (select public.send_todo_pushes(morning) = 0 from t), true);
select pg_temp.ok('everyone with a phone has a starting point', (select count(*) = 4 from public.push_settings where baseline_at is not null), true);

insert into public.concerns (body) values ('Another concern');
select pg_temp.ok('a new concern sends one notification', (select public.send_todo_pushes(morning + interval '5 minutes') = 1 from t), true);
select pg_temp.ok('it went to the admin''s phone, with the club and screen', exists (
  select 1 from pg_temp.messages() m
  where m ->> 'to' = 'ExponentPushToken[admin]' and m -> 'data' ->> 'club' = 'THUNDER'
    and m -> 'data' ->> 'href' = '/concerns' and m ->> 'channelId' = 'todos'), true);
select pg_temp.ok('nobody else got it', (select count(*) = 1 from pg_temp.messages()), true);
select pg_temp.ok('the next run sends nothing again', (select public.send_todo_pushes(morning + interval '10 minutes') = 0 from t), true);

-- Two new things at once go in one notification.
-- (As if the month had turned over for two of the admin's follow-ups.)
delete from public.push_todo_log where todo_key like 'wwcc:%' or todo_key like 'records-removal-off:%';
select pg_temp.ok('two new to-dos send one notification', (select public.send_todo_pushes(morning + interval '15 minutes') = 1 from t), true);
select pg_temp.ok('it says how many and opens the home screen', exists (
  select 1 from pg_temp.messages() m
  where m ->> 'title' like '% new things to do' and m -> 'data' ->> 'href' = '/'), true);

-- Turning it off stops them; turning it back on doesn't send what's waiting.
select pg_temp.as_member('01');
select pg_temp.works('admin turns to-do notifications off', $$select public.set_todo_notifications(false)$$);
select pg_temp.ok('the switch reads off', (select todos from public.my_push_settings()), false);
select set_config('request.jwt.claim.sub', '', false);
insert into public.concerns (body) values ('Fourth concern');
select pg_temp.ok('nothing is sent while it''s off', (select public.send_todo_pushes(morning + interval '20 minutes') = 0 from t), true);
select pg_temp.as_member('01');
select pg_temp.works('admin turns them back on', $$select public.set_todo_notifications(true)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('turning back on sends no backlog', (select public.send_todo_pushes(morning + interval '25 minutes') = 0 from t), true);

-- Join requests go to admins straight away, unless they've switched off.
create temp table before as select count(*) as n from pg_temp.messages();
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000f1', 'newcomer@example.test', now());
update public.profiles set full_name = 'New Person', join_requested_at = now() where id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.ok('a join request notifies the admin', exists (
  select 1 from pg_temp.messages() m
  where m ->> 'to' = 'ExponentPushToken[admin]' and m -> 'data' ->> 'club' = 'THUNDER'
    and m ->> 'channelId' = 'join-requests'), true);
select pg_temp.ok('only the admin''s phone', (select count(*) - (select n from before) = 1 from pg_temp.messages()), true);
select pg_temp.as_member('01');
select pg_temp.works('admin switches off again', $$select public.set_todo_notifications(false)$$);
select set_config('request.jwt.claim.sub', '', false);
drop table before;
create temp table before as select count(*) as n from pg_temp.messages();
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000f2', 'second@example.test', now());
update public.profiles set full_name = 'Second Person', join_requested_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.ok('a switched-off admin gets no join request notification', (select count(*) = (select n from before) from pg_temp.messages()), true);

-- The sent log only keeps the last few months.
insert into public.push_todo_log (profile_id, todo_key, sent_at)
values (pg_temp.id('32'), 'old-key', now() - interval '200 days');
select pg_temp.works('a later run tidies the log', $$select public.send_todo_pushes((select morning + interval '30 minutes' from t))$$);
select pg_temp.ok('the old record is gone', exists (select 1 from public.push_todo_log where todo_key = 'old-key'), false);
