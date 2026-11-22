-- Tests for 20261013130000_guardian_activity.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;

-- The seed's memberships were added before... they are logged too, since the
-- seed loads after the migration. Start from a clean log and seen state.
delete from public.group_membership_changes where true;
-- Jordan (31) joined both groups a while ago.
update public.team_members set created_at = now() - interval '30 days'
  where profile_id = '00000000-0000-0000-0000-000000000031';

-- A physio (14) is added to the team, then a coach (12) leaves the squad.
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000014', 'physio');
delete from public.team_members
  where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = '00000000-0000-0000-0000-000000000012';
-- An adult athlete (32) joins the team: not an adult with access.
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000032', 'athlete');

select pg_temp.as_member('41');
select pg_temp.ok('guardian sees physio added',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Finley Physio was added as a physio of Sample Team.'), true);
select pg_temp.ok('guardian sees coach removed',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Drew Lapsed is no longer a coach in Sample Squad.'), true);
select pg_temp.ok('another athlete joining is not listed',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary like 'Kai Senior%'), true);

-- Changes before the child joined aren't listed.
-- Next season's team: Jordan is in Sample Team this season, and an athlete is
-- in one team a season (20 November 2026).
insert into public.teams (id, name, kind, season, sort_order) values
  ('00000000-0000-0000-0000-0000000000a3', 'Second Team', 'team',
   (select season + 1 from public.teams where id = '00000000-0000-0000-0000-0000000000a1'), 3);
insert into public.team_members (team_id, profile_id, team_role, created_at) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000013', 'manager', now());
update public.group_membership_changes set changed_at = now() - interval '2 days'
  where team_id = '00000000-0000-0000-0000-0000000000a3';
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000031', 'athlete');
select pg_temp.ok('child added to a team is listed',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Jordan Junior was added to Second Team.'), true);
select pg_temp.ok('adult already there before the child joined is not listed',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary like 'Emery Manager%Second Team%'), true);
delete from public.team_members
  where team_id = '00000000-0000-0000-0000-0000000000a3' and profile_id = '00000000-0000-0000-0000-000000000031';
select pg_temp.ok('child removed from a team is listed',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Jordan Junior was removed from Second Team.'), true);

-- Guardian links, consents and shares
insert into public.guardianship_history (guardian_id, guardian_name, athlete_id, change, changed_by_name)
values ('00000000-0000-0000-0000-000000000042', 'Morgan Coach-Parent', '00000000-0000-0000-0000-000000000031', 'unlinked', 'Alex Admin');
insert into public.child_consents (athlete_id, kind, given_by_name, policy_version, withdrawn_at, withdrawn_by_name)
values ('00000000-0000-0000-0000-000000000031', 'data', 'Logan Parent', '2026-1', now(), 'Logan Parent');
insert into public.record_access_log (subject_id, viewer_name, viewer_role, kind)
values ('00000000-0000-0000-0000-000000000031', 'Gale Committee', 'Committee', 'injury_document_shared'),
       ('00000000-0000-0000-0000-000000000031', 'Casey Coach', 'Coach', 'check_ins');
select pg_temp.ok('guardian unlink listed',
  (select count(*) >= 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Morgan Coach-Parent was unlinked as a parent or guardian, by Alex Admin.'), true);
select pg_temp.ok('consent given listed',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Logan Parent gave consent for daily check-ins.'), true);
select pg_temp.ok('consent withdrawn listed',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Logan Parent withdrew consent for daily check-ins.'), true);
select pg_temp.ok('document share listed',
  (select count(*) = 1 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary = 'Gale Committee (committee) shared an injury document out of the app.'), true);
select pg_temp.ok('ordinary views are not in the feed',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000031')
   where summary like 'Casey Coach%'), true);
select pg_temp.ok('newest first',
  (select bool_and(ok) from (select happened_at >= lead(happened_at) over (order by happened_at desc) is not false as ok
     from public.child_activity('00000000-0000-0000-0000-000000000031')) x), true);

-- Who can read it
select pg_temp.as_member('11');
select pg_temp.ok('coach cannot read a child activity',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('31');
select pg_temp.ok('the child cannot read it',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin can read it',
  (select count(*) > 0 from public.child_activity('00000000-0000-0000-0000-000000000031')), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian of no adult athlete reads nothing for an adult',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000032')), true);

-- New since last seen
select pg_temp.ok('guardian has new activity',
  (select new_count > 0 from public.child_activity_new() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select public.mark_child_activity_seen('00000000-0000-0000-0000-000000000031');
select pg_temp.ok('nothing new after looking',
  (select new_count = 0 from public.child_activity_new() where athlete_id = '00000000-0000-0000-0000-000000000031'), true);
select pg_temp.as_member('11');
select public.mark_child_activity_seen('00000000-0000-0000-0000-000000000031');
select pg_temp.ok('coach cannot mark seen',
  (select count(*) = 0 from public.child_activity_seen where guardian_id = '00000000-0000-0000-0000-000000000011'), true);

-- Ends at 18
update public.profiles set date_of_birth = public.club_today() - interval '19 years', under_17 = false
  where id = '00000000-0000-0000-0000-000000000031';
select pg_temp.as_member('41');
select pg_temp.ok('guardian reads nothing once the child is 18',
  (select count(*) = 0 from public.child_activity('00000000-0000-0000-0000-000000000031')), true);

-- No direct access
set role authenticated;
select pg_temp.fails('no direct read of membership changes', $$select count(*) from public.group_membership_changes$$);
select pg_temp.fails('no direct write of seen', $$insert into public.child_activity_seen (guardian_id, athlete_id) values ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031')$$);
reset role;
