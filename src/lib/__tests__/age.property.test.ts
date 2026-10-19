// Randomised tests for the date and under-18 rules in age.ts. fast-check tries
// thousands of typed dates, dates of birth and "todays", and each answer is
// checked against a small calendar written here from scratch.
import * as fc from 'fast-check';

import { formatDate, isMinor, parseDate } from '@/lib/age';

// Fixed seed so a failure shows the same counterexample on every run.
fc.configureGlobal({ seed: 20261019, numRuns: 2000 });

afterEach(() => {
  jest.useRealTimers();
});

// ---- A tiny independent calendar ----

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) =>
  m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** A real calendar date, as [year, month, day]. */
const realDate = (minYear: number, maxYear: number) =>
  fc
    .record({
      y: fc.integer({ min: minYear, max: maxYear }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 31 }),
    })
    .map(({ y, m, d }) => ({ y, m, d: Math.min(d, daysIn(y, m)) }));

/** The day after, by hand. */
function nextDay({ y, m, d }: { y: number; m: number; d: number }) {
  if (d < daysIn(y, m)) return { y, m, d: d + 1 };
  if (m < 12) return { y, m: m + 1, d: 1 };
  return { y: y + 1, m: 1, d: 1 };
}

/** The 18th birthday: 29 February becomes 1 March when that year has none. */
function eighteenth({ y, m, d }: { y: number; m: number; d: number }) {
  if (m === 2 && d === 29 && !isLeap(y + 18)) return iso(y + 18, 3, 1);
  return iso(y + 18, m, d);
}

/** Today, at a random time of day, in the machine's own time zone. */
function setToday({ y, m, d }: { y: number; m: number; d: number }, msIntoDay: number) {
  const time = new Date(y, m - 1, d);
  time.setMilliseconds(msIntoDay);
  // A time zone change can skip an hour, so stay on the same calendar day.
  if (time.getDate() !== d) time.setTime(new Date(y, m - 1, d, 12).getTime());
  jest.useFakeTimers().setSystemTime(time);
}

const msIntoDay = fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 - 1 });

// ---- parseDate and formatDate ----

describe('parseDate, randomised', () => {
  const separator = fc.constantFrom('/', '.', '-');
  const space = fc.constantFrom('', ' ', '  ', '\t');

  it('reads exactly the real dates from 1900 to 2100, whatever the padding and separators', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 9999 }),
        fc.boolean(),
        fc.boolean(),
        separator,
        separator,
        space,
        space,
        (day, month, year, padDay, padMonth, sep1, sep2, before, after) => {
          const text = `${before}${padDay ? pad(day) : day}${sep1}${padMonth ? pad(month) : month}${sep2}${pad(year, 4)}${after}`;
          // Only years 1900 to 2100 are dates anyone in the club needs.
          const real = year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
          expect(parseDate(text)).toBe(real ? iso(year, month, day) : undefined);
        },
      ),
    );
  });

  it('refuses the impossible days people mistype', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2100 }), (year) => {
        expect(parseDate(`31/04/${year}`)).toBeUndefined();
        expect(parseDate(`31/06/${year}`)).toBeUndefined();
        expect(parseDate(`31/09/${year}`)).toBeUndefined();
        expect(parseDate(`31/11/${year}`)).toBeUndefined();
        expect(parseDate(`30/02/${year}`)).toBeUndefined();
        expect(parseDate(`00/05/${year}`)).toBeUndefined();
        expect(parseDate(`05/00/${year}`)).toBeUndefined();
        expect(parseDate(`05/13/${year}`)).toBeUndefined();
        expect(parseDate(`29/02/${year}`)).toBe(isLeap(year) ? `${year}-02-29` : undefined);
      }),
    );
  });

  it('refuses years that are not four digits', () => {
    fc.assert(
      fc.property(
        realDate(1900, 2100),
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 10000, max: 99999 }),
        ({ m, d }, short, long) => {
          expect(parseDate(`${d}/${m}/${short}`)).toBeUndefined();
          expect(parseDate(`${d}/${m}/${long}`)).toBeUndefined();
        },
      ),
    );
  });

  it('round-trips with formatDate for every real date', () => {
    fc.assert(
      fc.property(realDate(1900, 2100), ({ y, m, d }) => {
        const date = iso(y, m, d);
        expect(formatDate(date)).toBe(`${pad(d)}/${pad(m)}/${y}`);
        expect(parseDate(formatDate(date))).toBe(date);
      }),
    );
  });

  it('is null only for blank text, and anything it reads round-trips', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 14 }), (text) => {
        const result = parseDate(text);
        if (text.trim() === '') {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        if (result !== undefined) {
          expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(parseDate(formatDate(result))).toBe(result);
        }
      }),
      { numRuns: 5000 },
    );
  });
});

