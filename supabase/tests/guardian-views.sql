-- Tests for 20261029100000_guardian_placements_on_save.sql (with squads
-- followed too since 20261101000000_parent_link_codes.sql) and the read-only
-- guardian check, supabase/checks/guardian-views.sql (guardian data audit,
-- 29 October 2026). Run on a fresh database with the migrations and
-- seed-members.sql loaded. Prints one line per check; the guardian check at
-- the end prints OK, GAP and INFO notices, and any GAP fails the run.
--
-- The sample family: Jordan (31, under 18) is an athlete in Sample Squad and
-- Sample Team; Logan (41) is a guardian placed in both only because Jordan
-- is in them; Morgan (42) coaches Sample Squad and is also Jordan's
-- guardian. Everything below goes through the app's own functions, signed in
-- as the member who would do it, the way the admin member page sends it.
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
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.id(n text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
-- What the admin member page sends back: every placement this season.
create or replace function pg_temp.page_teams(n text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('team_id', m.team_id, 'team_role', m.team_role,
    'coach_title', m.coach_title, 'selection', m.selection) order by m.team_id), '[]')
  from public.team_members m join public.teams t on t.id = m.team_id and not t.archived
  where m.profile_id = pg_temp.id(n) $$;
create or replace function pg_temp.placed(n text, team text, as_role text) returns boolean language sql as $$
  select exists (select 1 from public.team_members m where m.profile_id = pg_temp.id(n)
    and m.team_id = pg_temp.id(team) and m.team_role::text = as_role) $$;
create or replace function pg_temp.changes() returns bigint language sql as
$$ select count(*) from public.group_membership_changes $$;

-- A second team in the squad, and Sample Team's game and calendar.
insert into public.teams (id, name, kind, squad_id, sort_order) values
  (pg_temp.id('a3'), 'Second Team', 'team', pg_temp.id('a1'), 3);
insert into public.fixtures (team_id, team_name, starts_at) values (pg_temp.id('a2'), 'Sample Team', now() + interval '4 days');
insert into public.calendars (name, url, team_id) values ('Sample Team games', 'https://example.test/team.ics', pg_temp.id('a2'));

select pg_temp.ok('to start, Logan follows Jordan: placed in Sample Squad and Sample Team as a guardian',
  pg_temp.placed('41', 'a1', 'guardian') and pg_temp.placed('41', 'a2', 'guardian'), true);

