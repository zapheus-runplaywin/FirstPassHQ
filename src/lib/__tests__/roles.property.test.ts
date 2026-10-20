// Randomised tests for the role combination rules in roles.ts. fast-check
// tries every kind of role set, for members under and over 18 and with or
// without a date of birth, and checks the rules that must hold for all of them.
import * as fc from 'fast-check';

import { hasRole, roleCombinationProblem, rolesOf } from '@/lib/roles';
import type { AppRole } from '@/lib/types';

// Fixed seed so a failure shows the same counterexample on every run.
fc.configureGlobal({ seed: 20261017, numRuns: 1000 });

// Today is Sunday 18 October 2026, local time.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

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
const roleSet = fc.uniqueArray(fc.constantFrom(...allRoles), { minLength: 1, maxLength: allRoles.length });

/** Dates of birth either side of 18 on 18 October 2026, or none. */
const CHILD = fc.constantFrom('2008-10-19', '2012-05-01', '2020-02-29', '2026-10-18');
const ADULT = fc.constantFrom('2008-10-18', '1990-05-01', '1960-02-29', '2008-02-29');
const age = fc.oneof(
  fc.record({ dob: CHILD, under18: fc.boolean(), minor: fc.constant(true) }),
  fc.record({ dob: ADULT, under18: fc.boolean(), minor: fc.constant(false) }),
  fc.record({ dob: fc.constantFrom(null, undefined), under18: fc.boolean() }).map((a) => ({
    ...a,
    minor: a.under18,
  })),
);

const problem = (roles: AppRole[], a: { dob: string | null | undefined; under18: boolean }) =>
  roleCombinationProblem(roles, a.dob, a.under18);

describe('roleCombinationProblem, randomised', () => {
  it('does not depend on the order the roles are in', () => {
    fc.assert(
      fc.property(
        roleSet.chain((roles) => fc.tuple(fc.constant(roles), fc.shuffledSubarray(roles, { minLength: roles.length }))),
        age,
        ([roles, shuffled], a) => {
          expect(problem(shuffled, a)).toBe(problem(roles, a));
        },
      ),
    );
  });

  it('never allows a set once a smaller set inside it is refused', () => {
    fc.assert(
      fc.property(
        roleSet.chain((roles) => fc.tuple(fc.constant(roles), fc.subarray(roles, { minLength: 1 }))),
        age,
        ([roles, subset], a) => {
          if (problem(subset, a) !== null) expect(problem(roles, a)).not.toBeNull();
        },
      ),
    );
  });

  it('never allows for a child what it refuses for an adult', () => {
    fc.assert(
      fc.property(roleSet, ADULT, CHILD, fc.boolean(), (roles, adult, child, under18) => {
        if (roleCombinationProblem(roles, adult, under18) !== null) {
          expect(roleCombinationProblem(roles, child, under18)).not.toBeNull();
        }
      }),
    );
  });

  it('refuses a guest or temporary helper with any other role', () => {
    fc.assert(
      fc.property(roleSet, age, (roles, a) => {
        if ((roles.includes('guest') || roles.includes('volunteer')) && roles.length > 1) {
          expect(problem(roles, a)).not.toBeNull();
        }
      }),
    );
  });

  it('refuses athletes who are also admins, managers or physios, at any age', () => {
    fc.assert(
      fc.property(roleSet, age, (roles, a) => {
        if (roles.includes('athlete') && roles.some((r) => ['admin', 'manager', 'physio'].includes(r))) {
          expect(problem(roles, a)).not.toBeNull();
        }
      }),
    );
  });

  it('lets an athlete under 18 be a coach and nothing else', () => {
    fc.assert(
      fc.property(roleSet, age, (roles, a) => {
        fc.pre(roles.includes('athlete') && a.minor);
        const onlyCoach = roles.every((r) => r === 'athlete' || r === 'coach');
        expect(problem(roles, a) === null).toBe(onlyCoach);
      }),
    );
  });

  it('refuses a guardian under 18 by date of birth, with any other roles', () => {
    fc.assert(
      fc.property(roleSet, CHILD, fc.boolean(), (roles, dob, under18) => {
        expect(roleCombinationProblem([...new Set<AppRole>(['guardian', ...roles])], dob, under18)).not.toBeNull();
      }),
    );
  });

  it('allows any single role for an adult', () => {
    fc.assert(
      fc.property(fc.constantFrom(...allRoles), ADULT, fc.boolean(), (r, dob, under18) => {
        expect(roleCombinationProblem([r], dob, under18)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('allows any adult set without a guest, temporary helper, or athlete clash', () => {
    const staff: AppRole[] = ['admin', 'coach', 'manager', 'committee', 'physio', 'guardian', 'statistician'];
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...staff), { minLength: 1 }), ADULT, (roles, dob) => {
        expect(roleCombinationProblem(roles, dob, false)).toBeNull();
        if (!roles.some((r) => ['admin', 'manager', 'physio'].includes(r))) {
          expect(roleCombinationProblem([...roles, 'athlete'], dob, false)).toBeNull();
        }
      }),
    );
  });

  it('reads the date of birth over the admin’s under-18 choice', () => {
    fc.assert(
      fc.property(roleSet, fc.oneof(CHILD, ADULT), (roles, dob) => {
        expect(roleCombinationProblem(roles, dob, true)).toBe(roleCombinationProblem(roles, dob, false));
      }),
    );
  });
});

describe('rolesOf and hasRole, randomised', () => {
  const role = fc.constantFrom(...allRoles);

  it('lists the main role first and once, then the extra roles', () => {
    fc.assert(
      fc.property(role, fc.option(fc.array(role, { maxLength: 6 }), { nil: null }), (main, extra) => {
        const roles = rolesOf({ role: main, extra_roles: extra });
        expect(roles[0]).toBe(main);
        expect(roles.filter((r) => r === main)).toHaveLength(1);
        expect(new Set(roles)).toEqual(new Set([main, ...(extra ?? [])]));
        for (const r of allRoles) expect(hasRole({ role: main, extra_roles: extra }, r)).toBe(roles.includes(r));
      }),
    );
  });
});
