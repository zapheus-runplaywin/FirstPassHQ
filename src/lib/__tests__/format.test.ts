import type { CalendarEvent } from '@/lib/calendar';
import {
  addDays,
  dayKey,
  formatDateTime,
  formatDay,
  formatEventTime,
  formatMonth,
  formatSentAt,
  formatShortDay,
  formatWeekday,
  groupByDay,
  isToday,
  monthKey,
  startOfDay,
  startOfWeek,
} from '@/lib/format';

// Sunday 18 October 2026, local time.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

// The app formats with the phone's locale, so expected text is built the same way.
const long = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const short = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function event(start: Date, end: Date, allDay = false): CalendarEvent {
  return {
    id: `e:${start.toISOString()}`,
    title: 'Training',
    start,
    end,
    allDay,
    location: null,
    description: null,
    calendarId: 'c1',
    calendarName: 'Club',
    clubWide: true,
    color: '#123456',
  };
}

describe('dayKey and monthKey', () => {
  it('are the same within a day or month and differ across them', () => {
    expect(dayKey(new Date(2026, 9, 18, 0, 1))).toBe(dayKey(new Date(2026, 9, 18, 23, 59)));
    expect(dayKey(new Date(2026, 9, 18))).not.toBe(dayKey(new Date(2026, 9, 19)));
    expect(monthKey(new Date(2026, 9, 1))).toBe(monthKey(new Date(2026, 9, 31)));
    expect(monthKey(new Date(2026, 9, 31))).not.toBe(monthKey(new Date(2026, 10, 1)));
  });
});

describe('formatDay', () => {
  it('says Today and Tomorrow', () => {
    expect(formatDay(new Date(2026, 9, 18, 7))).toBe('Today');
    expect(formatDay(new Date(2026, 9, 19, 23))).toBe('Tomorrow');
  });

  it('gives a long date otherwise', () => {
    const date = new Date(2026, 9, 17);
    expect(formatDay(date)).toBe(long.format(date));
    expect(formatDay(new Date(2026, 9, 20))).toBe(long.format(new Date(2026, 9, 20)));
  });

  it('knows tomorrow across the end of a month', () => {
    jest.setSystemTime(new Date(2026, 9, 31, 12));
    expect(formatDay(new Date(2026, 10, 1))).toBe('Tomorrow');
  });
});

describe('formatShortDay', () => {
  it('says Today and Tomorrow, or a short date', () => {
    expect(formatShortDay(new Date(2026, 9, 18))).toBe('Today');
    expect(formatShortDay(new Date(2026, 9, 19))).toBe('Tomorrow');
    expect(formatShortDay(new Date(2026, 9, 24))).toBe(short.format(new Date(2026, 9, 24)));
  });
});

describe('formatEventTime', () => {
  it('says All day for all-day events', () => {
    expect(formatEventTime(event(new Date(2026, 9, 18), new Date(2026, 9, 19), true))).toBe('All day');
  });

  it('gives one time when the event has no length', () => {
    const start = new Date(2026, 9, 18, 18);
    expect(formatEventTime(event(start, start))).toBe(time.format(start));
  });

  it('gives a range otherwise', () => {
    const start = new Date(2026, 9, 18, 18);
    const end = new Date(2026, 9, 18, 19, 30);
    expect(formatEventTime(event(start, end))).toBe(`${time.format(start)} – ${time.format(end)}`);
  });
});

describe('groupByDay', () => {
  it('groups consecutive events on the same day', () => {
    const a = event(new Date(2026, 9, 18, 9), new Date(2026, 9, 18, 10));
    const b = event(new Date(2026, 9, 18, 17), new Date(2026, 9, 18, 18));
    const c = event(new Date(2026, 9, 20, 9), new Date(2026, 9, 20, 10));
    const groups = groupByDay([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0].events).toEqual([a, b]);
    expect(groups[0].date).toBe(a.start);
    expect(groups[1].events).toEqual([c]);
    expect(groups[1].key).toBe(dayKey(c.start));
  });

  it('is empty with no events', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('formatMonth and formatWeekday', () => {
  it('use the phone locale', () => {
    const date = new Date(2026, 9, 18);
    expect(formatMonth(date)).toBe(
      new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date),
    );
    expect(formatWeekday(date)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date));
  });
});

describe('isToday', () => {
  it('is true at any time today', () => {
    expect(isToday(new Date(2026, 9, 18, 0, 0))).toBe(true);
    expect(isToday(new Date(2026, 9, 18, 23, 59))).toBe(true);
    expect(isToday(new Date(2026, 9, 17, 23, 59))).toBe(false);
  });
});

describe('startOfDay and addDays', () => {
  it('start at local midnight', () => {
    expect(startOfDay(new Date(2026, 9, 18, 15, 30))).toEqual(new Date(2026, 9, 18));
  });

  it('add days across months and years, at midnight', () => {
    expect(addDays(new Date(2026, 9, 30, 15), 3)).toEqual(new Date(2026, 10, 2));
    expect(addDays(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 1));
    expect(addDays(new Date(2026, 2, 1), -1)).toEqual(new Date(2026, 1, 28));
  });
});

describe('startOfWeek', () => {
  it('goes back to Monday', () => {
    // Sunday 18 October 2026 is in the week of Monday 12 October.
    expect(startOfWeek(new Date(2026, 9, 18, 15))).toEqual(new Date(2026, 9, 12));
    expect(startOfWeek(new Date(2026, 9, 14))).toEqual(new Date(2026, 9, 12));
  });

  it('keeps a Monday', () => {
    expect(startOfWeek(new Date(2026, 9, 12, 9))).toEqual(new Date(2026, 9, 12));
  });
});

describe('formatSentAt', () => {
  it('gives the time today and a short date otherwise', () => {
    const today = new Date(2026, 9, 18, 9, 5);
    expect(formatSentAt(today)).toBe(time.format(today));
    const earlier = new Date(2026, 9, 11, 9, 5);
    expect(formatSentAt(earlier)).toBe(short.format(earlier));
  });
});

describe('formatDateTime', () => {
  it('gives the long date and the time', () => {
    const date = new Date(2026, 9, 11, 15, 5);
    expect(formatDateTime(date)).toBe(`${long.format(date)}, ${time.format(date)}`);
  });
});
