-- Tests for 20261121400000_calendar_audiences.sql: an admin chooses who sees
-- each calendar (everyone, roles, safeguarding posts, squads and teams), and
-- members see only the calendars shown to them. Signed in as the API role
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
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- The calendars member n sees, by name, comma separated.
create or replace function pg_temp.sees(n text) returns text language sql as
$$ select pg_temp.as_member(n);
   select coalesce(string_agg(name, ',' order by name), '') from public.calendars $$;
create or replace function pg_temp.cal(n text) returns uuid language sql as
$$ select id from public.calendars where name = n $$;
create or replace function pg_temp.audience(n text) returns text language sql as
$$ select coalesce(string_agg(a.kind || ':' || coalesce(a.role::text, a.post, t.name, ''), ',' order by a.kind, coalesce(a.role::text, a.post, t.name, '')), '')
   from public.calendar_audiences a left join public.teams t on t.id = a.team_id
   where a.calendar_id = pg_temp.cal(n) $$;

-- Extra sample people: a guest, a statistician with a current check, and a
-- Child Safety Officer (Finley Physio, 14) and a Complaints Manager (Emery
-- Manager, 13).
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000071', 'guest.calendar@example.test', now()),
  ('00000000-0000-0000-0000-000000000072', 'stats.calendar@example.test', now()),
  ('00000000-0000-0000-0000-000000000073', 'volunteer.calendar@example.test', now());
update public.profiles set status = 'approved', full_name = 'Quinn Guest', role = 'guest',
  date_of_birth = current_date - interval '40 years'
where id = pg_temp.id('71');
update public.profiles set status = 'approved', full_name = 'Rowan Stats', role = 'statistician',
  wwcc_number = 'WWC0072', wwcc_expires_on = current_date + 400, date_of_birth = current_date - interval '30 years'
where id = pg_temp.id('72');
update public.profiles set status = 'approved', full_name = 'Sky Helper', role = 'volunteer',
  date_of_birth = current_date - interval '30 years'
where id = pg_temp.id('73');
insert into public.safeguarding_post_holders (post, profile_id) values
  ('child_safety_officer', pg_temp.id('14')),
  ('complaints_manager', pg_temp.id('13'));

-- ---------------------------------------------------------------------------
-- Saving a calendar: admins only, and it must be shown to someone
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t add a calendar',
  $s$ select public.admin_save_calendar(null, 'Coach cal', 'https://example.test/c.ics', null, true, null, null, null) $s$);
select pg_temp.fails('a member can''t add an audience directly',
  $s$ insert into public.calendar_audiences (calendar_id, kind) select id, 'everyone' from public.calendars limit 1 $s$);
select pg_temp.as_member('13');
select pg_temp.fails('a Complaints Manager can''t add a calendar either',
  $s$ select public.admin_save_calendar(null, 'CM cal', 'https://example.test/c.ics', null, true, null, null, null) $s$);

select pg_temp.as_member('01');
select pg_temp.fails('a calendar must be shown to someone',
  $s$ select public.admin_save_calendar(null, 'Nobody', 'https://example.test/n.ics', null, false, '{}', '{}', '{}') $s$);
select pg_temp.fails('it needs a name',
  $s$ select public.admin_save_calendar(null, '  ', 'https://example.test/n.ics', null, true, null, null, null) $s$);
select pg_temp.fails('admins see every calendar anyway, so it can''t be shown to the admin role',
  $s$ select public.admin_save_calendar(null, 'Admins', 'https://example.test/a.ics', null, false, array['admin'], null, null) $s$);
select pg_temp.fails('temporary helpers aren''t offered calendars',
  $s$ select public.admin_save_calendar(null, 'Helpers', 'https://example.test/h.ics', null, false, array['volunteer'], null, null) $s$);
select pg_temp.fails('nor is Studio',
  $s$ select public.admin_save_calendar(null, 'Studio', 'https://example.test/s.ics', null, false, array['studio'], null, null) $s$);
select pg_temp.fails('only the three safeguarding posts',
  $s$ select public.admin_save_calendar(null, 'Posts', 'https://example.test/p.ics', null, false, null, null, array['head_physio']) $s$);
select pg_temp.fails('the squad or team must exist',
  $s$ select public.admin_save_calendar(null, 'Gone', 'https://example.test/g.ics', null, false, null, array[gen_random_uuid()], null) $s$);
