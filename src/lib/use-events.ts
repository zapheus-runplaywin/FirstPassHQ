import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { calendarColorHex } from '@/constants/calendar-colors';
import { useAuth } from '@/lib/auth';
import { parseIcs, type CalendarEvent } from '@/lib/calendar';
import { colourAudience, shownToFromRows, type AudienceRow } from '@/lib/calendar-audience';
import { supabase } from '@/lib/supabase';
import type { GroupKind } from '@/lib/types';

/** How many months ahead the app shows events at first. */
export const DEFAULT_MONTHS_AHEAD = 3;
/** How far ahead members can load events. */
export const MAX_MONTHS_AHEAD = 12;
/** How far back members can look, counted in whole months. */
export const MAX_MONTHS_BACK = 12;
const CACHE_PREFIX = 'ics-cache:';

/** The most recently loaded events, so the details screen opens instantly. */
const loadedEvents = new Map<string, CalendarEvent>();

type CalendarRow = {
  id: string;
  name: string;
  url: string;
  clubWide: boolean;
  color: string;
};

/**
 * Events from every calendar this member can see: the club calendar plus the
 * calendars an admin has shown to their roles, safeguarding posts, squads and
 * teams. The database decides which rows they get.
 * Each ICS file is cached so the last copy still shows when offline.
 */
export function useEvents() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [monthsAhead, setMonthsAhead] = useState(DEFAULT_MONTHS_AHEAD);
  // Past events load only when a member steps back in the calendar.
  const [withPast, setWithPast] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const approved = profile?.status === 'approved';

  const load = useCallback(
    () =>
      fetchEvents(approved, withPast ? MAX_MONTHS_BACK : 0, monthsAhead).then((result) => {
        setEvents(result.events);
        setFailed(result.failed);
        setLoadingMore(false);
      }),
    [approved, withPast, monthsAhead],
  );

  useEffect(() => {
    load();
  }, [load]);

  /** Shows events up to at least `months` ahead, up to the maximum. */
  const showMonthsAhead = useCallback(
    (months: number) => {
      const next = Math.min(MAX_MONTHS_AHEAD, Math.max(months, monthsAhead));
      if (next === monthsAhead) return;
      setLoadingMore(true);
      setMonthsAhead(next);
    },
    [monthsAhead],
  );

  /** Loads the past 12 months too, all at once so each step back is instant. */
  const showPast = useCallback(() => setWithPast(true), []);

  return {
    events,
    failed,
    reload: load,
    /** The last day events are loaded for. */
    loadedUntil: monthsFromToday(monthsAhead),
    monthsAhead,
    canLoadMore: monthsAhead < MAX_MONTHS_AHEAD,
    loadingMore,
    showMonthsAhead,
    showPast,
  };
}

/**
 * One event by id. Usually already loaded by the list it was tapped in; if the
 * screen was opened another way, the calendars are fetched again.
 */
export function useEvent(id: string | undefined) {
  const { profile } = useAuth();
  const [event, setEvent] = useState<CalendarEvent | null | undefined>(() =>
    id ? loadedEvents.get(id) : undefined,
  );

  const approved = profile?.status === 'approved';

  useEffect(() => {
    if (!id || loadedEvents.has(id)) return;
    fetchEvents(approved, MAX_MONTHS_BACK, MAX_MONTHS_AHEAD).then(() =>
      setEvent(loadedEvents.get(id) ?? null),
    );
  }, [id, approved]);

  return event;
}

