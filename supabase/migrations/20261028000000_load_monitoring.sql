-- Training load prompts (Matt, 28 October 2026, thread "Check load
-- management feature coverage"; review "Athlete load monitoring: science
-- review and recommendations").
--
-- Session logs (20261023210000) give each athlete's load: minutes times how
-- hard it felt (session RPE). This reads that load and raises prompts for a
-- coach to start a conversation. They aren't predictions and aren't for
-- selection, medical or return-to-play decisions. Each prompt rests on a
-- published source the app names (src/lib/load-sources.ts):
--
-- * ratio: the last 7 days' load against the last 28 days', as
--   exponentially weighted averages (Murray et al. 2017). The club picks
--   "1.5 or more" (Gabbett 2016's "danger zone", the default), "above 1.3"
--   (above Gabbett's 0.8 to 1.3 "sweet spot") or off. Only once the athlete
--   logged in each of the 3 weeks before the last 7 days.
-- * hours: an under 18 whose last 7 days of sport add up to more hours than
--   their age in years (Jayanthi et al. 2015). On unless the club turns it off.
-- * injury: a session logged in the last 7 days while the athlete has an
--   injury with restrictions that isn't cleared. It rests on the club's own
--   injury record.
-- * wellbeing: added to any of the above when the athlete also had 2 or more
--   low check-ins in the last 7 days (Saw et al. 2016).
--
-- Who sees what (Matt's decisions, 28 October 2026):
-- * Coaches of the athlete (with a parent's data consent for an under 18):
--   every flag, and "Talked with them", which closes the athlete's flags for
--   7 days with an optional note only coaches read.
-- * The athlete: their own flags.
-- * Parents and guardians: nothing until a coach has talked with the athlete;
--   then the date, the coach and what the flags were about. Never the note.
-- * The Child Safety Officer: under 18s only, and only patterns: hours over
--   age 2 weeks running, a flag alongside low check-ins, or a flag no coach
--   followed up within 7 days. The pattern and the day, nothing else.
-- * Nobody else. Teammates, the committee and admins see no names.
--
-- The whole feature is a Club settings switch, "Training load flags"
-- (features.trainingLoad), off until an admin turns it on (Matt, 28 October
-- 2026), and it needs Daily check-ins. While it's off no flags are worked
-- out, so coaches, the Child Safety Officer and parents see none.
--
-- Additive: two new club settings with defaults, one new table reached only
-- through functions, new functions, and purge_expired_records also removes
-- old reviews with session logs. No existing rows change.

begin;

alter table public.club_settings
  add column if not exists load_ratio_flag text not null default 'from_1_5',
  add column if not exists load_hours_flag boolean not null default true;

do $$ begin
  alter table public.club_settings add constraint club_settings_load_ratio_flag_check
    check (load_ratio_flag in ('from_1_5', 'above_1_3', 'off'));
exception when duplicate_object then null;
end $$;

-- A coach's "Talked with them": closes the athlete's flags for 7 days. The
-- flags at the time are kept so parents can be told what it was about.
create table if not exists public.load_flag_reviews (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewer_name text not null,
  flags text[] not null,
  note text check (length(note) <= 500),
  reviewed_on date not null default ((now() at time zone 'Australia/Perth')::date),
  created_at timestamptz not null default now()
);

create index if not exists load_flag_reviews_athlete_idx on public.load_flag_reviews (athlete_id, reviewed_on);
create index if not exists load_flag_reviews_day_idx on public.load_flag_reviews (reviewed_on);

alter table public.load_flag_reviews enable row level security;
revoke all on table public.load_flag_reviews from public, anon, authenticated;
grant all on table public.load_flag_reviews to service_role;

-- Today at the club (Perth), so "the last 7 days", review dates and the
-- Child Safety Officer's week follow the club's calendar, not UTC's.
create or replace function public.load_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Australia/Perth')::date;
$$;

revoke execute on function public.load_today() from public, anon, authenticated;

-- An athlete's load as of a day: the mean daily load (minutes times effort)
-- of the last 7 days (acute) against the mean of the last 28 days, those 7
-- included (chronic). Rolling averages are the method behind Gabbett 2016's
-- 0.8 to 1.3 and 1.5 figures, so the ratio needs no warm-up: steady
-- training is 1.0 from the first 4 weeks, and a week at double the usual
-- load is 1.6. Sessions logged for the day after (time zones) count on the
-- day. Closed to everyone; the functions below call it.
create or replace function public.load_numbers(p_athlete uuid, p_on date)
returns table (
  acute numeric,
  chronic numeric,
  ratio numeric,
  weeks_before int,
  minutes_7d int,
  sessions_7d int
)
language sql
stable
security definer
set search_path = ''
as $$
  with logs as (
    select least(s.day, p_on) as day, s.minutes, s.minutes * s.rpe as load
    from public.session_logs s
    where s.athlete_id = p_athlete and s.day between p_on - 27 and p_on + 1
  ),
  means as (
    select coalesce(sum(l.load) filter (where l.day > p_on - 7), 0) / 7.0 as acute,
      coalesce(sum(l.load), 0) / 28.0 as chronic
    from logs l
  )
  select round(m.acute, 1),
    round(m.chronic, 1),
    case when m.chronic > 0 then round(m.acute / m.chronic, 2) end,
    (select count(distinct (p_on - l.day - 7) / 7)::int from logs l where l.day <= p_on - 7),
    (select coalesce(sum(l.minutes), 0)::int from logs l where l.day > p_on - 7),
    (select count(*)::int from logs l where l.day > p_on - 7)
  from means m;
$$;

revoke execute on function public.load_numbers(uuid, date) from public, anon, authenticated;

-- Whether the club has turned on Training load flags (and check-ins).
create or replace function public.load_monitoring_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce((s.features ->> 'trainingLoad')::boolean, false)
      and coalesce((s.features ->> 'checkIns')::boolean, true)
    from public.club_settings s where s.id
  ), false);
$$;

revoke execute on function public.load_monitoring_on() from public, anon, authenticated;

-- The athlete's flags as of a day, in a fixed order: ratio, hours, injury,
-- then wellbeing when there's at least one of the others. Empty when none.
-- Closed to everyone.
create or replace function public.load_flags_on(p_athlete uuid, p_on date)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting text;
  v_hours_on boolean;
  v_dob date;
  v_under_17 boolean;
  v_age int;
  n record;
  v_flags text[] := '{}';
begin
  if not public.load_monitoring_on() then
    return v_flags;
  end if;

  select coalesce(s.load_ratio_flag, 'from_1_5'), coalesce(s.load_hours_flag, true)
  into v_setting, v_hours_on
  from public.club_settings s where s.id;
  v_setting := coalesce(v_setting, 'from_1_5');
  v_hours_on := coalesce(v_hours_on, true);

  select * into n from public.load_numbers(p_athlete, p_on);

  if v_setting <> 'off' and n.weeks_before >= 3 and n.ratio is not null
    and (n.ratio >= 1.5 or (v_setting = 'above_1_3' and n.ratio > 1.3)) then
    v_flags := v_flags || 'ratio'::text;
  end if;

  select p.date_of_birth, p.under_17 into v_dob, v_under_17 from public.profiles p where p.id = p_athlete;
  v_age := extract(year from age(p_on, v_dob))::int;
  if v_hours_on and v_dob is not null and v_age < 18 and n.minutes_7d > v_age * 60 then
    v_flags := v_flags || 'hours'::text;
  end if;

  -- An under 18's injuries reach their coaches only with a parent's consent
  -- for injuries (can_view_injury_details), so the prompt needs it too.
  if (not public.is_minor(v_dob, v_under_17) or public.has_child_consent(p_athlete, 'health'))
  and exists (
    select 1 from public.injuries i
    where i.athlete_id = p_athlete
      and i.status <> 'cleared'
      and coalesce(trim(i.restrictions), '') <> ''
      and i.injured_on <= p_on
      and exists (
        select 1 from public.session_logs s
        where s.athlete_id = p_athlete
          and s.day between greatest(p_on - 6, i.injured_on) and p_on + 1
      )
  ) then
    v_flags := v_flags || 'injury'::text;
  end if;

  if cardinality(v_flags) > 0 and (
    select count(*) from public.check_ins c
    where c.athlete_id = p_athlete and c.day between p_on - 6 and p_on
      and least(c.sleep, c.soreness, c.stress, c.mood) <= 2
  ) >= 2 then
    v_flags := v_flags || 'wellbeing'::text;
  end if;

  return v_flags;
end;
$$;

revoke execute on function public.load_flags_on(uuid, date) from public, anon, authenticated;

-- The latest review in the last 7 days, which closes the athlete's flags.
create or replace function public.recent_load_review(p_athlete uuid)
returns public.load_flag_reviews
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.load_flag_reviews r
  where r.athlete_id = p_athlete and r.reviewed_on > public.load_today() - 7
  order by r.created_at desc
  limit 1;
$$;

revoke execute on function public.recent_load_review(uuid) from public, anon, authenticated;

-- The athletes the signed-in coach may review: in a group they coach, and
-- for an under 18 only with a parent's data consent (as their check-ins).
create or replace function public.load_review_athletes()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- The join only lists the athletes in this coach's groups; whether they
  -- coach them (season, selections, checks) is coaches_athlete's rule.
  select distinct athlete.profile_id
  from public.team_members coach
  join public.team_members athlete on athlete.team_id = coach.team_id
  where coach.profile_id = auth.uid() and coach.team_role = 'coach'
    and athlete.team_role = 'athlete' and athlete.profile_id <> auth.uid()
    and public.coaches_athlete(athlete.profile_id)
    and public.has_child_consent(athlete.profile_id, 'data');
$$;

revoke execute on function public.load_review_athletes() from public, anon, authenticated;

-- The club's choices, for everyone signed in (the app explains the flags).
create or replace function public.load_monitoring_settings()
returns table (ratio_flag text, hours_flag boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.load_ratio_flag from public.club_settings s where s.id), 'from_1_5'),
    coalesce((select s.load_hours_flag from public.club_settings s where s.id), true)
  where public.is_approved();
$$;

revoke execute on function public.load_monitoring_settings() from public, anon;
grant execute on function public.load_monitoring_settings() to authenticated;

-- An admin picks the ratio flag and turns the hours flag on or off.
create or replace function public.admin_set_load_monitoring(p_ratio_flag text, p_hours_flag boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change training load flags';
  end if;
  if p_ratio_flag is null or p_ratio_flag not in ('from_1_5', 'above_1_3', 'off') then
    raise exception 'Choose 1.5 or more, above 1.3, or off';
  end if;
  if p_hours_flag is null then
    raise exception 'Choose whether to flag hours over age';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set load_ratio_flag = p_ratio_flag, load_hours_flag = p_hours_flag
  where id;
end;
$$;

revoke execute on function public.admin_set_load_monitoring(text, boolean) from public, anon;
grant execute on function public.admin_set_load_monitoring(text, boolean) to authenticated;

-- A coach's list: every athlete they may review with a flag today, or a
-- review in the last 7 days. Open flags first.
create or replace function public.coach_load_flags()
returns table (
  athlete_id uuid,
  athlete_name text,
  flags text[],
  ratio numeric,
  minutes_7d int,
  sessions_7d int,
  reviewed_on date,
  reviewer_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() then
    raise exception 'Only coaches see training load flags';
  end if;
  return query
    select a.id, coalesce(public.member_display_name(a.id), 'Athlete'), f.flags,
      n.ratio, n.minutes_7d, n.sessions_7d, r.reviewed_on, r.reviewer_name
    from public.load_review_athletes() a(id)
    cross join lateral (select public.load_flags_on(a.id, public.load_today()) as flags) f
    cross join lateral public.load_numbers(a.id, public.load_today()) n
    left join lateral (select * from public.recent_load_review(a.id)) r on true
    where cardinality(f.flags) > 0 or r.id is not null
    order by (r.id is null and cardinality(f.flags) > 0) desc, 2;
end;
$$;

revoke execute on function public.coach_load_flags() from public, anon;
grant execute on function public.coach_load_flags() to authenticated;

-- For a coach's to-do list: how many of their athletes have flags no coach
-- has talked with them about this week. Null for anyone who coaches nobody.
create or replace function public.coach_load_flag_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_approved() and exists (select 1 from public.load_review_athletes()) then (
    select count(*)::int
    from public.load_review_athletes() a(id)
    where cardinality(public.load_flags_on(a.id, public.load_today())) > 0
      and (select r.id from public.recent_load_review(a.id) r) is null
  ) end;
$$;

revoke execute on function public.coach_load_flag_count() from public, anon;
grant execute on function public.coach_load_flag_count() to authenticated;

-- One athlete's load for their own screen, a parent's, or a coach's.
-- * The athlete and their coaches get today's flags and numbers.
-- * Parents get the flags and numbers only through a coach's review: the
--   review's date, coach and flags, and only for 7 days.
-- * Only coaches get the review's note.
-- * Whether the athlete is 18 or over, for the adults-only fitness chart.
-- Refused for anyone who can't see the athlete's check-ins.
create or replace function public.athlete_load(p_athlete uuid)
returns table (
  flags text[],
  ratio numeric,
  weeks_before int,
  reviewed_on date,
  reviewer_name text,
  reviewed_flags text[],
  review_note text,
  adult boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coach boolean;
  v_self boolean;
  r public.load_flag_reviews;
  n record;
begin
  if p_athlete is null or not public.can_view_check_ins(p_athlete) then
    raise exception 'Training load not found';
  end if;
  v_self := p_athlete = auth.uid();
  v_coach := p_athlete in (select public.load_review_athletes());
  r := public.recent_load_review(p_athlete);
  select * into n from public.load_numbers(p_athlete, public.load_today());

  return query select
    case when v_self or v_coach then public.load_flags_on(p_athlete, public.load_today()) end,
    case when v_self or v_coach then n.ratio end,
    case when v_self or v_coach then n.weeks_before end,
    r.reviewed_on,
    r.reviewer_name,
    r.flags,
    case when v_coach then r.note end,
    not public.athlete_is_minor(p_athlete);
end;
$$;

revoke execute on function public.athlete_load(uuid) from public, anon;
grant execute on function public.athlete_load(uuid) to authenticated;

-- A coach marks that they talked with the athlete about their training load.
create or replace function public.review_load_flag(p_athlete uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flags text[];
begin
  if p_athlete is null or not public.is_approved()
    or p_athlete not in (select public.load_review_athletes()) then
    raise exception 'Only the athlete''s coaches can mark this';
  end if;
  if length(trim(coalesce(p_note, ''))) > 500 then
    raise exception 'Keep the note to 500 characters';
  end if;
  v_flags := public.load_flags_on(p_athlete, public.load_today());
  if cardinality(v_flags) = 0 then
    raise exception 'There''s no training load flag to close';
  end if;
  insert into public.load_flag_reviews (athlete_id, reviewed_by, reviewer_name, flags, note)
  values (p_athlete, auth.uid(), coalesce(public.my_display_name(), 'Coach'), v_flags,
    nullif(trim(p_note), ''));
end;
$$;

revoke execute on function public.review_load_flag(uuid, text) from public, anon;
grant execute on function public.review_load_flag(uuid, text) to authenticated;

-- Under 18s' load patterns for the Child Safety Officer: approved athletes
-- with a parent's data consent. Closed to everyone; the two functions below
-- call it.
create or replace function public.load_pattern_rows()
returns table (athlete_id uuid, athlete_name text, pattern text, since date)
language sql
stable
security definer
set search_path = ''
as $$
  with children as (
    select p.id
    from public.profiles p
    where p.status = 'approved'
      and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
      and public.is_minor(p.date_of_birth, p.under_17)
      and public.has_child_consent(p.id, 'data')
      and exists (select 1 from public.session_logs s where s.athlete_id = p.id and s.day > public.load_today() - 15)
  ),
  flagged as (
    select c.id,
      public.load_flags_on(c.id, public.load_today()) as now_flags,
      public.load_flags_on(c.id, public.load_today() - 7) as week_ago
    from children c
  )
  select f.id, coalesce(public.member_display_name(f.id), 'Athlete'), x.pattern, x.since
  from flagged f
  cross join lateral (
    select 'hours_2_weeks'::text as pattern, public.load_today() - 7 as since
    where 'hours' = any (f.now_flags) and 'hours' = any (f.week_ago)
    union all
    select 'with_wellbeing', public.load_today()
    where 'wellbeing' = any (f.now_flags)
    union all
    select 'not_followed_up', public.load_today() - 7
    where cardinality(f.week_ago) > 0
      and not exists (
        select 1 from public.load_flag_reviews r
        where r.athlete_id = f.id and r.reviewed_on >= public.load_today() - 7
      )
  ) x;
$$;

revoke execute on function public.load_pattern_rows() from public, anon, authenticated;

-- The patterns themselves, for the Child Safety Officer only. Each child
-- shown is logged as a view of their check-ins.
create or replace function public.load_patterns()
returns table (athlete_id uuid, athlete_name text, pattern text, since date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  v_logged uuid[] := '{}';
begin
  if not public.is_approved() or not public.is_child_safety_officer() then
    raise exception 'Only the Child Safety Officer sees training load patterns';
  end if;
  for rec in select * from public.load_pattern_rows() l order by l.athlete_name, l.pattern loop
    if not rec.athlete_id = any (v_logged) then
      perform public.write_record_access(rec.athlete_id, 'check_ins', null);
      v_logged := v_logged || rec.athlete_id;
    end if;
    athlete_id := rec.athlete_id;
    athlete_name := rec.athlete_name;
    pattern := rec.pattern;
    since := rec.since;
    return next;
  end loop;
end;
$$;

revoke execute on function public.load_patterns() from public, anon;
grant execute on function public.load_patterns() to authenticated;

-- For the Child Safety Officer's to-do list: how many children show a
-- pattern. Null for anyone else.
create or replace function public.load_pattern_alerts()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_approved() and public.is_child_safety_officer() then (
    select count(distinct l.athlete_id)::int from public.load_pattern_rows() l
  ) end;
$$;

revoke execute on function public.load_pattern_alerts() from public, anon;
grant execute on function public.load_pattern_alerts() to authenticated;

-- Old load reviews are removed with check-ins and session logs.
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
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_check_ins = row_count;

  -- Session logs go with check-ins, after the same period.
  delete from public.session_logs
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date
    and not public.on_legal_hold(athlete_id);
  get diagnostics v_session_logs = row_count;

  -- Coaches' "Talked with them" notes on training load go with them too.
  delete from public.load_flag_reviews
  where reviewed_on < (current_date - make_interval(months => s.retention_check_ins_months))::date
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
$$;

revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;
commit;
