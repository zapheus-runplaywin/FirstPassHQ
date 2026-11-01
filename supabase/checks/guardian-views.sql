-- Guardian views: a read-only consistency check of a live or test database.
--
-- For every parent or guardian linked to a child under 18 it compares what the
-- rules in docs/user-guide.md section 5 say they should see with what the
-- database actually gives them, signed in as each one in turn (the API role,
-- so row level security and the app's own functions decide). Run it with
-- scripts/check-guardian-views.sh, which opens a read-only transaction: it
-- cannot change anything, and it prints only counts and member ids, never
-- names, notes or message text.
--
-- Three kinds of check:
--   1. Data: rows the app should have written for a guardian are there
--      (team placements, message and survey copies).
--   2. Child versus guardian: everything a child sees about themselves, their
--      guardian sees too (check-ins, injuries, goals, attendance, absences,
--      KPIs, session plans, surveys, messages, their teams' games and
--      calendars). Checked for verified guardians, who get the most.
--   3. Guardian screens: the guardian-only screens list each child.
-- Each check prints "OK", "GAP" (something a guardian is missing or has too
-- much of) or "INFO" (allowed by the rules today, but worth knowing), with up
-- to five examples as guardian id -> child id.
\set ON_ERROR_STOP 1
\set VERBOSITY terse
begin transaction read only;
set local client_min_messages = notice;

-- Who is linked, and how far back the history that the checks lean on goes.
do $$
declare
  r record;
begin
  select
    count(*) as links,
    count(*) filter (where public.is_minor(c.date_of_birth, c.under_17)) as minor_links,
    count(*) filter (where public.is_minor(c.date_of_birth, c.under_17) and g.status = 'approved'
                     and g.verified_at is not null) as verified_links
  into r
  from public.guardianships l
  join public.profiles g on g.id = l.guardian_id
  join public.profiles c on c.id = l.athlete_id;
  raise notice 'INFO links: % guardian links, % to children under 18, % of those to approved verified guardians',
    r.links, r.minor_links, r.verified_links;
  for r in
    select 'team and squad changes' as what, min(changed_at) as since, count(*) as n from public.group_membership_changes
    union all select 'guardian links and unlinks', min(changed_at), count(*) from public.guardianship_history
    union all select 'record views', min(created_at), count(*) from public.record_access_log
    union all select 'consents', min(given_at), count(*) from public.child_consents
    union all select 'messages', min(created_at), count(*) from public.messages
  loop
    raise notice 'INFO history: % kept since % (% rows)', r.what, coalesce(r.since::date::text, 'never'), r.n;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Data the app should have written.
-- ---------------------------------------------------------------------------
do $$
declare
  res record;
begin
  for res in
    with links as (
      select l.guardian_id, l.athlete_id, l.created_at as linked_at, g.status as guardian_status,
        'guardian' = any (public.roles_of(g.role, g.extra_roles)) as guardian_role
      from public.guardianships l
      join public.profiles g on g.id = l.guardian_id
      join public.profiles c on c.id = l.athlete_id
      where public.is_minor(c.date_of_birth, c.under_17)
    ),
    results as (
      -- An approved guardian joins every current squad and team their child
      -- is an athlete in (guide, section 5: "when an admin puts your child in
      -- a squad or team you join it"; 20261101000000).
      select 'GAP' as level, 'placed in each squad and team their child is in' as label,
        (select count(*) from links l join public.team_members m on m.profile_id = l.athlete_id and m.team_role = 'athlete'
           join public.teams t on t.id = m.team_id and not t.archived
           where l.guardian_status = 'approved' and l.guardian_role) as checked,
        array(select l.guardian_id || ' -> ' || l.athlete_id || ' (' || t.kind || ' ' || m.team_id || ')'
          from links l join public.team_members m on m.profile_id = l.athlete_id and m.team_role = 'athlete'
          join public.teams t on t.id = m.team_id and not t.archived
          where l.guardian_status = 'approved' and l.guardian_role
            and not exists (select 1 from public.team_members x where x.team_id = m.team_id and x.profile_id = l.guardian_id)
          order by 1) as missing
      union all
      -- The other way: a guardian placement with no child of theirs under 18
      -- left in the team gives them its games and calendar for nothing.
      select 'GAP', 'no guardian placement left behind',
        (select count(*) from public.team_members m where m.team_role = 'guardian'),
        array(select m.profile_id || ' (team ' || m.team_id || ')'
          from public.team_members m
          where m.team_role = 'guardian'
            and not exists (
              select 1 from public.guardianships l
              join public.profiles c on c.id = l.athlete_id
              join public.team_members a on a.team_id = m.team_id and a.profile_id = l.athlete_id and a.team_role = 'athlete'
              where l.guardian_id = m.profile_id and public.is_minor(c.date_of_birth, c.under_17))
          order by 1)
      union all
      -- Every message a child under 18 got in their own right reached each
      -- guardian who was approved and linked when it was sent.
      select 'GAP', 'copied on messages their child got',
        (select count(*) from links l join public.message_recipients r on r.profile_id = l.athlete_id and r.for_children is null
           join public.messages s on s.id = r.message_id
           where l.guardian_status = 'approved' and l.linked_at <= s.created_at),
        array(select l.guardian_id || ' -> ' || l.athlete_id || ' (message ' || s.id || ')'
          from links l join public.message_recipients r on r.profile_id = l.athlete_id and r.for_children is null
          join public.messages s on s.id = r.message_id
          join public.profiles c on c.id = l.athlete_id
          where l.guardian_status = 'approved' and l.linked_at <= s.created_at
            and (c.date_of_birth is null or c.date_of_birth > s.created_at::date - interval '18 years')
            and s.sender_id is distinct from l.guardian_id
            and not exists (select 1 from public.message_recipients x where x.message_id = s.id and x.profile_id = l.guardian_id)
          order by 1)
      union all
      select 'GAP', 'copied on messages their child sent',
        (select count(*) from links l join public.messages s on s.sender_id = l.athlete_id
           where l.guardian_status = 'approved' and l.linked_at <= s.created_at),
        array(select l.guardian_id || ' -> ' || l.athlete_id || ' (message ' || s.id || ')'
          from links l join public.messages s on s.sender_id = l.athlete_id
          where l.guardian_status = 'approved' and l.linked_at <= s.created_at
            and not exists (select 1 from public.message_recipients x where x.message_id = s.id and x.profile_id = l.guardian_id)
          order by 1)
      union all
      -- Messages sent before a guardian was linked aren't copied to them.
      select 'INFO', 'messages their child got before the guardian was linked (not copied today)',
        (select count(*) from links l join public.message_recipients r on r.profile_id = l.athlete_id and r.for_children is null
           join public.messages s on s.id = r.message_id where l.guardian_status = 'approved'),
        array(select l.guardian_id || ' -> ' || l.athlete_id || ' (message ' || s.id || ')'
          from links l join public.message_recipients r on r.profile_id = l.athlete_id and r.for_children is null
          join public.messages s on s.id = r.message_id
          where l.guardian_status = 'approved' and l.linked_at > s.created_at
            and s.created_at > now() - interval '1 year'
            and not exists (select 1 from public.message_recipients x where x.message_id = s.id and x.profile_id = l.guardian_id)
          order by 1)
      union all
      -- Surveys sent to a child: each guardian gets a copy naming them.
      select 'GAP', 'copied on surveys their child got',
        (select count(*) from links l join public.survey_recipients r on r.profile_id = l.athlete_id and r.for_children is null
           join public.surveys s on s.id = r.survey_id
           where l.guardian_status = 'approved' and l.linked_at <= s.created_at),
        array(select l.guardian_id || ' -> ' || l.athlete_id || ' (survey ' || s.id || ')'
          from links l join public.survey_recipients r on r.profile_id = l.athlete_id and r.for_children is null
          join public.surveys s on s.id = r.survey_id
          where l.guardian_status = 'approved' and l.linked_at <= s.created_at
            and s.created_by is distinct from l.guardian_id
            and not exists (select 1 from public.survey_recipients x where x.survey_id = s.id and x.profile_id = l.guardian_id)
          order by 1)
      union all
      -- An approved child under 18 with no approved, verified guardian is
      -- locked out of the app until one is linked (20261101000000), and is on
      -- the admin's to-do list.
      select 'INFO', 'approved children under 18 locked: no verified guardian linked',
        (select count(*) from public.profiles c where c.status = 'approved' and public.is_minor(c.date_of_birth, c.under_17)
           and (c.role = 'athlete' or 'athlete' = any (c.extra_roles))),
        array(select c.id::text from public.profiles c
          where c.status = 'approved' and public.is_minor(c.date_of_birth, c.under_17)
            and (c.role = 'athlete' or 'athlete' = any (c.extra_roles))
            and not exists (select 1 from public.guardianships l join public.profiles g on g.id = l.guardian_id
                            where l.athlete_id = c.id and g.status = 'approved' and g.verified_at is not null
                              and 'guardian' = any (public.roles_of(g.role, g.extra_roles)))
          order by 1)
      union all
      select 'INFO', 'linked guardians not yet verified (miss consents, medical details, record views)',
        (select count(*) from links),
        array(select l.guardian_id || ' -> ' || l.athlete_id from links l join public.profiles g on g.id = l.guardian_id
          where g.verified_at is null order by 1)
      union all
      select 'INFO', 'linked guardians not approved (see nothing for their child)',
        (select count(*) from links),
        array(select l.guardian_id || ' -> ' || l.athlete_id || ' (' || l.guardian_status || ')' from links l
          where l.guardian_status <> 'approved' order by 1)
    )
    select * from results
  loop
    raise notice '% %: % of % (%)',
      case when cardinality(res.missing) = 0 then 'OK  ' else res.level end, res.label,
      cardinality(res.missing), res.checked, coalesce(array_to_string(res.missing[1:5], '; '), '');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Child versus guardian, signed in as each.
-- ---------------------------------------------------------------------------
-- Each query lists, for the child $1 in the current squads and teams $2,
-- linked to this guardian at $3, keys of the rows the signed-in member can
-- read. Every key the child gets, their guardian should get too, squads'
-- included: guardians follow their child into squads and teams (guide,
-- section 5).
do $$
declare
  checks constant text[][] := array[
    ['check-ins', 'select id::text from public.check_ins where athlete_id = $1'],
    ['logged training sessions', 'select id::text from public.session_logs where athlete_id = $1'],
    ['injuries', 'select id::text from public.injuries where athlete_id = $1'],
    ['injury updates', 'select u.id::text from public.injury_updates u join public.injuries i on i.id = u.injury_id where i.athlete_id = $1'],
    ['game goals', 'select id::text from public.game_goals where athlete_id = $1'],
    ['past games with goals', 'select fixture_id::text from public.goal_past_games($1, 500, 0)'],
    ['team goals for their games', 'select g.id::text from public.team_game_goals g join public.fixtures f on f.id = g.fixture_id where f.team_id = any ($2)'],
    ['games of their teams', 'select f.id::text from public.fixtures f join public.teams t on t.id = f.team_id and t.kind = ''team'' where f.team_id = any ($2)'],
    ['calendars of their teams', 'select c.id::text from public.calendars c join public.teams t on t.id = c.team_id and t.kind = ''team'' where c.team_id = any ($2)'],
    ['games of their squads', 'select f.id::text from public.fixtures f join public.teams t on t.id = f.team_id and t.kind = ''squad'' where f.team_id = any ($2)'],
    ['calendars of their squads', 'select c.id::text from public.calendars c join public.teams t on t.id = c.team_id and t.kind = ''squad'' where c.team_id = any ($2)'],
    ['attendance (last 12 months)', 'select session_id::text from public.athlete_attendance($1, current_date - 365)'],
    ['absences', 'select id::text from public.my_absences($1)'],
    ['session plans', 'select id::text from public.session_plans where team_id = any ($2)'],
    ['season KPIs', 'select team_id::text from public.season_kpi_people() where profile_id = $1'],
    ['integrity training', 'select requirement_id::text from public.my_training() where profile_id = $1'],
    ['training certificates', 'select id::text from public.training_certificates where profile_id = $1'],
    ['surveys', 'select id::text from public.my_surveys() where $1::uuid is not null and $2::uuid[] is not null'],
    ['messages since they were linked', 'select id::text from public.messages where created_at >= $3 and $1::uuid is not null and $2::uuid[] is not null'],
    ['medical and emergency details', 'select ''details'' where public.medical_profile($1) is not null']
  ];
  pairs int := 0;
  checked int[] := array_fill(0, array[array_length(checks, 1)]);
  gaps int[] := array_fill(0, array[array_length(checks, 1)]);
  failures int[] := array_fill(0, array[array_length(checks, 1)]);
  examples text[] := array_fill(''::text, array[array_length(checks, 1)]);
  p record;
  i int;
  child_keys text[];
  guardian_keys text[];
  missing text[];
begin
  for p in
    select l.guardian_id, l.athlete_id, l.created_at as linked_at,
      array(select m.team_id from public.team_members m join public.teams t on t.id = m.team_id
            where m.profile_id = l.athlete_id and m.team_role = 'athlete' and not t.archived) as teams
    from public.guardianships l
    join public.profiles g on g.id = l.guardian_id
    join public.profiles c on c.id = l.athlete_id
    where public.is_minor(c.date_of_birth, c.under_17)
      and c.status = 'approved' and g.status = 'approved' and g.verified_at is not null
    order by l.guardian_id, l.athlete_id
  loop
    pairs := pairs + 1;
    for i in 1 .. array_length(checks, 1) loop
      begin
        perform set_config('request.jwt.claim.sub', p.athlete_id::text, true);
        perform set_config('request.jwt.claims', json_build_object('sub', p.athlete_id, 'role', 'authenticated')::text, true);
        set local role authenticated;
        execute 'select coalesce(array_agg(distinct k), ''{}'') from (' || checks[i][2] || ') x(k)'
          into child_keys using p.athlete_id, p.teams, p.linked_at;
        perform set_config('request.jwt.claim.sub', p.guardian_id::text, true);
        perform set_config('request.jwt.claims', json_build_object('sub', p.guardian_id, 'role', 'authenticated')::text, true);
        execute 'select coalesce(array_agg(distinct k), ''{}'') from (' || checks[i][2] || ') x(k)'
          into guardian_keys using p.athlete_id, p.teams, p.linked_at;
        reset role;
        checked[i] := checked[i] + cardinality(child_keys);
        missing := array(select unnest(child_keys) except select unnest(guardian_keys));
        if cardinality(missing) > 0 then
          gaps[i] := gaps[i] + cardinality(missing);
          if array_length(string_to_array(nullif(examples[i], ''), '; '), 1) is null
             or array_length(string_to_array(examples[i], '; '), 1) < 5 then
            examples[i] := concat_ws('; ', nullif(examples[i], ''),
              p.guardian_id || ' -> ' || p.athlete_id || ' (' || cardinality(missing) || ' missing, e.g. ' || missing[1] || ')');
          end if;
        end if;
      exception when others then
        reset role;
        failures[i] := failures[i] + 1;
        if failures[i] = 1 then
          examples[i] := concat_ws('; ', nullif(examples[i], ''),
            'error for ' || p.guardian_id || ' -> ' || p.athlete_id || ': ' || sqlerrm);
        end if;
      end;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  raise notice 'INFO child versus guardian: % verified guardian and child pairs compared', pairs;
  for i in 1 .. array_length(checks, 1) loop
    raise notice '% guardian sees their child''s %: % missing of % (%)',
      case when gaps[i] = 0 and failures[i] = 0 then 'OK  '
        else 'GAP ' end,
      checks[i][1], gaps[i], checked[i],
      case when failures[i] > 0 then failures[i] || ' errors; ' else '' end || examples[i];
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The guardian-only screens list each child.
-- ---------------------------------------------------------------------------
do $$
declare
  checks constant text[][] := array[
    ['home screen lists the child (my_athletes)', 'select exists (select 1 from public.my_athletes() where profile_id = $1)'],
    ['Consent lists the child', 'select exists (select 1 from public.my_child_consents() where athlete_id = $1)'],
    ['Who has viewed their records opens', 'select public.can_see_record_access($1)'],
    ['What''s changed opens', 'select (select count(*) from public.child_activity($1)) >= 0 and public.is_guardian_of($1)'],
    ['Check-ins opens', 'select public.can_view_check_ins($1)'],
    ['Attendance opens', 'select public.is_athlete_or_guardian($1)']
  ];
  pairs int := 0;
  gaps int[] := array_fill(0, array[array_length(checks, 1)]);
  examples text[] := array_fill(''::text, array[array_length(checks, 1)]);
  p record;
  i int;
  ok boolean;
begin
  for p in
    select l.guardian_id, l.athlete_id
    from public.guardianships l
    join public.profiles g on g.id = l.guardian_id
    join public.profiles c on c.id = l.athlete_id
    where public.is_minor(c.date_of_birth, c.under_17)
      and c.status = 'approved' and g.status = 'approved' and g.verified_at is not null
    order by 1, 2
  loop
    pairs := pairs + 1;
    for i in 1 .. array_length(checks, 1) loop
      begin
        perform set_config('request.jwt.claim.sub', p.guardian_id::text, true);
        perform set_config('request.jwt.claims', json_build_object('sub', p.guardian_id, 'role', 'authenticated')::text, true);
        set local role authenticated;
        execute checks[i][2] into ok using p.athlete_id;
        reset role;
      exception when others then
        reset role;
        ok := false;
      end;
      if not coalesce(ok, false) then
        gaps[i] := gaps[i] + 1;
        if gaps[i] <= 5 then
          examples[i] := concat_ws('; ', nullif(examples[i], ''), p.guardian_id || ' -> ' || p.athlete_id);
        end if;
      end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  for i in 1 .. array_length(checks, 1) loop
    raise notice '% %: % of % (%)',
      case when gaps[i] = 0 then 'OK  ' else 'GAP ' end, checks[i][1], gaps[i], pairs, examples[i];
  end loop;
end $$;

rollback;
