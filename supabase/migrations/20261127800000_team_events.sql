-- Squad and team events made in the app (Matt, 27 November 2026: "is there a
-- way to include a team calendar feature also? ... admin wouldn't be
-- controlling it, so colours might clash").
--
-- Until now every event came from a Microsoft 365 calendar link an admin
-- added, or from PlayHQ fixtures. Now a squad's or team's coaches and
-- managers can add its events in the app: training, a game, a meeting, a
-- social event or anything else, on one day or repeating weekly.
--
-- Who does what:
--   - the squad's or team's coaches and managers (head and assistant coaches
--     alike) add, change, cancel, bring back and remove its events, while
--     they may work with children (public.leads_group: a stood-down coach or
--     one whose check lapsed can't). Admins can do the same for any squad or
--     team;
--   - everyone in the squad or team sees them (public.is_team_member: its
--     athletes, coaches, managers and physios, and the parents and guardians
--     of its athletes), and admins see them all. A child with no verified
--     parent or guardian sees none, as with the rest of the squad's things;
--   - an event marked "coaches and managers only" is seen by the squad's or
--     team's coaches and managers and by admins, nobody else;
--   - the committee, other squads and teams, guests and temporary helpers
--     see nothing.
--
-- A cancelled event stays on the calendar, marked cancelled, so families see
-- that it's off. An event that hasn't started can be removed instead, for
-- one added by mistake. There are no replies, comments or answers on an
-- event: it is a notice from the coaches, so nothing changes in the rules
-- for members under 18.
--
-- Times are given as the club's own day and clock time and stored as moments
-- (public.club_timezone), so a phone set to another zone can't move an event.
--
-- The app shows it only when an admin turns on "Squad and team events" in
-- Club features (off by default; it can be on for pilot teams only), and
-- only while the Calendar is on.
--
-- Colours: the list grows from 8 to 12. A colour an admin picks for a
-- calendar is kept for it; squads and teams take theirs from the colours no
-- calendar uses (public.reserved_calendar_colours tells the app which those
-- are; the app shares them out in squad and team order, src/lib/group-colours.ts).
--
-- Additive: one new table, new functions, and four more colours allowed on
-- calendars. No existing rows change.

begin;

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

-- Whether squad and team events are on for the signed-in member: off by
-- default, off outside the pilot teams while pilot-only, and off whenever the
-- Calendar is.
create or replace function public.team_events_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.member_features() ->> 'teamEvents')::boolean, false)
    and coalesce((public.member_features() ->> 'calendar')::boolean, true);
$$;
revoke execute on function public.team_events_on() from public, anon;
grant execute on function public.team_events_on() to authenticated;

