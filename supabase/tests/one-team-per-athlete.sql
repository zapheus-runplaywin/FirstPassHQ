-- Tests for 20261120100000_one_team_per_athlete.sql: an athlete is in one
-- current team and one current squad a season, whatever saves them; naming a
-- team moves its athletes from the season's other teams (with their
-- captaincy there); athletes_in_other_teams is for admins; coaches,
-- managers and physios may be in several teams; captains are chosen for
-- teams, not squads. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
grant select on public.team_captains to authenticated;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
-- Like fails, but the error must say this.
create or replace function pg_temp.refused(label text, statement text, expected text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like expected then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- The current teams an athlete is in, by name.
create or replace function pg_temp.teams_of(n text) returns text language sql as
$$ select coalesce(string_agg(t.name, ', ' order by t.name), '')
   from public.team_members m join public.teams t on t.id = m.team_id
   where m.profile_id = pg_temp.m(n) and m.team_role = 'athlete' and t.kind = 'team' and not t.archived $$;

-- Sample Squad (a1) has Sample Team (a2) with Jordan (31). Add Open A (a3)
-- and Open B (a4) to the squad, and a second squad (b1) this season.
-- Kai (32) is in the squad only.
insert into public.teams (id, name, kind, squad_id, season, sort_order) values
  (pg_temp.m('a3'), 'Open A', 'team', pg_temp.m('a1'), (select season from public.teams where id = pg_temp.m('a1')), 3),
  (pg_temp.m('a4'), 'Open B', 'team', pg_temp.m('a1'), (select season from public.teams where id = pg_temp.m('a1')), 4);
insert into public.teams (id, name, kind, season, sort_order) values
  (pg_temp.m('b1'), 'Other Squad', 'squad', (select season from public.teams where id = pg_temp.m('a1')), 5);

-- ---------------------------------------------------------------------------
-- The rule, whatever saves
-- ---------------------------------------------------------------------------
select pg_temp.refused('a direct save cannot put Jordan in a second team',
  $s$ insert into public.team_members (team_id, profile_id, team_role, selection) values (pg_temp.m('a3'), pg_temp.m('31'), 'athlete', 'touring') $s$,
  'Jordan Junior is already in Sample Team. An athlete can be in only one team at a time.');
select pg_temp.refused('nor as a training partner',
  $s$ insert into public.team_members (team_id, profile_id, team_role, selection) values (pg_temp.m('a3'), pg_temp.m('31'), 'athlete', 'training_partner') $s$,
  '%only one team%');
select pg_temp.refused('a direct save cannot put Kai in a second squad',
  $s$ insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.m('b1'), pg_temp.m('32'), 'athlete') $s$,
  'Kai Senior is already in Sample Squad. An athlete can be in only one squad at a time.');
select pg_temp.ok('Jordan is still in Sample Team only', pg_temp.teams_of('31') = 'Sample Team', true);

select pg_temp.as_member('01');
select pg_temp.refused('the member page cannot put Jordan in two teams',
  $s$ select public.admin_save_member(pg_temp.m('31'), 'athlete', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a2","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a3","team_role":"athlete"}]', true,
       array[pg_temp.m('41'), pg_temp.m('42')]) $s$,
  '%only one team%');
select pg_temp.ok('a refused save changes nothing', pg_temp.teams_of('31') = 'Sample Team', true);
select pg_temp.refused('the member page cannot put Kai in two squads',
  $s$ select public.admin_save_member(pg_temp.m('32'), 'athlete', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000b1","team_role":"athlete"}]') $s$,
  '%only one squad%');
select pg_temp.works('the member page moves Jordan to Open A',
  $s$ select public.admin_save_member(pg_temp.m('31'), 'athlete', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a3","team_role":"athlete"}]', true,
       array[pg_temp.m('41'), pg_temp.m('42')]) $s$);
select pg_temp.ok('Jordan is in Open A only', pg_temp.teams_of('31') = 'Open A', true);

-- Coaches, managers and physios may be in several teams.
select pg_temp.works('Casey coaches Sample Team and Open A',
  $s$ insert into public.team_members (team_id, profile_id, team_role, coach_title) values (pg_temp.m('a3'), pg_temp.m('11'), 'coach', 'assistant_coach') $s$);
select pg_temp.works('Emery manages two teams',
  $s$ insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.m('a3'), pg_temp.m('13'), 'manager'), (pg_temp.m('a4'), pg_temp.m('13'), 'manager') $s$);
