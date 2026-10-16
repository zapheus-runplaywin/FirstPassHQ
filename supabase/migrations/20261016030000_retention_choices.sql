-- New keep period choices under Club settings > Keeping records, decided by
-- Matt on 16 October 2026 (thread "Record retention periods review"):
--
-- - Daily check-ins: 3 or 6 months, 1 or 2 years. Default 1 year.
-- - Game goals and athletes' KPIs, attendance and training certificates:
--   1 to 5 years. Default 1 year.
-- - Message text: 1, 2, 3, 5 or 7 years. Default 3 years.
-- - Message text involving a child (new): 3, 5, 7, 10 or 15 years. Default 7
--   years. A message involves a child when its sender or anyone it went to
--   was under 18 when it was sent. It is kept at least as long as other
--   messages.
-- - Who viewed a child's records: 3, 5, 7, 10 or 15 years. Default 7 years.
-- - Injury documents: 90 days, 1 year or 3 years after the injury is cleared.
--   Default 1 year. Archiving the season no longer removes them sooner.
--
-- This migration changes no rows. It adds one column with a default, changes
-- column defaults and replaces functions. A club that has never saved its
-- periods is shown the new defaults (removal is off until an admin saves, so
-- its stored values have never been used). A club keeps whatever periods it has already
-- saved, even ones no longer offered, until an admin chooses another, so no
-- saved choice is shortened. Nothing is removed unless an admin has switched
-- on "Remove old records".

begin;

alter table public.club_settings
  add column if not exists retention_child_messages_months integer not null default 84;

alter table public.club_settings
  alter column retention_check_ins_months set default 12,
  alter column retention_goals_months set default 12,
  alter column retention_messages_months set default 36,
  alter column retention_attendance_months set default 12,
  alter column retention_certificates_months set default 12,
  alter column retention_injury_documents_days set default 365;

-- The club's keep periods, for admins. A club that has never saved its
-- periods is offered the new defaults: its stored ones were only ever column
-- defaults, and nothing is removed until an admin saves with removal on.
create or replace function public.record_retention()
returns table (
  enabled boolean,
  check_ins_months integer,
  goals_months integer,
  messages_months integer,
  attendance_months integer,
  certificates_months integer,
  access_log_months integer,
  updated_by_name text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.retention_enabled, false),
    case when s.retention_updated_at is null then 12 else s.retention_check_ins_months end,
    case when s.retention_updated_at is null then 12 else s.retention_goals_months end,
    case when s.retention_updated_at is null then 36 else s.retention_messages_months end,
    case when s.retention_updated_at is null then 12 else s.retention_attendance_months end,
    case when s.retention_updated_at is null then 12 else s.retention_certificates_months end,
    case when s.retention_updated_at is null then 84 else s.retention_access_log_months end,
    s.retention_updated_by_name,
    s.retention_updated_at
  from (select 1) as one
  left join public.club_settings s on true
  where public.is_admin();
$$;

-- True when p_months is one of the choices, or the period the club already
-- has saved (so a club is never forced to shorten a period no longer offered).
create or replace function public.retention_choice_ok(p_months integer, p_choices integer[], p_saved integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_months is not null and (p_months = any (p_choices) or p_months is not distinct from p_saved);
$$;

revoke execute on function public.retention_choice_ok(integer, integer[], integer) from public, anon, authenticated;

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
     or not public.retention_choice_ok(p_attendance_months, array[12, 24, 36, 48, 60], s.retention_attendance_months)
     or not public.retention_choice_ok(p_certificates_months, array[12, 24, 36, 48, 60], s.retention_certificates_months) then
    raise exception 'Game goals, attendance and training certificates can be kept 1 to 5 years';
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

-- How long the text of a message involving a child is kept, for admins.
create or replace function public.child_messages_keep_months()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when retention_updated_at is null then 84 else retention_child_messages_months end
                   from public.club_settings where id), 84)
  where public.is_admin();
$$;

revoke execute on function public.child_messages_keep_months() from public, anon;
grant execute on function public.child_messages_keep_months() to authenticated;

-- Saves every period in one go, so an admin can lengthen or shorten both
-- message periods together without tripping the "at least as long" rule
-- part way through.
create or replace function public.admin_set_record_retention_all(
  p_enabled boolean,
  p_check_ins_months integer,
  p_goals_months integer,
  p_messages_months integer,
  p_child_messages_months integer,
  p_attendance_months integer,
  p_certificates_months integer,
  p_access_log_months integer,
  p_injury_documents_days integer
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
  if not public.retention_choice_ok(p_child_messages_months, array[36, 60, 84, 120, 180], s.retention_child_messages_months) then
    raise exception 'Messages involving a child can be kept 3, 5, 7, 10 or 15 years';
  end if;
  if p_messages_months is not null and p_child_messages_months < p_messages_months then
    raise exception 'Messages involving a child must be kept at least as long as other messages';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_child_messages_months = p_child_messages_months
  where id;
  perform public.admin_set_record_retention(
    p_enabled, p_check_ins_months, p_goals_months, p_messages_months,
    p_attendance_months, p_certificates_months, p_access_log_months
  );
  perform public.admin_set_injury_documents_keep_days(p_injury_documents_days);
end;
$$;

revoke execute on function public.admin_set_record_retention_all(
  boolean, integer, integer, integer, integer, integer, integer, integer, integer
) from public, anon;
grant execute on function public.admin_set_record_retention_all(
  boolean, integer, integer, integer, integer, integer, integer, integer, integer
) to authenticated;

-- Injury documents: 90 days, 1 year or 3 years after clearance.
create or replace function public.injury_documents_keep_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when retention_updated_at is null then 365 else retention_injury_documents_days end
                   from public.club_settings where id), 365)
  where public.is_admin();
$$;

create or replace function public.admin_set_injury_documents_keep_days(p_days integer)
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
  if not public.retention_choice_ok(p_days, array[90, 365, 1095], s.retention_injury_documents_days) then
    raise exception 'Injury documents can be kept 90 days, 1 year or 3 years after clearance';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_injury_documents_days = p_days,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;

-- A cleared injury's files are past the keep period the chosen number of days
-- after clearance. Archiving its season no longer removes them sooner.
-- Always false while "Remove old records" is off.
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
    from public.club_settings s
    where s.id and s.retention_enabled
  ), false);
$$;

-- True when the message's sender or anyone it went to was under 18 when it
-- was sent: from their date of birth, or the admin's "under 18" choice when
-- there isn't one.
create or replace function public.message_involves_child(p_message public.messages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where (p.id = p_message.sender_id
           or p.id in (select r.profile_id from public.message_recipients r where r.message_id = p_message.id))
      and case
        when p.date_of_birth is not null then p.date_of_birth > (p_message.created_at - interval '18 years')::date
        else coalesce(p.under_17, false)
      end
  );
$$;

revoke execute on function public.message_involves_child(public.messages) from public, anon, authenticated;

-- Removes records past the club's keep periods, and returns how many of each
-- went. Does nothing while removal is switched off. A certificate record or a
-- session plan only goes once its files have been removed from storage. The
-- text of a message involving a child is kept for its own, longer period.
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
    'session_plans', v_plans
  );
end;
$$;
revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
