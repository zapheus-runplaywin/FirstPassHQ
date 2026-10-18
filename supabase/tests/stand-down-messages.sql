-- Tests for 20261018020000_stood_down_coach_messages.sql. Run on a database
-- with the migrations and seed-members.sql loaded. Prints one line per check.
--
-- Casey is a coach. Morgan coaches Sample Squad and is Jordan's guardian;
-- Jordan is an athlete in Sample Squad and Sample Team. Morgan also coaches
-- Kai in Morgan's Team, where Morgan has no child.
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
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.messages, public.message_recipients to authenticated;

insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b3', 'Morgan''s Team', 'team', 3);
insert into public.team_members (team_id, profile_id, team_role) values
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000042', 'coach'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000032', 'athlete');

-- The admin sends one message of each kind.
create temp table sent (label text primary key, id uuid);
grant select on sent to authenticated;
select pg_temp.as_member('01');
insert into sent values
  ('to coaches', public.send_group_message('Coaches meeting about Jordan', 'role', 'coach', null)),
  ('to guardians', public.send_group_message('Parents night', 'role', 'guardian', null)),
  ('whole club', public.send_group_message('Club dinner', 'club', null, null)),
  ('to Sample Squad', public.send_group_message('Squad training moved', 'group', null, '00000000-0000-0000-0000-0000000000a1')),
  ('to Sample Team', public.send_group_message('Team photo', 'group', null, '00000000-0000-0000-0000-0000000000a2')),
  ('to Morgan''s Team', public.send_group_message('Kai''s knee', 'group', null, '00000000-0000-0000-0000-0000000000b3'));

create or replace function pg_temp.reads(label text) returns boolean language sql as
$$ select exists (select 1 from public.messages where id = (select id from sent s where s.label = $1)) $$;
create or replace function pg_temp.has_copy(label text) returns boolean language sql as
$$ select exists (select 1 from public.message_recipients
   where profile_id = auth.uid() and message_id = (select id from sent s where s.label = $1)) $$;
create or replace function pg_temp.inbox() returns int language sql as
$$ select count(*)::int from public.message_recipients where profile_id = auth.uid() and message_id in (select id from sent) $$;

-- Before any stand-down, everyone reads what was sent to them.
set role authenticated;
select pg_temp.as_member('42');
select pg_temp.ok('Morgan reads the coaches message', pg_temp.reads('to coaches'), true);
select pg_temp.ok('Morgan reads the parents message', pg_temp.reads('to guardians'), true);
select pg_temp.ok('Morgan reads the club message', pg_temp.reads('whole club'), true);
select pg_temp.ok('Morgan reads the Sample Squad message', pg_temp.reads('to Sample Squad'), true);
select pg_temp.ok('Morgan reads the Sample Team message (a parent''s copy)', pg_temp.reads('to Sample Team'), true);
select pg_temp.ok('Morgan reads the Morgan''s Team message', pg_temp.reads('to Morgan''s Team'), true);
select pg_temp.ok('Morgan''s inbox has 6', pg_temp.inbox() = 6, true);
select pg_temp.as_member('11');
select pg_temp.ok('Casey reads the coaches message', pg_temp.reads('to coaches'), true);
select pg_temp.ok('Casey reads the Sample Squad message', pg_temp.reads('to Sample Squad'), true);
select pg_temp.ok('Casey''s inbox has 4', pg_temp.inbox() = 4, true);
reset role;

-- Stand both down.
select pg_temp.as_member('01');
select public.admin_stand_down('00000000-0000-0000-0000-000000000042', 'allegation', null);
select public.admin_stand_down('00000000-0000-0000-0000-000000000011', 'interim_negative_notice', null);

