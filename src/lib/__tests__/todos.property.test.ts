// Randomised tests for the to-do due dates in todos.ts: dueAlert's red and
// amber warnings for any day from 2000 to 2060, counted here in UTC days, and
// sortByAlert's order for any list of to-dos.
import * as fc from 'fast-check';

import { DUE_SOON_DAYS, dueAlert, sortByAlert, type TodoAlert } from '@/lib/todos';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));

// Fixed seed so a failure shows the same counterexample on every run.
fc.configureGlobal({ seed: 20261016, numRuns: 1000 });

/** The day `days` after this one, as YYYY-MM-DD, counted in UTC. */
const addDays = (y: number, m: number, d: number, days: number) =>
  new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);

/** A local time on a real day, at any time of day. */
const anyToday = fc
  .record({
    y: fc.integer({ min: 2000, max: 2060 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
    extra: fc.integer({ min: 0, max: 3 }),
    ms: fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 - 1 }),
  })
  .map(({ y, m, d, extra, ms }) => {
    const day = Math.min(d + extra, new Date(Date.UTC(y, m, 0)).getUTCDate());
    const time = new Date(y, m - 1, day);
    time.setMilliseconds(ms);
    // A daylight saving change can skip an hour, so stay on the same calendar day.
    if (time.getDate() !== day) time.setTime(new Date(y, m - 1, day, 12).getTime());
    return { y, m, d: day, time };
  });

const offset = fc.oneof(fc.integer({ min: -5, max: 8 }), fc.integer({ min: -2000, max: 2000 }));

describe('dueAlert, randomised', () => {
  it('is red before today, amber from today to 3 days ahead, and nothing after', () => {
    fc.assert(
      fc.property(anyToday, offset, ({ y, m, d, time }, days) => {
        const alert = dueAlert(addDays(y, m, d, days), time);
        if (days < 0) expect(alert).toEqual({ level: 'red', label: 'Overdue' });
        else if (days <= DUE_SOON_DAYS) expect(alert).toEqual({ level: 'amber', label: 'Due soon' });
        else expect(alert).toBeNull();
      }),
      { numRuns: 3000 },
    );
  });

  it('only gets more urgent as the days go by', () => {
    const rank = (a: TodoAlert | null) => (a?.level === 'red' ? 2 : a?.level === 'amber' ? 1 : 0);
    fc.assert(
      fc.property(anyToday, offset, fc.integer({ min: 1, max: 30 }), ({ y, m, d }, days, later) => {
        const due = addDays(y, m, d, days);
        const [ly, lm, ld] = addDays(y, m, d, later).split('-').map(Number);
        expect(rank(dueAlert(due, new Date(ly, lm - 1, ld, 12)))).toBeGreaterThanOrEqual(
          rank(dueAlert(due, new Date(y, m - 1, d, 12))),
        );
      }),
    );
  });

  it('is nothing without a due date', () => {
    fc.assert(
      fc.property(anyToday, fc.constantFrom(null, undefined, ''), ({ time }, due) => {
        expect(dueAlert(due, time)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

describe('sortByAlert, randomised', () => {
  type Item = { id: number; level: 'red' | 'amber' | null; due: string | null };
  const items = fc
    .array(
      fc.record({
        level: fc.constantFrom<Item['level']>('red', 'amber', null),
        due: fc.option(fc.constantFrom('2026-10-17', '2026-10-18', '2026-10-20', '2026-11-01'), { nil: null }),
      }),
      { maxLength: 15 },
    )
    .map((list) => list.map((item, id) => ({ ...item, id })));
  const sort = (list: Item[]) =>
    sortByAlert(
      list,
      (i) => (i.level ? { level: i.level, label: '' } : null),
      (i) => i.due,
    );
  const rank = (i: Item) => (i.level === 'red' ? 0 : i.level === 'amber' ? 1 : 2);

  it('keeps every to-do, once', () => {
    fc.assert(
      fc.property(items, (list) => {
        expect(sort(list).map((i) => i.id).sort((a, b) => a - b)).toEqual(list.map((i) => i.id));
      }),
    );
  });

  it('puts red first, then amber, then the rest', () => {
    fc.assert(
      fc.property(items, (list) => {
        const ranks = sort(list).map(rank);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }),
    );
  });

  it('puts the earliest due first within red and amber, with no date last, and keeps ties and the rest in order', () => {
    fc.assert(
      fc.property(items, (list) => {
        const sorted = sort(list);
        for (let i = 1; i < sorted.length; i++) {
          const [a, b] = [sorted[i - 1], sorted[i]];
          if (rank(a) !== rank(b)) continue;
          const [dueA, dueB] = [a.due ?? '9999', b.due ?? '9999'];
          if (rank(a) < 2 && dueA !== dueB) expect(dueA < dueB).toBe(true);
          else expect(a.id).toBeLessThan(b.id);
        }
      }),
    );
  });
});
