// Randomised tests for the Working With Children Check rules in safety.ts.
// fast-check makes thousands of members (any mix of roles, checks, exemptions
// and stand-downs) and "todays" from 2000 to 2060, and each answer is checked
// against simple day counting written here, or against the other rules.
import * as fc from 'fast-check';

import { isMinor } from '@/lib/age';
import { rolesOf } from '@/lib/roles';
import {
  canBeExempt,
  canWorkWithChildren,
  committeeCheckDue,
  committeeChecksDue,
  exemptionStatus,
  isDatedExemption,
  needsWwcc,
  pausedRoles,
  safetyIssues,
  standDownRoles,
  volunteerTimeOff,
  wwccRoles,
  wwccStatus,
  WWCC_WARNING_DAYS,
} from '@/lib/safety';
import type { AppRole, MemberStatus, Profile, VolunteerExemptionBasis } from '@/lib/types';

// Fixed seed so a failure shows the same counterexample on every run.
fc.configureGlobal({ seed: 20261018, numRuns: 400 });

afterEach(() => {
  jest.useRealTimers();
});

// ---- Days, counted in UTC so the machine's time zone can't change them ----

type Day = { y: number; m: number; d: number };

/** The day `days` after (or before) this one, as YYYY-MM-DD. */
const addDays = ({ y, m, d }: Day, days: number) =>
  new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);

const anyToday = fc
  .record({
    y: fc.integer({ min: 2000, max: 2060 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
    ms: fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 - 1 }),
  })
  .map(({ y, m, d, ms }) => {
    // Clamp to a real day by letting UTC roll it back into the month.
    const real = new Date(Date.UTC(y, m - 1, 1));
    real.setUTCDate(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate()));
    return { y, m, d: real.getUTCDate(), ms };
  });

/** Today, at a random time of day, in the machine's own time zone. */
function setToday({ y, m, d, ms }: Day & { ms: number }) {
  const time = new Date(y, m - 1, d);
  time.setMilliseconds(ms);
  // A daylight saving change can skip an hour, so stay on the same calendar day.
  if (time.getDate() !== d) time.setTime(new Date(y, m - 1, d, 12).getTime());
  jest.useFakeTimers().setSystemTime(time);
}

/** Days from today: mostly near the 0 and 60 day edges, sometimes years away. */
const offset = fc.oneof(
  fc.integer({ min: -3, max: 3 }),
  fc.integer({ min: WWCC_WARNING_DAYS - 3, max: WWCC_WARNING_DAYS + 3 }),
  fc.integer({ min: -800, max: 800 }),
  fc.integer({ min: -20000, max: 20000 }),
);

// ---- Members ----

const allRoles: AppRole[] = [
  'admin',
  'coach',
  'manager',
  'athlete',
  'committee',
  'physio',
  'guardian',
  'guest',
  'volunteer',
  'statistician',
];
const role = fc.constantFrom(...allRoles);
const blankOr = <T,>(value: T) => fc.constantFrom<T | string | null>(null, '', '   ', value);

/** A member's check and roles, with expiry given as days from today. */
const memberShape = fc.record({
  role,
  extra_roles: fc.uniqueArray(role, { maxLength: 4 }),
  status: fc.constantFrom<MemberStatus>('approved', 'approved', 'pending', 'rejected'),
  wwcc_number: blankOr('123456A'),
  expiresIn: fc.option(offset, { nil: null }),
  wwcc_exempt_reason: blankOr('Board member who never meets athletes'),
  stood_down_at: fc.option(fc.constant('2026-10-01T00:00:00Z'), { nil: null }),
});
type Shape = typeof memberShape extends fc.Arbitrary<infer T> ? T : never;

function member(shape: Shape, today: Day): Profile {
  const { expiresIn, ...rest } = shape;
  return {
    id: 'p1',
    email: 'sam@example.com',
    full_name: 'Sam Sample',
    preferred_name: null,
    title: null,
    head_physio: false,
    playhq_email: null,
    requested_role: null,
    requested_team_id: null,
    join_requested_at: null,
    under_17: false,
    date_of_birth: '1990-01-01',
    declared_date_of_birth: null,
    guardian_email: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    rejection_reason: null,
    verified_at: null,
    ...rest,
    wwcc_expires_on: expiresIn === null ? null : addDays(today, expiresIn),
  };
}

