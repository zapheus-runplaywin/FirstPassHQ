-- Push notifications for to-do items.
--
-- Every 5 minutes, pg_cron works out each member's home screen to-do list with
-- the same functions the app calls, and sends a push for anything new on it
-- through Expo's free push service (pg_net, as for join requests). Members can
-- turn this off in Your details. Nothing is sent between 8 pm and 7 am club
-- time: to-dos that are still there at 7 am go out then, in one notification.
-- Notifications can show on a locked phone, so they never carry injury
-- details or reviewers' notes: those stay in the app.
--
-- Each club has its own database, so the app tells the database which club it
-- is when it registers a phone, and every push carries that club's code. A
-- tapped notification then opens the right club.
--
-- Additive only: new tables, a new column with a default, new functions, and a
-- new version of the join request trigger function that respects the switch.

begin;

create extension if not exists pg_net;

-- The club's time zone, for "today" and quiet hours. Clubs are in Perth so far.
alter table public.club_settings
  add column if not exists timezone text not null default 'Australia/Perth';

-- Which club this phone's token was registered from (its club code).
alter table public.push_tokens add column if not exists club_code text;

-- A member's notification choices. No row means the defaults: to-dos on.
create table if not exists public.push_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  todos boolean not null default true,
  -- When the member's to-do list was first noted. To-dos already there then
  -- are never pushed, so turning notifications on doesn't send a backlog.
  baseline_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.push_settings enable row level security;

drop policy if exists "Members see their own notification settings" on public.push_settings;
create policy "Members see their own notification settings"
  on public.push_settings for select to authenticated
  using (profile_id = auth.uid());

-- The to-dos each member has already been sent (or had when they started), so
-- each one is pushed once. Keys carry a day or month where a to-do repeats.
create table if not exists public.push_todo_log (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  todo_key text not null,
  sent_at timestamptz not null default now(),
  primary key (profile_id, todo_key)
);

-- Only the scheduled job reads and writes this; no policies.
alter table public.push_todo_log enable row level security;

-- ---------------------------------------------------------------------------
-- What the app calls
-- ---------------------------------------------------------------------------

-- Saves this phone's token for the signed-in member, with the club it was
-- registered from. A phone that changes hands moves to the new member.
create or replace function public.register_push_device(
  p_token text,
  p_platform text,
  p_club text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'Not an Expo push token';
  end if;
  if p_club is not null and p_club !~ '^[A-Z0-9]{1,20}$' then
    raise exception 'Not a club code';
  end if;
  insert into public.push_tokens (token, profile_id, platform, club_code, updated_at)
  values (p_token, auth.uid(), p_platform, p_club, now())
  on conflict (token) do update
    set profile_id = excluded.profile_id,
        platform = excluded.platform,
        club_code = excluded.club_code,
        updated_at = now();
end;
$$;

revoke execute on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;

-- The signed-in member's notification choices.
create or replace function public.my_push_settings()
returns table (todos boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.todos from public.push_settings s where s.profile_id = auth.uid()),
    true
  )
  where auth.uid() is not null;
$$;

revoke execute on function public.my_push_settings() from public, anon;
grant execute on function public.my_push_settings() to authenticated;

