-- Tests for 20261115000500_squad_staff_see_team_games.sql: a coach or
-- manager placed on a squad sees (and follows in Vision) the games of the
-- teams in that squad, under the same can_work_with_children() rule; nobody
-- else gains anything. Covers every kind of member, both ways. Run on a
-- fresh database with the migrations and seed-members.sql loaded. Prints
-- one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.g(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-000000000f0' || n)::uuid $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
-- Which of games 1-5 the current member may see, as a string like "1,2".
create or replace function pg_temp.sees() returns text language sql as
$$ select coalesce(string_agg(n::text, ',' order by n), '') from generate_series(1, 5) n where public.may_view_game(pg_temp.g(n)) $$;
-- The same through the games row rule, as Vision lists them.
create or replace function pg_temp.lists() returns text language plpgsql as
$$ declare r text; begin
     set local role authenticated;
     select coalesce(string_agg(right(id::text, 1), ',' order by id), '') into r from public.games;
     reset role;
     return r;
   end $$;
create or replace function pg_temp.check(who text, expected text) returns setof text language plpgsql as
$$ begin
     return next case when pg_temp.sees() = expected then 'PASS ' else 'FAIL ' end
       || who || ' may view games [' || expected || '] (got [' || pg_temp.sees() || '])';
     return next case when pg_temp.lists() = expected then 'PASS ' else 'FAIL ' end
       || who || ' lists games [' || expected || '] (got [' || pg_temp.lists() || '])';
   end $$;

insert into public.club_settings (id) values (true) on conflict (id) do nothing;
insert into public.safeguarding_settings (id) values (true) on conflict (id) do nothing;

-- A second squad with a team. 71 Rene coaches Other Squad, 72 Sky manages
-- Other Team only, 73 Toni coaches Sample Squad but is stood down, 74 Pat
-- is a statistician, 75 Lee coaches Sample Squad with a lapsed check
-- (alongside the seed's Drew, 12), 76 Dana is a physio on Sample Squad.
insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Other Squad', 'squad', 3);
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000b2', 'Other Team', 'team', '00000000-0000-0000-0000-0000000000b1', 4);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000071', 'other.coach@example.test', now()),
  ('00000000-0000-0000-0000-000000000072', 'other.manager@example.test', now()),
  ('00000000-0000-0000-0000-000000000073', 'stood.coach@example.test', now()),
  ('00000000-0000-0000-0000-000000000074', 'stats@example.test', now());
update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  wwcc_number = v.wwcc, wwcc_expires_on = v.exp, wwcc_exempt_reason = v.reason,
  date_of_birth = public.club_today() - interval '40 years', verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000071', 'Rene Other', 'coach', 'WWC0071', public.club_today() + 400, null),
  ('00000000-0000-0000-0000-000000000072', 'Sky Other', 'manager', 'WWC0072', public.club_today() + 400, null),
  ('00000000-0000-0000-0000-000000000073', 'Toni Paused', 'coach', 'WWC0073', public.club_today() + 400, null),
  ('00000000-0000-0000-0000-000000000074', 'Pat Stats', 'statistician', null, null::date, 'Opens games only')
) as v(id, name, role, wwcc, exp, reason)
where p.id = v.id::uuid;
insert into public.team_members (team_id, profile_id, team_role, coach_title) values
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.m('71'), 'coach', 'head_coach'),
  ('00000000-0000-0000-0000-0000000000b2', pg_temp.m('72'), 'manager', null),
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.m('73'), 'coach', 'assistant_coach');
update public.profiles set stood_down_at = now() where id = pg_temp.m('73');

-- Games: 1 Sample Team, 2 Sample Squad itself, 3 Other Team, 4 Other Squad
-- itself, 5 no squad or team (a practice game). Pat records them all.
insert into public.games (id, team_id, config, status, recorder_id, pair_code, created_by) values
  (pg_temp.g(1), '00000000-0000-0000-0000-0000000000a2', '{}', 'live', pg_temp.m('74'), '100001', pg_temp.m('74')),
  (pg_temp.g(2), '00000000-0000-0000-0000-0000000000a1', '{}', 'live', pg_temp.m('74'), '100002', pg_temp.m('74')),
  (pg_temp.g(3), '00000000-0000-0000-0000-0000000000b2', '{}', 'live', pg_temp.m('74'), '100003', pg_temp.m('74')),
  (pg_temp.g(4), '00000000-0000-0000-0000-0000000000b1', '{}', 'live', pg_temp.m('74'), '100004', pg_temp.m('74')),
  (pg_temp.g(5), null, '{}', 'live', pg_temp.m('74'), '100005', pg_temp.m('74'));

