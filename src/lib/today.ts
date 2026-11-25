/**
 * Today (src/app/(tabs)/index.tsx): what's next on the calendar and what
 * comes after it this week, from the events the calendar already loads.
 */
import type { CalendarEvent } from '@/lib/calendar';
import type { PersonalTask } from '@/lib/personal-tasks';
import { dueAlert, sortByAlert, type Todo } from '@/lib/todos';

/** How many events Today lists under the next one. */
export const LATER_COUNT = 4;
/** "Later this week" looks this many days ahead. */
export const LATER_DAYS = 7;
/** With nothing in the week, Today still shows this many under "Coming up". */
export const COMING_UP_COUNT = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Upcoming = {
  /** The next event that hasn't finished, or null with nothing ahead. */
  next: CalendarEvent | null;
  /** The few after it. */
  later: CalendarEvent[];
  /** "Later this week" when they are all within the week, otherwise "Coming up". */
  laterTitle: 'Later this week' | 'Coming up';
};

/**
 * Splits events (sorted by start) into the next one and the few after it.
 * An event that has started but not finished is still the next one; an
 * all-day event lasts until its day is over.
 */
export function upcoming(events: CalendarEvent[], now: Date): Upcoming {
  const ahead = events.filter((event) => !isOver(event, now));
  const [next = null, ...rest] = ahead;
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + LATER_DAYS + 1);
  const thisWeek = rest.filter((event) => event.start < weekEnd).slice(0, LATER_COUNT);
  return thisWeek.length > 0
    ? { next, later: thisWeek, laterTitle: 'Later this week' }
    : { next, later: rest.slice(0, COMING_UP_COUNT), laterTitle: 'Coming up' };
}

function isOver(event: CalendarEvent, now: Date) {
  if (event.allDay) {
    // Whole days: over once the last day it covers has ended.
    const lastDay = event.end > event.start ? new Date(event.end.getTime() - 1) : event.start;
    const endOfDay = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
    return endOfDay <= now;
  }
  return event.end > event.start ? event.end <= now : event.start < now;
}

/** From this hour, something on today is "tonight". */
const EVENING_HOUR = 17;

/**
 * When the next event is, in a word or two: "Now", "Today", "Tonight",
 * "Tomorrow", or its day and date after that.
 */
export function whenLabel(event: CalendarEvent, now: Date): string {
  if (!event.allDay && event.start <= now) return 'Now';
  const days = Math.round((startOfDay(event.start).getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (days <= 0) {
    return !event.allDay && event.start.getHours() >= EVENING_HOUR ? 'Tonight' : 'Today';
  }
  return days === 1 ? 'Tomorrow' : shortDate(event.start);
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The time an event starts, large on the Next up card: "6:00 pm" or "All day". */
export function startTime(event: CalendarEvent) {
  return event.allDay ? 'All day' : timeFormat.format(event.start);
}

/** Such as "Wed 25 Nov". */
function shortDate(date: Date) {
  return dateFormat.format(date).replace(',', '');
}

/** Today's date at the top of Today, such as "Wed 25 Nov". */
export function todayLabel(now: Date) {
  return shortDate(now);
}

/** When a later event is, on one short line: "Tomorrow · 5:00 pm" or "Sat 28 Nov · All day". */
export function laterLabel(event: CalendarEvent, now: Date) {
  return `${whenLabel(event, now)} · ${startTime(event)}`;
}

// ---------------------------------------------------------------------------
// Needs you

export type NeedsYouEntry =
  | { kind: 'todo'; todo: Todo }
  | { kind: 'task'; task: PersonalTask };

/** A list longer than this is split into what's pressing and the rest. */
export const GROUP_FROM = 6;

export type NeedsYouGroup = { title: string | null; entries: NeedsYouEntry[] };

/**
 * The member's jobs and their own tasks in one list: urgent first, then
 * overdue, then due soon, then the rest. A long list is split into "Now"
 * (anything with a warning) and "When you can".
 */
export function needsYouGroups(
  todos: Todo[],
  personalTasks: PersonalTask[],
  today = new Date(),
): NeedsYouGroup[] {
  const alertOf = (entry: NeedsYouEntry) =>
    entry.kind === 'todo' ? entry.todo.alert : dueAlert(entry.task.due_on, today);
  const entries = sortByAlert<NeedsYouEntry>(
    [
      ...todos.map((todo) => ({ kind: 'todo' as const, todo })),
      ...personalTasks.map((task) => ({ kind: 'task' as const, task })),
    ],
    alertOf,
    (entry) => (entry.kind === 'todo' ? entry.todo.dueOn : entry.task.due_on),
  );
  const now = entries.filter((entry) => !!alertOf(entry));
  const rest = entries.filter((entry) => !alertOf(entry));
  if (entries.length < GROUP_FROM || now.length === 0 || rest.length === 0) {
    return [{ title: null, entries }];
  }
  return [
    { title: 'Now', entries: now },
    { title: 'When you can', entries: rest },
  ];
}

// ---------------------------------------------------------------------------
// Safeguarding

/** The concerns register and the screens under it (src/app/concerns). */
const CONCERNS = '/concerns';

/**
 * A to-do about safeguarding: a new concern, one past the club's times or
 * escalated, a request to read messages, a block in a chat group, athletes
 * flagged again and again, a child's training load. They are the to-dos that
 * open the concerns register or a screen under it.
 */
export function isSafeguardingTodo(todo: Pick<Todo, 'href'>) {
  const path = typeof todo.href === 'string' ? todo.href : todo.href.pathname;
  return path === CONCERNS || path.startsWith(`${CONCERNS}/`) || path.startsWith(`${CONCERNS}?`);
}

/**
 * Today's to-dos in two: safeguarding work, which leads the day in its own
 * panel (most pressing first), and everything else, which stays under "Needs
 * you" in the order it came. Every to-do is in exactly one of the two.
 */
export function splitSafeguarding(todos: Todo[]): { safeguarding: Todo[]; rest: Todo[] } {
  return {
    safeguarding: sortByAlert(
      todos.filter(isSafeguardingTodo),
      (todo) => todo.alert,
      (todo) => todo.dueOn,
    ),
    rest: todos.filter((todo) => !isSafeguardingTodo(todo)),
  };
}
