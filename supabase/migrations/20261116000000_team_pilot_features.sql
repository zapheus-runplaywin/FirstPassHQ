-- Team pilot: a feature can be on for everyone, on for pilot teams only, or
-- off (Matt, 2026-11-16: "start small and turn on features one by one";
-- the whole club is too big to pilot, a team might work).
--
-- club_settings.features keeps its meaning (on and off switches, a missing
-- feature on unless it is off by default). The new club_settings.pilot_features
-- lists the features that are on for pilot teams only, as {"injuries": true}.
-- teams.pilot marks the squads and teams in the pilot; a squad in the pilot
-- brings its teams with it.
--
-- Who is in the pilot (in_pilot()):
--   - admins and committee, always, so they can run and support it;
--   - anyone in a pilot squad or team (or a team of a pilot squad), whatever
--     their role there: coach, manager, physio, athlete;
--   - a parent or guardian linked to an athlete who is.
-- Everyone else sees a pilot-only feature as off, exactly as if an admin had
-- turned it off: off their home screen, menus and to-dos, and refused by the
-- database where the feature has its own switch check.
--
-- Nothing is dropped or rewritten: two columns with defaults, new functions,
-- and new bodies for functions that read the switches.

begin;

-- ---------------------------------------------------------------------------
-- Where the pilot is kept
-- ---------------------------------------------------------------------------

alter table public.teams
  add column if not exists pilot boolean not null default false;

alter table public.club_settings
  add column if not exists pilot_features jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'club_settings_pilot_features_object'
  ) then
    alter table public.club_settings
      add constraint club_settings_pilot_features_object
      check (jsonb_typeof(pilot_features) = 'object');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Who is in the pilot, and what their app shows
-- ---------------------------------------------------------------------------

create or replace function public.in_pilot()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    public.is_committee()
    or exists (
      select 1
      from public.team_members m
      join public.teams t on t.id = m.team_id
      left join public.teams sq on sq.id = t.squad_id
      where (t.pilot or coalesce(sq.pilot, false))
        and (
          m.profile_id = auth.uid()
          or m.profile_id in (
            select g.athlete_id from public.guardianships g where g.guardian_id = auth.uid()
          )
        )
    )
  );
$$;

revoke execute on function public.in_pilot() from public, anon;
grant execute on function public.in_pilot() to authenticated;

-- The club's switches as the signed-in member sees them: pilot-only features
-- are off for anyone outside the pilot.
create or replace function public.member_features()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when public.in_pilot() then coalesce(s.features, '{}'::jsonb)
      else coalesce(s.features, '{}'::jsonb) || coalesce((
        select jsonb_object_agg(k.key, false)
        from jsonb_each(coalesce(s.pilot_features, '{}'::jsonb)) k
        where k.value = 'true'::jsonb
      ), '{}'::jsonb)
    end
    from public.club_settings s
    where s.id
  ), '{}'::jsonb);
$$;

revoke execute on function public.member_features() from public, anon;
grant execute on function public.member_features() to authenticated;

