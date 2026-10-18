-- Tests for 20261013050000_security_follow_ups.sql. Fresh database with the
-- migrations and seed-members.sql loaded. One line per check.
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

select set_config('app.sq', current_date::text, false);
-- Extra people: a second squad with a team, a head physio, nameless member.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000051', 'physio.head@example.test', now()),
  ('00000000-0000-0000-0000-000000000052', 'physio.unplaced@example.test', now()),
  ('00000000-0000-0000-0000-000000000053', 'nameless@example.test', now()),
  ('00000000-0000-0000-0000-000000000054', 'athlete.other@example.test', now()),
  ('00000000-0000-0000-0000-000000000055', 'athlete.team2@example.test', now());
update public.profiles set status = 'approved', verified_at = now(), role = 'athlete',
  date_of_birth = current_date - interval '25 years', full_name = 'Other Squad Athlete'
  where id in ('00000000-0000-0000-0000-000000000054', '00000000-0000-0000-0000-000000000055');
update public.profiles set status = 'approved', role = 'physio', full_name = 'Head Physio', head_physio = true,
  wwcc_number = 'WWC0051', wwcc_expires_on = current_date + 400, verified_at = now()
  where id = '00000000-0000-0000-0000-000000000051';
update public.profiles set status = 'approved', role = 'physio', full_name = 'Unplaced Physio',
  wwcc_number = 'WWC0052', wwcc_expires_on = current_date + 400, verified_at = now()
  where id = '00000000-0000-0000-0000-000000000052';
update public.profiles set full_name = '' where id = '00000000-0000-0000-0000-000000000053';
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000b2', 'Other Team', 'team', '00000000-0000-0000-0000-0000000000b1', 4);
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000054', 'athlete'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000055', 'athlete'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000055', 'athlete');

-- Physios.
select pg_temp.as_member('14');
select pg_temp.ok('a placed physio looks after their squad athlete', public.physio_looks_after('00000000-0000-0000-0000-000000000032'), true);
select pg_temp.ok('a placed physio does not look after another squad', public.physio_looks_after('00000000-0000-0000-0000-000000000054'), false);
select pg_temp.as_member('52');
select pg_temp.ok('an unplaced physio sees nobody', public.physio_looks_after('00000000-0000-0000-0000-000000000032'), false);
select pg_temp.as_member('51');
select pg_temp.ok('the Head Physio sees everyone', public.physio_looks_after('00000000-0000-0000-0000-000000000054'), true);

-- Admins cannot check themselves.
select pg_temp.as_member('01');
select pg_temp.fails('an admin cannot change their own card details',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000001', null, 'WWC9999', current_date + 100) $s$);
select pg_temp.fails('an admin cannot verify themselves',
  $s$ select public.admin_mark_verified('00000000-0000-0000-0000-000000000001') $s$);
select pg_temp.works('another admin can change their details',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000011', null, 'WWC0011', current_date + 401) $s$);
select pg_temp.as_member('02');
select pg_temp.works('another admin can change theirs',
  $s$ select public.admin_set_member_details('00000000-0000-0000-0000-000000000001', null, 'WWC0001', current_date + 401) $s$);
select pg_temp.as_member('01');

-- Names.
select pg_temp.fails('a nameless member cannot be approved',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000053', 'guardian', 'approved') $s$);
select pg_temp.works('but can be left pending',
  $s$ select public.admin_save_member('00000000-0000-0000-0000-000000000053', 'guardian', 'pending') $s$);

-- Push tokens.
select pg_temp.as_member('32');
select pg_temp.works('first member registers a phone', $s$ select public.register_push_token('ExponentPushToken[abc]', 'ios') $s$);
select pg_temp.as_member('54');
select pg_temp.fails('another member cannot take it', $s$ select public.register_push_token('ExponentPushToken[abc]', 'ios') $s$);
select pg_temp.ok('it stays with the first', (select profile_id = '00000000-0000-0000-0000-000000000032' from public.push_tokens where token = 'ExponentPushToken[abc]'), true);
select pg_temp.as_member('32');
select pg_temp.works('the holder can refresh it', $s$ select public.register_push_token('ExponentPushToken[abc]', 'ios') $s$);
select pg_temp.works('signing out releases it', $s$ select public.unregister_push_token('ExponentPushToken[abc]') $s$);
select pg_temp.as_member('54');
select pg_temp.works('then the next member can register', $s$ select public.register_push_token('ExponentPushToken[abc]', 'ios') $s$);

-- Awards.
reset role;
insert into public.awards (id, season, name, closes_at, club_wide, per_group, voter_roles, nominees)
select '00000000-0000-0000-0000-0000000000c1', t.season, 'Team award', now() + interval '10 days', false, true, '{member}', 'members'
from public.teams t where t.id = '00000000-0000-0000-0000-0000000000a1';
insert into public.awards (id, season, name, closes_at, club_wide, per_group, voter_roles, nominees)
select '00000000-0000-0000-0000-0000000000c2', t.season, 'Club award', now() + interval '10 days', true, false, '{member}', 'members'
from public.teams t where t.id = '00000000-0000-0000-0000-0000000000a1';
insert into public.award_groups values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1');

select pg_temp.ok('squad member votes in their own squad award',
  '00000000-0000-0000-0000-000000000032' in (select public.award_voters('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1')), true);
select pg_temp.ok('and not in another squad''s',
  '00000000-0000-0000-0000-000000000032' in (select public.award_voters('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1')), false);
select pg_temp.ok('other squad member votes in theirs',
  '00000000-0000-0000-0000-000000000054' in (select public.award_voters('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1')), true);
select pg_temp.ok('the club award is still open to everyone',
  '00000000-0000-0000-0000-000000000054' in (select public.award_voters('00000000-0000-0000-0000-0000000000c2', null)), true);
select pg_temp.as_member('32');
select pg_temp.ok('squad award nominees are that squad only',
  (select count(*) = 6 from public.award_nominee_pool('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1')), true);
select pg_temp.ok('no other-squad names',
  not exists (select 1 from public.award_nominee_pool('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1') where name = 'Other Squad Athlete'), true);
select pg_temp.ok('club award lists everyone',
  exists (select 1 from public.award_nominee_pool('00000000-0000-0000-0000-0000000000c2', null) where name = 'Other Squad Athlete'), true);
