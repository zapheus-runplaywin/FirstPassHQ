-- Sample members for the TEST Supabase project. Never run this on the live
-- database.
--
-- Run it in the test project's SQL Editor after you have signed in to the app
-- once with your own Google account. It:
--   - makes everyone who has signed in with a real account an approved admin,
--     so you can use every screen;
--   - adds sample people (all @example.com, so nobody real is emailed) in the
--     current season's squads, with a team named from the Open Squad, an
--     under-18 athlete with a guardian, and someone waiting for approval.
--
-- The sample people can't sign in; they fill the lists and rosters. Running
-- it again changes nothing.
--
-- It stops without changing anything if the database has more than three
-- real accounts, because that looks like the live club.

begin;

do $$
declare
  v_real int;
  v_season int;
  v_open uuid;
  v_team uuid;
begin
  select count(*) into v_real
  from public.profiles
  where coalesce(email, '') not like '%@example.com';
  if v_real > 3 then
    raise exception 'This database has % real accounts, so it looks like the live club. Run this on the test project only.', v_real;
  end if;

  update public.profiles
  set role = 'admin', status = 'approved'
  where coalesce(email, '') not like '%@example.com';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select
    v.id::uuid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v.email,
    jsonb_build_object('full_name', v.name)
  from (values
    ('5a000000-0000-4000-8000-000000000001', 'casey.coach@example.com', 'Casey Coach'),
    ('5a000000-0000-4000-8000-000000000002', 'ash.assistant@example.com', 'Ash Assistant'),
    ('5a000000-0000-4000-8000-000000000003', 'morgan.manager@example.com', 'Morgan Manager'),
    ('5a000000-0000-4000-8000-000000000004', 'alex.rivers@example.com', 'Alex Rivers'),
    ('5a000000-0000-4000-8000-000000000005', 'billie.stone@example.com', 'Billie Stone'),
    ('5a000000-0000-4000-8000-000000000006', 'charlie.wade@example.com', 'Charlie Wade'),
    ('5a000000-0000-4000-8000-000000000007', 'dana.lowe@example.com', 'Dana Lowe'),
    ('5a000000-0000-4000-8000-000000000008', 'eden.park@example.com', 'Eden Park'),
    ('5a000000-0000-4000-8000-000000000009', 'finn.young@example.com', 'Finn Young'),
    ('5a000000-0000-4000-8000-00000000000a', 'gina.young@example.com', 'Gina Young'),
    ('5a000000-0000-4000-8000-00000000000b', 'kai.committee@example.com', 'Kai Committee'),
    ('5a000000-0000-4000-8000-00000000000c', 'pat.physio@example.com', 'Pat Physio'),
    ('5a000000-0000-4000-8000-00000000000d', 'quinn.new@example.com', 'Quinn New')
  ) as v (id, email, name)
  on conflict (id) do nothing;

  -- Roles. Profiles are created by the sign-up trigger above.
  update public.profiles p
  set role = v.role::public.app_role,
      status = v.status::public.member_status,
      date_of_birth = v.born,
      under_17 = coalesce(v.born > current_date - interval '18 years', false),
      verified_at = case when v.role = 'guardian' then coalesce(p.verified_at, now()) end,
      wwcc_number = v.wwcc,
      wwcc_expires_on = case when v.wwcc is not null then current_date + interval '2 years' end
  from (values
    ('casey.coach@example.com', 'coach', 'approved', null::date, 'WWCC1000001'),
    ('ash.assistant@example.com', 'coach', 'approved', null, 'WWCC1000002'),
    ('morgan.manager@example.com', 'manager', 'approved', null, 'WWCC1000003'),
    ('alex.rivers@example.com', 'athlete', 'approved', date '1999-03-14', null),
    ('billie.stone@example.com', 'athlete', 'approved', date '2001-07-02', null),
    ('charlie.wade@example.com', 'athlete', 'approved', date '1997-11-23', null),
    ('dana.lowe@example.com', 'athlete', 'approved', date '2003-01-30', null),
    ('eden.park@example.com', 'athlete', 'approved', date '2000-05-19', null),
    ('finn.young@example.com', 'athlete', 'approved', (current_date - interval '15 years')::date, null),
    ('gina.young@example.com', 'guardian', 'approved', null, null),
    ('kai.committee@example.com', 'committee', 'approved', null, null),
    ('pat.physio@example.com', 'physio', 'approved', null, null),
    ('quinn.new@example.com', 'athlete', 'pending', null, null)
  ) as v (email, role, status, born, wwcc)
  where p.email = v.email;

  update public.profiles
  set requested_role = 'athlete', join_requested_at = coalesce(join_requested_at, now())
  where email = 'quinn.new@example.com';

  -- The newest season's squads.
  select max(season) into v_season from public.teams where kind = 'squad' and not archived;
  select id into v_open from public.teams
  where season = v_season and kind = 'squad' and name = 'Open Squad';
  if v_open is null then
    select id into v_open from public.teams
    where season = v_season and kind = 'squad' and not archived
    order by sort_order limit 1;
  end if;
  if v_open is null then
    raise exception 'There are no squads this season. Add one in Squads and teams first.';
  end if;

  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select v_open, p.id, p.role::text::public.team_role,
    case p.email
      when 'casey.coach@example.com' then 'head_coach'::public.coach_title
      when 'ash.assistant@example.com' then 'assistant_coach'::public.coach_title
    end
  from public.profiles p
  where p.email in (
    'casey.coach@example.com', 'ash.assistant@example.com', 'morgan.manager@example.com',
    'alex.rivers@example.com', 'billie.stone@example.com', 'charlie.wade@example.com',
    'dana.lowe@example.com', 'eden.park@example.com'
  )
  on conflict (team_id, profile_id) do nothing;

  -- An under-18 athlete and their verified guardian, in the youngest squad there is.
  insert into public.team_members (team_id, profile_id, team_role)
  select s.id, p.id, p.role::text::public.team_role
  from public.profiles p
  cross join lateral (
    select id from public.teams
    where season = v_season and kind = 'squad' and not archived
    order by (name = '17 & Under Squad') desc, sort_order desc
    limit 1
  ) s
  where p.email in ('finn.young@example.com', 'gina.young@example.com')
  on conflict (team_id, profile_id) do nothing;

  insert into public.guardianships (guardian_id, athlete_id)
  select g.id, a.id
  from public.profiles g, public.profiles a
  where g.email = 'gina.young@example.com' and a.email = 'finn.young@example.com'
  on conflict do nothing;

  -- A team named from the Open Squad: touring athletes and a training partner.
  insert into public.teams (name, sort_order, kind, season, squad_id)
  values ('Open A', 10, 'team', v_season, v_open)
  on conflict (season, name) do nothing;
  select id into v_team from public.teams where season = v_season and name = 'Open A';

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select v_team, p.id, p.role::text::public.team_role,
    case when p.role = 'coach' then 'head_coach'::public.coach_title end,
    case
      when p.role <> 'athlete' then null
      when p.email = 'dana.lowe@example.com' then 'training_partner'::public.team_selection
      else 'touring'::public.team_selection
    end
  from public.profiles p
  where p.email in (
    'casey.coach@example.com', 'alex.rivers@example.com', 'billie.stone@example.com',
    'charlie.wade@example.com', 'dana.lowe@example.com'
  )
  on conflict (team_id, profile_id) do nothing;
end;
$$;

commit;
