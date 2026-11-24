/**
 * Game stats beside game goals (src/lib/game-stats.ts): how one athlete's
 * figures from the game-stats function read on the goals page, and the lines
 * of the Games list in Administration.
 */
import {
  GAMES_PAGE,
  adminGameDetail,
  adminGameStatus,
  adminGameTitle,
  fetchAdminGames,
  fetchGameEvidence,
  fetchGameStats,
  momentChips,
  momentEvidence,
  momentLabel,
  momentTime,
  minutesLabel,
  netPointsLabel,
  statLines,
  type GameMoment,
  type GameStats,
} from '@/lib/game-stats';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/log', () => ({
  logger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// The Supabase client is mocked for every test (jest.setup); it has no functions until one is given.
const invoke = jest.fn();
(supabase as unknown as { functions: { invoke: jest.Mock } }).functions = { invoke };
const rpc = supabase.rpc as jest.Mock;

const SHOOTER: GameStats = {
  goals: 18,
  shots: 24,
  gains: 3,
  turnovers: 5,
  feeds: 7,
  offensiveRebounds: 2,
  defensiveRebounds: 1,
  minutes: 40,
  positions: ['GS', 'GA'],
};

const DEFENDER: GameStats = {
  goals: 0,
  shots: 0,
  gains: 6,
  turnovers: 1,
  feeds: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  minutes: 22.5,
  positions: ['GK'],
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
});

describe('fetchGameStats', () => {
  it('asks the game-stats function for this athlete and game', async () => {
    invoke.mockResolvedValue({ data: { stats: SHOOTER }, error: null });
    await expect(fetchGameStats('a1', 'f1')).resolves.toEqual(SHOOTER);
    expect(invoke).toHaveBeenCalledWith('game-stats', { body: { athleteId: 'a1', fixtureId: 'f1' } });
  });

  it.each<[string, unknown]>([
    ['no stats to show', { data: { stats: null }, error: null }],
    ['an empty answer', { data: null, error: null }],
    ['an answer that isn’t figures', { data: { stats: 'no' }, error: null }],
    ['the function failing', { data: null, error: { name: 'FunctionsHttpError', message: '500' } }],
  ])('gives nothing for %s', async (_l, answer) => {
    invoke.mockResolvedValue(answer);
    await expect(fetchGameStats('a1', 'f1')).resolves.toBeNull();
  });

  it('gives nothing when the server can’t be reached at all', async () => {
    invoke.mockRejectedValue(new Error('Network request failed'));
    await expect(fetchGameStats('a1', 'f1')).resolves.toBeNull();
    invoke.mockRejectedValue('odd');
    await expect(fetchGameStats('a1', 'f1')).resolves.toBeNull();
  });
});

describe('statLines', () => {
  it('lists a shooter’s figures in order', () => {
    expect(statLines(SHOOTER)).toEqual([
      { label: 'Time on court', value: '40 min · GS, GA' },
      { label: 'Shooting', value: '18 from 24 (75%)' },
      { label: 'Feeds', value: '7' },
      { label: 'Gains', value: '3' },
      { label: 'Turnovers', value: '5' },
      { label: 'Rebounds', value: '3 (2 attacking, 1 defending)' },
    ]);
  });

  it('leaves shooting, feeds and rebounds off for an athlete with none', () => {
    expect(statLines(DEFENDER)).toEqual([
      { label: 'Time on court', value: '22.5 min · GK' },
      { label: 'Gains', value: '6' },
      { label: 'Turnovers', value: '1' },
    ]);
  });

  it('shows the time alone when no position was recorded', () => {
    expect(statLines({ ...DEFENDER, positions: [] })[0]).toEqual({ label: 'Time on court', value: '22.5 min' });
  });

  it('adds Net Points only when the server sent them', () => {
    expect(statLines(SHOOTER).map((l) => l.label)).not.toContain('Net Points');
    expect(statLines({ ...SHOOTER, netPoints: 0 }).at(-1)).toEqual({ label: 'Net Points', value: '0' });
    expect(statLines({ ...SHOOTER, netPoints: -3.5 }).at(-1)).toEqual({ label: 'Net Points', value: '−3.5' });
  });
});

describe('labels', () => {
  it('writes minutes and Net Points plainly', () => {
    expect(minutesLabel(38)).toBe('38 min');
    expect(minutesLabel(7.5)).toBe('7.5 min');
    expect(netPointsLabel(4)).toBe('+4');
    expect(netPointsLabel(4.5)).toBe('+4.5');
    expect(netPointsLabel(-2)).toBe('−2');
    expect(netPointsLabel(0)).toBe('0');
  });

  it('names a game by its two teams', () => {
    expect(adminGameTitle({ us: 'Sample Thunder', them: 'Swans', team_name: 'Open A' })).toBe('Sample Thunder v Swans');
    expect(adminGameTitle({ us: ' ', them: null, team_name: 'Open A' })).toBe('Open A v Opponent');
    expect(adminGameTitle({ us: null, them: 'Swans', team_name: null })).toBe('Our team v Swans');
  });

  it('says where a game is up to', () => {
    expect(adminGameStatus('final')).toBe('Finished');
    expect(adminGameStatus('live')).toBe('Being recorded');
    expect(adminGameStatus('setup')).toBe('Set up, not started');
  });

  it('says who recorded a game and how much', () => {
    expect(adminGameDetail({ recorder_name: 'Sample statistician', events: 212 })).toBe(
      'Recorded by Sample statistician · 212 events',
    );
    expect(adminGameDetail({ recorder_name: null, events: 1 })).toBe('No recorder named · 1 event');
  });
});

