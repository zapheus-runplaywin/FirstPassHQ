-- Tests for 20261018230000_role_guide_audits.sql. Run on a fresh database with
-- the migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails_with(label text, statement text, needle text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm like '%' || needle || '%' then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

-- A guest with a current card can be a safeguarding contact (Matt, 21 November
-- 2026; until then guests never could). One without a card can't.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000061', 'guest@example.test', now()),
  ('00000000-0000-0000-0000-000000000062', 'helper@example.test', now());
update public.profiles set status = 'approved', full_name = 'Gus Guest', role = 'guest', verified_at = now(),
  wwcc_number = 'WWC0061', wwcc_expires_on = public.club_today() + 400, date_of_birth = public.club_today() - interval '30 years'
where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.ok('guest with a current card can be a safeguarding contact', public.can_be_safeguarding_contact('00000000-0000-0000-0000-000000000061'), true);
update public.profiles set wwcc_number = null, wwcc_expires_on = null where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.ok('guest without a card cannot', public.can_be_safeguarding_contact('00000000-0000-0000-0000-000000000061'), false);
update public.profiles set wwcc_number = 'WWC0061', wwcc_expires_on = public.club_today() + 400 where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.ok('cleared coach can be', public.can_be_safeguarding_contact('00000000-0000-0000-0000-000000000011'), true);

-- A temporary helper whose first day is ahead, with an unvalidated card, is in no WWC count yet.
update public.profiles set status = 'approved', full_name = 'Hal Helper', role = 'volunteer', verified_at = now(),
  volunteer_task = 'Bench helper', volunteer_from = public.club_today() + 10, volunteer_until = public.club_today() + 12,
  wwcc_number = 'WWC0062', wwcc_expires_on = public.club_today() + 11
where id = '00000000-0000-0000-0000-000000000062';
select pg_temp.as_member('01');
create temp table before as select * from public.admin_safety_todos();
update public.profiles set volunteer_from = public.club_today() - 1 where id = '00000000-0000-0000-0000-000000000062';
create temp table during as select * from public.admin_safety_todos();
select pg_temp.ok('upcoming helper not counted to validate', (select wwcc_to_validate from during) - (select wwcc_to_validate from before) = 1, true);
select pg_temp.ok('upcoming helper not counted to register', (select wwcc_to_link from during) - (select wwcc_to_link from before) = 1, true);
select pg_temp.ok('upcoming helper not counted as expiring', (select wwcc_expiring from during) - (select wwcc_expiring from before) = 1, true);
select pg_temp.ok('upcoming helper not counted in people', (select wwcc_people from during) - (select wwcc_people from before) = 1, true);
update public.profiles set volunteer_until = public.club_today() - 1, volunteer_from = public.club_today() - 3 where id = '00000000-0000-0000-0000-000000000062';
create temp table after as select * from public.admin_safety_todos();
select pg_temp.ok('finished helper drops out again', (select wwcc_people from after) = (select wwcc_people from before), true);

-- 20261019000000 cut a squad physio off once the squad's phase was complete;
-- 20261020000000 (Matt, 20 October: "hierarchy") keeps them looking after
-- the squad's athletes, in its teams or not. Finley (14) is in Sample Squad
-- only; Kai (32) is in the squad only, Jordan (31) in its team too.
select pg_temp.as_member('14');
select pg_temp.ok('squad physio looks after a squad athlete before selections', public.physio_looks_after('00000000-0000-0000-0000-000000000032'), true);
update public.teams set selections_completed_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.ok('squad physio still looks after the squad-only athlete after selections', public.physio_looks_after('00000000-0000-0000-0000-000000000032'), true);
select pg_temp.ok('and the athlete named in a team the physio is not in', public.physio_looks_after('00000000-0000-0000-0000-000000000031'), true);
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = '00000000-0000-0000-0000-000000000014';
select pg_temp.ok('out of the squad and in no team, the physio looks after nobody', public.physio_looks_after('00000000-0000-0000-0000-000000000031'), false);
insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000014', 'physio');
select pg_temp.ok('placed in the team, the physio looks after its athlete', public.physio_looks_after('00000000-0000-0000-0000-000000000031'), true);
select pg_temp.ok('but not the squad-only athlete', public.physio_looks_after('00000000-0000-0000-0000-000000000032'), false);
insert into public.team_members (team_id, profile_id, team_role) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000014', 'physio');
update public.profiles set head_physio = true where id = '00000000-0000-0000-0000-000000000014';
select pg_temp.ok('the Head Physio looks after everyone whatever the phase', public.physio_looks_after('00000000-0000-0000-0000-000000000032'), true);
update public.teams set selections_completed_at = null where id = '00000000-0000-0000-0000-0000000000a1';

