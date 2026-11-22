-- One club date rule everywhere: the club's own time zone (Matt, 22 November
-- 2026).
--
-- Every moment is already stored in UTC (timestamptz), and that stays. What
-- was mixed up is the club's calendar day. About 20 functions worked it out
-- in Perth time, written into each function, while about 50 more used
-- current_date, which is the UTC day on Supabase: from 4 pm to midnight in
-- Perth, the UTC day is still yesterday. So a check-in, a card expiry, a
-- message access range or a "date can't be in the future" check could
-- disagree with another by a day, depending on the time it ran (a message
-- access test broke this way, fixed in #275).
--
-- Now there is one rule:
--
--   club_timezone()  the club's time zone, from Club settings (an IANA name
--     such as Australia/Perth; Perth if it was never set). Admins choose it
--     in Administration > Club settings > Club options.
--   club_day(moment) the club's calendar day at that moment.
--   club_today()     the club's calendar day now.
--
-- Every function below that meant the club's day now uses these, in place
-- of current_date, now()::date, a moment cast straight to a date, or Perth
-- written in. Each is replaced exactly as it stood on main, with only those
-- words changed (the replaced bodies were taken from a database built from
-- every earlier migration, so none of a later change is lost). Moments
-- (now(), created_at, expiry instants) are unchanged and stay UTC.
--
-- club_settings.timezone already existed (20261112050000) with the default
-- Australia/Perth. This migration adds a check that it is a real time zone
-- name, an admin function to change it, and returns it from club_profile so
-- the app can use the same day.
--
-- Additive only: no table or column is dropped, and no row is changed or
-- removed. club_profile is dropped and created again in the same
-- transaction, because it returns one more column; its grants are restored.
-- Two column defaults (the day a statistician or committee check starts, the
-- day a load flag was reviewed) now use the club's day; they only apply to
-- new rows.

begin;

-- Whether a name is a time zone Postgres knows, such as Australia/Perth.
-- Marked immutable so the check below can use it; the names only change
-- with Postgres's time zone data.
create or replace function public.is_time_zone(p_name text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- A named zone only: Postgres also reads "UTC+8" style text, backwards.
  return p_name is not null
    and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_name);
end;
$$;
revoke execute on function public.is_time_zone(text) from public, anon;
grant execute on function public.is_time_zone(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'club_settings_timezone_is_real'
      and conrelid = 'public.club_settings'::regclass
  ) then
    alter table public.club_settings
      add constraint club_settings_timezone_is_real check (public.is_time_zone(timezone));
  end if;
end;
$$;

-- The club's time zone: what an admin chose in Club settings, or Perth.
create or replace function public.club_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.timezone from public.club_settings s where s.id),
    'Australia/Perth'
  );
$$;
revoke execute on function public.club_timezone() from public, anon;
grant execute on function public.club_timezone() to authenticated;

-- The club's calendar day at a moment.
create or replace function public.club_day(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone public.club_timezone())::date;
$$;
revoke execute on function public.club_day(timestamptz) from public, anon;
grant execute on function public.club_day(timestamptz) to authenticated;

-- The club's calendar day now. Use this, never current_date, for "today".
create or replace function public.club_today()
returns date
language sql
stable
set search_path = ''
as $$
  select public.club_day(now());
$$;
revoke execute on function public.club_today() from public, anon;
grant execute on function public.club_today() to authenticated;

