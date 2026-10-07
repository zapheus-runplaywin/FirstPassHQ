import type { CalendarEvent } from '@/lib/calendar';

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function formatDay(date: Date) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dayKey(date) === dayKey(today)) return 'Today';
  if (dayKey(date) === dayKey(tomorrow)) return 'Tomorrow';
  return dayFormat.format(date);
}

/** "Today", "Tomorrow", or a short date such as "Sat 11 Oct". */
export function formatShortDay(date: Date) {
  const label = formatDay(date);
  return label === 'Today' || label === 'Tomorrow' ? label : shortDayFormat.format(date);
}

export function formatEventTime(event: CalendarEvent) {
  if (event.allDay) return 'All day';
  const start = timeFormat.format(event.start);
  if (event.end.getTime() === event.start.getTime()) return start;
  return `${start} – ${timeFormat.format(event.end)}`;
}

/** Groups events (already sorted) into consecutive days. */
export function groupByDay(events: CalendarEvent[]) {
  const groups: { key: string; date: Date; events: CalendarEvent[] }[] = [];
  for (const event of events) {
    const key = dayKey(event.start);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.events.push(event);
    } else {
      groups.push({ key, date: event.start, events: [event] });
    }
  }
  return groups;
}
