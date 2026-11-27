import {
  addDays,
  clashLines,
  groupRounds,
  groupsWithNoRound,
  nextPhaseRound,
  notClosedLine,
  phaseLabel,
  roundsLabel,
  roundTitle,
  roundWhen,
  selectionInfoLabel,
  shiftDates,
  shortDate,
  shortRange,
  type MyRound,
  type SelectionInfo,
} from '@/lib/assessments';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

// Today is pinned: every helper here takes the club's day as an argument.
const TODAY = '2026-11-27';

const round = (extra: Partial<MyRound> = {}): MyRound => ({
  id: 'r1',
  name: 'Trials',
  team_name: '17 & Under Squad',
  starts_on: '2026-11-02',
  ends_on: '2026-12-21',
  closed_at: null,
  athletes: 14,
  my_observations: 0,
  phase: 1,
  round_number: 2,
  criteria_set_name: 'Senior criteria',
  ...extra,
});

describe('dates', () => {
  it('writes short dates, with the weekday when asked', () => {
    expect(shortDate('2026-12-22')).toBe('22 Dec');
    expect(shortDate('2026-12-22', true)).toBe('Tue 22 Dec');
    expect(shortRange({ starts_on: '2026-11-02', ends_on: '2026-12-21' })).toBe('2 Nov to 21 Dec');
  });
  it('adds days across a month and a year', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('roundTitle', () => {
  it('puts the phase and round before the name', () => {
    expect(roundTitle(round())).toBe('Phase 1, Round 2 · Trials');
  });
  it('shows the label alone when the name is the label or empty', () => {
    expect(roundTitle(round({ name: 'Phase 1, Round 2' }))).toBe('Phase 1, Round 2');
    expect(roundTitle(round({ name: '  ' }))).toBe('Phase 1, Round 2');
  });
  it('shows the name alone for a round opened before phases', () => {
    expect(roundTitle(round({ phase: null, round_number: null }))).toBe('Trials');
    expect(phaseLabel({ phase: 1, round_number: null })).toBeNull();
  });
  it('reads round_name for an athlete’s rows', () => {
    expect(roundTitle({ round_name: 'Trials', phase: 3, round_number: 1 })).toBe('Phase 3, Round 1 · Trials');
  });
});

describe('roundWhen and groupRounds', () => {
  it('sorts each round into now, coming up or finished', () => {
    expect(roundWhen(round(), TODAY)).toBe('now');
    expect(roundWhen(round({ starts_on: TODAY, ends_on: TODAY }), TODAY)).toBe('now');
    expect(roundWhen(round({ starts_on: '2026-12-22', ends_on: '2027-01-31' }), TODAY)).toBe('coming');
    expect(roundWhen(round({ ends_on: '2026-11-26' }), TODAY)).toBe('finished');
    expect(roundWhen(round({ closed_at: '2026-11-20T00:00:00Z' }), TODAY)).toBe('finished');
    expect(roundWhen({ starts_on: '2026-11-02', ends_on: '2026-12-21', closed: true }, TODAY)).toBe('finished');
  });
  it('orders coming up soonest first and finished latest first', () => {
    const g = groupRounds(
      [
        round({ id: 'late', starts_on: '2027-02-01', ends_on: '2027-03-01' }),
        round({ id: 'soon', starts_on: '2026-12-22', ends_on: '2027-01-31' }),
        round({ id: 'old', starts_on: '2026-01-01', ends_on: '2026-02-01' }),
        round({ id: 'recent', starts_on: '2026-09-01', ends_on: '2026-10-01' }),
        round({ id: 'now' }),
      ],
      TODAY,
    );
    expect(g.now.map((r) => r.id)).toEqual(['now']);
    expect(g.coming.map((r) => r.id)).toEqual(['soon', 'late']);
    expect(g.finished.map((r) => r.id)).toEqual(['recent', 'old']);
  });
  it('points out a round past its end that nobody closed', () => {
    expect(notClosedLine(round({ ends_on: '2026-11-21' }), TODAY)).toBe('Ended 21 Nov · not closed yet');
    expect(notClosedLine(round({ ends_on: '2026-11-21', closed_at: '2026-11-22T00:00:00Z' }), TODAY)).toBeNull();
    expect(notClosedLine(round(), TODAY)).toBeNull();
  });
});

describe('nextPhaseRound', () => {
  const r = (team_id: string, phase: number | null, round_number: number | null, season = 2026) => ({
    team_id,
    season,
    phase,
    round_number,
  });
  it('starts at Phase 1, Round 1', () => {
    expect(nextPhaseRound([], 't1', 2026)).toEqual({ phase: 1, round: 1 });
    expect(nextPhaseRound([r('t2', 3, 4), r('t1', 2, 1, 2025), r('t1', null, null)], 't1', 2026)).toEqual({ phase: 1, round: 1 });
  });
  it('takes the highest phase so far and the next round in it', () => {
    expect(nextPhaseRound([r('t1', 1, 1), r('t1', 1, 3), r('t1', 2, 1)], 't1', 2026)).toEqual({ phase: 2, round: 2 });
  });
  it('moves to the next phase after round 20', () => {
    expect(nextPhaseRound([r('t1', 1, 20)], 't1', 2026)).toEqual({ phase: 2, round: 1 });
  });
});

describe('clashes', () => {
  const clash = {
    round_name: '2027 selection phase',
    team_name: '17 & Under Squad',
    starts_on: '2026-11-02',
    last_day: '2026-12-21',
    criteria_set_name: 'Senior criteria',
    free_from: '2026-12-22',
  };
  it('says what each clash is', () => {
    expect(clashLines([clash, { ...clash, criteria_set_name: null }])).toEqual([
      '“2027 selection phase” runs 2 Nov to 21 Dec for 17 & Under Squad, on Senior criteria.',
      '“2027 selection phase” runs 2 Nov to 21 Dec for 17 & Under Squad.',
    ]);
  });
  it('moves both dates, keeping the length', () => {
    expect(shiftDates('2026-12-01', '2026-12-31', '2026-12-22')).toEqual({ startsOn: '2026-12-22', endsOn: '2027-01-21' });
  });
});

describe('groupsWithNoRound', () => {
  it('lists this season’s groups with no round', () => {
    const teams = [
      { id: 'a', name: '17 & Under Squad', season: 2026 },
      { id: 'b', name: '20 & Under Squad', season: 2026 },
      { id: 'c', name: 'Old Squad', season: 2025 },
      { id: 'd', name: 'Gone', season: 2026, archived: true },
    ];
    expect(
      groupsWithNoRound(teams, [{ team_id: 'a', season: 2026 }, { team_id: 'b', season: 2025 }], 2026).map((t) => t.name),
    ).toEqual(['20 & Under Squad']);
  });
});

describe('Today labels', () => {
  it('counts only rounds running now as open', () => {
    expect(roundsLabel([round()], TODAY)).toBe('Phase 1, Round 2 · Trials · 14 athletes');
    expect(roundsLabel([round(), round({ id: 'r2' })], TODAY)).toBe('2 selection rounds open');
    expect(roundsLabel([round({ starts_on: '2026-12-22', ends_on: '2027-01-31' })], TODAY)).toBe(
      'Starts 22 Dec: Phase 1, Round 2 · Trials',
    );
    expect(roundsLabel([round({ closed_at: '2026-11-01T00:00:00Z' })], TODAY)).toBe('Past selection rounds');
  });

  const info = (extra: Partial<SelectionInfo> = {}): SelectionInfo => ({
    round_id: 'r1',
    round_name: 'Trials',
    team_name: '17 & Under Squad',
    athlete_id: 'a1',
    athlete_name: 'Jordan',
    is_me: true,
    starts_on: '2026-11-02',
    ends_on: '2026-12-21',
    criteria: { groups: [], recommendations: [] },
    dates: [],
    phase: 1,
    round_number: 2,
    criteria_set_name: 'Senior criteria',
    ...extra,
  });
  it('names the round running now for an athlete', () => {
    expect(selectionInfoLabel([info(), info({ round_id: 'r2', starts_on: '2026-12-22', ends_on: '2027-01-31', round_number: 3 })], TODAY)).toBe(
      'Phase 1, Round 2 · Trials · criteria and dates',
    );
  });
  it('says when the next round starts when none is running', () => {
    expect(selectionInfoLabel([info({ starts_on: '2026-12-22', ends_on: '2027-01-31' })], TODAY)).toBe(
      'Starts 22 Dec: Phase 1, Round 2 · Trials',
    );
  });
});
