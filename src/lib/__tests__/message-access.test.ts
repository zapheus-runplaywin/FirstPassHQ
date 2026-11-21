/**
 * Safeguarding access to a member's messages (src/lib/message-access.ts):
 * the checks the request form makes before asking, whether access is open,
 * and how a request's status reads. The database makes the same checks
 * (supabase/tests/message-archive-and-access.sql); these keep the screen's
 * words in step with it.
 */
import {
  accessOpen,
  defaultRange,
  MAX_DAYS,
  type MessageAccessRequest,
  requestProblem,
  requestStatusLine,
  splitRequests,
  timeLeft,
} from '@/lib/message-access';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Perth, mid-morning, so the local day and the UTC day agree.
const NOW = new Date('2026-11-21T02:00:00Z');

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

function request(extra: Partial<MessageAccessRequest> = {}): MessageAccessRequest {
  return {
    id: 'r1',
    reference: 'R-0001',
    created_at: '2026-11-20T02:00:00Z',
    concern_id: 'c1',
    concern_reference: 'C-0007',
    concern_open: true,
    requested_by_name: 'Sample Officer',
    requested_post: 'child_safety_officer',
    subject_name: 'Sample Coach',
    subject_link: 'about',
    from_date: '2026-10-22',
    to_date: '2026-11-21',
    reason: 'Check what was sent to the squad',
    status: 'pending',
    decided_by_name: null,
    decided_at: null,
    decision_note: null,
    access_expires_at: null,
    mine: true,
    can_decide: false,
    views: 0,
    ...extra,
  };
}

describe('defaultRange', () => {
  it('is the last 30 days up to today', () => {
    expect(defaultRange(new Date(2026, 10, 21))).toEqual({ from: '2026-10-22', to: '2026-11-21' });
  });
});

describe('requestProblem', () => {
  const today = new Date(2026, 10, 21);
  type Input = Parameters<typeof requestProblem>[0];
  const ok: Input = {
    subjectId: 'p1',
    from: '2026-10-22',
    to: '2026-11-21',
    reason: 'Check the squad messages',
  };

  it('is happy with a person, dates and a reason', () => {
    expect(requestProblem(ok, today)).toBeNull();
  });

  it.each<[string, Partial<Input>, string]>([
    ['no person', { subjectId: null }, 'Choose whose messages to read'],
    ['no start date', { from: null }, 'Choose a start date on or before the end date'],
    [
      'start after end',
      { from: '2026-11-20', to: '2026-11-10' },
      'Choose a start date on or before the end date',
    ],
    ['an end date in the future', { to: '2026-11-22' }, 'The end date can’t be in the future'],
    [
      'more than 90 days',
      { from: '2026-08-22', to: '2026-11-21' },
      `Ask for ${MAX_DAYS} days or less at a time`,
    ],
    ['a short reason', { reason: '  too short ' }, 'Give a reason of at least 10 characters'],
  ])('refuses %s', (_l, change, message) => {
    expect(requestProblem({ ...ok, ...change }, today)).toBe(message);
  });

  it('takes exactly 90 days', () => {
    expect(requestProblem({ ...ok, from: '2026-08-23', to: '2026-11-21' }, today)).toBeNull();
  });

  it('takes a single day', () => {
    expect(requestProblem({ ...ok, from: '2026-11-21', to: '2026-11-21' }, today)).toBeNull();
  });
});

describe('accessOpen', () => {
  const approved = request({ status: 'approved', access_expires_at: '2026-11-21T10:00:00Z' });

  it('is open to the requester while the 24 hours last', () => {
    expect(accessOpen(approved, NOW)).toBe(true);
  });

  it('is never open to anyone else, even an admin who approved it', () => {
    expect(accessOpen({ ...approved, mine: false }, NOW)).toBe(false);
  });

  it('closes when the time is up', () => {
    expect(accessOpen({ ...approved, access_expires_at: '2026-11-21T01:59:00Z' }, NOW)).toBe(false);
  });

  it('is closed while waiting or once refused', () => {
    expect(accessOpen(request(), NOW)).toBe(false);
    expect(accessOpen(request({ status: 'rejected' }), NOW)).toBe(false);
  });
});

describe('timeLeft', () => {
  it.each<[string | null, string]>([
    ['2026-11-22T02:00:00Z', '24 hours left'],
    ['2026-11-22T01:10:30Z', '23 hours 10 minutes left'],
    ['2026-11-21T03:00:00Z', '1 hour left'],
    ['2026-11-21T02:05:00Z', '5 minutes left'],
    ['2026-11-21T02:01:00Z', '1 minute left'],
    ['2026-11-21T02:00:30Z', 'Ended'],
    ['2026-11-21T01:00:00Z', 'Ended'],
    [null, 'Ended'],
  ])('%s → %s', (expires, expected) => {
    expect(timeLeft(expires, NOW)).toBe(expected);
  });
});

describe('requestStatusLine', () => {
  it('says what each request is waiting on', () => {
    expect(requestStatusLine(request(), NOW)).toBe('Waiting for an answer');
    expect(requestStatusLine(request({ status: 'rejected' }), NOW)).toBe('Refused');
    expect(
      requestStatusLine(
        request({ status: 'approved', access_expires_at: '2026-11-21T05:00:00Z' }),
        NOW,
      ),
    ).toBe('Approved · 3 hours left');
    expect(
      requestStatusLine(
        request({ status: 'approved', access_expires_at: '2026-11-20T05:00:00Z' }),
        NOW,
      ),
    ).toBe('Approved · access ended');
  });
});

describe('splitRequests', () => {
  it('puts waiting requests apart from answered ones, keeping their order', () => {
    const list = [
      request({ id: 'a' }),
      request({ id: 'b', status: 'approved' }),
      request({ id: 'c' }),
      request({ id: 'd', status: 'rejected' }),
    ];
    const { waiting, answered } = splitRequests(list);
    expect(waiting.map((r) => r.id)).toEqual(['a', 'c']);
    expect(answered.map((r) => r.id)).toEqual(['b', 'd']);
  });
});