-- Admins choose the club's time zone. Returns the name saved.
create or replace function public.admin_set_club_timezone(p_timezone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_timezone, ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can change club settings';
  end if;
  if not public.is_time_zone(v_name) then
    raise exception 'Choose a time zone from the list';
  end if;
  update public.club_settings set timezone = v_name, updated_at = now() where id;
  return v_name;
end;
$$;
revoke execute on function public.admin_set_club_timezone(text) from public, anon;
grant execute on function public.admin_set_club_timezone(text) to authenticated;

-- Same as 20261116000000_team_pilot_features.sql, plus the time zone.
drop function if exists public.club_profile();
create function public.club_profile()
returns table (
  club_name text,
  short_name text,
  background_colour text,
  text_colour text,
  hero_colour text,
  logo_path text,
  features jsonb,
  updated_at timestamptz,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.club_name, s.short_name, s.background_colour, s.text_colour, s.hero_colour,
         s.logo_path, public.member_features(), s.updated_at, public.club_timezone()
  from public.club_settings s;
$$;
revoke execute on function public.club_profile() from public, anon;
grant execute on function public.club_profile() to authenticated;

alter table public.safeguarding_settings
  alter column statistician_checks_from set default (public.club_today() + 90),
  alter column committee_checks_from set default (public.club_today() + 90);
alter table public.load_flag_reviews
  alter column reviewed_on set default public.club_today();

-- Load monitoring's "today" was the first club-day helper; it stays for the
-- functions and tests that call it, and now follows the club's time zone.

-- The functions below are as they stood, with the club's day in place of
-- current_date or Perth (generated from a database built from every earlier
-- migration; see the note at the top).

-- absences_to_review()
CREATE OR REPLACE FUNCTION public.absences_to_review()
 RETURNS TABLE(id uuid, athlete_id uuid, athlete_name text, from_day date, to_day date, category text, reason text, reported_by_name text, withdrawn boolean, changed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with since as (
    select coalesce(
      (select r.reviewed_at from public.absence_reviews r where r.profile_id = auth.uid()),
      now() - interval '7 days'
    ) as at
  )
  select a.id, a.athlete_id, coalesce(public.member_display_name(a.athlete_id), 'Athlete'),
    a.from_day, a.to_day, c.name, a.reason, a.reported_by_name,
    a.withdrawn_at is not null, coalesce(a.withdrawn_at, a.created_at)
  from public.attendance_absences a
  cross join since
  left join public.absence_categories c on c.id = a.category_id
  where a.to_day >= public.club_today() - 14
    and (
      (a.withdrawn_at is null and a.created_at > since.at
        and a.reported_by is distinct from auth.uid())
      or (a.withdrawn_at > since.at and a.withdrawn_by is distinct from auth.uid())
    )
    and exists (
      select 1 from public.team_members tm
      where tm.profile_id = a.athlete_id
        and tm.team_role = 'athlete'
        and public.leads_group(tm.team_id)
    )
  order by coalesce(a.withdrawn_at, a.created_at) desc;
$function$;

-- accessed_messages(uuid)
CREATE OR REPLACE FUNCTION public.accessed_messages(p_request_id uuid)
 RETURNS TABLE(message_id uuid, created_at timestamp with time zone, sender_name text, sent_by_member boolean, audience message_audience, audience_role app_role, audience_label text, member_read_at timestamp with time zone, member_archived_at timestamp with time zone, text_removed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.message_access_requests := public.message_access_open_request(p_request_id);
  v_tz text := public.club_timezone();
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  insert into public.message_access_views (request_id, viewed_by, viewed_by_name, kind)
  values (v_request.id, auth.uid(), public.display_name(v_me), 'listed');

  return query
  select m.id, m.created_at, coalesce(m.sender_name, 'Club'),
    m.sender_id is not distinct from v_request.subject_id,
    m.audience, m.audience_role, m.audience_label,
    r.read_at, r.archived_at, m.body_removed_at is not null
  from public.messages m
  left join public.message_recipients r on r.message_id = m.id and r.profile_id = v_request.subject_id
  where (m.sender_id = v_request.subject_id or r.profile_id is not null)
    and (m.created_at at time zone v_tz)::date between v_request.from_date and v_request.to_date
  order by m.created_at desc;
end;
$function$;

-- admin_accept_wwcc_submission(uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.admin_accept_wwcc_submission(p_submission_id uuid, p_card_name text, p_method text, p_unit_linked boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_submission public.wwcc_submissions;
  v_card_name text := nullif(trim(p_card_name), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept a Working With Children Check';
  end if;
  select * into v_submission from public.wwcc_submissions where id = p_submission_id;
  if not found then
    raise exception 'That card isn''t waiting to be checked';
  end if;
  if v_submission.profile_id = auth.uid() then
    raise exception 'Ask another admin to check your card';
  end if;
  if v_submission.status <> 'waiting' then
    raise exception 'That card isn''t waiting to be checked';
  end if;
  if v_submission.expires_on < public.club_today() then
    raise exception 'That card has expired. Send it back and ask for the new one';
  end if;
  if v_card_name is null then
    raise exception 'Enter the name as it appears on the card';
  end if;
  if length(v_card_name) > 120 then
    raise exception 'Keep the name on the card to 120 characters';
  end if;
  if p_method is null or p_method not in ('online', 'card_sighted', 'unit_letter') then
    raise exception 'Choose how you checked the card';
  end if;

  update public.profiles
  set wwcc_number = v_submission.card_number,
      wwcc_expires_on = v_submission.expires_on,
      wwcc_card_name = v_card_name,
      wwcc_validated_at = now(),
      wwcc_validated_by = auth.uid(),
      wwcc_validation_method = p_method,
      wwcc_unit_linked_at = case
        when coalesce(p_unit_linked, false) then
          case when wwcc_number is not distinct from v_submission.card_number
            then coalesce(wwcc_unit_linked_at, now()) else now() end
      end
  where id = v_submission.profile_id;

  -- The trigger below marks it recorded; this one was accepted.
  update public.wwcc_submissions
  set status = 'accepted', decided_at = now(), decided_by = auth.uid(),
      decided_by_name = public.my_display_name()
  where id = p_submission_id;
end;
$function$;

-- admin_add_no_app_child(uuid,text,date,uuid[],uuid)
CREATE OR REPLACE FUNCTION public.admin_add_no_app_child(p_guardian_id uuid, p_full_name text, p_date_of_birth date, p_team_ids uuid[] DEFAULT '{}'::uuid[], p_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_parent public.profiles;
  v_parent_approved boolean;
  v_child uuid := gen_random_uuid();
  v_teams jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add members';
  end if;
  select * into v_parent from public.profiles where id = p_guardian_id;
  if v_parent.id is null or v_parent.no_sign_in then
    raise exception 'Parent or guardian not found';
  end if;
  -- A parent who is also an admin doesn't decide who is their own child's
  -- guardian: another admin does.
  if p_guardian_id = auth.uid() then
    raise exception 'You can’t add your own child. Ask another admin';
  end if;
  v_parent_approved := v_parent.status = 'approved'
    and 'guardian' = any (public.roles_of(v_parent.role, v_parent.extra_roles));
  if not (
    v_parent_approved
    or (v_parent.status = 'pending' and v_parent.join_requested_at is not null
        and v_parent.requested_role = 'guardian')
  ) then
    raise exception 'They need to ask to join as a parent or guardian, or have the Guardian role, before you add their child';
  end if;
  if v_parent.verified_at is null then
    raise exception 'Verify who they are (their code in person, or checked against PlayHQ or ID) before adding their child';
  end if;
  if v_name = '' then
    raise exception 'Enter the child’s name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the child’s name to 80 characters';
  end if;
  if p_date_of_birth is null or p_date_of_birth > public.club_today() or p_date_of_birth < date '1900-01-01' then
    raise exception 'Add the child’s date of birth, checked against PlayHQ or ID';
  end if;
  if not public.is_minor(p_date_of_birth, false) then
    raise exception 'Only children under 18 can be added without their own sign-in. At 18 they join with their own account';
  end if;
  if p_request_id is not null and not exists (
    select 1 from public.no_app_child_requests where id = p_request_id and guardian_id = p_guardian_id
  ) then
    raise exception 'Request not found';
  end if;
  -- This season's squads and teams only; a team's squad comes with it.
  if exists (
    select 1 from unnest(coalesce(p_team_ids, '{}')) as x (id)
    where not exists (select 1 from public.teams t where t.id = x.id and not t.archived)
  ) then
    raise exception 'Members can only be added to this season''s squads and teams';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('team_id', g.id, 'team_role', 'athlete')), '[]'::jsonb)
  into v_teams
  from (
    select t.id from public.teams t where t.id = any (coalesce(p_team_ids, '{}'))
    union
    select t.squad_id from public.teams t
    where t.id = any (coalesce(p_team_ids, '{}')) and t.squad_id is not null
  ) g;

  -- The sign-in record, with no email, no login and sign-in blocked. The
  -- empty token columns are what Supabase's own sign-up writes.
  insert into auth.users (
    instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
    banned_until, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_child, 'authenticated', 'authenticated', null,
    '{"no_sign_in": true}'::jsonb, jsonb_build_object('full_name', v_name),
    'infinity', now(), now(), '', '', '', ''
  );
  -- The sign-up trigger made the profile.
  update public.profiles
  set full_name = v_name,
      date_of_birth = p_date_of_birth,
      declared_date_of_birth = p_date_of_birth,
      no_sign_in = true,
      requested_role = 'athlete',
      join_requested_at = now()
  where id = v_child;

  -- Approved as an athlete, the same way as any member. Locked
  -- (is_locked_child) for the moment, until the parent is linked below.
  perform public.admin_save_member(v_child, 'athlete', 'approved', v_teams);

  perform set_config('app.guardian_reason', 'Added by an admin as a child who won’t use the app', true);
  insert into public.guardianships (guardian_id, athlete_id) values (p_guardian_id, v_child);
  perform set_config('app.guardian_reason', '', true);

  -- A parent still asking to join is approved now, as a parent or guardian.
  if not v_parent_approved then
    perform public.admin_save_member(p_guardian_id, 'guardian', 'approved');
  end if;

  if p_request_id is not null then
    delete from public.no_app_child_requests where id = p_request_id;
  end if;
  return v_child;
end;
$function$;

-- admin_add_safeguarding_induction(integer)
CREATE OR REPLACE FUNCTION public.admin_add_safeguarding_induction(p_season integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_name constant text := 'Child Safeguarding in Sport Induction';
begin
  if not public.is_admin() then
    raise exception 'Only admins can add training';
  end if;
  if p_season is null then
    raise exception 'Choose a season';
  end if;
  select id into v_id from public.training_requirements
  where season = p_season and lower(name) = lower(v_name) and not archived;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.training_requirements (
    season, name, details, course_url, due_on, roles, all_teams, created_by
  )
  values (
    p_season, v_name,
    'Sport Integrity Australia’s free online course on keeping children safe in sport, about 45 '
      || 'minutes. Sign in or create an account, complete the course, then upload the certificate here.',
    'https://elearning.sportintegrity.gov.au/',
    public.club_today() + 90,
    array['coach', 'manager', 'physio', 'committee']::public.app_role[],
    true,
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- admin_apply_team_template(text)
CREATE OR REPLACE FUNCTION public.admin_apply_team_template(p_template text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := public.club_today();
  v_season int := case
    when extract(month from v_today) >= 5 then extract(year from v_today)::int
    else extract(year from v_today)::int - 1
  end;
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose a starting setup';
  end if;
  if p_template is null or p_template not in ('ammna_state_teams', 'wanl', 'blank') then
    raise exception 'Choose AMMNA State Teams, WA Netball League or Blank';
  end if;
  if exists (select 1 from public.teams where not archived) then
    raise exception 'Your club already has squads or teams. Add, rename or remove them instead.';
  end if;

  if p_template = 'ammna_state_teams' then
    insert into public.teams (name, kind, season, sort_order) values
      ('Mixed Open Squad', 'squad', v_season, 1),
      ('Open Squad', 'squad', v_season, 2),
      ('20 & Under Squad', 'squad', v_season, 3),
      ('17 & Under Squad', 'squad', v_season, 4);
    update public.club_settings
    set features = coalesce(features, '{}'::jsonb) - 'squads', updated_at = now()
    where id;
  elsif p_template = 'wanl' then
    insert into public.teams (name, kind, season, sort_order) values
      ('Mens Team', 'team', v_season, 1),
      ('Opens Team', 'team', v_season, 2),
      ('21 & Under Team', 'team', v_season, 3),
      ('Futures Team', 'team', v_season, 4);
    update public.club_settings
    set features = coalesce(features, '{}'::jsonb) || '{"squads": false}'::jsonb,
        updated_at = now()
    where id;
  end if;

  update public.club_settings set team_template = p_template where id;
end;
$function$;

-- admin_record_screening_notice(uuid,text,date,text)
CREATE OR REPLACE FUNCTION public.admin_record_screening_notice(p_profile_id uuid, p_kind text, p_received_on date, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_action text := nullif(trim(p_action), '');
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record a Screening Unit notice';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if p_kind is null or p_kind not in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled', 'other'
  ) then
    raise exception 'Choose what kind of notice it is';
  end if;
  if p_received_on is null or p_received_on > public.club_today() or p_received_on < date '2000-01-01' then
    raise exception 'Enter the date the notice arrived';
  end if;
  if v_action is null then
    raise exception 'Say what the club did about it';
  end if;
  if length(v_action) > 1000 then
    raise exception 'Keep it under 1000 characters';
  end if;

  insert into public.screening_notices (
    profile_id, member_name, kind, received_on, action, recorded_by, recorded_by_name
  )
  values (
    p_profile_id,
    coalesce(nullif(v_member.full_name, ''), v_member.email, 'Unnamed member'),
    p_kind, p_received_on, v_action, auth.uid(), public.my_display_name()
  )
  returning id into v_id;

  if p_kind <> 'other' and v_member.stood_down_at is null
     and public.roles_of(v_member.role, v_member.extra_roles)
       && array['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer']::public.app_role[] then
    perform public.admin_stand_down(
      p_profile_id,
      case when p_kind = 'card_cancelled' then 'other' else p_kind end,
      case when p_kind = 'card_cancelled'
        then 'Card cancelled or suspended by the Screening Unit. ' || v_action
        else v_action
      end
    );
  end if;
  return v_id;
end;
$function$;

-- admin_record_wwcc_application(uuid,text,date,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_record_wwcc_application(p_profile_id uuid, p_application_number text, p_lodged_on date, p_kind text, p_receipt_path text, p_receipt_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_number text := upper(nullif(trim(p_application_number), ''));
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record a Working With Children Check application';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if public.is_minor(v_member.date_of_birth, v_member.under_17) then
    raise exception 'Members under 18 don''t need a Working With Children Check';
  end if;
  if v_number is null or length(v_number) > 40 then
    raise exception 'Enter the application number from the receipt';
  end if;
  if p_lodged_on is null or p_lodged_on > public.club_today()
     or p_lodged_on < public.club_today() - public.wwcc_application_lapse_days() then
    raise exception 'Enter the day it was lodged, within the last % days', public.wwcc_application_lapse_days();
  end if;
  if p_kind is null or p_kind not in ('new', 'renewal') then
    raise exception 'Choose whether it''s a new check or a renewal';
  end if;
  if p_receipt_path is null
     or split_part(p_receipt_path, '/', 1) <> p_profile_id::text
     or not exists (
       select 1 from storage.objects where bucket_id = 'wwcc-receipts' and name = p_receipt_path
     ) then
    raise exception 'Attach the receipt from the Screening Unit';
  end if;
  if exists (
    select 1 from public.screening_notices n
    where n.profile_id = p_profile_id
      and n.kind in ('interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled')
      and n.received_on >= p_lodged_on
  ) then
    raise exception 'A Screening Unit notice since then bars them, so the application doesn''t count';
  end if;

  update public.wwcc_applications
  set ended_at = now(), ended_reason = 'replaced', ended_by_name = public.my_display_name()
  where profile_id = p_profile_id and ended_at is null;

  insert into public.wwcc_applications (
    profile_id, application_number, lodged_on, kind, receipt_path, receipt_name,
    recorded_by, recorded_by_name
  )
  values (
    p_profile_id, v_number, p_lodged_on, p_kind, p_receipt_path,
    nullif(trim(p_receipt_name), ''), auth.uid(), public.my_display_name()
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- admin_safety_todos()
CREATE OR REPLACE FUNCTION public.admin_safety_todos()
 RETURNS TABLE(wwcc_missing integer, wwcc_expiring integer, minors_without_guardian integer, turning_18 integer, exemptions_ending integer, athletes_without_date_of_birth integer, wwcc_to_validate integer, wwcc_to_link integer, notices_to_report integer, wwc_officer_missing integer, wwcc_people integer, child_safety_officer_missing integer, complaints_manager_missing integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with members as (
    select p.*, public.roles_of(p.role, p.extra_roles) as roles,
      -- A temporary helper needs a check only while helping: not before
      -- their first day, nor after their last.
      public.needs_wwcc(public.roles_of(p.role, p.extra_roles), p.wwcc_exempt_reason)
        and not (p.role = 'volunteer'
          and (p.volunteer_until < public.club_today() or p.volunteer_from > public.club_today())) as needs_check
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where m.needs_check and not public.is_cleared(m.id)
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < public.club_today() + 60
        and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until)
    )::int,
    -- Locked: under 18 with no approved, verified parent or guardian linked.
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and public.is_locked_child(m.id)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is not null
        and public.is_minor(m.date_of_birth, m.under_17)
        and m.date_of_birth <= public.club_today() - interval '18 years' + interval '30 days'
    )::int,
    count(*) filter (
      where m.needs_check
        and not public.has_current_wwcc(m.id)
        and exists (
          select 1 from public.volunteer_exemption_state(m.id) s
          where s.valid and s.ends_on < public.club_today() + 60
            and s.basis not in ('short_term_visitor', 'national_event')
            and not (m.role = 'volunteer' and s.ends_on > m.volunteer_until)
        )
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is null
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and (m.wwcc_validated_at is null or m.wwcc_validated_at < now() - interval '1 year')
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_unit_linked_at is null
    )::int,
    (select count(*) from public.screening_notices n
     where n.kind in ('interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled')
       and n.governing_body_told_on is null and public.is_admin())::int,
    (select count(*) from (select 1) one
     where public.is_admin() and not exists (
       select 1 from public.safeguarding_post_holders h where h.post = 'wwc_officer'))::int,
    -- Members behind wwcc_missing, wwcc_expiring, wwcc_to_validate or
    -- wwcc_to_link, each counted once. Keep these in step with those counts.
    count(*) filter (
      where m.needs_check and (
        not public.is_cleared(m.id)
        or (public.has_current_wwcc(m.id) and (
          (m.wwcc_expires_on < public.club_today() + 60
            and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until))
          or m.wwcc_validated_at is null
          or m.wwcc_validated_at < now() - interval '1 year'
          or m.wwcc_unit_linked_at is null))
      )
    )::int,
    (select count(*) from (select 1) one
     where public.is_admin() and not public.safeguarding_post_filled('child_safety_officer'))::int,
    (select count(*) from (select 1) one
     where public.is_admin() and not public.safeguarding_post_filled('complaints_manager'))::int
  from members m;
$function$;

-- admin_save_member(uuid,app_role,member_status,jsonb,boolean,uuid[],rejection_reason,app_role[],text)
CREATE OR REPLACE FUNCTION public.admin_save_member(p_profile_id uuid, p_role app_role, p_status member_status, p_teams jsonb DEFAULT '[]'::jsonb, p_under_17 boolean DEFAULT false, p_guardian_ids uuid[] DEFAULT '{}'::uuid[], p_rejection_reason rejection_reason DEFAULT NULL::rejection_reason, p_extra_roles app_role[] DEFAULT '{}'::app_role[], p_guardian_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_roles public.app_role[] := public.roles_of(p_role, coalesce(p_extra_roles, '{}'));
  v_extra public.app_role[];
  v_default_team_role public.team_role;
  v_placements jsonb;
  v_date_of_birth date;
  v_under_17 boolean;
  v_problem text;
  v_guardian_ids uuid[] := coalesce(p_guardian_ids, '{}');
  v_was_committee boolean;
  v_was_admin boolean;
  v_was_statistician boolean;
  v_was_guardian boolean;
  v_verified boolean;
  v_current_guardians uuid[];
  v_new_guardians uuid[];
  v_exempt_reason text;
  v_volunteer public.profiles;
  v_teams jsonb;
  v_followed uuid[] := '{}';
  v_was_approved boolean;
  v_declared_date_of_birth date;
  v_no_sign_in boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_status = 'approved' and not exists (
    select 1 from public.profiles where id = p_profile_id and nullif(trim(full_name), '') is not null
  ) then
    raise exception 'They have no name yet. Ask them to add their name before approving them';
  end if;
  v_extra := v_roles[2:];
  select
    date_of_birth,
    status = 'approved' and 'committee' = any (public.roles_of(role, extra_roles)),
    status = 'approved' and 'admin' = any (public.roles_of(role, extra_roles)),
    status = 'approved' and 'statistician' = any (public.roles_of(role, extra_roles)),
    status = 'approved' and 'guardian' = any (public.roles_of(role, extra_roles)),
    verified_at is not null,
    wwcc_exempt_reason,
    status = 'approved',
    declared_date_of_birth,
    no_sign_in
  into v_date_of_birth, v_was_committee, v_was_admin, v_was_statistician, v_was_guardian, v_verified, v_exempt_reason,
    v_was_approved, v_declared_date_of_birth, v_no_sign_in
  from public.profiles where id = p_profile_id;
  -- Nobody under 13 joins this year (Matt, 18 November 2026), whichever date
  -- says so: the one the admin checked or the one given at join. Members
  -- already approved keep their approval. A child who never signs in (added
  -- by admin_add_no_app_child) may be under 13 (19 November 2026).
  if p_status = 'approved' and not coalesce(v_was_approved, false)
     and not coalesce(v_no_sign_in, false)
     and (public.is_under_13(v_date_of_birth) or public.is_under_13(v_declared_date_of_birth)) then
    raise exception 'They''re under 13. FirstPass HQ is for members aged 13 and over, so decline their request';
  end if;
  v_under_17 := 'athlete' = any (v_roles) and public.is_minor(v_date_of_birth, p_under_17);

  if p_profile_id = auth.uid() and (not 'admin' = any (v_roles) or p_status <> 'approved') then
    raise exception 'Admins cannot remove their own admin access';
  end if;
  if coalesce(v_no_sign_in, false) and v_roles <> array['athlete']::public.app_role[] then
    raise exception 'A child who doesn''t use the app can only be an athlete';
  end if;
  v_problem := public.role_combination_problem(v_roles, v_date_of_birth, p_under_17);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if jsonb_typeof(p_teams) <> 'array' then
    raise exception 'p_teams must be a JSON array';
  end if;
  if cardinality(v_guardian_ids) > 0 and not v_under_17 then
    raise exception 'Only athletes under 18 have guardians';
  end if;
  if p_profile_id = any (v_guardian_ids) then
    raise exception 'A member cannot be their own guardian';
  end if;
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    where not exists (
      select 1 from public.profiles p
      where p.id = g.id and p.status = 'approved'
        and (p.role = 'guardian' or 'guardian' = any (p.extra_roles))
    )
  ) then
    raise exception 'Guardians must be approved members with the Guardian role';
  end if;
  -- Links that already exist are kept; new ones need a verified guardian.
  if exists (
    select 1 from unnest(v_guardian_ids) as g (id)
    join public.profiles p on p.id = g.id
    where p.verified_at is null
      and not exists (
        select 1 from public.guardianships l
        where l.guardian_id = g.id and l.athlete_id = p_profile_id
      )
  ) then
    raise exception 'Verify a guardian (code in person, or checked against PlayHQ) before linking them to a child';
  end if;
  -- Whether an athlete is a child is never guessed: approving one needs the
  -- date of birth an admin has checked.
  if p_status = 'approved' and 'athlete' = any (v_roles) and v_date_of_birth is null then
    raise exception 'Add their date of birth, checked against PlayHQ or ID, before approving an athlete';
  end if;
  -- Guests get no child-safety protections (no guardian link, copies or
  -- consents), so the Guest role is for adults (Matt, 19 October 2026).
  if p_status = 'approved' and 'guest' = any (v_roles) then
    if v_date_of_birth is null then
      raise exception 'Add their date of birth, checked against PlayHQ or ID, before approving a guest';
    end if;
    if public.is_minor(v_date_of_birth, false) then
      raise exception 'Guests must be 18 or over. Approve them as an athlete with a parent or guardian linked instead';
    end if;
  end if;
  -- An athlete under 18 can be approved before a guardian is linked: they're
  -- locked (is_locked_child) until a verified guardian is (Matt, 20 October
  -- 2026).
  -- A parent or guardian is approved after their child: verified, with at
  -- least one approved child who gave them their code or is linked to them.
  -- Guardians approved before keep their approval.
  if p_status = 'approved' and 'guardian' = any (v_roles) and not coalesce(v_was_guardian, false) then
    if not coalesce(v_verified, false) then
      raise exception 'Verify who they are (their code in person, or checked against PlayHQ or ID) before approving a parent or guardian';
    end if;
    if not exists (
      select 1 from (
        select r.athlete_id from public.guardian_link_requests r where r.guardian_id = p_profile_id
        union
        select g.athlete_id from public.guardianships g where g.guardian_id = p_profile_id
      ) c
      join public.profiles child on child.id = c.athlete_id
      where child.status = 'approved'
        and 'athlete' = any (public.roles_of(child.role, child.extra_roles))
        and public.is_minor(child.date_of_birth, child.under_17)
    ) then
      if exists (select 1 from public.guardian_link_requests r where r.guardian_id = p_profile_id) then
        raise exception 'Approve their child first. A parent or guardian is approved after at least one of their children';
      end if;
      if exists (select 1 from public.no_app_child_requests r where r.guardian_id = p_profile_id) then
        raise exception 'Add their child who won’t use the app first, under Children to add on this page. They''re approved with them';
      end if;
      raise exception 'They haven’t entered their child’s link code yet. Their child sees the code in the app; a parent or guardian needs at least one approved child before they''re approved';
    end if;
  end if;
  if p_status = 'approved' and v_roles && array['coach', 'manager', 'physio']::public.app_role[]
     and not public.has_current_wwcc(p_profile_id)
     and not exists (
       select 1 from public.volunteer_exemptions
       where profile_id = p_profile_id and ended_at is null
     )
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check, an application they''ve lodged, or a volunteer exemption, before approving a coach, manager or physio';
  end if;
  -- Committee members approved before checks were needed keep their access;
  -- the admin's to-do list asks for their check instead.
  if p_status = 'approved' and 'committee' = any (v_roles) and not coalesce(v_was_committee, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id)
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check or an application they''ve lodged, or exempt them with a reason, before making them a committee member';
  end if;
  -- The same for admins, who can read every child's records. Admins approved
  -- before this keep their access; the to-do list asks for their check.
  if p_status = 'approved' and 'admin' = any (v_roles) and not coalesce(v_was_admin, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.has_current_wwcc(p_profile_id)
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check or an application they''ve lodged, or exempt them with a reason, before making them an admin';
  end if;
  -- And for statisticians, who may sit courtside at junior games. Those
  -- approved before this keep the role until the club's statistician checks
  -- date; the to-do list asks for their check.
  if p_status = 'approved' and 'statistician' = any (v_roles) and not coalesce(v_was_statistician, false)
     and public.needs_wwcc(v_roles, v_exempt_reason)
     and not public.is_cleared(p_profile_id)
     and not exists (
       select 1 from public.volunteer_exemptions
       where profile_id = p_profile_id and ended_at is null
     )
     and not public.wwcc_application_open(p_profile_id) then
    raise exception 'Record a current Working With Children Check, an application they''ve lodged or a volunteer exemption, or exempt them with a reason, before making them a statistician';
  end if;
  -- A temporary helper is approved once they've accepted the club's
  -- policies and a check or an accepted exemption covers every day they'll
  -- help. One already approved keeps their approval.
  if p_status = 'approved' and 'volunteer' = any (v_roles) then
    select * into v_volunteer from public.profiles where id = p_profile_id;
    if not (v_volunteer.status = 'approved' and v_volunteer.role = 'volunteer') then
      if public.volunteer_details_problem(
           v_volunteer.volunteer_task, v_volunteer.volunteer_from, v_volunteer.volunteer_until
         ) is not null then
        raise exception 'Add what they''ll help with and their first and last day before approving a temporary helper';
      end if;
      if v_volunteer.volunteer_until < public.club_today() then
        raise exception 'Their last day has passed. Change their dates before approving them.';
      end if;
      if not public.has_acknowledged_policies(p_profile_id) then
        raise exception 'They need to accept the club''s code of conduct and safeguarding policy in the app before you approve them';
      end if;
      if not public.volunteer_covered(p_profile_id, v_volunteer.volunteer_from, v_volunteer.volunteer_until) then
        raise exception 'Record a current Working With Children Check that lasts to their last day, or an exemption they''ve accepted that covers all their dates, before approving a temporary helper';
      end if;
    end if;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_teams) as t
    where not exists (
      select 1 from public.teams g where g.id = (t ->> 'team_id')::uuid and not g.archived
    )
  ) then
    raise exception 'Members can only be added to this season''s squads and teams';
  end if;

  update public.profiles
  set role = p_role,
      extra_roles = v_extra,
      status = p_status,
      under_17 = v_under_17,
      rejection_reason = case when p_status = 'rejected' then p_rejection_reason end
  where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Guardian links: only the ones that change are added or removed, so the
  -- history (written by a trigger) shows real changes, with the reason.
  if length(p_guardian_reason) > 500 then
    raise exception 'Keep the reason under 500 characters';
  end if;
  perform set_config('app.guardian_reason', coalesce(nullif(trim(p_guardian_reason), ''), ''), true);
  select coalesce(array_agg(guardian_id order by guardian_id), '{}') into v_current_guardians
  from public.guardianships where athlete_id = p_profile_id;
  select coalesce(array_agg(distinct g.id order by g.id), '{}') into v_new_guardians
  from unnest(case when p_status = 'approved' then v_guardian_ids else '{}'::uuid[] end) as g (id);
  -- A parent who is also an admin doesn't decide who else is their child's
  -- guardian: another admin does.
  if v_current_guardians is distinct from v_new_guardians
     and auth.uid() = any (v_current_guardians || v_new_guardians) then
    raise exception 'You''re one of their guardians, so another admin needs to change who their guardians are';
  end if;
  delete from public.guardianships
  where athlete_id = p_profile_id and not guardian_id = any (v_new_guardians);
  if not 'guardian' = any (v_roles) or p_status <> 'approved' then
    delete from public.guardianships where guardian_id = p_profile_id;
  end if;
  insert into public.guardianships (guardian_id, athlete_id)
  select g.id, p_profile_id from unnest(v_new_guardians) as g (id)
  on conflict do nothing;
  -- A parent or guardian approved now is linked to the approved children who
  -- gave them their code.
  if p_status = 'approved' and 'guardian' = any (v_roles) and not coalesce(v_was_guardian, false) then
    perform set_config('app.guardian_reason', 'Entered the child’s link code', true);
    insert into public.guardianships (guardian_id, athlete_id)
    select p_profile_id, r.athlete_id
    from public.guardian_link_requests r
    join public.profiles child on child.id = r.athlete_id
    where r.guardian_id = p_profile_id
      and child.status = 'approved'
      and 'athlete' = any (public.roles_of(child.role, child.extra_roles))
      and public.is_minor(child.date_of_birth, child.under_17)
    on conflict do nothing;
  end if;
  perform set_config('app.guardian_reason', '', true);


  if p_status <> 'approved' then
    delete from public.team_members m
    using public.teams g
    where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived;
    return;
  end if;

  -- A guardian's placement in a squad or team their child under 18 is in is
  -- the database's (guardians follow their child into teams, 20 October, and
  -- squads, 20261101000000), not the admin's.
  -- The member page sends it back like any other, so it is set aside here:
  -- it stays without the squad (guardian data audit, 29 October: saving a
  -- guardian or a coach-parent failed the squad rules below) and isn't
  -- removed by a save that leaves it out.
  if 'guardian' = any (v_roles) then
    select coalesce(array_agg(distinct a.team_id), '{}') into v_followed
    from public.guardianships l
    join public.profiles c on c.id = l.athlete_id
    join public.team_members a on a.profile_id = l.athlete_id and a.team_role = 'athlete'
    join public.teams t on t.id = a.team_id and not t.archived
    where l.guardian_id = p_profile_id
      and public.is_minor(c.date_of_birth, c.under_17);
  end if;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_teams
  from jsonb_array_elements(p_teams) as t
  where not (t ->> 'team_role' = 'guardian'
             and (t ->> 'team_id')::uuid = any (v_followed));

  if jsonb_array_length(v_teams) > 0 then
    select r::text::public.team_role into v_default_team_role
    from unnest(v_roles) with ordinality as x (r, n)
    where r in ('coach', 'manager', 'athlete', 'guardian', 'physio')
    order by n
    limit 1;
    if v_default_team_role is null then
      raise exception 'Only coaches, managers, physios, athletes and guardians can be added to a squad or team';
    end if;
  end if;

  select coalesce(jsonb_agg(t || jsonb_build_object(
    'team_role', coalesce(t ->> 'team_role', v_default_team_role::text),
    'kind', g.kind,
    'squad_id', g.squad_id
  )), '[]'::jsonb)
  into v_placements
  from jsonb_array_elements(v_teams) as t
  join public.teams g on g.id = (t ->> 'team_id')::uuid;

  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where not (p ->> 'team_role')::public.app_role = any (v_roles)
       or p ->> 'team_role' not in ('coach', 'manager', 'athlete', 'guardian', 'physio')
  ) then
    raise exception 'Give them that role before adding them to a squad or team with it';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    where p ->> 'squad_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_placements) as s
        where s ->> 'team_id' = p ->> 'squad_id'
      )
  ) then
    raise exception 'Add them to the squad before naming them in one of its teams';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_placements) as p
    join jsonb_array_elements(v_placements) as s on s ->> 'team_id' = p ->> 'squad_id'
    where p ->> 'team_role' <> s ->> 'team_role'
  ) then
    raise exception 'Their role in a team must match their role in its squad';
  end if;

  -- Only the placements that change are removed and added, so a save that
  -- changes nothing doesn't tell parents their child left their team and
  -- rejoined it (What's changed). A followed team stays unless the admin
  -- names the guardian in it in another role (a coach-parent made its coach).
  delete from public.team_members m
  using public.teams g
  where m.profile_id = p_profile_id and g.id = m.team_id and not g.archived
    and not exists (
      select 1 from jsonb_array_elements(v_placements) as p
      where (p ->> 'team_id')::uuid = m.team_id and p ->> 'team_role' = m.team_role::text
    )
    and not (
      m.team_role = 'guardian'
      and m.team_id = any (v_followed)
      and not exists (
        select 1 from jsonb_array_elements(v_placements) as p
        where (p ->> 'team_id')::uuid = m.team_id
      )
    );

  update public.team_members m
  set coach_title = case when p ->> 'team_role' = 'coach'
        then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach')
      end,
      selection = case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
        then coalesce((p ->> 'selection')::public.team_selection, 'touring')
      end
  from jsonb_array_elements(v_placements) as p
  where m.profile_id = p_profile_id
    and m.team_id = (p ->> 'team_id')::uuid
    and m.team_role::text = p ->> 'team_role'
    and (m.coach_title is distinct from case when p ->> 'team_role' = 'coach'
           then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach') end
      or m.selection is distinct from case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
           then coalesce((p ->> 'selection')::public.team_selection, 'touring') end);

  insert into public.team_members (team_id, profile_id, team_role, coach_title, selection)
  select
    (p ->> 'team_id')::uuid,
    p_profile_id,
    (p ->> 'team_role')::public.team_role,
    case when p ->> 'team_role' = 'coach'
      then coalesce((p ->> 'coach_title')::public.coach_title, 'head_coach')
    end,
    case when p ->> 'team_role' = 'athlete' and p ->> 'kind' = 'team'
      then coalesce((p ->> 'selection')::public.team_selection, 'touring')
    end
  from jsonb_array_elements(v_placements) as p
  where not exists (
    select 1 from public.team_members m
    where m.team_id = (p ->> 'team_id')::uuid and m.profile_id = p_profile_id
  );

  -- A parent or guardian is placed in their children's squads and teams, so
  -- one approved now, or saved after a coaching place ended, is with them.
  if 'guardian' = any (v_roles) then
    perform public.place_guardians_with_athlete(m.team_id, g.athlete_id)
    from public.guardianships g
    join public.team_members m on m.profile_id = g.athlete_id and m.team_role = 'athlete'
    join public.teams t on t.id = m.team_id and not t.archived
    where g.guardian_id = p_profile_id;
  end if;
end;
$function$;

-- admin_save_policy(uuid,text,uuid,text,text,date,text)
CREATE OR REPLACE FUNCTION public.admin_save_policy(p_id uuid, p_title text, p_owner_id uuid, p_version text, p_link text, p_review_on date, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_link text := public.check_policy_link(p_link);
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the policy register';
  end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Name the policy, in up to 120 characters';
  end if;
  if p_review_on is null then
    raise exception 'Choose when the policy is next reviewed';
  end if;
  if p_review_on > public.club_today() + interval '5 years' then
    raise exception 'Choose a review date within 5 years';
  end if;
  if p_owner_id is not null and not public.can_own_policy(p_owner_id) then
    raise exception 'The owner must be an approved adult member of the club';
  end if;
  if length(coalesce(p_version, '')) > 30 then
    raise exception 'Keep the version to 30 characters';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Keep the notes to 1,000 characters';
  end if;

  if p_id is null then
    insert into public.policy_register (title, owner_id, version, link, review_on, notes, created_by, updated_by)
    values (trim(p_title), p_owner_id, nullif(trim(p_version), ''), v_link, p_review_on,
      nullif(trim(p_notes), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.policy_register r
    set title = trim(p_title), owner_id = p_owner_id, version = nullif(trim(p_version), ''), link = v_link,
      review_on = p_review_on, notes = nullif(trim(p_notes), ''), updated_by = auth.uid(), updated_at = now()
    where r.id = p_id
    returning r.id into v_id;
    if v_id is null then
      raise exception 'Policy not found';
    end if;
  end if;
  return v_id;
end;
$function$;

-- admin_screening_notice_reported(uuid,date)
CREATE OR REPLACE FUNCTION public.admin_screening_notice_reported(p_notice_id uuid, p_told_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change a Screening Unit notice';
  end if;
  if p_told_on is null or p_told_on > public.club_today() then
    raise exception 'Enter the date you told the governing body';
  end if;
  if p_told_on < (select received_on from public.screening_notices where id = p_notice_id) then
    raise exception 'That''s before the notice arrived';
  end if;
  update public.screening_notices
  set governing_body_told_on = p_told_on,
      governing_body_told_by_name = public.my_display_name()
  where id = p_notice_id and governing_body_told_on is null;
  if not found then
    raise exception 'That notice isn''t waiting to be reported';
  end if;
end;
$function$;

-- admin_sees_children_injuries(uuid)
CREATE OR REPLACE FUNCTION public.admin_sees_children_injuries(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_cleared(p_profile_id) or exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and (
      (coalesce(trim(p.wwcc_number), '') <> '' and p.wwcc_expires_on >= public.club_today() - 30)
      or (
        coalesce(trim(p.wwcc_number), '') = ''
        and public.club_today() < coalesce(public.committee_checks_from() + 30, public.club_today() + 1)
      )
    )
  );
$function$;

-- admin_set_member_details(uuid,date,text,date)
CREATE OR REPLACE FUNCTION public.admin_set_member_details(p_profile_id uuid, p_date_of_birth date, p_wwcc_number text, p_wwcc_expires_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_number text := nullif(upper(trim(p_wwcc_number)), '');
  v_member public.profiles;
  v_new_card boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change members';
  end if;
  if p_date_of_birth is not null
     and (p_date_of_birth > public.club_today() or p_date_of_birth < date '1900-01-01') then
    raise exception 'That date of birth doesn''t look right';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to change your date of birth or card details';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  v_new_card := v_member.wwcc_number is distinct from v_number
    or v_member.wwcc_expires_on is distinct from p_wwcc_expires_on;
  -- Cards last three years, so a later expiry is a typing mistake.
  if v_new_card and p_wwcc_expires_on > (public.club_today() + interval '3 years')::date then
    raise exception 'A Working With Children Check lasts three years. Check the expiry date on the card';
  end if;

  update public.profiles
  set date_of_birth_recorded_by = case
        when date_of_birth is distinct from p_date_of_birth then auth.uid()
        else date_of_birth_recorded_by
      end,
      date_of_birth_recorded_at = case
        when date_of_birth is distinct from p_date_of_birth then now()
        else date_of_birth_recorded_at
      end,
      date_of_birth = p_date_of_birth,
      wwcc_number = v_number,
      wwcc_expires_on = p_wwcc_expires_on,
      -- A different card hasn't been validated or linked yet.
      wwcc_validated_at = case when v_new_card then null else wwcc_validated_at end,
      wwcc_validated_by = case when v_new_card then null else wwcc_validated_by end,
      wwcc_validation_method = case when v_new_card then null else wwcc_validation_method end,
      wwcc_unit_linked_at = case when v_new_card then null else wwcc_unit_linked_at end
  where id = p_profile_id;
end;
$function$;

-- admin_set_volunteer_exemption(uuid,volunteer_exemption,uuid,date,text,text)
CREATE OR REPLACE FUNCTION public.admin_set_volunteer_exemption(p_profile_id uuid, p_basis volunteer_exemption, p_child_id uuid DEFAULT NULL::uuid, p_starts_on date DEFAULT NULL::date, p_event_name text DEFAULT NULL::text, p_organiser text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_child public.profiles;
  v_open public.volunteer_exemptions;
  v_has_open boolean;
  v_me text;
  v_event text := nullif(trim(coalesce(p_event_name, '')), '');
  v_organiser text := nullif(trim(coalesce(p_organiser, '')), '');
  v_dated boolean := p_basis in ('short_term_visitor', 'national_event');
  v_last date;
  v_earlier public.volunteer_exemptions;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record exemptions';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;

  if p_basis = 'under_18_volunteer' then
    if v_member.date_of_birth is null then
      raise exception 'Add their date of birth first';
    end if;
    if not public.is_minor(v_member.date_of_birth, false) then
      raise exception 'They''re 18 or over, so they need a Working With Children Check';
    end if;
    p_child_id := null;
  elsif p_basis = 'parent_volunteer' then
    select * into v_child from public.profiles where id = p_child_id;
    if not found or v_child.status <> 'approved'
       or not 'athlete' = any (public.roles_of(v_child.role, v_child.extra_roles))
       or not public.is_minor(v_child.date_of_birth, v_child.under_17) then
      raise exception 'Choose their child: an athlete under 18 in the club';
    end if;
    -- A temporary helper holds no other role, so can't be linked as a
    -- guardian; the admin names the child instead (Matt, 19 October 2026).
    if v_member.role <> 'volunteer' and not exists (
      select 1 from public.guardianships
      where guardian_id = p_profile_id and athlete_id = p_child_id
    ) then
      raise exception 'Link them as a guardian of that athlete first';
    end if;
  else
    p_child_id := null;
    if p_starts_on is null then
      raise exception '%', case p_basis
        when 'short_term_visitor' then 'Enter the day they arrived in WA'
        else 'Enter the first day of the event or tour' end;
    end if;
    v_last := public.exemption_last_day(p_basis, p_starts_on);
    if v_last < public.club_today() then
      raise exception '%', case p_basis
        when 'short_term_visitor' then 'The two weeks after they arrived in WA have passed, so they need a Working With Children Check'
        else 'Those 30 days have passed, so they need a Working With Children Check' end;
    end if;
    if p_starts_on > public.club_today() + interval '2 years' then
      raise exception 'That first day is too far ahead';
    end if;
    if p_basis = 'national_event' then
      if v_event is null or v_organiser is null then
        raise exception 'Enter the event or tour, and the body organising it';
      end if;
      if length(v_event) > 200 or length(v_organiser) > 200 then
        raise exception 'Keep the event and organiser under 200 characters each';
      end if;
    end if;
  end if;
  if not v_dated then
    p_starts_on := null;
  end if;
  if p_basis <> 'national_event' then
    v_event := null;
    v_organiser := null;
  end if;

  select * into v_open from public.volunteer_exemptions
  where profile_id = p_profile_id and ended_at is null
  for update;
  v_has_open := found;
  if v_has_open and v_open.basis = p_basis
     and v_open.child_id is not distinct from p_child_id
     and v_open.starts_on is not distinct from p_starts_on
     and v_open.event_name is not distinct from v_event
     and v_open.organiser is not distinct from v_organiser then
    return;
  end if;

  -- One visitor or national event exemption in any 12 months. One counts
  -- once they've accepted it and it has started; one replaced before its
  -- first day was never used.
  if v_dated then
    select * into v_earlier from public.volunteer_exemptions e
    where e.profile_id = p_profile_id
      and e.basis in ('short_term_visitor', 'national_event')
      and e.declared_at is not null
      and e.starts_on <= coalesce((e.ended_at at time zone public.club_timezone())::date, public.club_today())
      and p_starts_on <= public.exemption_last_day(e.basis, e.starts_on) + interval '12 months'
      and e.starts_on <= v_last + interval '12 months'
    order by e.starts_on desc
    limit 1;
    if found then
      raise exception 'They used the % exemption from % to %. Only one short-term visitor or national event exemption is allowed in 12 months, so they need a Working With Children Check.',
        case v_earlier.basis when 'short_term_visitor' then 'short-term visitor' else 'national event' end,
        to_char(v_earlier.starts_on, 'DD/MM/YYYY'),
        to_char(public.exemption_last_day(v_earlier.basis, v_earlier.starts_on), 'DD/MM/YYYY');
    end if;
  end if;

  v_me := public.member_display_name(auth.uid());

  if v_has_open then
    update public.volunteer_exemptions
    set ended_at = now(), ended_by = auth.uid(), ended_by_name = v_me,
        end_note = 'Replaced by a new exemption'
    where id = v_open.id;
  end if;

  insert into public.volunteer_exemptions (
    profile_id, basis, child_id, child_name, set_by, set_by_name, starts_on, event_name, organiser
  )
  values (
    p_profile_id, p_basis, p_child_id,
    case when p_basis = 'parent_volunteer'
      then coalesce(nullif(trim(v_child.preferred_name), ''), nullif(trim(v_child.full_name), ''), 'their child')
    end,
    auth.uid(), v_me, p_starts_on, v_event, v_organiser
  );
end;
$function$;

-- admin_validate_wwcc(uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.admin_validate_wwcc(p_profile_id uuid, p_card_name text, p_method text, p_unit_linked boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.profiles;
  v_card_name text := nullif(trim(p_card_name), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can validate a Working With Children Check';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to validate your card';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_member.wwcc_number is null or v_member.wwcc_expires_on is null then
    raise exception 'Save their card number and expiry first';
  end if;
  if v_member.wwcc_expires_on < public.club_today() then
    raise exception 'That card has expired';
  end if;
  if v_card_name is null then
    raise exception 'Enter the name as it appears on the card';
  end if;
  if length(v_card_name) > 120 then
    raise exception 'Keep the name on the card to 120 characters';
  end if;
  if p_method is null or p_method not in ('online', 'card_sighted', 'unit_letter') then
    raise exception 'Choose how you checked the card';
  end if;

  update public.profiles
  set wwcc_card_name = v_card_name,
      wwcc_validated_at = now(),
      wwcc_validated_by = auth.uid(),
      wwcc_validation_method = p_method,
      wwcc_unit_linked_at = case
        when coalesce(p_unit_linked, false) then coalesce(wwcc_unit_linked_at, now())
      end
  where id = p_profile_id;
end;
$function$;

-- admin_wwcc_applications()
CREATE OR REPLACE FUNCTION public.admin_wwcc_applications()
 RETURNS TABLE(id uuid, profile_id uuid, member_name text, application_number text, lodged_on date, kind text, receipt_path text, receipt_name text, recorded_at timestamp with time zone, recorded_by_name text, declared_at timestamp with time zone, checked_at timestamp with time zone, checked_by_name text, check_due_on date, lapses_on date, status text, ended_at timestamp with time zone, ended_reason text, ended_by_name text, end_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.profile_id,
    coalesce(nullif(p.full_name, ''), p.email, 'Unnamed member'),
    a.application_number, a.lodged_on, a.kind,
    -- Only admins open receipts.
    case when public.is_admin() then a.receipt_path end,
    a.receipt_name,
    a.recorded_at, a.recorded_by_name, a.declared_at, a.checked_at, a.checked_by_name,
    (coalesce(a.checked_at, a.recorded_at) at time zone public.club_timezone())::date
      + public.wwcc_application_check_days(),
    (coalesce(a.checked_at, a.recorded_at) at time zone public.club_timezone())::date
      + public.wwcc_application_lapse_days(),
    public.wwcc_application_status(a),
    a.ended_at, a.ended_reason, a.ended_by_name, a.end_note
  from public.wwcc_applications a
  join public.profiles p on p.id = a.profile_id
  where public.can_read_reports()
    and (a.ended_at is null or a.ended_at > now() - interval '1 year')
  order by a.ended_at is not null, a.lodged_on desc;
$function$;

-- award_age_day(awards)
CREATE OR REPLACE FUNCTION public.award_age_day(p_award awards)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(p_award.nominee_age_on, (p_award.closes_at at time zone public.club_timezone())::date);
$function$;

-- close_wwcc_submission_on_card()
CREATE OR REPLACE FUNCTION public.close_wwcc_submission_on_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(trim(new.wwcc_number), '') <> '' and new.wwcc_expires_on >= public.club_today()
     and (new.wwcc_number is distinct from old.wwcc_number
       or new.wwcc_expires_on is distinct from old.wwcc_expires_on) then
    update public.wwcc_submissions
    set status = 'recorded', decided_at = now(), decided_by = auth.uid(),
        decided_by_name = public.my_display_name()
    where profile_id = new.id and status = 'waiting';
  end if;
  return new;
end;
$function$;

-- conduct_season()
CREATE OR REPLACE FUNCTION public.conduct_season()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select max(t.season) from public.teams t where not t.archived),
    (select max(t.season) from public.teams t),
    extract(year from public.club_today())::int
  );
$function$;

-- end_wwcc_application_on_card()
CREATE OR REPLACE FUNCTION public.end_wwcc_application_on_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(trim(new.wwcc_number), '') <> '' and new.wwcc_expires_on >= public.club_today()
     and (new.wwcc_number is distinct from old.wwcc_number
       or new.wwcc_expires_on is distinct from old.wwcc_expires_on) then
    update public.wwcc_applications
    set ended_at = now(), ended_reason = 'card_recorded', ended_by_name = public.my_display_name()
    where profile_id = new.id and ended_at is null;
  end if;
  return new;
end;
$function$;

-- expired_session_plan_files()
CREATE OR REPLACE FUNCTION public.expired_session_plan_files()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select f.path
  from public.session_plan_files f
  join public.session_plans p on p.id = f.plan_id
  join public.club_settings s on s.retention_enabled
  where p.session_on < (public.club_today() - make_interval(months => s.retention_attendance_months))::date;
$function$;

-- guardianship_changed()
CREATE OR REPLACE FUNCTION public.guardianship_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_guardian_id uuid := case when tg_op = 'INSERT' then new.guardian_id else old.guardian_id end;
  v_athlete_id uuid := case when tg_op = 'INSERT' then new.athlete_id else old.athlete_id end;
  v_change text := case when tg_op = 'INSERT' then 'linked' else 'unlinked' end;
  v_guardian text := coalesce(public.member_display_name(v_guardian_id), 'A former member');
  v_athlete public.profiles;
  v_athlete_name text := coalesce(public.member_display_name(v_athlete_id), 'A former member');
  v_by text := public.member_display_name(auth.uid());
  v_reason text := nullif(current_setting('app.guardian_reason', true), '');
  v_recipients uuid[];
  v_message_id uuid;
begin
  insert into public.guardianship_history (
    guardian_id, guardian_name, athlete_id, athlete_name, change, reason, changed_by, changed_by_name
  )
  values (
    v_guardian_id, v_guardian, v_athlete_id, v_athlete_name, v_change, v_reason, auth.uid(), v_by
  );

  -- Linked: their request to be linked is done.
  if tg_op = 'INSERT' then
    delete from public.guardian_link_requests
    where guardian_id = new.guardian_id and athlete_id = new.athlete_id;
  end if;

  -- No notice when the child is leaving or has left the club, or isn't
  -- approved.
  select * into v_athlete from public.profiles where id = v_athlete_id;
  if v_athlete.id is null or v_athlete.status <> 'approved'
     or v_athlete_id::text = current_setting('app.deleting_profile', true) then
    return null;
  end if;

  -- The child's last verified parent or guardian went (unlinked, no longer
  -- approved, or deleted their account), so the child is locked again: every
  -- admin is told.
  if tg_op = 'DELETE'
     and exists (select 1 from public.profiles where id = v_guardian_id and verified_at is not null)
     and public.is_locked_child(v_athlete_id) then
    insert into public.messages (sender_id, sender_name, body, audience, audience_label)
    values (
      null,
      'Club safeguarding',
      case when v_athlete.no_sign_in then
        -- A child who doesn't use the app has no app to lock and no link
        -- code: only an admin can link another parent or guardian.
        v_athlete_name || ' is under 18, doesn’t use the app, and no longer has a verified parent '
        || 'or guardian linked (' || v_guardian || ' was the last). Nobody can report their '
        || 'absences or injuries, give consent or answer surveys for them until one is. Link '
        || 'another parent or guardian from ' || v_athlete_name || '’s page in Members.'
      else
        v_athlete_name || ' is under 18 and no longer has a verified parent or guardian linked ('
        || v_guardian || ' was the last). Their app is locked until one is: they see only a link '
        || 'code to share with a parent or guardian. Approve the parent or guardian who enters it, '
        || 'or link one from ' || v_athlete_name || '’s page in Members.'
      end,
      'notice',
      'Admins'
    )
    returning id into v_message_id;
    insert into public.message_recipients (message_id, profile_id)
    select v_message_id, p.id from public.profiles p
    where p.status = 'approved' and 'admin' = any (public.roles_of(p.role, p.extra_roles))
    on conflict do nothing;
  end if;

  select coalesce(array_agg(g.guardian_id), '{}') into v_recipients
  from public.guardianships g
  join public.profiles p on p.id = g.guardian_id and p.status = 'approved'
  where g.athlete_id = v_athlete_id;
  if cardinality(v_recipients) = 0 then
    return null;
  end if;
  if v_athlete.date_of_birth is not null
     and v_athlete.date_of_birth <= public.club_today() - interval '13 years' then
    v_recipients := v_recipients || v_athlete.id;
  end if;

  insert into public.messages (sender_id, sender_name, body, audience, audience_label)
  values (
    null,
    'Club safeguarding',
    case v_change
      when 'linked' then
        v_guardian || ' is now linked to ' || v_athlete_name || ' as a parent or guardian. '
        || 'Guardians can see ' || v_athlete_name
        || '''s injuries, check-ins, goals and messages from the club.'
      else
        v_guardian || ' is no longer linked to ' || v_athlete_name || ' as a parent or guardian.'
    end
    || case when v_by is not null
         then ' Changed by ' || v_by || ' on '
           || to_char(now() at time zone public.club_timezone(), 'DD/MM/YYYY') || '.'
         else '' end
    || ' If this isn''t right, tell the club''s Child Safety Officer or an admin.',
    'notice',
    'Parents and guardians of ' || v_athlete_name
  )
  returning id into v_message_id;

  insert into public.message_recipients (message_id, profile_id)
  select v_message_id, r from unnest(v_recipients) as r
  on conflict do nothing;

  return null;
end;
$function$;

-- has_current_wwcc(uuid)
CREATE OR REPLACE FUNCTION public.has_current_wwcc(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles
    where id = p_profile_id
      and coalesce(trim(wwcc_number), '') <> ''
      and wwcc_expires_on >= public.club_today()
  );
$function$;

-- has_role(app_role)
CREATE OR REPLACE FUNCTION public.has_role(p_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved'
      and (p.role = p_role or p_role = any (p.extra_roles))
      and not (public.is_minor(p.date_of_birth, p.under_17) and public.is_locked_child(p.id))
      and case
        when p_role in ('coach', 'manager', 'physio') then
          p.stood_down_at is null and public.is_cleared(p.id)
        when p_role = 'committee' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and public.club_today() < coalesce(public.committee_checks_from(), public.club_today() + 1)
            )
            or public.has_current_wwcc(p.id)
            or public.wwcc_application_valid(p.id)
          )
        when p_role = 'statistician' then
          p.stood_down_at is null and (
            coalesce(trim(p.wwcc_exempt_reason), '') <> ''
            or (
              coalesce(trim(p.wwcc_number), '') = ''
              and public.club_today() < coalesce(public.statistician_checks_from(), public.club_today() + 1)
            )
            or public.is_cleared(p.id)
          )
        when p_role in ('admin', 'studio') then p.stood_down_at is null
        else true
      end
  );
$function$;

-- injured_on(uuid,date)
CREATE OR REPLACE FUNCTION public.injured_on(p_team_id uuid, p_day date)
 RETURNS TABLE(profile_id uuid, expected_return date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct on (i.athlete_id) i.athlete_id, i.expected_return
  from public.injuries i
  where i.athlete_left_at is null
    and i.injured_on <= p_day
    and (i.status <> 'cleared' or i.cleared_at is null or (i.cleared_at at time zone public.club_timezone())::date > p_day)
    and (
      (p_team_id is null and public.is_attendance_taker() and public.is_club_athlete(i.athlete_id))
      or (p_team_id is not null
        and (public.can_take_attendance(p_team_id) or public.can_view_team_attendance(p_team_id)
          or public.leads_group(p_team_id))
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = p_team_id and tm.profile_id = i.athlete_id and tm.team_role = 'athlete'
        ))
    )
  order by i.athlete_id, i.injured_on desc, i.created_at desc;
$function$;

-- is_minor(date,boolean)
CREATE OR REPLACE FUNCTION public.is_minor(p_date_of_birth date, p_under_18 boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_date_of_birth is not null then p_date_of_birth > public.club_today() - interval '18 years'
    else coalesce(p_under_18, false)
  end;
$function$;

-- is_under_13(date)
CREATE OR REPLACE FUNCTION public.is_under_13(p_date_of_birth date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(p_date_of_birth > public.club_today() - interval '13 years', false);
$function$;

-- kpi_review_todos()
CREATE OR REPLACE FUNCTION public.kpi_review_todos()
 RETURNS TABLE(kind text, point_id uuid, point_name text, due_on date, team_id uuid, team_name text, profile_id uuid, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'write', rp.id, rp.name, rp.due_on, t.id, t.name, m.profile_id,
    coalesce(public.member_display_name(m.profile_id), 'Unnamed member')
  from public.team_members m
  join public.teams t on t.id = m.team_id and not t.archived
  join public.season_kpi_review_points rp
    on rp.season = t.season and rp.due_on <= public.club_today() + 7
  where public.is_approved()
    and exists (
      select 1 from public.season_kpis k
      where k.profile_id = m.profile_id and k.team_id = m.team_id and k.set_by = auth.uid()
    )
    and not exists (
      select 1 from public.season_kpi_review_notes n
      where n.profile_id = m.profile_id and n.team_id = m.team_id and n.point_id = rp.id
        and n.reviewer_id = auth.uid()
    )
    and public.kpi_can_edit(m.profile_id, m.team_id)
  union all
  select distinct 'confirm', rp.id, rp.name, rp.due_on, t.id, t.name, n.profile_id,
    coalesce(public.member_display_name(n.profile_id), 'Unnamed member')
  from public.season_kpi_review_notes n
  join public.teams t on t.id = n.team_id and not t.archived
  join public.season_kpi_review_points rp on rp.id = n.point_id
  where n.profile_id = auth.uid() and public.is_approved()
    and n.confirmed_at is null
  order by 4, 6, 8;
$function$;

-- load_today()
CREATE OR REPLACE FUNCTION public.load_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.club_today();
$function$;

-- log_injury(uuid,text,text,date,text,date,boolean)
CREATE OR REPLACE FUNCTION public.log_injury(p_athlete_id uuid, p_body_area text, p_description text, p_injured_on date, p_restrictions text DEFAULT NULL::text, p_expected_return date DEFAULT NULL::date, p_concussion boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := public.injury_logger_role(p_athlete_id);
  v_id uuid;
begin
  if v_role is null then
    raise exception 'Only the athlete’s coaches, managers and physios can log an injury for them';
  end if;
  if coalesce(trim(p_body_area), '') = '' or coalesce(trim(p_description), '') = '' then
    raise exception 'Say where the injury is and what happened';
  end if;
  if p_injured_on is null or p_injured_on > public.club_today() then
    raise exception 'Choose the day it happened';
  end if;

  insert into public.injuries (
    athlete_id, reported_by, body_area, description, injured_on, restrictions, expected_return,
    concussion, logged_by_role, athlete_name
  )
  values (
    p_athlete_id, auth.uid(), trim(p_body_area), trim(p_description), p_injured_on,
    nullif(trim(p_restrictions), ''), p_expected_return, coalesce(p_concussion, false), v_role,
    public.member_display_name(p_athlete_id)
  )
  returning id into v_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, author_role, kind, notes, restrictions, expected_return,
    concussion
  )
  values (
    v_id, auth.uid(), public.my_display_name(), v_role, 'reported', trim(p_description),
    nullif(trim(p_restrictions), ''), p_expected_return,
    case when coalesce(p_concussion, false) then true end
  );
  return v_id;
end;
$function$;

-- medical_profile(uuid)
CREATE OR REPLACE FUNCTION public.medical_profile(p_athlete_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'check_due_on', ((v_profile.checked_at at time zone public.club_timezone()) + interval '1 year')::date,
    'check_status', public.medical_review_status(v_profile.checked_at),
    'removal_on', public.medical_removal_on(p_athlete_id, v_profile.checked_at)
  );
end;
$function$;

-- medical_removal_on(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.medical_removal_on(p_athlete_id uuid, p_checked_at timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ((p_checked_at at time zone public.club_timezone()) + make_interval(months => s.retention_medical_months))::date
  from public.club_settings s
  where s.id and s.retention_enabled and p_checked_at is not null
    and not public.on_legal_hold(p_athlete_id);
$function$;

-- medical_review_compliance()
CREATE OR REPLACE FUNCTION public.medical_review_compliance()
 RETURNS TABLE(athlete_id uuid, athlete_name text, minor boolean, has_verified_guardian boolean, teams text, has_contacts boolean, checked_at timestamp with time zone, checked_by_name text, due_on date, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_read_reports() then
    raise exception 'Only admins and committee members with a current check can see the medical details check report';
  end if;
  return query
  select p.id,
    coalesce(public.member_display_name(p.id), 'Unnamed member'),
    public.athlete_is_minor(p.id),
    exists (
      select 1 from public.guardianships g
      join public.profiles gp on gp.id = g.guardian_id
      where g.athlete_id = p.id and gp.status = 'approved' and gp.verified_at is not null
    ),
    (
      select string_agg(t.name, ', ' order by t.name)
      from public.team_members tm join public.teams t on t.id = tm.team_id
      where tm.profile_id = p.id and tm.team_role = 'athlete' and not t.archived
    ),
    coalesce(jsonb_array_length(m.emergency_contacts), 0) > 0,
    m.checked_at,
    m.checked_by_name,
    ((m.checked_at at time zone public.club_timezone()) + interval '1 year')::date,
    public.medical_review_status(m.checked_at)
  from public.profiles p
  left join public.medical_profiles m on m.athlete_id = p.id
  where p.status = 'approved' and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
  order by 2;
end;
$function$;

-- medical_review_status(timestamp with time zone)
CREATE OR REPLACE FUNCTION public.medical_review_status(p_checked_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_checked_at is null then 'missing'
    when ((p_checked_at at time zone public.club_timezone()) + interval '1 year')::date < public.club_today() then 'overdue'
    when ((p_checked_at at time zone public.club_timezone()) + interval '1 year')::date <= public.club_today() + 30 then 'due_soon'
    else 'current'
  end;
$function$;

-- member_todos(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.member_todos(p_profile_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(todo_key text, title text, detail text, href text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_sub record;
  v_me public.profiles;
  v_wants_check boolean;
  v_paused boolean;
begin
  select public.club_timezone(), coalesce(s.features, '{}'::jsonb)
  into v_tz, v_features
  from public.club_settings s
  where s.id;
  v_tz := coalesce(v_tz, public.club_timezone());
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

  -- The member's own Working With Children Check (wwcc_self_submit): a card
  -- an admin sent back, a role paused for want of a card, or a card expiring
  -- within 60 days. Nothing while a card they sent waits for an admin. Same
  -- items as the app's to-do list (src/lib/todos.ts).
  select * into v_sub from public.my_wwcc_submission() limit 1;
  select * into v_me from public.profiles where id = p_profile_id;
  v_wants_check := v_me.stood_down_at is null
    and public.needs_wwcc(public.roles_of(v_me.role, v_me.extra_roles), v_me.wwcc_exempt_reason);
  -- A role held but paused for want of a check, unless a declaration they
  -- can accept would start it instead.
  v_paused := v_wants_check
    and exists (
      select 1 from unnest(public.roles_of(v_me.role, v_me.extra_roles)) as held(role)
      where held.role in ('coach', 'manager', 'physio', 'committee', 'statistician')
        and not public.has_role(held.role)
    )
    and not exists (select 1 from public.my_volunteer_exemption() e where e.declared_at is null)
    and not exists (
      select 1 from public.my_wwcc_application() a
      where a.status = 'waiting_for_declaration' and a.declared_at is null
    );
  if v_sub.id is not null and v_sub.status = 'returned' then
    todo_key := 'wwcc-send-again:' || v_sub.id;
    title := 'Send your Working With Children Check again';
    detail := coalesce('Sent back: ' || v_sub.return_note, 'A club admin sent it back');
    href := '/wwcc';
    return next;
  elsif v_sub.id is null and v_paused then
    todo_key := 'wwcc-send:' || v_month;
    title := 'Add your Working With Children Check';
    detail := 'Your role is paused until a club admin checks it';
    href := '/wwcc';
    return next;
  elsif v_sub.id is null and v_wants_check and public.has_current_wwcc(p_profile_id)
     and v_me.wwcc_expires_on < v_today + 60 then
    todo_key := 'wwcc-renew:' || v_me.wwcc_expires_on;
    title := 'Add your renewed Working With Children Check';
    detail := 'Your card expires soon. Once you’ve renewed it, send the new card.';
    href := '/wwcc';
    return next;
  end if;

  -- A parent or guardian's consents for each child under 18.
  if public.has_role('guardian') then
    -- Only for consents a feature that is on for the child still needs.
    -- A new ask (Daily check-ins turned on again) has its own key, so it
    -- sends again.
    for r in select * from public.my_child_consents() where needs_consent loop
      todo_key := 'consent:' || r.athlete_id
        || case when r.check_ins_on and not r.data then ':check-ins' else '' end;
      title := 'Give consent for ' || coalesce(r.full_name, 'your child');
      detail := public.consent_todo_detail(r.check_ins_on and not r.data, not r.health);
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
      -- Cards members sent in themselves. Again whenever a new one arrives.
      select count(*)::int, max(s.submitted_at)
      into v_n, v_at
      from public.admin_wwcc_submissions() s;
      if v_n > 0 then
        todo_key := 'wwcc-sent:' || (extract(epoch from v_at) * 1000000)::bigint;
        title := 'Check ' || v_n || case when v_n = 1 then ' Working With Children Check'
          else ' Working With Children Checks' end || ' members sent in';
        detail := 'Check each card with the Screening Unit, then accept it or send it back';
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
      detail := 'Switch on Remove old records in Administration, under Record keeping';
      href := '/admin/club/records';
      return next;
    end if;

    -- The nightly removal hasn't finished for 2 days. Once a day while it's stuck.
    for r in select * from public.removal_run_status() where overdue loop
      todo_key := 'records-removal-stalled:' || v_today;
      title := case when r.last_ok_at is null then 'Old records haven’t been removed yet'
        else 'Old records haven’t been removed since '
          || to_char((r.last_ok_at at time zone v_tz)::date, 'FMDy FMDD Mon') end;
      detail := 'The nightly removal hasn’t finished for 2 days. Ask FirstPass to check it.';
      href := '/admin/club/records';
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
$function$;

-- message_involves_child(messages)
CREATE OR REPLACE FUNCTION public.message_involves_child(p_message messages)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where (p.id = p_message.sender_id
           or p.id in (select r.profile_id from public.message_recipients r where r.message_id = p_message.id))
      and case
        when p.date_of_birth is not null then p.date_of_birth > ((p_message.created_at at time zone public.club_timezone()) - interval '18 years')::date
        else coalesce(p.under_17, false)
      end
  );
$function$;

-- my_absences(uuid)
CREATE OR REPLACE FUNCTION public.my_absences(p_athlete_id uuid)
 RETURNS TABLE(id uuid, from_day date, to_day date, reason text, reported_by_name text, reported_as text, created_at timestamp with time zone, withdrawn_at timestamp with time zone, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.from_day, a.to_day, a.reason, a.reported_by_name, a.reported_as,
    a.created_at, a.withdrawn_at, c.name
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
  where a.athlete_id = p_athlete_id
    and public.is_athlete_or_guardian(p_athlete_id)
    and a.to_day >= public.club_today() - 365
  order by a.from_day desc, a.created_at desc;
$function$;

-- my_medical_reviews()
CREATE OR REPLACE FUNCTION public.my_medical_reviews()
 RETURNS TABLE(athlete_id uuid, athlete_name text, status text, due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, coalesce(public.member_display_name(c.id), 'Unnamed member'),
    public.medical_review_status(m.checked_at), ((m.checked_at at time zone public.club_timezone()) + interval '1 year')::date
  from (
    select auth.uid() as id
    union
    select g.athlete_id from public.guardianships g where g.guardian_id = auth.uid()
  ) c
  left join public.medical_profiles m on m.athlete_id = c.id
  where public.can_edit_medical_profile(c.id)
    and public.medical_review_status(m.checked_at) <> 'current'
  order by 4 nulls first, 2;
$function$;

-- my_policy_reviews()
CREATE OR REPLACE FUNCTION public.my_policy_reviews()
 RETURNS TABLE(id uuid, title text, review_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, r.title, r.review_on
  from public.policy_register r
  where public.is_approved()
    and not public.is_stood_down()
    and r.owner_id = auth.uid()
    and r.review_on <= public.club_today() + 30
  order by r.review_on, r.title;
$function$;

-- my_wwcc_application()
CREATE OR REPLACE FUNCTION public.my_wwcc_application()
 RETURNS TABLE(id uuid, application_number text, lodged_on date, kind text, declaration_text text, declared_at timestamp with time zone, lapses_on date, status text, valid boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.application_number, a.lodged_on, a.kind,
    coalesce(a.declaration_text, public.wwcc_application_declaration(a.application_number, a.lodged_on)),
    a.declared_at,
    (coalesce(a.checked_at, a.recorded_at) at time zone public.club_timezone())::date
      + public.wwcc_application_lapse_days(),
    public.wwcc_application_status(a),
    public.wwcc_application_status(a) = 'in_force'
  from public.wwcc_applications a
  where a.profile_id = auth.uid() and a.ended_at is null
  order by a.recorded_at desc
  limit 1;
$function$;

-- open_accessed_message(uuid,uuid)
CREATE OR REPLACE FUNCTION public.open_accessed_message(p_request_id uuid, p_message_id uuid)
 RETURNS TABLE(message_id uuid, created_at timestamp with time zone, sender_name text, body text, answer_options text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.message_access_requests := public.message_access_open_request(p_request_id);
  v_tz text := public.club_timezone();
  v_message public.messages;
  v_me public.profiles;
begin
  select m.* into v_message from public.messages m
  where m.id = p_message_id
    and (m.sender_id = v_request.subject_id or exists (
      select 1 from public.message_recipients r
      where r.message_id = m.id and r.profile_id = v_request.subject_id
    ))
    and (m.created_at at time zone v_tz)::date between v_request.from_date and v_request.to_date;
  if not found then
    raise exception 'That message isn''t covered by this request';
  end if;

  select * into v_me from public.profiles where id = auth.uid();
  insert into public.message_access_views (request_id, viewed_by, viewed_by_name, message_id, kind)
  values (v_request.id, auth.uid(), public.display_name(v_me), v_message.id, 'opened');

  return query select v_message.id, v_message.created_at, coalesce(v_message.sender_name, 'Club'),
    v_message.body, v_message.answer_options;
end;
$function$;

-- purge_expired_records()
CREATE OR REPLACE FUNCTION public.purge_expired_records()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.club_settings;
  v_check_ins int := 0;
  v_session_logs int := 0;
  v_load_reviews int := 0;
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
  where day < (public.club_today() - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_check_ins = row_count;

  -- Session logs go with check-ins, after the same period.
  delete from public.session_logs
  where day < (public.club_today() - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_session_logs = row_count;

  -- Coaches' "Talked with them" notes on training load go with them too.
  delete from public.load_flag_reviews
  where reviewed_on < (public.club_today() - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_load_reviews = row_count;

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
  where to_day < (public.club_today() - make_interval(months => s.retention_attendance_months))::date
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
  where p.session_on < (public.club_today() - make_interval(months => s.retention_attendance_months))::date
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
          and p.volunteer_until < public.club_today() - 365))
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
    'load_flag_reviews', v_load_reviews,
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
$function$;

-- push_quiet_hours(timestamp with time zone)
CREATE OR REPLACE FUNCTION public.push_quiet_hours(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select extract(hour from (p_now at time zone public.club_timezone()))::int not between 7 and 19;
$function$;

-- raise_concern(text,text,uuid,date,text,boolean,text,boolean,text,uuid,uuid[])
CREATE OR REPLACE FUNCTION public.raise_concern(p_body text, p_about_text text DEFAULT NULL::text, p_about_member_id uuid DEFAULT NULL::uuid, p_happened_on date DEFAULT NULL::date, p_involves_child text DEFAULT 'unsure'::text, p_contact_ok boolean DEFAULT false, p_contact_details text DEFAULT NULL::text, p_anonymous boolean DEFAULT false, p_context text DEFAULT NULL::text, p_message_id uuid DEFAULT NULL::uuid, p_about_member_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles;
  v_about uuid[];
  v_message public.messages;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Sign in to raise a concern';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Say what happened';
  end if;
  if length(p_body) > 5000 then
    raise exception 'Keep it under 5000 characters';
  end if;
  if p_happened_on > public.club_today() then
    raise exception 'The date can''t be in the future';
  end if;
  if (
    select count(*) from public.concerns
    where raised_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= 10 then
    raise exception 'You''ve raised 10 concerns today. Talk to a contact below, or call 000 if a child is in danger.';
  end if;
  -- The members named, in the order given, once each, who exist.
  select coalesce(array_agg(x.id order by x.n), '{}') into v_about
  from (
    select u.id, min(u.n) as n
    from unnest(coalesce(p_about_member_ids, '{}') || p_about_member_id) with ordinality u (id, n)
    join public.profiles p on p.id = u.id
    group by u.id
  ) x;
  if cardinality(v_about) > 10 then
    raise exception 'Name up to 10 people';
  end if;
  if p_message_id is not null then
    select * into v_message from public.messages m
    where m.id = p_message_id
      and ((m.sender_id = auth.uid() and not public.is_stood_down())
        or public.is_message_recipient(m.id));
    if not found then
      raise exception 'That message isn''t available to report';
    end if;
  end if;

  insert into public.concerns (
    raised_by, raised_by_name, anonymous, contact_ok, contact_details,
    about_text, happened_on, body, involves_child, context,
    reported_message_id, reported_message_sender_name, reported_message_sent_at, reported_message_body
  )
  values (
    auth.uid(),
    public.display_name(v_me),
    coalesce(p_anonymous, false),
    coalesce(p_contact_ok, false) and not coalesce(p_anonymous, false),
    case when coalesce(p_contact_ok, false) and not coalesce(p_anonymous, false)
      then nullif(trim(left(p_contact_details, 300)), '') end,
    nullif(trim(left(p_about_text, 300)), ''),
    p_happened_on,
    trim(p_body),
    coalesce(p_involves_child, 'unsure'),
    nullif(trim(left(p_context, 300)), ''),
    v_message.id,
    case when v_message.id is not null then coalesce(v_message.sender_name, 'A former member') end,
    v_message.created_at,
    v_message.body
  )
  returning id into v_id;

  insert into public.concern_about_members (concern_id, member_id, member_name, named_by_raiser)
  select v_id, p.id, public.display_name(p), true
  from unnest(v_about) with ordinality u (id, n)
  join public.profiles p on p.id = u.id
  order by u.n;
  perform public.sync_concern_about(v_id);
  return v_id;
end;
$function$;

-- report_absence(uuid,date,date,text)
CREATE OR REPLACE FUNCTION public.report_absence(p_athlete_id uuid, p_from date, p_to date, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_athlete_or_guardian(p_athlete_id) then
    raise exception 'Only the athlete or their parent or guardian can report an absence';
  end if;
  if not public.is_club_athlete(p_athlete_id) then
    raise exception 'Absences can only be reported for athletes';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Choose the first and last day away';
  end if;
  if p_to < p_from then
    raise exception 'The last day can’t be before the first day';
  end if;
  if p_from < public.club_today() - 14 then
    raise exception 'Absences can be reported up to 14 days after';
  end if;
  if p_to > public.club_today() + 365 then
    raise exception 'Absences can be reported up to 12 months ahead';
  end if;
  if p_to - p_from > 92 then
    raise exception 'An absence can be up to 3 months long';
  end if;
  if length(coalesce(v_reason, '')) > 200 then
    raise exception 'Keep the reason under 200 characters';
  end if;
  insert into public.attendance_absences (
    athlete_id, from_day, to_day, reason, reported_by, reported_by_name, reported_as
  )
  values (
    p_athlete_id, p_from, p_to, v_reason, auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    case when p_athlete_id = auth.uid() then 'athlete' else 'guardian' end
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- report_absence(uuid,date,date,uuid,text)
CREATE OR REPLACE FUNCTION public.report_absence(p_athlete_id uuid, p_from date, p_to date, p_category_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_athlete_or_guardian(p_athlete_id) then
    raise exception 'Only the athlete or their parent or guardian can report an absence';
  end if;
  if not public.is_club_athlete(p_athlete_id) then
    raise exception 'Absences can only be reported for athletes';
  end if;
  if p_category_id is null then
    if exists (select 1 from public.absence_categories where active) then
      raise exception 'Choose a reason for the absence';
    end if;
  elsif not exists (
    select 1 from public.absence_categories where id = p_category_id and active
  ) then
    raise exception 'That reason is no longer used. Choose another.';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Choose the first and last day away';
  end if;
  if p_to < p_from then
    raise exception 'The last day can’t be before the first day';
  end if;
  if p_from < public.club_today() - 14 then
    raise exception 'Absences can be reported up to 14 days after';
  end if;
  if p_to > public.club_today() + 365 then
    raise exception 'Absences can be reported up to 12 months ahead';
  end if;
  if p_to - p_from > 92 then
    raise exception 'An absence can be up to 3 months long';
  end if;
  if length(coalesce(v_reason, '')) > 200 then
    raise exception 'Keep the details under 200 characters';
  end if;
  -- The same absence sent twice (a retry after a dropped connection, or a
  -- second tap) is kept once.
  perform pg_advisory_xact_lock(hashtext('absence:' || p_athlete_id::text));
  select id into v_id from public.attendance_absences
  where athlete_id = p_athlete_id and from_day = p_from and to_day = p_to
    and category_id is not distinct from p_category_id and reason is not distinct from v_reason
    and reported_by = auth.uid() and withdrawn_at is null
  order by created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.attendance_absences (
    athlete_id, from_day, to_day, category_id, reason, reported_by, reported_by_name, reported_as
  )
  values (
    p_athlete_id, p_from, p_to, p_category_id, v_reason, auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    case when p_athlete_id = auth.uid() then 'athlete' else 'guardian' end
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- report_injury(uuid,text,text,date,text,date,boolean)
CREATE OR REPLACE FUNCTION public.report_injury(p_athlete_id uuid, p_body_area text, p_description text, p_injured_on date, p_restrictions text DEFAULT NULL::text, p_expected_return date DEFAULT NULL::date, p_concussion boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not public.can_report_for(p_athlete_id) then
    raise exception 'Only athletes and their guardians can report injuries';
  end if;
  if coalesce(trim(p_body_area), '') = '' or coalesce(trim(p_description), '') = '' then
    raise exception 'Say where the injury is and what happened';
  end if;
  if p_injured_on is null or p_injured_on > public.club_today() then
    raise exception 'Choose the day it happened';
  end if;

  insert into public.injuries (
    athlete_id, reported_by, body_area, description, injured_on, restrictions, expected_return,
    concussion
  )
  values (
    p_athlete_id, auth.uid(), trim(p_body_area), trim(p_description), p_injured_on,
    nullif(trim(p_restrictions), ''), p_expected_return, coalesce(p_concussion, false)
  )
  returning id into v_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, restrictions, expected_return, concussion
  )
  values (
    v_id, auth.uid(), public.my_display_name(), 'reported', trim(p_description),
    nullif(trim(p_restrictions), ''), p_expected_return,
    case when coalesce(p_concussion, false) then true end
  );
  return v_id;
end;
$function$;

-- request_clearance(uuid,text,text,text,boolean)
CREATE OR REPLACE FUNCTION public.request_clearance(p_injury_id uuid, p_notes text, p_document_path text, p_document_name text, p_doctor_clearance boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_injury public.injuries;
  v_earliest date;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.can_report_for(v_injury.athlete_id) then
    raise exception 'Only the athlete and their guardians can ask for clearance';
  end if;
  if v_injury.status <> 'injured' then
    raise exception 'Clearance has already been asked for';
  end if;
  v_earliest := public.earliest_concussion_clearance(v_injury);
  if v_earliest is not null and public.club_today() < v_earliest then
    raise exception 'After a concussion, clearance can be asked for from %',
      to_char(v_earliest, 'FMDD FMMonth YYYY');
  end if;
  if p_document_path is null then
    raise exception 'Attach proof of clearance, such as a letter from the physio';
  end if;
  if v_injury.concussion and not coalesce(p_doctor_clearance, false) then
    raise exception 'After a concussion, attach a doctor’s clearance and confirm it’s from a doctor';
  end if;
  perform public.check_injury_document(v_injury, p_document_path);

  update public.injuries set status = 'clearance_requested' where id = p_injury_id;

  insert into public.injury_updates (
    injury_id, author_id, author_name, kind, notes, document_path, document_name, doctor_clearance
  )
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'clearance_requested',
    nullif(trim(p_notes), ''), p_document_path, p_document_name,
    coalesce(p_doctor_clearance, false)
  );
end;
$function$;

-- request_message_access(uuid,uuid,text,date,date,text)
CREATE OR REPLACE FUNCTION public.request_message_access(p_concern_id uuid, p_subject_id uuid, p_link text, p_from date, p_to date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_post text := public.my_safeguarding_post();
  v_concern public.concerns;
  v_subject public.profiles;
  v_me public.profiles;
  v_today date;
  v_id uuid;
begin
  if v_post is null then
    raise exception 'Only the Child Safety Officer or the Complaints Manager can ask to read messages';
  end if;
  select * into v_concern from public.concerns where id = p_concern_id;
  if not found or not public.can_handle_concern(p_concern_id) then
    raise exception 'Concern not found';
  end if;
  if v_concern.status = 'closed' then
    raise exception 'This concern is closed. Reopen it before asking to read messages';
  end if;
  select * into v_subject from public.profiles where id = p_subject_id;
  if not found then
    raise exception 'Choose whose messages to read';
  end if;
  if p_subject_id = auth.uid() then
    raise exception 'You can''t ask to read your own messages';
  end if;
  if p_link is null or p_link not in ('about', 'raised_by', 'other') then
    raise exception 'Say how this person is involved in the concern';
  end if;
  if p_link = 'about' and not public.is_named_in_concern(p_concern_id, p_subject_id) then
    raise exception 'This concern isn''t about that person';
  end if;
  if p_link = 'raised_by' and (v_concern.anonymous or v_concern.raised_by is distinct from p_subject_id) then
    raise exception 'That person didn''t raise this concern';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters';
  end if;
  if length(trim(p_reason)) > 1000 then
    raise exception 'The reason can be up to 1,000 characters';
  end if;
  select public.club_today()
  into v_today;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a start date on or before the end date';
  end if;
  if p_to > v_today then
    raise exception 'The end date can''t be in the future';
  end if;
  if p_to - p_from > 90 then
    raise exception 'Ask for 90 days or less at a time';
  end if;
  if exists (
    select 1 from public.message_access_requests r
    where r.requested_by = auth.uid() and r.subject_id = p_subject_id
      and r.concern_id = p_concern_id and r.status = 'pending'
  ) then
    raise exception 'You''ve already asked to read this person''s messages for this concern. Wait for an answer';
  end if;

  select * into v_me from public.profiles where id = auth.uid();
  insert into public.message_access_requests (
    concern_id, requested_by, requested_by_name, requested_post,
    subject_id, subject_name, subject_link, from_date, to_date, reason
  )
  values (
    p_concern_id, auth.uid(), public.display_name(v_me), v_post,
    p_subject_id, public.display_name(v_subject), p_link, p_from, p_to, trim(p_reason)
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- request_no_app_child(text,date,uuid)
CREATE OR REPLACE FUNCTION public.request_no_app_child(p_full_name text, p_date_of_birth date, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.can_ask_for_child() then
    raise exception 'Ask to join as a parent or guardian first';
  end if;
  if v_name = '' then
    raise exception 'Enter your child’s name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep your child’s name to 80 characters';
  end if;
  if p_date_of_birth is null or p_date_of_birth > public.club_today() or p_date_of_birth < date '1900-01-01' then
    raise exception 'That date of birth doesn''t look right';
  end if;
  if not public.is_minor(p_date_of_birth, false) then
    raise exception 'Only children under 18 can be added without their own sign-in. At 18 they join with their own account';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams where id = p_team_id and not archived
  ) then
    raise exception 'Choose one of this season''s squads or teams';
  end if;
  if (select count(*) from public.no_app_child_requests where guardian_id = auth.uid()) >= 6 then
    raise exception 'You’ve asked for 6 children already. A club admin will check them first';
  end if;
  if exists (
    select 1 from public.no_app_child_requests
    where guardian_id = auth.uid() and lower(full_name) = lower(v_name) and date_of_birth = p_date_of_birth
  ) then
    raise exception 'You’ve already asked for %. A club admin will check and add them', v_name;
  end if;
  insert into public.no_app_child_requests (guardian_id, full_name, date_of_birth, team_id)
  values (auth.uid(), v_name, p_date_of_birth, p_team_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- review_policy(uuid,text,text,date)
CREATE OR REPLACE FUNCTION public.review_policy(p_id uuid, p_version text, p_link text, p_next_review_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link text := public.check_policy_link(p_link);
begin
  if not exists (
    select 1 from public.policy_register r
    where r.id = p_id
      and public.is_approved()
      and (public.is_admin() or (r.owner_id = auth.uid() and not public.is_stood_down()))
  ) then
    raise exception 'Only the policy''s owner or an admin can record a review';
  end if;
  if p_next_review_on is null or p_next_review_on <= public.club_today() then
    raise exception 'Choose a next review date after today';
  end if;
  if p_next_review_on > public.club_today() + interval '5 years' then
    raise exception 'Choose a review date within 5 years';
  end if;
  if length(coalesce(p_version, '')) > 30 then
    raise exception 'Keep the version to 30 characters';
  end if;

  update public.policy_register r
  set version = nullif(trim(p_version), ''), link = v_link, review_on = p_next_review_on,
    last_reviewed_at = now(), last_reviewed_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
  where r.id = p_id;
end;
$function$;

-- save_check_in(date,integer,integer,integer,integer,text)
CREATE OR REPLACE FUNCTION public.save_check_in(p_day date, p_sleep integer, p_soreness integer, p_stress integer, p_mood integer, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not public.has_role('athlete') then
    raise exception 'Only athletes can check in.';
  end if;
  if p_day is null or p_day not between public.club_today() - 1 and public.club_today() + 1 then
    raise exception 'You can only check in for today.';
  end if;

  insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood, note)
  values (auth.uid(), p_day, p_sleep, p_soreness, p_stress, p_mood, nullif(trim(p_note), ''))
  on conflict (athlete_id, day) do update
    set sleep = excluded.sleep,
        soreness = excluded.soreness,
        stress = excluded.stress,
        mood = excluded.mood,
        note = excluded.note
  returning id into v_id;
  return v_id;
end;
$function$;

-- save_playhq_fixtures(text,jsonb)
CREATE OR REPLACE FUNCTION public.save_playhq_fixtures(p_playhq_team_id text, p_games jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_team public.teams;
  v_season text;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import fixtures';
  end if;

  select t.* into v_team
  from public.playhq_teams l
  join public.teams t on t.id = l.team_id
  where l.playhq_team_id = p_playhq_team_id;
  if not found then
    raise exception 'That PlayHQ team isn''t linked to a squad or team';
  end if;

  insert into public.fixtures as f (
    playhq_game_id, playhq_team_id, team_id, team_name, opponent, round_name, grade_name,
    starts_at, time_tbc, venue, court, is_home, is_final, status
  )
  select
    g->>'id', p_playhq_team_id, v_team.id, v_team.name,
    nullif(g->>'opponent', ''), nullif(g->>'round', ''), nullif(g->>'grade', ''),
    ((g->>'date') || ' ' || coalesce(nullif(g->>'time', ''), '00:00'))::timestamp
      at time zone coalesce(nullif(g->>'timezone', ''), public.club_timezone()),
    coalesce(g->>'time', '') = '',
    nullif(g->>'venue', ''), nullif(g->>'court', ''),
    (g->>'is_home')::boolean, coalesce((g->>'is_final')::boolean, false),
    nullif(g->>'status', '')
  from jsonb_array_elements(p_games) g
  where coalesce(g->>'id', '') <> '' and coalesce(g->>'date', '') <> ''
  on conflict (playhq_game_id, playhq_team_id) do update set
    team_id = excluded.team_id,
    team_name = excluded.team_name,
    opponent = excluded.opponent,
    round_name = excluded.round_name,
    grade_name = excluded.grade_name,
    starts_at = excluded.starts_at,
    time_tbc = excluded.time_tbc,
    venue = excluded.venue,
    court = excluded.court,
    is_home = excluded.is_home,
    is_final = excluded.is_final,
    status = excluded.status;
  get diagnostics v_count = row_count;

  select playhq_season_id into v_season from public.playhq_teams where playhq_team_id = p_playhq_team_id;
  update public.playhq_seasons set imported_at = now() where playhq_season_id = v_season;
  return v_count;
end;
$function$;

-- save_session_log(uuid,date,text,integer,integer)
CREATE OR REPLACE FUNCTION public.save_session_log(p_id uuid, p_day date, p_kind text, p_minutes integer, p_rpe integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not (public.is_approved() and public.has_role('athlete')) then
    raise exception 'Only athletes can log sessions.';
  end if;
  if p_day is null or p_day not between public.club_today() - 7 and public.club_today() + 1 then
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
$function$;

-- save_session_plan(uuid,uuid,text,date,time without time zone,time without time zone,text,text,text,boolean,boolean,uuid[],uuid)
CREATE OR REPLACE FUNCTION public.save_session_plan(p_id uuid, p_team_id uuid, p_title text, p_session_on date, p_starts_at time without time zone, p_ends_at time without time zone, p_location text, p_notes text, p_run_by text, p_share_team_coaches boolean, p_share_athletes boolean, p_coach_ids uuid[], p_copied_from uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.session_plans;
  v_team public.teams;
  v_id uuid;
  v_title text := nullif(btrim(p_title), '');
  v_location text := nullif(btrim(p_location), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_run_by text := nullif(btrim(p_run_by), '');
  v_coach_ids uuid[] := coalesce(p_coach_ids, '{}');
  v_position text;
  v_title_kind public.coach_title;
begin
  if not public.session_plans_on() then
    raise exception 'Session plans are switched off for the club';
  end if;
  if p_id is not null then
    select * into v_plan from public.session_plans where id = p_id;
    if not found or not public.can_edit_session_plan(p_id) then
      raise exception 'Only the coach who added this plan, or an admin, can change it';
    end if;
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'Choose the squad or team the session was for';
  end if;
  -- Moving a plan to another group needs the same right as adding one there.
  if (p_id is null or v_plan.team_id is distinct from p_team_id)
     and not public.can_add_session_plan(p_team_id) then
    raise exception 'You can only add plans for squads and teams you coach';
  end if;

  if v_title is null then
    raise exception 'Name the session, for example Tuesday training';
  end if;
  if length(v_title) > 120 then
    raise exception 'Keep the session name under 120 characters';
  end if;
  if p_session_on is null then
    raise exception 'Choose the day of the session';
  end if;
  if p_session_on > public.club_today() + 366 or p_session_on < public.club_today() - 3660 then
    raise exception 'Choose a day within a year from today';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'The session has to finish after it starts';
  end if;
  if length(v_location) > 200 then
    raise exception 'Keep the place under 200 characters';
  end if;
  if length(v_notes) > 20000 then
    raise exception 'Keep the plan under 20,000 characters, or attach it as a file';
  end if;
  if length(v_run_by) > 120 then
    raise exception 'Keep "Run by" under 120 characters';
  end if;
  if cardinality(v_coach_ids) > 50 then
    raise exception 'Share with up to 50 coaches by name';
  end if;
  -- Only coaches of current squads and teams can be chosen by name.
  if exists (
    select 1 from unnest(v_coach_ids) as c(id)
    where c.id = auth.uid()
       or not exists (
         select 1
         from public.team_members tm
         join public.teams t on t.id = tm.team_id
         join public.profiles pr on pr.id = tm.profile_id
         where tm.profile_id = c.id
           and tm.team_role = 'coach'
           and not t.archived
           and pr.status = 'approved'
       )
  ) then
    raise exception 'Plans can only be shared by name with coaches';
  end if;
  if p_copied_from is not null and not public.can_view_session_plan(p_copied_from) then
    raise exception 'That plan can''t be copied';
  end if;

  if p_id is null then
    select tm.coach_title into v_title_kind
    from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = auth.uid() and tm.team_role = 'coach';
    v_position := case
      when found and v_title_kind = 'head_coach' then 'Head coach'
      when found and v_title_kind = 'assistant_coach' then 'Assistant coach'
      when found then 'Coach'
      else 'Admin'
    end;

    insert into public.session_plans (
      team_id, team_name, title, session_on, starts_at, ends_at, location, notes, run_by,
      share_team_coaches, share_athletes, author_id, author_name, author_position, copied_from
    )
    values (
      p_team_id, v_team.name, v_title, p_session_on, p_starts_at, p_ends_at, v_location, v_notes,
      v_run_by, coalesce(p_share_team_coaches, true), coalesce(p_share_athletes, false),
      auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Unnamed member'), v_position,
      p_copied_from
    )
    returning id into v_id;
  else
    v_id := p_id;
    update public.session_plans
    set team_id = p_team_id,
        team_name = v_team.name,
        title = v_title,
        session_on = p_session_on,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        location = v_location,
        notes = v_notes,
        run_by = v_run_by,
        share_team_coaches = coalesce(p_share_team_coaches, true),
        share_athletes = coalesce(p_share_athletes, false),
        edited_at = now(),
        edited_by_name = public.member_display_name(auth.uid())
    where id = p_id;

    delete from public.session_plan_shares
    where plan_id = p_id and not (profile_id = any (v_coach_ids));
  end if;

  insert into public.session_plan_shares (plan_id, profile_id)
  select v_id, c.id from unnest(v_coach_ids) as c(id)
  on conflict do nothing;

  -- Tells anyone it's now shared with for the first time.
  perform public.notify_session_plan_shared(v_id);

  return v_id;
end;
$function$;

-- set_my_volunteer_details(text,date,date,text,text)
CREATE OR REPLACE FUNCTION public.set_my_volunteer_details(p_task text, p_from date, p_until date, p_screening text, p_card_number text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_problem text := public.volunteer_details_problem(p_task, p_from, p_until);
  v_card text := nullif(upper(trim(coalesce(p_card_number, ''))), '');
begin
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if p_until < public.club_today() then
    raise exception 'Your last day has already passed';
  end if;
  if p_screening is null
     or p_screening not in ('card', 'visitor', 'national_event', 'parent', 'under_18', 'none') then
    raise exception 'Choose how you''re screened to work with children';
  end if;
  if p_screening = 'card' and v_card is null then
    raise exception 'Enter your Working With Children Check card number';
  end if;
  if length(v_card) > 30 then
    raise exception 'That card number is too long';
  end if;
  update public.profiles
  set volunteer_task = trim(p_task),
      volunteer_from = p_from,
      volunteer_until = p_until,
      volunteer_screening = p_screening,
      declared_wwcc_number = case when p_screening = 'card' then v_card end
  where id = auth.uid() and status <> 'approved' and requested_role = 'volunteer';
  if not found then
    raise exception 'Ask to join as a temporary helper first';
  end if;
end;
$function$;

-- submit_join_request(text,text,app_role,uuid,text,date,text)
CREATE OR REPLACE FUNCTION public.submit_join_request(p_full_name text, p_playhq_email text, p_requested_role app_role, p_requested_team_id uuid, p_join_password text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_guardian_email text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hash text;
  v_attempt public.join_password_attempts;
  v_max_failures constant integer := 5;
  v_lockout constant interval := interval '15 minutes';
  v_guardian_email text := nullif(lower(trim(coalesce(p_guardian_email, ''))), '');
  v_child boolean := p_requested_role = 'athlete' and public.is_minor(p_date_of_birth, false);
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Admins match people to PlayHQ by this email, so it must be one the
  -- person actually controls.
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email address before asking to join';
  end if;
  if char_length(coalesce(trim(p_full_name), '')) > 80 then
    raise exception 'Keep your name to 80 characters';
  end if;
  select join_password_hash into v_hash from public.club_settings;
  if v_hash is not null then
    select * into v_attempt from public.join_password_attempts where profile_id = auth.uid();
    if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
      return 'Too many wrong club passwords. Try again in '
        || ceil(extract(epoch from (v_attempt.locked_until - now())) / 60)::integer
        || ' minutes.';
    end if;
    if extensions.crypt(coalesce(trim(p_join_password), ''), v_hash) <> v_hash then
      insert into public.join_password_attempts as a (profile_id, failures, locked_until, updated_at)
      values (
        auth.uid(),
        1,
        null,
        now()
      )
      on conflict (profile_id) do update
        set failures = case
              when a.locked_until is not null and a.locked_until <= now() then 1
              else a.failures + 1
            end,
            locked_until = case
              when a.locked_until is not null and a.locked_until <= now() then null
              when a.failures + 1 >= v_max_failures then now() + v_lockout
              else null
            end,
            updated_at = now();
      return 'That club password is not right. Ask a club admin for it.';
    end if;
    -- A right password clears the count.
    delete from public.join_password_attempts where profile_id = auth.uid();
  end if;
  -- Nobody under 13 joins this year (Matt, 18 November 2026). Asked after the
  -- club password, so someone without it learns nothing new, and before
  -- anything about them is saved. A date in the future is answered below.
  if p_date_of_birth <= public.club_today() and public.is_under_13(p_date_of_birth) then
    return 'FirstPass HQ is for members aged 13 and over. If you’re a parent or guardian, enter your own date of birth.';
  end if;
  if p_requested_role = 'admin' then
    raise exception 'Admin access cannot be requested';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;
  if p_requested_role = 'guardian' and coalesce(trim(p_playhq_email), '') = '' then
    raise exception 'Guardians need to give the email they used to register with PlayHQ';
  end if;
  -- Older versions of the app don't send a date of birth; the admin still
  -- has to record one before approving an athlete.
  if p_date_of_birth is not null
     and (p_date_of_birth > public.club_today() or p_date_of_birth < date '1900-01-01') then
    raise exception 'That date of birth doesn''t look right';
  end if;
  if v_child and v_guardian_email is null then
    raise exception 'Give the email of a parent or guardian, so the club can link them to you';
  end if;
  if v_guardian_email is not null
     and (v_guardian_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_guardian_email) > 254) then
    raise exception 'That parent or guardian email doesn''t look right';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      playhq_email = nullif(lower(trim(p_playhq_email)), ''),
      requested_role = p_requested_role,
      requested_team_id = p_requested_team_id,
      join_requested_at = now(),
      declared_date_of_birth = coalesce(p_date_of_birth, declared_date_of_birth),
      -- Only kept for a child; an adult's request clears it.
      guardian_email = case
        when v_child then v_guardian_email
        when p_date_of_birth is null then guardian_email
      end,
      -- A rejected member can ask again.
      status = case when status = 'rejected' then 'pending'::public.member_status else status end
  where id = auth.uid() and status <> 'approved';
  return null;
end;
$function$;

-- submit_my_wwcc(text,date,text)
CREATE OR REPLACE FUNCTION public.submit_my_wwcc(p_card_number text, p_expires_on date, p_card_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles;
  v_number text := nullif(upper(trim(p_card_number)), '');
  v_name text := nullif(trim(p_card_name), '');
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.status <> 'approved' then
    raise exception 'Only approved members can send in a Working With Children Check';
  end if;
  if not public.needs_wwcc(public.roles_of(v_me.role, v_me.extra_roles), v_me.wwcc_exempt_reason)
     and v_me.role <> 'guest' then
    raise exception 'Your roles don''t need a Working With Children Check';
  end if;
  if v_me.stood_down_at is not null then
    raise exception 'A club admin has paused your roles. Talk to a club admin about it.';
  end if;
  if v_number is null then
    raise exception 'Enter the card number';
  end if;
  if length(v_number) > 30 then
    raise exception 'That card number is too long';
  end if;
  if p_expires_on is null then
    raise exception 'Enter the expiry date on the card';
  end if;
  if p_expires_on < public.club_today() then
    raise exception 'That card has expired. Renew it, then send the new card';
  end if;
  -- Cards last three years, so a later expiry is a typing mistake.
  if p_expires_on > (public.club_today() + interval '3 years')::date then
    raise exception 'A Working With Children Check lasts three years. Check the expiry date on the card';
  end if;
  if v_name is null then
    raise exception 'Enter your name as it appears on the card';
  end if;
  if length(v_name) > 120 then
    raise exception 'Keep the name on the card to 120 characters';
  end if;
  if v_me.wwcc_number = v_number and v_me.wwcc_expires_on = p_expires_on
     and v_me.wwcc_validated_at is not null then
    raise exception 'The club already has that card recorded';
  end if;

  update public.wwcc_submissions
  set status = 'replaced', decided_at = now()
  where profile_id = v_me.id and status = 'waiting';

  insert into public.wwcc_submissions (profile_id, card_number, expires_on, card_name)
  values (v_me.id, v_number, p_expires_on, v_name)
  returning id into v_id;
  return v_id;
end;
$function$;

-- submit_training_certificate(uuid,uuid[],date,text,text,text)
CREATE OR REPLACE FUNCTION public.submit_training_certificate(p_profile_id uuid, p_requirement_ids uuid[], p_completed_on date, p_document_path text, p_document_name text, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_requirement_ids, '{}')) as x);
  v_count integer;
begin
  if not public.can_submit_training_for(p_profile_id) then
    raise exception 'Only the member or their parent or guardian can upload certificates';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'Tick the training this certificate is for';
  end if;
  if p_completed_on is null or p_completed_on > public.club_today() then
    raise exception 'Choose the day you completed it';
  end if;
  if p_document_path is null
    or public.training_certificate_owner(p_document_path) is distinct from p_profile_id
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'training-certificates' and name = p_document_path
    ) then
    raise exception 'The certificate wasn’t uploaded. Try attaching it again.';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x(id)
    where not exists (
      select 1 from public.training_requirements r
      where r.id = x.id and not r.archived and public.training_applies(r.id, p_profile_id)
    )
  ) then
    raise exception 'That training isn’t on your list';
  end if;
  if exists (
    select 1 from public.training_certificates
    where profile_id = p_profile_id and requirement_id = any (v_ids)
      and status in ('submitted', 'approved')
  ) then
    raise exception 'A certificate for that training is already in. Refresh and try again.';
  end if;

  insert into public.training_certificates (
    requirement_id, profile_id, submitted_by, submitted_by_name, completed_on, notes,
    document_path, document_name
  )
  select
    x.id, p_profile_id, auth.uid(), public.my_display_name(), p_completed_on,
    nullif(trim(p_notes), ''), p_document_path, nullif(trim(p_document_name), '')
  from unnest(v_ids) as x(id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- upcoming_absences()
CREATE OR REPLACE FUNCTION public.upcoming_absences()
 RETURNS TABLE(id uuid, athlete_id uuid, athlete_name text, from_day date, to_day date, reason text, reported_by_name text, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.athlete_id, coalesce(public.member_display_name(a.athlete_id), 'Athlete'),
    a.from_day, a.to_day, a.reason, a.reported_by_name, c.name
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
  where a.withdrawn_at is null
    and a.to_day >= public.club_today()
    and a.from_day <= public.club_today() + 28
    and public.can_see_absences_of(a.athlete_id)
  order by a.from_day, 3;
$function$;

-- volunteer_exemption_state(uuid)
CREATE OR REPLACE FUNCTION public.volunteer_exemption_state(p_profile_id uuid)
 RETURNS TABLE(exemption_id uuid, basis volunteer_exemption, declared boolean, valid boolean, ends_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    e.id,
    e.basis,
    e.declared_at is not null,
    e.declared_at is not null and case e.basis
      when 'under_18_volunteer' then
        v.date_of_birth is not null and public.is_minor(v.date_of_birth, false)
      when 'parent_volunteer' then exists (
        select 1 from public.profiles c
        where c.id = e.child_id and c.status = 'approved'
          and 'athlete' = any (public.roles_of(c.role, c.extra_roles))
          and public.is_minor(c.date_of_birth, c.under_17)
          -- A temporary helper names their child; everyone else is linked as
          -- a guardian.
          and (v.role = 'volunteer' or exists (
            select 1 from public.guardianships g
            where g.athlete_id = c.id and g.guardian_id = e.profile_id
          ))
      )
      else public.club_today() between e.starts_on and public.exemption_last_day(e.basis, e.starts_on)
    end,
    case e.basis
      when 'under_18_volunteer' then (v.date_of_birth + interval '18 years')::date
      when 'parent_volunteer' then (
        select (c.date_of_birth + interval '18 years')::date
        from public.profiles c where c.id = e.child_id
      )
      else public.exemption_last_day(e.basis, e.starts_on)
    end
  from public.volunteer_exemptions e
  join public.profiles v on v.id = e.profile_id
  where e.profile_id = p_profile_id and e.ended_at is null;
$function$;

-- wellbeing_flag_rows(integer)
CREATE OR REPLACE FUNCTION public.wellbeing_flag_rows(p_days integer)
 RETURNS TABLE(athlete_id uuid, athlete_name text, day date, lowest_score smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.athlete_id,
    coalesce(public.member_display_name(c.athlete_id), 'Athlete'),
    c.day,
    least(c.sleep, c.soreness, c.stress, c.mood)
  from public.check_ins c
  join public.profiles p on p.id = c.athlete_id
  where coalesce(
      (select (s.features ->> 'checkIns')::boolean is distinct from false
       from public.club_settings s where s.id),
      true
    )
    and c.day > public.club_today() - least(greatest(coalesce(p_days, 14), 1), 60)
    and least(c.sleep, c.soreness, c.stress, c.mood) <= 2
    and p.status = 'approved'
    and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
    and public.has_child_consent(c.athlete_id, 'data');
$function$;

commit;