-- Whether the signed-in member may add and change a squad's or team's events:
-- its coaches and managers, and admins.
create or replace function public.can_manage_team_events(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.team_events_on() and (public.is_admin() or public.leads_group(p_team_id));
$$;
revoke execute on function public.can_manage_team_events(uuid) from public, anon;
grant execute on function public.can_manage_team_events(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  kind text not null default 'training'
    check (kind in ('training', 'game', 'meeting', 'social', 'other')),
  title text not null check (length(title) between 1 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Whole club days: starts_at is the first day's midnight in the club's
  -- zone and ends_at the midnight after the last day.
  all_day boolean not null default false,
  location text check (location is null or length(location) between 1 and 200),
  note text check (note is null or length(note) between 1 and 2000),
  -- Seen by the squad's or team's coaches and managers only.
  staff_only boolean not null default false,
  -- Shared by the events of one weekly repeat, so "this and later ones" works.
  series_id uuid,
  cancelled_at timestamptz,
  -- Names are kept as they were if the person later leaves.
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_by_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz,
  constraint calendar_events_ends_after_start check (ends_at > starts_at)
);

create index if not exists calendar_events_team_starts_idx on public.calendar_events (team_id, starts_at);
create index if not exists calendar_events_series_idx on public.calendar_events (series_id) where series_id is not null;
create index if not exists calendar_events_created_by_idx on public.calendar_events (created_by);
create index if not exists calendar_events_cancelled_by_idx on public.calendar_events (cancelled_by);
create index if not exists calendar_events_updated_by_idx on public.calendar_events (updated_by);

alter table public.calendar_events enable row level security;

-- Members read the events shown to them. Every change goes through the
-- functions below.
revoke all on table public.calendar_events from public, anon, authenticated;
grant select on table public.calendar_events to authenticated;
grant all on table public.calendar_events to service_role;

drop policy if exists "Members see their squads' and teams' events" on public.calendar_events;
create policy "Members see their squads' and teams' events"
  on public.calendar_events for select to authenticated
  using (
    (select public.team_events_on())
    and (
      (select public.is_admin())
      or case when staff_only then public.leads_group(team_id) else public.is_team_member(team_id) end
    )
  );

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The events the signed-in member sees that overlap [p_from, p_to), with the
-- club's own day and clock time for each (what the form shows when changing
-- one) and whether this member may change it. Row level security decides the
-- rows.
create or replace function public.team_events_between(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  team_kind text,
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
  staff_only boolean,
  series_id uuid,
  cancelled_at timestamptz,
  cancelled_by_name text,
  created_by_name text,
  can_manage boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.team_id, t.name, t.kind::text, e.kind, e.title, e.starts_at, e.ends_at, e.all_day,
    (e.starts_at at time zone public.club_timezone())::date,
    case when e.all_day
      then ((e.ends_at at time zone public.club_timezone()) - interval '1 day')::date
      else (e.starts_at at time zone public.club_timezone())::date
    end,
    to_char(e.starts_at at time zone public.club_timezone(), 'HH24:MI'),
    to_char(e.ends_at at time zone public.club_timezone(), 'HH24:MI'),
    e.location, e.note, e.staff_only, e.series_id, e.cancelled_at, e.cancelled_by_name,
    e.created_by_name, public.can_manage_team_events(e.team_id)
  from public.calendar_events e
  join public.teams t on t.id = e.team_id
  where e.ends_at > p_from and e.starts_at < p_to
  order by e.starts_at, e.id;
$$;
revoke execute on function public.team_events_between(timestamptz, timestamptz) from public, anon;
grant execute on function public.team_events_between(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding and changing
-- ---------------------------------------------------------------------------

-- Adds an event (p_id null) or changes one, and returns its id. The day and
-- times are the club's own. With p_repeat_until a new event repeats weekly up
-- to that day, each week its own event; changing one changes just that one.
create or replace function public.save_team_event(
  p_id uuid,
  p_team_id uuid,
  p_kind text,
  p_title text,
  p_day date,
  p_end_day date,
  p_all_day boolean,
  p_start time,
  p_end time,
  p_location text,
  p_note text,
  p_staff_only boolean,
  p_repeat_until date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.calendar_events;
  v_team uuid := p_team_id;
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
  if not public.team_events_on() then
    raise exception 'Squad and team events are turned off';
  end if;
  if p_id is not null then
    select * into v_event from public.calendar_events where id = p_id for update;
    if not found then
      raise exception 'That event is no longer on the calendar';
    end if;
    v_team := v_event.team_id;
  end if;
  if v_team is null or not exists (select 1 from public.teams where id = v_team and not archived) then
    raise exception 'Choose one of this season''s squads or teams';
  end if;
  if not public.can_manage_team_events(v_team) then
    raise exception 'Only the squad''s or team''s coaches and managers can change its events';
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
  -- The calendar reaches 12 months each way.
  if p_day < (v_today - interval '12 months')::date or p_day > (v_today + interval '12 months')::date then
    raise exception 'Choose a day within 12 months of today';
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
    update public.calendar_events
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
        staff_only = coalesce(p_staff_only, false),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_id;
    return p_id;
  end if;

  for i in 0..v_weeks loop
    v_day := p_day + i * 7;
    insert into public.calendar_events (
      team_id, kind, title, starts_at, ends_at, all_day, location, note, staff_only,
      series_id, created_by, created_by_name
    ) values (
      v_team, p_kind, v_title,
      case when v_all_day then v_day::timestamp at time zone v_zone
           else (v_day + p_start) at time zone v_zone end,
      case when v_all_day then (v_day + (v_last_day - p_day) + 1)::timestamp at time zone v_zone
           when v_end is null then ((v_day + p_start) at time zone v_zone) + interval '1 hour'
           else (v_day + v_end) at time zone v_zone end,
      v_all_day, v_location, v_note, coalesce(p_staff_only, false),
      v_series, auth.uid(), public.my_display_name()
    )
    returning id into v_id;
    if i = 0 then
      v_first := v_id;
    end if;
  end loop;
  return v_first;
end;
$$;
revoke execute on function public.save_team_event(uuid, uuid, text, text, date, date, boolean, time, time, text, text, boolean, date) from public, anon;
grant execute on function public.save_team_event(uuid, uuid, text, text, date, date, boolean, time, time, text, text, boolean, date) to authenticated;

-- Cancels an event, and with p_following the later ones of its weekly repeat
-- too. They stay on the calendar, marked cancelled. Returns how many it
-- cancelled.
create or replace function public.cancel_team_event(p_id uuid, p_following boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.calendar_events;
  v_count int;
begin
  if not public.team_events_on() then
    raise exception 'Squad and team events are turned off';
  end if;
  select * into v_event from public.calendar_events where id = p_id for update;
  if not found then
    raise exception 'That event is no longer on the calendar';
  end if;
  if not public.can_manage_team_events(v_event.team_id) then
    raise exception 'Only the squad''s or team''s coaches and managers can change its events';
  end if;
  update public.calendar_events e
  set cancelled_at = now(), cancelled_by = auth.uid(), cancelled_by_name = public.my_display_name()
  where e.cancelled_at is null
    and (
      e.id = p_id
      or (coalesce(p_following, false) and v_event.series_id is not null
          and e.series_id = v_event.series_id and e.starts_at > v_event.starts_at)
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.cancel_team_event(uuid, boolean) from public, anon;
grant execute on function public.cancel_team_event(uuid, boolean) to authenticated;

-- Brings a cancelled event back.
create or replace function public.restore_team_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.calendar_events;
begin
  if not public.team_events_on() then
    raise exception 'Squad and team events are turned off';
  end if;
  select * into v_event from public.calendar_events where id = p_id for update;
  if not found then
    raise exception 'That event is no longer on the calendar';
  end if;
  if not public.can_manage_team_events(v_event.team_id) then
    raise exception 'Only the squad''s or team''s coaches and managers can change its events';
  end if;
  update public.calendar_events
  set cancelled_at = null, cancelled_by = null, cancelled_by_name = null,
      updated_by = auth.uid(), updated_at = now()
  where id = p_id;
end;
$$;
revoke execute on function public.restore_team_event(uuid) from public, anon;
grant execute on function public.restore_team_event(uuid) to authenticated;

-- Takes an event that hasn't started off the calendar altogether, for one
-- added by mistake, and with p_following the later ones of its weekly repeat.
-- An event that has started can only be cancelled, so what happened stays on
-- the calendar. Returns how many it removed.
create or replace function public.remove_team_event(p_id uuid, p_following boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.calendar_events;
  v_count int;
begin
  if not public.team_events_on() then
    raise exception 'Squad and team events are turned off';
  end if;
  select * into v_event from public.calendar_events where id = p_id for update;
  if not found then
    raise exception 'That event is no longer on the calendar';
  end if;
  if not public.can_manage_team_events(v_event.team_id) then
    raise exception 'Only the squad''s or team''s coaches and managers can change its events';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'An event that has started can''t be removed. Cancel it instead';
  end if;
  delete from public.calendar_events e
  where e.id = p_id
    or (coalesce(p_following, false) and v_event.series_id is not null
        and e.series_id = v_event.series_id and e.starts_at > v_event.starts_at);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.remove_team_event(uuid, boolean) from public, anon;
grant execute on function public.remove_team_event(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Colours
-- ---------------------------------------------------------------------------

-- Four more colours, 12 in all. Keep the list in step with
-- src/constants/calendar-colors.ts.
alter table public.calendars drop constraint if exists calendars_color_check;
alter table public.calendars add constraint calendars_color_check
  check (color in (
    'yellow', 'blue', 'green', 'pink', 'orange', 'violet', 'light_blue', 'dark_blue',
    'red', 'lime', 'teal', 'magenta'
  ));

-- The colours calendars use, across the whole club, so the app can give
-- squads and teams the others and every member sees a squad in the same
-- colour whichever calendars they can see themselves. A calendar's colour is
-- the one its admin picked; with none picked, a calendar for the committee
-- alone is pink, a calendar for squads and teams alone takes its squad's or
-- team's colour (so it keeps none), and any other is yellow. Same rule as
-- colourAudience in src/lib/calendar-audience.ts. Colour names only.
create or replace function public.reserved_calendar_colours()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.colour order by x.colour), '{}')
  from (
    select coalesce(
      c.color,
      case
        when exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id and a.kind = 'everyone')
          then 'yellow'
        when exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id)
          and not exists (select 1 from public.calendar_audiences a where a.calendar_id = c.id and a.kind <> 'team')
          then null
        when (select count(*) from public.calendar_audiences a where a.calendar_id = c.id) = 1
          and exists (select 1 from public.calendar_audiences a
                      where a.calendar_id = c.id and a.kind = 'role' and a.role = 'committee')
          then 'pink'
        else 'yellow'
      end
    ) as colour
    from public.calendars c
  ) x
  where x.colour is not null and public.is_approved();
$$;
revoke execute on function public.reserved_calendar_colours() from public, anon;
grant execute on function public.reserved_calendar_colours() to authenticated;

commit;