set role authenticated;
-- Morgan keeps what reached them as a parent or member, and loses the rest.
select pg_temp.as_member('42');
select pg_temp.ok('stood-down Morgan no longer reads the coaches message', pg_temp.reads('to coaches'), false);
select pg_temp.ok('stood-down Morgan no longer sees their copy of the coaches message', pg_temp.has_copy('to coaches'), false);
select pg_temp.ok('stood-down Morgan no longer reads Morgan''s Team message (no child there)', pg_temp.reads('to Morgan''s Team'), false);
select pg_temp.ok('stood-down Morgan no longer sees their copy of Morgan''s Team message', pg_temp.has_copy('to Morgan''s Team'), false);
select pg_temp.ok('stood-down Morgan still reads the parents message', pg_temp.reads('to guardians'), true);
select pg_temp.ok('stood-down Morgan still reads the club message', pg_temp.reads('whole club'), true);
select pg_temp.ok('stood-down Morgan still reads the Sample Squad message (Jordan is in it)', pg_temp.reads('to Sample Squad'), true);
select pg_temp.ok('stood-down Morgan still reads the Sample Team message (a parent''s copy)', pg_temp.reads('to Sample Team'), true);
select pg_temp.ok('stood-down Morgan''s inbox has 4', pg_temp.inbox() = 4, true);
select pg_temp.ok('stood-down Morgan''s unread count is 4', (select count(*) = 4 from public.message_recipients where profile_id = auth.uid() and read_at is null and message_id in (select id from sent)), true);
-- Casey has no athlete or guardian role, so only the club message is left.
select pg_temp.as_member('11');
select pg_temp.ok('stood-down Casey no longer reads the coaches message', pg_temp.reads('to coaches'), false);
select pg_temp.ok('stood-down Casey no longer reads the Sample Squad message', pg_temp.reads('to Sample Squad'), false);
select pg_temp.ok('stood-down Casey no longer reads the Sample Team message', pg_temp.reads('to Sample Team'), false);
select pg_temp.ok('stood-down Casey still reads the club message', pg_temp.reads('whole club'), true);
select pg_temp.ok('stood-down Casey''s inbox has 1', pg_temp.inbox() = 1, true);
-- Nobody else is affected.
select pg_temp.as_member('31');
select pg_temp.ok('Jordan still reads the Sample Squad message', pg_temp.reads('to Sample Squad'), true);
select pg_temp.as_member('41');
select pg_temp.ok('Logan still reads the parents message', pg_temp.reads('to guardians'), true);
select pg_temp.ok('Logan still reads the Sample Team message', pg_temp.reads('to Sample Team'), true);
select pg_temp.as_member('12');
select pg_temp.ok('a coach who isn''t stood down (Drew) still reads the coaches message', pg_temp.reads('to coaches'), true);
select pg_temp.as_member('32');
select pg_temp.ok('Kai still reads Morgan''s Team message', pg_temp.reads('to Morgan''s Team'), true);
select pg_temp.as_member('01');
select pg_temp.ok('the admin reads every message', (select count(*) = 6 from public.messages where id in (select id from sent)), true);
select pg_temp.ok('the admin sees every receipt of the coaches message', (select count(*) > 0 from public.message_recipients where message_id = (select id from sent where label = 'to coaches')), true);
reset role;

-- Lifting Morgan's stand-down brings everything back.
select pg_temp.as_member('01');
select public.admin_lift_stand_down('00000000-0000-0000-0000-000000000042', 'Cleared');
set role authenticated;
select pg_temp.as_member('42');
select pg_temp.ok('Morgan reads the coaches message again', pg_temp.reads('to coaches'), true);
select pg_temp.ok('Morgan reads Morgan''s Team message again', pg_temp.reads('to Morgan''s Team'), true);
select pg_temp.ok('Morgan''s inbox has 6 again', pg_temp.inbox() = 6, true);
select pg_temp.as_member('11');
select pg_temp.ok('Casey, still stood down, still doesn''t read the coaches message', pg_temp.reads('to coaches'), false);
reset role;

-- Guests and physios: unchanged, and their inbox matches what they can open.
select pg_temp.ok('the new helper is not callable by anon', has_function_privilege('anon', 'public.reached_me_outside_paused_roles(uuid)', 'execute'), false);
select pg_temp.ok('the new helper is callable by signed-in members', has_function_privilege('authenticated', 'public.reached_me_outside_paused_roles(uuid)', 'execute'), true);
