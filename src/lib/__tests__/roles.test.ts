import { hasRole, roleCombinationProblem, rolesOf } from '@/lib/roles';

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

// Born well under and well over 18 on 18 October 2026.
const CHILD = '2012-05-01';
const ADULT = '1990-05-01';

describe('rolesOf', () => {
  it('puts the main role first', () => {
    expect(rolesOf({ role: 'coach', extra_roles: ['guardian', 'committee'] })).toEqual([
      'coach',
      'guardian',
      'committee',
    ]);
  });

  it('copes with no extra roles', () => {
    expect(rolesOf({ role: 'athlete' })).toEqual(['athlete']);
    expect(rolesOf({ role: 'athlete', extra_roles: null })).toEqual(['athlete']);
    expect(rolesOf({ role: 'athlete', extra_roles: [] })).toEqual(['athlete']);
  });

  it('lists the main role once when it is also an extra role', () => {
    expect(rolesOf({ role: 'coach', extra_roles: ['coach', 'manager'] })).toEqual([
      'coach',
      'manager',
    ]);
  });
});

describe('hasRole', () => {
  it('checks the main role and extra roles', () => {
    const member = { role: 'coach' as const, extra_roles: ['guardian' as const] };
    expect(hasRole(member, 'coach')).toBe(true);
    expect(hasRole(member, 'guardian')).toBe(true);
    expect(hasRole(member, 'admin', 'guardian')).toBe(true);
    expect(hasRole(member, 'admin', 'committee')).toBe(false);
  });

  it('is false for no member', () => {
    expect(hasRole(null, 'admin')).toBe(false);
    expect(hasRole(undefined, 'admin')).toBe(false);
  });

  it('is false when no roles are asked about', () => {
    expect(hasRole({ role: 'admin' })).toBe(false);
  });
});

describe('roleCombinationProblem', () => {
  it('allows a single role', () => {
    expect(roleCombinationProblem(['athlete'], CHILD, true)).toBeNull();
    expect(roleCombinationProblem(['guest'], null, false)).toBeNull();
    expect(roleCombinationProblem(['volunteer'], null, false)).toBeNull();
  });

  it('allows adult combinations', () => {
    expect(roleCombinationProblem(['coach', 'guardian', 'committee'], ADULT, false)).toBeNull();
    expect(roleCombinationProblem(['admin', 'coach', 'manager'], ADULT, false)).toBeNull();
    expect(roleCombinationProblem(['athlete', 'coach', 'committee'], ADULT, false)).toBeNull();
    expect(roleCombinationProblem(['athlete', 'guardian'], ADULT, false)).toBeNull();
  });

  it('stops guests having another role', () => {
    expect(roleCombinationProblem(['guest', 'athlete'], ADULT, false)).toBe(
      'Guests can’t have another role.',
    );
  });

  it('stops temporary helpers having another role', () => {
    expect(roleCombinationProblem(['volunteer', 'coach'], ADULT, false)).toBe(
      'Temporary helpers can’t have another role.',
    );
  });

  it('checks guests before temporary helpers', () => {
    expect(roleCombinationProblem(['guest', 'volunteer'], ADULT, false)).toBe(
      'Guests can’t have another role.',
    );
  });

  it('stops admins being athletes', () => {
    expect(roleCombinationProblem(['admin', 'athlete'], ADULT, false)).toBe(
      'Admins can’t also be athletes.',
    );
  });

  it('stops athletes being managers', () => {
    expect(roleCombinationProblem(['athlete', 'manager'], ADULT, false)).toBe(
      'Athletes can’t also be managers.',
    );
  });

  it('stops athletes being physios', () => {
    expect(roleCombinationProblem(['physio', 'athlete'], ADULT, false)).toBe(
      'Athletes can’t also be physios.',
    );
  });

  it('lets an athlete under 18 also coach, and nothing else', () => {
    expect(roleCombinationProblem(['athlete', 'coach'], CHILD, false)).toBeNull();
    expect(roleCombinationProblem(['athlete', 'committee'], CHILD, false)).toBe(
      'Athletes under 18 can only also be a coach.',
    );
    expect(roleCombinationProblem(['athlete', 'coach', 'statistician'], CHILD, false)).toBe(
      'Athletes under 18 can only also be a coach.',
    );
  });

  it('uses the admin choice for an athlete with no date of birth', () => {
    expect(roleCombinationProblem(['athlete', 'committee'], null, true)).toBe(
      'Athletes under 18 can only also be a coach.',
    );
    expect(roleCombinationProblem(['athlete', 'committee'], undefined, false)).toBeNull();
  });

  it('goes by the date of birth over the admin choice', () => {
    expect(roleCombinationProblem(['athlete', 'committee'], ADULT, true)).toBeNull();
    expect(roleCombinationProblem(['athlete', 'committee'], CHILD, false)).not.toBeNull();
  });

  it('stops an athlete under 18 being a guardian', () => {
    expect(roleCombinationProblem(['athlete', 'guardian'], CHILD, false)).toBe(
      'Athletes under 18 can only also be a coach.',
    );
  });

  it('stops guardians under 18', () => {
    expect(roleCombinationProblem(['guardian'], CHILD, false)).toBe(
      'Parents and guardians must be 18 or over.',
    );
    expect(roleCombinationProblem(['guardian', 'coach'], CHILD, false)).toBe(
      'Parents and guardians must be 18 or over.',
    );
  });

  it('allows a guardian with no date of birth, whatever the admin chose', () => {
    expect(roleCombinationProblem(['guardian'], null, true)).toBeNull();
  });

  it('switches at the 18th birthday', () => {
    jest.setSystemTime(new Date(2026, 9, 17, 12));
    expect(roleCombinationProblem(['guardian'], '2008-10-18', false)).toBe(
      'Parents and guardians must be 18 or over.',
    );
    jest.setSystemTime(new Date(2026, 9, 18, 12));
    expect(roleCombinationProblem(['guardian'], '2008-10-18', false)).toBeNull();
  });
});
