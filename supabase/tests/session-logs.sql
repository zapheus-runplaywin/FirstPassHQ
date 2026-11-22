-- Tests for 20261023210000_session_logs.sql: athletes log each session's
-- minutes and effort (session RPE) beside their daily check-in (customer
-- review R10). Session logs are seen exactly as check-ins are, written only
-- through save_session_log and delete_session_log, and removed with
-- check-ins. Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- How many of an athlete's session logs the signed-in member reads, as the app's role.
create or replace function pg_temp.reads(p_athlete text) returns bigint language plpgsql as
$$ declare v bigint;
   begin
     set local role authenticated;
     select count(*) into v from public.session_logs where athlete_id = pg_temp.id(p_athlete);
     reset role;
     return v;
   end $$;
create or replace function pg_temp.reads_any() returns bigint language plpgsql as
$$ declare v bigint;
   begin
     set local role authenticated;
     select count(*) into v from public.session_logs;
     reset role;
     return v;
   end $$;
-- What a member reads of Jordan's (under 18) and Kai's (adult) sessions.
create or replace function pg_temp.sees(who text, n text, jordan bigint, kai bigint) returns setof text language plpgsql as
$$ begin
     perform pg_temp.as_member(n);
     return next pg_temp.ok(who || ': Jordan''s sessions', pg_temp.reads('31') = jordan, true);
     return next pg_temp.ok(who || ': Kai''s sessions', pg_temp.reads('32') = kai, true);
     return next pg_temp.ok(who || ': no one else''s', pg_temp.reads_any() = jordan + kai, true);
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select pg_temp.ok('row level security is on', (select relrowsecurity from pg_class where oid = 'public.session_logs'::regclass), true);
select pg_temp.ok('signed-in members can read through the policy', has_table_privilege('authenticated', 'public.session_logs', 'select'), true);
select pg_temp.ok('signed-in members cannot insert directly', has_table_privilege('authenticated', 'public.session_logs', 'insert'), false);
select pg_temp.ok('signed-in members cannot update directly', has_table_privilege('authenticated', 'public.session_logs', 'update'), false);
select pg_temp.ok('signed-in members cannot delete directly', has_table_privilege('authenticated', 'public.session_logs', 'delete'), false);
select pg_temp.ok('signed-in members cannot truncate', has_table_privilege('authenticated', 'public.session_logs', 'truncate'), false);
select pg_temp.ok('anon cannot read', has_table_privilege('anon', 'public.session_logs', 'select'), false);
select pg_temp.ok('the service role can manage them', has_table_privilege('service_role', 'public.session_logs', 'delete'), true);
select pg_temp.ok('anon cannot log a session', has_function_privilege('anon', 'public.save_session_log(uuid, date, text, integer, integer)', 'execute'), false);
select pg_temp.ok('anon cannot delete a session', has_function_privilege('anon', 'public.delete_session_log(uuid)', 'execute'), false);
select pg_temp.ok('members can log sessions', has_function_privilege('authenticated', 'public.save_session_log(uuid, date, text, integer, integer)', 'execute'), true);
select pg_temp.ok('members can delete their sessions', has_function_privilege('authenticated', 'public.delete_session_log(uuid)', 'execute'), true);

-- ---------------------------------------------------------------------------
-- Logging sessions
-- ---------------------------------------------------------------------------

select pg_temp.as_member('32');
select pg_temp.works('an adult athlete logs training', $s$ select public.save_session_log(null, public.club_today(), 'training', 90, 6) $s$);
select pg_temp.ok('saved with minutes and effort', (select count(*) = 1 and min(minutes) = 90 and min(rpe) = 6 and min(kind) = 'training' from public.session_logs where athlete_id = pg_temp.id('32')), true);
select pg_temp.works('a second session the same day', $s$ select public.save_session_log(null, public.club_today(), 'gym', 45, 4) $s$);
select pg_temp.works('a game last week', $s$ select public.save_session_log(null, public.club_today() - 7, 'game', 60, 9) $s$);
select pg_temp.works('tomorrow is allowed (time zones)', $s$ select public.save_session_log(null, public.club_today() + 1, 'other', 20, 2) $s$);
select pg_temp.fails('eight days ago is refused', $s$ select public.save_session_log(null, public.club_today() - 8, 'training', 60, 5) $s$);
select pg_temp.fails('two days ahead is refused', $s$ select public.save_session_log(null, public.club_today() + 2, 'training', 60, 5) $s$);
select pg_temp.fails('no day is refused', $s$ select public.save_session_log(null, null, 'training', 60, 5) $s$);
select pg_temp.fails('an unknown kind is refused', $s$ select public.save_session_log(null, public.club_today(), 'swim', 60, 5) $s$);
select pg_temp.fails('no kind is refused', $s$ select public.save_session_log(null, public.club_today(), null, 60, 5) $s$);
select pg_temp.fails('0 minutes is refused', $s$ select public.save_session_log(null, public.club_today(), 'training', 0, 5) $s$);
select pg_temp.fails('over 300 minutes is refused', $s$ select public.save_session_log(null, public.club_today(), 'training', 301, 5) $s$);
select pg_temp.works('300 minutes is allowed', $s$ select public.save_session_log(null, public.club_today() - 1, 'game', 300, 10) $s$);
select pg_temp.works('1 minute and effort 1 are allowed', $s$ select public.save_session_log(null, public.club_today() - 1, 'other', 1, 1) $s$);
select pg_temp.fails('no minutes is refused', $s$ select public.save_session_log(null, public.club_today(), 'training', null, 5) $s$);
select pg_temp.fails('effort 0 is refused', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 0) $s$);
select pg_temp.fails('effort 11 is refused', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 11) $s$);
select pg_temp.fails('no effort is refused', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, null) $s$);
select pg_temp.ok('refusals saved nothing', (select count(*) = 6 from public.session_logs where athlete_id = pg_temp.id('32')), true);

