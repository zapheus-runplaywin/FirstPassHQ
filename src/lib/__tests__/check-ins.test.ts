import {
  checkInOverviewLabel,
  checkInSummaryLabel,
  checkInTotals,
  flaggedAreas,
  scoresLine,
  today,
} from '@/lib/check-ins';
import type { CheckInOverviewRow, CheckInSummary } from '@/lib/types';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

afterEach(() => {
  jest.useRealTimers();
});

function summary(overrides: Partial<CheckInSummary>): CheckInSummary {
  return {
    team_id: 't',
    team_name: 'Team',
    team_kind: 'team',
    squad_id: null,
    athlete_count: 0,
    checked_in_count: 0,
    flagged_count: 0,
    ...overrides,
  };
}

function overview(athletes: number, checkedIn: number): CheckInOverviewRow {
  return {
    team_id: 't',
    team_name: 'Team',
    team_kind: 'team',
    season: 2026,
    athlete_count: athletes,
    checked_in_count: checkedIn,
    flagged_count: null,
    avg_sleep: null,
    avg_soreness: null,
    avg_stress: null,
    avg_mood: null,
  };
}

describe('flaggedAreas', () => {
  it('lists scores of 2 or lower, in question order', () => {
    expect(flaggedAreas({ sleep: 1, soreness: 3, stress: 2, mood: 5 })).toEqual(['Sleep', 'Stress']);
  });

  it('does not flag a 3', () => {
    expect(flaggedAreas({ sleep: 3, soreness: 3, stress: 3, mood: 3 })).toEqual([]);
  });

  it('skips unanswered questions', () => {
    expect(flaggedAreas({ sleep: null, soreness: 2, stress: null, mood: null })).toEqual(['Soreness']);
  });
});

describe('scoresLine', () => {
  it('lists every score', () => {
    expect(scoresLine({ sleep: 4, soreness: 2, stress: 3, mood: 4 })).toBe(
      'Sleep 4 · Soreness 2 · Stress 3 · Mood 4',
    );
  });
});

describe('today', () => {
  it('is the local date', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 7, 23, 30));
    expect(today()).toBe('2026-10-07');
  });
});

describe('checkInTotals', () => {
  it('does not count a team again when its squad is counted', () => {
    const rows = [
      summary({ team_id: 's1', team_kind: 'squad', athlete_count: 20, checked_in_count: 10, flagged_count: 2 }),
      summary({ team_id: 't1', squad_id: 's1', athlete_count: 10, checked_in_count: 5, flagged_count: 1 }),
      summary({ team_id: 't2', squad_id: 's2', athlete_count: 8, checked_in_count: 4, flagged_count: 1 }),
      summary({ team_id: 't3', athlete_count: 6, checked_in_count: 6, flagged_count: 0 }),
    ];
    expect(checkInTotals(rows)).toEqual({ athletes: 34, checkedIn: 20, flagged: 3 });
  });

  it('is zero with no groups', () => {
    expect(checkInTotals([])).toEqual({ athletes: 0, checkedIn: 0, flagged: 0 });
  });
});

describe('checkInSummaryLabel', () => {
  it('invites a look with no groups', () => {
    expect(checkInSummaryLabel([])).toBe('See how your athletes are feeling');
  });

  it('counts check-ins, and flags when there are any', () => {
    expect(checkInSummaryLabel([summary({ athlete_count: 14, checked_in_count: 9, flagged_count: 2 })])).toBe(
      '9 of 14 checked in today · 2 flagged',
    );
    expect(checkInSummaryLabel([summary({ athlete_count: 14, checked_in_count: 9 })])).toBe(
      '9 of 14 checked in today',
    );
  });
});

describe('checkInOverviewLabel', () => {
  it('invites a look with nothing loaded', () => {
    expect(checkInOverviewLabel(null)).toBe('See how squads and teams are feeling');
    expect(checkInOverviewLabel([])).toBe('See how squads and teams are feeling');
  });

  it('adds up every group', () => {
    expect(checkInOverviewLabel([overview(40, 30), overview(20, 12)])).toBe(
      '42 of 60 athletes checked in today',
    );
  });
});
