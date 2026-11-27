-- Tests for 20261128100000_calendar_phone_links.sql: the phone link for a
-- club-wide calendar kept in the app. Only admins turn it on, reset it, turn
-- it off or read its key; only a calendar kept in the app and shown to
-- everyone can have one; and the feed gives names, times and places of events
-- on the calendar, never notes, people or suggestions, and stops at once
-- when it should. Signed in as the API role (authenticated) so row level
-- security applies as it does in the app; the feed itself is read as the
-- service role, as the calendar-feed function does. Run on a fresh database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
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
create or replace function pg_temp.cal(n text) returns uuid language sql as
$$ select id from public.calendars where name = n $$;
create or replace function pg_temp.day(n int) returns text language sql as
$$ select quote_literal((public.club_today() + n)::text) || '::date' $$;
-- The feed for a key, read as the calendar-feed function reads it.
create or replace function pg_temp.feed(p_token text) returns jsonb language plpgsql as
$$ declare v jsonb; begin
     set local role service_role;
     v := public.calendar_phone_feed(p_token);
     set local role authenticated;
     return v;
   end $$;
-- The names of the events a feed gives, in order.
create or replace function pg_temp.titles(p_feed jsonb) returns text language sql as
$$ select coalesce(string_agg(e ->> 'title', ',' order by ord), '') from jsonb_array_elements(p_feed -> 'events') with ordinality t(e, ord) $$;
create temp table keys (name text primary key, token text);
grant all on keys to authenticated, service_role;

set role authenticated;
select pg_temp.as_member('01');
select public.admin_save_hq_calendar(null, 'Club', 'yellow', true, null, null, null, true) is not null;
select public.admin_save_hq_calendar(null, 'Committee', 'pink', false, '{committee}', null, null, true) is not null;
select public.admin_save_calendar(null, 'Outlook', 'https://example.test/club.ics', 'blue', true, null, null, null) is not null;
select public.save_hq_event(null, pg_temp.cal('Club'), 'social', 'Presentation night', public.club_today() + 10, null, false, '18:00', '21:00', 'Clubrooms', 'Bring a plate. Ring Sam on 0400 000 000', null) is not null;
select public.save_hq_event(null, pg_temp.cal('Club'), 'other', 'Carnival', public.club_today() + 20, public.club_today() + 21, true, null, null, 'Showgrounds', null, null) is not null;
select public.save_hq_event(null, pg_temp.cal('Club'), 'meeting', 'Called off', public.club_today() + 5, null, false, '19:00', '20:00', null, null, null) is not null;
select public.cancel_hq_event((select id from public.hq_calendar_events where title = 'Called off'), false) is null;
select public.save_hq_event(null, pg_temp.cal('Committee'), 'meeting', 'Committee meeting', public.club_today() + 3, null, false, '19:00', '20:00', null, null, null) is not null;
-- A coach's suggestion, and one an admin declined.
select pg_temp.as_member('11');
select public.save_hq_event(null, pg_temp.cal('Club'), 'social', 'Quiz night', public.club_today() + 12, null, false, '18:00', '21:00', null, null, null) is not null;
select public.save_hq_event(null, pg_temp.cal('Club'), 'social', 'Car wash', public.club_today() + 13, null, false, '10:00', '12:00', null, null, null) is not null;
select pg_temp.as_member('01');
select public.decide_event_suggestion((select id from public.hq_calendar_events where title = 'Car wash'), false, 'Car park closed') is null;

-- ---------------------------------------------------------------------------
-- Who may turn a link on: admins only, for every other kind of member refused
-- ---------------------------------------------------------------------------
select pg_temp.eq('no calendar has a link to start with',
  (select count(*)::text from public.admin_calendar_phone_links()), '0');
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t turn a link on',
  format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.fails('or read the links', $$select * from public.admin_calendar_phone_links()$$);