-- Turns to-do notifications on or off for the signed-in member. Turning them
-- on starts afresh, so to-dos already on the list aren't sent all at once.
create or replace function public.set_todo_notifications(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_on is null then
    raise exception 'Choose on or off';
  end if;
  insert into public.push_settings (profile_id, todos, baseline_at, updated_at)
  values (auth.uid(), p_on, null, now())
  on conflict (profile_id) do update
    set todos = excluded.todos,
        baseline_at = case
          when excluded.todos and not public.push_settings.todos then null
          else public.push_settings.baseline_at
        end,
        updated_at = now();
end;
$$;

revoke execute on function public.set_todo_notifications(boolean) from public, anon;
grant execute on function public.set_todo_notifications(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- A member's to-do list, worked out on the server
-- ---------------------------------------------------------------------------

-- Mirrors buildTodos in src/lib/todos.ts: change both together. It calls the
-- same functions the home screen does, as the member, so it sees exactly what
-- they see. Join requests are left out: admins hear about those straight away
-- from the join request trigger.
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
    todo_key := 'concerns:' || extract(epoch from v_at)::bigint;
    title := 'Look at ' || v_n || ' new ' || case when v_n = 1 then 'concern' else 'concerns' end;
    detail := 'Refer child abuse and serious crimes to Police straight away'; href := '/concerns';
    return next;
  end if;

  -- A volunteer exemption the member hasn't accepted. Their role waits on it.
  for r in select * from public.my_volunteer_exemption() where declared_at is null loop
    todo_key := 'volunteer-declaration:' || coalesce(r.starts_on::text, '');
    title := 'Accept the exemption declaration';
    detail := 'Your club role starts once you do'; href := '/declaration';
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

  -- Absences reported or withdrawn for the coach or manager's groups. A newer
  -- change sends again.
  if coalesce((v_features ->> 'attendance')::boolean, true) and exists (
    select 1 from public.team_members tm
    where tm.profile_id = p_profile_id and tm.team_role in ('coach', 'manager')
  ) then
    select count(*)::int, max(a.changed_at) into v_n, v_at from public.absences_to_review() a;
    if v_n > 0 then
      todo_key := 'absences-to-review:' || extract(epoch from v_at)::bigint;
      title := 'Review ' || v_n || ' new or changed ' || case when v_n = 1 then 'absence' else 'absences' end;
      detail := 'Athletes in your squads and teams reported or withdrew an absence';
      href := '/attendance';
      return next;
    end if;
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
        title := 'Link guardians for ' || r.minors_without_guardian
          || case when r.minors_without_guardian = 1 then ' athlete' else ' athletes' end || ' under 18';
        detail := 'Every athlete under 18 needs a verified guardian'; href := '/admin';
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

    if exists (select 1 from public.record_retention() rr where not rr.enabled) then
      todo_key := 'records-removal-off:' || v_month;
      title := 'Old records are kept forever';
      detail := 'Switch on Remove old records in Club settings, under Keeping records';
      href := '/admin/club';
      return next;
    end if;

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

  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
end;
$$;

-- Only the scheduled job runs this: it can act as any member.
revoke execute on function public.member_todos(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The scheduled job
-- ---------------------------------------------------------------------------

-- Sends a push for each member's new to-dos. Several new ones at once go in a
-- single notification. Returns how many members were sent one.
create or replace function public.send_todo_pushes(p_now timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_tz text;
  v_hour int;
  v_member record;
  v_count int;
  v_title text;
  v_body text;
  v_href text;
  v_list jsonb;
  v_text_list text;
  v_messages jsonb := '[]'::jsonb;
  v_sent int := 0;
  v_batch jsonb;
  i int;
begin
  select coalesce(s.timezone, 'Australia/Perth') into v_tz from public.club_settings s where s.id;
  v_tz := coalesce(v_tz, 'Australia/Perth');
  v_hour := extract(hour from (p_now at time zone v_tz))::int;
  -- Quiet hours. Anything still on the list goes out at 7 am.
  if v_hour < 7 or v_hour >= 20 then
    return 0;
  end if;

  for v_member in
    select p.id, s.baseline_at
    from public.profiles p
    left join public.push_settings s on s.profile_id = p.id
    where p.status = 'approved'
      and coalesce(s.todos, true)
      and exists (select 1 from public.push_tokens t where t.profile_id = p.id)
  loop
    begin
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_list
      from public.member_todos(v_member.id, p_now) m;

      if v_member.baseline_at is null then
        -- First look at this member's list: note what's there, send nothing.
        insert into public.push_todo_log (profile_id, todo_key, sent_at)
          select v_member.id, n.todo_key, p_now
          from jsonb_to_recordset(v_list) as n (todo_key text)
          on conflict (profile_id, todo_key) do nothing;
        insert into public.push_settings (profile_id, todos, baseline_at, updated_at)
          values (v_member.id, true, p_now, p_now)
          on conflict (profile_id) do update set baseline_at = p_now;
        continue;
      end if;

      select count(*)::int, min(n.title), min(n.detail), min(n.href),
        string_agg(n.title, ' · ' order by n.title)
      into v_count, v_title, v_body, v_href, v_text_list
      from jsonb_to_recordset(v_list) as n (todo_key text, title text, detail text, href text)
      where not exists (
        select 1 from public.push_todo_log l
        where l.profile_id = v_member.id and l.todo_key = n.todo_key
      );

      if v_count > 0 then
        if v_count > 1 then
          v_title := v_count || ' new things to do';
          v_body := left(v_text_list, 300);
          v_href := '/';
        end if;

        select v_messages || coalesce(jsonb_agg(jsonb_build_object(
          'to', t.token,
          'title', v_title,
          'body', v_body,
          'data', jsonb_build_object('kind', 'todo', 'href', v_href, 'club', t.club_code),
          'sound', 'default',
          'channelId', 'todos'
        )), '[]'::jsonb)
        into v_messages
        from public.push_tokens t
        where t.profile_id = v_member.id;

        insert into public.push_todo_log (profile_id, todo_key, sent_at)
          select v_member.id, n.todo_key, p_now
          from jsonb_to_recordset(v_list) as n (todo_key text)
          on conflict (profile_id, todo_key) do nothing;
        v_sent := v_sent + 1;
      end if;
    exception when others then
      -- One member's list failing mustn't stop everyone else's.
      raise warning 'To-do push for % failed: %', v_member.id, sqlerrm;
    end;
  end loop;

  -- Expo takes up to 100 messages per request. Sent once this commits.
  i := 0;
  while i < jsonb_array_length(v_messages) loop
    select jsonb_agg(m) into v_batch
    from (
      select m from jsonb_array_elements(v_messages) with ordinality as e(m, n)
      where n > i and n <= i + 100
    ) batch;
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_batch,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
    i := i + 100;
  end loop;

  -- Keys from long ago can't come back (they carry dates or ids), so the log
  -- only needs the last few months.
  delete from public.push_todo_log where sent_at < p_now - interval '120 days';

  return v_sent;
end;
$$;

revoke execute on function public.send_todo_pushes(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Join requests respect the switch and carry the club
-- ---------------------------------------------------------------------------

create or replace function public.notify_admins_of_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', 'New request to join',
    'body', coalesce(nullif(new.full_name, ''), new.email, 'Someone')
      || ' asked to join as '
      || coalesce(initcap(new.requested_role::text), 'a member')
      || '.',
    'data', jsonb_build_object(
      'kind', 'todo', 'memberId', new.id, 'href', '/admin/' || new.id, 'club', t.club_code
    ),
    'sound', 'default',
    'channelId', 'join-requests'
  ))
  into v_messages
  from public.push_tokens t
  join public.profiles p on p.id = t.profile_id
  left join public.push_settings s on s.profile_id = p.id
  where p.status = 'approved'
    and (p.role = 'admin' or 'admin' = any (p.extra_roles))
    and p.id <> new.id
    and coalesce(s.todos, true);

  if v_messages is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_messages,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Every 5 minutes
-- ---------------------------------------------------------------------------

-- pg_cron comes with every Supabase project. Scheduling again under the same
-- name replaces the job, so this can run twice safely.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('send-todo-pushes', '*/5 * * * *', 'select public.send_todo_pushes()');
  else
    raise notice 'pg_cron is not available here, so to-do pushes are not scheduled';
  end if;
end;
$$;

commit;
