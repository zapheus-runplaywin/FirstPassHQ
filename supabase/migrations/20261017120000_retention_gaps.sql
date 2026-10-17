-- Closes the gaps found in the 17 October 2026 review of what the nightly
-- clean-up leaves behind (thread "Any data not covered by existing purge
-- rules?"). Matt asked for each of these:
--
-- 1. Deleting a member keeps the club's safeguarding evidence. Their
--    attendance marks, training certificates (with files), message receipts,
--    consents, code of conduct acceptances, policy acknowledgements,
--    exemptions and the log of who viewed their records used to go with the
--    account. They now stay under the member's old id with their name, the
--    way injuries already do, until their own keep period removes them. This
--    also stops certificate files being left in storage with no record.
-- 2. People who never became, or are no longer, members: requests rejected
--    90 days ago, requests left unanswered for 90 days, and temporary helpers
--    a year after their end date are removed. Admins get a list and a to-do
--    for members with no squad, team or club role for 2 years.
-- 3. Cleared injuries of athletes who are still members: removed a chosen
--    3, 5, 7 (default) or 10 years after clearance.
-- 4. Safeguarding records (stand-downs, Screening Unit notices, exemptions,
--    consents, code of conduct acceptances, policy acknowledgements and
--    guardian link history): 7, 10, 15, 20 or 30 (default) years. Concerns
--    are still never removed.
-- 5. Awards: who voted for whom goes after 1 (default), 2, 3 or 5 years,
--    leaving the points and results; the award with its results goes after
--    3, 5, 10 (default) or 20 years, or is kept for good.
--
-- This migration changes no rows. It adds columns with defaults, drops
-- foreign keys (the ids stay in place), and adds or replaces functions and
-- a trigger. Removal only happens in the nightly clean-up, and only once an
-- admin has switched on "Remove old records".

begin;

-- ---------------------------------------------------------------------------
-- 1. Keep safeguarding evidence when a member is deleted
-- ---------------------------------------------------------------------------

alter table public.attendance_marks add column if not exists member_name text;
alter table public.message_recipients add column if not exists member_name text;
alter table public.training_certificates add column if not exists member_name text;
alter table public.record_access_log add column if not exists subject_name text;
alter table public.child_consents add column if not exists athlete_name text;
alter table public.conduct_acceptances add column if not exists member_name text;
alter table public.policy_acknowledgements add column if not exists member_name text;
alter table public.volunteer_exemptions add column if not exists member_name text;

-- When the member's account was deleted. Null while they are a member.
-- conduct_acceptances.member_name and member_left_at match PR #143's
-- migration, so either can run first; both triggers stamp the same columns.
alter table public.attendance_marks add column if not exists member_left_at timestamptz;
alter table public.message_recipients add column if not exists member_left_at timestamptz;
alter table public.training_certificates add column if not exists member_left_at timestamptz;
alter table public.record_access_log add column if not exists subject_left_at timestamptz;
alter table public.child_consents add column if not exists athlete_left_at timestamptz;
alter table public.conduct_acceptances add column if not exists member_left_at timestamptz;
alter table public.policy_acknowledgements add column if not exists member_left_at timestamptz;
alter table public.volunteer_exemptions add column if not exists member_left_at timestamptz;

-- The member's id stays on each record after their profile is gone, as on
-- injuries. Nothing else changes: the ids, keys and rows are as they were.
alter table public.attendance_marks drop constraint if exists attendance_marks_profile_id_fkey;
alter table public.message_recipients drop constraint if exists message_recipients_profile_id_fkey;
alter table public.training_certificates drop constraint if exists training_certificates_profile_id_fkey;
alter table public.record_access_log drop constraint if exists record_access_log_subject_id_fkey;
alter table public.child_consents drop constraint if exists child_consents_athlete_id_fkey;
alter table public.conduct_acceptances drop constraint if exists conduct_acceptances_profile_id_fkey;
alter table public.policy_acknowledgements drop constraint if exists policy_acknowledgements_profile_id_fkey;
alter table public.volunteer_exemptions drop constraint if exists volunteer_exemptions_profile_id_fkey;

create or replace function public.keep_safeguarding_records_of_deleted_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(nullif(trim(old.full_name), ''), old.email);
begin
  update public.attendance_marks
  set member_name = v_name, member_left_at = now()
  where profile_id = old.id and member_left_at is null;
  update public.message_recipients
  set member_name = v_name, member_left_at = now()
  where profile_id = old.id and member_left_at is null;
  update public.training_certificates
  set member_name = v_name, member_left_at = now()
  where profile_id = old.id and member_left_at is null;
  update public.record_access_log
  set subject_name = v_name, subject_left_at = now()
  where subject_id = old.id and subject_left_at is null;
  update public.child_consents
  set athlete_name = v_name, athlete_left_at = now()
  where athlete_id = old.id and athlete_left_at is null;
  update public.conduct_acceptances
  set member_name = v_name, member_left_at = now()
  where profile_id = old.id and member_left_at is null;
  update public.policy_acknowledgements
  set member_name = v_name, member_left_at = now()
  where profile_id = old.id and member_left_at is null;
  -- An exemption can't outlast the member it covers.
  update public.volunteer_exemptions
  set member_name = v_name, member_left_at = now(),
      ended_at = coalesce(ended_at, now()),
      end_note = coalesce(end_note, case when ended_at is null then 'Member deleted' end)
  where profile_id = old.id and member_left_at is null;
  return old;
end;
$$;

revoke execute on function public.keep_safeguarding_records_of_deleted_member() from public, anon, authenticated;

drop trigger if exists profiles_keep_safeguarding_records on public.profiles;
create trigger profiles_keep_safeguarding_records
  before delete on public.profiles
  for each row execute function public.keep_safeguarding_records_of_deleted_member();

-- Receipts of a deleted member still show, by the name they had.
create or replace function public.message_receipts(p_message_id uuid)
returns table (profile_id uuid, full_name text, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id, coalesce(nullif(p.full_name, ''), p.email, r.member_name || ' (deleted)'), r.read_at
  from public.message_recipients r
  left join public.profiles p on p.id = r.profile_id
  where r.message_id = p_message_id
    and (p.id is not null or r.member_left_at is not null)
    and (public.is_message_sender(p_message_id) or public.is_admin())
  order by r.read_at is null, r.read_at desc, 2;
$$;

-- ---------------------------------------------------------------------------
-- When a join request was turned down
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists rejected_at timestamptz;

create or replace function public.note_rejected_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    new.rejected_at := now();
  elsif new.status <> 'rejected' then
    new.rejected_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.note_rejected_at() from public, anon, authenticated;

drop trigger if exists profiles_note_rejected_at on public.profiles;
create trigger profiles_note_rejected_at
  before update of status on public.profiles
  for each row execute function public.note_rejected_at();

-- ---------------------------------------------------------------------------
-- The new keep periods
-- ---------------------------------------------------------------------------

alter table public.club_settings
  add column if not exists retention_injuries_months integer not null default 84,
  add column if not exists retention_safeguarding_months integer not null default 360,
  add column if not exists retention_award_votes_months integer not null default 12,
  -- 0 keeps awards and their results for good.
  add column if not exists retention_awards_months integer not null default 120;

-- The new periods, for admins. A club that has never saved its periods is
-- offered the defaults, as record_retention() does.
create or replace function public.more_record_retention()
returns table (
  injuries_months integer,
  safeguarding_months integer,
  award_votes_months integer,
  awards_months integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when s.retention_updated_at is null then 84 else s.retention_injuries_months end,
    case when s.retention_updated_at is null then 360 else s.retention_safeguarding_months end,
    case when s.retention_updated_at is null then 12 else s.retention_award_votes_months end,
    case when s.retention_updated_at is null then 120 else s.retention_awards_months end
  from (select 1) as one
  left join public.club_settings s on true
  where public.is_admin();
$$;

revoke execute on function public.more_record_retention() from public, anon;
grant execute on function public.more_record_retention() to authenticated;

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
  if not public.retention_choice_ok(p_safeguarding_months, array[84, 120, 180, 240, 360], s.retention_safeguarding_months) then
    raise exception 'Safeguarding records can be kept 7, 10, 15, 20 or 30 years';
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
-- Members with no squad, team or club role for 2 years
-- ---------------------------------------------------------------------------

-- Approved members who hold no club-wide role, have no place in this
-- season's squads and teams, aren't the guardian of anyone who has, and
-- haven't signed in, joined or changed groups for 2 years. Admins decide
-- whether to delete them; nothing removes them automatically.
create or replace function public.admin_inactive_members()
returns table (profile_id uuid, member_name text, last_active timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select p.id,
      coalesce(nullif(trim(p.preferred_name), ''), nullif(trim(p.full_name), ''), p.email) as name,
      greatest(
        p.created_at,
        p.verified_at,
        u.last_sign_in_at,
        (select max(c.changed_at) from public.group_membership_changes c where c.profile_id = p.id)
      ) as last_active
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.status = 'approved'
      and not coalesce(p.head_physio, false)
      and not exists (
        select 1 from unnest(public.roles_of(p.role, p.extra_roles)) as r
        where r in ('admin', 'committee', 'partner', 'volunteer')
      )
      and not exists (
        select 1 from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where tm.profile_id = p.id and not t.archived
      )
      and not exists (
        select 1 from public.guardianships g
        join public.team_members tm on tm.profile_id = g.athlete_id
        join public.teams t on t.id = tm.team_id
        where g.guardian_id = p.id and not t.archived
      )
  )
  select id, name, last_active
  from people
  where last_active < now() - interval '2 years'
    and public.is_admin()
  order by last_active, name;
$$;

revoke execute on function public.admin_inactive_members() from public, anon;
grant execute on function public.admin_inactive_members() to authenticated;

-- ---------------------------------------------------------------------------
-- The nightly clean-up
-- ---------------------------------------------------------------------------

-- Same as before, plus: people who never became members, temporary helpers a
-- year after their end date, cleared injuries, safeguarding records and
-- awards past their keep periods.
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
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date;
  get diagnostics v_check_ins = row_count;

  -- Goals, reflections and their comments go together, counted from the game.
  delete from public.game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_goals = row_count;
  delete from public.team_game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_team_goals = row_count;

  delete from public.season_kpis k
  using public.teams t
  where t.id = k.team_id and t.archived and k.team_role = 'athlete'
    and k.updated_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_kpis = row_count;
  delete from public.season_kpi_reviews r
  using public.teams t
  where t.id = r.team_id and t.archived and r.team_role = 'athlete'
    and r.updated_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_kpi_reviews = row_count;

  -- The message stays with who sent it, who it went to and who read it; only
  -- the text is replaced.
  update public.messages m
  set body = 'This message was removed after the club''s keep period.', body_removed_at = now()
  where m.body_removed_at is null
    and m.created_at < now() - make_interval(months => s.retention_messages_months)
    and (
      m.created_at < now() - make_interval(months => greatest(s.retention_child_messages_months, s.retention_messages_months))
      or not public.message_involves_child(m)
    );
  get diagnostics v_messages = row_count;

  delete from public.attendance_sessions
  where held_at < now() - make_interval(months => s.retention_attendance_months);
  get diagnostics v_attendance = row_count;

  delete from public.attendance_absences
  where to_day < (current_date - make_interval(months => s.retention_attendance_months))::date;
  get diagnostics v_absences = row_count;

  delete from public.training_certificates c
  where c.created_at < now() - make_interval(months => s.retention_certificates_months)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'training-certificates' and o.name = c.document_path
    );
  get diagnostics v_certificates = row_count;

  delete from public.record_access_log
  where created_at < now() - make_interval(months => s.retention_access_log_months);
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
  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.profiles p
  where (p.status = 'rejected'
         and coalesce(p.rejected_at, p.updated_at) < now() - interval '90 days')
     or (p.status = 'pending'
         and coalesce(p.join_requested_at, p.created_at) < now() - interval '90 days')
     or (p.role = 'volunteer' and coalesce(cardinality(p.extra_roles), 0) = 0
         and p.volunteer_until < current_date - 365);
  delete from auth.users where id = any (v_ids);
  delete from public.profiles where id = any (v_ids);
  v_people := cardinality(v_ids);

  -- Cleared injuries of athletes who are still members, once their files are
  -- gone. Injuries of athletes who left keep their own 12-month rule.
  delete from public.injuries i
  where i.status = 'cleared'
    and i.athlete_left_at is null
    and i.cleared_at < now() - make_interval(months => s.retention_injuries_months)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'injury-documents'
        and split_part(o.name, '/', 1) = i.athlete_id::text
        and split_part(o.name, '/', 2) = i.id::text
    );
  get diagnostics v_injuries = row_count;

  -- Safeguarding records, counted from when each one ended. Anything still
  -- in force (a stand-down not lifted, an open exemption, a consent not
  -- withdrawn, a member's latest policy acknowledgement) stays. Concerns are
  -- never removed.
  delete from public.stand_downs
  where lifted_at < now() - make_interval(months => s.retention_safeguarding_months);
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;
  delete from public.screening_notices
  where coalesce(received_on::timestamptz, recorded_at) < now() - make_interval(months => s.retention_safeguarding_months);
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;
  delete from public.volunteer_exemptions
  where ended_at < now() - make_interval(months => s.retention_safeguarding_months);
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;
  delete from public.child_consents
  where coalesce(withdrawn_at, athlete_left_at) < now() - make_interval(months => s.retention_safeguarding_months);
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;
  delete from public.conduct_acceptances
  where accepted_at < now() - make_interval(months => s.retention_safeguarding_months);
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;
  delete from public.policy_acknowledgements a
  where a.acknowledged_at < now() - make_interval(months => s.retention_safeguarding_months)
    and (a.member_left_at is not null or exists (
      select 1 from public.policy_acknowledgements later
      where later.profile_id = a.profile_id and later.acknowledged_at > a.acknowledged_at
    ));
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;
  delete from public.guardianship_history
  where changed_at < now() - make_interval(months => s.retention_safeguarding_months);
  get diagnostics v_rows = row_count;
  v_safeguarding := v_safeguarding + v_rows;

  -- Awards: who voted for whom goes first, leaving the points and results;
  -- later the award goes with its results, unless the club keeps them.
  update public.award_ballots b
  set voter_id = null
  from public.awards a
  where a.id = b.award_id and b.voter_id is not null
    and a.closes_at < now() - make_interval(months => s.retention_award_votes_months);
  get diagnostics v_votes = row_count;
  if s.retention_awards_months > 0 then
    delete from public.awards
    where closes_at < now() - make_interval(months => s.retention_awards_months);
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
