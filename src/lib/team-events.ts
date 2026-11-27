/**
 * Squad and team events added in the app by the squad's or team's coaches
 * and managers (and by admins for any squad or team). They sit in the same
 * calendar as the club's Microsoft 365 calendars and PlayHQ fixtures.
 *
 * The database decides who may add, change and see an event
 * (supabase/migrations/20261127800000_team_events.sql). This file shapes
 * what the form sends and what the calendar shows.
 */
import type { CalendarEvent, TeamEventDetails } from '@/lib/calendar';
import { formatTime, parseTime } from '@/lib/clock';
import type { GroupKind, Team } from '@/lib/types';

export const eventKinds = ['training', 'game', 'meeting', 'social', 'other'] as const;
export type EventKind = (typeof eventKinds)[number];

export const eventKindLabels: Record<EventKind, string> = {
  training: 'Training',
  game: 'Game',
  meeting: 'Meeting',
  social: 'Social',
  other: 'Other',
};

/** The name an event starts with, so a training needs no typing. "Other" has none. */
export const eventKindTitles: Record<EventKind, string> = {
  training: 'Training',
  game: 'Game',
  meeting: 'Team meeting',
  social: 'Social event',
  other: '',
};

export function isEventKind(value: string | null | undefined): value is EventKind {
  return !!value && (eventKinds as readonly string[]).includes(value);
}

/** A row of `public.team_events_between`. */
export type TeamEventRow = {
  id: string;
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  day: string;
  end_day: string;
  start_time: string;
  end_time: string;
  location: string | null;
  note: string | null;
  staff_only: boolean;
  series_id: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  created_by_name: string | null;
  can_manage: boolean;
};

/** A row of `public.hq_events_between`: an event on a calendar kept in the app. */
export type HqEventRow = {
  id: string;
  calendar_id: string;
  calendar_name: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  day: string;
  end_day: string;
  start_time: string;
  end_time: string;
  location: string | null;
  note: string | null;
  series_id: string | null;
  status: 'on' | 'suggested' | 'declined';
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  created_by_name: string | null;
  decided_by_name: string | null;
  decline_reason: string | null;
  mine: boolean;
  can_manage: boolean;
};

/** How a calendar kept in the app shows: what its events take from it. */
export type HqCalendarLook = {
  color: string;
  clubWide: boolean;
  teamIds: string[];
  forAthletes: boolean;
};

