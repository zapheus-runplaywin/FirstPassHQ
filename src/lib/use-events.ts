import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { calendarColorHex } from '@/constants/calendar-colors';
import { useAuth } from '@/lib/auth';
import { parseIcs, type CalendarEvent } from '@/lib/calendar';
import { supabase } from '@/lib/supabase';
import type { GroupKind } from '@/lib/types';

/** How many months ahead the app shows events at first. */
export const DEFAULT_MONTHS_AHEAD = 3;
/** How far ahead members can load events. */
export const MAX_MONTHS_AHEAD = 12;
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
 * Events from every calendar this member can see: the club calendar plus
 * calendars attached to their teams. The database decides which rows they get.
 * Each ICS file is cached so the last copy still shows when offline.
 */
export function useEvents() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [monthsAhead, setMonthsAhead] = useState(DEFAULT_MONTHS_AHEAD);
  const [loadingMore, setLoadingMore] = useState(false);

  const approved = profile?.status === 'approved';

  const load = useCallback(
    () =>
      fetchEvents(approved, monthsAhead).then((result) => {
        setEvents(result.events);
        setFailed(result.failed);
        setLoadingMore(false);
      }),
    [approved, monthsAhead],
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
    fetchEvents(approved, MAX_MONTHS_AHEAD).then(() => setEvent(loadedEvents.get(id) ?? null));
  }, [id, approved]);

  return event;
}

async function fetchEvents(
  approved: boolean,
  monthsAhead: number,
): Promise<{ events: CalendarEvent[]; failed: string[] }> {
  if (!approved) return { events: [], failed: [] };
  const { data } = await supabase
    .from('calendars')
    .select('id, name, url, committee_only, color, team:teams (name, kind)')
    .order('created_at');
  const calendars: CalendarRow[] = (data ?? []).map((row) => {
    const team = row.team as unknown as { name: string; kind: GroupKind } | null;
    return {
      id: row.id,
      url: row.url,
      name: team?.name ?? row.name,
      // Committee calendars get their own colour and filter, like a squad's.
      clubWide: !team && !row.committee_only,
      color: calendarColorHex(
        row.color,
        team ? team.kind : row.committee_only ? 'committee' : 'club',
      ),
    };
  });

  const rangeStart = startOfToday();
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

  const events = dedupe(perCalendar.flat()).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const event of events) loadedEvents.set(event.id, event);
  return { events, failed };
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

function monthsFromToday(months: number) {
  const today = startOfToday();
  return new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
