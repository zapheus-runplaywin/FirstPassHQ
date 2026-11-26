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
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
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

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

/** "October 2026". */
export function formatMonth(date: Date) {
  return monthFormat.format(date);
}

/** "Sat". */
export function formatWeekday(date: Date) {
  return weekdayFormat.format(date);
}

export function isToday(date: Date) {
  return dayKey(date) === dayKey(new Date());
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The Monday on or before a date. Weeks start on Monday in Australia. */
export function startOfWeek(date: Date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

/** When a message was sent: a time today, otherwise a short date such as "Sat 11 Oct". */
export function formatSentAt(date: Date) {
  return isToday(date) ? timeFormat.format(date) : shortDayFormat.format(date);
}

/** The day something was sent: "Today", "Yesterday", or a short date such as "Sat 11 Oct". */
export function formatPastDay(date: Date, now = new Date()) {
  if (dayKey(date) === dayKey(now)) return 'Today';
  if (dayKey(date) === dayKey(addDays(now, -1))) return 'Yesterday';
  return shortDayFormat.format(date);
}

/** A full date and time, such as "Saturday 11 October, 3:05 pm". */
export function formatDateTime(date: Date) {
  return `${dayFormat.format(date)}, ${timeFormat.format(date)}`;
}