select pg_temp.fails('the link must still be https or webcal',
  $s$ select public.admin_save_calendar(null, 'Plain', 'http://example.test/p.ics', null, true, null, null, null) $s$);
select pg_temp.ok('nothing was saved by the refusals', (select count(*) = 0 from public.calendars), true);

select pg_temp.works('club calendar for everyone',
  $s$ select public.admin_save_calendar(null, 'Club', 'https://example.test/club.ics', null, true, null, null, null) $s$);
select pg_temp.works('physios and statisticians',
  $s$ select public.admin_save_calendar(null, 'Medical and stats', 'https://example.test/ms.ics', 'orange', false, array['physio', 'statistician', 'physio'], null, null) $s$);
select pg_temp.works('guests',
  $s$ select public.admin_save_calendar(null, 'Guests', 'https://example.test/g.ics', null, false, array['guest'], null, null) $s$);
select pg_temp.works('safeguarding posts',
  $s$ select public.admin_save_calendar(null, 'Safeguarding', 'https://example.test/sg.ics', null, false, null, null, array['child_safety_officer', 'complaints_manager']) $s$);
select pg_temp.works('one team',
  $s$ select public.admin_save_calendar(null, 'Team games', 'https://example.test/t.ics', null, false, null, array[pg_temp.id('a2')], null) $s$);
select pg_temp.works('committee',
  $s$ select public.admin_save_calendar(null, 'Committee', 'https://example.test/cm.ics', null, false, array['committee'], null, null) $s$);
select pg_temp.works('a mix: managers, the squad and Child Safety Officers',
  $s$ select public.admin_save_calendar(null, 'Mixed', 'https://example.test/mx.ics', null, false, array['manager'], array[pg_temp.id('a1')], array['child_safety_officer']) $s$);
select pg_temp.works('everyone stands alone, whatever else is ticked',
  $s$ select public.admin_save_calendar(null, 'Everyone plus', 'https://example.test/ep.ics', null, true, array['guest'], array[pg_temp.id('a2')], array['wwc_officer']) $s$);
reset role;

select pg_temp.ok('a repeated role is kept once', pg_temp.audience('Medical and stats') = 'role:physio,role:statistician', true);
select pg_temp.ok('the colour is kept', (select color = 'orange' from public.calendars where name = 'Medical and stats'), true);
select pg_temp.ok('the mix keeps all three kinds', pg_temp.audience('Mixed') = 'post:child_safety_officer,role:manager,team:Sample Squad', true);
select pg_temp.ok('everyone is stored alone', pg_temp.audience('Everyone plus') = 'everyone:', true);
select pg_temp.ok('saved calendars use audiences, not the old columns',
  (select bool_and(team_id is null and not committee_only) from public.calendars), true);

-- A calendar added the old way, by an app not yet updated.
insert into public.calendars (name, url, team_id) values ('Old squad', 'https://example.test/os.ics', pg_temp.id('a1'));
insert into public.calendars (name, url, committee_only) values ('Old committee', 'https://example.test/oc.ics', true);
insert into public.calendars (name, url) values ('Old club', 'https://example.test/ocl.ics');
select pg_temp.ok('an old squad calendar is shown to its squad', pg_temp.audience('Old squad') = 'team:Sample Squad', true);
select pg_temp.ok('an old committee calendar is shown to the committee', pg_temp.audience('Old committee') = 'role:committee', true);
select pg_temp.ok('an old club calendar is shown to nobody until an admin picks', pg_temp.audience('Old club') = '', true);

-- ---------------------------------------------------------------------------
-- Who sees what
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.ok('an admin sees every calendar',
  pg_temp.sees('01') = 'Club,Committee,Everyone plus,Guests,Medical and stats,Mixed,Old club,Old committee,Old squad,Safeguarding,Team games', true);
select pg_temp.ok('a coach in the squad and team sees the club, squad and team calendars',
  pg_temp.sees('11') = 'Club,Everyone plus,Mixed,Old squad,Team games', true);
select pg_temp.ok('a coach whose check lapsed sees only the club calendars (squad calendars need a check)',
  pg_temp.sees('12') = 'Club,Everyone plus', true);
select pg_temp.ok('a manager who is Complaints Manager sees the safeguarding and managers'' calendars',
  pg_temp.sees('13') = 'Club,Everyone plus,Mixed,Old squad,Safeguarding', true);
select pg_temp.ok('a physio who is Child Safety Officer sees the physio and safeguarding calendars',
  pg_temp.sees('14') = 'Club,Everyone plus,Medical and stats,Mixed,Old squad,Safeguarding', true);
