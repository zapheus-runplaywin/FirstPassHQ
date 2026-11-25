/**
 * Today's sums (src/lib/today.ts): which event is next and which come after
 * it, the word for when it is, and the list of what needs the member. Times
 * are local, so every date here is built from local parts and the tests read
 * the same in any time zone.
 */
import * as fc from 'fast-check';

import type { CalendarEvent } from '@/lib/calendar';
import type { PersonalTask } from '@/lib/personal-tasks';
import {
  COMING_UP_COUNT,
  GROUP_FROM,
  LATER_COUNT,
  LATER_DAYS,
  laterLabel,
  needsYouGroups,
  startTime,
  todayLabel,
  upcoming,
  whenLabel,
} from '@/lib/today';
import { URGENT, type Todo } from '@/lib/todos';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));

fc.configureGlobal({ seed: 20261125, numRuns: 1000 });

/** Sunday 18 October 2026, 10:00 in the morning, local time. */
const NOW = new Date(2026, 9, 18, 10, 0);

/** A local time `days` after today. */
const at = (days: number, hour = 0, minute = 0) => new Date(2026, 9, 18 + days, hour, minute);

let n = 0;
function event(start: Date, minutes = 90, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  n += 1;
  return {
    id: `e${n}`,
    title: `Event ${n}`,
    start,
    end: new Date(start.getTime() + minutes * 60 * 1000),
    allDay: false,
    location: null,
    description: null,
    calendarId: 'c1',
    calendarName: 'Club',
    clubWide: true,
    color: '#000000',
    ...extra,
  };
}

/** An all-day event covering `days` whole days from the start of a day. */
const allDay = (start: Date, days = 1) =>
  event(start, days * 24 * 60, { allDay: true });

describe('upcoming', () => {
  it('takes the first event that hasn’t finished as the next one', () => {
    const over = event(at(0, 7));
    const tonight = event(at(0, 18));
    const tomorrow = event(at(1, 9));
    const { next, later, laterTitle } = upcoming([over, tonight, tomorrow], NOW);
    expect(next).toBe(tonight);
    expect(later).toEqual([tomorrow]);
    expect(laterTitle).toBe('Later this week');
  });

  it('keeps an event that has started but not finished as the next one', () => {
    const underway = event(at(0, 9, 30));
    const { next } = upcoming([underway, event(at(0, 18))], NOW);
    expect(next).toBe(underway);
  });

  it('moves on the moment an event ends', () => {
    const session = event(at(0, 8), 120);
    expect(upcoming([session], NOW).next).toBeNull();
    expect(upcoming([session], at(0, 9, 59)).next).toBe(session);
  });

  it('an event with no length is over once it has started', () => {
    const instant = event(at(0, 10), 0);
    expect(upcoming([instant], at(0, 10)).next).toBe(instant);
    expect(upcoming([instant], at(0, 10, 1)).next).toBeNull();
  });

  it('an all-day event lasts until its day is over', () => {
    const carnival = allDay(at(0));
    expect(upcoming([carnival], at(0, 23, 59)).next).toBe(carnival);
    expect(upcoming([carnival], at(1)).next).toBeNull();
  });

  it('an all-day event over several days lasts until the last one is over', () => {
    const camp = allDay(at(-1), 3);
    expect(upcoming([camp], at(1, 20)).next).toBe(camp);
    expect(upcoming([camp], at(2)).next).toBeNull();
  });

  it('an all-day event with no length still lasts its day', () => {
    const day = event(at(0), 0, { allDay: true });
    expect(upcoming([day], at(0, 15)).next).toBe(day);
    expect(upcoming([day], at(1)).next).toBeNull();
  });

  it(`lists at most ${LATER_COUNT} more within the week under "Later this week"`, () => {
    const events = [0, 1, 2, 3, 4, 5, 6].map((d) => event(at(d, 18)));
    const { next, later, laterTitle } = upcoming(events, NOW);
    expect(next).toBe(events[0]);
    expect(later).toEqual(events.slice(1, 1 + LATER_COUNT));
    expect(laterTitle).toBe('Later this week');
  });

  it(`counts the week as today and the ${LATER_DAYS} days after it`, () => {
    const lastDay = event(at(LATER_DAYS, 23));
    const dayAfter = event(at(LATER_DAYS + 1, 0, 1));
    const first = event(at(0, 18));
    expect(upcoming([first, lastDay, dayAfter], NOW).later).toEqual([lastDay]);
  });

  it(`with nothing else this week, shows the next ${COMING_UP_COUNT} under "Coming up"`, () => {
    const first = event(at(0, 18));
    const far = [20, 30, 40].map((d) => event(at(d, 18)));
    const { later, laterTitle } = upcoming([first, ...far], NOW);
    expect(later).toEqual(far.slice(0, COMING_UP_COUNT));
    expect(laterTitle).toBe('Coming up');
  });

  it('with nothing ahead, has nothing next and nothing later', () => {
    expect(upcoming([], NOW)).toEqual({ next: null, later: [], laterTitle: 'Coming up' });
    expect(upcoming([event(at(-1, 9))], NOW)).toEqual({ next: null, later: [], laterTitle: 'Coming up' });
  });

  it('never lists an event that is over, and never lists the next one twice', () => {
    const anyEvents = fc
      .array(
        fc.record({
          startsIn: fc.integer({ min: -3 * 24 * 60, max: 30 * 24 * 60 }),
          minutes: fc.integer({ min: 0, max: 300 }),
        }),
        { maxLength: 30 },
      )
      .map((rows) =>
        rows
          .map(({ startsIn, minutes }) => event(new Date(NOW.getTime() + startsIn * 60 * 1000), minutes))
          .sort((a, b) => a.start.getTime() - b.start.getTime()),
      );
    fc.assert(
      fc.property(anyEvents, (events) => {
        const { next, later, laterTitle } = upcoming(events, NOW);
        const stillOn = (e: CalendarEvent) => (e.end > e.start ? e.end > NOW : e.start >= NOW);
        expect(next === null).toBe(!events.some(stillOn));
        for (const e of later) {
          expect(stillOn(e)).toBe(true);
          expect(e).not.toBe(next);
        }
        expect(later.length).toBeLessThanOrEqual(laterTitle === 'Later this week' ? LATER_COUNT : COMING_UP_COUNT);
        // In the order the calendar has them.
        expect([...later].sort((a, b) => a.start.getTime() - b.start.getTime())).toEqual(later);
      }),
    );
  });
});

