-- Child safety finding 11: records aren't kept forever.
--
-- Matt approved these keep periods on 13 October 2026 (thread "Child safety
-- audit"): check-ins 24 months, game goals and reflections 24 months after
-- the game, message text 24 months (the message, who it went to and who read
-- it are kept, so a complaint can still be traced), attendance, training
-- certificates and the record-views log 7 years. Concerns are never removed.
--
-- This migration only adds settings and functions; it changes no rows. The
-- removals happen in public.purge_expired_records(), which the daily purge
-- function calls, and only once an admin has switched on "Remove old
-- records" in Club settings. The switch starts off.

begin;

alter table public.club_settings
  add column if not exists retention_enabled boolean not null default false,
  add column if not exists retention_check_ins_months integer not null default 24,
  add column if not exists retention_goals_months integer not null default 24,
  add column if not exists retention_messages_months integer not null default 24,
  add column if not exists retention_attendance_months integer not null default 84,
  add column if not exists retention_certificates_months integer not null default 84,
  add column if not exists retention_access_log_months integer not null default 84,
  add column if not exists retention_updated_by_name text,
  add column if not exists retention_updated_at timestamptz;

-- When a message's text was removed for being older than the keep period.
alter table public.messages
  add column if not exists body_removed_at timestamptz;

-- The club's keep periods, for admins.
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
    coalesce(s.retention_check_ins_months, 24),
    coalesce(s.retention_goals_months, 24),
    coalesce(s.retention_messages_months, 24),
    coalesce(s.retention_attendance_months, 84),
    coalesce(s.retention_certificates_months, 84),
    coalesce(s.retention_access_log_months, 84),
    s.retention_updated_by_name,
    s.retention_updated_at
  from (select 1) as one
  left join public.club_settings s on true
  where public.is_admin();
$$;

revoke execute on function public.record_retention() from public, anon;
grant execute on function public.record_retention() to authenticated;

-- Admins switch removal on or off and set each period. Everyday records can
-- be kept 12 months to 10 years; the safety records (attendance,
-- certificates and the record-views log) at least 7 years, up to 20.
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
begin
  if not public.is_admin() then
    raise exception 'Only admins can change how long records are kept';
  end if;
  if p_enabled is null
     or p_check_ins_months is null or p_goals_months is null or p_messages_months is null
     or p_attendance_months is null or p_certificates_months is null or p_access_log_months is null then
    raise exception 'Choose a period for every kind of record';
  end if;
  if least(p_check_ins_months, p_goals_months, p_messages_months) < 12
     or greatest(p_check_ins_months, p_goals_months, p_messages_months) > 120 then
    raise exception 'Check-ins, game goals and messages can be kept from 1 to 10 years';
  end if;
  if least(p_attendance_months, p_certificates_months, p_access_log_months) < 84
     or greatest(p_attendance_months, p_certificates_months, p_access_log_months) > 240 then
    raise exception 'Attendance, training certificates and record views are kept at least 7 years, and at most 20';
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

revoke execute on function public.admin_set_record_retention(
  boolean, integer, integer, integer, integer, integer, integer
) from public, anon;
grant execute on function public.admin_set_record_retention(
  boolean, integer, integer, integer, integer, integer, integer
) to authenticated;

-- Training certificate files past their keep period, for the purge function
-- to remove from storage before the records go. Empty while removal is off.
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
  where c.created_at < now() - make_interval(months => s.retention_certificates_months);
$$;

revoke execute on function public.expired_certificate_documents() from public, anon, authenticated;
grant execute on function public.expired_certificate_documents() to service_role;

-- Removes records past the club's keep periods, and returns how many of each
-- went. Does nothing while removal is switched off. A certificate record only
-- goes once its file has been removed from storage.
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
  v_certificates int := 0;
  v_access int := 0;
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

  -- The message stays with who sent it, who it went to and who read it; only
  -- the text is replaced.
  update public.messages
  set body = 'This message was removed after the club''s keep period.', body_removed_at = now()
  where body_removed_at is null
    and created_at < now() - make_interval(months => s.retention_messages_months);
  get diagnostics v_messages = row_count;

  delete from public.attendance_sessions
  where held_at < now() - make_interval(months => s.retention_attendance_months);
  get diagnostics v_attendance = row_count;

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

  return jsonb_build_object(
    'enabled', true,
    'check_ins', v_check_ins,
    'game_goals', v_goals,
    'team_goals', v_team_goals,
    'messages', v_messages,
    'attendance_sessions', v_attendance,
    'certificates', v_certificates,
    'record_views', v_access
  );
end;
$$;

revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
