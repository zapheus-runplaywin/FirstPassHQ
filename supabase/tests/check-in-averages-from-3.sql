-- Tests for 20261017090000_check_in_averages_from_3.sql. Run on a fresh
-- database with the migrations and seed-members.sql loaded. Prints one line
-- per check. Uses days three weeks back so the seeded check-ins don't count.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
-- Whether a group (null = whole club) shows on a day, one-day window.
create or replace function pg_temp.shows(g text, d int) returns boolean language sql as
$$ select v.visible from public.check_in_visible_days(public.club_today() - d, public.club_today() - d, 1) v
   where v.day = public.club_today() - d and v.team_id is not distinct from g::uuid $$;

select count(*) as rows_before from public.check_ins \gset

-- Adult athletes 61-69 in Sample Squad; 67-69 are also in Sample Team.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'athlete' || n || '@example.test', now()
from generate_series(61, 69) n;
update public.profiles set status = 'approved', role = 'athlete', full_name = 'Athlete ' || right(id::text, 2),
  date_of_birth = public.club_today() - interval '25 years', verified_at = now()
where right(id::text, 2) between '61' and '69';
insert into public.team_members (team_id, profile_id, team_role)
select '00000000-0000-0000-0000-0000000000a1', ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'athlete'
from generate_series(61, 69) n;
insert into public.team_members (team_id, profile_id, team_role)
select '00000000-0000-0000-0000-0000000000a2', ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'athlete'
from generate_series(67, 69) n;

insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, public.club_today() - d, 4, 4, 4, 4
from (values
  -- 20 days back: 3 squad athletes
  (20, 61), (20, 62), (20, 63),
  -- 21: 2 squad athletes
  (21, 61), (21, 62),
  -- 22: squad 4, of whom 2 in the team
  (22, 61), (22, 62), (22, 67), (22, 68),
  -- 23: squad 5, team 3 (2 apart)
  (23, 61), (23, 62), (23, 67), (23, 68), (23, 69),
  -- 24: squad 6, team 3 (3 apart)
  (24, 61), (24, 62), (24, 63), (24, 67), (24, 68), (24, 69)
) v(d, n);

select pg_temp.ok('3 check-ins show', pg_temp.shows('00000000-0000-0000-0000-0000000000a1', 20), true);
select pg_temp.ok('the club shows with the same 3', pg_temp.shows(null, 20), true);
select pg_temp.ok('2 check-ins hide', pg_temp.shows('00000000-0000-0000-0000-0000000000a1', 21), false);
select pg_temp.ok('squad of 4 shows while its team has only 2', pg_temp.shows('00000000-0000-0000-0000-0000000000a1', 22), true);
select pg_temp.ok('team of 2 hides', pg_temp.shows('00000000-0000-0000-0000-0000000000a2', 22), false);
-- The overlap rule is gone (Matt): groups 2 apart both show.
select pg_temp.ok('squad shows when its team is 2 apart', pg_temp.shows('00000000-0000-0000-0000-0000000000a1', 23), true);
select pg_temp.ok('team of 3 shows when its squad is 2 apart', pg_temp.shows('00000000-0000-0000-0000-0000000000a2', 23), true);
select pg_temp.ok('club shows when a team is 2 apart', pg_temp.shows(null, 23), true);
select pg_temp.ok('squad shows when its team is 3 apart', pg_temp.shows('00000000-0000-0000-0000-0000000000a1', 24), true);
select pg_temp.ok('team of 3 shows when its squad is 3 apart', pg_temp.shows('00000000-0000-0000-0000-0000000000a2', 24), true);

-- Through the committee's own views.
select pg_temp.as_member('22');
select pg_temp.ok('committee overview shows 3 check-ins',
  (select avg_sleep is not null and checked_in_count = 3 from public.check_in_overview(public.club_today() - 20) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('committee overview hides 2 check-ins',
  (select avg_sleep is null from public.check_in_overview(public.club_today() - 21) where team_id = '00000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.ok('committee cannot call the helper directly',
  (select not has_function_privilege('authenticated', 'public.check_in_visible_days(date, date, int)', 'execute')), true);

select pg_temp.ok('no existing check-ins lost',
  (select count(*) = :rows_before + 20 from public.check_ins), true);
