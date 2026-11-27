-- Tests for 20261128000000_hq_calendars.sql: calendars that live in the app.
-- Admins add them, move a linked one in, and add its events; the people a
-- calendar is shown to see them; coaches, managers and committee members
-- suggest events that only they and admins see until an admin accepts.
-- Signed in as the API role (authenticated) so row level security applies as
-- it does in the app. Run on a fresh database with the migrations and
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
   select coalesce(string_agg(distinct title, ',' order by title), '') from public.hq_calendar_events $$;
create or replace function pg_temp.event(n text) returns uuid language sql as
$$ select id from public.hq_calendar_events where title = n order by starts_at limit 1 $$;
create or replace function pg_temp.cal(n text) returns uuid language sql as
$$ select id from public.calendars where name = n $$;
-- A day n days from the club's today, as SQL text.
create or replace function pg_temp.day(n int) returns text language sql as
$$ select quote_literal((public.club_today() + n)::text) || '::date' $$;
-- Adds (or suggests) an event on a calendar as the signed-in member.
create or replace function pg_temp.add(calendar text, title text, days int, repeat_weeks int default 0) returns text language sql as
$$ select format(
     'select public.save_hq_event(null, %L, ''meeting'', %L, %s, null, false, ''18:00'', ''19:30'', ''Clubrooms'', null, %s)',
     pg_temp.cal(calendar), title, pg_temp.day(days),
     case when repeat_weeks > 0 then pg_temp.day(days + repeat_weeks * 7) else 'null' end) $$;

-- A guest and a temporary helper.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000083', 'guest.hq@example.test', now()),
  ('00000000-0000-0000-0000-000000000084', 'helper.hq@example.test', now());
update public.profiles set status = 'approved', full_name = 'Quinn Guest', role = 'guest',
  date_of_birth = public.club_today() - interval '40 years'
where id = pg_temp.id('83');
update public.profiles set status = 'approved', full_name = 'Sky Helper', role = 'volunteer',
  date_of_birth = public.club_today() - interval '30 years'
where id = pg_temp.id('84');

set role authenticated;

-- ---------------------------------------------------------------------------
-- Adding a calendar that lives in the app: admins only
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t add a calendar in the app',
  $$select public.admin_save_hq_calendar(null, 'Sneaky', null, true, null, null, null, true)$$);
select pg_temp.as_member('23');
select pg_temp.fails('nor can a committee member',
  $$select public.admin_save_hq_calendar(null, 'Sneaky', null, true, null, null, null, true)$$);
select pg_temp.as_member('01');
select pg_temp.fails('it needs a name',
  $$select public.admin_save_hq_calendar(null, ' ', null, true, null, null, null, true)$$);
select pg_temp.fails('and someone to show it to',
  $$select public.admin_save_hq_calendar(null, 'Nobody', null, false, null, null, null, true)$$);
select pg_temp.works('an admin adds a club calendar in the app',
  $$select public.admin_save_hq_calendar(null, 'Club', 'yellow', true, null, null, null, true)$$);
select pg_temp.works('and one for the committee that takes no suggestions',
  $$select public.admin_save_hq_calendar(null, 'Committee', 'pink', false, '{committee}', null, null, false)$$);
select pg_temp.eq('a calendar in the app has no link',
  (select in_hq::text || ',' || coalesce(url, 'none') from public.calendars where name = 'Club'), 'true,none');
select pg_temp.eq('and is shown to everyone',
  (select string_agg(kind, ',') from public.calendar_audiences where calendar_id = pg_temp.cal('Club')), 'everyone');
select pg_temp.ok('the committee one takes no suggestions',
  (select takes_suggestions from public.calendars where name = 'Committee'), false);
select pg_temp.works('an admin renames it and keeps it in the app',
  format($$select public.admin_save_hq_calendar(%L, 'Committee', 'pink', false, '{committee}', null, null, false)$$, pg_temp.cal('Committee')));
select pg_temp.eq('it still has no link', (select coalesce(url, 'none') from public.calendars where name = 'Committee'), 'none');
select pg_temp.eq('the colours kept for calendars include both',
  (select array_to_string(public.reserved_calendar_colours(), ',')), 'pink,yellow');

-- A linked calendar, for moving in later.
select pg_temp.works('an admin adds a linked calendar',
  $$select public.admin_save_calendar(null, 'Outlook', 'https://outlook.example/cal.ics', 'blue', true, null, null, null)$$);