-- Everything a signed-in member's app needs to look like the club, with the
-- features as this member sees them. Same columns as before.
create or replace function public.club_profile()
returns table (
  club_name text,
  short_name text,
  background_colour text,
  text_colour text,
  hero_colour text,
  logo_path text,
  features jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.club_name, s.short_name, s.background_colour, s.text_colour, s.hero_colour,
         s.logo_path, public.member_features(), s.updated_at
  from public.club_settings s;
$$;

revoke execute on function public.club_profile() from public, anon;
grant execute on function public.club_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Admins set up the pilot
-- ---------------------------------------------------------------------------

-- The pilot as saved: which features are pilot-only, and which squads and
-- teams are in it. Admins only.
create or replace function public.admin_pilot_settings()
returns table (pilot_features text[], pilot_team_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the pilot settings' using errcode = '42501';
  end if;
  return query
  select
    coalesce((
      select array_agg(k.key order by k.key)
      from public.club_settings s, jsonb_each(coalesce(s.pilot_features, '{}'::jsonb)) k
      where s.id and k.value = 'true'::jsonb
    ), '{}'::text[]),
    coalesce((select array_agg(t.id order by t.sort_order, t.name) from public.teams t where t.pilot),
      '{}'::uuid[]);
end;
$$;

revoke execute on function public.admin_pilot_settings() from public, anon;
grant execute on function public.admin_pilot_settings() to authenticated;

-- Saves the pilot: the features on for pilot teams only, and the squads and
-- teams in the pilot (every other one leaves it). Admins only.
create or replace function public.admin_set_pilot(p_features text[], p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the pilot' using errcode = '42501';
  end if;
  foreach v_key in array coalesce(p_features, '{}'::text[]) loop
    if v_key is null or v_key !~ '^[a-zA-Z]{1,40}$' or v_key = 'squads' then
      raise exception 'Feature % can''t be piloted', coalesce(v_key, '(blank)') using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from unnest(coalesce(p_team_ids, '{}'::uuid[])) i(id)
    where not exists (select 1 from public.teams t where t.id = i.id)
  ) then
    raise exception 'A squad or team in the pilot no longer exists' using errcode = '22023';
  end if;

  update public.club_settings
  set pilot_features = coalesce((
        select jsonb_object_agg(f, true) from unnest(p_features) f
      ), '{}'::jsonb),
      updated_at = now()
  where id;

  update public.teams
  set pilot = (id = any(coalesce(p_team_ids, '{}'::uuid[])))
  where pilot is distinct from (id = any(coalesce(p_team_ids, '{}'::uuid[])));
end;
$$;

revoke execute on function public.admin_set_pilot(text[], uuid[]) from public, anon;
grant execute on function public.admin_set_pilot(text[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Database checks of a feature's switch follow the member's view
-- ---------------------------------------------------------------------------

create or replace function public.session_plans_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.member_features() ->> 'sessionPlans')::boolean is distinct from false;
$$;

create or replace function public.surveys_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.member_features() ->> 'surveys')::boolean is distinct from false;
$$;

create or replace function public.captain_polls_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.member_features() ->> 'captainPolls')::boolean is distinct from false;
$$;

create or replace function public.load_monitoring_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.member_features() ->> 'trainingLoad')::boolean, false)
    and coalesce((public.member_features() ->> 'checkIns')::boolean, true);
$$;

-- ---------------------------------------------------------------------------
-- To-do pushes: a member outside the pilot gets none for pilot-only features
-- ---------------------------------------------------------------------------
-- Same as 20261112050000_todo_push_notifications.sql, but the switches are
-- read again once the function acts as the member.