describe('whenLabel', () => {
  it.each<[string, CalendarEvent, string]>([
    ['under way', event(at(0, 9, 30)), 'Now'],
    ['starting this minute', event(at(0, 10)), 'Now'],
    ['later this morning', event(at(0, 11)), 'Today'],
    ['this afternoon', event(at(0, 16, 59)), 'Today'],
    ['from five in the evening', event(at(0, 17)), 'Tonight'],
    ['late tonight', event(at(0, 21, 30)), 'Tonight'],
    ['all day today', allDay(at(0)), 'Today'],
    ['tomorrow morning', event(at(1, 6)), 'Tomorrow'],
    ['tomorrow night', event(at(1, 19)), 'Tomorrow'],
    ['all day tomorrow', allDay(at(1)), 'Tomorrow'],
  ])('%s is "%s"', (_when, e, label) => {
    expect(whenLabel(e, NOW)).toBe(label);
  });

  it('after tomorrow, gives the day and date', () => {
    const label = whenLabel(event(at(2, 18)), NOW);
    expect(label).toMatch(/Tue/);
    expect(label).toMatch(/20/);
    expect(label).toMatch(/Oct/);
    expect(label).not.toContain(',');
  });

  it('an all-day event that began yesterday and is still on is "Today", not "Now"', () => {
    expect(whenLabel(allDay(at(-1), 3), NOW)).toBe('Today');
  });

  it('just before midnight, something a few minutes away is "Tomorrow"', () => {
    expect(whenLabel(event(at(1, 0, 5)), at(0, 23, 55))).toBe('Tomorrow');
  });
});

describe('startTime, todayLabel and laterLabel', () => {
  it('gives the time an event starts, or "All day"', () => {
    expect(startTime(event(at(0, 18, 5)))).toMatch(/6:05/);
    expect(startTime(allDay(at(0)))).toBe('All day');
  });

  it('gives today’s day and date', () => {
    const label = todayLabel(NOW);
    expect(label).toMatch(/Sun/);
    expect(label).toMatch(/18/);
    expect(label).toMatch(/Oct/);
    expect(label).not.toContain(',');
  });

  it('puts when and the time on one line', () => {
    expect(laterLabel(event(at(1, 17)), NOW)).toMatch(/^Tomorrow · 5:00/);
    expect(laterLabel(allDay(at(1)), NOW)).toBe('Tomorrow · All day');
  });
});

const todo = (key: string, extra: Partial<Todo> = {}): Todo => ({
  key,
  title: key,
  detail: '',
  href: '/check-in',
  ...extra,
});