select pg_temp.fails('the linked calendar can''t be saved as one in the app',
  format($$select public.admin_save_hq_calendar(%L, 'Outlook', 'blue', true, null, null, null, true)$$, pg_temp.cal('Outlook')));
reset role;
select pg_temp.fails('a calendar can''t be in the app and keep a link',
  format($$update public.calendars set in_hq = true where id = %L$$, pg_temp.cal('Outlook')));
select pg_temp.fails('nor be a linked calendar without a link',
  format($$update public.calendars set url = null where id = %L$$, pg_temp.cal('Outlook')));
set role authenticated;

-- ---------------------------------------------------------------------------
-- Who may add to or suggest for which calendar
-- ---------------------------------------------------------------------------
create or replace function pg_temp.offered(n text) returns text language sql as
$$ select pg_temp.as_member(n);
   select coalesce(string_agg(name || case when suggest then ':suggest' else ':add' end, ',' order by name), '')
   from public.hq_calendars_to_add_to() $$;
select pg_temp.eq('an admin adds to both', pg_temp.offered('01'), 'Club:add,Committee:add');
select pg_temp.eq('a coach suggests for the club calendar', pg_temp.offered('11'), 'Club:suggest');
select pg_temp.eq('so does a manager', pg_temp.offered('13'), 'Club:suggest');
select pg_temp.eq('and a committee member, but not for the calendar that takes none', pg_temp.offered('23'), 'Club:suggest');
select pg_temp.eq('a coach whose check has lapsed is offered none', pg_temp.offered('12'), '');
select pg_temp.eq('a physio is offered none', pg_temp.offered('14'), '');
select pg_temp.eq('an athlete is offered none', pg_temp.offered('32'), '');
select pg_temp.eq('a child is offered none', pg_temp.offered('31'), '');
select pg_temp.eq('a parent is offered none', pg_temp.offered('41'), '');
select pg_temp.eq('a guest is offered none', pg_temp.offered('83'), '');
select pg_temp.eq('a temporary helper is offered none', pg_temp.offered('84'), '');
select pg_temp.as_member('11');
select pg_temp.ok('a coach can''t suggest for a calendar they don''t see', public.can_suggest_event(pg_temp.cal('Committee')), false);
select pg_temp.ok('nor for a linked calendar', public.can_suggest_event(pg_temp.cal('Outlook')), false);
select pg_temp.as_member('01');
select pg_temp.ok('an admin doesn''t suggest: they add', public.can_suggest_event(pg_temp.cal('Club')), false);

-- ---------------------------------------------------------------------------
-- Admins add events; the people the calendar is shown to see them
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('an admin adds a club event', pg_temp.add('Club', 'Presentation night', 10));
select pg_temp.works('and a committee event', pg_temp.add('Committee', 'Committee meeting', 12));
select pg_temp.eq('an admin''s event is on the calendar at once',
  (select status from public.hq_calendar_events where title = 'Presentation night'), 'on');
select pg_temp.fails('an event can''t go on a linked calendar', pg_temp.add('Outlook', 'Wrong home', 10));
select pg_temp.fails('it needs a name',
  format($$select public.save_hq_event(null, %L, 'meeting', ' ', %s, null, false, '18:00', null, null, null, null)$$, pg_temp.cal('Club'), pg_temp.day(3)));
select pg_temp.fails('and a start time unless it is all day',
  format($$select public.save_hq_event(null, %L, 'meeting', 'No time', %s, null, false, null, null, null, null, null)$$, pg_temp.cal('Club'), pg_temp.day(3)));
select pg_temp.fails('and a day within 12 months',
  format($$select public.save_hq_event(null, %L, 'meeting', 'Far off', %s, null, false, '18:00', null, null, null, null)$$, pg_temp.cal('Club'), pg_temp.day(400)));
select pg_temp.works('an all-day event over two days',
  format($$select public.save_hq_event(null, %L, 'social', 'Club camp', %s, %s, true, null, null, null, null, null)$$, pg_temp.cal('Club'), pg_temp.day(20), pg_temp.day(21)));
select pg_temp.eq('runs from the first midnight to the one after the last day, on the club''s clock',
  (select ((ends_at at time zone public.club_timezone())::date - (starts_at at time zone public.club_timezone())::date)::text
   from public.hq_calendar_events where title = 'Club camp'), '2');

