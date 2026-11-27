/**
 * Moving a linked calendar into the app (Club tab > Calendars). The admin's
 * app reads the link one last time, and the events it finds, 12 months each
 * side of today (what the calendar reaches), are handed to the database,
 * which copies them in and puts the link aside
 * (public.admin_move_calendar_into_hq). From then on the calendar is changed
 * in the app only.
 */
import { parseIcs, type CalendarEvent } from '@/lib/calendar';

/** One event as `public.admin_move_calendar_into_hq` takes it. */
export type ImportEvent = {
  title: string;
  all_day: boolean;
  /** A timed event's moments. */
  starts_at?: string;
  ends_at?: string;
  /** An all-day event's club days, the last day included: "2026-12-01". */
  day?: string;
  end_day?: string;
  location: string | null;
  note: string | null;
};

/** The most events one calendar can bring in, as the database allows. */
export const MAX_IMPORT_EVENTS = 5000;

function dayString(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The events of a calendar file as the database takes them. */
export function importEvents(events: CalendarEvent[]): ImportEvent[] {
  return events.map((event) => {
    const base = { title: event.title, location: event.location, note: event.description };
    if (!event.allDay) {
      return {
        ...base,
        all_day: false,
        starts_at: event.start.toISOString(),
        ends_at: event.end.toISOString(),
      };
    }
    // A calendar file ends an all-day event on the day after its last day.
    const last = new Date(event.end.getTime() - 1);
    return {
      ...base,
      all_day: true,
      day: dayString(event.start),
      end_day: dayString(last < event.start ? event.start : last),
    };
  });
}

export type ImportReading = { error: string } | { events: ImportEvent[]; first: Date | null; last: Date | null };

/**
 * Reads a calendar link for moving in: its events between `from` and `to`,
 * or why it couldn't be read.
 */
export async function readCalendarForImport(url: string, from: Date, to: Date): Promise<ImportReading> {
  let text: string;
  try {
    const response = await fetch(url.replace(/^webcal:\/\//i, 'https://'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch {
    return { error: 'The link couldn’t be read just now. Check your connection and try again.' };
  }
  let events: CalendarEvent[];
  try {
    events = parseIcs(text, { id: 'import', name: '', clubWide: false, color: '' }, from, to);
  } catch {
    return { error: 'The link didn’t give a calendar the app can read. Check it still works in Outlook.' };
  }
  if (events.length > MAX_IMPORT_EVENTS) {
    return {
      error: `That calendar has ${events.length.toLocaleString()} events in the two years the app shows, and the most it can bring in is ${MAX_IMPORT_EVENTS.toLocaleString()}. Tidy it in Outlook first.`,
    };
  }
  return {
    events: importEvents(events),
    first: events[0]?.start ?? null,
    last: events.length > 0 ? events[events.length - 1].start : null,
  };
}