/** What the check's status should be, from the day count alone. */
function expectedKind(shape: Shape) {
  if (!shape.wwcc_number?.trim() || shape.expiresIn === null) return 'missing';
  if (shape.expiresIn < 0) return 'expired';
  if (shape.expiresIn < WWCC_WARNING_DAYS) return 'expiring';
  return 'current';
}
const hasCurrentCheck = (shape: Shape) => ['current', 'expiring'].includes(expectedKind(shape));

// ---- wwccStatus ----

describe('wwccStatus, randomised', () => {
  it('is expired before today, expiring within 60 days, current after, missing without a number or date', () => {
    fc.assert(
      fc.property(anyToday, memberShape, (today, shape) => {
        setToday(today);
        const status = wwccStatus(member(shape, today));
        expect(status.kind).toBe(expectedKind(shape));
        expect(status.problem).toBe(status.kind !== 'current');
      }),
      { numRuns: 1500 },
    );
  });

  it('names the expiry date when it has passed or is coming up', () => {
    fc.assert(
      fc.property(anyToday, memberShape, (today, shape) => {
        setToday(today);
        const m = member(shape, today);
        const status = wwccStatus(m);
        if (status.kind === 'expired' || status.kind === 'expiring') {
          const [y, mo, d] = m.wwcc_expires_on!.split('-');
          expect(status.label).toContain(`${d}/${mo}/${y}`);
        }
      }),
    );
  });

  it('only gets worse as the days go by', () => {
    const rank = { current: 0, expiring: 1, expired: 2, missing: 3 };
    fc.assert(
      fc.property(anyToday, memberShape, fc.integer({ min: 1, max: 400 }), (today, shape, later) => {
        setToday(today);
        const m = member(shape, today);
        const before = wwccStatus(m).kind;
        const after = { ...today, ...dayParts(addDays(today, later)) };
        setToday(after);
        expect(rank[wwccStatus(m).kind]).toBeGreaterThanOrEqual(rank[before]);
      }),
    );
  });
});

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function dayParts(iso: string): Day {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

// ---- canWorkWithChildren ----

describe('canWorkWithChildren, randomised', () => {
  it('is approved, not stood down, and a current check or an exemption that applies', () => {
    fc.assert(
      fc.property(anyToday, memberShape, fc.boolean(), (today, shape, exempt) => {
        setToday(today);
        const expected =
          shape.status === 'approved' && !shape.stood_down_at && (hasCurrentCheck(shape) || exempt);
        expect(canWorkWithChildren(member(shape, today), exempt)).toBe(expected);
      }),
    );
  });

  it('is never true for no member', () => {
    fc.assert(fc.property(fc.boolean(), (exempt) => expect(canWorkWithChildren(null, exempt)).toBe(false)));
  });
});

// ---- pausedRoles ----

describe('pausedRoles, randomised', () => {
  const checksFrom = fc.option(offset, { nil: null });
  const args = fc.tuple(anyToday, memberShape, fc.boolean(), checksFrom, fc.boolean(), checksFrom);
  type Args = [Day & { ms: number }, Shape, boolean, number | null, boolean, number | null];

  /** Runs pausedRoles for a generated member with today set. */
  function paused([today, shape, exempt, from, applied, statFrom]: Args) {
    setToday(today);
    const m = member(shape, today);
    const day = (n: number | null) => (n === null ? null : addDays(today, n));
    return { m, roles: rolesOf(m), result: pausedRoles(m, exempt, day(from), applied, day(statFrom)) };
  }

  it('only pauses roles the member holds, in their order, and only stand-down roles', () => {
    fc.assert(
      fc.property(args, (a) => {
        const { roles, result } = paused(a);
        expect(result).toEqual(roles.filter((r) => result.includes(r)));
        for (const r of result) expect(standDownRoles).toContain(r);
      }),
    );
  });

  it('never pauses athletes, guardians or guests', () => {
    fc.assert(
      fc.property(args, (a) => {
        const { result } = paused(a);
        expect(result).not.toContain('athlete');
        expect(result).not.toContain('guardian');
        expect(result).not.toContain('guest');
      }),
    );
  });

  it('pauses nothing for a member who is not approved', () => {
    fc.assert(
      fc.property(args, (a) => {
        fc.pre(a[1].status !== 'approved');
        expect(paused(a).result).toEqual([]);
      }),
    );
  });

  it('pauses every stand-down role they hold while they are stood down, whatever their check', () => {
    fc.assert(
      fc.property(args, (a) => {
        fc.pre(a[1].status === 'approved' && !!a[1].stood_down_at);
        const { roles, result } = paused(a);
        expect(result).toEqual(roles.filter((r) => standDownRoles.includes(r)));
      }),
    );
  });

  it('otherwise never pauses admin or temporary helper', () => {
    fc.assert(
      fc.property(args, (a) => {
        fc.pre(!a[1].stood_down_at);
        const { result } = paused(a);
        expect(result).not.toContain('admin');
        expect(result).not.toContain('volunteer');
      }),
    );
  });

  it('pauses statisticians without a current check, exemption or application once one is recorded or their date has come, unless exempted with a reason', () => {
    fc.assert(
      fc.property(args, (a) => {
        const [, shape, exempt, , applied, statFrom] = a;
        fc.pre(shape.status === 'approved' && !shape.stood_down_at);
        const { roles, result } = paused(a);
        const required = !!shape.wwcc_number?.trim() || (statFrom !== null && statFrom <= 0);
        const expected =
          roles.includes('statistician') &&
          !shape.wwcc_exempt_reason?.trim() &&
          required &&
          !hasCurrentCheck(shape) &&
          !exempt &&
          !applied;
        expect(result.includes('statistician')).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it('pauses coach, manager and physio exactly when they can’t work with children', () => {
    fc.assert(
      fc.property(args, (a) => {
        fc.pre(a[1].status === 'approved' && !a[1].stood_down_at);
        const { m, roles, result } = paused(a);
        const canWork = canWorkWithChildren(m, a[2] || a[4]);
        for (const r of wwccRoles) {
          expect(result.includes(r)).toBe(roles.includes(r) && !canWork);
        }
        if (hasCurrentCheck(a[1])) for (const r of wwccRoles) expect(result).not.toContain(r);
      }),
    );
  });

  it('pauses committee without a current check once one is recorded or the club’s date has come, unless exempted', () => {
    fc.assert(
      fc.property(args, (a) => {
        const [, shape, , from, applied] = a;
        fc.pre(shape.status === 'approved' && !shape.stood_down_at);
        const { roles, result } = paused(a);
        const required = !!shape.wwcc_number?.trim() || (from !== null && from <= 0);
        const expected =
          roles.includes('committee') &&
          !shape.wwcc_exempt_reason?.trim() &&
          required &&
          !hasCurrentCheck(shape) &&
          !applied;
        expect(result.includes('committee')).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });
});

// ---- Committee checks date ----

describe('committeeChecksDue and committeeCheckDue, randomised', () => {
  it('is due from the club’s date on, and never before', () => {
    fc.assert(
      fc.property(anyToday, offset, (today, from) => {
        setToday(today);
        expect(committeeChecksDue(addDays(today, from))).toBe(from <= 0);
        expect(committeeChecksDue(null)).toBe(false);
      }),
    );
  });

  it('stays due as the days go by', () => {
    fc.assert(
      fc.property(anyToday, offset, fc.integer({ min: 1, max: 1000 }), (today, from, later) => {
        setToday(today);
        const date = addDays(today, from);
        const dueNow = committeeChecksDue(date);
        setToday({ ...today, ...dayParts(addDays(today, later)) });
        if (dueNow) expect(committeeChecksDue(date)).toBe(true);
      }),
    );
  });

  it('warns a committee member only before the date, with no check or exemption, and never once they are paused for it', () => {
    fc.assert(
      fc.property(anyToday, memberShape, offset, (today, shape, from) => {
        setToday(today);
        const m = member(shape, today);
        const date = addDays(today, from);
        const due = committeeCheckDue(m, date);
        const expected =
          shape.status === 'approved' &&
          rolesOf(m).includes('committee') &&
          !shape.wwcc_number?.trim() &&
          !shape.wwcc_exempt_reason?.trim() &&
          from > 0;
        expect(due).toBe(expected);
        if (due) expect(pausedRoles({ ...m, stood_down_at: null }, false, date)).not.toContain('committee');
        expect(committeeCheckDue(m, null)).toBe(false);
      }),
    );
  });
});

// ---- needsWwcc and canBeExempt ----

describe('needsWwcc and canBeExempt, randomised', () => {
  it('always needs a check for coach, manager, physio or temporary helper, and for committee, admin or statistician unless exempted', () => {
    fc.assert(
      fc.property(anyToday, memberShape, (today, shape) => {
        const m = member(shape, today);
        const roles = rolesOf(m);
        const always = roles.some((r) => ['coach', 'manager', 'physio', 'volunteer'].includes(r));
        const unlessExempt = roles.some((r) => ['committee', 'admin', 'statistician'].includes(r));
        expect(needsWwcc(m)).toBe(always || (unlessExempt && !shape.wwcc_exempt_reason?.trim()));
      }),
    );
  });

  it('can exempt only committee members, admins and statisticians, and an exemption then lifts the need unless they are a temporary helper', () => {
    fc.assert(
      fc.property(anyToday, memberShape, (today, shape) => {
        const m = member(shape, today);
        const roles = rolesOf(m);
        expect(canBeExempt(roles)).toBe(
          roles.some((r) => ['committee', 'admin', 'statistician'].includes(r)) &&
            !roles.some((r) => wwccRoles.includes(r)),
        );
        if (canBeExempt(roles) && !roles.includes('volunteer')) {
          expect(needsWwcc({ ...m, wwcc_exempt_reason: 'Exempted' })).toBe(false);
        }
      }),
    );
  });
});

// ---- volunteerTimeOff ----

describe('volunteerTimeOff, randomised', () => {
  it('is off only for a temporary helper before their first day or after their last', () => {
    fc.assert(
      fc.property(
        anyToday,
        memberShape,
        fc.option(offset, { nil: null }),
        fc.option(offset, { nil: null }),
        (today, shape, from, until) => {
          setToday(today);
          const m = {
            ...member(shape, today),
            volunteer_from: from === null ? null : addDays(today, from),
            volunteer_until: until === null ? null : addDays(today, until),
          };
          const expected =
            rolesOf(m).includes('volunteer') && ((until !== null && until < 0) || (from !== null && from > 0));
          expect(volunteerTimeOff(m)).toBe(expected);
        },
      ),
    );
  });
});

// ---- exemptionStatus ----

describe('exemptionStatus, randomised', () => {
  const basis = fc.constantFrom<VolunteerExemptionBasis>(
    'parent_volunteer',
    'under_18_volunteer',
    'short_term_visitor',
    'national_event',
  );
  const exemption = fc.record({
    basis,
    child_name: fc.option(fc.constantFrom('Alex Sample', ''), { nil: null }),
    declared_at: fc.option(fc.constant('2026-10-01T00:00:00Z'), { nil: null }),
    valid: fc.boolean(),
    startsIn: fc.option(offset, { nil: null }),
    endsIn: fc.option(offset, { nil: null }),
    event_name: fc.option(fc.constantFrom('National Championships', ''), { nil: null }),
  });

  it('flags exactly the exemptions that need attention', () => {
    fc.assert(
      fc.property(anyToday, exemption, (today, { startsIn, endsIn, ...e }) => {
        setToday(today);
        const status = exemptionStatus({
          ...e,
          starts_on: startsIn === null ? null : addDays(today, startsIn),
          ends_on: endsIn === null ? null : addDays(today, endsIn),
        });
        let problem: boolean;
        if (!e.declared_at) problem = true;
        else if (isDatedExemption(e.basis) && startsIn !== null && endsIn !== null) {
          // Not started yet is fine; once started it's a problem only when no longer valid.
          problem = startsIn <= 0 && !e.valid;
        } else if (!e.valid) problem = true;
        else problem = endsIn !== null && endsIn < WWCC_WARNING_DAYS;
        expect(status.problem).toBe(problem);
        expect(status.label.length).toBeGreaterThan(0);
        if (endsIn !== null && status.label.match(/until|ends|ended/)) {
          const [y, m, d] = addDays(today, endsIn).split('-');
          expect(status.label).toContain(`${d}/${m}/${y}`);
        }
      }),
      { numRuns: 1500 },
    );
  });

  it('never throws, whatever is stored', () => {
    const junk = fc.option(fc.oneof(fc.string({ maxLength: 12 }), fc.constant('2026-02-30')), { nil: null });
    fc.assert(
      fc.property(
        anyToday,
        fc.record({
          basis,
          child_name: junk,
          declared_at: junk,
          valid: fc.boolean(),
          starts_on: junk,
          ends_on: junk,
          event_name: junk,
        }),
        (today, e) => {
          setToday(today);
          const status = exemptionStatus(e);
          expect(typeof status.label).toBe('string');
          expect(typeof status.problem).toBe('boolean');
        },
      ),
    );
  });
});

// ---- safetyIssues ----

describe('safetyIssues, randomised', () => {
  const athlete = (today: Day, dateOfBirth: string) => ({
    ...member(
      {
        role: 'athlete',
        extra_roles: [],
        status: 'approved',
        wwcc_number: null,
        expiresIn: null,
        wwcc_exempt_reason: null,
        stood_down_at: null,
      },
      today,
    ),
    date_of_birth: dateOfBirth,
  });
  const turns18 = (issues: string[]) => issues.find((i) => i.startsWith('Turns 18 on '));

  it('warns about an athlete turning 18 within 30 days, and isMinor flips on that day', () => {
    fc.assert(
      fc.property(anyToday, fc.integer({ min: -400, max: 400 }), (today, shift) => {
        setToday(today);
        // Someone whose 18th birthday is `shift` days from today.
        const birthday = dayParts(addDays(today, shift));
        fc.pre(!(birthday.m === 2 && birthday.d === 29)); // nobody born 18 years before has that day
        const born = addDays({ ...birthday, y: birthday.y - 18 }, 0);
        const turns = turns18(safetyIssues(athlete(today, born), true));
        expect(isMinor(born, false)).toBe(shift > 0);
        if (shift > 0 && shift <= 30) {
          const [y, m, d] = addDays(today, shift).split('-');
          expect(turns).toBe(`Turns 18 on ${d}/${m}/${y}`);
        } else {
          expect(turns).toBeUndefined();
        }
      }),
    );
  });

  it('warns a 29 February baby that they turn 18 on 1 March in years without a 29 February', () => {
    const leapYear = fc.integer({ min: 495, max: 510 }).map((n) => n * 4);
    fc.assert(
      fc.property(leapYear, fc.integer({ min: 0, max: 29 }), (year, daysBefore) => {
        const at18 = year + 18;
        const birthday = isLeapYear(at18) ? { y: at18, m: 2, d: 29 } : { y: at18, m: 3, d: 1 };
        const today = dayParts(addDays(birthday, -1 - daysBefore));
        setToday({ ...today, ms: 0 });
        const turns = turns18(safetyIssues(athlete(today, `${year}-02-29`), true));
        expect(turns).toBe(`Turns 18 on ${String(birthday.d).padStart(2, '0')}/0${birthday.m}/${at18}`);
      }),
      { numRuns: 300 },
    );
  });

  it('lists a coach’s check problem exactly when there is one', () => {
    fc.assert(
      fc.property(anyToday, memberShape, (today, shape) => {
        setToday(today);
        const m = member({ ...shape, role: 'coach', status: 'approved' }, today);
        const status = wwccStatus(m);
        expect(safetyIssues(m, true).includes(status.label)).toBe(status.problem);
        expect(safetyIssues(m, true).includes('Stood down')).toBe(!!shape.stood_down_at);
      }),
    );
  });

  it('lists nothing for a member who is not approved', () => {
    fc.assert(
      fc.property(anyToday, memberShape, (today, shape) => {
        fc.pre(shape.status !== 'approved');
        setToday(today);
        expect(safetyIssues(member(shape, today), false)).toEqual([]);
      }),
    );
  });
});