select pg_temp.eq('an admin sees every event', pg_temp.sees('01'), 'Club camp,Committee meeting,Presentation night');
select pg_temp.eq('a coach sees the club ones', pg_temp.sees('11'), 'Club camp,Presentation night');
select pg_temp.eq('an athlete sees the club ones', pg_temp.sees('32'), 'Club camp,Presentation night');
select pg_temp.eq('a child with a verified parent sees the club ones', pg_temp.sees('31'), 'Club camp,Presentation night');
select pg_temp.eq('a parent sees the club ones', pg_temp.sees('41'), 'Club camp,Presentation night');
select pg_temp.eq('a guest sees the club ones', pg_temp.sees('83'), 'Club camp,Presentation night');
select pg_temp.eq('a committee member sees the committee one too', pg_temp.sees('23'), 'Club camp,Committee meeting,Presentation night');
select pg_temp.eq('a temporary helper sees none', pg_temp.sees('84'), '');

select pg_temp.as_member('32');
select pg_temp.eq('the list gives the club''s day, the calendar and whether you may change it',
  (select calendar_name || ',' || day::text || ',' || start_time || ',' || can_manage::text || ',' || mine::text
   from public.hq_events_between(now(), now() + interval '60 days') where title = 'Presentation night'),
  'Club,' || (public.club_today() + 10)::text || ',18:00,false,false');
select pg_temp.fails('an athlete can''t add to the club calendar', pg_temp.add('Club', 'Athlete party', 5));
select pg_temp.fails('or change an event',
  format($$select public.save_hq_event(%L, null, 'meeting', 'Hijacked', %s, null, false, '18:00', null, null, null, null)$$, pg_temp.event('Presentation night'), pg_temp.day(10)));
select pg_temp.fails('or cancel one', format($$select public.cancel_hq_event(%L, false)$$, pg_temp.event('Presentation night')));
select pg_temp.fails('or remove one', format($$select public.remove_hq_event(%L, false)$$, pg_temp.event('Presentation night')));
select pg_temp.fails('or write to the table directly',
  format($$insert into public.hq_calendar_events (calendar_id, title, starts_at, ends_at) values (%L, 'Direct', now(), now() + interval '1 hour')$$, pg_temp.cal('Club')));
select pg_temp.fails('or change a row directly', $$update public.hq_calendar_events set title = 'Direct' where true$$);
select pg_temp.as_member('31');
select pg_temp.fails('a child can''t add to the club calendar', pg_temp.add('Club', 'Kids party', 5));
select pg_temp.as_member('41');
select pg_temp.fails('nor a parent', pg_temp.add('Club', 'Parents party', 5));
select pg_temp.as_member('14');
select pg_temp.fails('nor a physio', pg_temp.add('Club', 'Physio hours', 5));
select pg_temp.as_member('83');
select pg_temp.fails('nor a guest', pg_temp.add('Club', 'Sponsor night', 5));
select pg_temp.as_member('84');
select pg_temp.fails('nor a temporary helper', pg_temp.add('Club', 'Helper night', 5));
select pg_temp.as_member('12');
select pg_temp.fails('nor a coach whose check has lapsed', pg_temp.add('Club', 'Lapsed idea', 5));

-- ---------------------------------------------------------------------------
-- Suggestions: hidden until an admin accepts
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('a coach suggests a club event', pg_temp.add('Club', 'Coaches clinic', 14));
select pg_temp.eq('it waits as a suggestion', (select status from public.hq_calendar_events where title = 'Coaches clinic'), 'suggested');
select pg_temp.fails('a coach can''t suggest for the committee calendar', pg_temp.add('Committee', 'Coach at committee', 14));
select pg_temp.fails('or for a day gone by', pg_temp.add('Club', 'Yesterday', -1));
select pg_temp.as_member('13');
select pg_temp.works('a manager suggests one too', pg_temp.add('Club', 'Uniform fitting', 15));
select pg_temp.as_member('23');
select pg_temp.works('and a committee member, weekly for 3 weeks', pg_temp.add('Club', 'Raffle night', 16, 2));
select pg_temp.eq('each week waits', (select count(*)::text from public.hq_calendar_events where title = 'Raffle night' and status = 'suggested'), '3');
select pg_temp.fails('the committee calendar takes no suggestions', pg_temp.add('Committee', 'Extra meeting', 14));

