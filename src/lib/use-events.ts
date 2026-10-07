import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { parseIcs, type CalendarEvent } from '@/lib/calendar';
import { supabase } from '@/lib/supabase';

/** How far ahead the app shows events. */
const DAYS_AHEAD = 90;
const CACHE_PREFIX = 'ics-cache:';

/** The most recently loaded events, so the details screen opens instantly. */
const loadedEvents = new Map<string, CalendarEvent>();

type CalendarRow = {
  id: string;
  name: string;
  url: string;
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

  const approved = profile?.status === 'approved';

  const load = useCallback(
    () =>
      fetchEvents(approved).then((result) => {
        setEvents(result.events);
        setFailed(result.failed);
      }),
    [approved],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { events, failed, reload: load };
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
    fetchEvents(approved).then(() => setEvent(loadedEvents.get(id) ?? null));
  }, [id, approved]);

  return event;
}

async function fetchEvents(
  approved: boolean,
): Promise<{ events: CalendarEvent[]; failed: string[] }> {
  if (!approved) return { events: [], failed: [] };
  const { data } = await supabase
    .from('calendars')
    .select('id, name, url, team:teams (name)')
    .order('created_at');
  const calendars: CalendarRow[] = (data ?? []).map((row) => {
    const team = row.team as unknown as { name: string } | null;
    return { id: row.id, url: row.url, name: team?.name ?? row.name };
  });

  const rangeStart = startOfToday();
  const rangeEnd = new Date(rangeStart.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
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
  loadedEvents.clear();
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

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
