-- Tests for 20261020000000_admin_guide_audit.sql (the admin guide audit's
-- decisions): naming a team from its squad only changes the athletes, coaches
-- managers and physios it is given, leaving the squad alone (guardians are
-- never picked); guardians of an athlete under 18 follow them into and out
-- of a team, and come and go with the guardian link, while squads and adult
-- athletes are untouched; admins read every team's games through
-- admin_team_games and still can't set team goals. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Who is in a team, as "profile:role" in profile order.
create or replace function pg_temp.members_of(n text) returns text[] language sql as
$$ select coalesce(array_agg(profile_id::text || ':' || team_role::text order by profile_id), '{}')
   from public.team_members where team_id = pg_temp.m(n) $$;
create or replace function pg_temp.in_team(n text, who text, as_role text) returns boolean language sql as
$$ select exists (select 1 from public.team_members where team_id = pg_temp.m(n) and profile_id = pg_temp.m(who) and team_role::text = as_role) $$;

-- The migration placed the guardians of the athletes already in teams: Jordan
-- (31) is in Sample Team (a2), so Logan Parent (41) and the coach-parent
-- Morgan (42, a coach of the squad only) are in it as guardians.
select pg_temp.ok('the migration placed the junior''s guardians in the team', pg_temp.in_team('a2', '41', 'guardian') and pg_temp.in_team('a2', '42', 'guardian'), true);
select pg_temp.ok('nobody was placed in the squad', (select count(*) = 0 from public.team_members where team_id = pg_temp.m('a1') and team_role = 'guardian'), true);

-- The coach-parent as a coach of the team.
select pg_temp.as_member('01');
delete from public.team_members where team_id = pg_temp.m('a2') and profile_id = pg_temp.m('42');
insert into public.team_members (team_id, profile_id, team_role, coach_title) values (pg_temp.m('a2'), pg_temp.m('42'), 'coach', 'assistant_coach');

