-- Tests for 20261119100000_consent_follows_feature_switches.sql: a parent's
-- "Give consent" to-do follows the club's feature switches. Check-in consent
-- is asked for only while Daily check-ins is on for the child (pilot teams
-- included); health consent is always asked (it covers medical details, which
-- have no switch); consents already given are kept, never cancelled, so
-- turning Daily check-ins back on doesn't ask again. Covers every kind of
-- member both ways. Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.is(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- What my_child_consents says to parent n about child c.
create or replace function pg_temp.has_data(n text, c text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     select m.data into r from public.my_child_consents() m where m.athlete_id = pg_temp.id(c);
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
create or replace function pg_temp.needs(n text, c text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     select m.needs_consent into r from public.my_child_consents() m where m.athlete_id = pg_temp.id(c);
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
create or replace function pg_temp.check_ins_on(n text, c text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     select m.check_ins_on into r from public.my_child_consents() m where m.athlete_id = pg_temp.id(c);
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
create or replace function pg_temp.row_count(n text) returns bigint language plpgsql as
$$ declare r bigint; begin
     perform pg_temp.as_member(n);
     select count(*) into r from public.my_child_consents();
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
-- The consent to-do member n gets for child c (key and second line), if any.
create or replace function pg_temp.todo_key(n text, c text) returns text language sql as
$$ select m.todo_key from public.member_todos(pg_temp.id(n)) m where m.todo_key like 'consent:' || pg_temp.id(c) || '%' $$;
create or replace function pg_temp.todo_detail(n text, c text) returns text language sql as
$$ select m.detail from public.member_todos(pg_temp.id(n)) m where m.todo_key like 'consent:' || pg_temp.id(c) || '%' $$;
create or replace function pg_temp.any_consent_todo(n text) returns boolean language sql as
$$ select exists (select 1 from public.member_todos(pg_temp.id(n)) m where m.todo_key like 'consent:%') $$;
-- An admin turns a feature on or off, the way Club settings saves it.
create or replace function pg_temp.switch(feature text, on_ boolean) returns void language plpgsql as
$$ begin
     update public.club_settings
     set features = case when on_ then features - feature else features || jsonb_build_object(feature, false) end
     where id;
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- Extra people: 55 Riley is a second child of Logan (41) in Other Team,
-- outside Sample Squad; 56 Sky is an adult athlete; 57 Taylor a parent of
-- Riley not yet verified.
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000b2', 'Other Team', 'team', '00000000-0000-0000-0000-0000000000b1', 4);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000055', 'second.child@example.test', now()),
  ('00000000-0000-0000-0000-000000000057', 'unverified.parent@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  date_of_birth = v.dob, verified_at = v.verified
from (values
  ('00000000-0000-0000-0000-000000000055', 'Riley Second', 'athlete', (current_date - interval '13 years')::date, now()),
  ('00000000-0000-0000-0000-000000000057', 'Taylor Unverified', 'guardian', (current_date - interval '40 years')::date, null)
) as v(id, name, role, dob, verified)
where p.id = v.id::uuid;
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000055', 'athlete');
insert into public.guardianships (guardian_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000055'),
  ('00000000-0000-0000-0000-000000000057', '00000000-0000-0000-0000-000000000055');

-- ---------------------------------------------------------------------------
-- 1. Who can call what
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon can''t read consents', has_function_privilege('anon', 'public.my_child_consents()', 'execute'), false);
select pg_temp.ok('signed-in members can read their own children''s consents', has_function_privilege('authenticated', 'public.my_child_consents()', 'execute'), true);
select pg_temp.ok('the app can''t call feature_on_for', has_function_privilege('authenticated', 'public.feature_on_for(uuid, text, boolean)', 'execute'), false);
select pg_temp.ok('anon can''t call feature_on_for', has_function_privilege('anon', 'public.feature_on_for(uuid, text, boolean)', 'execute'), false);
select pg_temp.ok('the app can''t call profile_in_pilot', has_function_privilege('authenticated', 'public.profile_in_pilot(uuid)', 'execute'), false);
select pg_temp.ok('the app can''t call consent_todo_detail', has_function_privilege('authenticated', 'public.consent_todo_detail(boolean, boolean)', 'execute'), false);
select pg_temp.ok('the app still can''t run member_todos', has_function_privilege('authenticated', 'public.member_todos(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('only one my_child_consents (no overloads)', (select count(*) = 1 from pg_proc where proname = 'my_child_consents' and pronamespace = 'public'::regnamespace), true);
select pg_temp.ok('only one member_todos (no overloads)', (select count(*) = 1 from pg_proc where proname = 'member_todos' and pronamespace = 'public'::regnamespace), true);

-- ---------------------------------------------------------------------------
-- 2. Other kinds of member get no consent rows or to-dos
-- ---------------------------------------------------------------------------
select pg_temp.ok('an admin has no children listed', pg_temp.row_count('01') = 0, true);
select pg_temp.ok('a coach has none', pg_temp.row_count('11') = 0, true);
select pg_temp.ok('a manager has none', pg_temp.row_count('13') = 0, true);
select pg_temp.ok('a physio has none', pg_temp.row_count('14') = 0, true);
select pg_temp.ok('committee has none', pg_temp.row_count('21') = 0, true);
select pg_temp.ok('the child has none', pg_temp.row_count('31') = 0, true);
select pg_temp.ok('an adult athlete has none', pg_temp.row_count('32') = 0, true);
select pg_temp.ok('no consent to-do for an admin', pg_temp.any_consent_todo('01'), false);
select pg_temp.ok('no consent to-do for a coach', pg_temp.any_consent_todo('11'), false);
select pg_temp.ok('no consent to-do for committee', pg_temp.any_consent_todo('21'), false);
select pg_temp.ok('no consent to-do for the child', pg_temp.any_consent_todo('31'), false);
select pg_temp.ok('no consent to-do for an adult athlete', pg_temp.any_consent_todo('32'), false);

-- ---------------------------------------------------------------------------
-- 3. Daily check-ins on (never switched): both consents asked
-- ---------------------------------------------------------------------------
select pg_temp.ok('check-ins on for Jordan by default', pg_temp.check_ins_on('41', '31'), true);
select pg_temp.ok('Logan has consent to give for Jordan', pg_temp.needs('41', '31'), true);
select pg_temp.is('to-do asks for check-in consent', pg_temp.todo_key('41', '31'), 'consent:' || pg_temp.id('31') || ':check-ins');
select pg_temp.is('and names both', pg_temp.todo_detail('41', '31'), 'Choose who sees their check-ins and injury details');
select pg_temp.ok('Morgan (coach and parent) has it too', pg_temp.needs('42', '31'), true);
select pg_temp.ok('the unverified parent has no consent to give', pg_temp.needs('57', '55'), false);
select pg_temp.ok('and no consent to-do', pg_temp.any_consent_todo('57'), false);
select pg_temp.ok('the unverified parent still sees Riley listed', (pg_temp.row_count('57') = 1), true);

-- Logan gives health consent only.
select pg_temp.as_member('41');
select pg_temp.works('Logan gives health consent for Jordan', $$select public.set_child_consent('00000000-0000-0000-0000-000000000031', false, true)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('check-in consent still to give', pg_temp.needs('41', '31'), true);
select pg_temp.is('to-do asks only about check-ins', pg_temp.todo_detail('41', '31'), 'Choose who sees their check-ins');

create temp table before_off as select count(*) as n, count(*) filter (where withdrawn_at is null) as active from public.child_consents;

-- ---------------------------------------------------------------------------
-- 4. Accidentally on, then off: the unanswered to-do goes, nothing is lost
-- ---------------------------------------------------------------------------
select pg_temp.switch('checkIns', false);
select pg_temp.ok('check-ins off for Jordan', pg_temp.check_ins_on('41', '31'), false);
select pg_temp.ok('Logan has nothing left to give for Jordan', pg_temp.needs('41', '31'), false);
select pg_temp.ok('Logan''s to-do for Jordan is gone', pg_temp.todo_key('41', '31') is null, true);
select pg_temp.ok('consent is per child: Morgan, Jordan''s other parent, has none to give either', pg_temp.needs('42', '31'), false);
select pg_temp.ok('Riley still needs health consent, so keeps a to-do', pg_temp.needs('41', '55'), true);
select pg_temp.is('which no longer mentions check-ins', pg_temp.todo_detail('41', '55'), 'Choose who sees their injury and medical details');
select pg_temp.is('and has the plain key', pg_temp.todo_key('41', '55'), 'consent:' || pg_temp.id('55'));
select pg_temp.ok('no consent rows added or removed', (select count(*) from public.child_consents) = (select n from before_off), true);
select pg_temp.ok('no consent withdrawn', (select count(*) filter (where withdrawn_at is null) from public.child_consents) = (select active from before_off), true);
select pg_temp.ok('Jordan''s health consent still in force', public.has_child_consent(pg_temp.id('31'), 'health'), true);

-- Health consent is asked for even with Injuries off: medical details have no switch.
select pg_temp.switch('injuries', false);
select pg_temp.ok('with Injuries off too, Riley still needs health consent', pg_temp.needs('41', '55'), true);
select pg_temp.is('asked as injury and medical details', pg_temp.todo_detail('41', '55'), 'Choose who sees their injury and medical details');
-- Turning Injuries off pauses it: records stay, registers keep the injured note,
-- and the admin's warning can count what is open.
select pg_temp.ok('Jordan''s injury is still there with Injuries off', (
  select count(*) = 1 from public.injuries where athlete_id = pg_temp.id('31') and status <> 'cleared'), true);
select pg_temp.as_member('11');
select pg_temp.ok('the coach''s register still shows Jordan as injured', (
  select count(*) = 1 from public.injured_on('00000000-0000-0000-0000-0000000000a1', current_date) i
  where i.profile_id = pg_temp.id('31')), true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin can count open injuries for the warning', (
  select count(*) >= 1 from public.visible_injuries() v where v.athlete_id = pg_temp.id('31')), true);
select pg_temp.as_member('41');
select pg_temp.ok('a parent''s register view is unchanged (not an attendance taker)', (
  select count(*) = 0 from public.injured_on(null, current_date)), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.switch('injuries', true);

-- ---------------------------------------------------------------------------
-- 5. Back on: asked again straight away, only where consent wasn't given
-- ---------------------------------------------------------------------------
select pg_temp.switch('checkIns', true);
select pg_temp.ok('Logan is asked for check-in consent again', pg_temp.needs('41', '31'), true);
select pg_temp.is('with the check-ins key', pg_temp.todo_key('41', '31'), 'consent:' || pg_temp.id('31') || ':check-ins');

select pg_temp.as_member('41');
select pg_temp.works('Logan gives check-in consent too', $$select public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nothing left to give', pg_temp.needs('41', '31'), false);
select pg_temp.switch('checkIns', false);
select pg_temp.ok('turned off: still nothing to give', pg_temp.needs('41', '31'), false);
select pg_temp.ok('the given check-in consent is kept while off', public.has_child_consent(pg_temp.id('31'), 'data'), true);
select pg_temp.ok('the parent still sees it as given', pg_temp.has_data('41', '31'), true);
select pg_temp.switch('checkIns', true);
select pg_temp.ok('turned on again: Logan isn''t asked again', pg_temp.needs('41', '31'), false);
select pg_temp.ok('and has no consent to-do for Jordan', pg_temp.todo_key('41', '31') is null, true);
select pg_temp.ok('nor is Morgan, Jordan''s other parent', pg_temp.todo_key('42', '31') is null, true);
select pg_temp.is('Riley, with no consent given, is asked for both', pg_temp.todo_detail('41', '55'), 'Choose who sees their check-ins and injury details');

-- A parent can still withdraw check-in consent while the feature is off.
select pg_temp.switch('checkIns', false);
select pg_temp.as_member('41');
select pg_temp.works('Logan withdraws check-in consent while check-ins are off', $$select public.set_child_consent('00000000-0000-0000-0000-000000000031', false, true)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('the withdrawal is recorded', public.has_child_consent(pg_temp.id('31'), 'data'), false);
select pg_temp.ok('and kept on record', (select count(*) = 1 from public.child_consents where athlete_id = pg_temp.id('31') and kind = 'data' and withdrawn_at is not null), true);
select pg_temp.ok('no to-do while off', pg_temp.todo_key('41', '31') is null, true);
select pg_temp.switch('checkIns', true);
select pg_temp.ok('asked again once check-ins are back on', pg_temp.needs('41', '31'), true);

-- ---------------------------------------------------------------------------
-- 6. Pilot teams only: follows the child, not the parent
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('admin pilots Daily check-ins with Sample Team', $$select public.admin_set_pilot('{checkIns}', '{00000000-0000-0000-0000-0000000000a2}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('Jordan is in the pilot: check-ins on', pg_temp.check_ins_on('41', '31'), true);
select pg_temp.ok('Jordan''s parent is asked', pg_temp.needs('41', '31'), true);
select pg_temp.ok('Riley isn''t: check-ins off for Riley', pg_temp.check_ins_on('41', '55'), false);
select pg_temp.as_member('41');
select pg_temp.works('Logan gives health consent for Riley', $$select public.set_child_consent('00000000-0000-0000-0000-000000000055', false, true)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('Logan sees check-ins (Jordan is in the pilot) but isn''t asked for Riley', pg_temp.needs('41', '55'), false);
select pg_temp.ok('no consent to-do for Riley', pg_temp.todo_key('41', '55') is null, true);
select pg_temp.as_member('01');
select pg_temp.works('admin moves the pilot to Other Squad', $$select public.admin_set_pilot('{checkIns}', '{00000000-0000-0000-0000-0000000000b1}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('Riley''s team is in it through the squad: asked now', pg_temp.needs('41', '55'), true);
select pg_temp.is('for check-ins only', pg_temp.todo_detail('41', '55'), 'Choose who sees their check-ins');
select pg_temp.ok('Jordan left the pilot: not asked', pg_temp.needs('41', '31'), false);
select pg_temp.as_member('01');
select pg_temp.works('admin ends the pilot (on for everyone)', $$select public.admin_set_pilot('{}', '{}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('everyone asked again: Jordan', pg_temp.needs('41', '31'), true);
select pg_temp.ok('and Riley', pg_temp.needs('41', '55'), true);

-- ---------------------------------------------------------------------------
-- 7. Live streams: the stream stats question follows its switch
-- ---------------------------------------------------------------------------
create or replace function pg_temp.streams_on(n text, c text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     select m.streams_on into r from public.my_child_consents() m where m.athlete_id = pg_temp.id(c);
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
select pg_temp.ok('Live streams is on unless an admin turns it off', pg_temp.streams_on('41', '31'), true);
select pg_temp.as_member('41');
select pg_temp.works('Logan gives stream consent for Jordan', $$select public.set_child_publish_consent('00000000-0000-0000-0000-000000000031', true)$$);
select set_config('request.jwt.claim.sub', '', false);
create temp table before_streams_off as select count(*) as n from public.child_consents;
select pg_temp.switch('liveStreams', false);
select pg_temp.ok('turned off: off for Jordan', pg_temp.streams_on('41', '31'), false);
select pg_temp.ok('and for Riley', pg_temp.streams_on('41', '55'), false);
select pg_temp.ok('stream consent kept while off', public.has_child_consent(pg_temp.id('31'), 'publish'), true);
select pg_temp.ok('no consent rows changed', (select count(*) from public.child_consents) = (select n from before_streams_off), true);
select pg_temp.ok('stream consent never makes a to-do', pg_temp.todo_key('41', '31') like '%publish%', false);
select pg_temp.as_member('41');
select pg_temp.works('Logan can still withdraw it while off', $$select public.set_child_publish_consent('00000000-0000-0000-0000-000000000031', false)$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('withdrawn', public.has_child_consent(pg_temp.id('31'), 'publish'), false);
select pg_temp.switch('liveStreams', true);
select pg_temp.ok('on again', pg_temp.streams_on('41', '31'), true);

-- ---------------------------------------------------------------------------
-- 8. Nothing else about consent changed
-- ---------------------------------------------------------------------------
select pg_temp.ok('coaches still don''t see Jordan''s check-ins without consent', (
  select public.has_child_consent(pg_temp.id('31'), 'data')), false);
select pg_temp.ok('adult athletes need no consent', public.has_child_consent(pg_temp.id('32'), 'data'), true);
select pg_temp.ok('publish consent still listed for parents', (
  select count(*) = 1 from information_schema.routines r
  join information_schema.parameters x on x.specific_name = r.specific_name
  where r.routine_schema = 'public' and r.routine_name = 'my_child_consents' and x.parameter_name = 'publish'), true);