-- ---------------------------------------------------------------------------
-- Saving a guardian's member page.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
create temp table logan_mark as select clock_timestamp() as at;
select pg_temp.works('admin saves Logan unchanged (their placements sent back)',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved', pg_temp.page_teams('41'), false, '{}') $s$);
select pg_temp.ok('Logan is still placed in Sample Squad and Sample Team',
  pg_temp.placed('41', 'a1', 'guardian') and pg_temp.placed('41', 'a2', 'guardian'), true);
select pg_temp.works('admin saves Logan with no squads or teams',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved', '[]', false, '{}') $s$);
select pg_temp.ok('the placements Logan has because Jordan is there stay',
  pg_temp.placed('41', 'a1', 'guardian') and pg_temp.placed('41', 'a2', 'guardian'), true);
select pg_temp.works('admin saves Logan with only the squad',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"guardian"}]', false, '{}') $s$);
select pg_temp.ok('Logan is in the squad and still in Sample Team',
  pg_temp.placed('41', 'a1', 'guardian') and pg_temp.placed('41', 'a2', 'guardian'), true);
select pg_temp.works('admin saves Logan with only the team',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a2","team_role":"guardian"}]', false, '{}') $s$);
select pg_temp.ok('the squad Logan follows Jordan into stays when the admin leaves it out',
  pg_temp.placed('41', 'a1', 'guardian') and pg_temp.placed('41', 'a2', 'guardian'), true);
select pg_temp.ok('saving Logan recorded no group changes for Logan',
  not exists (select 1 from public.group_membership_changes where profile_id = pg_temp.id('41')
    and changed_at > (select at from logan_mark)), true);
select pg_temp.fails('the squad rules still apply to placements the admin chooses',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a3","team_role":"guardian"}]', false, '{}') $s$);

-- A coach who is also a parent.
select pg_temp.works('admin saves Morgan (squad coach, Jordan''s guardian) unchanged',
  $s$ select public.admin_save_member(pg_temp.id('42'), 'coach', 'approved', pg_temp.page_teams('42'), false, '{}', null, '{guardian}') $s$);
select pg_temp.ok('Morgan still coaches the squad and follows Jordan in Sample Team',
  pg_temp.placed('42', 'a1', 'coach') and pg_temp.placed('42', 'a2', 'guardian'), true);
select pg_temp.works('admin makes Morgan a coach of Sample Team as well',
  $s$ select public.admin_save_member(pg_temp.id('42'), 'coach', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"coach","coach_title":"assistant_coach"},
         {"team_id":"00000000-0000-0000-0000-0000000000a2","team_role":"coach","coach_title":"assistant_coach"}]', false, '{}', null, '{guardian}') $s$);
select pg_temp.ok('in Sample Team Morgan is now a coach, not a guardian',
  pg_temp.placed('42', 'a2', 'coach') and not pg_temp.placed('42', 'a2', 'guardian'), true);
select pg_temp.works('admin takes Morgan off Sample Team as a coach',
  $s$ select public.admin_save_member(pg_temp.id('42'), 'coach', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"coach","coach_title":"assistant_coach"}]', false, '{}', null, '{guardian}') $s$);
select pg_temp.ok('Morgan stays in Sample Team as Jordan''s guardian', pg_temp.placed('42', 'a2', 'guardian'), true);

-- ---------------------------------------------------------------------------
-- Saving a child's member page changes only what changed.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
create temp table before_save as select pg_temp.changes() as n;
select pg_temp.works('admin saves Jordan unchanged',
  $s$ select public.admin_save_member(pg_temp.id('31'), 'athlete', 'approved', pg_temp.page_teams('31'), true,
       array[pg_temp.id('41'), pg_temp.id('42')]) $s$);
select pg_temp.ok('an unchanged save records no group changes', pg_temp.changes() = (select n from before_save), true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan''s What''s changed doesn''t say Jordan left Sample Team',
  (select count(*) from public.child_activity(pg_temp.id('31'))
   where summary in ('Jordan Junior was removed from Sample Team.', 'Jordan Junior was removed from Sample Squad.')) = 0, true);
select pg_temp.as_member('01');
select pg_temp.works('admin makes Jordan a training partner in Sample Team',
  $s$ select public.admin_save_member(pg_temp.id('31'), 'athlete', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a2","team_role":"athlete","selection":"training_partner"}]', true,
       array[pg_temp.id('41'), pg_temp.id('42')]) $s$);
select pg_temp.ok('the new selection is saved',
  (select selection::text from public.team_members where profile_id = pg_temp.id('31') and team_id = pg_temp.id('a2')) = 'training_partner', true);
select pg_temp.ok('changing the selection records no group change', pg_temp.changes() = (select n from before_save), true);
select pg_temp.works('admin changes Casey to assistant coach of Sample Team',
  $s$ select public.admin_save_member(pg_temp.id('11'), 'coach', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"coach","coach_title":"head_coach"},
         {"team_id":"00000000-0000-0000-0000-0000000000a2","team_role":"coach","coach_title":"assistant_coach"}]', false, '{}') $s$);
select pg_temp.ok('the new title is saved without a group change',
  (select coach_title::text from public.team_members where profile_id = pg_temp.id('11') and team_id = pg_temp.id('a2')) = 'assistant_coach'
  and pg_temp.changes() = (select n from before_save), true);

create temp table mark as select clock_timestamp() as at;
select pg_temp.works('admin moves Jordan from Sample Team to Second Team',
  $s$ select public.admin_save_member(pg_temp.id('31'), 'athlete', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a3","team_role":"athlete"}]', true,
       array[pg_temp.id('41'), pg_temp.id('42')]) $s$);
select pg_temp.ok('the move is recorded: one removal and one addition for Jordan',
  (select count(*) from public.group_membership_changes where profile_id = pg_temp.id('31')
   and changed_at > (select at from mark) and team_id in (pg_temp.id('a2'), pg_temp.id('a3'))) = 2, true);
select pg_temp.ok('Jordan''s guardians follow them to Second Team and leave Sample Team',
  pg_temp.placed('41', 'a3', 'guardian') and pg_temp.placed('42', 'a3', 'guardian')
  and not pg_temp.placed('41', 'a2', 'guardian') and not pg_temp.placed('42', 'a2', 'guardian'), true);
select pg_temp.ok('Jordan stays in the squad, unrecorded',
  (select count(*) from public.group_membership_changes where profile_id = pg_temp.id('31')
   and changed_at > (select at from mark) and team_id = pg_temp.id('a1')) = 0 and pg_temp.placed('31', 'a1', 'athlete'), true);
select pg_temp.works('admin puts Jordan back in Sample Team',
  $s$ select public.admin_save_member(pg_temp.id('31'), 'athlete', 'approved',
       '[{"team_id":"00000000-0000-0000-0000-0000000000a1","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a2","team_role":"athlete"},
         {"team_id":"00000000-0000-0000-0000-0000000000a3","team_role":"athlete"}]', true,
       array[pg_temp.id('41'), pg_temp.id('42')]) $s$);
select pg_temp.as_member('41');
select pg_temp.ok('Logan sees Sample Team''s game and calendar again',
  (select count(*) from public.fixtures where team_id = pg_temp.id('a2')) = 1
  and (select count(*) from public.calendars where team_id = pg_temp.id('a2')) = 1, true);

-- A member who isn't approved is still taken out of every group, as before.
select pg_temp.as_member('01');
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.id('43'), 'quinn@example.test', now());
update public.profiles set status = 'approved', full_name = 'Quinn Parent', role = 'guardian', verified_at = now()
  where id = pg_temp.id('43');
select pg_temp.works('admin links Quinn to Jordan too',
  $s$ select public.admin_save_member(pg_temp.id('31'), 'athlete', 'approved', pg_temp.page_teams('31'), true,
       array[pg_temp.id('41'), pg_temp.id('42'), pg_temp.id('43')]) $s$);
select pg_temp.ok('Quinn follows Jordan into Sample Team and Second Team',
  pg_temp.placed('43', 'a2', 'guardian') and pg_temp.placed('43', 'a3', 'guardian'), true);
select pg_temp.works('admin sets Quinn back to waiting for approval',
  $s$ select public.admin_save_member(pg_temp.id('43'), 'guardian', 'pending', pg_temp.page_teams('43'), false, '{}') $s$);
select pg_temp.ok('a guardian waiting for approval is in no group and linked to nobody',
  not exists (select 1 from public.team_members where profile_id = pg_temp.id('43'))
  and not exists (select 1 from public.guardianships where guardian_id = pg_temp.id('43')), true);

-- Only admins save members.
select pg_temp.as_member('11');
select pg_temp.fails('a coach cannot save a member',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved', '[]', false, '{}') $s$);
select pg_temp.as_member('41');
select pg_temp.fails('a guardian cannot save a member',
  $s$ select public.admin_save_member(pg_temp.id('41'), 'guardian', 'approved', '[]', false, '{}') $s$);

-- ---------------------------------------------------------------------------
-- Activity for the guardian check: a message to the squad, a captain's
-- message, an absence and a check-in.
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.works('Casey messages the squad',
  $s$ select public.send_group_message('Training moved to 6pm', 'group', null, pg_temp.id('a1')) $s$);
select pg_temp.works('Casey makes Jordan squad captain',
  $s$ select public.set_group_captains(pg_temp.id('a1'), array[pg_temp.id('31')], '{}') $s$);
select pg_temp.as_member('31');
select pg_temp.works('Jordan messages the squad as captain',
  $s$ select public.send_group_message('Bring bibs', 'group', null, pg_temp.id('a1')) $s$);
select pg_temp.works('Jordan reports an absence',
  $s$ select public.report_absence(pg_temp.id('31'), current_date + 1, current_date + 2, 'Exams') $s$);
select pg_temp.works('Jordan checks in',
  $s$ select public.save_check_in(current_date - 1, 3, 3, 3, 3, 'Fine') $s$);
select set_config('request.jwt.claim.sub', '', false);

-- The check finds drift: Logan taken out of Sample Team behind the app's back.
delete from public.team_members where profile_id = pg_temp.id('41') and team_id = pg_temp.id('a2');
\setenv PGDATABASE :DBNAME
\! scripts/check-guardian-views.sh > /dev/null 2>&1; if [ $? -eq 1 ]; then echo 'PASS the guardian check reports a guardian missing from their child''s team'; else echo 'FAIL the guardian check missed a guardian missing from their child''s team'; fi
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.id('a2'), pg_temp.id('41'), 'guardian');
-- And from their child's squad, which guardians follow too (20261101000000).
delete from public.team_members where profile_id = pg_temp.id('41') and team_id = pg_temp.id('a1');
\! scripts/check-guardian-views.sh > /dev/null 2>&1; if [ $? -eq 1 ]; then echo 'PASS the guardian check reports a guardian missing from their child''s squad'; else echo 'FAIL the guardian check missed a guardian missing from their child''s squad'; fi
insert into public.team_members (team_id, profile_id, team_role) values (pg_temp.id('a1'), pg_temp.id('41'), 'guardian');

-- Then the whole guardian check: every guardian sees what their child sees.
\ir ../checks/guardian-views.sql