-- 20261019000000: the Guest role is for adults. Gus (61) is an approved adult
-- guest; a guest without a date of birth, or under 18, can't be approved.
select pg_temp.as_member('01');
select pg_temp.works('adult guest can be re-saved as approved', $$select public.admin_save_member('00000000-0000-0000-0000-000000000061', 'guest', 'approved')$$);
update public.profiles set date_of_birth = public.club_today() - interval '16 years' where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.fails_with('guest under 18 is refused', $$select public.admin_save_member('00000000-0000-0000-0000-000000000061', 'guest', 'approved')$$, 'Guests must be 18 or over');
update public.profiles set date_of_birth = null where id = '00000000-0000-0000-0000-000000000061';
select pg_temp.fails_with('guest without a date of birth is refused', $$select public.admin_save_member('00000000-0000-0000-0000-000000000061', 'guest', 'approved')$$, 'before approving a guest');
update public.profiles set date_of_birth = public.club_today() - interval '30 years' where id = '00000000-0000-0000-0000-000000000061';

-- 20261019000000: a temporary helper's parent-volunteer exemption names the
-- child with no guardian link; a coach still needs the link.
select pg_temp.fails_with('coach without a guardian link still refused', $$select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000011', 'parent_volunteer', '00000000-0000-0000-0000-000000000031')$$, 'Link them as a guardian');
select pg_temp.fails_with('helper must name an athlete under 18', $$select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000062', 'parent_volunteer', '00000000-0000-0000-0000-000000000032')$$, 'Choose their child');
select pg_temp.works('helper exempt as the parent of Jordan (31)', $$select public.admin_set_volunteer_exemption('00000000-0000-0000-0000-000000000062', 'parent_volunteer', '00000000-0000-0000-0000-000000000031')$$);
select pg_temp.ok('exemption stored with the child''s name', (select child_name = 'Jordan Junior' from public.volunteer_exemptions where profile_id = '00000000-0000-0000-0000-000000000062' and ended_at is null), true);
select pg_temp.ok('not valid until declared', (select valid from public.volunteer_exemption_state('00000000-0000-0000-0000-000000000062')), false);
update public.volunteer_exemptions set declared_at = now() where profile_id = '00000000-0000-0000-0000-000000000062' and ended_at is null;
select pg_temp.ok('valid once declared, without a guardian link', (select valid from public.volunteer_exemption_state('00000000-0000-0000-0000-000000000062')), true);
select pg_temp.ok('ends when the child turns 18', (select ends_on = (select (date_of_birth + interval '18 years')::date from public.profiles where id = '00000000-0000-0000-0000-000000000031') from public.volunteer_exemption_state('00000000-0000-0000-0000-000000000062')), true);

-- 20261019000000: a physio who is also a guardian doesn't vote in an
-- "every member" award; a physio who is also a coach does. Finley (14) is a
-- physio; Pat (41) a guardian.
select pg_temp.as_member('01');
create temp table ids (name text, id uuid);
insert into ids select 'award', public.admin_save_award(null, 2026, 'Club Champion', 'Best all round', now() + interval '7 days', true, false,
  '{member}', 'athletes'::public.award_nominees, '{3,2,1}'::smallint[], false, 48, 0::smallint, null, false, '{}', '{}');
update public.profiles set extra_roles = '{guardian}' where id = '00000000-0000-0000-0000-000000000014';
insert into public.guardianships (guardian_id, athlete_id) values ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000031');
select pg_temp.ok('physio who is a guardian is not a voter', exists (select 1 from public.award_voters((select id from ids where name = 'award'), null) v where v = '00000000-0000-0000-0000-000000000014'), false);
select pg_temp.ok('guardian alone is not a voter', exists (select 1 from public.award_voters((select id from ids where name = 'award'), null) v where v = '00000000-0000-0000-0000-000000000041'), false);
update public.profiles set extra_roles = '{coach}' where id = '00000000-0000-0000-0000-000000000014';
select pg_temp.ok('physio who is a coach votes', exists (select 1 from public.award_voters((select id from ids where name = 'award'), null) v where v = '00000000-0000-0000-0000-000000000014'), true);
select pg_temp.ok('adult athlete votes', exists (select 1 from public.award_voters((select id from ids where name = 'award'), null) v where v = '00000000-0000-0000-0000-000000000032'), true);