// ---- isMinor ----

describe('isMinor, randomised', () => {
  const dateOfBirth = realDate(1900, 2100);
  const today = realDate(1950, 2100);

  it('is under 18 exactly until the 18th birthday, at any time of day', () => {
    fc.assert(
      fc.property(dateOfBirth, today, msIntoDay, fc.boolean(), (dob, now, ms, under18) => {
        setToday(now, ms);
        expect(isMinor(iso(dob.y, dob.m, dob.d), under18)).toBe(iso(now.y, now.m, now.d) < eighteenth(dob));
      }),
    );
  });

  it('flips on the 18th birthday: under 18 the day before, not on the day', () => {
    fc.assert(
      fc.property(dateOfBirth, msIntoDay, msIntoDay, (dob, ms1, ms2) => {
        const [y, m, d] = eighteenth(dob).split('-').map(Number);
        const birthday = { y, m, d };
        // The day before the birthday, found by stepping forward from the 28th of the month before.
        let dayBefore = m === 1 ? { y: y - 1, m: 12, d: 28 } : { y, m: m - 1, d: 28 };
        while (iso(nextDay(dayBefore).y, nextDay(dayBefore).m, nextDay(dayBefore).d) !== eighteenth(dob)) {
          dayBefore = nextDay(dayBefore);
        }
        const born = iso(dob.y, dob.m, dob.d);
        setToday(dayBefore, ms1);
        expect(isMinor(born, false)).toBe(true);
        setToday(birthday, ms2);
        expect(isMinor(born, true)).toBe(false);
      }),
    );
  });

  it('counts a 29 February birthday as 1 March in years without one', () => {
    const leapYear = fc.integer({ min: 475, max: 520 }).map((n) => n * 4);
    fc.assert(
      fc.property(leapYear, msIntoDay, (year, ms) => {
        const born = `${year}-02-29`;
        const at18 = year + 18;
        setToday({ y: at18, m: 2, d: 28 }, ms);
        expect(isMinor(born, false)).toBe(true);
        setToday(isLeap(at18) ? { y: at18, m: 2, d: 29 } : { y: at18, m: 3, d: 1 }, ms);
        expect(isMinor(born, false)).toBe(false);
      }),
    );
  });

  it('is never under 18 for someone born earlier than an adult', () => {
    fc.assert(
      fc.property(dateOfBirth, dateOfBirth, today, msIntoDay, (a, b, now, ms) => {
        setToday(now, ms);
        const [older, younger] = [iso(a.y, a.m, a.d), iso(b.y, b.m, b.d)].sort();
        if (isMinor(older, false)) expect(isMinor(younger, false)).toBe(true);
        if (!isMinor(younger, false)) expect(isMinor(older, false)).toBe(false);
      }),
    );
  });

  it('stays an adult once 18, as the days go on', () => {
    fc.assert(
      fc.property(dateOfBirth, today, fc.integer({ min: 1, max: 400 }), msIntoDay, (dob, now, days, ms) => {
        const born = iso(dob.y, dob.m, dob.d);
        setToday(now, ms);
        const adultNow = !isMinor(born, false);
        let after = now;
        for (let i = 0; i < days; i++) after = nextDay(after);
        setToday(after, ms);
        if (adultNow) expect(isMinor(born, false)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('uses the admin choice only when there is no date of birth', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined, ''), fc.boolean(), today, (dob, under18, now) => {
        setToday(now, 0);
        expect(isMinor(dob, under18)).toBe(under18);
      }),
      { numRuns: 100 },
    );
  });
});
