-- Medical and emergency details nobody checks are removed (Matt, 23
-- October 2026): "Medical files require an annual review, if the review is
-- not complete for X years then the data is removed. Configurable as per
-- other medical records."
--
-- * Each club chooses under Keeping records how long details are kept
--   without their yearly check: 2 (the default), 3, 5 or 7 years, counted
--   from the last save or "Still correct".
-- * The nightly clean-up removes them only once the club has turned on
--   "Remove old records", and never while the athlete is on legal hold (named
--   in a concern). Who opened them stays in the record access log under its
--   own period.
-- * Once the yearly check is due, medical_profile returns the day they'll be
--   removed, so the athlete or their parents see it.
--
-- Additive: one new club setting with a default, new functions, and the
-- nightly clean-up gains one step. The migration itself changes or removes
-- no rows.

begin;

-- How long medical details are kept without their yearly check.
alter table public.club_settings
  add column if not exists retention_medical_months integer not null default 24;

-- The day unchecked details will be removed, or null when the club doesn't
-- remove old records or the athlete is on hold.
create or replace function public.medical_removal_on(p_athlete_id uuid, p_checked_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_checked_at + make_interval(months => s.retention_medical_months))::date
  from public.club_settings s
  where s.id and s.retention_enabled and p_checked_at is not null
    and not public.on_legal_hold(p_athlete_id);
$$;
revoke execute on function public.medical_removal_on(uuid, timestamptz) from public, anon, authenticated;

-- As in 20261023140000_medical_profiles.sql, plus the day the details will be
-- removed if nobody checks them. One athlete's medical and emergency
-- details. Anyone other than the
-- athlete or their guardians is written to the record access log, once in
-- 30 minutes however often they open it.
create or replace function public.medical_profile(p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.medical_profile_role(p_athlete_id);
  v_profile public.medical_profiles;
begin
  if v_role is null then
    raise exception 'You can’t see this athlete’s medical details';
  end if;

  if v_role not in ('self', 'guardian') and not exists (
    select 1 from public.record_access_log l
    where l.viewer_id = auth.uid() and l.subject_id = p_athlete_id and l.kind = 'medical'
      and l.created_at > now() - interval '30 minutes'
  ) then
    insert into public.record_access_log (subject_id, viewer_id, viewer_name, viewer_role, kind, record_id)
    values (
      p_athlete_id, auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Member'),
      initcap(v_role), 'medical', null
    );
  end if;

  select * into v_profile from public.medical_profiles where athlete_id = p_athlete_id;

  return jsonb_build_object(
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'role', v_role,
    'can_edit', public.can_edit_medical_profile(p_athlete_id),
    'saved', v_profile.athlete_id is not null,
    'emergency_contacts', coalesce(v_profile.emergency_contacts, '[]'::jsonb),
    'conditions', coalesce(v_profile.conditions, ''),
    'allergies', coalesce(v_profile.allergies, ''),
    'medications', coalesce(v_profile.medications, ''),
    'action_plan', coalesce(v_profile.action_plan, ''),
    'updated_at', v_profile.updated_at,
    'updated_by_name', v_profile.updated_by_name,
    'checked_at', v_profile.checked_at,
    'checked_by_name', v_profile.checked_by_name,
    'check_due_on', (v_profile.checked_at + interval '1 year')::date,
    'check_status', public.medical_review_status(v_profile.checked_at),
    'removal_on', public.medical_removal_on(p_athlete_id, v_profile.checked_at)
  );
end;
$$;
revoke execute on function public.medical_profile(uuid) from public, anon;
grant execute on function public.medical_profile(uuid) to authenticated;

-- Months medical details are kept without their yearly check, for admins.
create or replace function public.medical_keep_months()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select retention_medical_months from public.club_settings where id), 24)
  where public.is_admin();
$$;
revoke execute on function public.medical_keep_months() from public, anon;
grant execute on function public.medical_keep_months() to authenticated;

create or replace function public.admin_set_medical_keep_months(p_months integer)
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
  if not public.retention_choice_ok(p_months, array[24, 36, 60, 84], s.retention_medical_months) then
    raise exception 'Medical details can be kept 2, 3, 5 or 7 years without their yearly check';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_medical_months = p_months,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_medical_keep_months(integer) from public, anon;
grant execute on function public.admin_set_medical_keep_months(integer) to authenticated;

-- As in 20261023130000_legal_hold.sql, plus medical details nobody has
-- checked for the club's chosen time.
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
  v_medical int := 0;
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

  -- Medical and emergency details nobody has checked for the club's chosen
  -- time. Not while the athlete is on hold.
  delete from public.medical_profiles
  where checked_at < now() - make_interval(months => s.retention_medical_months)
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_medical = row_count;

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
    'awards', v_awards,
    'medical_details', v_medical
  );
end;
$$;

revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