-- ---------------------------------------------------------------------------
-- Every kind of member
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01'); select pg_temp.check('admin', '1,2,3,4,5');
select pg_temp.as_member('74'); select pg_temp.check('statistician', '1,2,3,4,5');
select pg_temp.as_member('11'); select pg_temp.check('head coach of Sample Squad and Sample Team', '1,2');
select pg_temp.as_member('42'); select pg_temp.check('assistant coach of Sample Squad only (new: game 1)', '1,2');
select pg_temp.as_member('13'); select pg_temp.check('manager of Sample Squad only (new: game 1)', '1,2');
select pg_temp.as_member('12'); select pg_temp.check('Sample Squad coach whose check lapsed', '');
select pg_temp.as_member('73'); select pg_temp.check('stood-down Sample Squad coach', '');
select pg_temp.as_member('14'); select pg_temp.check('physio on Sample Squad', '');
select pg_temp.as_member('71'); select pg_temp.check('coach of Other Squad (sees its team, not Sample''s)', '3,4');
select pg_temp.as_member('72'); select pg_temp.check('manager of Other Team only (not its squad''s game)', '3');
select pg_temp.as_member('21'); select pg_temp.check('committee, check expired', '');
select pg_temp.as_member('22'); select pg_temp.check('committee, no check', '');
select pg_temp.as_member('23'); select pg_temp.check('committee, exempt', '');
select pg_temp.as_member('31'); select pg_temp.check('athlete under 18 in the squad and team', '');
select pg_temp.as_member('32'); select pg_temp.check('adult athlete in the squad', '');
select pg_temp.as_member('41'); select pg_temp.check('guardian', '');

-- ---------------------------------------------------------------------------
-- Following, events and the live topic go the same way
-- ---------------------------------------------------------------------------
insert into public.game_events (game_id, stream, seq, id, type, payload, recorded_at, recorded_by)
select pg_temp.g(n), 'primary', 1, gen_random_uuid(), 'period_start', '{}', now(), pg_temp.m('74') from generate_series(1, 5) n;
select pg_temp.as_member('13');
select pg_temp.ok('squad manager follows the team''s game', (select g.id = pg_temp.g(1) from public.follow_game(pg_temp.g(1)) g), true);
select pg_temp.ok('and is a game member', public.is_game_member(pg_temp.g(1)), true);
select pg_temp.ok('squad manager can''t follow Other Team''s game',
  (select count(*) = 0 from (select 1 from public.game_members where game_id = pg_temp.g(3) and profile_id = pg_temp.m('13')) x), true);
select pg_temp.as_member('71');
select pg_temp.ok('Other Squad''s coach follows Other Team''s game', (select g.id = pg_temp.g(3) from public.follow_game(pg_temp.g(3)) g), true);

-- Their rights end the moment they leave the squad or are stood down.
delete from public.team_members where team_id = '00000000-0000-0000-0000-0000000000a1' and profile_id = pg_temp.m('13');
select pg_temp.as_member('13');
select pg_temp.check('manager who left Sample Squad', '');
select pg_temp.ok('and is no longer a game member of the team''s game', public.is_game_member(pg_temp.g(1)), false);
update public.profiles set stood_down_at = now() where id = pg_temp.m('71');
select pg_temp.as_member('71');
select pg_temp.check('Other Squad''s coach once stood down', '');
select pg_temp.ok('and is no longer a game member', public.is_game_member(pg_temp.g(3)), false);

-- A team moved to another squad follows the new squad's staff.
update public.profiles set stood_down_at = null where id = pg_temp.m('71');
update public.teams set squad_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.as_member('42'); select pg_temp.check('Sample Squad coach after Sample Team moved away', '2');
select pg_temp.as_member('71'); select pg_temp.check('Other Squad coach after Sample Team moved in', '1,3,4');
select pg_temp.as_member('11'); select pg_temp.check('Sample Team''s own coach either way', '1,2');

select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('may_view_game explains the squad rule',
  obj_description('public.may_view_game(uuid)'::regprocedure) like '%teams in a squad%', true);