select pg_temp.works('a coach can be in two squads',
  $s$ insert into public.team_members (team_id, profile_id, team_role, coach_title) values (pg_temp.m('b1'), pg_temp.m('11'), 'coach', 'head_coach') $s$);

-- Other seasons and removed groups don't count.
insert into public.teams (id, name, kind, season, sort_order) values
  (pg_temp.m('c1'), 'Next Season Team', 'team', (select season + 1 from public.teams where id = pg_temp.m('a1')), 9),
  (pg_temp.m('c2'), 'Removed Team', 'team', (select season from public.teams where id = pg_temp.m('a1')), 10);
update public.teams set archived = true where id = pg_temp.m('c2');
select pg_temp.works('Jordan can be in next season''s team as well',
  $s$ insert into public.team_members (team_id, profile_id, team_role, selection) values (pg_temp.m('c1'), pg_temp.m('31'), 'athlete', 'touring') $s$);
select pg_temp.works('a removed team can keep Jordan''s old place',
  $s$ insert into public.team_members (team_id, profile_id, team_role, selection) values (pg_temp.m('c2'), pg_temp.m('31'), 'athlete', 'touring') $s$);
select pg_temp.refused('bringing back the removed team is refused while Jordan is in Open A',
  $s$ update public.teams set archived = false where id = pg_temp.m('c2') $s$,
  'Jordan Junior is in Open A now.%');
select pg_temp.ok('the team stays removed', (select archived from public.teams where id = pg_temp.m('c2')), true);
delete from public.team_members where team_id = pg_temp.m('c2');
select pg_temp.works('once Jordan is out of it, it comes back',
  $s$ update public.teams set archived = false where id = pg_temp.m('c2') $s$);
select pg_temp.refused('moving next season''s team into this season is refused too',
  $s$ update public.teams set season = season - 1 where id = pg_temp.m('c1') $s$,
  '%only one team%');
delete from public.teams where id in (pg_temp.m('c1'), pg_temp.m('c2'));

-- ---------------------------------------------------------------------------
-- Naming a team moves its athletes
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.ok('a coach does not see who is in other teams', (select count(*) = 0 from public.athletes_in_other_teams(pg_temp.m('a4'))), true);
select pg_temp.fails('a coach cannot name a team', $s$ select public.admin_set_team_members(pg_temp.m('a4'), '[]') $s$);
select pg_temp.works('Casey makes Jordan captain of Open A',
  $s$ select public.set_group_captains(pg_temp.m('a3'), array[pg_temp.m('31')], '{}') $s$);

select pg_temp.as_member('01');
select pg_temp.ok('the admin sees Jordan is in Open A from Open B''s screen',
  (select array_agg(profile_id::text || ':' || team_name) = array[pg_temp.m('31') || ':Open A'] from public.athletes_in_other_teams(pg_temp.m('a4'))), true);
select pg_temp.ok('and not from Open A''s own screen',
  (select count(*) = 0 from public.athletes_in_other_teams(pg_temp.m('a3'))), true);
select pg_temp.ok('a squad is not a team', (select count(*) = 0 from public.athletes_in_other_teams(pg_temp.m('a1'))), true);
select pg_temp.works('the admin names Open B with Jordan and Kai and the coach',
  $s$ select public.admin_set_team_members(pg_temp.m('a4'), jsonb_build_array(
       jsonb_build_object('profile_id', pg_temp.m('31'), 'selection', 'touring'),
       jsonb_build_object('profile_id', pg_temp.m('32'), 'selection', 'training_partner'),
       jsonb_build_object('profile_id', pg_temp.m('11'), 'coach_title', 'head_coach'))) $s$);