select pg_temp.as_member('13');
select pg_temp.fails('nor a manager', format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.fails('or read the links', $$select * from public.admin_calendar_phone_links()$$);
select pg_temp.as_member('23');
select pg_temp.fails('nor a committee member', format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.fails('or read the links', $$select * from public.admin_calendar_phone_links()$$);
select pg_temp.as_member('14');
select pg_temp.fails('nor a physio', format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.as_member('32');
select pg_temp.fails('nor an athlete', format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.fails('or read the links', $$select * from public.admin_calendar_phone_links()$$);
select pg_temp.as_member('31');
select pg_temp.fails('nor a child', format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.as_member('41');
select pg_temp.fails('nor a parent', format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Club')));
select pg_temp.fails('or read the links', $$select * from public.admin_calendar_phone_links()$$);
select pg_temp.fails('nobody signed in as a member reads the table',
  $$select * from public.calendar_phone_links$$);
select pg_temp.fails('or writes to it',
  format($$insert into public.calendar_phone_links (calendar_id, token) values (%L, repeat('a', 48))$$, pg_temp.cal('Club')));
select pg_temp.fails('or reads a feed, even with a key',
  $$select public.calendar_phone_feed(repeat('a', 48))$$);

-- ---------------------------------------------------------------------------
-- Which calendars can have one
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.fails('a calendar shown to the committee only can''t have a link',
  format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Committee')));
select pg_temp.fails('nor one that is still an Outlook link',
  format($$select public.admin_set_calendar_phone_link(%L, 'on')$$, pg_temp.cal('Outlook')));
select pg_temp.fails('nor a calendar that doesn''t exist',
  $$select public.admin_set_calendar_phone_link(gen_random_uuid(), 'on')$$);
select pg_temp.fails('and the action must be on, reset or off',
  format($$select public.admin_set_calendar_phone_link(%L, 'maybe')$$, pg_temp.cal('Club')));

-- ---------------------------------------------------------------------------
-- On, and what the link gives
-- ---------------------------------------------------------------------------
insert into keys select 'first', public.admin_set_calendar_phone_link(pg_temp.cal('Club'), 'on');
select pg_temp.ok('an admin turns the club calendar''s link on, with a long random key',
  (select length(token) = 48 and token ~ '^[0-9a-f]+$' from keys where name = 'first'), true);
select pg_temp.eq('turning it on again gives the same key',
  public.admin_set_calendar_phone_link(pg_temp.cal('Club'), 'on'), (select token from keys where name = 'first'));
select pg_temp.eq('the admin''s list shows it, with who turned it on',
  (select count(*)::text || ',' || min(token) || ',' || (min(created_by_name) is not null)::text from public.admin_calendar_phone_links()),
  '1,' || (select token from keys where name = 'first') || ',true');

select pg_temp.eq('the feed names the calendar',
  pg_temp.feed((select token from keys where name = 'first')) ->> 'name', 'Club');
select pg_temp.eq('and gives the events on the calendar, soonest first, cancelled ones too',
  pg_temp.titles(pg_temp.feed((select token from keys where name = 'first'))), 'Called off,Presentation night,Carnival');
select pg_temp.ok('never a suggestion, a declined one or another calendar''s event',
  pg_temp.feed((select token from keys where name = 'first'))::text ~ 'Quiz night|Car wash|Committee meeting', false);
select pg_temp.ok('never a note, a reason or anyone''s name',
  pg_temp.feed((select token from keys where name = 'first'))::text ~* 'plate|0400|Car park|created_by|note|decline', false);
select pg_temp.eq('each event has only its name, time, place and whether it''s off',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.feed((select token from keys where name = 'first')) -> 'events' -> 0) k),
  'all_day,cancelled,changed_at,day,end_day,ends_at,id,location,starts_at,title');
select pg_temp.eq('a cancelled event is marked',
  (select e ->> 'cancelled' from jsonb_array_elements(pg_temp.feed((select token from keys where name = 'first')) -> 'events') e where e ->> 'title' = 'Called off'), 'true');
select pg_temp.eq('an all-day event gives the club''s days, the last day included',
  (select (e ->> 'all_day') || ',' || (e ->> 'day') || ',' || (e ->> 'end_day') from jsonb_array_elements(pg_temp.feed((select token from keys where name = 'first')) -> 'events') e where e ->> 'title' = 'Carnival'),
  'true,' || (public.club_today() + 20)::text || ',' || (public.club_today() + 21)::text);
select pg_temp.eq('a timed event gives its place',
  (select e ->> 'location' from jsonb_array_elements(pg_temp.feed((select token from keys where name = 'first')) -> 'events') e where e ->> 'title' = 'Presentation night'), 'Clubrooms');

select pg_temp.ok('an unknown key gives nothing', pg_temp.feed(repeat('b', 48)) is null, true);
select pg_temp.ok('nor a short one', pg_temp.feed('abc') is null, true);
select pg_temp.ok('nor none at all', pg_temp.feed(null) is null, true);
select pg_temp.ok('nor part of the real key',
  pg_temp.feed(left((select token from keys where name = 'first'), 40)) is null, true);

-- Events long past or far ahead are left out.
reset role;
insert into public.hq_calendar_events (calendar_id, title, starts_at, ends_at, status)
values (pg_temp.cal('Club'), 'Long ago', now() - interval '5 months', now() - interval '5 months' + interval '1 hour', 'on'),
       (pg_temp.cal('Club'), 'Last month', now() - interval '1 month', now() - interval '1 month' + interval '1 hour', 'on');
set role authenticated;
select pg_temp.eq('the feed reaches 3 months back, no further',
  pg_temp.titles(pg_temp.feed((select token from keys where name = 'first'))), 'Last month,Called off,Presentation night,Carnival');

-- ---------------------------------------------------------------------------
-- When it stops
-- ---------------------------------------------------------------------------
insert into keys select 'second', public.admin_set_calendar_phone_link(pg_temp.cal('Club'), 'reset');
select pg_temp.ok('resetting gives a new key',
  (select token from keys where name = 'second') <> (select token from keys where name = 'first'), true);
select pg_temp.ok('the old link stops working at once',
  pg_temp.feed((select token from keys where name = 'first')) is null, true);
select pg_temp.eq('and the new one works',
  pg_temp.feed((select token from keys where name = 'second')) ->> 'name', 'Club');

-- Shown to the committee only: the link stops, and isn't listed.
select public.admin_save_hq_calendar(pg_temp.cal('Club'), 'Club', 'yellow', false, '{committee}', null, null, true) is not null;
select pg_temp.ok('once the calendar isn''t shown to everyone the link gives nothing',
  pg_temp.feed((select token from keys where name = 'second')) is null, true);
select pg_temp.eq('and the admin''s list leaves it out',
  (select count(*)::text from public.admin_calendar_phone_links()), '0');
select public.admin_save_hq_calendar(pg_temp.cal('Club'), 'Club', 'yellow', true, null, null, null, true) is not null;
select pg_temp.eq('shown to everyone again, it works again and is listed',
  (pg_temp.feed((select token from keys where name = 'second')) ->> 'name') || ',' || (select count(*)::text from public.admin_calendar_phone_links()),
  'Club,1');

-- The club's Calendar feature off, or kept to a pilot.
reset role;
update public.club_settings set features = features || '{"calendar": false}'::jsonb where id;
set role authenticated;
select pg_temp.ok('with the Calendar feature off the link gives nothing',
  pg_temp.feed((select token from keys where name = 'second')) is null, true);
reset role;
update public.club_settings set features = features - 'calendar', pilot_features = pilot_features || '{"calendar": true}'::jsonb where id;
set role authenticated;
select pg_temp.ok('nor while the calendar is only for a pilot',
  pg_temp.feed((select token from keys where name = 'second')) is null, true);
reset role;
update public.club_settings set pilot_features = pilot_features - 'calendar' where id;
set role authenticated;
select pg_temp.eq('back on, it works', pg_temp.feed((select token from keys where name = 'second')) ->> 'name', 'Club');

-- Off.
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t turn it off',
  format($$select public.admin_set_calendar_phone_link(%L, 'off')$$, pg_temp.cal('Club')));
select pg_temp.fails('or reset it',
  format($$select public.admin_set_calendar_phone_link(%L, 'reset')$$, pg_temp.cal('Club')));
select pg_temp.as_member('01');
select pg_temp.ok('an admin turns it off',
  public.admin_set_calendar_phone_link(pg_temp.cal('Club'), 'off') is null, true);
select pg_temp.ok('and the link gives nothing', pg_temp.feed((select token from keys where name = 'second')) is null, true);
select pg_temp.eq('and no link is listed', (select count(*)::text from public.admin_calendar_phone_links()), '0');
select pg_temp.works('turning off one that is already off is fine',
  format($$select public.admin_set_calendar_phone_link(%L, 'off')$$, pg_temp.cal('Club')));

-- Turned on again it is a new key, and deleting the calendar removes it.
insert into keys select 'third', public.admin_set_calendar_phone_link(pg_temp.cal('Club'), 'on');
select pg_temp.ok('turned on again, the key is new',
  (select token from keys where name = 'third') not in (select token from keys where name in ('first', 'second')), true);
delete from public.calendars where id = pg_temp.cal('Club');
select pg_temp.ok('deleting the calendar ends its link',
  pg_temp.feed((select token from keys where name = 'third')) is null, true);
reset role;
select pg_temp.eq('and leaves no row behind', (select count(*)::text from public.calendar_phone_links), '0');
