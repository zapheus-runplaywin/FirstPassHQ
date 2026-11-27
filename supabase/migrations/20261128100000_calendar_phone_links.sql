-- A phone link for a club-wide calendar kept in the app.
--
-- An admin can turn on one link for a calendar that is kept in the app and
-- shown to everyone in the club. A phone's calendar app subscribes to it and
-- shows the calendar's events, read only, without signing in: the link is
-- the key. Off until an admin turns it on; an admin can reset it (the old
-- link stops working) or turn it off.
--
-- What the link gives: each event's name, time, place and whether it's
-- cancelled, from 3 months back to 12 months ahead. Never an event's note,
-- who added it, a suggestion or a declined one. It stops at once when the
-- link is turned off or reset, the calendar stops being shown to everyone,
-- is deleted, or the club's Calendar feature is off.
--
-- The link is served by the calendar-feed function with the service role
-- (supabase/functions/calendar-feed), the only caller of
-- public.calendar_phone_feed. Members' apps never read the table.
--
-- Additive: one new table and four functions. Nothing existing changes.

begin;

create table if not exists public.calendar_phone_links (
  calendar_id uuid primary key references public.calendars (id) on delete cascade,
  -- The key in the link: 48 random hex characters.
  token text not null unique check (length(token) >= 32),
  created_at timestamptz not null default now(),
  -- Names are kept as they were if the person later leaves.
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text
);

alter table public.calendar_phone_links enable row level security;
-- Reached only through the functions below.
revoke all on table public.calendar_phone_links from public, anon, authenticated;
grant all on table public.calendar_phone_links to service_role;

-- Whether a calendar can have a phone link: kept in the app and shown to
-- everyone in the club.
create or replace function public.calendar_can_have_phone_link(p_calendar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendars c
    where c.id = p_calendar_id
      and c.in_hq
      and exists (
        select 1 from public.calendar_audiences a
        where a.calendar_id = c.id and a.kind = 'everyone'
      )
  );
$$;
-- Used only inside the functions below, which run as their owner.
revoke execute on function public.calendar_can_have_phone_link(uuid) from public, anon, authenticated;
grant execute on function public.calendar_can_have_phone_link(uuid) to service_role;

-- The phone links that are on, for the admin's Calendars screen. A link whose
-- calendar is no longer shown to everyone isn't listed: it doesn't work.
create or replace function public.admin_calendar_phone_links()
returns table (calendar_id uuid, token text, created_at timestamptz, created_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see phone links';
  end if;
  return query
    select l.calendar_id, l.token, l.created_at, l.created_by_name
    from public.calendar_phone_links l
    where public.calendar_can_have_phone_link(l.calendar_id);
end;
$$;
revoke execute on function public.admin_calendar_phone_links() from public, anon;
grant execute on function public.admin_calendar_phone_links() to authenticated;

-- Turns a calendar's phone link on, off, or resets it. p_action:
--   'on'    makes a link if there is none, and returns the key
--   'reset' replaces the key, so the old link stops working
--   'off'   removes it; returns null
-- Admins only, and only for a calendar kept in the app and shown to everyone.
create or replace function public.admin_set_calendar_phone_link(p_calendar_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change phone links';
  end if;
  if p_action is null or p_action not in ('on', 'reset', 'off') then
    raise exception 'Choose on, reset or off';
  end if;

  if p_action = 'off' then
    delete from public.calendar_phone_links where calendar_id = p_calendar_id;
    return null;
  end if;

  if not public.calendar_can_have_phone_link(p_calendar_id) then
    raise exception 'A phone link is only for a calendar kept in the app and shown to everyone in the club';
  end if;

  if p_action = 'on' then
    select l.token into v_token from public.calendar_phone_links l where l.calendar_id = p_calendar_id;
    if v_token is not null then
      return v_token;
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.calendar_phone_links (calendar_id, token, created_by, created_by_name)
  values (p_calendar_id, v_token, auth.uid(), public.my_display_name())
  on conflict (calendar_id) do update
    set token = excluded.token,
        created_at = now(),
        created_by = excluded.created_by,
        created_by_name = excluded.created_by_name;
  return v_token;
end;
$$;
revoke execute on function public.admin_set_calendar_phone_link(uuid, text) from public, anon;
grant execute on function public.admin_set_calendar_phone_link(uuid, text) to authenticated;

-- What a phone link gives, for the calendar-feed function: the calendar's
-- name and its events on the calendar (cancelled ones marked), 3 months back
-- to 12 months ahead, as
--   {name, events: [{id, title, all_day, starts_at, ends_at, day, end_day,
--                    location, cancelled, changed_at}]}
-- with day and end_day the club's own days (the last day included) for an
-- all-day event. Null when the key is unknown or the link no longer works.
-- No notes, no names of people, no suggestions. Service role only.
create or replace function public.calendar_phone_feed(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_calendar public.calendars%rowtype;
  v_on boolean;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select c.* into v_calendar
  from public.calendar_phone_links l
  join public.calendars c on c.id = l.calendar_id
  where l.token = p_token;
  if not found or not public.calendar_can_have_phone_link(v_calendar.id) then
    return null;
  end if;
  -- The club's Calendar feature must be on for everyone, not only a pilot.
  select coalesce((s.features ->> 'calendar')::boolean, true)
         and not coalesce((s.pilot_features ->> 'calendar')::boolean, false)
    into v_on
  from public.club_settings s
  where s.id;
  if not coalesce(v_on, true) then
    return null;
  end if;

  return jsonb_build_object(
    'name', v_calendar.name,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'all_day', e.all_day,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at,
        'day', (e.starts_at at time zone public.club_timezone())::date,
        'end_day', case when e.all_day
          then ((e.ends_at at time zone public.club_timezone()) - interval '1 day')::date
          else (e.starts_at at time zone public.club_timezone())::date end,
        'location', e.location,
        'cancelled', e.cancelled_at is not null,
        'changed_at', coalesce(e.updated_at, e.created_at)
      ) order by e.starts_at, e.id)
      from (
        select *
        from public.hq_calendar_events x
        where x.calendar_id = v_calendar.id
          and x.status = 'on'
          and x.ends_at > now() - interval '3 months'
          and x.starts_at < now() + interval '12 months'
        order by x.starts_at, x.id
        limit 3000
      ) e
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.calendar_phone_feed(text) from public, anon, authenticated;
grant execute on function public.calendar_phone_feed(text) to service_role;

commit;