select pg_temp.ok('Jordan moved from Open A to Open B', pg_temp.teams_of('31') = 'Open B', true);
select pg_temp.ok('Kai is in Open B', pg_temp.teams_of('32') = 'Open B', true);
select pg_temp.ok('Jordan''s Open A captaincy went with the move',
  not exists (select 1 from public.team_captains where team_id = pg_temp.m('a3')), true);
select pg_temp.ok('Jordan''s guardians followed them to Open B',
  (select count(*) = 2 from public.team_members where team_id = pg_temp.m('a4') and team_role = 'guardian'), true);
select pg_temp.ok('and left Open A',
  not exists (select 1 from public.team_members where team_id = pg_temp.m('a3') and team_role = 'guardian'), true);
select pg_temp.ok('Casey still coaches Sample Team, Open A and Open B',
  (select count(*) = 3 from public.team_members m join public.teams t on t.id = m.team_id
   where m.profile_id = pg_temp.m('11') and m.team_role = 'coach' and t.kind = 'team'), true);
select pg_temp.ok('Emery still manages Open A', exists (select 1 from public.team_members where team_id = pg_temp.m('a3') and profile_id = pg_temp.m('13')), true);
select pg_temp.ok('everyone stays in the squad',
  (select count(*) = 2 from public.team_members where team_id = pg_temp.m('a1') and team_role = 'athlete'), true);
select pg_temp.works('naming Open A with nobody leaves Open B alone',
  $s$ select public.admin_set_team_members(pg_temp.m('a3'), '[]') $s$);
select pg_temp.ok('Jordan and Kai are still in Open B', pg_temp.teams_of('31') = 'Open B' and pg_temp.teams_of('32') = 'Open B', true);
select pg_temp.ok('there is one current team place per athlete in the squad',
  (select count(*) = 0 from (
     select m.profile_id from public.team_members m join public.teams t on t.id = m.team_id
     where m.team_role = 'athlete' and t.kind = 'team' and not t.archived
     group by m.profile_id, t.season having count(*) > 1) d), true);

-- A team without a squad moves its athletes the same way.
insert into public.teams (id, name, kind, season, sort_order) values
  (pg_temp.m('d1'), 'Free Team', 'team', (select season from public.teams where id = pg_temp.m('a1')), 11);
select pg_temp.works('the admin picks Kai for a team without a squad',
  $s$ select public.admin_set_team_members(pg_temp.m('d1'), jsonb_build_array(jsonb_build_object('profile_id', pg_temp.m('32')))) $s$);
select pg_temp.ok('Kai moved from Open B to Free Team', pg_temp.teams_of('32') = 'Free Team', true);
select pg_temp.ok('Jordan stayed in Open B', pg_temp.teams_of('31') = 'Open B', true);

-- ---------------------------------------------------------------------------
-- Captains are chosen for teams
-- ---------------------------------------------------------------------------
select pg_temp.refused('the admin cannot choose squad captains',
  $s$ select public.set_group_captains(pg_temp.m('a1'), array[pg_temp.m('31')], '{}') $s$,
  'Captains are chosen for a team, not a squad.%');
select pg_temp.refused('nor save one directly',
  $s$ insert into public.team_captains (team_id, profile_id, captain_role) values (pg_temp.m('a1'), pg_temp.m('31'), 'captain') $s$,
  'Captains are chosen for a team, not a squad.%');
select pg_temp.works('the admin chooses Open B''s captain', $s$ select public.set_group_captains(pg_temp.m('a4'), array[pg_temp.m('31')], '{}') $s$);
select pg_temp.as_member('31');
select pg_temp.ok('Jordan captains Open B', public.is_group_captain(pg_temp.m('a4')), true);
select pg_temp.ok('and not the squad', public.is_group_captain(pg_temp.m('a1')), false);

-- Nothing the migration ran changed the sample members' places.
reset role;
select pg_temp.ok('no squad captains anywhere', not exists (
  select 1 from public.team_captains c join public.teams t on t.id = c.team_id where t.kind = 'squad'), true);
