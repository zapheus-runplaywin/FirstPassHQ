-- Calendars that live in the app (Matt, 27 November 2026: "Maybe there are
-- two club calendars? One ICS and one in app", "managers and coaches can
-- suggest events for admin to accept into the club calendar", and, so the
-- club keeps a single source of truth, "an import from ics is a better
-- starting point").
--
-- Each calendar has one home. Until now every calendar was a Microsoft 365
-- link the app reads. Now an admin can also keep a calendar in the app:
--   - add a new one that lives in the app, or
--   - move a linked one in: the app reads the link one last time, its events
--     are copied in, and the link is put aside (kept in imported_from_url, so
--     nothing is lost and an admin can see where it came from). From then on
--     the calendar is changed in the app only, so the two never drift apart.
--
-- Who does what on a calendar that lives in the app:
--   - admins add, change, cancel, bring back and remove its events;
--   - everyone the calendar is shown to sees its events (the same audience
--     rules as before: public.can_see_calendar);
--   - coaches, managers and committee members who see the calendar can
--     suggest an event, when the admin leaves "takes suggestions" on. A
--     suggestion is seen only by the person who made it and by admins until an
--     admin accepts it. An admin accepts it (a weekly one, every week of it),
--     changes it and accepts it, or declines it with a reason the suggester
--     sees. A role paused for a lapsed check or a stand-down can't suggest
--     (public.has_role);
--   - athletes, parents, physios, statisticians, guests and temporary helpers
--     only read.
--
-- There are no replies or comments on an event or a suggestion. The only
-- words that pass between people are the admin's reason for declining, shown
-- to the adult who suggested it, so nothing changes in the rules for members
-- under 18.
--
-- Additive: calendars gains columns and its link may now be empty (for a
-- calendar that lives in the app), one new table, new functions. No existing
-- rows change. An app without this update can't read a calendar that lives
-- in the app and shows "Couldn't load" beside its name until it updates.

begin;

-- ---------------------------------------------------------------------------
-- Calendars: a link, or in the app
-- ---------------------------------------------------------------------------

alter table public.calendars alter column url drop not null;
alter table public.calendars add column if not exists in_hq boolean not null default false;
alter table public.calendars add column if not exists takes_suggestions boolean not null default true;
-- Where a calendar that was moved in came from, when, and who moved it.
alter table public.calendars add column if not exists imported_from_url text;
alter table public.calendars add column if not exists moved_in_at timestamptz;
alter table public.calendars add column if not exists moved_in_by_name text;

alter table public.calendars drop constraint if exists calendars_link_or_in_hq;
alter table public.calendars add constraint calendars_link_or_in_hq
  check ((in_hq and url is null) or (not in_hq and url is not null));

-- ---------------------------------------------------------------------------
-- Events on a calendar that lives in the app
-- ---------------------------------------------------------------------------

create table if not exists public.hq_calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('training', 'game', 'meeting', 'social', 'other')),
  title text not null check (length(title) between 1 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Whole club days: starts_at is the first day's midnight in the club's
  -- zone and ends_at the midnight after the last day.
  all_day boolean not null default false,
  location text check (location is null or length(location) between 1 and 200),
  note text check (note is null or length(note) between 1 and 2000),
  -- Shared by the events of one weekly repeat.
  series_id uuid,
  -- 'on': on the calendar. 'suggested': waiting for an admin. 'declined': an
  -- admin said no, with a reason.
  status text not null default 'on' check (status in ('on', 'suggested', 'declined')),
  -- Copied in from the calendar's old link when it was moved into the app.
  imported boolean not null default false,
  cancelled_at timestamptz,
  -- Names are kept as they were if the person later leaves.
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_by_name text,
  -- Who added it, or suggested it.
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  -- The admin who accepted or declined a suggestion.
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decline_reason text check (decline_reason is null or length(decline_reason) between 1 and 300),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz,
  constraint hq_calendar_events_ends_after_start check (ends_at > starts_at),
  constraint hq_calendar_events_declined_has_reason check (status <> 'declined' or decline_reason is not null)
);

