import { formatShortDay } from '@/lib/format';
import {
  commentAuthor,
  gamePhase,
  gameTitle,
  gameWhen,
  goalCountsLine,
  outcomeLabel,
  reflectionsToAnswer,
} from '@/lib/goals';
import type { GoalBoardRow, GoalGame } from '@/lib/types';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

// Sunday 18 October 2026, noon local time.
const NOW = new Date(2026, 9, 18, 12);

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

function game(overrides: Partial<GoalGame> = {}): GoalGame {
  return {
    fixture_id: 'f1',
    team_id: 't1',
    team_name: '17 & Under',
    round_name: 'Round 3',
    opponent: 'Swans',
    starts_at: new Date(2026, 9, 24, 14).toISOString(),
    time_tbc: false,
    venue: null,
    court: null,
    is_home: true,
    goals_close_at: new Date(2026, 9, 24, 14).toISOString(),
    played_at: new Date(2026, 9, 24, 15).toISOString(),
    goal_count: 0,
    reflected_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function boardRow(athlete_id: string, reflections_to_answer: number): GoalBoardRow {
  return {
    team_id: 't',
    team_name: 'Team',
    team_kind: 'team',
    athlete_id,
    athlete_name: 'Name',
    next_fixture_id: null,
    next_label: null,
    next_starts_at: null,
    next_goal_count: 0,
    reflections_to_answer,
  };
}

const PAST = { goals_close_at: '2026-10-10T00:00:00Z', played_at: '2026-10-10T01:00:00Z' };

describe('outcomeLabel', () => {
  it('labels each outcome', () => {
    expect(outcomeLabel('achieved')).toBe('Achieved');
    expect(outcomeLabel('partly')).toBe('Partly');
    expect(outcomeLabel('not_yet')).toBe('Not yet');
  });

  it('is null with no outcome', () => {
    expect(outcomeLabel(null)).toBeNull();
  });
});

describe('gameTitle', () => {
  it('gives the round and opponent', () => {
    expect(gameTitle({ round_name: 'Round 3', opponent: 'Swans' })).toBe('Round 3 v Swans');
  });

  it('says Match without a round', () => {
    expect(gameTitle({ round_name: null, opponent: 'Swans' })).toBe('Match v Swans');
  });

  it('leaves out a missing opponent', () => {
    expect(gameTitle({ round_name: 'Grand Final', opponent: null })).toBe('Grand Final');
    expect(gameTitle({ round_name: null, opponent: null })).toBe('Match');
  });
});

describe('gameWhen', () => {
  it('gives the day, time and team', () => {
    const start = new Date(2026, 9, 24, 14);
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(start);
    expect(gameWhen({ starts_at: start.toISOString(), time_tbc: false, team_name: '17 & Under' })).toBe(
      `${formatShortDay(start)} · ${time} · 17 & Under`,
    );
  });

  it('says when the time is to be confirmed', () => {
    expect(
      gameWhen({ starts_at: new Date(2026, 9, 19, 9).toISOString(), time_tbc: true, team_name: 'Open A' }),
    ).toBe('Tomorrow · time TBC · Open A');
  });
});

describe('gamePhase', () => {
  const times = {
    goals_close_at: '2026-10-24T03:00:00Z',
    played_at: '2026-10-24T04:00:00Z',
  };

  it('is open until goals close', () => {
    expect(gamePhase(times, new Date('2026-10-24T02:59:59Z'))).toBe('open');
  });

  it('is playing from the start until it counts as played', () => {
    expect(gamePhase(times, new Date('2026-10-24T03:00:00Z'))).toBe('playing');
    expect(gamePhase(times, new Date('2026-10-24T03:59:59Z'))).toBe('playing');
  });

  it('is played after that', () => {
    expect(gamePhase(times, new Date('2026-10-24T04:00:00Z'))).toBe('played');
  });

  it('uses now by default', () => {
    expect(gamePhase(game())).toBe('open');
    expect(gamePhase(game(PAST))).toBe('played');
  });
});

describe('goalCountsLine', () => {
  it('says when no goals are set', () => {
    expect(goalCountsLine(game())).toBe('No goals set');
    expect(goalCountsLine(game({ ...PAST }))).toBe('No goals set');
  });

  it('only counts goals before the game is played', () => {
    expect(goalCountsLine(game({ goal_count: 1 }))).toBe('1 goal');
    expect(goalCountsLine(game({ goal_count: 3, reflected_count: 1, comment_count: 2 }))).toBe('3 goals');
  });

  it('adds reflections and comments once played', () => {
    expect(goalCountsLine(game({ ...PAST, goal_count: 2, reflected_count: 1, comment_count: 1 }))).toBe(
      '2 goals · 1 of 2 reflected · 1 coach comment',
    );
    expect(goalCountsLine(game({ ...PAST, goal_count: 2, reflected_count: 2, comment_count: 3 }))).toBe(
      '2 goals · ✓ Reflected · 3 coach comments',
    );
    expect(goalCountsLine(game({ ...PAST, goal_count: 2, reflected_count: 0 }))).toBe(
      '2 goals · 0 of 2 reflected',
    );
  });
});

describe('commentAuthor', () => {
  it('names coaches and managers by role', () => {
    expect(commentAuthor({ author_name: 'Sam Lee', author_role: 'coach' })).toBe('Coach Sam Lee');
    expect(commentAuthor({ author_name: 'Jo Park', author_role: 'manager' })).toBe('Manager Jo Park');
  });

  it('gives athletes just their name', () => {
    expect(commentAuthor({ author_name: 'Alex Kim', author_role: 'athlete' })).toBe('Alex Kim');
  });
});

describe('reflectionsToAnswer', () => {
  it('is zero with no board', () => {
    expect(reflectionsToAnswer(null)).toBe(0);
    expect(reflectionsToAnswer([])).toBe(0);
  });

  it('adds up each athlete once', () => {
    expect(
      reflectionsToAnswer([boardRow('a', 2), boardRow('a', 2), boardRow('b', 1), boardRow('c', 0)]),
    ).toBe(3);
  });
});
