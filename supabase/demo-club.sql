-- The DEMO club's sample people, on the TEST Supabase project only. Never run
-- this on the live database: it runs only where test-data.sql's sample people are.
--
-- Store reviewers and our own testers sign in to the club code DEMO with an
-- email and password (docs/environments.md, "The demo club"). This script
-- puts back every demo account with its role, squads and teams, guardian
-- link and the pilot, so the role scripts start the same every time. Run it
-- with the "Reset demo club" workflow, which passes the shared password from
-- the DEMO_PASSWORD secret:
--
--   psql -v ON_ERROR_STOP=1 -v demo_password="$DEMO_PASSWORD" -f supabase/demo-club.sql
--
-- The password is never written in the repo. Every account is
-- <name>@demo.firstpass.example, a domain nobody can receive mail at. The
-- list matches thunder/pilot/demo-accounts.md and docs/store/review-notes.md.
--
-- What it changes, all on the test project:
--   - the 20 demo accounts: made again if deleted, password reset, and their
--     roles, checks, dates of birth, squads, teams and guardian links set back;
--   - messages sent by demo accounts are removed, so read counts start at 0;
--   - the 20 & Under Squad and team and the Open Squad and Open A team of the
--     newest season, made if missing;
--   - the pilot: the 20 & Under team is the only pilot team, Messages and
--     Calendar are on for pilot teams only, and every other feature is off;
--   - one upcoming sample PlayHQ game each for 20 & Under and Open A.
-- Calendars aren't touched: their links are Outlook calendars an admin adds.
--
-- It stops without changing anything unless the database is positively the
-- test project, which holds test-data.sql's sample people (approved
-- @example.com profiles; the live club never has them, however few members it
-- has), or if the password is missing or short. Real people signing in to the
-- test project don't stop it.

\set ON_ERROR_STOP on
-- Kept in a setting for this session only, so it never appears in a query
-- the script prints.
select set_config('demo.password', :'demo_password', false) is not null as password_set \gset

begin;

do $$
declare
  v_password text := current_setting('demo.password', true);
  v_season int;
  v_u20_squad uuid;
  v_u20 uuid;
  v_open_squad uuid;
  v_open uuid;
  v_ids uuid[];
  v_settings public.safeguarding_settings;