-- Naming the team with the squad's physio (14) moves them out of the squad
-- and keeps the guardian.
select pg_temp.works('admin names the team with the junior, the head coach and the physio', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031", "selection": "training_partner"}, {"profile_id": "00000000-0000-0000-0000-000000000011", "coach_title": "head_coach"}, {"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
select pg_temp.ok('the physio is in the team', pg_temp.in_team('a2', '14', 'physio'), true);
select pg_temp.ok('and out of the squad', not pg_temp.in_team('a1', '14', 'physio'), true);
select pg_temp.ok('the head coach is still in the squad', pg_temp.in_team('a1', '11', 'coach'), true);
select pg_temp.ok('the guardian stays in the team', pg_temp.in_team('a2', '41', 'guardian'), true);
select pg_temp.ok('the unpicked coach-parent leaves as a coach and is placed back as a guardian', pg_temp.in_team('a2', '42', 'guardian'), true);
select pg_temp.ok('the junior''s selection changed in place', (select selection = 'training_partner' from public.team_members where team_id = pg_temp.m('a2') and profile_id = pg_temp.m('31')), true);

-- A coach-parent picked as a coach keeps that role rather than becoming a
-- guardian, and the moved physio can be picked again though no longer in
-- the squad.
select pg_temp.works('admin names the team with the coach-parent coaching', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}, {"profile_id": "00000000-0000-0000-0000-000000000042", "coach_title": "assistant_coach"}, {"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
select pg_temp.ok('the coach-parent is in the team as a coach only', pg_temp.in_team('a2', '42', 'coach') and not pg_temp.in_team('a2', '42', 'guardian'), true);
select pg_temp.ok('the head coach left, the physio and guardian stayed', pg_temp.members_of('a2') = array[pg_temp.m('14') || ':physio', pg_temp.m('31') || ':athlete', pg_temp.m('41') || ':guardian', pg_temp.m('42') || ':coach'], true);

-- The physio can be in a second team of the squad too; leaving one team
-- keeps them out of the squad while they're in the other, and leaving the
-- last puts them back in the squad.
insert into public.teams (id, name, kind, squad_id, season, sort_order) values (pg_temp.m('b5'), 'Sample Team B', 'team', pg_temp.m('a1'), 2026, 6);
select pg_temp.works('admin names a second team with the physio', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b5', '[{"profile_id": "00000000-0000-0000-0000-000000000032"}, {"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
select pg_temp.ok('the physio is in both teams', pg_temp.in_team('a2', '14', 'physio') and pg_temp.in_team('b5', '14', 'physio'), true);
select pg_temp.works('admin names the first team without the physio', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}, {"profile_id": "00000000-0000-0000-0000-000000000042", "coach_title": "assistant_coach"}]') $s$);
select pg_temp.ok('the physio left the first team', not pg_temp.in_team('a2', '14', 'physio'), true);
select pg_temp.ok('and stays out of the squad while in the second', pg_temp.in_team('b5', '14', 'physio') and not pg_temp.in_team('a1', '14', 'physio'), true);
select pg_temp.works('admin names the second team without the physio', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b5', '[{"profile_id": "00000000-0000-0000-0000-000000000032"}]') $s$);
select pg_temp.ok('picked for none of the squad''s teams, the physio is back in the squad', pg_temp.in_team('a1', '14', 'physio') and not pg_temp.in_team('b5', '14', 'physio'), true);
select pg_temp.ok('the squad''s seven placements are as seeded', (select count(*) = 7 from public.team_members where team_id = pg_temp.m('a1')), true);
-- A physio placed in another squad keeps that placement whatever this squad's teams do.
insert into public.teams (id, name, kind, season, sort_order) values (pg_temp.m('b6'), 'Other Squad', 'squad', 2026, 7);
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.m('b6'), pg_temp.m('14'), 'physio');
select pg_temp.works('admin names the team with the physio again', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}, {"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
select pg_temp.ok('the physio stays in the other squad', pg_temp.in_team('b6', '14', 'physio') and not pg_temp.in_team('a1', '14', 'physio') and pg_temp.in_team('a2', '14', 'physio'), true);
select pg_temp.works('and is taken off the team', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}]') $s$);
select pg_temp.ok('back in this squad, still in the other', pg_temp.in_team('a1', '14', 'physio') and pg_temp.in_team('b6', '14', 'physio'), true);
delete from public.team_members where team_id = pg_temp.m('b6');
select pg_temp.ok('the coach-parent left as a coach and came back as a guardian', pg_temp.in_team('a2', '42', 'guardian'), true);
-- A physio in neither the squad nor one of its teams can't be picked.
delete from public.team_members where profile_id = pg_temp.m('14');
select pg_temp.fails('a physio in no group of the squad is refused', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}, {"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.m('a1'), pg_temp.m('14'), 'physio');

-- The guardian leaves with the athlete, and comes back with them.
select pg_temp.works('admin names the team with nobody', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[]') $s$);
select pg_temp.ok('the team is empty of athletes and guardians', pg_temp.members_of('a2') = '{}', true);
select pg_temp.works('admin puts the junior back', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}]') $s$);
select pg_temp.ok('both guardians follow the junior back in', pg_temp.in_team('a2', '41', 'guardian') and pg_temp.in_team('a2', '42', 'guardian'), true);

-- The guardian link: unlinking removes the placement, linking adds it. An
-- unverified or pending guardian isn't placed.
delete from public.guardianships where guardian_id = pg_temp.m('41') and athlete_id = pg_temp.m('31');
select pg_temp.ok('an unlinked guardian leaves the team', not pg_temp.in_team('a2', '41', 'guardian'), true);
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.m('41'), pg_temp.m('31'));
select pg_temp.ok('a linked guardian joins the team', pg_temp.in_team('a2', '41', 'guardian'), true);
update public.profiles set status = 'pending' where id = pg_temp.m('41');
delete from public.team_members where team_id = pg_temp.m('a2') and profile_id = pg_temp.m('31');
insert into public.team_members (team_id, profile_id, team_role, selection) values (pg_temp.m('a2'), pg_temp.m('31'), 'athlete', 'touring');
select pg_temp.ok('a guardian who isn''t approved is not placed', not pg_temp.in_team('a2', '41', 'guardian'), true);
update public.profiles set status = 'approved' where id = pg_temp.m('41');

-- A guardian with two children in the team stays while either is in it.
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000035', 'second.child@example.test', now());
update public.profiles set status = 'approved', role = 'athlete', full_name = 'Jess Junior', date_of_birth = current_date - interval '12 years', under_17 = true, verified_at = now() where id = pg_temp.m('35');
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.m('41'), pg_temp.m('35'));
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.m('a1'), pg_temp.m('35'), 'athlete');
insert into public.team_members (team_id, profile_id, team_role, selection) values (pg_temp.m('a2'), pg_temp.m('35'), 'athlete', 'touring');
select pg_temp.ok('the guardian of both children is in the team once', (select count(*) = 1 from public.team_members where team_id = pg_temp.m('a2') and profile_id = pg_temp.m('41')), true);
select pg_temp.works('admin names the team with the second child only', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000035"}]') $s$);
select pg_temp.ok('the guardian stays while the other child is in the team', pg_temp.in_team('a2', '41', 'guardian'), true);
select pg_temp.ok('the coach-parent, guardian of the first child only, left', not pg_temp.in_team('a2', '42', 'guardian'), true);

-- Adults bring nobody, and squads are untouched.
insert into public.guardianships (guardian_id, athlete_id) values (pg_temp.m('41'), pg_temp.m('32'));
select pg_temp.works('admin names the team with the adult athlete', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000a2', '[{"profile_id": "00000000-0000-0000-0000-000000000032"}]') $s$);
select pg_temp.ok('an adult athlete''s guardian link places nobody', not pg_temp.in_team('a2', '41', 'guardian'), true);
delete from public.guardianships where guardian_id = pg_temp.m('41') and athlete_id = pg_temp.m('32');
insert into public.teams (id, name, kind, season, sort_order) values (pg_temp.m('b3'), 'Second Squad', 'squad', 2026, 3);
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.m('b3'), pg_temp.m('31'), 'athlete');
select pg_temp.ok('placing a child in a squad places no guardian', (select count(*) = 1 from public.team_members where team_id = pg_temp.m('b3')), true);

-- The rule holds for a team without a squad too.
insert into public.teams (id, name, kind, season, sort_order) values (pg_temp.m('b4'), 'Free Team', 'team', 2026, 5);
select pg_temp.works('admin chooses the junior for a team without a squad', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b4', '[{"profile_id": "00000000-0000-0000-0000-000000000031"}, {"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
select pg_temp.ok('the junior, their guardians and the picked physio are in it', pg_temp.members_of('b4') = array[pg_temp.m('14') || ':physio', pg_temp.m('31') || ':athlete', pg_temp.m('41') || ':guardian', pg_temp.m('42') || ':guardian'], true);
select pg_temp.works('admin chooses the physio only', $s$ select public.admin_set_team_members('00000000-0000-0000-0000-0000000000b4', '[{"profile_id": "00000000-0000-0000-0000-000000000014"}]') $s$);
select pg_temp.ok('the guardians left with the junior', pg_temp.members_of('b4') = array[pg_temp.m('14') || ':physio'], true);

-- Admins read every team's games; coaches theirs; nobody else.
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  (pg_temp.m('f1'), pg_temp.m('a2'), 'Sample Team', 'Rockets', 'Round 1', now() - interval '3 days'),
  (pg_temp.m('f2'), pg_temp.m('a2'), 'Sample Team', 'Comets', 'Round 2', now() + interval '3 days');
select pg_temp.ok('anon cannot list games for admins', has_function_privilege('anon', 'public.admin_team_games()', 'execute'), false);
select pg_temp.ok('the admin sees the team''s next and last game', (select array_agg(fixture_id order by is_next desc) = array[pg_temp.m('f2'), pg_temp.m('f1')] from public.admin_team_games() where team_id = pg_temp.m('a2')), true);
select pg_temp.ok('the admin is not a coach of the team', (select count(*) = 0 from public.coach_team_games()), true);
select pg_temp.fails('the admin cannot set a team goal', format('select public.save_team_game_goal(null, %L, %L)', pg_temp.m('f2'), 'Win'));
select pg_temp.as_member('22');
select pg_temp.ok('the committee sees no games', (select count(*) = 0 from public.admin_team_games()), true);
select pg_temp.as_member('11');
select pg_temp.ok('a coach sees nothing through the admin list', (select count(*) = 0 from public.admin_team_games()), true);

-- ---------------------------------------------------------------------------
-- Hierarchy (Matt, 20 October): a physio left in the squad looks after its
-- athletes, in its teams or not, after the squad's phase is complete too.
-- Finley (14) is back in Sample Squad (a1) only.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
update public.teams set selections_completed_at = now(), selections_completed_by = pg_temp.m('01') where id = pg_temp.m('a1');
select pg_temp.as_member('14');
select pg_temp.ok('after the phase is complete, the squad physio looks after an athlete in one of its teams', public.physio_looks_after(pg_temp.m('31')), true);
select pg_temp.ok('and an athlete left in the squad only', public.physio_looks_after(pg_temp.m('32')), true);
select pg_temp.as_member('01');
update public.teams set selections_completed_at = null, selections_completed_by = null where id = pg_temp.m('a1');