-- Up to 6 a day.
select pg_temp.works('a third today', $s$ select public.save_session_log(null, public.club_today(), 'other', 10, 2) $s$);
select pg_temp.works('a fourth today', $s$ select public.save_session_log(null, public.club_today(), 'other', 10, 2) $s$);
select pg_temp.works('a fifth today', $s$ select public.save_session_log(null, public.club_today(), 'other', 10, 2) $s$);
select pg_temp.works('a sixth today', $s$ select public.save_session_log(null, public.club_today(), 'other', 10, 2) $s$);
select pg_temp.fails('a seventh today is refused', $s$ select public.save_session_log(null, public.club_today(), 'other', 10, 2) $s$);
select pg_temp.ok('six logged today', (select count(*) = 6 from public.session_logs where athlete_id = pg_temp.id('32') and day = public.club_today()), true);
-- Tidy the extra ones away through the athlete's own delete.
do $$ declare r record; begin
  for r in select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'other' and day = public.club_today() loop
    perform public.delete_session_log(r.id);
  end loop;
end $$;
select pg_temp.ok('the athlete deleted their own extra sessions', (select count(*) = 2 from public.session_logs where athlete_id = pg_temp.id('32') and day = public.club_today()), true);

-- Changing a session.
select pg_temp.works('the athlete changes their training', $s$
  select public.save_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'training'), public.club_today() - 1, 'training', 75, 7) $s$);
select pg_temp.ok('changed in place', (select count(*) = 1 and min(minutes) = 75 and min(rpe) = 7 and min(day) = public.club_today() - 1 from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'training'), true);
select pg_temp.fails('a change still checks the day', $s$
  select public.save_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'training'), public.club_today() - 30, 'training', 75, 7) $s$);
select pg_temp.fails('changing a session that doesn''t exist is refused', $s$ select public.save_session_log(gen_random_uuid(), public.club_today(), 'training', 60, 5) $s$);

-- The under 18 logs their own.
select pg_temp.as_member('31');
select pg_temp.works('an under 18 logs training', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);
select pg_temp.fails('Jordan cannot change Kai''s session', $s$
  select public.save_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'game' and minutes = 60), public.club_today(), 'game', 1, 1) $s$);
select pg_temp.fails('Jordan cannot delete Kai''s session', $s$
  select public.delete_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'gym')) $s$);
select pg_temp.ok('Kai''s sessions are untouched', (select count(*) = 1 from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'game' and minutes = 60 and rpe = 9), true);
select pg_temp.fails('deleting a session that doesn''t exist is refused', $s$ select public.delete_session_log(gen_random_uuid()) $s$);

-- Only athletes log sessions.
select pg_temp.as_member('41');
select pg_temp.fails('a guardian cannot log a session', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);
select pg_temp.as_member('11');
select pg_temp.fails('a coach cannot log a session', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);
select pg_temp.fails('a coach cannot change an athlete''s session', $s$
  select public.save_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'gym'), public.club_today(), 'gym', 1, 1) $s$);
select pg_temp.fails('a coach cannot delete an athlete''s session', $s$
  select public.delete_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'gym')) $s$);
select pg_temp.as_member('01');
select pg_temp.fails('an admin cannot log a session', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);
select pg_temp.fails('an admin cannot delete an athlete''s session', $s$
  select public.delete_session_log((select id from public.session_logs where athlete_id = pg_temp.id('32') and kind = 'gym')) $s$);
select pg_temp.as_member('21');
select pg_temp.fails('the committee cannot log a session', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails('nobody signed in cannot log a session', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);

-- A pending athlete and a stood-down athlete.
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('53'), 'athlete.pending@example.test', now());
update public.profiles set status = 'pending', full_name = 'Pat Pending', role = 'athlete' where id = pg_temp.id('53');
select pg_temp.as_member('53');
select pg_temp.fails('an athlete waiting for approval cannot log a session', $s$ select public.save_session_log(null, public.club_today(), 'training', 60, 5) $s$);

-- ---------------------------------------------------------------------------
-- Who reads session logs: exactly who reads check-ins
-- ---------------------------------------------------------------------------