begin
  if v_password is null or length(v_password) < 12 then
    raise exception 'Set the demo password (DEMO_PASSWORD), at least 12 characters.';
  end if;

  if not exists (
    select 1 from public.profiles
    where status = 'approved' and email like '%@example.com'
  ) then
    raise exception 'This database has none of the sample people from supabase/test-data.sql. Run supabase/test-data.sql on the test project first; never run this on the live database.';
  end if;

  -- The accounts. Ages are on the day this runs; checks are current unless
  -- marked expired.
  create temporary table demo_accounts on commit drop as
  select ('de000000-0000-4000-8000-0000000000' || lpad(v.n::text, 2, '0'))::uuid as id,
    v.local || '@demo.firstpass.example' as email,
    v.name, v.role::public.app_role as role, v.extra::public.app_role[] as extra_roles,
    v.title, v.head_physio, v.age, v.wwcc, v.approved
  from (values
    (1, 'admin', 'Avery Admin', 'admin', '{}', null, false, 45, 'current', true),
    (2, 'committee', 'Cameron Committee', 'committee', '{}', 'Secretary', false, 52, 'current', true),
    (3, 'headcoach', 'Harley Headcoach', 'coach', '{}', null, false, 38, 'current', true),
    (4, 'asstcoach', 'Ari Assistant', 'coach', '{}', null, false, 29, 'current', true),
    (5, 'manager', 'Max Manager', 'manager', '{}', null, false, 41, 'current', true),
    (6, 'physio', 'Parker Physio', 'physio', '{}', null, false, 33, 'current', true),
    (7, 'headphysio', 'Hayden Headphysio', 'physio', '{}', null, true, 47, 'current', true),
    (8, 'athlete19', 'Nineteen Athlete', 'athlete', '{}', null, false, 19, null, true),
    (9, 'athlete16', 'Sixteen Athlete', 'athlete', '{}', null, false, 16, null, true),
    (10, 'locked15', 'Fifteen Locked', 'athlete', '{}', null, false, 15, null, true),
    (11, 'guardian', 'Gale Guardian', 'guardian', '{}', null, false, 46, null, true),
    (12, 'openathlete', 'Oakley Openathlete', 'athlete', '{}', null, false, 22, null, true),
    (13, 'lapsedcoach', 'Lane Lapsedcoach', 'coach', '{}', null, false, 35, 'expired', true),
    (14, 'coachparent', 'Charlie Coachparent', 'coach', '{guardian}', null, false, 44, 'current', true),
    (15, 'guest', 'Gray Guest', 'guest', '{}', null, false, 30, null, true),
    (16, 'helper', 'Hollis Helper', 'volunteer', '{}', null, false, 40, 'current', true),
    (17, 'stats', 'Sam Stats', 'statistician', '{}', null, false, 27, 'current', true),
    (18, 'studio', 'Sidney Studio', 'studio', '{}', null, false, 31, null, true),
    (19, 'newcomer', 'Nico Newcomer', 'guest', '{}', null, false, 21, null, false),
    (20, 'newparent', 'Noel Newparent', 'guest', '{}', null, false, 43, null, false)
  ) as v (n, local, name, role, extra, title, head_physio, age, wwcc, approved);

  select array_agg(id) into v_ids from demo_accounts;

  -- Someone could have signed up with a demo address through the API while
  -- the Email provider is on; that account goes, so the address is ours.
  delete from auth.users u
  using demo_accounts d
  where u.email = d.email and u.id <> d.id;

  -- Sign-in accounts, made again if a reviewer deleted one. The empty token
  -- columns are what Supabase's own sign-up writes; it can't read nulls.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', d.id, 'authenticated', 'authenticated', d.email,
    extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', d.name), now(), now(), '', '', '', ''
  from demo_accounts d
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select d.id::text, d.id,
    jsonb_build_object('sub', d.id::text, 'email', d.email, 'email_verified', true),
    'email', now(), now(), now()
  from demo_accounts d
  on conflict (provider_id, provider) do update set identity_data = excluded.identity_data, updated_at = now();

  -- Profiles are made by the sign-up trigger. Set each one back.
  update public.profiles p
  set full_name = d.name,
      preferred_name = null,
      role = d.role,
      extra_roles = d.extra_roles,
      status = case when d.approved then 'approved' else 'pending' end::public.member_status,
      requested_role = null,
      requested_team_id = null,
      join_requested_at = null,
      rejection_reason = null,
      rejected_at = null,
      verified_at = case when d.approved then now() end,
      date_of_birth = (current_date - make_interval(years => d.age) - interval '30 days')::date,
      declared_date_of_birth = null,
      under_17 = d.age < 18,
      title = d.title,
      head_physio = d.head_physio,
      stood_down_at = null,
      wwcc_number = case when d.wwcc is not null then 'WWC9' || right(d.id::text, 6) end,
      wwcc_expires_on = case d.wwcc when 'current' then current_date + 400 when 'expired' then current_date - 1 end,
      wwcc_exempt_reason = null,
      volunteer_task = case when d.role = 'volunteer' then 'Carnival' end,
      volunteer_from = case when d.role = 'volunteer' then current_date end,
      volunteer_until = case when d.role = 'volunteer' then current_date + 7 end,
      volunteer_screening = case when d.role = 'volunteer' then 'card' end
  from demo_accounts d
  where p.id = d.id;

  if (select count(*) from public.profiles where id = any (v_ids)) <> 20 then
    raise exception 'Not every demo account has a profile. Check the sign-up trigger.';
  end if;

  -- The newest season's squads and teams, made if missing.
  select coalesce(max(season), extract(year from now())::int) into v_season
  from public.teams where kind = 'squad' and not archived;

  insert into public.teams (name, kind, season, sort_order)
  values ('20 & Under Squad', 'squad', v_season, 40), ('Open Squad', 'squad', v_season, 50)
  on conflict (season, name) do nothing;
  select id into v_u20_squad from public.teams where season = v_season and name = '20 & Under Squad';
  select id into v_open_squad from public.teams where season = v_season and name = 'Open Squad';

  insert into public.teams (name, kind, season, squad_id, sort_order)
  values ('20 & Under', 'team', v_season, v_u20_squad, 41), ('Open A', 'team', v_season, v_open_squad, 51)
  on conflict (season, name) do nothing;
  select id into v_u20 from public.teams where season = v_season and name = '20 & Under';
  select id into v_open from public.teams where season = v_season and name = 'Open A';

  -- Places in squads and teams, guardians in their child's.
  delete from public.team_members where profile_id = any (v_ids);
  insert into public.team_members (team_id, profile_id, team_role, coach_title)
  select g.team_id, d.id, g.team_role::public.team_role, g.title::public.coach_title
  from (values
    ('headcoach', v_u20_squad, 'coach', 'head_coach'),
    ('headcoach', v_u20, 'coach', 'head_coach'),
    ('asstcoach', v_u20_squad, 'coach', 'assistant_coach'),
    ('asstcoach', v_u20, 'coach', 'assistant_coach'),
    ('manager', v_u20_squad, 'manager', null),
    ('manager', v_u20, 'manager', null),
    ('physio', v_u20, 'physio', null),
    ('athlete19', v_u20_squad, 'athlete', null),
    ('athlete19', v_u20, 'athlete', null),
    ('athlete16', v_u20_squad, 'athlete', null),
    ('athlete16', v_u20, 'athlete', null),
    ('locked15', v_u20_squad, 'athlete', null),
    ('locked15', v_u20, 'athlete', null),
    ('guardian', v_u20_squad, 'guardian', null),
    ('guardian', v_u20, 'guardian', null),
    ('openathlete', v_open_squad, 'athlete', null),
    ('openathlete', v_open, 'athlete', null),
    ('lapsedcoach', v_u20, 'coach', 'assistant_coach'),
    ('coachparent', v_open_squad, 'coach', 'assistant_coach'),
    ('coachparent', v_open, 'coach', 'assistant_coach'),
    ('coachparent', v_u20_squad, 'guardian', null),
    ('coachparent', v_u20, 'guardian', null)
  ) as g (local, team_id, team_role, title)
  join demo_accounts d on d.email = g.local || '@demo.firstpass.example';

  -- athlete16 has two verified guardians; locked15 has none, so a fresh link
  -- code is waiting for their parent.
  delete from public.guardianships where guardian_id = any (v_ids) or athlete_id = any (v_ids);
  delete from public.guardian_link_requests where guardian_id = any (v_ids) or athlete_id = any (v_ids);
  insert into public.guardianships (guardian_id, athlete_id)
  values ('de000000-0000-4000-8000-000000000011', 'de000000-0000-4000-8000-000000000009'),
         ('de000000-0000-4000-8000-000000000014', 'de000000-0000-4000-8000-000000000009');
  perform public.issue_link_code('de000000-0000-4000-8000-000000000010');

  -- The helper has accepted the club's policies.
  select * into v_settings from public.safeguarding_settings where id;
  insert into public.policy_acknowledgements (
    profile_id, policy_version, code_of_conduct_url, safeguarding_policy_url, statement, member_name
  )
  values (
    'de000000-0000-4000-8000-000000000016', coalesce(v_settings.policy_version, '1'),
    v_settings.code_of_conduct_url, v_settings.policy_url, public.policy_statement(), 'Hollis Helper'
  )
  on conflict (profile_id, policy_version) do nothing;

  -- No messages from demo accounts, so read counts start at zero.
  delete from public.messages where sender_id = any (v_ids);

  -- The pilot: the 20 & Under team only, with Messages and Calendar.
  update public.teams set pilot = false where pilot and id <> v_u20;
  update public.teams set pilot = true where id = v_u20;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set features = '{"messages": true, "calendar": true, "checkIns": false, "trainingLoad": false,
        "injuries": false, "attendance": false, "sessionPlans": false, "surveys": false,
        "captainPolls": false, "awards": false, "goals": false, "integrity": false, "kpis": false,
        "registers": false}'::jsonb,
      pilot_features = '{"messages": true, "calendar": true}'::jsonb
  where id;

  -- One upcoming sample PlayHQ game for each team, at 10am Perth time.
  insert into public.fixtures as f (
    playhq_game_id, playhq_team_id, team_id, team_name, opponent, round_name, grade_name,
    starts_at, venue, court, is_home
  )
  values
    ('demo-game-u20', 'demo-20-under', v_u20, '20 & Under', 'Swan Districts', 'Round 5',
      'Demo competition', ((current_date + 3) + time '10:00') at time zone 'Australia/Perth',
      'Matthews Netball Centre', 'Court 2', true),
    ('demo-game-open', 'demo-open-a', v_open, 'Open A', 'Hawks', 'Round 5',
      'Demo competition', ((current_date + 5) + time '10:00') at time zone 'Australia/Perth',
      'Matthews Netball Centre', 'Court 4', false)
  on conflict (playhq_game_id, playhq_team_id) do update set
    team_id = excluded.team_id, starts_at = excluded.starts_at;
end;
$$;

commit;

select set_config('demo.password', '', false) is not null as password_cleared \gset
\echo The demo club is reset: 20 accounts, the 20 & Under pilot, Messages and Calendar on.