const task = (id: string, due_on: string | null): PersonalTask => ({
  id,
  title: id,
  due_on,
  done_at: null,
  created_at: '2026-10-01T00:00:00Z',
});

const names = (groups: ReturnType<typeof needsYouGroups>) =>
  groups.map((g) => [g.title, g.entries.map((e) => (e.kind === 'todo' ? e.todo.key : e.task.id))]);

describe('needsYouGroups', () => {
  const RED = { level: 'red' as const, label: 'Overdue' };
  const AMBER = { level: 'amber' as const, label: 'Due soon' };

  it('puts the club’s jobs and the member’s own tasks in one list: urgent, overdue, due soon, the rest', () => {
    const groups = needsYouGroups(
      [todo('check-in'), todo('renew', { alert: AMBER, dueOn: '2026-10-20' }), todo('concern', { alert: URGENT })],
      [task('bib', '2026-10-15'), task('kit', null)],
      NOW,
    );
    expect(names(groups)).toEqual([[null, ['concern', 'bib', 'renew', 'check-in', 'kit']]]);
  });

  it('a task due within three days counts as due soon, one further off does not', () => {
    const groups = needsYouGroups([todo('check-in')], [task('later', '2026-11-30'), task('soon', '2026-10-20')], NOW);
    expect(names(groups)).toEqual([[null, ['soon', 'check-in', 'later']]]);
  });

  it('with nothing, gives one empty list', () => {
    expect(names(needsYouGroups([], [], NOW))).toEqual([[null, []]]);
  });

  it(`a list of ${GROUP_FROM} or more with some pressing and some not is split in two`, () => {
    const todos = [
      todo('a', { alert: RED, dueOn: '2026-10-10' }),
      todo('b', { alert: AMBER, dueOn: '2026-10-19' }),
      todo('c'),
      todo('d'),
      todo('e'),
    ];
    expect(names(needsYouGroups(todos, [task('f', null)], NOW))).toEqual([
      ['Now', ['a', 'b']],
      ['When you can', ['c', 'd', 'e', 'f']],
    ]);
  });

  it(`a list shorter than ${GROUP_FROM} stays whole`, () => {
    const todos = [todo('a', { alert: RED }), todo('b'), todo('c'), todo('d'), todo('e')];
    expect(needsYouGroups(todos, [], NOW)).toHaveLength(1);
  });

  it('a long list that is all pressing, or all not, stays whole', () => {
    const pressing = 'abcdefg'.split('').map((k) => todo(k, { alert: RED, dueOn: '2026-10-10' }));
    const calm = 'abcdefg'.split('').map((k) => todo(k));
    expect(needsYouGroups(pressing, [], NOW)).toHaveLength(1);
    expect(needsYouGroups(calm, [], NOW)).toHaveLength(1);
  });

  it('never drops or repeats anything, and never puts a warning below something without one', () => {
    const anyTodo = fc.record({
      alert: fc.constantFrom(undefined, RED, AMBER, URGENT),
      dueOn: fc.constantFrom(undefined, '2026-10-01', '2026-10-19', '2026-12-01'),
    });
    const anyTask = fc.constantFrom(null, '2026-10-01', '2026-10-18', '2026-10-21', '2026-10-22', '2027-01-01');
    fc.assert(
      fc.property(fc.array(anyTodo, { maxLength: 12 }), fc.array(anyTask, { maxLength: 8 }), (todos, due) => {
        const groups = needsYouGroups(
          todos.map((t, i) => todo(`todo-${i}`, t)),
          due.map((d, i) => task(`task-${i}`, d)),
          NOW,
        );
        const all = groups.flatMap((g) => g.entries);
        const keys = all.map((e) => (e.kind === 'todo' ? e.todo.key : e.task.id));
        expect(keys).toHaveLength(todos.length + due.length);
        expect(new Set(keys).size).toBe(keys.length);
        const pressing = all.map((e) =>
          e.kind === 'todo' ? !!e.todo.alert : e.task.due_on !== null && e.task.due_on <= '2026-10-21',
        );
        // Once something without a warning appears, nothing with one comes after it.
        expect(pressing.lastIndexOf(true)).toBeLessThan(pressing.includes(false) ? pressing.indexOf(false) : Infinity);
        if (groups.length === 2) {
          expect(groups.map((g) => g.title)).toEqual(['Now', 'When you can']);
          expect(all.length).toBeGreaterThanOrEqual(GROUP_FROM);
          for (const g of groups) expect(g.entries.length).toBeGreaterThan(0);
        } else {
          expect(groups).toHaveLength(1);
          expect(groups[0].title).toBeNull();
        }
      }),
    );
  });
});
