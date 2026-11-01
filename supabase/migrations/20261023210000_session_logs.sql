-- Session logs beside daily check-ins (customer review R10, Matt, 23 October
-- 2026: "Session log beside check-ins").
--
-- * An athlete logs each training session, game or gym session: how many
--   minutes, and how hard it felt (session RPE, 1 very easy to 10 maximal).
--   Minutes times effort is the session's load; a week's load is the sum.
-- * Session logs are seen exactly as check-ins are: the athlete, their
--   guardians, and their coaches (for an under 18 only once a parent or
--   guardian has given consent). Never teammates, the committee or admins,
--   and never shared with the team.
-- * They're removed with check-ins, after the club's check-ins period under
--   Keeping records, once an admin turns on Remove old records.
-- * No Strava or testing results.
--
-- Additive: one new table and new functions; purge_expired_records also
-- removes old session logs. No existing rows change.

begin;

create table if not exists public.session_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- The athlete's own calendar day.
  day date not null,
  kind text not null check (kind in ('training', 'game', 'gym', 'other')),
  minutes smallint not null check (minutes between 1 and 300),
  rpe smallint not null check (rpe between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists session_logs_athlete_day_idx on public.session_logs (athlete_id, day);
create index if not exists session_logs_day_idx on public.session_logs (day);

drop trigger if exists session_logs_touch_updated_at on public.session_logs;
create trigger session_logs_touch_updated_at
  before update on public.session_logs
  for each row execute function public.touch_updated_at();

-- Read as check-ins are; written only through save_session_log() and
-- delete_session_log().
alter table public.session_logs enable row level security;

drop policy if exists "Athletes, guardians and coaches see session logs" on public.session_logs;
create policy "Athletes, guardians and coaches see session logs"
  on public.session_logs for select to authenticated
  using (athlete_id in (select public.visible_check_in_athletes()));

revoke all on table public.session_logs from public, anon, authenticated;
grant select on table public.session_logs to authenticated;
grant all on table public.session_logs to service_role;

-- An athlete logs a session for today or the past week, or changes one they
-- logged. Returns the session's id.
create or replace function public.save_session_log(
  p_id uuid,
  p_day date,
  p_kind text,
  p_minutes integer,
  p_rpe integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_approved() and public.has_role('athlete')) then
    raise exception 'Only athletes can log sessions.';
  end if;
  if p_day is null or p_day not between current_date - 7 and current_date + 1 then
    raise exception 'Log a session from today or the past week.';
  end if;
  if p_kind is null or p_kind not in ('training', 'game', 'gym', 'other') then
    raise exception 'Choose training, game, gym or other.';
  end if;
  if p_minutes is null or p_minutes not between 1 and 300 then
    raise exception 'Minutes must be between 1 and 300.';
  end if;
  if p_rpe is null or p_rpe not between 1 and 10 then
    raise exception 'Choose how hard it felt, from 1 to 10.';
  end if;

  if p_id is null then
    if (select count(*) from public.session_logs l where l.athlete_id = auth.uid() and l.day = p_day) >= 6 then
      raise exception 'You can log up to 6 sessions a day.';
    end if;
    insert into public.session_logs (athlete_id, day, kind, minutes, rpe)
    values (auth.uid(), p_day, p_kind, p_minutes, p_rpe)
    returning id into v_id;
  else
    update public.session_logs l
    set day = p_day, kind = p_kind, minutes = p_minutes, rpe = p_rpe
    where l.id = p_id and l.athlete_id = auth.uid()
    returning l.id into v_id;
    if v_id is null then
      raise exception 'Session not found.';
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_session_log(uuid, date, text, integer, integer) from public, anon;
grant execute on function public.save_session_log(uuid, date, text, integer, integer) to authenticated;

-- An athlete removes a session they logged by mistake.
create or replace function public.delete_session_log(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() then
    raise exception 'Session not found.';
  end if;
  delete from public.session_logs l where l.id = p_id and l.athlete_id = auth.uid();
  if not found then
    raise exception 'Session not found.';
  end if;
end;
$$;
revoke execute on function public.delete_session_log(uuid) from public, anon;
grant execute on function public.delete_session_log(uuid) to authenticated;

-- Old session logs are removed with check-ins.
create or replace function public.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_check_ins int := 0;
  v_session_logs int := 0;
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

  -- Session logs go with check-ins, after the same period.
  delete from public.session_logs
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_session_logs = row_count;

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
    'session_logs', v_session_logs,
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
