import {
  ageLimitLabel,
  awardSummary,
  ballotLabel,
  closesLabel,
  dayOf,
  endOfDay,
  isClosed,
  slotTitle,
} from '@/lib/awards';
import { formatDateTime } from '@/lib/format';
import { formatDateString } from '@/lib/injuries';
import type { Award } from '@/lib/types';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-18T12:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

function award(overrides: Partial<Award> = {}): Award {
  return {
    id: 'a1',
    season: 2026,
    name: 'MVP',
    description: '',
    closes_at: '2026-12-01T00:00:00Z',
    club_wide: false,
    per_group: false,
    voter_roles: ['athlete'],
    nominees: 'athletes',
    points: [3, 2, 1],
    by_match: false,
    match_vote_hours: 48,
    preseason_weight: 0,
    preseason_closes_at: null,
    annual: false,
    copied_from: null,
    nominee_min_age: null,
    nominee_max_age: null,
    nominee_age_on: null,
    award_groups: [],
    award_candidates: [],
    ...overrides,
  };
}

describe('ballotLabel', () => {
  it('names the ballot', () => {
    expect(ballotLabel([1])).toBe('One vote');
    expect(ballotLabel([3, 2, 1])).toBe('3-2-1 votes');
    expect(ballotLabel([5, 4, 3, 2, 1])).toBe('5-4-3-2-1 votes');
  });
});

describe('ageLimitLabel', () => {
  it('gives a range, with the top age one under the limit', () => {
    expect(
      ageLimitLabel({ nominee_min_age: 16, nominee_max_age: 21, nominee_age_on: '2027-01-01' }),
    ).toBe(`nominees aged 16 to 20 on ${formatDateString('2027-01-01')}`);
  });

  it('gives a minimum or maximum on its own', () => {
    expect(ageLimitLabel({ nominee_min_age: 18, nominee_max_age: null, nominee_age_on: null })).toBe(
      'nominees aged 18 or over on the day voting closes',
    );
    expect(ageLimitLabel({ nominee_min_age: null, nominee_max_age: 21, nominee_age_on: null })).toBe(
      'nominees under 21 on the day voting closes',
    );
  });
});

describe('awardSummary', () => {
  it('describes a plain award', () => {
    expect(awardSummary(award(), ['Open A', 'Open B'])).toBe(
      'Athletes in Open A, Open B vote for athletes · 3-2-1 votes',
    );
  });

  it('says when no groups are chosen yet', () => {
    expect(awardSummary(award({ points: [1] }), [])).toBe(
      'Athletes in no groups yet vote for athletes · One vote',
    );
  });

  it('says every member and across the club', () => {
    expect(
      awardSummary(award({ voter_roles: ['coach', 'member'], club_wide: true, nominees: 'members' }), []),
    ).toBe('Every member across the club vote for any member · 3-2-1 votes');
  });

  it('lists the voter roles', () => {
    expect(
      awardSummary(award({ voter_roles: ['coach', 'committee'], club_wide: true, nominees: 'coaches' }), []),
    ).toBe('Coaches, Committee across the club vote for coaches · 3-2-1 votes');
  });

  it('adds age limits, winners per group, match votes and preseason', () => {
    expect(
      awardSummary(
        award({
          club_wide: true,
          nominee_max_age: 21,
          per_group: true,
          by_match: true,
          preseason_weight: 20,
        }),
        [],
      ),
    ).toBe(
      'Athletes across the club vote for athletes · 3-2-1 votes · nominees under 21 on the day voting closes · a winner for each · after every match · preseason 20%',
    );
  });

  it('leaves out age limits for listed names', () => {
    expect(awardSummary(award({ club_wide: true, nominees: 'listed', nominee_min_age: 16 }), [])).toBe(
      'Athletes across the club vote for listed names · 3-2-1 votes',
    );
  });
});

describe('slotTitle', () => {
  it('names the group and match', () => {
    expect(slotTitle({ team_name: 'Open A', fixture_label: 'Round 3 v Rockets', preseason: false })).toBe(
      'Open A · Round 3 v Rockets',
    );
  });

  it('says Preseason for a preseason vote', () => {
    expect(slotTitle({ team_name: 'Open A', fixture_label: 'Round 3', preseason: true })).toBe(
      'Open A · Preseason',
    );
  });

  it('is blank with nothing to say', () => {
    expect(slotTitle({ team_name: null, fixture_label: null, preseason: false })).toBe('');
  });
});

describe('closesLabel and isClosed', () => {
  it('says Closes for a later time', () => {
    const later = '2026-10-20T12:00:00Z';
    expect(closesLabel(later)).toBe(`Closes ${formatDateTime(new Date(later))}`);
    expect(isClosed(later)).toBe(false);
  });

  it('says Closed for an earlier time', () => {
    const earlier = '2026-10-17T12:00:00Z';
    expect(closesLabel(earlier)).toBe(`Closed ${formatDateTime(new Date(earlier))}`);
    expect(isClosed(earlier)).toBe(true);
  });

  it('counts as closed at the closing time itself', () => {
    expect(isClosed('2026-10-18T12:00:00Z')).toBe(true);
  });
});

describe('endOfDay and dayOf', () => {
  it('ends the day at 11:59 pm local time', () => {
    const end = new Date(endOfDay('2026-10-07'));
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([
      2026, 9, 7, 23, 59,
    ]);
  });

  it('gives the local day of a time', () => {
    expect(dayOf(new Date(2026, 9, 7, 23, 30).toISOString())).toBe('2026-10-07');
    expect(dayOf(endOfDay('2026-10-07'))).toBe('2026-10-07');
  });
});
