-- A generated club of 200 sample members (no real people), for the tests that
-- check the rules at club size: supabase/tests/large-club.sql and
-- concurrency.sql load it with \ir after the migrations and seed-members.sql.
--
-- The mix follows a real club's shape, with the awkward cases a hand-made
-- seed misses: brothers and sisters in the same squad and in different ones,
-- children with one or two guardians, guardians who also coach, manage or
-- sit on the committee, athletes in two teams, a squad whose selections are
-- done, coaches with a lapsed check or stood down, a Head Physio and a squad
-- physio, guests, temporary helpers, members waiting for approval, children
-- turning 18 today and tomorrow, and consents given, partly given and not
-- given. Everything is generated from a fixed seed, so every run builds the
-- same club.
--
-- Members are numbered 1 to 200, with ids 00000000-0000-0000-0001-000000000NNN
-- (pg_temp.lc(n) gives one), so they never clash with seed-members.sql. Who
-- each number is:
--     1-2  admins (1 is also a guardian)
--     3-7  committee: current check, check lapsed, no check, exempt, also a guardian
--    8-21  coaches: 8-15 head coaches, 16-19 assistants (17 lapsed check,
--          18 also a guardian, 19 also an adult athlete), 20 lapsed, 21 stood down
--   22-25  managers (22 also a guardian)
--   26-27  physios: 26 the Head Physio, 27 a squad physio
--   28-97  athletes under 18 (28 turns 18 tomorrow, 29 turned 18 today)
--  98-137  adult athletes
-- 138-192  guardians
-- 193-195  guests; 196-197 waiting for approval; 198-199 temporary helpers;
--     200  statistician

do $$ begin perform setseed(0.2026); end $$;

