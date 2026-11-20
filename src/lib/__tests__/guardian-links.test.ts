import {
  athletesWithVerifiedGuardian,
  formatLinkCode,
  guardianOfText,
  isLockedChild,
  LINK_CODE_ALPHABET,
  linkCodeMessage,
  looksLikeLinkCode,
  normaliseLinkCode,
  unlocksChild,
} from '@/lib/guardian-links';

// Local-time "now" so the tests mean the same in any time zone.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 20, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the code alphabet', () => {
  it('leaves out letters and digits that look alike, as the database does', () => {
    for (const c of '01OIL') expect(LINK_CODE_ALPHABET).not.toContain(c);
    expect(LINK_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(LINK_CODE_ALPHABET).size).toBe(31);
  });
});

describe('formatLinkCode', () => {
  it('splits a code into two threes for reading out', () => {
    expect(formatLinkCode('7KQ4MD')).toBe('7KQ-4MD');
  });

  test.each(['', '7KQ4M', '7KQ4MDX'])('leaves anything that isn’t six long alone: %j', (code) => {
    expect(formatLinkCode(code)).toBe(code);
  });
});

describe('normaliseLinkCode', () => {
  test.each([
    ['7KQ-4MD', '7KQ4MD'],
    ['7kq 4md', '7KQ4MD'],
    [' 7kq–4md ', '7KQ4MD'],
    ['', ''],
  ])('%j → %j', (typed, code) => {
    expect(normaliseLinkCode(typed)).toBe(code);
  });
});

describe('looksLikeLinkCode', () => {
  test.each(['7KQ-4MD', '7kq4md', '22222Z'])('accepts %j', (typed) => {
    expect(looksLikeLinkCode(typed)).toBe(true);
  });

  test.each(['', '7KQ4M', '7KQ4MDD', '7KQ4M0', 'OKQ4MD', '1KQ4MD', 'IKQ4MD', 'LKQ4MD'])(
    'refuses %j',
    (typed) => {
      expect(looksLikeLinkCode(typed)).toBe(false);
    },
  );
});

describe('linkCodeMessage', () => {
  it('names the child, the club and the code', () => {
    expect(linkCodeMessage('7KQ4MD', 'Thunder', 'Jordan Sample', 'FirstPass HQ')).toBe(
      'Jordan Sample is joining Thunder on FirstPass HQ. Install the FirstPass HQ app, sign in, ' +
        'ask to join as a parent or guardian and enter this code: 7KQ-4MD. It works once, for 7 days.',
    );
  });

  it('speaks for the child when there is no name', () => {
    expect(linkCodeMessage('7KQ4MD', 'Thunder', null, 'FirstPass HQ')).toMatch(/^I’m joining Thunder on FirstPass HQ\. /);
  });
});

type Guardian = Parameters<typeof unlocksChild>[0] & object;
const guardian: Guardian = {
  status: 'approved',
  role: 'guardian',
  extra_roles: [],
  verified_at: '2026-10-01T00:00:00Z',
};

describe('unlocksChild', () => {
  it('is an approved, verified parent or guardian', () => {
    expect(unlocksChild(guardian)).toBe(true);
  });

  it('counts a guardian who is also a coach', () => {
    expect(unlocksChild({ ...guardian, role: 'coach', extra_roles: ['guardian'] })).toBe(true);
  });

  test.each([
    ['nobody', null],
    ['someone not found', undefined],
    ['not verified', { ...guardian, verified_at: null }],
    ['waiting for approval', { ...guardian, status: 'pending' as const }],
    ['turned down', { ...guardian, status: 'rejected' as const }],
    ['not a guardian', { ...guardian, role: 'coach' as const }],
  ])('isn’t %s', (_, who) => {
    expect(unlocksChild(who)).toBe(false);
  });
});

describe('athletesWithVerifiedGuardian', () => {
  it('lists each child with at least one parent or guardian who unlocks them', () => {
    const people: Record<string, Guardian> = {
      verified: guardian,
      unverified: { ...guardian, verified_at: null },
    };
    const links = [
      { guardian_id: 'verified', athlete_id: 'a' },
      { guardian_id: 'unverified', athlete_id: 'b' },
      { guardian_id: 'unverified', athlete_id: 'c' },
      { guardian_id: 'verified', athlete_id: 'c' },
      { guardian_id: 'gone', athlete_id: 'd' },
    ];
    expect(athletesWithVerifiedGuardian(links, (id) => people[id])).toEqual(new Set(['a', 'c']));
  });

  it('is empty with no links', () => {
    expect(athletesWithVerifiedGuardian([], () => guardian).size).toBe(0);
  });
});

describe('isLockedChild', () => {
  const child = {
    status: 'approved' as const,
    role: 'athlete' as const,
    extra_roles: [],
    date_of_birth: '2012-03-04',
    under_17: false,
  };

  it('locks an approved athlete under 18 with no verified parent or guardian', () => {
    expect(isLockedChild(child, false)).toBe(true);
  });

  it('locks an athlete marked under 18 with no date of birth', () => {
    expect(isLockedChild({ ...child, date_of_birth: null, under_17: true }, false)).toBe(true);
  });

  it('unlocks them once one is linked', () => {
    expect(isLockedChild(child, true)).toBe(false);
  });

  it('unlocks them on their 18th birthday', () => {
    expect(isLockedChild({ ...child, date_of_birth: '2008-10-21' }, false)).toBe(true);
    expect(isLockedChild({ ...child, date_of_birth: '2008-10-20' }, false)).toBe(false);
  });

  test.each([
    ['waiting for approval', { status: 'pending' as const }],
    ['turned down', { status: 'rejected' as const }],
    ['not an athlete', { role: 'guest' as const }],
    ['an adult', { date_of_birth: '1990-01-01' }],
  ])('doesn’t lock someone %s', (_, overrides) => {
    expect(isLockedChild({ ...child, ...overrides }, false)).toBe(false);
  });

  it('locks an athlete with another main role', () => {
    expect(isLockedChild({ ...child, role: 'guest', extra_roles: ['athlete'] }, false)).toBe(true);
  });
});

describe('guardianOfText', () => {
  it('names every child a parent or guardian is linked to', () => {
    expect(guardianOfText(['Fifteen Locked', 'Sixteen Athlete'])).toBe('Fifteen Locked, Sixteen Athlete');
    expect(guardianOfText(['Sam Small'])).toBe('Sam Small');
  });

  it('says nobody yet, and how to start, with no children linked', () => {
    expect(guardianOfText([])).toMatch(/^Nobody yet\. Enter your child’s link code/);
  });
});
