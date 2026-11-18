-- Sample members for the TEST Supabase project. Never run this on the live
-- database.
--
-- Run it in the test project's SQL Editor after you have signed in to the app
-- once with your own Google account. It:
--   - makes everyone who has signed in with a real account an approved admin,
--     so you can use every screen;
--   - adds sample people (all @example.com, so nobody real is emailed) in the
--     current season's squads, with a team named from the Open Squad, an
--     under-18 athlete with a guardian, and someone waiting for approval;
--   - adds the admins as assistant coaches of the Open Squad and its Open A
--     team, and sample PlayHQ games for Open A (the next one in 3 days, 12
--     played, a bye) with athletes' goals, reflections, coach comments and
--     team goals. PlayHQ games belong to teams, not squads.
--
-- To try game goals as an athlete, sign in with a second Google account,
-- ask to join as an athlete, and approve them into the Open Squad and the
-- Open A team. Accounts
-- that are already approved keep their role when you run this again.
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
  where coalesce(email, '') not like '%@example.com'
    and coalesce(email, '') not like '%@demo.firstpass.example';
  if v_real > 3 then
    raise exception 'This database has % real accounts, so it looks like the live club. Run this on the test project only.', v_real;
  end if;

  -- Real accounts become admins, except ones an admin has already approved
  -- with another role (such as a second account for testing as an athlete).
  update public.profiles
  set role = 'admin', status = 'approved'
  where coalesce(email, '') not like '%@example.com'
    and coalesce(email, '') not like '%@demo.firstpass.example'
    and not (status = 'approved' and role <> 'admin');

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

  -- Admins coach the Open Squad and Open A too, so they can try the coach screens.
  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select g.id, p.id, 'coach', 'assistant_coach'
  from public.profiles p
  cross join (values (v_open), (v_team)) as g (id)
  where coalesce(p.email, '') not like '%@example.com' and p.role = 'admin' and p.status = 'approved'
  on conflict (team_id, profile_id) do nothing;

  -- Sample PlayHQ games for Open A, at 10am Perth time: the next one in 3
  -- days, a bye, and 12 played ones, a week apart. Running this again moves
  -- them so there's always a game coming up, and moves games an earlier run
  -- put on the Open Squad (PlayHQ games belong to teams).
  insert into public.fixtures as f (
    playhq_game_id, playhq_team_id, team_id, team_name, opponent, round_name, grade_name,
    starts_at, venue, court, is_home
  )
  select
    'test-game-' || g.n, 'test-open-squad', v_team, 'Open A',
    case when g.n = 1 then null else (array['Swan Districts', 'Hawks', 'Kalamunda', 'Rockingham',
      'Fremantle', 'Joondalup', 'Perth', 'Mandurah', 'Bunbury', 'Midland', 'Armadale', 'Wanneroo',
      'Cockburn'])[greatest(g.n, 1)] end,
    case when g.n = 0 then 'Round 13' when g.n = 1 then 'Round 14' else 'Round ' || (14 - g.n) end,
    'Test competition',
    ((current_date + g.days) + time '10:00') at time zone 'Australia/Perth',
    'Matthews Netball Centre', 'Court ' || (g.n % 6 + 1), g.n % 2 = 0
  from (
    select 0 as n, 3 as days
    union all select 1, 10
    union all select n, -4 - (n - 2) * 7 from generate_series(2, 13) n
  ) g
  on conflict (playhq_game_id, playhq_team_id) do update set
    team_id = excluded.team_id, team_name = excluded.team_name, opponent = excluded.opponent, round_name = excluded.round_name,
    starts_at = excluded.starts_at;

  -- Goals, once the game goals migration is in.
  if to_regclass('public.game_goals') is not null then
    -- Next game: two athletes have set goals, and the coach a team goal.
    insert into public.game_goals (id, athlete_id, fixture_id, body, set_by, set_by_name, set_by_coach)
    select v.id::uuid, a.id, f.id, v.body, s.id, s.full_name, v.coach
    from (values
      ('6a000000-0000-4000-8000-000000000001', 'alex.rivers@example.com', 'test-game-0', 'Win at least 3 centre pass receives each quarter', 'alex.rivers@example.com', false),
      ('6a000000-0000-4000-8000-000000000002', 'alex.rivers@example.com', 'test-game-0', 'Call early and hold space at the top of the circle', 'casey.coach@example.com', true),
      ('6a000000-0000-4000-8000-000000000003', 'billie.stone@example.com', 'test-game-0', 'Three intercepts', 'billie.stone@example.com', false),
      -- Last game: Alex reflected and a coach commented; Billie's reflection waits for a comment.
      ('6a000000-0000-4000-8000-000000000011', 'alex.rivers@example.com', 'test-game-2', 'No contact penalties in defence', 'alex.rivers@example.com', false),
      ('6a000000-0000-4000-8000-000000000012', 'alex.rivers@example.com', 'test-game-2', 'Shoot at 80% or better', 'alex.rivers@example.com', false),
      ('6a000000-0000-4000-8000-000000000013', 'billie.stone@example.com', 'test-game-2', 'Talk to the circle defenders before every centre pass', 'casey.coach@example.com', true),
      ('6a000000-0000-4000-8000-000000000014', 'billie.stone@example.com', 'test-game-2', 'Win the first centre pass of each quarter', 'billie.stone@example.com', false)
    ) as v (id, athlete, game, body, setter, coach)
    join public.profiles a on a.email = v.athlete
    join public.profiles s on s.email = v.setter
    join public.fixtures f on f.playhq_game_id = v.game and f.playhq_team_id = 'test-open-squad'
    on conflict (id) do nothing;

    update public.game_goals g
    set outcome = v.outcome, reflection = v.reflection, reflected_at = coalesce(g.reflected_at, now())
    from (values
      ('6a000000-0000-4000-8000-000000000011', 'achieved', 'Only one contact all game, in the first quarter.'),
      ('6a000000-0000-4000-8000-000000000012', 'partly', 'Started 9 from 10 but rushed the last quarter, 14 from 20.'),
      ('6a000000-0000-4000-8000-000000000013', 'partly', 'Remembered most of the time, forgot in the last quarter.')
    ) as v (id, outcome, reflection)
    where g.id = v.id::uuid and g.reflected_at is null;

    insert into public.game_goal_comments (id, goal_id, author_id, author_name, body)
    select '6a000000-0000-4000-8000-000000000021', '6a000000-0000-4000-8000-000000000011', c.id, c.full_name,
      'Great discipline. You stayed patient and let the turnovers come.'
    from public.profiles c where c.email = 'casey.coach@example.com'
    on conflict (id) do nothing;

    insert into public.team_game_goals (id, fixture_id, body, set_by, set_by_name, outcome, review, reviewed_by_name, reviewed_at)
    select v.id::uuid, f.id, v.body, c.id, c.full_name, v.outcome, v.review,
      case when v.outcome is not null then c.full_name end, case when v.outcome is not null then now() end
    from (values
      ('6a000000-0000-4000-8000-000000000031', 'test-game-0', 'Win the third quarter', null, null),
      ('6a000000-0000-4000-8000-000000000032', 'test-game-2', 'Keep them under 40 goals', 'achieved', 'Held them to 38. Great pressure through the mid-court.'),
      ('6a000000-0000-4000-8000-000000000033', 'test-game-2', 'Fewer than 10 turnovers', 'not_yet', '14 turnovers, mostly from long passes. Work on short options at training.')
    ) as v (id, game, body, outcome, review)
    join public.fixtures f on f.playhq_game_id = v.game and f.playhq_team_id = 'test-open-squad'
    cross join (select id, full_name from public.profiles where email = 'casey.coach@example.com') c
    on conflict (id) do nothing;
  end if;
end;
$$;

commit;