create or replace function pg_temp.lc(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.lc_team(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid $$;

create temp table lc_people (
  n int primary key,
  role public.app_role not null,
  extra public.app_role[] not null default '{}',
  status public.member_status not null default 'approved',
  dob date,
  wwcc text,
  expires date,
  exempt text,
  head_physio boolean not null default false,
  stood_down boolean not null default false
);

insert into lc_people (n, role, extra, wwcc, expires, exempt)
select n,
  case
    when n <= 2 then 'admin'
    when n <= 7 then 'committee'
    when n <= 21 then 'coach'
    when n <= 25 then 'manager'
    when n <= 27 then 'physio'
    when n <= 137 then 'athlete'
    when n <= 192 then 'guardian'
    when n <= 197 then 'guest'
    when n <= 199 then 'volunteer'
    else 'statistician'
  end::public.app_role,
  case n
    when 1 then '{guardian}'
    when 7 then '{guardian}'
    when 18 then '{guardian}'
    when 19 then '{athlete}'
    when 22 then '{guardian}'
    else '{}'
  end::public.app_role[],
  -- Checks: everyone who needs one has a current one, except the lapsed.
  case when n between 1 and 27 and n not in (5, 6) or n in (198, 199) then 'WWC' || lpad(n::text, 4, '0') end,
  case
    when n in (4, 17, 20) then current_date - 1 - (n % 20)
    when n between 1 and 27 and n not in (5, 6) or n in (198, 199) then current_date + 100 + n * 7
  end,
  case when n = 6 then 'Treasurer only, no contact with children' end
from generate_series(1, 200) n;
-- Committee member 4's check lapsed; 5 has none (the club has no committee
-- checks date, so 5 keeps the role); 6 is exempt.
update lc_people set wwcc = 'WWC0004' where n = 4;
update lc_people set head_physio = true where n = 26;
update lc_people set stood_down = true where n = 21;
update lc_people set status = 'pending' where n in (196, 197);

-- Ages: under 18s from 10 to 17, two of them on the 18th birthday edge;
-- adults from 18 to 45; staff and guardians 25 to 60.
update lc_people set dob = case
    when n = 28 then (current_date - interval '18 years' + interval '1 day')::date
    when n = 29 then (current_date - interval '18 years')::date
    when n <= 97 then (current_date - interval '10 years' - (floor(random() * 365 * 7.9)::int) * interval '1 day')::date
    else (current_date - interval '18 years' - interval '1 day' - (floor(random() * 365 * 27)::int) * interval '1 day')::date
  end
where role = 'athlete';
update lc_people set dob = (current_date - interval '25 years' - (floor(random() * 365 * 35)::int) * interval '1 day')::date
where role <> 'athlete';

insert into auth.users (id, email, email_confirmed_at)
select pg_temp.lc(n), 'member' || n || '@large-club.example.test', now() from lc_people;

update public.profiles p set
  status = l.status,
  full_name = (array['Ari','Bailey','Charlie','Dakota','Eden','Frankie','Georgie','Hayden','Isla','Jesse','Kirra','Lennox','Marley','Nico','Oakley','Peyton','Quinn','Reese','Sasha','Tate','Umi','Vic','Wren','Xan','Yael','Zion','Arlo','Bodhi','Cleo','Darcy'])[1 + (l.n * 7) % 30]
    || ' ' || (array['Abbott','Brennan','Carmody','Dawson','Ellery','Fitzroy','Garner','Holloway','Ingram','Jarvis','Kendall','Lowry','Mercer','Nolan','Oswald','Prescott','Quigley','Radford','Sutton','Thorne'])[1 + (l.n * 11) % 20]
    || ' ' || l.n,
  role = l.role,
  extra_roles = l.extra,
  date_of_birth = l.dob,
  wwcc_number = l.wwcc,
  wwcc_expires_on = l.expires,
  wwcc_exempt_reason = l.exempt,
  head_physio = l.head_physio,
  verified_at = case when l.status = 'approved' then now() - interval '30 days' end,
  volunteer_task = case when l.role = 'volunteer' then 'Canteen at the carnival' end,
  volunteer_from = case when l.role = 'volunteer' then current_date end,
  volunteer_until = case when l.role = 'volunteer' then current_date + 2 end
from lc_people l
where p.id = pg_temp.lc(l.n);

-- Squads and teams: four squads by age, three teams in each. The 13 & Under
-- squad's selections are done, so it has ended for its coaches and physio.
insert into public.teams (id, name, kind, sort_order, selections_completed_at)
select pg_temp.lc_team(s), (array['Open', '17 & Under', '15 & Under', '13 & Under'])[s] || ' Squad', 'squad', 100 + s * 10,
  case when s = 4 then now() - interval '7 days' end
from generate_series(1, 4) s;
insert into public.teams (id, name, kind, squad_id, sort_order)
select pg_temp.lc_team(s * 10 + t), (array['Open', '17 & Under', '15 & Under', '13 & Under'])[s] || ' ' || (array['A', 'B', 'C'])[t],
  'team', pg_temp.lc_team(s), 100 + s * 10 + t
from generate_series(1, 4) s, generate_series(1, 3) t;

-- Each athlete is in the squad for their age and one of its teams (an
-- athlete is in one team at a time, 20 November 2026). Adults are in the
-- Open squad.
create temp table lc_athlete_squad as
select n, case
    when dob <= current_date - interval '18 years' then 1
    when dob <= current_date - interval '16 years' then 2
    when dob <= current_date - interval '14 years' then 3
    else 4
  end as squad
from lc_people where role = 'athlete' or 'athlete' = any (extra);
insert into public.team_members (team_id, profile_id, team_role)
select pg_temp.lc_team(squad), pg_temp.lc(n), 'athlete' from lc_athlete_squad;
insert into public.team_members (team_id, profile_id, team_role)
select pg_temp.lc_team(squad * 10 + 1 + n % 3), pg_temp.lc(n), 'athlete' from lc_athlete_squad;

-- Coaches: two head coaches per squad (squad and team), assistants across
-- squads, the lapsed and stood-down coaches still listed on groups.
insert into public.team_members (team_id, profile_id, team_role, coach_title)
select pg_temp.lc_team(s), pg_temp.lc(7 + s * 2 - 1), 'coach'::public.team_role, 'head_coach'::public.coach_title from generate_series(1, 4) s
union all
select pg_temp.lc_team(s * 10 + t), pg_temp.lc(7 + s * 2 - 1 + (t = 3)::int), 'coach', 'head_coach'
from generate_series(1, 4) s, generate_series(1, 3) t
union all
select pg_temp.lc_team(v.team), pg_temp.lc(v.coach), 'coach', 'assistant_coach'
from (values (2, 16), (3, 16), (1, 17), (3, 18), (2, 19), (1, 20), (2, 21), (21, 21), (31, 18)) v(team, coach);
-- Managers and physios.
insert into public.team_members (team_id, profile_id, team_role)
select pg_temp.lc_team(v.team), pg_temp.lc(v.who), v.r::public.team_role
from (values (11, 22, 'manager'), (21, 23, 'manager'), (31, 24, 'manager'), (2, 25, 'manager'),
             (2, 27, 'physio'), (3, 27, 'physio'), (4, 27, 'physio')) v(team, who, r);

-- Coach 21 was stood down after being placed (placing a stood-down member is refused).
update public.profiles set stood_down_at = now() - interval '3 days' where id = pg_temp.lc(21);

-- Families. Children are grouped into families of one to three; each family
-- has a guardian from 138-187, and every other family a second guardian:
-- a staff member (1, 7, 18 or 22) or one of 188-192, some of them in two
-- families.
create temp table lc_families as
select n, ceil(row_number() over (order by n) * 5 / 7.0)::int as family
from lc_people where n between 28 and 97;
-- Two families of three.
update lc_families set family = 8 where n = 39;
update lc_families set family = 21 where n = 58;
create temp table lc_guardian_of (guardian int, child int);
insert into lc_guardian_of
select 137 + f.family, f.n from lc_families f
union
select g.second, f.n
from lc_families f
join (select 1 + 2 * (i - 1) as family, (array[1, 7, 18, 22, 188, 189, 190, 191, 192])[1 + (i - 1) % 9] as second
      from generate_series(1, 18) i) g
  on g.family = f.family;
insert into public.guardianships (guardian_id, athlete_id)
select pg_temp.lc(guardian), pg_temp.lc(child) from lc_guardian_of;
-- The guardian of member 29 (18 today) stays linked: the link stops counting
-- at 18 without being removed.

-- Consents for the children: most families have given both, some only the
-- check-ins one, some neither yet.
insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
select pg_temp.lc(f.n), k.kind::public.consent_kind, pg_temp.lc(min(g.guardian)), 'Guardian', '1'
from lc_families f
join lc_guardian_of g on g.child = f.n
cross join (values ('data'), ('health')) k(kind)
where f.family % 7 <> 0 and not (k.kind = 'health' and f.family % 5 = 3)
group by f.n, k.kind;

-- Two weeks of check-ins from most athletes, an injury for one in five and
-- a register for every team's last six trainings.
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood)
select pg_temp.lc(a.n), current_date - d, 1 + floor(random() * 5), 1 + floor(random() * 5), 1 + floor(random() * 5), 1 + floor(random() * 5)
from lc_athlete_squad a, generate_series(0, 13) d
where random() < 0.7;
insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
select pg_temp.lc(a.n), pg_temp.lc(a.n), (array['Ankle', 'Knee', 'Finger', 'Shoulder'])[1 + a.n % 4],
  'Sample injury', current_date - (a.n % 20), p.full_name
