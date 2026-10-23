/**
 * useCanReadReports (src/lib/report-access.ts): who reads the governance
 * reports. Admins, and committee members screened to work with children, the
 * same rule as public.can_read_reports (supabase/tests/committee-reports.sql).
 * The reports name children, so every other kind of committee member reads
 * none (customer review C14).
 */
import { renderHook } from '@testing-library/react-native';

import type { useAuth } from '@/lib/auth';
import { useCanReadReports } from '@/lib/report-access';
import type { AppRole, Profile } from '@/lib/types';

type Auth = ReturnType<typeof useAuth>;

let mockAuth: Pick<Auth, 'profile' | 'isAdmin' | 'exemption' | 'wwccApplication'>;
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));

beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-23T02:00:00Z') }));
afterAll(() => jest.useRealTimers());

const NO_CHECK = { wwcc_number: null, wwcc_expires_on: null };

function profile(role: AppRole, overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'me',
    email: 'sam@example.com',
    full_name: 'Sam Sample',
    preferred_name: null,
    title: null,
    head_physio: false,
    playhq_email: null,
    role,
    extra_roles: [],
    status: 'approved',
    requested_role: null,
    requested_team_id: null,
    join_requested_at: null,
    under_17: false,
    date_of_birth: '1990-05-01',
    declared_date_of_birth: null,
    guardian_email: null,
    wwcc_number: '123456A',
    wwcc_expires_on: '2029-01-01',
    wwcc_exempt_reason: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    rejection_reason: null,
    verified_at: '2026-01-01T00:00:00Z',
    stood_down_at: null,
    ...overrides,
  };
}

const valid = { valid: true } as Auth['exemption'];
const ended = { valid: false } as Auth['exemption'];
const applied = { valid: true } as Auth['wwccApplication'];
const lapsed = { valid: false } as Auth['wwccApplication'];

const CASES: [string, typeof mockAuth, boolean][] = [
  ['signed out', { profile: null, isAdmin: false, exemption: null, wwccApplication: null }, false],
  ['an admin', { profile: profile('admin'), isAdmin: true, exemption: null, wwccApplication: null }, true],
  // An admin's role doesn't pause on a lapsed check, and they read every report.
  ['an admin without a check', { profile: profile('admin', NO_CHECK), isAdmin: true, exemption: null, wwccApplication: null }, true],
  ['a committee member with a current check', { profile: profile('committee'), isAdmin: false, exemption: null, wwccApplication: null }, true],
  [
    'a committee member whose check expires within the month',
    { profile: profile('committee', { wwcc_expires_on: '2026-11-10' }), isAdmin: false, exemption: null, wwccApplication: null },
    true,
  ],
  [
    'a committee member whose check expired',
    { profile: profile('committee', { wwcc_expires_on: '2026-10-01' }), isAdmin: false, exemption: null, wwccApplication: null },
    false,
  ],
  ['a committee member with no check', { profile: profile('committee', NO_CHECK), isAdmin: false, exemption: null, wwccApplication: null }, false],
  [
    'a committee member exempted with a reason',
    { profile: profile('committee', { ...NO_CHECK, wwcc_exempt_reason: 'Treasurer' }), isAdmin: false, exemption: null, wwccApplication: null },
    false,
  ],
  ['a committee member with a volunteer exemption', { profile: profile('committee', NO_CHECK), isAdmin: false, exemption: valid, wwccApplication: null }, true],
  ['a committee member whose volunteer exemption ended', { profile: profile('committee', NO_CHECK), isAdmin: false, exemption: ended, wwccApplication: null }, false],
  ['a committee member with an application in force', { profile: profile('committee', NO_CHECK), isAdmin: false, exemption: null, wwccApplication: applied }, true],
  ['a committee member whose application lapsed', { profile: profile('committee', NO_CHECK), isAdmin: false, exemption: null, wwccApplication: lapsed }, false],
  [
    'a stood-down committee member with a check',
    { profile: profile('committee', { stood_down_at: '2026-10-01T00:00:00Z' }), isAdmin: false, exemption: valid, wwccApplication: applied },
    false,
  ],
  [
    'a committee member waiting for approval',
    { profile: profile('committee', { status: 'pending' }), isAdmin: false, exemption: null, wwccApplication: null },
    false,
  ],
  [
    'a coach on the committee as an extra role',
    { profile: profile('coach', { extra_roles: ['committee'] }), isAdmin: false, exemption: null, wwccApplication: null },
    true,
  ],
  ['a coach with a check', { profile: profile('coach'), isAdmin: false, exemption: valid, wwccApplication: applied }, false],
  ['a guardian with a check', { profile: profile('guardian'), isAdmin: false, exemption: null, wwccApplication: null }, false],
];

it.each(CASES)('%s', (_name, who, reads) => {
  mockAuth = who;
  const { result } = renderHook(() => useCanReadReports());
  expect(result.current).toBe(reads);
});
