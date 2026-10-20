import ICAL from 'ical.js';

export type CalendarEvent = {
  /** Unique per occurrence: the event UID plus its start time. */
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  calendarId: string;
  calendarName: string;
  /** True for the club-wide calendar, false for a squad or team calendar. */
  clubWide: boolean;
  /** The calendar's colour, as a hex string. */
  color: string;
};

/** Stops a runaway rule (e.g. an endless daily event) from freezing the app. */
const MAX_OCCURRENCES_PER_EVENT = 500;
/**
 * Occurrences before the range don't count towards that limit, so a weekly
 * training that started years ago still shows; this caps the stepping instead.
 */
const MAX_STEPS_PER_EVENT = 20000;

/**
 * Parses an ICS file and returns the events that overlap [rangeStart, rangeEnd),
 * with recurring events expanded into individual occurrences.
 */
export function parseIcs(
  icsText: string,
  calendar: { id: string; name: string; clubWide: boolean; color: string },
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(icsText));

  // Outlook uses Windows zone names (e.g. "AUS Eastern Standard Time") and
  // defines them in the file, so register them before reading any times.
  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(vtimezone);
  }

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) {
      exceptions.push(event);
    } else {
      masters.set(event.uid, event);
    }
  }
  const orphanExceptions: ICAL.Event[] = [];
  for (const exception of exceptions) {
    const master = masters.get(exception.uid);
    if (master) {
      master.relateException(exception);
    } else {
      orphanExceptions.push(exception);
    }
  }

  const results: CalendarEvent[] = [];
  /** Adds the event when it falls in the range, and says whether it did. */
  const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (isCancelled(item)) return false;
    const startDate = start.toJSDate();
    // Events without an end last a day (all-day) or no time at all.
    const endDate = end ? end.toJSDate() : startDate;
    if (endDate <= rangeStart && startDate < rangeStart) return false;
    if (startDate >= rangeEnd) return false;
    results.push({
      id: `${item.uid}:${startDate.toISOString()}`,
      title: item.summary || 'Untitled event',
      start: startDate,
      end: endDate,
      allDay: start.isDate,
      location: item.location || null,
      description: item.description || null,
      calendarId: calendar.id,
      calendarName: calendar.name,
      clubWide: calendar.clubWide,
      color: calendar.color,
    });
    return true;
  };

  for (const event of [...masters.values(), ...orphanExceptions]) {
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    let count = 0;
    let steps = 0;
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (next.toJSDate() >= rangeEnd || ++steps > MAX_STEPS_PER_EVENT) break;
      const details = event.getOccurrenceDetails(next);
      if (add(details.item, details.startDate, details.endDate) && ++count >= MAX_OCCURRENCES_PER_EVENT) {
        break;
      }
    }
  }

  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function isCancelled(event: ICAL.Event) {
  return event.component.getFirstPropertyValue('status')?.toString().toUpperCase() === 'CANCELLED';
}