create index if not exists hq_calendar_events_calendar_starts_idx on public.hq_calendar_events (calendar_id, starts_at);
create index if not exists hq_calendar_events_series_idx on public.hq_calendar_events (series_id) where series_id is not null;
create index if not exists hq_calendar_events_waiting_idx on public.hq_calendar_events (starts_at) where status = 'suggested';
create index if not exists hq_calendar_events_created_by_idx on public.hq_calendar_events (created_by);
create index if not exists hq_calendar_events_cancelled_by_idx on public.hq_calendar_events (cancelled_by);
create index if not exists hq_calendar_events_decided_by_idx on public.hq_calendar_events (decided_by);
create index if not exists hq_calendar_events_updated_by_idx on public.hq_calendar_events (updated_by);

alter table public.hq_calendar_events enable row level security;

-- Members read the events shown to them. Every change goes through the
-- functions below.
revoke all on table public.hq_calendar_events from public, anon, authenticated;
grant select on table public.hq_calendar_events to authenticated;
grant all on table public.hq_calendar_events to service_role;

-- Whether the Calendar is on for the signed-in member.
create or replace function public.calendar_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.member_features() ->> 'calendar')::boolean, true);
$$;
revoke execute on function public.calendar_on() from public, anon;
grant execute on function public.calendar_on() to authenticated;

-- An event that's on the calendar: everyone the calendar is shown to. A
-- suggestion or a declined one: the person who made it, and admins.
drop policy if exists "Members see the events of calendars shown to them" on public.hq_calendar_events;
create policy "Members see the events of calendars shown to them"
  on public.hq_calendar_events for select to authenticated
  using (
    (select public.calendar_on())
    and (
      (select public.is_admin())
      or (status = 'on' and public.can_see_calendar(calendar_id))
      or (created_by = (select auth.uid()) and (select public.is_approved()))
    )
  );

