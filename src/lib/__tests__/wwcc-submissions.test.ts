/**
 * Who can send in their own Working With Children Check, and what they read
 * about the card they sent (src/lib/wwcc-submissions.ts). Same rule as
 * `public.submit_my_wwcc` (supabase/tests/wwcc-self-submit.sql).
 */
import type { AppRole, MyWwccSubmission, Profile } from '@/lib/types';
import { canSendOwnCheck, isGuest, ownCheckExpiring, submissionStatusText } from '@/lib/wwcc-submissions';

// Sunday 18 October 2026.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 12));
});
afterEach(() => {
  jest.useRealTimers();
});

type Member = Parameters<typeof canSendOwnCheck>[0] & object;
const member = (extra: Partial<Member> = {}): Member => ({
  status: 'approved',
  role: 'coach',
  extra_roles: [],
  wwcc_exempt_reason: null,
  stood_down_at: null,
  ...extra,
});

describe('canSendOwnCheck', () => {
  it.each<[string, Partial<Member>, AppRole[], boolean]>([
    ['a coach', {}, [], true],
    ['a manager', { role: 'manager' }, [], true],
    ['a physio', { role: 'physio' }, [], true],
    ['a temporary helper', { role: 'volunteer' }, [], true],
    ['a committee member', { role: 'committee' }, [], true],
    ['an admin', { role: 'admin' }, [], true],
    ['a statistician', { role: 'statistician' }, [], true],
    ['an exempt committee member', { role: 'committee', wwcc_exempt_reason: 'Treasurer only' }, [], false],
    ['an exempt admin who also coaches', { role: 'admin', extra_roles: ['coach'], wwcc_exempt_reason: 'x' }, [], true],
    ['a coach shown as a guest because the role is paused', { role: 'guest' }, ['coach'], true],
    ['a parent who also coaches, the coach role paused', { role: 'guardian' }, ['coach'], true],
    ['an athlete', { role: 'athlete' }, [], false],
    ['a parent', { role: 'guardian' }, [], false],
    // Optional for a guest, so they can be named to a safeguarding post (21 November 2026).
    ['a guest', { role: 'guest' }, [], true],
    ['a stood-down coach', { role: 'guest', stood_down_at: '2026-10-01T00:00:00Z' }, ['coach'], false],
    ['a coach waiting for approval', { status: 'pending' }, [], false],
    ['a turned-down coach', { status: 'rejected' }, [], false],
  ])('%s → %s', (_label, extra, paused, expected) => {
    expect(canSendOwnCheck(member(extra), paused)).toBe(expected);
  });

  it('is false with nobody signed in', () => {
    expect(canSendOwnCheck(null)).toBe(false);
  });
});

describe('isGuest', () => {
  it('is a guest with no paused roles, not stood down', () => {
    expect(isGuest({ role: 'guest', stood_down_at: null })).toBe(true);
    expect(isGuest({ role: 'guest', stood_down_at: null }, ['coach'])).toBe(false);
    expect(isGuest({ role: 'guest', stood_down_at: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(isGuest({ role: 'coach', stood_down_at: null })).toBe(false);
    expect(isGuest(null)).toBe(false);
  });
});

describe('submissionStatusText', () => {
  const sent = (extra: Partial<MyWwccSubmission> = {}): MyWwccSubmission => ({
    id: 's1',
    card_number: 'WWC1234',
    expires_on: '2029-03-31',
    card_name: 'Sam',
    submitted_at: '2026-10-17T00:00:00Z',
    status: 'waiting',
    decided_at: null,
    return_note: null,
    ...extra,
  });

  it('says a waiting card counts once an admin accepts it', () => {
    expect(submissionStatusText(sent())).toBe(
      'You sent in your card WWC1234, expiring 31/03/2029. A club admin will check it with the Screening Unit. Your role starts again once they accept it.',
    );
  });

  it('says nothing about a role starting for a guest, whose card is optional', () => {
    expect(submissionStatusText(sent(), true)).toBe(
      'You sent in your card WWC1234, expiring 31/03/2029. A club admin will check it with the Screening Unit before it counts.',
    );
  });

  it('gives the admin’s note on a card sent back', () => {
    expect(submissionStatusText(sent({ status: 'returned', return_note: 'Wrong expiry' }))).toBe(
      'A club admin sent back your card WWC1234, expiring 31/03/2029. Their note: “Wrong expiry” Check the details and send it again.',
    );
    expect(submissionStatusText(sent({ status: 'returned' }))).toBe(
      'A club admin sent back your card WWC1234, expiring 31/03/2029. Check the details and send it again.',
    );
  });
});

describe('ownCheckExpiring', () => {
  const card = (expires: string | null): Pick<Profile, 'wwcc_number' | 'wwcc_expires_on'> => ({
    wwcc_number: 'WWC1',
    wwcc_expires_on: expires,
  });
  it('is true only for a recorded card ending within the warning window', () => {
    expect(ownCheckExpiring(card('2026-11-30'))).toBe(true);
    expect(ownCheckExpiring(card('2027-06-30'))).toBe(false);
    expect(ownCheckExpiring(card('2026-10-01'))).toBe(false);
    expect(ownCheckExpiring(card(null))).toBe(false);
    expect(ownCheckExpiring(null)).toBe(false);
  });
});