select pg_temp.eq('the coach sees their own suggestion', pg_temp.sees('11'), 'Club camp,Coaches clinic,Presentation night');
select pg_temp.eq('the manager sees theirs, not the coach''s', pg_temp.sees('13'), 'Club camp,Presentation night,Uniform fitting');
select pg_temp.eq('an athlete sees no suggestion', pg_temp.sees('32'), 'Club camp,Presentation night');
select pg_temp.eq('nor a child', pg_temp.sees('31'), 'Club camp,Presentation night');
select pg_temp.eq('nor a parent', pg_temp.sees('41'), 'Club camp,Presentation night');
select pg_temp.eq('nor a guest', pg_temp.sees('83'), 'Club camp,Presentation night');
select pg_temp.eq('nor another coach', pg_temp.sees('42'), 'Club camp,Presentation night');
select pg_temp.eq('an admin sees them all', pg_temp.sees('01'),
  'Club camp,Coaches clinic,Committee meeting,Presentation night,Raffle night,Uniform fitting');

select pg_temp.as_member('11');
select pg_temp.eq('the coach may change their own while it waits',
  (select can_manage::text || ',' || mine::text from public.hq_events_between(now(), now() + interval '60 days') where title = 'Coaches clinic'), 'true,true');
select pg_temp.works('and does',
  format($$select public.save_hq_event(%L, null, 'training', 'Coaches clinic', %s, null, false, '19:00', '20:00', 'Court 2', null, null)$$, pg_temp.event('Coaches clinic'), pg_temp.day(14)));
select pg_temp.eq('it still waits', (select status from public.hq_calendar_events where title = 'Coaches clinic'), 'suggested');
select pg_temp.fails('a coach can''t change the manager''s suggestion',
  format($$select public.save_hq_event(%L, null, 'training', 'Mine now', %s, null, false, '19:00', null, null, null, null)$$,
    (select id from public.hq_calendar_events where title = 'Uniform fitting'), pg_temp.day(15)));
select pg_temp.fails('a coach can''t accept their own suggestion',
  format($$select public.decide_event_suggestion(%L, true, null)$$, pg_temp.event('Coaches clinic')));
select pg_temp.fails('or cancel it', format($$select public.cancel_hq_event(%L, false)$$, pg_temp.event('Coaches clinic')));
select pg_temp.as_member('23');
select pg_temp.fails('a committee member can''t accept one either',
  format($$select public.decide_event_suggestion(%L, true, null)$$, pg_temp.event('Raffle night')));

-- An admin answers.
select pg_temp.as_member('01');
select pg_temp.fails('declining needs a reason',
  format($$select public.decide_event_suggestion(%L, false, ' ')$$, pg_temp.event('Uniform fitting')));
select pg_temp.eq('an admin accepts the coach''s suggestion',
  (select public.decide_event_suggestion(pg_temp.event('Coaches clinic'), true, null)::text), '1');
select pg_temp.eq('it records who accepted',
  (select status || ',' || decided_by_name from public.hq_calendar_events where title = 'Coaches clinic'), 'on,Alex Admin');
select pg_temp.fails('it can''t be answered twice',
  format($$select public.decide_event_suggestion(%L, false, 'Changed my mind')$$, pg_temp.event('Coaches clinic')));
select pg_temp.eq('an admin declines the manager''s with a reason',
  (select public.decide_event_suggestion(pg_temp.event('Uniform fitting'), false, 'The hall is booked that night')::text), '1');
select pg_temp.eq('accepting one week of a weekly suggestion accepts every week',
  (select public.decide_event_suggestion(pg_temp.event('Raffle night'), true, null)::text), '3');

select pg_temp.eq('everyone now sees the accepted ones', pg_temp.sees('32'), 'Club camp,Coaches clinic,Presentation night,Raffle night');
select pg_temp.eq('a child too', pg_temp.sees('31'), 'Club camp,Coaches clinic,Presentation night,Raffle night');
select pg_temp.eq('the manager still sees the declined one, nobody else does', pg_temp.sees('13'),
  'Club camp,Coaches clinic,Presentation night,Raffle night,Uniform fitting');
select pg_temp.as_member('13');
select pg_temp.eq('with the reason and who declined',
  (select status || ',' || decline_reason || ',' || decided_by_name || ',' || can_manage::text
   from public.hq_events_between(now(), now() + interval '60 days') where title = 'Uniform fitting'),
  'declined,The hall is booked that night,Alex Admin,false');