select pg_temp.ok('a committee member sees the committee calendars',
  pg_temp.sees('22') = 'Club,Committee,Everyone plus,Old committee', true);
select pg_temp.ok('a committee member exempted from checks still does',
  pg_temp.sees('23') = 'Club,Committee,Everyone plus,Old committee', true);
select pg_temp.ok('an athlete under 18 sees the club, squad and team calendars only',
  pg_temp.sees('31') = 'Club,Everyone plus,Mixed,Old squad,Team games', true);
select pg_temp.ok('an adult athlete in the squad only',
  pg_temp.sees('32') = 'Club,Everyone plus,Mixed,Old squad', true);
select pg_temp.ok('a parent sees what their child''s groups see, as they are placed with them',
  pg_temp.sees('41') = 'Club,Everyone plus,Mixed,Old squad,Team games', true);
select pg_temp.ok('a guest sees the club and guests'' calendars',
  pg_temp.sees('71') = 'Club,Everyone plus,Guests', true);
select pg_temp.ok('a statistician sees the club and statisticians'' calendars',
  pg_temp.sees('72') = 'Club,Everyone plus,Medical and stats', true);
select pg_temp.ok('a temporary helper sees none, as before',
  pg_temp.sees('73') = '', true);
select pg_temp.ok('members read the audience only of calendars they see',
  (select pg_temp.as_member('71')) is null
  and (select count(distinct calendar_id) = 3 from public.calendar_audiences), true);
select pg_temp.fails('a member can''t change an audience',
  $s$ delete from public.calendar_audiences $s$);
reset role;
select pg_temp.ok('nothing was removed', (select count(*) > 0 from public.calendar_audiences where kind = 'everyone'), true);

-- A Child Safety Officer who is stood down can't act, so loses the calendar.
update public.profiles set stood_down_at = now() where id = pg_temp.id('14');
set role authenticated;
select pg_temp.ok('a stood-down Child Safety Officer loses the safeguarding and physio calendars',
  position('Safeguarding' in pg_temp.sees('14')) = 0 and position('Medical' in pg_temp.sees('14')) = 0, true);
reset role;
update public.profiles set stood_down_at = null where id = pg_temp.id('14');

-- ---------------------------------------------------------------------------
-- Changing who sees a calendar
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.works('the old squad calendar is changed to the squad and guests',
  $s$ select public.admin_save_calendar(pg_temp.cal('Old squad'), 'Squad and guests', 'https://example.test/os.ics', 'violet', false, array['guest'], array[pg_temp.id('a1')], null) $s$);
select pg_temp.fails('a calendar that no longer exists',
  $s$ select public.admin_save_calendar(gen_random_uuid(), 'Gone', 'https://example.test/g.ics', null, true, null, null, null) $s$);
reset role;
select pg_temp.ok('the audience was replaced', pg_temp.audience('Squad and guests') = 'role:guest,team:Sample Squad', true);
select pg_temp.ok('the calendar moved onto audiences',
  (select team_id is null and not committee_only and color = 'violet' from public.calendars where name = 'Squad and guests'), true);
set role authenticated;
select pg_temp.ok('the guest now sees it', position('Squad and guests' in pg_temp.sees('71')) > 0, true);
select pg_temp.ok('the squad still does', position('Squad and guests' in pg_temp.sees('32')) > 0, true);
select pg_temp.as_member('01');
select pg_temp.works('an admin deletes a calendar',
  $s$ delete from public.calendars where name = 'Old club' $s$);
reset role;
select pg_temp.ok('its audience goes with it', (select count(*) = 0 from public.calendar_audiences a where not exists (select 1 from public.calendars c where c.id = a.calendar_id)), true);

-- ---------------------------------------------------------------------------
-- A new season
-- ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_member('01');
select pg_temp.works('starting the next season',
  format($s$ select public.admin_start_season(%s) $s$, (select max(season) + 1 from public.teams)));
reset role;
select pg_temp.ok('a calendar shown to the squad is shown to next season''s squad too',
  (select count(*) = 2 from public.calendar_audiences a join public.teams t on t.id = a.team_id
   where a.calendar_id = pg_temp.cal('Mixed') and t.name = 'Sample Squad'), true);
select pg_temp.ok('and keeps its other audiences',
  (select count(*) = 4 from public.calendar_audiences where calendar_id = pg_temp.cal('Mixed')), true);