from lc_athlete_squad a join public.profiles p on p.id = pg_temp.lc(a.n)
where a.n % 5 = 0;
insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
select i.id, i.athlete_id, i.athlete_name, 'reported', 'Reported'
from public.injuries i where i.athlete_id::text like '00000000-0000-0000-0001-%';
insert into public.attendance_sessions (id, team_id, team_name, name, held_at, taken_by, taken_by_name)
select gen_random_uuid(), t.id, t.name, 'Training', now() - (w * 7 || ' days')::interval,
  pg_temp.lc(8), 'Head coach'
from public.teams t, generate_series(1, 6) w
where t.id::text like '00000000-0000-0000-0002-%' and t.kind = 'team';
insert into public.attendance_marks (session_id, profile_id, present)
select s.id, tm.profile_id, random() < 0.85
from public.attendance_sessions s
join public.team_members tm on tm.team_id = s.team_id and tm.team_role = 'athlete'
where s.team_id::text like '00000000-0000-0000-0002-%';

-- Messages, sent through the app's own function: each squad's head coach
-- messages the squad, each Open team's head coach the team, and an admin the
-- whole club, so the recipients and guardians' copies are worked out as in
-- the app.
do $$
declare s int;
begin
  for s in 1..3 loop
    perform set_config('request.jwt.claim.sub', pg_temp.lc(7 + s * 2 - 1)::text, false);
    perform public.send_group_message('Training moves to 5pm this week', 'group', null, pg_temp.lc_team(s));
  end loop;
  perform set_config('request.jwt.claim.sub', pg_temp.lc(8)::text, false);
  perform public.send_group_message('Bring your bibs on Saturday', 'group', null, pg_temp.lc_team(11));
  perform set_config('request.jwt.claim.sub', pg_temp.lc(1)::text, false);
  perform public.send_group_message('AGM is on the 30th', 'club');
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
