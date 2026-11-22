-- Sample club (no real people) for local migration tests. Load after the
-- migrations. Fixed ids so tests can act as anyone:
--   set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000NN';

-- The club's day, as public.club_today() works it out. Defined here because
-- scripts/check-row-counts.sh loads this file before the newest migrations,
-- when public.club_today() may not exist yet.
create or replace function pg_temp.club_today() returns date language sql stable as
$$ select (now() at time zone coalesce((select s.timezone from public.club_settings s where s.id), 'Australia/Perth'))::date $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000001', 'admin1@example.test', now()),
  ('00000000-0000-0000-0000-000000000002', 'admin2@example.test', now()),
  ('00000000-0000-0000-0000-000000000011', 'coach.current@example.test', now()),
  ('00000000-0000-0000-0000-000000000012', 'coach.expired@example.test', now()),
  ('00000000-0000-0000-0000-000000000013', 'manager@example.test', now()),
  ('00000000-0000-0000-0000-000000000014', 'physio@example.test', now()),
  ('00000000-0000-0000-0000-000000000021', 'committee.expired@example.test', now()),
  ('00000000-0000-0000-0000-000000000022', 'committee.none@example.test', now()),
  ('00000000-0000-0000-0000-000000000023', 'committee.exempt@example.test', now()),
  ('00000000-0000-0000-0000-000000000031', 'athlete.minor@example.test', now()),
  ('00000000-0000-0000-0000-000000000032', 'athlete.adult@example.test', now()),
  ('00000000-0000-0000-0000-000000000041', 'guardian@example.test', now()),
  ('00000000-0000-0000-0000-000000000042', 'coach.guardian@example.test', now());

update public.profiles p set status = 'approved', full_name = v.name, role = v.role::public.app_role,
  extra_roles = v.extra::public.app_role[], wwcc_number = v.wwcc, wwcc_expires_on = v.exp,
  wwcc_exempt_reason = v.exempt, date_of_birth = v.dob, verified_at = now()
from (values
  ('00000000-0000-0000-0000-000000000001', 'Alex Admin', 'admin', '{}', 'WWC0001', pg_temp.club_today() + 400, null, null::date),
  ('00000000-0000-0000-0000-000000000002', 'Blair Admin', 'admin', '{}', null, null, null, null),
  ('00000000-0000-0000-0000-000000000011', 'Casey Coach', 'coach', '{}', 'WWC0011', pg_temp.club_today() + 400, null, null),
  ('00000000-0000-0000-0000-000000000012', 'Drew Lapsed', 'coach', '{}', 'WWC0012', pg_temp.club_today() - 1, null, null),
  ('00000000-0000-0000-0000-000000000013', 'Emery Manager', 'manager', '{}', 'WWC0013', pg_temp.club_today() + 400, null, null),
  ('00000000-0000-0000-0000-000000000014', 'Finley Physio', 'physio', '{}', 'WWC0014', pg_temp.club_today() + 400, null, null),
  ('00000000-0000-0000-0000-000000000021', 'Gale Committee', 'committee', '{}', 'WWC0021', pg_temp.club_today() - 5, null, null),
  ('00000000-0000-0000-0000-000000000022', 'Harper Committee', 'committee', '{}', null, null, null, null),
  ('00000000-0000-0000-0000-000000000023', 'Indy Treasurer', 'committee', '{}', null, null, 'Treasurer only', null),
  ('00000000-0000-0000-0000-000000000031', 'Jordan Junior', 'athlete', '{}', null, null, null, pg_temp.club_today() - interval '14 years'),
  ('00000000-0000-0000-0000-000000000032', 'Kai Senior', 'athlete', '{}', null, null, null, pg_temp.club_today() - interval '25 years'),
  ('00000000-0000-0000-0000-000000000041', 'Logan Parent', 'guardian', '{}', null, null, null, null),
  ('00000000-0000-0000-0000-000000000042', 'Morgan Coach-Parent', 'coach', '{guardian}', 'WWC0042', pg_temp.club_today() + 400, null, null)
) as v(id, name, role, extra, wwcc, exp, exempt, dob)
where p.id = v.id::uuid;

update public.profiles set under_17 = true where id = '00000000-0000-0000-0000-000000000031';

insert into public.teams (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'squad', 1);
insert into public.teams (id, name, kind, squad_id, sort_order) values
  ('00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'team', '00000000-0000-0000-0000-0000000000a1', 2);

insert into public.team_members (team_id, profile_id, team_role, coach_title, selection) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000011', 'coach', 'head_coach', null),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000011', 'coach', 'head_coach', null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000012', 'coach', 'assistant_coach', null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000013', 'manager', null, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000014', 'physio', null, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000042', 'coach', 'assistant_coach', null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000031', 'athlete', null, null),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000031', 'athlete', null, 'touring'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000032', 'athlete', null, null);

insert into public.guardianships (guardian_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000031');

insert into public.injuries (athlete_id, reported_by, body_area, description, injured_on, athlete_name)
values ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031', 'Ankle',
  'Rolled ankle at training', pg_temp.club_today() - 3, 'Jordan Junior');

insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
values ('00000000-0000-0000-0000-000000000031', pg_temp.club_today(), 4, 3, 2, 4, 'Tired after exams');