-- Whether the signed-in member may suggest an event for a calendar: it lives
-- in the app and takes suggestions, they see it, and they are a coach, a
-- manager or on the committee (a paused role doesn't count). Admins add
-- events themselves.
create or replace function public.can_suggest_event(p_calendar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.calendar_on()
    and not public.is_admin()
    and (public.has_role('coach') or public.has_role('manager') or public.has_role('committee'))
    and exists (
      select 1 from public.calendars c
      where c.id = p_calendar_id and c.in_hq and c.takes_suggestions
    )
    and public.can_see_calendar(p_calendar_id);
$$;
revoke execute on function public.can_suggest_event(uuid) from public, anon;
grant execute on function public.can_suggest_event(uuid) to authenticated;

-- The calendars that live in the app which the signed-in member may add to
-- (admins) or suggest for, for the form's "For" choice.
create or replace function public.hq_calendars_to_add_to()
returns table (id uuid, name text, color text, everyone boolean, suggest boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.color,
    exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id and a.kind = 'everyone'),
    not public.is_admin()
  from public.calendars c
  where c.in_hq and public.calendar_on()
    and (public.is_admin() or public.can_suggest_event(c.id))
  order by c.created_at, c.id;
$$;
revoke execute on function public.hq_calendars_to_add_to() from public, anon;
grant execute on function public.hq_calendars_to_add_to() to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The events the signed-in member sees that overlap [p_from, p_to), with the
-- club's own day and clock time for each. Row level security decides the
-- rows. can_manage: an admin, or the person who suggested it while it waits.
create or replace function public.hq_events_between(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  calendar_id uuid,
  calendar_name text,
  kind text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  day date,
  end_day date,
  start_time text,
  end_time text,
  location text,
  note text,
  series_id uuid,
  status text,
  cancelled_at timestamptz,
  cancelled_by_name text,
  created_by_name text,
  decided_by_name text,
  decline_reason text,
  mine boolean,
  can_manage boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.calendar_id, c.name, e.kind, e.title, e.starts_at, e.ends_at, e.all_day,
    (e.starts_at at time zone public.club_timezone())::date,
    case when e.all_day
      then ((e.ends_at at time zone public.club_timezone()) - interval '1 day')::date
      else (e.starts_at at time zone public.club_timezone())::date
    end,
    to_char(e.starts_at at time zone public.club_timezone(), 'HH24:MI'),
    to_char(e.ends_at at time zone public.club_timezone(), 'HH24:MI'),
    e.location, e.note, e.series_id, e.status, e.cancelled_at, e.cancelled_by_name,
    e.created_by_name, e.decided_by_name, e.decline_reason,
    coalesce(e.created_by = auth.uid(), false),
    public.is_admin() or (coalesce(e.created_by = auth.uid(), false) and e.status = 'suggested')
  from public.hq_calendar_events e
  join public.calendars c on c.id = e.calendar_id
  where e.ends_at > p_from and e.starts_at < p_to
  order by e.starts_at, e.id;
$$;
revoke execute on function public.hq_events_between(timestamptz, timestamptz) from public, anon;
grant execute on function public.hq_events_between(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding, suggesting and changing
-- ---------------------------------------------------------------------------

-- Adds an event (p_id null) or changes one, and returns its id. An admin's
-- event goes straight on the calendar. A coach's, manager's or committee
-- member's is a suggestion, waiting for an admin. The person who suggested
-- one can change it while it waits. An admin who changes a suggestion accepts
-- it as changed. The day and times are the club's own. With p_repeat_until a
-- new event repeats weekly up to that day, each week its own event.
create or replace function public.save_hq_event(
  p_id uuid,
  p_calendar_id uuid,
  p_kind text,
  p_title text,
  p_day date,
  p_end_day date,
  p_all_day boolean,
  p_start time,
  p_end time,
  p_location text,
  p_note text,
  p_repeat_until date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.hq_calendar_events;
  v_calendar uuid := p_calendar_id;
  v_admin boolean := public.is_admin();
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_location text := nullif(trim(coalesce(p_location, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_all_day boolean := coalesce(p_all_day, false);
  v_zone text := public.club_timezone();
  v_today date := public.club_today();
  v_last_day date;
  v_end time;
  v_weeks int := 0;
  v_series uuid;
  v_id uuid;
  v_first uuid;
  v_day date;
begin
  if not public.calendar_on() then
    raise exception 'The calendar is turned off';
  end if;
  if p_id is not null then
    select * into v_event from public.hq_calendar_events where id = p_id for update;
    if not found then
      raise exception 'That event is no longer on the calendar';
    end if;
    v_calendar := v_event.calendar_id;
    if not v_admin and not (v_event.created_by = auth.uid() and v_event.status = 'suggested'
                            and public.can_suggest_event(v_calendar)) then
      raise exception 'Only admins can change this calendar''s events';
    end if;
  else
    if v_calendar is null or not exists (select 1 from public.calendars where id = v_calendar and in_hq) then
      raise exception 'Choose a calendar that is kept in the app';
    end if;
    if not v_admin and not public.can_suggest_event(v_calendar) then
      raise exception 'Only admins can add to this calendar';
    end if;
  end if;
  if coalesce(p_kind, '') not in ('training', 'game', 'meeting', 'social', 'other') then
    raise exception 'Choose what kind of event it is';
  end if;
  if v_title is null then
    raise exception 'Give the event a name';
  end if;
  if length(v_title) > 100 then
    raise exception 'Keep the name to 100 characters';
  end if;
  if length(v_location) > 200 then
    raise exception 'Keep the place to 200 characters';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note to 2,000 characters';
  end if;
  if p_day is null then
    raise exception 'Choose a day';
  end if;
  -- The calendar reaches 12 months each way; a suggestion is for a day to come.
  if p_day < (v_today - interval '12 months')::date or p_day > (v_today + interval '12 months')::date then
    raise exception 'Choose a day within 12 months of today';
  end if;
  if not v_admin and p_day < v_today then
    raise exception 'Suggest an event for today or later';
  end if;

  if v_all_day then
    v_last_day := coalesce(p_end_day, p_day);
    if v_last_day < p_day then
      raise exception 'The last day must be on or after the first';
    end if;
    if v_last_day > p_day + 13 then
      raise exception 'An event can run for up to 14 days';
    end if;
  else
    if p_start is null then
      raise exception 'Give a start time, or make it all day';
    end if;
    v_end := p_end;
    if v_end is not null and v_end <= p_start then
      raise exception 'The finish time must be after the start';
    end if;
  end if;

  if p_id is null and p_repeat_until is not null then
    if p_repeat_until <= p_day then
      raise exception 'Choose a last day after the first one';
    end if;
    v_weeks := (p_repeat_until - p_day) / 7;
    if v_weeks > 51 then
      raise exception 'A weekly event can repeat for up to a year';
    end if;
    if v_weeks > 0 then
      v_series := gen_random_uuid();
    end if;
  end if;

  if p_id is not null then
    update public.hq_calendar_events
    set kind = p_kind,
        title = v_title,
        starts_at = case when v_all_day then p_day::timestamp at time zone v_zone
                         else (p_day + p_start) at time zone v_zone end,
        ends_at = case when v_all_day then (v_last_day + 1)::timestamp at time zone v_zone
                       when v_end is null then ((p_day + p_start) at time zone v_zone) + interval '1 hour'
                       else (p_day + v_end) at time zone v_zone end,
        all_day = v_all_day,
        location = v_location,
        note = v_note,
        -- An admin changing a suggestion accepts it as changed.
        status = case when v_admin and status = 'suggested' then 'on' else status end,
        decided_by = case when v_admin and status = 'suggested' then auth.uid() else decided_by end,
        decided_by_name = case when v_admin and status = 'suggested' then public.my_display_name() else decided_by_name end,
        decided_at = case when v_admin and status = 'suggested' then now() else decided_at end,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_id;
    return p_id;
  end if;

  for i in 0..v_weeks loop
    v_day := p_day + i * 7;
    insert into public.hq_calendar_events (
      calendar_id, kind, title, starts_at, ends_at, all_day, location, note,
      series_id, status, created_by, created_by_name
    ) values (
      v_calendar, p_kind, v_title,
      case when v_all_day then v_day::timestamp at time zone v_zone
           else (v_day + p_start) at time zone v_zone end,
      case when v_all_day then (v_day + (v_last_day - p_day) + 1)::timestamp at time zone v_zone
           when v_end is null then ((v_day + p_start) at time zone v_zone) + interval '1 hour'
           else (v_day + v_end) at time zone v_zone end,
      v_all_day, v_location, v_note,
      v_series, case when v_admin then 'on' else 'suggested' end, auth.uid(), public.my_display_name()
    )
    returning id into v_id;
    if i = 0 then
      v_first := v_id;
    end if;
  end loop;
  return v_first;
end;
$$;
revoke execute on function public.save_hq_event(uuid, uuid, text, text, date, date, boolean, time, time, text, text, date) from public, anon;
grant execute on function public.save_hq_event(uuid, uuid, text, text, date, date, boolean, time, time, text, text, date) to authenticated;

-- An admin accepts a suggestion or declines it with a reason. A weekly
-- suggestion is decided as one: every week of it still waiting. Returns how
-- many events it decided.
create or replace function public.decide_event_suggestion(p_id uuid, p_accept boolean, p_reason text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.hq_calendar_events;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_count int;
begin
  if not public.calendar_on() then
    raise exception 'The calendar is turned off';
  end if;
  if not public.is_admin() then
    raise exception 'Only admins can accept or decline a suggested event';
  end if;
  select * into v_event from public.hq_calendar_events where id = p_id for update;
  if not found then
    raise exception 'That suggestion is no longer there';
  end if;
  if v_event.status <> 'suggested' then
    raise exception 'That suggestion has already been answered';
  end if;
  if not coalesce(p_accept, false) then
    if v_reason is null then
      raise exception 'Say why, so the person who suggested it knows';
    end if;
    if length(v_reason) > 300 then
      raise exception 'Keep the reason to 300 characters';
    end if;
  end if;
  update public.hq_calendar_events e
  set status = case when coalesce(p_accept, false) then 'on' else 'declined' end,
      decline_reason = case when coalesce(p_accept, false) then null else v_reason end,
      decided_by = auth.uid(),
      decided_by_name = public.my_display_name(),
      decided_at = now()
  where e.status = 'suggested'
    and (e.id = p_id or (v_event.series_id is not null and e.series_id = v_event.series_id));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.decide_event_suggestion(uuid, boolean, text) from public, anon;
grant execute on function public.decide_event_suggestion(uuid, boolean, text) to authenticated;

-- An admin cancels an event that's on the calendar, and with p_following the
-- later ones of its weekly repeat too. They stay, marked cancelled.
create or replace function public.cancel_hq_event(p_id uuid, p_following boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.hq_calendar_events;
  v_count int;
begin
  if not public.calendar_on() then
    raise exception 'The calendar is turned off';
  end if;
  if not public.is_admin() then
    raise exception 'Only admins can change this calendar''s events';
  end if;
  select * into v_event from public.hq_calendar_events where id = p_id for update;
  if not found or v_event.status <> 'on' then
    raise exception 'That event is no longer on the calendar';
  end if;
  update public.hq_calendar_events e
  set cancelled_at = now(), cancelled_by = auth.uid(), cancelled_by_name = public.my_display_name()
  where e.cancelled_at is null and e.status = 'on'
    and (e.id = p_id
      or (coalesce(p_following, false) and v_event.series_id is not null
          and e.series_id = v_event.series_id and e.starts_at > v_event.starts_at));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.cancel_hq_event(uuid, boolean) from public, anon;
grant execute on function public.cancel_hq_event(uuid, boolean) to authenticated;

-- An admin puts a cancelled event back on.
create or replace function public.restore_hq_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.calendar_on() then
    raise exception 'The calendar is turned off';
  end if;
  if not public.is_admin() then
    raise exception 'Only admins can change this calendar''s events';
  end if;
  update public.hq_calendar_events
  set cancelled_at = null, cancelled_by = null, cancelled_by_name = null
  where id = p_id and status = 'on';
  if not found then
    raise exception 'That event is no longer on the calendar';
  end if;
end;
$$;
revoke execute on function public.restore_hq_event(uuid) from public, anon;
grant execute on function public.restore_hq_event(uuid) to authenticated;

-- Takes an event off altogether, and with p_following the later ones of its
-- weekly repeat. An admin can remove one that hasn't started (one that has
-- stays, so cancel it instead). The person who suggested an event can take
-- back their own suggestion, waiting or declined: it was never on the
-- calendar.
create or replace function public.remove_hq_event(p_id uuid, p_following boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.hq_calendar_events;
  v_admin boolean := public.is_admin();
  v_count int;
begin
  if not public.calendar_on() then
    raise exception 'The calendar is turned off';
  end if;
  select * into v_event from public.hq_calendar_events where id = p_id for update;
  if not found then
    raise exception 'That event is no longer on the calendar';
  end if;
  if v_admin then
    if v_event.status = 'on' and v_event.starts_at <= now() then
      raise exception 'An event that has started can''t be removed. Cancel it instead';
    end if;
  elsif not (v_event.created_by = auth.uid() and v_event.status in ('suggested', 'declined')) then
    raise exception 'Only admins can change this calendar''s events';
  end if;
  delete from public.hq_calendar_events e
  where e.id = p_id
    or (coalesce(p_following, false) and v_event.series_id is not null
        and e.series_id = v_event.series_id and e.starts_at > v_event.starts_at
        and e.status = v_event.status
        and (v_admin or e.created_by = auth.uid()));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.remove_hq_event(uuid, boolean) from public, anon;
grant execute on function public.remove_hq_event(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Admins: a calendar in the app
-- ---------------------------------------------------------------------------

-- Adds a calendar that lives in the app (p_id null) or changes one, with who
-- sees it and whether it takes suggestions. Returns its id. Admins only. The
-- audience rules are admin_save_calendar's.
create or replace function public.admin_save_hq_calendar(
  p_id uuid,
  p_name text,
  p_color text,
  p_everyone boolean,
  p_roles text[],
  p_team_ids uuid[],
  p_posts text[],
  p_takes_suggestions boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change calendars';
  end if;
  if p_id is null then
    -- Made as a linked calendar for a moment, so the one function checks the
    -- name and the audience, then turned into one that lives in the app.
    v_id := public.admin_save_calendar(
      null, p_name, 'https://in-the-app.invalid/calendar.ics', p_color, p_everyone, p_roles, p_team_ids, p_posts);
    update public.calendars
    set in_hq = true, url = null, takes_suggestions = coalesce(p_takes_suggestions, true)
    where id = v_id;
  else
    if not exists (select 1 from public.calendars where id = p_id and in_hq) then
      raise exception 'That calendar isn''t kept in the app';
    end if;
    v_id := public.admin_save_calendar(p_id, p_name, null, p_color, p_everyone, p_roles, p_team_ids, p_posts);
    update public.calendars
    set takes_suggestions = coalesce(p_takes_suggestions, true)
    where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.admin_save_hq_calendar(uuid, text, text, boolean, text[], uuid[], text[], boolean) from public, anon;
grant execute on function public.admin_save_hq_calendar(uuid, text, text, boolean, text[], uuid[], text[], boolean) to authenticated;

-- Moves a linked calendar into the app, once. The admin's app reads the link
-- one last time and hands over its events (the 12 months each side of today
-- the calendar reaches), which are copied in; then the link is put aside in
-- imported_from_url. p_events is a list of
--   {title, all_day, starts_at, ends_at, day, end_day, location, note}
-- with starts_at and ends_at for a timed event and day and end_day (club
-- days, the last day included) for an all-day one. Returns how many events
-- were copied in. Admins only.
create or replace function public.admin_move_calendar_into_hq(p_id uuid, p_events jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calendar public.calendars;
  v_zone text := public.club_timezone();
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change calendars';
  end if;
  select * into v_calendar from public.calendars where id = p_id for update;
  if not found then
    raise exception 'That calendar no longer exists';
  end if;
  if v_calendar.in_hq then
    raise exception 'That calendar is already kept in the app';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'The calendar''s events couldn''t be read. Try again';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise exception 'That calendar has more than 5,000 events in the two years the app shows. Tidy it in Outlook first';
  end if;

  insert into public.hq_calendar_events (
    calendar_id, kind, title, starts_at, ends_at, all_day, location, note, imported, created_by, created_by_name
  )
  select p_id, 'other', x.title, x.starts_at,
    -- An event with no length, or one that ends before it starts, is kept as an hour.
    case when x.ends_at > x.starts_at then x.ends_at
         when x.all_day then x.starts_at + interval '1 day'
         else x.starts_at + interval '1 hour' end,
    x.all_day, x.location, x.note, true, auth.uid(), public.my_display_name()
  from (
    select
      coalesce(nullif(left(trim(coalesce(e ->> 'title', '')), 100), ''), 'Event') as title,
      coalesce((e ->> 'all_day')::boolean, false) as all_day,
      case when coalesce((e ->> 'all_day')::boolean, false)
        then (e ->> 'day')::date::timestamp at time zone v_zone
        else (e ->> 'starts_at')::timestamptz end as starts_at,
      case when coalesce((e ->> 'all_day')::boolean, false)
        then (coalesce((e ->> 'end_day')::date, (e ->> 'day')::date) + 1)::timestamp at time zone v_zone
        else (e ->> 'ends_at')::timestamptz end as ends_at,
      nullif(left(trim(coalesce(e ->> 'location', '')), 200), '') as location,
      nullif(left(trim(coalesce(e ->> 'note', '')), 2000), '') as note
    from jsonb_array_elements(p_events) e
  ) x
  where x.starts_at is not null;
  get diagnostics v_count = row_count;

  update public.calendars
  set in_hq = true,
      imported_from_url = url,
      url = null,
      moved_in_at = now(),
      moved_in_by_name = public.my_display_name()
  where id = p_id;
  return v_count;
end;
$$;
revoke execute on function public.admin_move_calendar_into_hq(uuid, jsonb) from public, anon;
grant execute on function public.admin_move_calendar_into_hq(uuid, jsonb) to authenticated;

commit;
