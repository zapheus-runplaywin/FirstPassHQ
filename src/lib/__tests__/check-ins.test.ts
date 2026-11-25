import {
  allAnswered,
  answeredCount,
  answersFromParams,
  answersToParams,
  checkInOverviewLabel,
  checkInPrivacy,
  checkInSummaryLabel,
  checkInTotals,
  flaggedAreas,
  noAnswers,
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

describe('the answers while a check-in is filled in', () => {
  it('counts the questions answered, and is complete only with all four', () => {
    expect(answeredCount(noAnswers)).toBe(0);
    expect(allAnswered(noAnswers)).toBe(false);
    const three = { sleep: 4, soreness: null, stress: 1, mood: 5 };
    expect(answeredCount(three)).toBe(3);
    expect(allAnswered(three)).toBe(false);
    const four = { ...three, soreness: 2 };
    expect(answeredCount(four)).toBe(4);
    expect(allAnswered(four)).toBe(true);
  });

  it('carries the answers given so far as route params, and reads them back', () => {
    const answers = { sleep: 4, soreness: null, stress: 1, mood: null };
    expect(answersToParams(answers)).toEqual({ sleep: '4', stress: '1' });
    expect(answersFromParams(answersToParams(answers))).toEqual({ sleep: 4, stress: 1 });
    expect(answersToParams(noAnswers)).toEqual({});
    expect(answersFromParams({})).toEqual({});
  });

  it.each<[string, Record<string, string | string[] | undefined>]>([
    ['out of range', { sleep: '0', soreness: '6', stress: '-1', mood: '10' }],
    ['not whole numbers', { sleep: '4.5', soreness: '2e0', stress: 'abc', mood: '' }],
    ['padded', { sleep: ' 4', soreness: '4 ', stress: '04', mood: '+4' }],
    ['given twice', { sleep: ['4', '5'], mood: ['3'] }],
    ['missing', { sleep: undefined }],
  ])('leaves out answers in a link that are %s', (_label, params) => {
    expect(answersFromParams(params)).toEqual({});
  });

  it('ignores params that aren’t one of the four questions', () => {
    expect(answersFromParams({ sleep: '5', note: 'hello', athlete_id: 'someone-else', day: '2026-01-01' })).toEqual({
      sleep: 5,
    });
  });
});

describe('checkInPrivacy', () => {
  it('says the coaches see an adult’s answers', () => {
    expect(checkInPrivacy(false)).toBe(
      'Your coaches see your answers so they can adjust training, and a low score lets them know to check in with you.',
    );
  });

  it('says an athlete under 18’s coaches see them once a parent or guardian agrees', () => {
    expect(checkInPrivacy(true)).toBe(
      'Your coaches see your answers so they can adjust training, and a low score lets them know to check in with you. As you’re under 18, they see them once a parent or guardian agrees.',
    );
  });
});