select pg_temp.fails('a declined suggestion can''t be changed',
  format($$select public.save_hq_event(%L, null, 'other', 'Uniform fitting', %s, null, false, '19:00', null, null, null, null)$$, pg_temp.event('Uniform fitting'), pg_temp.day(17)));
select pg_temp.eq('but the manager can take it away',
  (select public.remove_hq_event(pg_temp.event('Uniform fitting'), false)::text), '1');
select pg_temp.as_member('11');
select pg_temp.fails('once accepted, the coach can''t change it',
  format($$select public.save_hq_event(%L, null, 'training', 'Coaches clinic', %s, null, false, '19:00', null, null, null, null)$$, pg_temp.event('Coaches clinic'), pg_temp.day(14)));
select pg_temp.fails('or remove it', format($$select public.remove_hq_event(%L, false)$$, pg_temp.event('Coaches clinic')));

-- An admin who changes a suggestion accepts it as changed.
select pg_temp.as_member('11');
select pg_temp.works('the coach suggests another', pg_temp.add('Club', 'Umpire course', 18));
select pg_temp.as_member('01');
select pg_temp.works('an admin changes it',
  format($$select public.save_hq_event(%L, null, 'training', 'Umpiring course', %s, null, false, '10:00', '12:00', 'Court 3', null, null)$$, pg_temp.event('Umpire course'), pg_temp.day(19)));
select pg_temp.eq('which accepts it as changed',
  (select status || ',' || decided_by_name || ',' || created_by_name from public.hq_calendar_events where title = 'Umpiring course'),
  'on,Alex Admin,Casey Coach');

-- A coach who is stood down after suggesting keeps seeing their own, and can't suggest more.
select pg_temp.as_member('13');
select pg_temp.works('the manager suggests again', pg_temp.add('Club', 'Bake sale', 22));
reset role;
update public.profiles set stood_down_at = now() where id = pg_temp.id('13');
set role authenticated;
select pg_temp.as_member('13');
select pg_temp.fails('a stood-down manager can''t suggest', pg_temp.add('Club', 'Second bake sale', 23));
select pg_temp.fails('or change the one that waits',
  format($$select public.save_hq_event(%L, null, 'social', 'Bake sale', %s, null, false, '11:00', null, null, null, null)$$, pg_temp.event('Bake sale'), pg_temp.day(22)));
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('13');
set role authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling, bringing back and removing
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.eq('an admin cancels this and later weeks of a weekly event',
  (select public.cancel_hq_event((select id from public.hq_calendar_events where title = 'Raffle night' order by starts_at offset 1 limit 1), true)::text), '2');
select pg_temp.eq('the first week stays on',
  (select count(*)::text from public.hq_calendar_events where title = 'Raffle night' and cancelled_at is null), '1');
select pg_temp.eq('a cancelled event stays for everyone, marked',
  (select pg_temp.sees('32')), 'Club camp,Coaches clinic,Presentation night,Raffle night,Umpiring course');
select pg_temp.as_member('01');
select pg_temp.works('an admin puts one back on',
  format($$select public.restore_hq_event(%L)$$, (select id from public.hq_calendar_events where title = 'Raffle night' order by starts_at offset 1 limit 1)));
select pg_temp.fails('a suggestion can''t be cancelled, only answered',
  format($$select public.cancel_hq_event(%L, false)$$, pg_temp.event('Bake sale')));
select pg_temp.eq('an admin removes an event that hasn''t started',
  (select public.remove_hq_event(pg_temp.event('Club camp'), false)::text), '1');
reset role;
update public.hq_calendar_events set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour'
where title = 'Presentation night';
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.fails('an event that has started can''t be removed',
  format($$select public.remove_hq_event(%L, false)$$, pg_temp.event('Presentation night')));
select pg_temp.eq('an admin can remove a waiting suggestion',
  (select public.remove_hq_event(pg_temp.event('Bake sale'), false)::text), '1');

