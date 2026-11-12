import { aYearOn, canOwnPolicy, linkProblem, REVIEW_NOTICE_DAYS, reviewState } from '@/lib/registers';
import type { AppRole } from '@/lib/types';

// The module loads auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

describe('reviewState', () => {
  it('is overdue once the review day has passed', () => {
    expect(reviewState('2026-10-17', '2026-10-18')).toBe('overdue');
  });

  it('is due from today to 30 days ahead', () => {
    expect(REVIEW_NOTICE_DAYS).toBe(30);
    expect(reviewState('2026-10-18', '2026-10-18')).toBe('due');
    expect(reviewState('2026-11-17', '2026-10-18')).toBe('due');
  });

  it('is later after that', () => {
    expect(reviewState('2026-11-18', '2026-10-18')).toBe('later');
  });

  it('counts across the end of a year', () => {
    expect(reviewState('2027-01-14', '2026-12-15')).toBe('due');
    expect(reviewState('2027-01-15', '2026-12-15')).toBe('later');
  });
});

describe('linkProblem', () => {
  it('accepts no link, or a web address', () => {
    expect(linkProblem('')).toBeNull();
    expect(linkProblem('   ')).toBeNull();
    expect(linkProblem('https://club.example/policies/safeguarding.pdf')).toBeNull();
    expect(linkProblem(' http://club.example ')).toBeNull();
    expect(linkProblem('HTTPS://CLUB.EXAMPLE')).toBeNull();
  });

  it('refuses anything else, as the database does', () => {
    for (const bad of ['club.example', 'ftp://club.example', 'https://', 'https://club example', 'javascript:alert(1)']) {
      expect(linkProblem(bad)).toBe('The link must start with https://');
    }
  });
});

describe('aYearOn', () => {
  it('is the same day next year', () => {
    expect(aYearOn('2026-10-18')).toBe('2027-10-18');
  });

  it('moves 29 February to 1 March', () => {
    expect(aYearOn('2028-02-29')).toBe('2029-03-01');
  });
});

describe('canOwnPolicy', () => {
  const member = (role: AppRole, extra: Partial<{ status: string; extra_roles: AppRole[]; stood_down_at: string | null }> = {}) => ({
    status: 'approved',
    role,
    extra_roles: [] as AppRole[],
    stood_down_at: null,
    ...extra,
  });

  it.each(['admin', 'committee', 'coach', 'manager', 'physio', 'statistician'] as AppRole[])(
    'lets an approved %s own a policy',
    (role) => {
      expect(canOwnPolicy(member(role))).toBe(true);
    },
  );

  it.each(['athlete', 'guardian', 'guest', 'volunteer'] as AppRole[])('never a %s', (role) => {
    expect(canOwnPolicy(member(role))).toBe(false);
  });

  it('counts other roles', () => {
    expect(canOwnPolicy(member('athlete', { extra_roles: ['coach'] }))).toBe(true);
  });

  it('never someone waiting for approval or stood down', () => {
    expect(canOwnPolicy(member('committee', { status: 'pending' }))).toBe(false);
    expect(canOwnPolicy(member('committee', { stood_down_at: '2026-10-01T00:00:00Z' }))).toBe(false);
  });
});