async function fetchEvents(
  approved: boolean,
  monthsBack: number,
  monthsAhead: number,
): Promise<{ events: CalendarEvent[]; failed: string[] }> {
  if (!approved) return { events: [], failed: [] };
  const { data } = await supabase
    .from('calendars')
    .select(
      'id, name, url, color, team:teams (name, kind), calendar_audiences (kind, role, post, team_id, team:teams (kind))',
    )
    .order('created_at');
  const calendars: CalendarRow[] = (data ?? []).map((row) => {
    // A squad's or team's calendar added before calendars had audiences shows
    // under the squad's or team's name.
    const team = row.team as unknown as { name: string; kind: GroupKind } | null;
    const rows = (row.calendar_audiences ?? []) as unknown as (AudienceRow & {
      team: { kind: GroupKind } | null;
    })[];
    const shownTo = shownToFromRows(rows);
    const teamKinds = rows
      .filter((r) => r.team_id && r.team)
      .map((r) => ({ id: r.team_id as string, kind: r.team!.kind }));
    return {
      id: row.id,
      url: row.url,
      name: team?.name ?? row.name,
      // Calendars not shown to everyone get their own colour and filter, like a squad's.
      clubWide: shownTo.everyone,
      color: calendarColorHex(row.color, colourAudience(shownTo, teamKinds)),
    };
  });

  const rangeStart = monthsBack > 0 ? earliestDay(monthsBack) : startOfToday();
  const rangeEnd = monthsFromToday(monthsAhead);
  const failed: string[] = [];

  const perCalendar = await Promise.all(
    calendars.map(async (calendar) => {
      const text = await fetchIcs(calendar.url);
      if (text) {
        try {
          return parseIcs(text, calendar, rangeStart, rangeEnd);
        } catch {
          // Fall through to report it as failed.
        }
      }
      failed.push(calendar.name);
      return [];
    }),
  );

  const fixtures = await fetchFixtures(rangeStart, rangeEnd);

  const events = dedupe([...perCalendar.flat(), ...fixtures]).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  for (const event of events) loadedEvents.set(event.id, event);
  return { events, failed };
}

/** How long a match is shown for in the calendar. */
const MATCH_MINUTES = 60;

/**
 * Matches imported from PlayHQ for the squads and teams the member can see,
 * shown in that team's calendar.
 */
async function fetchFixtures(rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]> {
  const { data } = await supabase
    .from('fixtures')
    .select(
      'id, team_id, team_name, opponent, round_name, grade_name, starts_at, time_tbc, venue, court, is_home, team:teams (kind)',
    )
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at');
  return (data ?? []).map((f) => {
    const team = f.team as unknown as { kind: GroupKind } | null;
    const start = new Date(f.starts_at);
    return {
      id: `fixture:${f.id}`,
      title: f.opponent ? `${f.team_name} v ${f.opponent}` : `${f.team_name} · Bye`,
      start,
      end: new Date(start.getTime() + MATCH_MINUTES * 60 * 1000),
      allDay: f.time_tbc,
      location: [f.venue, f.court].filter(Boolean).join(', ') || null,
      description:
        [f.round_name, f.grade_name, f.is_home === null ? null : f.is_home ? 'Home' : 'Away']
          .filter(Boolean)
          .join(' · ') || null,
      calendarId: `fixtures:${f.team_id ?? 'none'}`,
      calendarName: f.team_name,
      clubWide: false,
      color: calendarColorHex(null, team?.kind ?? 'team'),
    };
  });
}

async function fetchIcs(url: string): Promise<string | null> {
  const cacheKey = CACHE_PREFIX + url;
  try {
    const response = await fetch(url.replace(/^webcal:\/\//i, 'https://'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Not a calendar file');
    AsyncStorage.setItem(cacheKey, text).catch(() => {});
    return text;
  } catch {
    return AsyncStorage.getItem(cacheKey).catch(() => null);
  }
}

/** The same event can appear in the club calendar and a team calendar. */
function dedupe(events: CalendarEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

/**
 * The first day of the month `months` back, so the earliest month the calendar
 * reaches is shown whole.
 */
export function earliestDay(months = MAX_MONTHS_BACK) {
  const today = startOfToday();
  return new Date(today.getFullYear(), today.getMonth() - months, 1);
}

/** The last day members can load events for. */
export function latestDay() {
  return monthsFromToday(MAX_MONTHS_AHEAD);
}

function monthsFromToday(months: number) {
  const today = startOfToday();
  return new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