-- ---------------------------------------------------------------------------
-- Moving a linked calendar into the app
-- ---------------------------------------------------------------------------
create or replace function pg_temp.move(calendar text) returns text language sql as
$$ select format(
  'select public.admin_move_calendar_into_hq(%L, %L::jsonb)', pg_temp.cal(calendar),
  jsonb_build_array(
    jsonb_build_object('title', 'Season launch', 'all_day', false,
      'starts_at', (now() + interval '3 days')::text, 'ends_at', (now() + interval '3 days 2 hours')::text,
      'location', 'Clubrooms', 'note', 'Bring a plate'),
    jsonb_build_object('title', 'Carnival', 'all_day', true,
      'day', (public.club_today() + 30)::text, 'end_day', (public.club_today() + 31)::text),
    jsonb_build_object('title', '  ', 'all_day', false,
      'starts_at', (now() + interval '5 days')::text, 'ends_at', (now() + interval '5 days')::text),
    jsonb_build_object('title', repeat('Long ', 60), 'all_day', false,
      'starts_at', (now() + interval '6 days')::text, 'ends_at', (now() + interval '6 days 1 hour')::text)
  )::text) $$;
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t move a calendar into the app', pg_temp.move('Outlook'));
select pg_temp.as_member('23');
select pg_temp.fails('nor a committee member', pg_temp.move('Outlook'));
select pg_temp.as_member('01');
select pg_temp.fails('the events must be a list',
  format($$select public.admin_move_calendar_into_hq(%L, '{}'::jsonb)$$, pg_temp.cal('Outlook')));
select pg_temp.fails('a calendar already in the app can''t be moved in', pg_temp.move('Club'));
select pg_temp.works('an admin moves the linked calendar in', pg_temp.move('Outlook'));
select pg_temp.eq('its link is put aside, not lost',
  (select in_hq::text || ',' || coalesce(url, 'none') || ',' || imported_from_url || ',' || moved_in_by_name
   from public.calendars where name = 'Outlook'),
  'true,none,https://outlook.example/cal.ics,Alex Admin');
select pg_temp.eq('its audience and colour stay',
  (select c.color || ',' || a.kind from public.calendars c join public.calendar_audiences a on a.calendar_id = c.id where c.name = 'Outlook'),
  'blue,everyone');
select pg_temp.eq('every event came across, on the calendar',
  (select count(*)::text || ',' || bool_and(imported and status = 'on')::text from public.hq_calendar_events where calendar_id = pg_temp.cal('Outlook')),
  '4,true');
select pg_temp.eq('an all-day event keeps its two club days',
  (select ((ends_at at time zone public.club_timezone())::date - (starts_at at time zone public.club_timezone())::date)::text
     || ',' || (starts_at at time zone public.club_timezone())::date::text
   from public.hq_calendar_events where title = 'Carnival'), '2,' || (public.club_today() + 30)::text);
select pg_temp.eq('an event with no name is called Event, and one with no length gets an hour',
  (select (ends_at - starts_at)::text from public.hq_calendar_events where title = 'Event'), '01:00:00');
select pg_temp.eq('a long name is cut to 100 characters',
  (select max(length(title))::text from public.hq_calendar_events where calendar_id = pg_temp.cal('Outlook')), '100');
select pg_temp.ok('members see the moved events', pg_temp.sees('32') ~ 'Carnival' and pg_temp.sees('32') ~ 'Season launch', true);
select pg_temp.as_member('01');
select pg_temp.fails('it can''t be moved in twice', pg_temp.move('Outlook'));
select pg_temp.works('an admin can now add to it', pg_temp.add('Outlook', 'Working bee', 9));
select pg_temp.eq('and coaches can suggest for it', pg_temp.offered('11'), 'Club:suggest,Outlook:suggest');

-- ---------------------------------------------------------------------------
-- The Calendar switch, and deleting a calendar
-- ---------------------------------------------------------------------------
reset role;
update public.club_settings set features = coalesce(features, '{}'::jsonb) || '{"calendar": false}'::jsonb where id;
set role authenticated;
select pg_temp.eq('with the Calendar off nobody sees events', pg_temp.sees('32'), '');
select pg_temp.eq('not even an admin', pg_temp.sees('01'), '');
select pg_temp.as_member('01');
select pg_temp.fails('and an admin can''t add one', pg_temp.add('Club', 'While off', 5));
select pg_temp.eq('and nobody is offered a calendar', pg_temp.offered('11'), '');
reset role;
update public.club_settings set features = features || '{"calendar": true}'::jsonb where id;
set role authenticated;
select pg_temp.ok('switching it back on brings them back', pg_temp.sees('32') ~ 'Coaches clinic', true);

select pg_temp.as_member('01');
select pg_temp.works('an admin deletes the committee calendar',
  format($$delete from public.calendars where id = %L$$, pg_temp.cal('Committee')));
select pg_temp.eq('and its events go with it',
  (select count(*)::text from public.hq_calendar_events where title = 'Committee meeting'), '0');
reset role;
