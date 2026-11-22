-- Tests for 20261116000000_team_pilot_features.sql: a feature can be on for
-- pilot teams only. Who is in the pilot (admins, committee, members of a
-- pilot squad or team, a pilot squad's teams, and the parents of athletes in
-- them), what every kind of member sees both ways, the database switch checks
-- and to-do pushes that follow it, and that only admins set the pilot. Run on
-- a fresh database with the migrations and seed-members.sql loaded. Prints
-- one line per check.
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
-- Whether member n is in the pilot, and whether their app shows a feature.
create or replace function pg_temp.in_pilot(n text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     r := public.in_pilot();
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
create or replace function pg_temp.shows(n text, feature text) returns boolean language plpgsql as
$$ declare r boolean; begin
     perform pg_temp.as_member(n);
     select (p.features ->> feature)::boolean is distinct from false into r from public.club_profile() p;
     perform set_config('request.jwt.claim.sub', '', false);
     return r;
   end $$;
create or replace function pg_temp.has_todo(n text, key_prefix text) returns boolean language sql as
$$ select exists (select 1 from public.member_todos(pg_temp.id(n)) m where m.todo_key like key_prefix || '%') $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- Extra people: 51 Quinn is a guest, 52 Reese an athlete in Other Team (not in
-- the seed's squad), 53 Sam a parent of Reese, 54 Toby a pending athlete
-- placed in Sample Team.
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000b2', 'Other Team', 'team', '00000000-0000-0000-0000-0000000000b1', 4);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'other.athlete@example.test', now()),
  ('00000000-0000-0000-0000-000000000053', 'other.parent@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  date_of_birth = v.dob, verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000051', 'Quinn Guest', 'guest', public.club_today() - interval '40 years'),
  ('00000000-0000-0000-0000-000000000052', 'Reese Other', 'athlete', public.club_today() - interval '19 years'),
  ('00000000-0000-0000-0000-000000000053', 'Sam Parent', 'guardian', public.club_today() - interval '45 years')
) as v(id, name, role, dob)
where p.id = v.id::uuid;
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000052', 'athlete');
insert into public.guardianships (guardian_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000052');

-- ---------------------------------------------------------------------------
-- 1. Nothing changes until an admin sets up a pilot
-- ---------------------------------------------------------------------------
select pg_temp.ok('new columns start empty', (select pilot_features = '{}'::jsonb from public.club_settings where id), true);
select pg_temp.ok('no team starts in the pilot', (select count(*) = 0 from public.teams where pilot), true);
select pg_temp.ok('with no pilot features, an athlete outside any pilot sees Injuries', pg_temp.shows('32', 'injuries'), true);
select pg_temp.ok('and a guest sees Messages', pg_temp.shows('51', 'messages'), true);
update public.club_settings set features = features || '{"awards": false}' where id;
select pg_temp.ok('a feature an admin turned off stays off for admins', pg_temp.shows('01', 'awards'), false);
select pg_temp.ok('and for everyone else', pg_temp.shows('32', 'awards'), false);
update public.club_settings set features = features - 'awards' where id;

-- ---------------------------------------------------------------------------
-- 2. Only admins see and set the pilot
-- ---------------------------------------------------------------------------
select pg_temp.ok('anon can''t run in_pilot', has_function_privilege('anon', 'public.in_pilot()', 'execute'), false);
select pg_temp.ok('anon can''t read member_features', has_function_privilege('anon', 'public.member_features()', 'execute'), false);
select pg_temp.ok('anon can''t set the pilot', has_function_privilege('anon', 'public.admin_set_pilot(text[], uuid[])', 'execute'), false);
select pg_temp.ok('anon can''t read the pilot', has_function_privilege('anon', 'public.admin_pilot_settings()', 'execute'), false);

select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t set the pilot', $$select public.admin_set_pilot('{injuries}', '{00000000-0000-0000-0000-0000000000a2}')$$);
select pg_temp.fails('a coach can''t read the pilot', $$select * from public.admin_pilot_settings()$$);
select pg_temp.as_member('21');
select pg_temp.fails('committee can''t set the pilot', $$select public.admin_set_pilot('{injuries}', '{}')$$);
select pg_temp.fails('committee can''t read the pilot', $$select * from public.admin_pilot_settings()$$);
select pg_temp.as_member('31');
select pg_temp.fails('an athlete can''t set the pilot', $$select public.admin_set_pilot('{injuries}', '{}')$$);
select pg_temp.as_member('41');
select pg_temp.fails('a parent can''t set the pilot', $$select public.admin_set_pilot('{injuries}', '{}')$$);
select pg_temp.as_member('51');
select pg_temp.fails('a guest can''t set the pilot', $$select public.admin_set_pilot('{injuries}', '{}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('nothing was saved by anyone refused', (
  select pilot_features = '{}'::jsonb from public.club_settings where id), true);

select pg_temp.as_member('01');
select pg_temp.fails('squads can''t be piloted', $$select public.admin_set_pilot('{squads}', '{}')$$);
select pg_temp.fails('a blank feature is refused', $$select public.admin_set_pilot(array[null]::text[], '{}')$$);
select pg_temp.fails('an odd feature name is refused', $$select public.admin_set_pilot('{"in juries"}', '{}')$$);
select pg_temp.fails('a team that doesn''t exist is refused', $$select public.admin_set_pilot('{injuries}', '{00000000-0000-0000-0000-0000000000ff}')$$);
select pg_temp.ok('a refused save changes nothing', (
  select pilot_features = '{}'::jsonb from public.club_settings where id), true);

-- Pilot: Sample Team only (Casey 11 coaches it, Jordan 31 plays in it).
select pg_temp.works('an admin pilots Injuries and Surveys with Sample Team',
  $$select public.admin_set_pilot('{injuries,surveys}', '{00000000-0000-0000-0000-0000000000a2}')$$);
select pg_temp.ok('the admin reads the pilot back', (
  select pilot_features = '{injuries,surveys}'::text[] and pilot_team_ids = '{00000000-0000-0000-0000-0000000000a2}'::uuid[]
  from public.admin_pilot_settings()), true);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('stored as pilot-only switches', (
  select pilot_features = '{"injuries": true, "surveys": true}'::jsonb from public.club_settings where id), true);
select pg_temp.ok('the club''s on and off switches are untouched', (
  select features = '{}'::jsonb from public.club_settings where id), true);

-- ---------------------------------------------------------------------------
-- 3. Who is in a team pilot: every kind of member, both ways
-- ---------------------------------------------------------------------------
select pg_temp.ok('admin is in the pilot', pg_temp.in_pilot('01'), true);
select pg_temp.ok('a second admin is too', pg_temp.in_pilot('02'), true);
select pg_temp.ok('committee whose role is paused by an expired check is out', pg_temp.in_pilot('21'), false);
select pg_temp.ok('committee (no check) is in the pilot', pg_temp.in_pilot('22'), true);
select pg_temp.ok('committee (exempt) is in the pilot', pg_temp.in_pilot('23'), true);
select pg_temp.ok('the pilot team''s coach is in', pg_temp.in_pilot('11'), true);
select pg_temp.ok('the pilot team''s under-18 athlete is in', pg_temp.in_pilot('31'), true);
select pg_temp.ok('her parent is in', pg_temp.in_pilot('41'), true);
select pg_temp.ok('her coach-parent is in, as a parent', pg_temp.in_pilot('42'), true);
select pg_temp.ok('a squad-only coach is out', pg_temp.in_pilot('12'), false);
select pg_temp.ok('a squad-only manager is out', pg_temp.in_pilot('13'), false);
select pg_temp.ok('a squad-only physio is out', pg_temp.in_pilot('14'), false);
select pg_temp.ok('a squad-only adult athlete is out', pg_temp.in_pilot('32'), false);
select pg_temp.ok('an athlete in another team is out', pg_temp.in_pilot('52'), false);
select pg_temp.ok('that athlete''s parent is out', pg_temp.in_pilot('53'), false);
select pg_temp.ok('a guest is out', pg_temp.in_pilot('51'), false);
select pg_temp.ok('nobody signed in is out', public.in_pilot(), false);

select pg_temp.ok('Injuries shows in the pilot coach''s app', pg_temp.shows('11', 'injuries'), true);
select pg_temp.ok('and the pilot athlete''s', pg_temp.shows('31', 'injuries'), true);
select pg_temp.ok('and her parent''s', pg_temp.shows('41', 'injuries'), true);
select pg_temp.ok('and the admin''s', pg_temp.shows('01', 'injuries'), true);
select pg_temp.ok('and committee''s', pg_temp.shows('22', 'injuries'), true);
select pg_temp.ok('Injuries is off for the squad-only physio', pg_temp.shows('14', 'injuries'), false);
select pg_temp.ok('and for the squad-only athlete', pg_temp.shows('32', 'injuries'), false);
select pg_temp.ok('and for the other team''s parent', pg_temp.shows('53', 'injuries'), false);
select pg_temp.ok('and for a guest', pg_temp.shows('51', 'injuries'), false);
select pg_temp.ok('a feature on for everyone still shows outside the pilot', pg_temp.shows('32', 'messages'), true);
select pg_temp.ok('the club profile still names the club for everyone', (
  select count(*) = 1 from public.club_profile()), true);

-- ---------------------------------------------------------------------------
-- 4. A squad in the pilot brings its teams
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('the admin pilots Sample Squad instead',
  $$select public.admin_set_pilot('{injuries,surveys}', '{00000000-0000-0000-0000-0000000000a1}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('Sample Team leaves the pilot as its own entry', (
  select not pilot from public.teams where id = '00000000-0000-0000-0000-0000000000a2'), true);
select pg_temp.ok('the squad-only coach is now in', pg_temp.in_pilot('12'), true);
select pg_temp.ok('the squad-only manager is now in', pg_temp.in_pilot('13'), true);
select pg_temp.ok('the squad-only physio is now in', pg_temp.in_pilot('14'), true);
select pg_temp.ok('the squad-only adult athlete is now in', pg_temp.in_pilot('32'), true);
select pg_temp.ok('Sample Team''s coach is still in, through the squad', pg_temp.in_pilot('11'), true);
select pg_temp.ok('the other team''s athlete is still out', pg_temp.in_pilot('52'), false);
select pg_temp.ok('and so is their parent', pg_temp.in_pilot('53'), false);
select pg_temp.ok('a guest is still out', pg_temp.in_pilot('51'), false);

-- ---------------------------------------------------------------------------
-- 5. Database switch checks follow the member's view
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('surveys_on for a pilot coach', public.surveys_on(), true);
select pg_temp.as_member('52');
select pg_temp.ok('surveys_on is false outside the pilot', public.surveys_on(), false);
select pg_temp.ok('session plans (on for everyone) still on outside it', public.session_plans_on(), true);
select set_config('request.jwt.claim.sub', '', false);

update public.club_settings set features = features || '{"sessionPlans": false}' where id;
select pg_temp.as_member('11');
select pg_temp.ok('a feature turned off is off in the pilot too', public.session_plans_on(), false);
select set_config('request.jwt.claim.sub', '', false);
update public.club_settings set features = features - 'sessionPlans' where id;

update public.club_settings set features = features || '{"trainingLoad": true}',
  pilot_features = pilot_features || '{"trainingLoad": true, "captainPolls": true, "sessionPlans": true}' where id;
select pg_temp.as_member('12');
select pg_temp.ok('load flags on for a pilot coach', public.load_monitoring_on(), true);
select pg_temp.ok('captains'' polls on in the pilot', public.captain_polls_on(), true);
select pg_temp.ok('session plans on in the pilot', public.session_plans_on(), true);
select pg_temp.as_member('52');
select pg_temp.ok('load flags off outside it', public.load_monitoring_on(), false);
select pg_temp.ok('captains'' polls off outside it', public.captain_polls_on(), false);
select pg_temp.ok('session plans off outside it', public.session_plans_on(), false);
select set_config('request.jwt.claim.sub', '', false);
update public.club_settings set features = features - 'trainingLoad',
  pilot_features = pilot_features - 'trainingLoad' - 'captainPolls' - 'sessionPlans' where id;

-- ---------------------------------------------------------------------------
-- 6. To-do pushes skip pilot-only features outside the pilot
-- ---------------------------------------------------------------------------
-- Registers (off by default) asks coaches to declare conflicts of interest.
update public.club_settings set features = features || '{"registers": true}' where id;
select pg_temp.ok('with Registers on for everyone, the other team''s coach-less athlete gets nothing', pg_temp.has_todo('52', 'conflicts:'), false);
select pg_temp.ok('with Registers on for everyone, a coach is asked to declare', pg_temp.has_todo('12', 'conflicts:'), true);
-- Back to Sample Team only, with Registers pilot-only.
select pg_temp.as_member('01');
select pg_temp.works('the admin pilots Registers with Sample Team',
  $$select public.admin_set_pilot('{registers}', '{00000000-0000-0000-0000-0000000000a2}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('the pilot coach is asked to declare', pg_temp.has_todo('11', 'conflicts:'), true);
select pg_temp.ok('committee is asked to declare', pg_temp.has_todo('22', 'conflicts:'), true);
select pg_temp.ok('the squad-only coach outside the pilot isn''t', pg_temp.has_todo('12', 'conflicts:'), false);
select pg_temp.ok('Injuries and Surveys are back on for everyone', (
  select pilot_features = '{"registers": true}'::jsonb from public.club_settings where id), true);
select pg_temp.ok('so the squad-only athlete sees Injuries again', pg_temp.shows('32', 'injuries'), true);

-- ---------------------------------------------------------------------------
-- 7. Ending the pilot
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('the admin ends the pilot', $$select public.admin_set_pilot('{}', '{}')$$);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('no pilot features left', (select pilot_features = '{}'::jsonb from public.club_settings where id), true);
select pg_temp.ok('no teams left in it', (select count(*) = 0 from public.teams where pilot), true);
select pg_temp.ok('Registers now reaches the squad-only coach', pg_temp.has_todo('12', 'conflicts:'), true);
select pg_temp.ok('the pilot team keeps its members', (
  select count(*) = 2 from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a2'
    and profile_id in (pg_temp.id('11'), pg_temp.id('31'))), true);
