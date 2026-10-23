-- Legal hold and longer keep periods (customer review C7, Matt, 23 October
-- 2026).
--
-- 1. Legal hold. Nothing about a member named in a concern (the concern's
--    "Who it's about") is removed by the nightly clean-up: their check-ins,
--    game goals and season KPIs, attendance (a session they were marked at
--    stays whole), absences, training certificates and their files, the text
--    of messages they sent or received, who viewed their records and what
--    they viewed, their injuries and injury documents, their safeguarding
--    records, awards they voted in or were voted for in, their named survey
--    answers, or their account while it waits for approval. Concerns are never removed, so the hold
--    lasts as long as the member's record does. Their squad and team places
--    and roles are never removed by the clean-up anyway.
-- 2. Safeguarding records can also be kept 45 years (the Royal Commission's
--    recommendation 8.1 for records about child sexual abuse) or for good.
-- 3. Attendance can also be kept 10 or 15 years.
--
-- The recommended periods don't change. The clean-up still only runs once an
-- admin has switched on "Remove old records". This migration changes no rows
-- and adds no tables: it adds one function and replaces others so that they
-- remove less, never more.

begin;

-- ---------------------------------------------------------------------------
-- 1. Who is on hold
-- ---------------------------------------------------------------------------

-- True when a concern names this member as who it's about. Closed to the app.
create or replace function public.on_legal_hold(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and exists (
    select 1 from public.concerns c where c.about_member_id = p_profile_id
  );
$$;

revoke execute on function public.on_legal_hold(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Longer choices
-- ---------------------------------------------------------------------------

-- As before, with attendance also kept 10 or 15 years.
create or replace function public.admin_set_record_retention(
  p_enabled boolean,
  p_check_ins_months integer,
  p_goals_months integer,
  p_messages_months integer,
  p_attendance_months integer,
  p_certificates_months integer,
  p_access_log_months integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change how long records are kept';
  end if;
  if p_enabled is null
     or p_check_ins_months is null or p_goals_months is null or p_messages_months is null
     or p_attendance_months is null or p_certificates_months is null or p_access_log_months is null then
    raise exception 'Choose a period for every kind of record';
  end if;
  select * into s from public.club_settings where id;
  if not public.retention_choice_ok(p_check_ins_months, array[3, 6, 12, 24], s.retention_check_ins_months) then
    raise exception 'Daily check-ins can be kept 3 or 6 months, or 1 or 2 years';
  end if;
  if not public.retention_choice_ok(p_goals_months, array[12, 24, 36, 48, 60], s.retention_goals_months)
     or not public.retention_choice_ok(p_certificates_months, array[12, 24, 36, 48, 60], s.retention_certificates_months) then
    raise exception 'Game goals and training certificates can be kept 1 to 5 years';
  end if;
  if not public.retention_choice_ok(p_attendance_months, array[12, 24, 36, 48, 60, 120, 180], s.retention_attendance_months) then
    raise exception 'Attendance can be kept 1 to 5, 10 or 15 years';
  end if;
  if not public.retention_choice_ok(p_messages_months, array[12, 24, 36, 60, 84], s.retention_messages_months) then
    raise exception 'Message text can be kept 1, 2, 3, 5 or 7 years';
  end if;
  if not public.retention_choice_ok(p_access_log_months, array[36, 60, 84, 120, 180], s.retention_access_log_months) then
    raise exception 'Who viewed a child''s records can be kept 3, 5, 7, 10 or 15 years';
  end if;
  if p_messages_months > coalesce(s.retention_child_messages_months, 84) then
    raise exception 'Messages involving a child must be kept at least as long as other messages';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_enabled = p_enabled,
      retention_check_ins_months = p_check_ins_months,
      retention_goals_months = p_goals_months,
      retention_messages_months = p_messages_months,
      retention_attendance_months = p_attendance_months,
      retention_certificates_months = p_certificates_months,
      retention_access_log_months = p_access_log_months,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_record_retention(boolean, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_set_record_retention(boolean, integer, integer, integer, integer, integer, integer) to authenticated;

-- As before, with safeguarding records also kept 45 years or for good (0).
create or replace function public.admin_set_more_record_retention(
  p_injuries_months integer,
  p_safeguarding_months integer,
  p_award_votes_months integer,
  p_awards_months integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change how long records are kept';
  end if;
  select * into s from public.club_settings where id;
  if not public.retention_choice_ok(p_injuries_months, array[36, 60, 84, 120], s.retention_injuries_months) then
    raise exception 'Cleared injuries can be kept 3, 5, 7 or 10 years';
  end if;
  if not public.retention_choice_ok(p_safeguarding_months, array[84, 120, 180, 240, 360, 540, 0], s.retention_safeguarding_months) then
    raise exception 'Safeguarding records can be kept 7, 10, 15, 20, 30 or 45 years, or for good';
  end if;
  if not public.retention_choice_ok(p_award_votes_months, array[12, 24, 36, 60], s.retention_award_votes_months) then
    raise exception 'Who voted for whom can be kept 1, 2, 3 or 5 years';
  end if;
  if not public.retention_choice_ok(p_awards_months, array[36, 60, 120, 240, 0], s.retention_awards_months) then
    raise exception 'Awards and their results can be kept 3, 5, 10 or 20 years, or for good';
  end if;
  if p_awards_months <> 0 and p_awards_months < p_award_votes_months then
    raise exception 'Awards must be kept at least as long as who voted for whom';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_injuries_months = p_injuries_months,
      retention_safeguarding_months = p_safeguarding_months,
      retention_award_votes_months = p_award_votes_months,
      retention_awards_months = p_awards_months,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_more_record_retention(integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_set_more_record_retention(integer, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Files: injury documents and training certificates
-- ---------------------------------------------------------------------------

-- As before, and never for an athlete on hold.
create or replace function public.injury_documents_expired(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_injury.status = 'cleared'
      and p_injury.cleared_at is not null
      and p_injury.cleared_at < now() - make_interval(days => s.retention_injury_documents_days)
      and not public.on_legal_hold(p_injury.athlete_id)
    from public.club_settings s
    where s.id and s.retention_enabled
  ), false);
$$;

-- As before, and never for an athlete on hold.
create or replace function public.departed_injury_expired(p_injury public.injuries)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_injury.athlete_left_at is not null
      and greatest(p_injury.athlete_left_at,
            case when p_injury.status = 'cleared' then p_injury.cleared_at end)
          < now() - make_interval(months => s.retention_injuries_months)
      and not public.on_legal_hold(p_injury.athlete_id)
    from public.club_settings s
    where s.id and s.retention_enabled
  ), false);
$$;

revoke execute on function public.departed_injury_expired(public.injuries) from public, anon, authenticated;

-- As before, without the certificates of a member on hold.
create or replace function public.expired_certificate_documents()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.document_path
  from public.training_certificates c
  join public.club_settings s on s.retention_enabled
  where c.created_at < now() - make_interval(months => s.retention_certificates_months)
    and not public.on_legal_hold(c.profile_id);
$$;

revoke execute on function public.expired_certificate_documents() from public, anon, authenticated;
grant execute on function public.expired_certificate_documents() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Surveys
-- ---------------------------------------------------------------------------

-- As before, keeping any survey a member on hold answered by name.
create or replace function public.purge_expired_surveys()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_count int := 0;
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;
  delete from public.surveys v
  where v.closes_at < now() - make_interval(months => case
    when v.sent_as = 'committee' then s.retention_surveys_months
    when v.share_with_admins or v.share_with_committee then s.retention_shared_surveys_months
    else s.retention_team_polls_months
  end)
    and not exists (
      select 1 from public.survey_responses r
      where r.survey_id = v.id and public.on_legal_hold(r.respondent_id)
    );
  get diagnostics v_count = row_count;
  return jsonb_build_object('enabled', true, 'surveys', v_count);
end;
$$;

revoke execute on function public.purge_expired_surveys() from public, anon, authenticated;
grant execute on function public.purge_expired_surveys() to service_role;

-- ---------------------------------------------------------------------------
-- 5. The nightly clean-up
-- ---------------------------------------------------------------------------

-- As before, keeping everything about a member on hold, and keeping
-- safeguarding records for good when the club chose that (0).
create or replace function public.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_check_ins int := 0;
  v_goals int := 0;
  v_team_goals int := 0;
  v_messages int := 0;
  v_attendance int := 0;
  v_absences int := 0;
  v_certificates int := 0;
  v_access int := 0;
  v_kpis int := 0;
  v_kpi_reviews int := 0;
  v_plans int := 0;
  v_people int := 0;
  v_injuries int := 0;
  v_safeguarding int := 0;
  v_rows int := 0;
  v_votes int := 0;
  v_awards int := 0;
  v_ids uuid[];
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;

  delete from public.check_ins
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_check_ins = row_count;

  -- Goals, reflections and their comments go together, counted from the game.
  delete from public.game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months)
    and not public.on_legal_hold(g.athlete_id);
  get diagnostics v_goals = row_count;
  delete from public.team_game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_team_goals = row_count;

  delete from public.season_kpis k
  using public.teams t
  where t.id = k.team_id and t.archived and k.team_role = 'athlete'
    and k.updated_at < now() - make_interval(months => s.retention_goals_months)
    and not public.on_legal_hold(k.profile_id);
  get diagnostics v_kpis = row_count;
  delete from public.season_kpi_reviews r
  using public.teams t
  where t.id = r.team_id and t.archived and r.team_role = 'athlete'
    and r.updated_at < now() - make_interval(months => s.retention_goals_months)
    and not public.on_legal_hold(r.profile_id);
  get diagnostics v_kpi_reviews = row_count;

  -- The message stays with who sent it, who it went to and who read it; only
  -- the text is replaced. Not while its sender or anyone it went to is on hold.
  update public.messages m
  set body = 'This message was removed after the club''s keep period.', body_removed_at = now()
  where m.body_removed_at is null
    and m.created_at < now() - make_interval(months => s.retention_messages_months)
    and (
      m.created_at < now() - make_interval(months => greatest(s.retention_child_messages_months, s.retention_messages_months))
      or not public.message_involves_child(m)
    )
    and not public.on_legal_hold(m.sender_id)
    and not exists (
      select 1 from public.message_recipients r
      where r.message_id = m.id and public.on_legal_hold(r.profile_id)
    );
  get diagnostics v_messages = row_count;

  -- A session stays whole while anyone marked at it is on hold.
  delete from public.attendance_sessions a
  where a.held_at < now() - make_interval(months => s.retention_attendance_months)
    and not exists (
      select 1 from public.attendance_marks k
      where k.session_id = a.id and public.on_legal_hold(k.profile_id)
    );
  get diagnostics v_attendance = row_count;

  delete from public.attendance_absences
  where to_day < (current_date - make_interval(months => s.retention_attendance_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_absences = row_count;

  delete from public.training_certificates c
  where c.created_at < now() - make_interval(months => s.retention_certificates_months)
    and not public.on_legal_hold(c.profile_id)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'training-certificates' and o.name = c.document_path
    );
  get diagnostics v_certificates = row_count;

  -- Views of a held member's records, and the records they viewed.
  delete from public.record_access_log
  where created_at < now() - make_interval(months => s.retention_access_log_months)
    and not public.on_legal_hold(subject_id)
    and not public.on_legal_hold(viewer_id);
  get diagnostics v_access = row_count;

  -- Session plans follow the attendance keep period, counted from the session.
  delete from public.session_plans p
  where p.session_on < (current_date - make_interval(months => s.retention_attendance_months))::date
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'session-plans' and public.session_plan_of(o.name) = p.id
    );
  get diagnostics v_plans = row_count;

  -- People who never became members: turned down 90 days ago, or waiting 90
  -- days with no answer. Temporary helpers go a year after their end date.
  -- Their safeguarding records stay (keep_safeguarding_records_of_deleted_member).
  -- Nobody on hold goes.
  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.profiles p
  where ((p.status = 'rejected'
          and coalesce(p.rejected_at, p.updated_at) < now() - interval '90 days')
      or (p.status = 'pending'
          and coalesce(p.join_requested_at, p.created_at) < now() - interval '90 days')
      or (p.role = 'volunteer' and coalesce(cardinality(p.extra_roles), 0) = 0
          and p.volunteer_until < current_date - 365))
    and not public.on_legal_hold(p.id);
  delete from auth.users where id = any (v_ids);
  delete from public.profiles where id = any (v_ids);
  v_people := cardinality(v_ids);

  -- Cleared injuries of athletes who are still members, once their files are
  -- gone. Injuries of athletes who left follow purge_expired_injuries.
  delete from public.injuries i
  where i.status = 'cleared'
    and i.athlete_left_at is null
    and i.cleared_at < now() - make_interval(months => s.retention_injuries_months)
    and not public.on_legal_hold(i.athlete_id)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'injury-documents'
        and split_part(o.name, '/', 1) = i.athlete_id::text
        and split_part(o.name, '/', 2) = i.id::text
    );
  get diagnostics v_injuries = row_count;

  -- Safeguarding records, counted from when each one ended, unless the club
  -- keeps them for good. Anything still in force (a stand-down not lifted, an
  -- open exemption, a consent not withdrawn, a member's latest policy
  -- acknowledgement) stays, as does anything about a member on hold.
  -- Concerns are never removed.
  if s.retention_safeguarding_months > 0 then
    delete from public.stand_downs
    where lifted_at < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(profile_id);
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
    delete from public.screening_notices
    where coalesce(received_on::timestamptz, recorded_at) < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(profile_id);
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
    delete from public.volunteer_exemptions
    where ended_at < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(profile_id)
      and not public.on_legal_hold(child_id);
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
    delete from public.child_consents
    where coalesce(withdrawn_at, athlete_left_at) < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(athlete_id);
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
    delete from public.conduct_acceptances
    where accepted_at < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(profile_id);
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
    delete from public.policy_acknowledgements a
    where a.acknowledged_at < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(a.profile_id)
      and (a.member_left_at is not null or exists (
        select 1 from public.policy_acknowledgements later
        where later.profile_id = a.profile_id and later.acknowledged_at > a.acknowledged_at
      ));
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
    delete from public.guardianship_history
    where changed_at < now() - make_interval(months => s.retention_safeguarding_months)
      and not public.on_legal_hold(guardian_id)
      and not public.on_legal_hold(athlete_id);
    get diagnostics v_rows = row_count;
    v_safeguarding := v_safeguarding + v_rows;
  end if;

  -- Awards: who voted for whom goes first, leaving the points and results;
  -- later the award goes with its results, unless the club keeps them. A
  -- held member's votes keep their name, and an award they voted in or were
  -- voted for in stays.
  update public.award_ballots b
  set voter_id = null
  from public.awards a
  where a.id = b.award_id and b.voter_id is not null
    and a.closes_at < now() - make_interval(months => s.retention_award_votes_months)
    and not public.on_legal_hold(b.voter_id);
  get diagnostics v_votes = row_count;
  if s.retention_awards_months > 0 then
    delete from public.awards a
    where a.closes_at < now() - make_interval(months => s.retention_awards_months)
      and not exists (
        select 1 from public.award_ballots b
        left join public.award_votes v on v.ballot_id = b.id
        where b.award_id = a.id
          and (public.on_legal_hold(b.voter_id) or public.on_legal_hold(v.nominee_id))
      );
    get diagnostics v_awards = row_count;
  end if;

  return jsonb_build_object(
    'enabled', true,
    'check_ins', v_check_ins,
    'game_goals', v_goals,
    'team_goals', v_team_goals,
    'season_kpis', v_kpis,
    'season_kpi_reviews', v_kpi_reviews,
    'messages', v_messages,
    'attendance_sessions', v_attendance,
    'absences', v_absences,
    'certificates', v_certificates,
    'record_views', v_access,
    'session_plans', v_plans,
    'people', v_people,
    'cleared_injuries', v_injuries,
    'safeguarding_records', v_safeguarding,
    'award_voters', v_votes,
    'awards', v_awards
  );
end;
$$;

revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