create or replace function public.member_todos(p_profile_id uuid, p_now timestamptz default now())
returns table (todo_key text, title text, detail text, href text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_tz text;
  v_features jsonb;
  v_today date;
  v_month text;
  v_n int;
  v_text text;
  v_at timestamptz;
  r record;
begin
  select coalesce(s.timezone, 'Australia/Perth'), coalesce(s.features, '{}'::jsonb)
  into v_tz, v_features
  from public.club_settings s
  where s.id;
  v_tz := coalesce(v_tz, 'Australia/Perth');
  v_features := coalesce(v_features, '{}'::jsonb);
  v_today := (p_now at time zone v_tz)::date;
  v_month := to_char(v_today, 'YYYY-MM');

  -- Act as the member, so auth.uid() inside the functions below is them.
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);

  -- What this member's app shows: a feature on for pilot teams only is off
  -- for anyone outside them (team pilot, 2026-11-16).
  v_features := public.member_features();

  if not public.is_approved() then
    perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
    return;
  end if;

  -- A concern about a child can't wait. A newer one sends again.
  select count(*)::int, max(c.created_at)
  into v_n, v_at
  from public.concerns c
  where c.status = 'received' and public.can_handle_concern(c.id)
    and not exists (select 1 from public.concern_events e where e.concern_id = c.id);
  if v_n > 0 then
    todo_key := 'concerns:' || (extract(epoch from v_at) * 1000000)::bigint;
    title := 'Look at ' || v_n || ' new ' || case when v_n = 1 then 'concern' else 'concerns' end;
    detail := 'Refer child abuse and serious crimes to Police straight away'; href := '/concerns';
    return next;
  end if;

  -- Athletes flagged on 3 of the last 7 days, for the Child Safety Officer.
  -- Once a day while there are any, and again when another athlete is added.
  if coalesce((v_features ->> 'checkIns')::boolean, true) then
    v_n := coalesce(public.wellbeing_flag_alerts(), 0);
    if v_n > 0 then
      todo_key := 'wellbeing-flags:' || v_today || ':' || v_n;
      title := 'Look at ' || v_n || case when v_n = 1 then ' athlete' else ' athletes' end
        || ' flagged 3 times this week';
      detail := 'Low check-in scores on 3 of the last 7 days';
      href := '/concerns/wellbeing';
      return next;
    end if;

    -- Children whose training load shows a pattern, for the Child Safety
    -- Officer. Once a day while there are any, and again when the count rises.
    if coalesce((v_features ->> 'trainingLoad')::boolean, false) then
      v_n := coalesce(public.load_pattern_alerts(), 0);
      if v_n > 0 then
        todo_key := 'load-patterns:' || v_today || ':' || v_n;
        title := 'Look at ' || v_n || case when v_n = 1 then ' child’s' else ' children’s' end
          || ' training load';
        detail := 'Patterns in what they log, to look into with their coach or parent';
        href := '/concerns/load';
        return next;
      end if;
    end if;
  end if;

  -- A volunteer exemption the member hasn't accepted. Their role waits on it.
  for r in select * from public.my_volunteer_exemption() where declared_at is null loop
    todo_key := 'volunteer-declaration:' || coalesce(r.starts_on::text, '');
    title := 'Accept the exemption declaration';
    detail := 'Your club role starts once you do'; href := '/declaration';
    return next;
  end loop;

  -- A check application an admin recorded, waiting for the member's declaration.
  for r in select * from public.my_wwcc_application()
    where status = 'waiting_for_declaration' and declared_at is null loop
    todo_key := 'wwcc-application-declaration:' || r.id;
    title := 'Confirm your Working With Children Check application';
    detail := 'It counts as your check once you accept the declaration';
    href := '/wwcc-application';
    return next;
  end loop;

  -- A parent or guardian's consents for each child under 18.
  if public.has_role('guardian') then
    for r in select * from public.my_child_consents()
      where can_consent and not (data and health) loop
      todo_key := 'consent:' || r.athlete_id;
      title := 'Give consent for ' || coalesce(r.full_name, 'your child');
      detail := 'Choose who sees their check-ins and injury details';
      href := '/consent/' || r.athlete_id;
      return next;
    end loop;
  end if;

  -- The code of conduct, once a season, for the member and their children.
  for r in select * from public.my_conduct_todos() loop
    todo_key := 'conduct:' || r.profile_id || ':' || public.conduct_season();
    title := case when r.for_child
      then 'Accept the code of conduct for ' || coalesce(r.full_name, 'your child')
      else 'Accept the code of conduct' end;
    detail := case when r.for_child
      then 'Go through it with them. Every member accepts it each season.'
      else 'Every member accepts it each season' end;
    href := '/conduct/' || r.profile_id;
    return next;
  end loop;

  -- Daily check-in.
  if coalesce((v_features ->> 'checkIns')::boolean, true) then
    if public.has_role('athlete') and not exists (
      select 1 from public.check_ins c where c.athlete_id = p_profile_id and c.day = v_today
    ) then
      todo_key := 'check-in:' || v_today; title := 'Do your daily check-in';
      detail := 'Sleep, soreness, stress and mood. It takes 30 seconds.'; href := '/check-in';
      return next;
    end if;

    -- Athletes who scored low today. Squads only, when the coach has one,
    -- because a team's athletes are in its squad too.
    select coalesce(
      case when bool_or(s.team_kind = 'squad')
        then sum(s.flagged_count) filter (where s.team_kind = 'squad')
        else sum(s.flagged_count) end, 0)::int
    into v_n
    from public.check_in_summary(v_today) s;
    if v_n > 0 then
      todo_key := 'check-in-flags:' || v_today;
      title := 'Check in with ' || v_n || case when v_n = 1 then ' athlete' else ' athletes' end;
      detail := 'They scored low on today’s check-in'; href := '/check-ins';
      return next;
    end if;
  end if;

  -- Athletes the coach coaches with a training load flag nobody has talked
  -- about. Once a day while there are any.
  if coalesce((v_features ->> 'checkIns')::boolean, true)
    and coalesce((v_features ->> 'trainingLoad')::boolean, false) then
    v_n := coalesce(public.coach_load_flag_count(), 0);
    if v_n > 0 then
      todo_key := 'load-flags:' || v_today || ':' || v_n;
      title := 'Talk with ' || v_n || case when v_n = 1 then ' athlete' else ' athletes' end
        || ' about their training load';
      detail := 'A conversation starter from the sessions they log, not a diagnosis';
      href := '/check-ins/load';
      return next;
    end if;
  end if;

  -- Absences reported or withdrawn for the coach or manager's groups. A newer
  -- change sends again.
  if coalesce((v_features ->> 'attendance')::boolean, true) and exists (
    select 1 from public.team_members tm
    where tm.profile_id = p_profile_id and tm.team_role in ('coach', 'manager')
  ) then
    select count(*)::int, max(a.changed_at) into v_n, v_at from public.absences_to_review() a;
    if v_n > 0 then
      todo_key := 'absences-to-review:' || (extract(epoch from v_at) * 1000000)::bigint;
      title := 'Review ' || v_n || ' new or changed ' || case when v_n = 1 then 'absence' else 'absences' end;
      detail := 'Athletes in your squads and teams reported or withdrew an absence';
      href := '/attendance';
      return next;
    end if;
  end if;

  -- Injuries a coach, manager or physio logged for the member or their child.
  -- The body area stays in the app: notifications can show on a locked phone.
  if coalesce((v_features ->> 'injuries')::boolean, true)
    and (public.has_role('athlete') or public.has_role('guardian')) then
    for r in select * from public.my_logged_injuries() loop
      todo_key := 'injury-logged:' || r.injury_id;
      title := 'Look at the injury ' || coalesce(r.logged_by_name, 'a club member') || ' logged for '
        || case when r.athlete_id = p_profile_id then 'you' else coalesce(r.athlete_name, 'your athlete') end;
      detail := 'Logged by their ' || r.logged_by_role || '. Add the physio’s updates from there.';
      href := '/injuries/' || r.injury_id;
      return next;
    end loop;
  end if;

  -- Injury sign-offs and injuries past their expected return.
  if coalesce((v_features ->> 'injuries')::boolean, true) then
    for r in select * from public.visible_injuries() loop
      if r.waiting_for_me then
        todo_key := 'injury-sign-off:' || r.id || ':' || r.status;
        title := 'Review ' || coalesce(r.athlete_name, 'an athlete') || '’s clearance';
        detail := 'Waiting for your sign-off';
        href := '/injuries/' || r.id;
        return next;
      end if;
      if r.can_report and r.status = 'injured' and r.expected_return is not null
        and r.expected_return <= v_today then
        todo_key := 'injury-update:' || r.id || ':' || r.expected_return;
        title := 'Update ' || case when r.athlete_id = p_profile_id then 'your'
          else coalesce(r.athlete_name, 'your athlete') || '’s' end
          || ' injury';
        detail := 'Expected back ' || to_char(r.expected_return, 'FMDy FMDD Mon')
          || '. Ask for clearance or change the date.';
        href := '/injuries/' || r.id;
        return next;
      end if;
    end loop;
  end if;

  -- Game goals.
  if coalesce((v_features ->> 'goals')::boolean, true) then
    if public.has_role('athlete') then
      for r in select * from public.goal_next_game(p_profile_id) loop
        if r.goal_count = 0 and p_now < r.goals_close_at then
          todo_key := 'game-goals:' || r.fixture_id;
          title := 'Set your goals for ' || concat_ws(' v ', coalesce(r.round_name, 'Match'), r.opponent);
          detail := 'Goals close when the game starts';
          href := '/goals/game?athlete=' || p_profile_id || '&fixture=' || r.fixture_id;
          return next;
        end if;
      end loop;
      for r in select * from public.goal_past_games(p_profile_id, 1, 0) loop
        if r.reflected_count < r.goal_count and p_now - r.played_at < interval '7 days' then
          todo_key := 'game-reflection:' || r.fixture_id;
          title := 'Reflect on ' || concat_ws(' v ', coalesce(r.round_name, 'Match'), r.opponent);
          detail := 'How did your goals go?';
          href := '/goals/game?athlete=' || p_profile_id || '&fixture=' || r.fixture_id;
          return next;
        end if;
      end loop;
    end if;

    for r in select * from public.coach_team_games() loop
      if r.is_next and r.goal_count = 0 and p_now < r.goals_close_at then
        todo_key := 'team-goals:' || r.fixture_id || ':' || r.team_id;
        title := 'Set team goals for ' || r.team_name;
        detail := concat_ws(' v ', coalesce(r.round_name, 'Match'), r.opponent);
        href := '/goals/team?fixture=' || r.fixture_id;
        return next;
      end if;
    end loop;

    -- Once a day at most, however many reflections come in.
    select coalesce(sum(n), 0)::int, (array_agg(team_id order by n desc))[1]::text
    into v_n, v_text
    from (
      select b.athlete_id, max(b.reflections_to_answer) as n,
        (array_agg(b.team_id) filter (where b.reflections_to_answer > 0))[1] as team_id
      from public.goal_board() b
      group by b.athlete_id
    ) per_athlete;
    if v_n > 0 and v_text is not null then
      todo_key := 'goal-comments:' || v_today;
      title := 'Comment on ' || v_n || ' goal ' || case when v_n = 1 then 'reflection' else 'reflections' end;
      detail := 'Your athletes have said how their game went';
      href := '/team/' || v_text;
      return next;
    end if;
  end if;

  -- Award votes.
  if coalesce((v_features ->> 'awards')::boolean, true) then
    for r in select * from public.award_slots() where not voted loop
      todo_key := 'award-vote:' || r.award_id || ':' || coalesce(r.team_id::text, '')
        || ':' || coalesce(r.fixture_id::text, '') || ':' || r.preseason;
      title := 'Vote for ' || r.award_name;
      detail := coalesce(nullif(concat_ws(' · ', r.team_name,
        case when r.preseason then 'Preseason' else r.fixture_label end), ''), 'Voting is open');
      href := '/awards/vote?award=' || r.award_id || '&team=' || coalesce(r.team_id::text, '')
        || '&fixture=' || coalesce(r.fixture_id::text, '')
        || '&preseason=' || case when r.preseason then '1' else '' end;
      return next;
    end loop;
  end if;

  -- Integrity training: the member's own and their children's, and
  -- certificates for the committee to check.
  if coalesce((v_features ->> 'integrity')::boolean, true) then
    for r in select * from public.my_training() where status in ('to_do', 'sent_back') loop
      todo_key := 'training:' || r.requirement_id || ':' || r.profile_id || ':' || r.status;
      title := case when r.status = 'sent_back'
        then 'Upload ' || case when r.is_me then 'your' else coalesce(r.profile_name, 'your athlete') || '’s' end
          || ' ' || r.name || ' certificate again'
        else 'Complete ' || r.name || case when r.is_me then '' else ' for ' || coalesce(r.profile_name, 'your athlete') end
        end;
      detail := case when r.status = 'sent_back'
        then 'It was sent back with a note'
        else 'Due ' || to_char(r.due_on, 'FMDy FMDD Mon YYYY') || ' · then upload the certificate' end;
      href := '/training/submit?profile=' || r.profile_id || '&requirement=' || r.requirement_id;
      return next;
    end loop;

    if public.has_role('committee') or public.has_role('admin') then
      for r in select * from public.training_to_review() where can_review loop
        todo_key := 'training-certificate:' || r.certificate_id;
        title := 'Check ' || coalesce(r.profile_name, 'a member') || '’s ' || r.requirement_name || ' certificate';
        detail := 'Approve it, or send it back with a note';
        href := '/training/review';
        return next;
      end loop;
    end if;
  end if;

  -- Season KPI reviews to write, one per review date and group, and the
  -- member's own to confirm. Off unless the club turns KPIs on.
  if coalesce((v_features ->> 'kpis')::boolean, false) then
    for r in
      select k.point_id, k.team_id, min(k.point_name) as point_name, min(k.team_name) as team_name,
        min(k.due_on) as due_on, count(*)::int as people,
        min(k.full_name) as full_name, min(k.profile_id::text) as profile_id
      from public.kpi_review_todos() k
      where k.kind = 'write'
      group by k.point_id, k.team_id
    loop
      todo_key := 'kpi-review:' || r.point_id || ':' || r.team_id;
      title := case when r.people = 1 then 'Write ' || r.full_name || '’s KPI review'
        else 'Write ' || r.people || ' KPI reviews' end;
      detail := r.point_name || ' · ' || r.team_name || ' · '
        || case when r.due_on < v_today then 'Was due ' else 'Due ' end
        || to_char(r.due_on, 'FMDy FMDD Mon YYYY');
      href := case when r.people = 1
        then '/kpis/person?profile=' || r.profile_id || '&team=' || r.team_id else '/kpis' end;
      return next;
    end loop;
    for r in select * from public.kpi_review_todos() where kind = 'confirm' loop
      todo_key := 'kpi-confirm:' || r.point_id || ':' || r.team_id;
      title := 'Confirm your KPI review was done';
      detail := r.point_name || ' · ' || r.team_name;
      href := '/kpis/person?profile=' || r.profile_id || '&team=' || r.team_id;
      return next;
    end loop;
  end if;

  -- Medical and emergency details to add, or to check once a year, for
  -- athletes and verified parents. A new stage (missing, due soon, overdue)
  -- sends again.
  if (public.has_role('athlete') or (public.has_role('guardian') and exists (
      select 1 from public.profiles p where p.id = p_profile_id and p.verified_at is not null))) then
    for r in select * from public.my_medical_reviews() loop
      todo_key := 'medical:' || r.athlete_id || ':' || r.status;
      if r.status = 'missing' or r.due_on is null then
        title := 'Add ' || case when r.athlete_id = p_profile_id then 'your'
          else coalesce(r.athlete_name, 'your athlete') || '’s' end || ' medical and emergency details';
        detail := 'Emergency contacts, allergies, conditions and medications, for training and games';
      else
        title := 'Check ' || case when r.athlete_id = p_profile_id then 'your'
          else coalesce(r.athlete_name, 'your athlete') || '’s' end || ' medical details are still right';
        detail := 'Once a year. Due ' || to_char(r.due_on, 'FMDy FMDD Mon YYYY');
      end if;
      href := '/medical/' || r.athlete_id;
      return next;
    end loop;
  end if;

  -- Surveys and polls still to answer. A parent's copy of their child's isn't one.
  for r in select * from public.my_surveys()
    where is_open and not responded and for_child_names is null loop
    todo_key := 'survey:' || r.id;
    title := 'Answer the survey “' || r.title || '”';
    detail := case when r.everyone_answers then 'Everyone must answer. ' else '' end
      || 'Open until ' || to_char(((r.closes_at - interval '1 millisecond') at time zone v_tz)::date, 'FMDy FMDD Mon YYYY');
    href := '/surveys/' || r.id;
    return next;
  end loop;

  -- Child-safety and records follow-ups for admins, once a month while
  -- they're outstanding. Affiliation items stay on the home screen only.
  if public.is_admin() then
    for r in select * from public.admin_safety_todos() loop
      if r.minors_without_guardian > 0 then
        todo_key := 'minors-without-guardian:' || v_month;
        title := r.minors_without_guardian
          || case when r.minors_without_guardian = 1 then ' athlete' else ' athletes' end || ' under 18 locked out';
        detail := 'Their app is locked until a verified parent or guardian is linked'; href := '/admin';
        return next;
      end if;
      if r.athletes_without_date_of_birth > 0 then
        todo_key := 'no-date-of-birth:' || v_month;
        title := 'Add a date of birth for ' || r.athletes_without_date_of_birth
          || case when r.athletes_without_date_of_birth = 1 then ' athlete' else ' athletes' end;
        detail := 'Check it against PlayHQ or ID. It decides whether the under 18 rules apply.';
        href := '/admin';
        return next;
      end if;
      v_n := coalesce(r.wwcc_people, 0);
      if v_n > 0 then
        todo_key := 'wwcc:' || v_month;
        title := 'Sort out ' || v_n || case when v_n = 1
          then ' Working With Children Check' else ' Working With Children Checks' end;
        detail := concat_ws(', ',
          case when r.wwcc_missing > 0 then r.wwcc_missing || ' missing or expired' end,
          case when r.wwcc_expiring > 0 then r.wwcc_expiring || ' expiring' end,
          case when r.wwcc_to_validate > 0 then r.wwcc_to_validate || ' to validate' end,
          case when r.wwcc_to_link > 0 then r.wwcc_to_link || ' to register' end);
        href := '/admin';
        return next;
      end if;
      -- Lodged check applications to confirm as still being assessed, and
      -- ones that lapsed because nobody did.
      select count(*)::int into v_n
      from public.admin_wwcc_applications() a
      where a.ended_at is null
        and ((a.status = 'in_force' and a.check_due_on <= v_today) or a.status = 'lapsed');
      if v_n > 0 then
        todo_key := 'wwcc-applications:' || v_month;
        title := 'Confirm ' || v_n || case when v_n = 1 then ' check application is'
          else ' check applications are' end || ' still being assessed';
        detail := 'Check online, then confirm on the member’s page';
        href := '/admin';
        return next;
      end if;
      if r.notices_to_report > 0 then
        todo_key := 'notices-to-report:' || v_month;
        title := 'Tell the governing body about ' || r.notices_to_report
          || case when r.notices_to_report = 1 then ' Screening Unit notice' else ' Screening Unit notices' end;
        detail := 'In writing, then record the date on the member’s page'; href := '/admin';
        return next;
      end if;
      if r.wwc_officer_missing > 0 then
        todo_key := 'wwc-officer:' || v_month;
        title := 'Choose a WWC Registration Officer';
        detail := 'Under Safeguarding'; href := '/admin/safeguarding';
        return next;
      end if;
      if coalesce(r.child_safety_officer_missing, 0) > 0 then
        todo_key := 'child-safety-officer:' || v_month;
        title := 'Name a Child Safety Officer';
        detail := 'Nobody with a current check holds it. Under Safeguarding';
        href := '/admin/safeguarding';
        return next;
      end if;
      if coalesce(r.complaints_manager_missing, 0) > 0 then
        todo_key := 'complaints-manager:' || v_month;
        title := 'Name a Complaints Manager';
        detail := 'Nobody with a current check holds it. Under Safeguarding';
        href := '/admin/safeguarding';
        return next;
      end if;
      if r.exemptions_ending > 0 then
        todo_key := 'exemptions-ending:' || v_month;
        title := r.exemptions_ending || case when r.exemptions_ending = 1
          then ' volunteer exemption ends' else ' volunteer exemptions end' end || ' soon';
        detail := 'Within 60 days. They’ll need a Working With Children Check to keep their role.';
        href := '/admin';
        return next;
      end if;
      if r.turning_18 > 0 then
        todo_key := 'turning-18:' || v_month;
        title := r.turning_18 || case when r.turning_18 = 1 then ' athlete turns' else ' athletes turn' end
          || ' 18 this month';
        detail := 'Their guardian links end when you next save them'; href := '/admin';
        return next;
      end if;
    end loop;

    -- Clearances nobody can endorse. A different set of them sends again.
    select count(*)::int, min(u.athlete_name),
      md5(string_agg(u.injury_id::text, ',' order by u.injury_id))
    into v_n, v_text, todo_key
    from public.admin_unendorsable_clearances() u;
    if v_n > 0 then
      todo_key := 'unendorsable-clearances:' || todo_key;
      title := case when v_n = 1 then 'Nobody can endorse ' || coalesce(v_text, 'an athlete') || '’s clearance'
        else 'Nobody can endorse ' || v_n || ' clearances' end;
      detail := 'Make a physio Head Physio, or place a physio in their squad or team';
      href := '/admin';
      return next;
    end if;

    if exists (select 1 from public.record_retention() rr where not rr.enabled) then
      todo_key := 'records-removal-off:' || v_month;
      title := 'Old records are kept forever';
      detail := 'Switch on Remove old records in Club settings, under Keeping records';
      href := '/admin/club';
      return next;
    end if;

    -- The nightly removal hasn't finished for 2 days. Once a day while it's stuck.
    for r in select * from public.removal_run_status() where overdue loop
      todo_key := 'records-removal-stalled:' || v_today;
      title := case when r.last_ok_at is null then 'Old records haven’t been removed yet'
        else 'Old records haven’t been removed since '
          || to_char((r.last_ok_at at time zone v_tz)::date, 'FMDy FMDD Mon') end;
      detail := 'The nightly removal hasn’t finished for 2 days. Ask FirstPass to check it.';
      href := '/admin/club';
      return next;
    end loop;

    select count(*)::int into v_n from public.admin_inactive_members();
    if v_n > 0 then
      todo_key := 'inactive-members:' || v_month;
      title := v_n || case when v_n = 1 then ' member has' else ' members have' end
        || ' had no team or role for 2 years';
      detail := 'Delete them if they’ve left the club. Their safeguarding records stay.';
      href := '/admin';
      return next;
    end if;
  end if;

  -- Policy owners review each policy by its review date: once when it's due
  -- within 30 days, and again once it's overdue.
  if coalesce((v_features ->> 'registers')::boolean, false) then
    for r in select * from public.my_policy_reviews() loop
      todo_key := 'policy:' || r.id || ':' || r.review_on
        || case when r.review_on < v_today then ':overdue' else '' end;
      title := 'Review the ' || r.title;
      detail := case when r.review_on < v_today then 'Was due ' else 'Due ' end
        || to_char(r.review_on, 'FMDy FMDD Mon YYYY');
      href := '/registers/review?id=' || r.id;
      return next;
    end loop;

    -- Committee members and coaches declare conflicts of interest each season.
    for r in select * from public.my_conflict_declaration() where required and declared_at is null loop
      todo_key := 'conflicts:' || r.season;
      title := 'Declare any conflicts of interest';
      detail := 'Once a season, even if you have none';
      href := '/declare-conflicts';
      return next;
    end loop;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
end;
$$;


revoke execute on function public.member_todos(uuid, timestamptz) from public, anon, authenticated;

commit;
