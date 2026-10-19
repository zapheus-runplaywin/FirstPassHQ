// Randomised tests for repeating events in calendar.ts. fast-check makes daily
// and weekly ICS events (any start, interval, length and count) and any date
// range, and parseIcs must give exactly the occurrences worked out here by
// adding up the days, all inside the range and in order.
import * as fc from 'fast-check';

import { parseIcs } from '@/lib/calendar';

// Fixed seed so a failure shows the same counterexample on every run.
fc.configureGlobal({ seed: 20261015, numRuns: 200 });

const CALENDAR = { id: 'c1', name: 'Open A', clubWide: false, color: '#336699' };
const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

/** "20261020T090000Z", the UTC form ICS files use. */
const icsTime = (ms: number) =>
  new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const event = fc.record({
  // Starts somewhere in 2026 or 2027, on the minute.
  start: fc.integer({ min: 0, max: 2 * 365 * 24 * 60 }).map((min) => BASE + min * 60 * 1000),
  lengthMinutes: fc.integer({ min: 0, max: 3 * 24 * 60 }),
  freq: fc.constantFrom('DAILY', 'WEEKLY'),
  interval: fc.integer({ min: 1, max: 4 }),
  count: fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
});
const range = fc
  .tuple(fc.integer({ min: -30, max: 2 * 365 }), fc.integer({ min: 1, max: 120 }))
  .map(([from, days]) => [BASE + from * DAY, BASE + (from + days) * DAY] as const);

describe('parseIcs, randomised', () => {
  it('gives exactly the occurrences that overlap the range, in order', () => {
    fc.assert(
      fc.property(event, range, ({ start, lengthMinutes, freq, interval, count }, [from, to]) => {
        const text = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Test//EN',
          'BEGIN:VEVENT',
          'UID:training',
          `DTSTART:${icsTime(start)}`,
          `DTEND:${icsTime(start + lengthMinutes * 60 * 1000)}`,
          `RRULE:FREQ=${freq};INTERVAL=${interval}${count ? `;COUNT=${count}` : ''}`,
          'SUMMARY:Training',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');
        const events = parseIcs(text, CALENDAR, new Date(from), new Date(to));

        // Every occurrence by hand: UTC times have no daylight saving, so each is a fixed step apart.
        const step = interval * (freq === 'DAILY' ? 1 : 7) * DAY;
        const length = lengthMinutes * 60 * 1000;
        const expected: number[] = [];
        for (let k = 0; count === null || k < count; k++) {
          const s = start + k * step;
          if (s >= to) break;
          // Inside the range, or still going when it starts.
          if (s >= from || s + length > from) expected.push(s);
        }

        expect(events.map((e) => e.start.getTime())).toEqual(expected);
        for (const e of events) {
          expect(e.end.getTime() - e.start.getTime()).toBe(length);
          expect(e.start.getTime()).toBeLessThan(to);
          expect(e.end.getTime() > from || e.start.getTime() >= from).toBe(true);
        }
        expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      }),
    );
  });
});
