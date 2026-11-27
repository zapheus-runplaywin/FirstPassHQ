import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { calendarColorHex, type CalendarColor } from '@/constants/calendar-colors';
import { useAuth } from '@/lib/auth';
import { parseIcs, type CalendarEvent } from '@/lib/calendar';
import {
  colourAudience,
  isForGroupsOnly,
  shownToFromRows,
  type AudienceRow,
} from '@/lib/calendar-audience';
import { useFeature } from '@/lib/club';
import { groupColourHex, groupColours, reservedColours } from '@/lib/group-colours';
import { supabase } from '@/lib/supabase';
import { toCalendarEvent, type TeamEventRow } from '@/lib/team-events';
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

/**
 * Screens showing events, told to load again when a coach adds, changes,
 * cancels or removes one, so the calendar and Today never show a stale list.
 */
const listeners = new Set<() => void>();

/** Call after changing an event in the app: every open list loads again. */
export function refreshEvents(removedId?: string) {
  if (removedId) loadedEvents.delete(removedId);
  for (const listener of [...listeners]) listener();
}

function useRefresh(listener: () => void) {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

/**
 * Calendar files fetched in the last little while, so loading again after a
 * coach saves an event doesn't download every Outlook calendar a second time.
 * Pulling down to refresh always downloads.
 */
const RECENT_MS = 60 * 1000;
const recentIcs = new Map<string, { at: number; text: string }>();

type CalendarRow = {
  id: string;
  name: string;
  url: string;
  clubWide: boolean;
  color: string;
  /** The squads and teams the calendar is for. */
  teamIds: string[];
  forAthletes: boolean;
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
  const teamEvents = useFeature('teamEvents');

  const load = useCallback(
    (fresh = true) =>
      fetchEvents(approved, withPast ? MAX_MONTHS_BACK : 0, monthsAhead, teamEvents, fresh).then(
        (result) => {
          setEvents(result.events);
          setFailed(result.failed);
          setLoadingMore(false);
        },
      ),
    [approved, withPast, monthsAhead, teamEvents],
  );

  useEffect(() => {
    load();
  }, [load]);

  const loadAfterChange = useCallback(() => {
    load(false);
  }, [load]);
  useRefresh(loadAfterChange);

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
    /** The same without cancelled events, for Today and for picking a session. */
    eventsOn: useMemo(() => events?.filter((e) => !e.cancelled) ?? null, [events]),
    failed,
    reload: () => load(),
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
  const teamEvents = useFeature('teamEvents');

  useEffect(() => {
    if (!id || loadedEvents.has(id)) return;
    fetchEvents(approved, MAX_MONTHS_BACK, MAX_MONTHS_AHEAD, teamEvents).then(() =>
      setEvent(loadedEvents.get(id) ?? null),
    );
  }, [id, approved, teamEvents]);

  // After the event is changed, cancelled or brought back, show it as it is now.
  const reload = useCallback(() => {
    if (!id) return;
    fetchEvents(approved, MAX_MONTHS_BACK, MAX_MONTHS_AHEAD, teamEvents, false).then(() =>
      setEvent(loadedEvents.get(id) ?? null),
    );
  }, [id, approved, teamEvents]);
  useRefresh(reload);

  return event;
}

async function fetchEvents(
  approved: boolean,
  monthsBack: number,
  monthsAhead: number,
  teamEvents = false,
  fresh = true,
): Promise<{ events: CalendarEvent[]; failed: string[] }> {
  if (!approved) return { events: [], failed: [] };
  const [{ data }, groupColour] = await Promise.all([
    supabase
      .from('calendars')
      .select(
        'id, name, url, color, team:teams (id, name, kind), calendar_audiences (kind, role, post, team_id, team:teams (kind))',
      )
      .order('created_at'),
    fetchGroupColours(),
  ]);
  const calendars: CalendarRow[] = (data ?? []).map((row) => {
    // A squad's or team's calendar added before calendars had audiences shows
    // under the squad's or team's name.
    const team = row.team as unknown as { id?: string; name: string; kind: GroupKind } | null;
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
      // The colour an admin picked; with none picked, a squad's or team's own
      // calendar takes that squad's or team's colour.
      color:
        (row.color || !isForGroupsOnly(shownTo)
          ? undefined
          : shownTo.teamIds.map((teamId) => groupColour(teamId)).find(Boolean)) ??
        calendarColorHex(row.color, colourAudience(shownTo, teamKinds)),
      teamIds: [...new Set([...shownTo.teamIds, ...(team?.id ? [team.id] : [])])],
      forAthletes: shownTo.roles.includes('athlete'),
    };
  });

  const rangeStart = monthsBack > 0 ? earliestDay(monthsBack) : startOfToday();
  const rangeEnd = monthsFromToday(monthsAhead);
  const failed: string[] = [];

  const perCalendar = await Promise.all(
    calendars.map(async (calendar) => {
      const text = await fetchIcs(calendar.url, fresh);
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

  const [fixtures, added] = await Promise.all([
    fetchFixtures(rangeStart, rangeEnd, groupColour),
    teamEvents ? fetchTeamEvents(rangeStart, rangeEnd, groupColour) : [],
  ]);

  const events = dedupe([...perCalendar.flat(), ...fixtures, ...added]).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  for (const event of events) loadedEvents.set(event.id, event);
  return { events, failed };
}

type GroupColour = (teamId: string | null | undefined) => string | undefined;

/**
 * The colour of each of this season's squads and teams: the ones no calendar
 * uses, shared out in squad and team order (src/lib/group-colours.ts).
 */
async function fetchGroupColours(): Promise<GroupColour> {
  const [teams, reserved] = await Promise.all([
    supabase
      .from('teams')
      .select('id, kind')
      .eq('archived', false)
      .order('season', { ascending: false })
      .order('sort_order')
      .order('name'),
    supabase.rpc('reserved_calendar_colours'),
  ]);
  const colours: Map<string, CalendarColor> = groupColours(
    (teams.data as { id: string; kind: GroupKind }[] | null) ?? [],
    reservedColours(reserved.data),
  );
  return (teamId) => groupColourHex(colours, teamId);
}

/** How many events the database hands over at a time. */
const PAGE = 1000;

/**
 * Events the squads' and teams' coaches and managers added in the app, as far
 * as this member may see them. The database decides which rows come back.
 */
async function fetchTeamEvents(
  rangeStart: Date,
  rangeEnd: Date,
  groupColour: GroupColour,
): Promise<CalendarEvent[]> {
  const rows: TeamEventRow[] = [];
  // An admin of a busy club looking 12 months each way can pass one page.
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .rpc('team_events_between', { p_from: rangeStart.toISOString(), p_to: rangeEnd.toISOString() })
      .range(from, from + PAGE - 1);
    const page = (data as TeamEventRow[] | null) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map((row) =>
    toCalendarEvent(row, groupColour(row.team_id) ?? calendarColorHex(null, row.team_kind)),
  );
}

/** How long a match is shown for in the calendar. */
const MATCH_MINUTES = 60;

/**
 * Matches imported from PlayHQ for the squads and teams the member can see,
 * shown in that team's calendar.
 */
async function fetchFixtures(
  rangeStart: Date,
  rangeEnd: Date,
  groupColour: GroupColour,
): Promise<CalendarEvent[]> {
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
      color: groupColour(f.team_id) ?? calendarColorHex(null, team?.kind ?? 'team'),
      teamIds: f.team_id ? [f.team_id] : [],
    };
  });
}

async function fetchIcs(url: string, fresh = true): Promise<string | null> {
  const cacheKey = CACHE_PREFIX + url;
  const recent = recentIcs.get(url);
  if (!fresh && recent && Date.now() - recent.at < RECENT_MS) return recent.text;
  try {
    const response = await fetch(url.replace(/^webcal:\/\//i, 'https://'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Not a calendar file');
    AsyncStorage.setItem(cacheKey, text).catch(() => {});
    recentIcs.set(url, { at: Date.now(), text });
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