-- Jordan has 1, Kai 6.
select pg_temp.sees('Jordan', '31', 1, 0);
select pg_temp.sees('Kai', '32', 0, 6);
select pg_temp.sees('Jordan''s guardian', '41', 1, 0);
select pg_temp.sees('the coach, before a parent consents', '11', 0, 6);
select pg_temp.sees('the coach-parent (also Jordan''s guardian)', '42', 1, 6);
select pg_temp.sees('the lapsed coach', '12', 0, 0);
select pg_temp.sees('the manager', '13', 0, 0);
select pg_temp.sees('the physio', '14', 0, 0);
select pg_temp.sees('a committee member', '22', 0, 0);
select pg_temp.sees('the exempt treasurer', '23', 0, 0);
select pg_temp.sees('an admin', '01', 0, 0);
select pg_temp.sees('an admin without a check', '02', 0, 0);
select pg_temp.sees('a pending member', '53', 0, 0);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nobody signed in reads none', pg_temp.reads_any() = 0, true);

-- A guardian gives consent: the coach now sees Jordan's sessions too.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
end $$;
select pg_temp.sees('the coach, after consent', '11', 1, 6);
select pg_temp.sees('the manager, after consent', '13', 0, 0);
select pg_temp.sees('an admin, after consent', '01', 0, 0);

-- Teammates never see each other's.
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('54'), 'athlete.teammate@example.test', now());
update public.profiles set status = 'approved', full_name = 'Quinn Teammate', role = 'athlete',
  date_of_birth = public.club_today() - interval '22 years', verified_at = now() where id = pg_temp.id('54');
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.id('a1'), pg_temp.id('54'), 'athlete');
select pg_temp.sees('a teammate', '54', 0, 0);

-- A coach who leaves the squad stops seeing them.
delete from public.team_members where profile_id = pg_temp.id('11');
select pg_temp.sees('the coach, after leaving the squad', '11', 0, 0);

-- Stood down: a stood-down coach-parent still reads their own child's, as a guardian.
update public.profiles set stood_down_at = now() where id = pg_temp.id('42');
select pg_temp.sees('the coach-parent, stood down', '42', 1, 0);
update public.profiles set stood_down_at = null where id = pg_temp.id('42');

-- ---------------------------------------------------------------------------
-- Removed with check-ins
-- ---------------------------------------------------------------------------

insert into public.session_logs (athlete_id, day, kind, minutes, rpe) values
  (pg_temp.id('32'), public.club_today() - interval '13 months', 'training', 60, 5),
  (pg_temp.id('31'), public.club_today() - interval '13 months', 'training', 60, 5),
  (pg_temp.id('32'), public.club_today() - interval '11 months', 'training', 60, 5);
update public.club_settings set retention_enabled = false where id;
select pg_temp.ok('nothing is removed while Remove old records is off', (select public.purge_expired_records() = '{"enabled": false}'::jsonb), true);
select pg_temp.ok('so every old session stays', (select count(*) = 3 from public.session_logs where day < public.club_today() - 300), true);
update public.club_settings set retention_enabled = true, retention_check_ins_months = 12 where id;
-- Jordan is named in a concern, so nothing of theirs goes.
insert into public.concerns (raised_by, raised_by_name, body, about_member_id, about_member_name)
values (pg_temp.id('41'), 'Logan Parent', 'Worried about Jordan', pg_temp.id('31'), 'Jordan Junior');
select pg_temp.ok('the clean-up removes one old session log', (select (r->>'session_logs')::int = 1 from public.purge_expired_records() r), true);
select pg_temp.ok('Kai''s 13-month-old session is gone', (select count(*) = 0 from public.session_logs where athlete_id = pg_temp.id('32') and day < public.club_today() - interval '12 months'), true);
select pg_temp.ok('Kai''s 11-month-old session stays', (select count(*) = 1 from public.session_logs where athlete_id = pg_temp.id('32') and day = (public.club_today() - interval '11 months')::date), true);
select pg_temp.ok('Jordan''s stays while on hold', (select count(*) = 1 from public.session_logs where athlete_id = pg_temp.id('31') and day < public.club_today() - interval '12 months'), true);
select pg_temp.ok('recent sessions stay', (select count(*) = 7 from public.session_logs where day >= public.club_today() - 7), true);
update public.club_settings set retention_check_ins_months = 3 where id;
select pg_temp.ok('a shorter period removes the 11-month-old one', (select (r->>'session_logs')::int = 1 from public.purge_expired_records() r), true);
select pg_temp.ok('the clean-up still reports check-ins', (select r ? 'check_ins' from public.purge_expired_records() r), true);

-- Deleting an account deletes its session logs.
select pg_temp.as_member('32');
select pg_temp.works('Kai deletes their account', $$select public.delete_my_account()$$);
select pg_temp.ok('Kai''s session logs went with it', (select count(*) = 0 from public.session_logs where athlete_id = pg_temp.id('32')), true);

-- ---------------------------------------------------------------------------
-- Re-running the migration
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '', false);
select count(*) as before from public.session_logs \gset
\ir ../migrations/20261023210000_session_logs.sql
select pg_temp.ok('re-running keeps every session log', (select count(*) = :before from public.session_logs), true);
select pg_temp.ok('the table is there once', (select count(*) = 1 from pg_class where relname = 'session_logs' and relnamespace = 'public'::regnamespace), true);