describe('fetchAdminGames', () => {
  it('asks for one page from where the list is up to', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'g1' }], error: null });
    await expect(fetchAdminGames(50)).resolves.toEqual([{ id: 'g1' }]);
    expect(rpc).toHaveBeenCalledWith('admin_games', { p_limit: GAMES_PAGE, p_offset: 50 });
  });

  it('starts at the newest and gives an empty list for no rows', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchAdminGames()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('admin_games', { p_limit: GAMES_PAGE, p_offset: 0 });
  });

  it('passes on why the list couldn’t be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(fetchAdminGames()).rejects.toThrow('permission denied');
  });
});

describe('an athlete’s moments in a game', () => {
  const GOAL: GameMoment = { quarter: 1, left: 590, kind: 'goal', position: 'GS' };
  const GAIN: GameMoment = { quarter: 2, left: 245, kind: 'gain', position: 'GD', detail: 'Intercept' };
  const REBOUND: GameMoment = { quarter: 4, left: 0, kind: 'rebound', position: 'GK', detail: 'defensive' };

  it('asks the game-stats function for the moments too, and gives both', async () => {
    invoke.mockResolvedValue({ data: { stats: SHOOTER, moments: [GOAL, GAIN] }, error: null });
    await expect(fetchGameEvidence('a1', 'f1')).resolves.toEqual({ stats: SHOOTER, moments: [GOAL, GAIN] });
    expect(invoke).toHaveBeenCalledWith('game-stats', { body: { athleteId: 'a1', fixtureId: 'f1', moments: true } });
  });

  it('gives the stats and no moments from a function that doesn’t send them yet', async () => {
    invoke.mockResolvedValue({ data: { stats: SHOOTER }, error: null });
    await expect(fetchGameEvidence('a1', 'f1')).resolves.toEqual({ stats: SHOOTER, moments: [] });
  });

  it('keeps only moments it can read', async () => {
    invoke.mockResolvedValue({
      data: { stats: SHOOTER, moments: [GOAL, null, 'x', { ...GOAL, kind: 'dance' }, { ...GOAL, quarter: 'one' }, { ...GOAL, left: null }, { ...GOAL, position: 3 }, REBOUND] },
      error: null,
    });
    expect((await fetchGameEvidence('a1', 'f1')).moments).toEqual([GOAL, REBOUND]);
  });

  it.each<[string, unknown]>([
    ['no stats, even with moments in the answer', { data: { stats: null, moments: [GOAL] }, error: null }],
    ['an empty answer', { data: null, error: null }],
    ['the function failing', { data: null, error: { name: 'FunctionsHttpError', message: '500' } }],
  ])('gives nothing for %s', async (_l, answer) => {
    invoke.mockResolvedValue(answer);
    await expect(fetchGameEvidence('a1', 'f1')).resolves.toEqual({ stats: null, moments: [] });
  });

  it('gives nothing when the server can’t be reached at all', async () => {
    invoke.mockRejectedValue(new Error('offline'));
    await expect(fetchGameEvidence('a1', 'f1')).resolves.toEqual({ stats: null, moments: [] });
    invoke.mockRejectedValue('offline');
    await expect(fetchGameEvidence('a1', 'f1')).resolves.toEqual({ stats: null, moments: [] });
  });

  it('says the quarter and the time left on its clock', () => {
    expect(momentTime(GOAL)).toBe('Q1 · 9:50 left');
    expect(momentTime(GAIN)).toBe('Q2 · 4:05 left');
    expect(momentTime(REBOUND)).toBe('Q4 · 0:00 left');
    expect(momentTime({ quarter: 3, left: -4 })).toBe('Q3 · 0:00 left');
  });

  it('says what it was, why, and where they were playing', () => {
    expect(momentLabel(GOAL)).toBe('Goal at GS');
    expect(momentLabel(GAIN)).toBe('Gain (intercept) at GD');
    expect(momentLabel(REBOUND)).toBe('Rebound (defensive) at GK');
    expect(momentLabel({ kind: 'turnover', position: 'C', detail: ' ' })).toBe('Turnover at C');
    expect(momentLabel({ kind: 'centre pass', position: 'WA' })).toBe('Centre pass at WA');
  });

  it('offers only the kinds there are, in a fixed order, with how many', () => {
    expect(momentChips([GAIN, GOAL, GOAL, REBOUND])).toEqual([
      { kind: 'goal', label: 'Goals', count: 2 },
      { kind: 'gain', label: 'Gains', count: 1 },
      { kind: 'rebound', label: 'Rebounds', count: 1 },
    ]);
    expect(momentChips([])).toEqual([]);
  });

  it('starts an observation with the game, the time and the moment', () => {
    expect(momentEvidence('Stars', GAIN)).toBe('v Stars, Q2 4:05 left, gain (intercept) at GD: ');
    expect(momentEvidence(null, GOAL)).toBe('Q1 9:50 left, goal at GS: ');
    expect(momentEvidence('  ', GOAL)).toBe('Q1 9:50 left, goal at GS: ');
  });
});