/** A "2026-12-01" style day as the start of that day on this device. */
function parseDateString(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateString(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const ID_PREFIX = 'team-event:';

/** The calendar's id for an event added in the app. */
export function teamEventId(rowId: string) {
  return ID_PREFIX + rowId;
}

const HQ_ID_PREFIX = 'hq-event:';

/** The calendar's id for an event on a calendar kept in the app. */
export function hqEventId(rowId: string) {
  return HQ_ID_PREFIX + rowId;
}

/** One row of a calendar kept in the app as the calendar shows it, in that calendar's colour. */
export function hqToCalendarEvent(row: HqEventRow, look: HqCalendarLook): CalendarEvent {
  const start = row.all_day ? parseDateString(row.day) : new Date(row.starts_at);
  const end = row.all_day ? addDays(row.end_day, 1) : new Date(row.ends_at);
  return {
    id: hqEventId(row.id),
    title: row.title,
    start,
    end,
    allDay: row.all_day,
    location: row.location,
    description: row.note,
    calendarId: row.calendar_id,
    calendarName: row.calendar_name,
    clubWide: look.clubWide,
    color: look.color,
    teamIds: look.teamIds,
    forAthletes: look.forAthletes,
    cancelled: row.cancelled_at !== null,
    ...(row.status === 'on' ? null : { pending: row.status }),
    teamEvent: {
      id: row.id,
      teamId: null,
      hqCalendarId: row.calendar_id,
      kind: row.kind,
      day: row.day,
      endDay: row.end_day,
      startTime: row.start_time,
      endTime: row.end_time,
      staffOnly: false,
      seriesId: row.series_id,
      cancelledByName: row.cancelled_by_name,
      createdByName: row.created_by_name,
      canManage: row.can_manage,
      mine: row.mine,
      decidedByName: row.decided_by_name,
      declineReason: row.decline_reason,
    },
  };
}

/** A calendar kept in the app that the member may add to (admins) or suggest for. */
export type HqCalendarChoice = {
  id: string;
  name: string;
  color: string | null;
  everyone: boolean;
  /** True when what they add is a suggestion an admin answers. */
  suggest: boolean;
};

/**
 * Suggestions waiting for an admin, soonest first, a weekly one once (its
 * first week still to come) with how many weeks wait. For the admin's list
 * and to-do. Ones whose day has passed are left out: there is nothing to add.
 */
export function waitingSuggestions(events: CalendarEvent[], now = new Date()) {
  const groups = new Map<string, { event: CalendarEvent; weeks: number }>();
  for (const event of events) {
    if (event.pending !== 'suggested' || !event.teamEvent || event.end <= now) continue;
    const key = event.teamEvent.seriesId ?? event.id;
    const group = groups.get(key);
    if (!group) groups.set(key, { event, weeks: 1 });
    else {
      group.weeks += 1;
      if (event.start < group.event.start) group.event = event;
    }
  }
  return [...groups.values()].sort((a, b) => a.event.start.getTime() - b.event.start.getTime());
}

/** The member's own suggestions an admin declined, soonest first, a weekly one once. */
export function declinedSuggestions(events: CalendarEvent[], now = new Date()) {
  const seen = new Set<string>();
  return events
    .filter((e) => e.pending === 'declined' && e.teamEvent?.mine && e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .filter((e) => {
      const key = e.teamEvent!.seriesId ?? e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** One row as the calendar shows it, in its squad's or team's colour. */
export function toCalendarEvent(row: TeamEventRow, color: string): CalendarEvent {
  // An all-day event is whole days on the club's calendar, whatever zone the
  // phone is in, so it is built from the days rather than the moments.
  const start = row.all_day ? parseDateString(row.day) : new Date(row.starts_at);
  const end = row.all_day ? addDays(row.end_day, 1) : new Date(row.ends_at);
  const details: TeamEventDetails = {
    id: row.id,
    teamId: row.team_id,
    kind: row.kind,
    day: row.day,
    endDay: row.end_day,
    startTime: row.start_time,
    endTime: row.end_time,
    staffOnly: row.staff_only,
    seriesId: row.series_id,
    cancelledByName: row.cancelled_by_name,
    createdByName: row.created_by_name,
    canManage: row.can_manage,
  };
  return {
    id: teamEventId(row.id),
    title: row.title,
    start,
    end,
    allDay: row.all_day,
    location: row.location,
    description: row.note,
    calendarId: `team:${row.team_id}`,
    calendarName: row.team_name,
    clubWide: false,
    color,
    teamIds: [row.team_id],
    cancelled: row.cancelled_at !== null,
    teamEvent: details,
  };
}

function addDays(day: string, days: number) {
  const date = parseDateString(day);
  date.setDate(date.getDate() + days);
  return date;
}

/** A day `days` on from a "2026-12-01" style day. */
export function shiftDay(day: string, days: number) {
  return toDateString(addDays(day, days));
}

/**
 * The squads and teams a member can add events for: the ones they coach or
 * manage, or every current one for admins.
 */
export function eventGroups(
  teams: Team[],
  memberships: { team: { id: string }; team_role: string }[],
  isAdmin: boolean,
): Team[] {
  if (isAdmin) return teams;
  const led = new Set(
    memberships
      .filter((m) => m.team_role === 'coach' || m.team_role === 'manager')
      .map((m) => m.team.id),
  );
  return teams.filter((t) => led.has(t.id));
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export type EventForm = {
  teamId: string | null;
  /** The calendar kept in the app it goes on, instead of a squad or team. */
  calendarId?: string | null;
  kind: EventKind;
  title: string;
  /** "2026-12-01" */
  day: string;
  allDay: boolean;
  /** The last day of an all-day event, or null for one day. */
  endDay: string | null;
  /** As typed: "6pm", "18:00". */
  startText: string;
  endText: string;
  location: string;
  note: string;
  staffOnly: boolean;
  /** How many weeks it runs for, or 0 for a one-off. A new event only. */
  repeatWeeks: number;
};

/** The most weeks a weekly event can run for, as the database allows. */
export const MAX_REPEAT_WEEKS = 52;
/** The longest an all-day event can run, in days. */
export const MAX_EVENT_DAYS = 14;

/** The time `minutes` after a "18:00" style time, or null if that passes midnight. */
export function timeAfter(time: string, minutes: number): string | null {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The last day of a weekly event that runs for `weeks` weeks from `day`. */
export function repeatUntil(day: string, weeks: number) {
  return shiftDay(day, (weeks - 1) * 7);
}

/**
 * What `public.save_team_event` takes (or `public.save_hq_event`, for a
 * calendar kept in the app), or what to fix first. `id` is the event being
 * changed, or null for a new one.
 */
export function saveEventArgs(
  form: EventForm,
  id: string | null,
): { error: string } | { rpc: 'save_team_event' | 'save_hq_event'; args: Record<string, unknown> } {
  const title = form.title.trim();
  if (!id && !form.teamId && !form.calendarId) return { error: 'Choose what it’s for.' };
  if (!title) return { error: 'Give the event a name.' };
  let start: string | null = null;
  let end: string | null = null;
  let endDay: string | null = null;
  if (form.allDay) {
    endDay = form.endDay && form.endDay !== form.day ? form.endDay : null;
    if (endDay && endDay < form.day) return { error: 'The last day must be on or after the first.' };
    if (endDay && endDay > shiftDay(form.day, MAX_EVENT_DAYS - 1)) {
      return { error: `An event can run for up to ${MAX_EVENT_DAYS} days.` };
    }
  } else {
    if (!form.startText.trim()) return { error: 'Give a start time, or make it all day.' };
    start = parseTime(form.startText);
    end = form.endText.trim() ? parseTime(form.endText) : null;
    if (!start || (form.endText.trim() && !end)) return { error: 'Write times like 6:00 pm or 18:00.' };
    if (end && end <= start) return { error: 'The finish time must be after the start.' };
  }
  const repeat = !id && form.repeatWeeks > 1 ? repeatUntil(form.day, form.repeatWeeks) : null;
  if (form.calendarId) {
    return {
      rpc: 'save_hq_event',
      args: {
        p_id: id,
        p_calendar_id: form.calendarId,
        p_kind: form.kind,
        p_title: title,
        p_day: form.day,
        p_end_day: endDay,
        p_all_day: form.allDay,
        p_start: start,
        p_end: end,
        p_location: form.location.trim() || null,
        p_note: form.note.trim() || null,
        p_repeat_until: repeat,
      },
    };
  }
  return {
    rpc: 'save_team_event',
    args: {
      p_id: id,
      p_team_id: form.teamId,
      p_kind: form.kind,
      p_title: title,
      p_day: form.day,
      p_end_day: endDay,
      p_all_day: form.allDay,
      p_start: start,
      p_end: end,
      p_location: form.location.trim() || null,
      p_note: form.note.trim() || null,
      p_staff_only: form.staffOnly,
      p_repeat_until: repeat,
    },
  };
}

/**
 * The squad's or team's last event of a kind, to start a new one from: the
 * same times and place as last time. Cancelled ones don't count.
 */
export function lastEventLike(
  events: CalendarEvent[],
  teamId: string | null,
  kind: EventKind,
  calendarId: string | null = null,
): CalendarEvent | null {
  const like = events.filter(
    (e) =>
      e.teamEvent &&
      !e.cancelled &&
      !e.pending &&
      e.teamEvent.kind === kind &&
      (calendarId ? e.teamEvent.hqCalendarId === calendarId : !!teamId && e.teamEvent.teamId === teamId),
  );
  if (like.length === 0) return null;
  return like.reduce((latest, e) => (e.start > latest.start ? e : latest));
}

/**
 * A new event's form after picking its squad or team and kind: the kind's
 * usual name, and the times and place of the squad's or team's last event of
 * that kind, which is right for most weekly trainings. Anything the member
 * has already typed themselves (`typed`) is left alone. `filledFrom` says
 * whether times or a place were filled in, for the note under the form.
 */
export function startedFrom(
  form: EventForm,
  events: CalendarEvent[],
  teamId: string | null,
  kind: EventKind,
  typed: { title: boolean; times: boolean; place: boolean },
  calendarId: string | null = null,
): { form: EventForm; filledFrom: EventKind | null } {
  const next = { ...form, teamId: calendarId ? null : teamId, calendarId, kind };
  // On a club calendar a meeting isn't a team's.
  if (!typed.title) next.title = calendarId && kind === 'meeting' ? 'Meeting' : eventKindTitles[kind];
  const last = teamId || calendarId ? lastEventLike(events, teamId, kind, calendarId) : null;
  if (!last?.teamEvent) return { form: next, filledFrom: null };
  let filled = false;
  if (!typed.times && !last.allDay) {
    next.allDay = false;
    next.endDay = null;
    next.startText = formatTime(last.teamEvent.startTime);
    next.endText = formatTime(last.teamEvent.endTime);
    filled = true;
  }
  if (!typed.place && last.location) {
    next.location = last.location;
    filled = true;
  }
  if (!typed.title) next.title = last.title;
  return { form: next, filledFrom: filled ? kind : null };
}

/**
 * Places to offer under "Where": the ones this squad or team has used most,
 * then the club's. Up to `limit`, each once.
 */
export function placeSuggestions(
  events: CalendarEvent[],
  teamId: string | null,
  limit = 3,
  calendarId: string | null = null,
): string[] {
  const count = (list: CalendarEvent[]) => {
    const counts = new Map<string, number>();
    for (const event of list) {
      const place = event.location?.trim();
      if (place) counts.set(place, (counts.get(place) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([place]) => place);
  };
  const own = calendarId
    ? count(events.filter((e) => e.calendarId === calendarId))
    : teamId
      ? count(events.filter((e) => e.teamIds?.includes(teamId)))
      : [];
  const rest = count(events).filter((place) => !own.includes(place));
  return [...own, ...rest].slice(0, limit);
}

/** The database's reason a change was refused, as a sentence, or a plain fallback. */
export function manageErrorMessage(message: string | undefined) {
  return message?.trim() ? `${message.trim().replace(/\.$/, '')}.` : 'That didn’t save. Try again.';
}
