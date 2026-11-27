-- Tests for 20261127800000_team_events.sql: a squad's or team's coaches and
-- managers add its events in the app, its members see them, and squads and
-- teams take the colours no calendar uses. Signed in as the API role
-- (authenticated) so row level security applies as it does in the app. Run
-- on a fresh database with the migrations and seed-members.sql loaded.
-- Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.id(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.eq(label text, actual text, expected text) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- The events member n sees, by name, comma separated.
create or replace function pg_temp.sees(n text) returns text language sql as
$$ select pg_temp.as_member(n);
   select coalesce(string_agg(distinct title, ',' order by title), '') from public.calendar_events $$;
create or replace function pg_temp.event(n text) returns uuid language sql as
$$ select id from public.calendar_events where title = n order by starts_at limit 1 $$;
-- A day n days from the club's today, as SQL text.
create or replace function pg_temp.day(n int) returns text language sql as
$$ select quote_literal((public.club_today() + n)::text) || '::date' $$;
-- Adds an event for a squad or team as the signed-in member: a name, a day
-- from today, and whether it's for coaches and managers only.
create or replace function pg_temp.add(team text, title text, days int, staff boolean default false) returns text language sql as
$$ select format(
     'select public.save_team_event(null, %L, ''training'', %L, %s, null, false, ''18:00'', ''19:30'', ''Court 1'', null, %L, null)',
     pg_temp.id(team), title, pg_temp.day(days), staff) $$;

-- Extra sample people: a second team with its own coach and athlete, a guest,
-- and a temporary helper.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000081', 'coach.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000082', 'athlete.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000083', 'guest.events@example.test', now()),
  ('00000000-0000-0000-0000-000000000084', 'helper.events@example.test', now());
update public.profiles set status = 'approved', full_name = 'Nico Other-Coach', role = 'coach',
  wwcc_number = 'WWC0081', wwcc_expires_on = public.club_today() + 400, date_of_birth = public.club_today() - interval '35 years'
where id = pg_temp.id('81');
update public.profiles set status = 'approved', full_name = 'Oakley Other-Athlete', role = 'athlete',
  date_of_birth = public.club_today() - interval '22 years'
where id = pg_temp.id('82');
update public.profiles set status = 'approved', full_name = 'Quinn Guest', role = 'guest',
  date_of_birth = public.club_today() - interval '40 years'
where id = pg_temp.id('83');
update public.profiles set status = 'approved', full_name = 'Sky Helper', role = 'volunteer',
  date_of_birth = public.club_today() - interval '30 years'
where id = pg_temp.id('84');
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  (pg_temp.id('b1'), pg_temp.id('81'), 'coach', 'head_coach'),
  (pg_temp.id('b1'), pg_temp.id('82'), 'athlete', null);

-- ---------------------------------------------------------------------------
-- The switch: off until an admin turns it on
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('squad and team events start off', public.team_events_on(), false);
select pg_temp.ok('so a coach can''t manage events yet', public.can_manage_team_events(pg_temp.id('a1')), false);
select pg_temp.fails('and can''t add one', pg_temp.add('a1', 'Too early', 3));
select pg_temp.as_member('01');
select pg_temp.fails('nor can an admin while it''s off', pg_temp.add('a1', 'Too early', 3));
reset role;
select pg_temp.ok('nothing was saved while it was off', (select count(*) = 0 from public.calendar_events), true);
update public.club_settings set features = coalesce(features, '{}') || '{"teamEvents": true}' where id;
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.ok('on once an admin turns it on', public.team_events_on(), true);

-- ---------------------------------------------------------------------------
-- Who may add an event
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('the head coach adds an event for their squad', pg_temp.add('a1', 'Squad training', 3));
select pg_temp.works('and for their team', pg_temp.add('a2', 'Team training', 4));
select pg_temp.works('and one for coaches and managers only', pg_temp.add('a1', 'Staff meeting', 5, true));
select pg_temp.fails('but not for a squad they don''t coach', pg_temp.add('b1', 'Not mine', 3));
select pg_temp.as_member('42');
select pg_temp.works('an assistant coach adds one too', pg_temp.add('a1', 'Assistant session', 6));
select pg_temp.fails('but only in the squad they coach, not its team', pg_temp.add('a2', 'Not my team', 6));
select pg_temp.as_member('13');
select pg_temp.works('the manager adds one', pg_temp.add('a1', 'Manager event', 7));
select pg_temp.as_member('12');
select pg_temp.fails('a coach whose check has lapsed can''t', pg_temp.add('a1', 'Lapsed', 3));
select pg_temp.as_member('14');
select pg_temp.fails('the squad''s physio can''t', pg_temp.add('a1', 'Physio', 3));
select pg_temp.as_member('31');
select pg_temp.fails('an athlete under 18 can''t', pg_temp.add('a1', 'Junior', 3));
select pg_temp.as_member('32');
select pg_temp.fails('an adult athlete can''t', pg_temp.add('a1', 'Senior', 3));
select pg_temp.as_member('41');
select pg_temp.fails('a parent can''t', pg_temp.add('a1', 'Parent', 3));
select pg_temp.as_member('21');
select pg_temp.fails('the committee can''t', pg_temp.add('a1', 'Committee', 3));
select pg_temp.as_member('23');
select pg_temp.fails('nor a committee member with an exemption', pg_temp.add('a1', 'Committee', 3));
select pg_temp.as_member('83');
select pg_temp.fails('a guest can''t', pg_temp.add('a1', 'Guest', 3));
select pg_temp.as_member('84');
select pg_temp.fails('a temporary helper can''t', pg_temp.add('a1', 'Helper', 3));
select pg_temp.as_member('81');
select pg_temp.works('the other squad''s coach adds one for their own squad', pg_temp.add('b1', 'Other training', 3));
select pg_temp.as_member('01');
select pg_temp.works('an admin adds one for any squad', pg_temp.add('b1', 'Admin event', 8));
select pg_temp.as_member('11');
select pg_temp.fails('nobody writes to the table directly',
  format($s$ insert into public.calendar_events (team_id, title, starts_at, ends_at) values (%L, 'Direct', now(), now() + interval '1 hour') $s$, pg_temp.id('a1')));
select pg_temp.fails('or changes a row directly', $s$ update public.calendar_events set title = 'Changed' where true $s$);
select pg_temp.fails('or deletes one directly', $s$ delete from public.calendar_events where true $s$);
reset role;
select pg_temp.eq('only the allowed events were saved',
  (select string_agg(title, ',' order by title) from public.calendar_events),
  'Admin event,Assistant session,Manager event,Other training,Squad training,Staff meeting,Team training');
select pg_temp.eq('an event records who added it',
  (select created_by_name from public.calendar_events where title = 'Squad training'), 'Casey Coach');

-- ---------------------------------------------------------------------------
-- Who sees which events
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.eq('an admin sees every event', pg_temp.sees('01'),
  'Admin event,Assistant session,Manager event,Other training,Squad training,Staff meeting,Team training');
select pg_temp.eq('the head coach sees the squad''s and team''s, with the staff one', pg_temp.sees('11'),
  'Assistant session,Manager event,Squad training,Staff meeting,Team training');
select pg_temp.eq('the assistant coach sees the squad''s with the staff one, and the team''s as a parent of its athlete', pg_temp.sees('42'),
  'Assistant session,Manager event,Squad training,Staff meeting,Team training');
select pg_temp.eq('the manager sees the squad''s, with the staff one', pg_temp.sees('13'),
  'Assistant session,Manager event,Squad training,Staff meeting');
select pg_temp.eq('the physio sees the squad''s, without the staff one', pg_temp.sees('14'),
  'Assistant session,Manager event,Squad training');
select pg_temp.eq('an adult athlete sees the squad''s, without the staff one', pg_temp.sees('32'),
  'Assistant session,Manager event,Squad training');
select pg_temp.eq('an athlete under 18 with a verified parent sees the squad''s and team''s', pg_temp.sees('31'),
  'Assistant session,Manager event,Squad training,Team training');
select pg_temp.eq('their parent sees the same', pg_temp.sees('41'),
  'Assistant session,Manager event,Squad training,Team training');
select pg_temp.eq('a coach whose check has lapsed sees none', pg_temp.sees('12'), '');
select pg_temp.eq('the committee sees none', pg_temp.sees('21'), '');
select pg_temp.eq('a guest sees none', pg_temp.sees('83'), '');
select pg_temp.eq('a temporary helper sees none', pg_temp.sees('84'), '');
select pg_temp.eq('the other squad''s coach sees only their squad''s', pg_temp.sees('81'), 'Admin event,Other training');
select pg_temp.eq('and its athlete the same', pg_temp.sees('82'), 'Admin event,Other training');

-- A child with no verified parent or guardian sees none until one is linked.
reset role;
create temp table kept_guardians as select * from public.guardianships where athlete_id = pg_temp.id('31');
grant select on kept_guardians to authenticated;
delete from public.guardianships where athlete_id = pg_temp.id('31');
set role authenticated;
select pg_temp.eq('a child with no verified parent sees none', pg_temp.sees('31'), '');
reset role;
insert into public.guardianships select * from kept_guardians;
set role authenticated;
select pg_temp.eq('and sees them again once a parent is linked', pg_temp.sees('31'),
  'Assistant session,Manager event,Squad training,Team training');

-- A stood-down coach loses them with the rest of their coaching access.
reset role;
update public.profiles set stood_down_at = now() where id = pg_temp.id('11');
set role authenticated;
select pg_temp.eq('a stood-down coach sees none', pg_temp.sees('11'), '');
select pg_temp.fails('and can''t add one', pg_temp.add('a1', 'Stood down', 3));
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('11');
set role authenticated;

-- The list the app reads: the club's day and times, and who may change it.
select pg_temp.as_member('32');
select pg_temp.eq('the list gives the club''s day and clock times',
  (select day::text || ' ' || start_time || '-' || end_time || ' ' || team_name || ' ' || team_kind
   from public.team_events_between(now(), now() + interval '30 days') where title = 'Squad training'),
  (public.club_today() + 3)::text || ' 18:00-19:30 Sample Squad squad');
select pg_temp.ok('an athlete can''t change what they see',
  (select bool_or(can_manage) from public.team_events_between(now(), now() + interval '30 days')), false);
select pg_temp.as_member('11');
select pg_temp.ok('a coach can change every event of their squad and team',
  (select bool_and(can_manage) from public.team_events_between(now(), now() + interval '30 days')), true);
select pg_temp.ok('the list leaves out events outside the dates asked for',
  (select count(*) = 0 from public.team_events_between(now() + interval '60 days', now() + interval '90 days')), true);

-- ---------------------------------------------------------------------------
-- The club's time zone decides the moment
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.eq('6 pm in Perth is 10 am UTC',
  (select to_char(starts_at at time zone 'UTC', 'HH24:MI') from public.calendar_events where title = 'Squad training'), '10:00');
update public.club_settings set timezone = 'Australia/Sydney' where id;
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.works('an event added after the club moves to Sydney', pg_temp.add('a1', 'Sydney training', 9));
reset role;
select pg_temp.eq('6 pm in Sydney is 7 am or 8 am UTC',
  (select (to_char(starts_at at time zone 'UTC', 'HH24:MI') in ('07:00', '08:00'))::text
   from public.calendar_events where title = 'Sydney training'), 'true');
select pg_temp.eq('and still reads as 6 pm on the club''s clock',
  (select to_char(starts_at at time zone 'Australia/Sydney', 'HH24:MI') from public.calendar_events where title = 'Sydney training'), '18:00');
update public.club_settings set timezone = 'Australia/Perth' where id;
set role authenticated;

-- ---------------------------------------------------------------------------
-- What an event must have
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('it needs a name',
  format($s$ select public.save_team_event(null, %L, 'training', '  ', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(3)));
select pg_temp.fails('and a known kind',
  format($s$ select public.save_team_event(null, %L, 'party', 'Party', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(3)));
select pg_temp.fails('and a day',
  format($s$ select public.save_team_event(null, %L, 'training', 'No day', null, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.id('a1')));
select pg_temp.fails('and a start time unless it''s all day',
  format($s$ select public.save_team_event(null, %L, 'training', 'No time', %s, null, false, null, null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(3)));
select pg_temp.fails('the finish must be after the start',
  format($s$ select public.save_team_event(null, %L, 'training', 'Backwards', %s, null, false, '18:00', '17:00', null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(3)));
select pg_temp.fails('the day must be within 12 months ahead',
  format($s$ select public.save_team_event(null, %L, 'training', 'Far off', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(400)));
select pg_temp.fails('and within 12 months back',
  format($s$ select public.save_team_event(null, %L, 'training', 'Long ago', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(-400)));
select pg_temp.fails('the name is at most 100 characters',
  format($s$ select public.save_team_event(null, %L, 'training', repeat('x', 101), %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(3)));
select pg_temp.fails('the squad or team must exist',
  format($s$ select public.save_team_event(null, gen_random_uuid(), 'training', 'Nowhere', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.day(3)));
select pg_temp.works('with no finish time it runs for an hour',
  format($s$ select public.save_team_event(null, %L, 'meeting', 'Hour long', %s, null, false, '18:00', null, null, '  ', false, null) $s$, pg_temp.id('a1'), pg_temp.day(10)));
reset role;
select pg_temp.eq('an hour', (select (ends_at - starts_at)::text from public.calendar_events where title = 'Hour long'), '01:00:00');
select pg_temp.ok('an empty note is saved as none', (select note is null and location is null from public.calendar_events where title = 'Hour long'), true);

-- All day, on one day or several.
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.works('an all-day event over three days',
  format($s$ select public.save_team_event(null, %L, 'game', 'Tournament', %s, %s, true, null, null, 'Perth', null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(20), pg_temp.day(22)));
select pg_temp.eq('runs from the first day to the last on the club''s calendar',
  (select day::text || ' to ' || end_day::text || ' ' || all_day::text
   from public.team_events_between(now(), now() + interval '60 days') where title = 'Tournament'),
  (public.club_today() + 20)::text || ' to ' || (public.club_today() + 22)::text || ' true');
select pg_temp.fails('the last day can''t be before the first',
  format($s$ select public.save_team_event(null, %L, 'game', 'Backwards days', %s, %s, true, null, null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(20), pg_temp.day(19)));
select pg_temp.fails('or more than 14 days in all',
  format($s$ select public.save_team_event(null, %L, 'game', 'Too long', %s, %s, true, null, null, null, null, false, null) $s$, pg_temp.id('a1'), pg_temp.day(20), pg_temp.day(34)));
reset role;
select pg_temp.eq('three whole days', (select (ends_at - starts_at)::text from public.calendar_events where title = 'Tournament'), '3 days');

-- ---------------------------------------------------------------------------
-- Repeating weekly
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.works('a weekly event for four weeks',
  format($s$ select public.save_team_event(null, %L, 'training', 'Weekly', %s, null, false, '17:00', '18:00', 'Court 2', 'Bring water', false, %s) $s$, pg_temp.id('a2'), pg_temp.day(30), pg_temp.day(30 + 21)));
reset role;
select pg_temp.ok('makes four events', (select count(*) = 4 from public.calendar_events where title = 'Weekly'), true);
select pg_temp.ok('a week apart on the club''s calendar',
  (select array_agg(((starts_at at time zone 'Australia/Perth')::date - public.club_today()) order by starts_at) = array[30, 37, 44, 51]
   from public.calendar_events where title = 'Weekly'), true);
select pg_temp.ok('that share one repeat', (select count(distinct series_id) = 1 and bool_and(series_id is not null) from public.calendar_events where title = 'Weekly'), true);
select pg_temp.ok('a one-off event has no repeat', (select series_id is null from public.calendar_events where title = 'Squad training'), true);
set role authenticated;
select pg_temp.fails('the last day must be after the first',
  format($s$ select public.save_team_event(null, %L, 'training', 'Bad repeat', %s, null, false, '17:00', null, null, null, false, %s) $s$, pg_temp.id('a2'), pg_temp.day(30), pg_temp.day(30)));
select pg_temp.fails('a repeat runs for at most a year',
  format($s$ select public.save_team_event(null, %L, 'training', 'Long repeat', %s, null, false, '17:00', null, null, null, false, %s) $s$, pg_temp.id('a2'), pg_temp.day(1), pg_temp.day(1 + 52 * 7)));
select pg_temp.works('a last day less than a week on makes one event',
  format($s$ select public.save_team_event(null, %L, 'training', 'Short repeat', %s, null, false, '17:00', null, null, null, false, %s) $s$, pg_temp.id('a2'), pg_temp.day(30), pg_temp.day(33)));
reset role;
select pg_temp.ok('one event, no repeat', (select count(*) = 1 and bool_and(series_id is null) from public.calendar_events where title = 'Short repeat'), true);

-- ---------------------------------------------------------------------------
-- Changing an event
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('13');
select pg_temp.works('the manager changes the coach''s event',
  format($s$ select public.save_team_event(%L, null, 'game', 'Squad practice match', %s, null, false, '19:00', '20:00', 'Court 3', 'Bibs', false, null) $s$, pg_temp.event('Squad training'), pg_temp.day(3)));
reset role;
select pg_temp.eq('the change is saved, and who made it',
  (select kind || ' ' || to_char(starts_at at time zone 'Australia/Perth', 'HH24:MI') || ' ' || location || ' ' || note || ' ' || (updated_by = pg_temp.id('13'))::text || ' ' || created_by_name
   from public.calendar_events where title = 'Squad practice match'),
  'game 19:00 Court 3 Bibs true Casey Coach');
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.works('changing one week of a repeat',
  format($s$ select public.save_team_event(%L, null, 'training', 'Weekly (moved)', %s, null, false, '16:00', '17:00', 'Court 2', null, false, %s) $s$, pg_temp.event('Weekly'), pg_temp.day(31), pg_temp.day(200)));
reset role;
select pg_temp.ok('changes that week only, and adds no more', (select count(*) = 3 from public.calendar_events where title = 'Weekly')
  and (select count(*) = 1 from public.calendar_events where title = 'Weekly (moved)'), true);
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.works('an event can''t be moved to another squad: the squad given is ignored',
  format($s$ select public.save_team_event(%L, %L, 'training', 'Team training', %s, null, false, '18:00', '19:30', 'Court 1', null, false, null) $s$, pg_temp.event('Team training'), pg_temp.id('b1'), pg_temp.day(4)));
reset role;
select pg_temp.ok('it stays with its team', (select team_id = pg_temp.id('a2') from public.calendar_events where title = 'Team training'), true);
set role authenticated;
select pg_temp.as_member('81');
select pg_temp.fails('another squad''s coach can''t change it',
  format($s$ select public.save_team_event(%L, null, 'training', 'Taken over', %s, null, false, '18:00', null, null, null, false, null) $s$,
    (select id from (select set_config('role', 'postgres', true)) x, public.calendar_events where title = 'Team training'), pg_temp.day(4)));
select pg_temp.as_member('32');
select pg_temp.fails('an athlete can''t change one they see',
  format($s$ select public.save_team_event(%L, null, 'training', 'Athlete edit', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.event('Manager event'), pg_temp.day(7)));
select pg_temp.as_member('41');
select pg_temp.fails('nor a parent',
  format($s$ select public.save_team_event(%L, null, 'training', 'Parent edit', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.event('Manager event'), pg_temp.day(7)));
select pg_temp.as_member('11');
select pg_temp.fails('an event that has gone can''t be changed',
  format($s$ select public.save_team_event(gen_random_uuid(), null, 'training', 'Ghost', %s, null, false, '18:00', null, null, null, false, null) $s$, pg_temp.day(4)));

-- ---------------------------------------------------------------------------
-- Cancelling, bringing back and removing
-- ---------------------------------------------------------------------------
select pg_temp.as_member('32');
select pg_temp.fails('an athlete can''t cancel', format('select public.cancel_team_event(%L, false)', pg_temp.event('Manager event')));
select pg_temp.fails('or remove', format('select public.remove_team_event(%L, false)', pg_temp.event('Manager event')));
select pg_temp.as_member('41');
select pg_temp.fails('a parent can''t cancel', format('select public.cancel_team_event(%L, false)', pg_temp.event('Manager event')));
select pg_temp.as_member('14');
select pg_temp.fails('the physio can''t cancel', format('select public.cancel_team_event(%L, false)', pg_temp.event('Manager event')));
select pg_temp.as_member('13');
select pg_temp.eq('the manager cancels one event',
  (select public.cancel_team_event(pg_temp.event('Manager event'), false))::text, '1');
select pg_temp.as_member('32');
select pg_temp.eq('it stays on the calendar for the squad, marked cancelled, with who cancelled it',
  (select (cancelled_at is not null)::text || ' ' || cancelled_by_name
   from public.team_events_between(now(), now() + interval '30 days') where title = 'Manager event'),
  'true Emery Manager');
select pg_temp.fails('an athlete can''t bring it back', format('select public.restore_team_event(%L)', pg_temp.event('Manager event')));
select pg_temp.as_member('11');
select pg_temp.works('the coach brings it back', format('select public.restore_team_event(%L)', pg_temp.event('Manager event')));
reset role;
select pg_temp.ok('back on, with no trace of the cancelling',
  (select cancelled_at is null and cancelled_by is null and cancelled_by_name is null from public.calendar_events where title = 'Manager event'), true);

-- This and later ones of a weekly repeat.
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.eq('cancelling the second week and later ones cancels two',
  (select public.cancel_team_event((select id from public.calendar_events where title = 'Weekly' order by starts_at limit 1), true))::text, '3');
reset role;
select pg_temp.ok('the week that was moved earlier is left alone when it comes before',
  (select cancelled_at is null from public.calendar_events where title = 'Weekly (moved)'), true);
update public.calendar_events set cancelled_at = null, cancelled_by = null, cancelled_by_name = null where title = 'Weekly';
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.eq('cancelling the last week alone cancels one',
  (select public.cancel_team_event((select id from public.calendar_events where title = 'Weekly' order by starts_at desc limit 1), true))::text, '1');
select pg_temp.eq('cancelling it again cancels nothing more',
  (select public.cancel_team_event((select id from public.calendar_events where title = 'Weekly' order by starts_at desc limit 1), false))::text, '0');

-- Removing: only before it starts.
select pg_temp.as_member('81');
select pg_temp.fails('another squad''s coach can''t remove',
  format('select public.remove_team_event(%L, false)',
    (select id from (select set_config('role', 'postgres', true)) x, public.calendar_events where title = 'Hour long')));
select pg_temp.as_member('11');
select pg_temp.eq('the coach removes an event added by mistake',
  (select public.remove_team_event(pg_temp.event('Hour long'), false))::text, '1');
select pg_temp.eq('removing a week and later ones of a repeat removes them all',
  (select public.remove_team_event((select id from public.calendar_events where title = 'Weekly' order by starts_at limit 1), true))::text, '3');
reset role;
select pg_temp.ok('they are gone, and other events are untouched',
  (select count(*) = 0 from public.calendar_events where title in ('Hour long', 'Weekly'))
  and (select count(*) = 1 from public.calendar_events where title = 'Weekly (moved)'), true);
-- An event that has started.
insert into public.calendar_events (team_id, title, starts_at, ends_at, created_by_name)
values (pg_temp.id('a1'), 'Yesterday', now() - interval '1 day', now() - interval '23 hours', 'Casey Coach');
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.fails('an event that has started can''t be removed',
  format('select public.remove_team_event(%L, false)', pg_temp.event('Yesterday')));
select pg_temp.eq('but it can be cancelled', (select public.cancel_team_event(pg_temp.event('Yesterday'), false))::text, '1');
select pg_temp.as_member('01');
select pg_temp.fails('not even an admin removes one that has started',
  format('select public.remove_team_event(%L, false)', pg_temp.event('Yesterday')));
select pg_temp.eq('an admin removes one that hasn''t', (select public.remove_team_event(pg_temp.event('Admin event'), false))::text, '1');

-- ---------------------------------------------------------------------------
-- Turning it off again, and an archived squad
-- ---------------------------------------------------------------------------
reset role;
update public.club_settings set features = features || '{"calendar": false}' where id;
set role authenticated;
select pg_temp.eq('with the Calendar off nobody sees events', pg_temp.sees('11'), '');
select pg_temp.fails('or adds one', pg_temp.add('a1', 'Calendar off', 3));
reset role;
update public.club_settings set features = features - 'calendar' || '{"teamEvents": false}' where id;
set role authenticated;
select pg_temp.eq('with squad and team events off nobody sees them, not even admins', pg_temp.sees('01'), '');
select pg_temp.fails('or cancels one', format('select public.cancel_team_event(%L, false)',
  (select id from (select set_config('role', 'postgres', true)) x, public.calendar_events where title = 'Team training')));
reset role;
select pg_temp.ok('nothing is deleted by turning it off', (select count(*) > 5 from public.calendar_events), true);
update public.club_settings set features = features || '{"teamEvents": true}' where id;
set role authenticated;
select pg_temp.eq('turning it back on brings them back', pg_temp.sees('32'),
  'Assistant session,Manager event,Squad practice match,Sydney training,Tournament,Yesterday');

-- Pilot teams only: on for members of the pilot squad, off for everyone else.
reset role;
update public.club_settings set pilot_features = '{"teamEvents": true}' where id;
update public.teams set pilot = true where id = pg_temp.id('a1');
set role authenticated;
select pg_temp.as_member('32');
select pg_temp.ok('in the pilot squad it''s on', public.team_events_on(), true);
select pg_temp.as_member('82');
select pg_temp.ok('outside it, off', public.team_events_on(), false);
select pg_temp.eq('so the other squad sees none', pg_temp.sees('82'), '');
reset role;
update public.club_settings set pilot_features = '{}' where id;
update public.teams set pilot = false where id = pg_temp.id('a1');

update public.teams set archived = true where id = pg_temp.id('b1');
set role authenticated;
select pg_temp.as_member('81');
select pg_temp.fails('an archived squad takes no new events', pg_temp.add('b1', 'Archived', 3));
select pg_temp.as_member('01');
select pg_temp.fails('not even from an admin', pg_temp.add('b1', 'Archived', 3));
reset role;
update public.teams set archived = false where id = pg_temp.id('b1');

-- ---------------------------------------------------------------------------
-- Colours
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('32');
select pg_temp.eq('with no calendars, no colour is kept for one', array_to_string(public.reserved_calendar_colours(), ','), '');
select pg_temp.as_member('01');
select pg_temp.works('a calendar can take one of the four new colours',
  $s$ select public.admin_save_calendar(null, 'Physio availability', 'https://example.test/physio.ics', 'teal', false, array['physio'], null, null) $s$);
select pg_temp.works('each of them',
  $s$ select public.admin_save_calendar(null, 'Reds', 'https://example.test/r.ics', c, false, array['guest'], null, null) from unnest(array['red', 'lime', 'magenta']) c $s$);
select pg_temp.fails('but not a colour that isn''t on the list',
  $s$ select public.admin_save_calendar(null, 'Brown', 'https://example.test/b.ics', 'brown', true, null, null, null) $s$);
reset role;
delete from public.calendars where name = 'Reds';
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.works('a club calendar with no colour picked',
  $s$ select public.admin_save_calendar(null, 'Club', 'https://example.test/club.ics', null, true, null, null, null) $s$);
select pg_temp.works('a committee calendar with no colour picked',
  $s$ select public.admin_save_calendar(null, 'Committee', 'https://example.test/com.ics', null, false, array['committee'], null, null) $s$);
select pg_temp.works('a squad''s own calendar with no colour picked',
  format($s$ select public.admin_save_calendar(null, 'Squad fixtures', 'https://example.test/sq.ics', null, false, null, array[%L::uuid], null) $s$, pg_temp.id('a1')));
select pg_temp.eq('picked colours and the club''s and committee''s usual ones are kept; a squad''s calendar keeps none',
  array_to_string(public.reserved_calendar_colours(), ','), 'pink,teal,yellow');
select pg_temp.as_member('32');
select pg_temp.eq('every member gets the same list, whichever calendars they see',
  array_to_string(public.reserved_calendar_colours(), ','), 'pink,teal,yellow');
select pg_temp.as_member('01');
select pg_temp.works('picking a colour for the squad''s calendar',
  format($s$ select public.admin_save_calendar(%L, 'Squad fixtures', 'https://example.test/sq.ics', 'orange', false, null, array[%L::uuid], null) $s$,
    (select id from public.calendars where name = 'Squad fixtures'), pg_temp.id('a1')));
select pg_temp.eq('keeps that colour too', array_to_string(public.reserved_calendar_colours(), ','), 'orange,pink,teal,yellow');
select pg_temp.works('a calendar for coaches and physios with no colour picked',
  $s$ select public.admin_save_calendar(null, 'Staff', 'https://example.test/staff.ics', null, false, array['coach', 'physio'], null, null) $s$);
select pg_temp.eq('is yellow like the club''s, already kept', array_to_string(public.reserved_calendar_colours(), ','), 'orange,pink,teal,yellow');
reset role;
update public.profiles set status = 'pending' where id = pg_temp.id('83');
set role authenticated;
select pg_temp.as_member('83');
select pg_temp.eq('someone not yet approved is told nothing', array_to_string(public.reserved_calendar_colours(), ','), '');
reset role;
