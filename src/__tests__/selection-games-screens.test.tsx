/**
 * Selection rounds, phase 5 (Matt, 23 November 2026): evidence from games.
 * The athlete's assessment (src/app/assessments/athlete.tsx) has a Games tab
 * with the games they played during the round; opening one fetches the
 * athlete's own figures from the game-stats function, and "Write about this
 * game" starts an observation for that game's day
 * (src/app/assessments/observe.tsx).
 *
 * Who is told a game's figures is the database's call
 * (supabase/tests/selection-game-evidence.sql). The screen asks for one
 * game's figures only when it is opened, and shows what comes back.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AthleteAssessmentScreen from '@/app/assessments/athlete';
import ObserveScreen from '@/app/assessments/observe';
import {
  makeCriteria,
  roundGameLine,
  roundGameTitle,
  type AthleteAssessment,
  type RoundGame,
} from '@/lib/assessments';
import type { GameStats } from '@/lib/game-stats';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

import { clearCalls, fieldLabelled, onlyRpcCall, rpcCalls, rpcNames } from './helpers/calls';
import {
  openScreen,
  refreshControl,
  resetClub,
  setClubFeatures,
  settle,
  type BackendOptions,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => {
  class MockFile {
    static written: { uri: string; bytes: Uint8Array }[] = [];
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    write(bytes: Uint8Array) {
      MockFile.written.push({ uri: this.uri, bytes });
    }
  }
  return { File: MockFile, Paths: { cache: 'file:///cache' } };
});

type Who = PersonaName | Persona;

jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ selectionAssessments: true });
  clearCalls();
});

const d = formatDateString;

const placeholder = (route: string) =>
  function Shown() {
    return <Text>{`screen:${route}`}</Text>;
  };

const press = async (text: string | RegExp, index = 0) => {
  await fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

const fill = async (label: string, value: string) => {
  await fireEvent.changeText(fieldLabelled(label), value);
  await settle(2);
};

/** The selection functions a screen called, leaving out what signing in reads. */
const assessmentRpcs = () => rpcNames().filter((n) => /assessment|selection/.test(n));

/** Pulls the screen down to refresh it, and waits for it to finish. */
async function pullToRefresh() {
  await act(async () => {
    refreshControl().props.onRefresh();
  });
  await settle();
  expect(refreshControl().props.refreshing).toBe(false);
}

// The harness's today is 18 October 2026.

const TODAY = '2026-10-18';
const CRITERIA = makeCriteria([{ name: 'Technical ability', items: ['Passing', 'Catching'] }]);

const ASSESSMENT = {
  round_id: 'r1',
  round_name: '2027 selection phase',
  closed: false,
  starts_on: '2026-10-05',
  ends_on: '2026-11-29',
  criteria: CRITERIA,
  today: TODAY,
  athlete_id: 'a1',
  athlete_name: 'Jordan Junior',
  observations: [],
} as unknown as AthleteAssessment;

const OBSERVATION = {
  id: 'o1',
  author_name: 'Casey Coach',
  mine: true,
  can_change: false,
  context: 'training',
  observed_on: '2026-10-16',
  note: 'Early ball',
  corrects_id: null,
  created_at: '2026-10-16T03:00:00Z',
  ratings: [{ item_key: 'passing', rating: 2 }],
};

function game(extra: Partial<RoundGame> = {}): RoundGame {
  return {
    fixture_id: 'fx1',
    team_name: '17 & Under A',
    opponent: 'Stars',
    round_name: 'Round 5',
    starts_at: '2026-10-17T02:00:00Z',
    played_on: '2026-10-17',
    recorded: true,
    ...extra,
  };
}

const STATS: GameStats = {
  goals: 12,
  shots: 15,
  gains: 3,
  turnovers: 2,
  feeds: 9,
  offensiveRebounds: 1,
  defensiveRebounds: 0,
  minutes: 45,
  positions: ['GA', 'GS'],
};

const invoke = () => (supabase as unknown as { functions: { invoke: jest.Mock } }).functions.invoke;

async function openAthlete(
  games: RoundGame[] | null,
  options: { stats?: GameStats | null; failed?: boolean; assessment?: AthleteAssessment; moments?: unknown } = {},
) {
  await openScreen(
    'coach',
    { 'assessments/athlete': AthleteAssessmentScreen, 'assessments/observe': placeholder('assessments/observe') },
    '/assessments/athlete?round=r1&athlete=a1',
    {},
    {
      rpcs: { athlete_assessment: options.assessment ?? ASSESSMENT, selection_round_games: games },
      functions: {
        'game-stats': options.failed ? { error: { name: 'FunctionsHttpError', message: 'nope' } } : { data: { stats: options.stats ?? null, ...(options.moments === undefined ? {} : { moments: options.moments }) } },
      },
    } as BackendOptions,
  );
}

describe('the Games tab on an athlete’s assessment', () => {
  it('asks which games the athlete played in the round, and for no figures yet', async () => {
    await openAthlete([game()]);
    expect(onlyRpcCall('selection_round_games')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
    expect(invoke()).not.toHaveBeenCalled();
  });

  it.each([[[] as RoundGame[]], [null]])('has no Games tab with no games (%j)', async (games) => {
    await openAthlete(games);
    expect(screen.queryByText(/^Games \(/)).toBeNull();
    expect(screen.getByText(/A line after training or a game is enough\. Over the round/)).toBeTruthy();
  });

  it('offers the tab even before anything is written, and says nothing is written yet', async () => {
    await openAthlete([game(), game({ fixture_id: 'fx2', opponent: 'Planets', recorded: false })]);
    expect(screen.getByText('Nothing written yet. A line after training or a game is enough.')).toBeTruthy();
    expect(screen.getByText('Observations (0)')).toBeTruthy();
    await press('Games (2)');
    expect(screen.getByText(`v Stars · ${d('2026-10-17')}`)).toBeTruthy();
    expect(screen.getByText('17 & Under A · Round 5 · tap for the game stats')).toBeTruthy();
    expect(screen.getByText('17 & Under A · Round 5 · not recorded')).toBeTruthy();
    expect(screen.getByText(/Only their coaches and this panel see them\./)).toBeTruthy();
    expect(invoke()).not.toHaveBeenCalled();
  });

  it('keeps the picture and the observations on their own tabs beside it', async () => {
    await openAthlete([game()], { assessment: { ...ASSESSMENT, observations: [OBSERVATION] } as unknown as AthleteAssessment });
    expect(screen.getByText('The picture so far')).toBeTruthy();
    expect(screen.getByText('Observations (1)')).toBeTruthy();
    expect(screen.getByText('Technical ability')).toBeTruthy();
    await press('Games (1)');
    expect(screen.queryByText('Technical ability')).toBeNull();
    await press('Observations (1)');
    expect(screen.getByText('Early ball')).toBeTruthy();
  });

  it('fetches one game’s figures when it is opened, for this athlete only, and shows them', async () => {
    await openAthlete([game(), game({ fixture_id: 'fx2', opponent: 'Planets' })], { stats: STATS });
    await press('Games (2)');
    await press(`v Stars · ${d('2026-10-17')}`);
    expect(invoke()).toHaveBeenCalledTimes(1);
    expect(invoke()).toHaveBeenCalledWith('game-stats', { body: { athleteId: 'a1', fixtureId: 'fx1', moments: true } });
    expect(screen.getByText('Time on court')).toBeTruthy();
    expect(screen.getByText('45 min · GA, GS')).toBeTruthy();
    expect(screen.queryByText('17 & Under A · Round 5 · tap for the game stats')).toBeTruthy();
  });

  it('doesn’t fetch again when the game is closed and opened again', async () => {
    await openAthlete([game()], { stats: STATS });
    await press('Games (1)');
    await press(`v Stars · ${d('2026-10-17')}`);
    await press(`v Stars · ${d('2026-10-17')}`);
    expect(screen.queryByText('Time on court')).toBeNull();
    await press(`v Stars · ${d('2026-10-17')}`);
    expect(screen.getByText('Time on court')).toBeTruthy();
    expect(invoke()).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['there are none for the athlete', { stats: null }],
    ['the stats can’t be reached', { failed: true }],
  ])('says there are no stats when %s', async (_, options) => {
    await openAthlete([game()], options);
    await press('Games (1)');
    await press(`v Stars · ${d('2026-10-17')}`);
    expect(screen.getByText('No stats for this athlete in this game.')).toBeTruthy();
    expect(screen.queryByText('Time on court')).toBeNull();
  });

  it('asks for no figures for a game that wasn’t recorded, and says why', async () => {
    await openAthlete([game({ recorded: false })], { stats: STATS });
    await press('Games (1)');
    await press(`v Stars · ${d('2026-10-17')}`);
    expect(screen.getByText('This game wasn’t recorded in FirstPass Vantage, so there are no stats.')).toBeTruthy();
    expect(invoke()).not.toHaveBeenCalled();
  });

  it('starts an observation about the game, on the game’s day', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openAthlete([game()], { stats: STATS });
    await press('Games (1)');
    await press(`v Stars · ${d('2026-10-17')}`);
    await press('Write about this game');
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/assessments/observe',
      params: { round: 'r1', athlete: 'a1', context: 'game', on: '2026-10-17' },
    });
    push.mockRestore();
  });

  it('offers nothing to write in a closed round, and still shows the stats', async () => {
    await openAthlete([game()], { stats: STATS, assessment: { ...ASSESSMENT, closed: true } as unknown as AthleteAssessment });
    await press('Games (1)');
    await press(`v Stars · ${d('2026-10-17')}`);
    expect(screen.getByText('Time on court')).toBeTruthy();
    expect(screen.queryByText('Write about this game')).toBeNull();
  });

  it('reads the games again on pull to refresh', async () => {
    await openAthlete([game()]);
    await pullToRefresh();
    expect(rpcCalls('selection_round_games')).toHaveLength(2);
  });

  it('puts the games two a row on a tablet, and one a row on a phone', async () => {
    await openAthlete([game(), game({ fixture_id: 'fx2', opponent: 'Planets' })]);
    await press(/^Games \(2\)/);
    expect(screen.queryByTestId('card-grid-2')).toBeNull();
    const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 600, x: 0, y: 0 } } });
    await fireEvent(screen.getByTestId('card-grid-1'), 'layout', layout(772));
    expect(screen.getByTestId('card-grid-2')).toBeTruthy();
    expect(screen.getByText(/Planets/)).toBeTruthy();
    await fireEvent(screen.getByTestId('card-grid-2'), 'layout', layout(382));
    expect(screen.getByTestId('card-grid-1')).toBeTruthy();
  });
});

describe('the athlete’s moments in a recorded game', () => {
  const MOMENTS = [
    { quarter: 1, left: 590, kind: 'goal', position: 'GS' },
    { quarter: 1, left: 500, kind: 'gain', position: 'GA', detail: 'Intercept' },
    { quarter: 2, left: 245, kind: 'goal', position: 'GA' },
    { quarter: 3, left: 5, kind: 'turnover', position: 'GA', detail: 'Bad pass' },
  ];
  async function openGame(options: Parameters<typeof openAthlete>[1] = {}) {
    await openAthlete([game()], { stats: STATS, moments: MOMENTS, ...options });
    await press('Games (1)');
    await press(`v Stars · ${d('2026-10-17')}`);
  }

  it('offers each kind with how many, and lists none until one is tapped', async () => {
    await openGame();
    expect(screen.getByText('Moments')).toBeTruthy();
    expect(screen.getByText('Goals (2)')).toBeTruthy();
    expect(screen.getByText('Gains (1)')).toBeTruthy();
    expect(screen.getByText('Turnovers (1)')).toBeTruthy();
    expect(screen.queryByText(/^Feeds \(/)).toBeNull();
    expect(screen.getByText(/Tap a kind for each one’s quarter and time on the game clock/)).toBeTruthy();
    expect(screen.queryByText('Q1 · 9:50 left')).toBeNull();
  });

  it('lists one kind at a time with the quarter, the time left and the position, and folds again', async () => {
    await openGame();
    await press('Goals (2)');
    expect(screen.getByText('Q1 · 9:50 left')).toBeTruthy();
    expect(screen.getByText('Goal at GS')).toBeTruthy();
    expect(screen.getByText('Q2 · 4:05 left')).toBeTruthy();
    expect(screen.queryByText('Q1 · 8:20 left')).toBeNull();
    await press('Gains (1)');
    expect(screen.getByText('Q1 · 8:20 left')).toBeTruthy();
    expect(screen.getByText('Gain (intercept) at GA')).toBeTruthy();
    expect(screen.queryByText('Q1 · 9:50 left')).toBeNull();
    await press('Gains (1)');
    expect(screen.queryByText('Q1 · 8:20 left')).toBeNull();
  });

  it('starts an observation about a moment, saying where in the game it is', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openGame();
    await press('Turnovers (1)');
    await press('Q3 · 0:05 left');
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/assessments/observe',
      params: { round: 'r1', athlete: 'a1', context: 'game', on: '2026-10-17', about: 'v Stars, Q3 0:05 left, turnover (bad pass) at GA: ' },
    });
    push.mockRestore();
  });

  it('lists moments in a closed round but starts nothing from them', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openGame({ assessment: { ...ASSESSMENT, closed: true } as unknown as AthleteAssessment });
    await press('Goals (2)');
    await press('Q1 · 9:50 left');
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText('Tap a moment to write about it.')).toBeNull();
    push.mockRestore();
  });

  it('folds the list when another game is opened', async () => {
    await openAthlete([game(), game({ fixture_id: 'fx2', opponent: 'Planets' })], { stats: STATS, moments: MOMENTS });
    await press('Games (2)');
    await press(`v Stars · ${d('2026-10-17')}`);
    await press('Goals (2)');
    await press(`v Planets · ${d('2026-10-17')}`);
    expect(screen.queryByText('Q1 · 9:50 left')).toBeNull();
    expect(screen.getByText(/Tap a kind/)).toBeTruthy();
  });

  it.each([
    ['none are sent, as from a function not yet updated', undefined],
    ['the list is empty', []],
    ['the answer is not a list', 'lots'],
  ])('shows the stats and no Moments when %s', async (_, moments) => {
    await openGame({ moments });
    expect(screen.getByText('Time on court')).toBeTruthy();
    expect(screen.queryByText('Moments')).toBeNull();
  });

  it('shows no moments without stats, whatever the answer holds', async () => {
    await openGame({ stats: null });
    expect(screen.getByText('No stats for this athlete in this game.')).toBeTruthy();
    expect(screen.queryByText('Moments')).toBeNull();
  });

  it('leaves out a moment it can’t read', async () => {
    await openGame({ moments: [...MOMENTS, { quarter: 'x', left: 1, kind: 'goal', position: 'GS' }, { quarter: 1, left: 1, kind: 'dance', position: 'GS' }, null] });
    expect(screen.getByText('Goals (2)')).toBeTruthy();
  });
});

describe('an observation started from a game', () => {
  async function openObserve(query: string) {
    await openScreen('coach', { 'assessments/observe': ObserveScreen }, `/assessments/observe?round=r1&athlete=a1${query}`, {}, {
      rpcs: { athlete_assessment: ASSESSMENT, save_assessment_observation: 'o9' },
    });
  }
  const saved = async () => {
    await press('Technical ability');
    await press('Meets standard', 0);
    await fill('What you saw', 'Held the feed under pressure');
    await press('Add observation');
    return onlyRpcCall('save_assessment_observation');
  };

  it('is about a game, on the game’s day', async () => {
    await openObserve('&context=game&on=2026-10-17');
    expect(await saved()).toMatchObject({ p_context: 'game', p_observed_on: '2026-10-17' });
  });

  it('starts with where in the game the moment is, for the selector to finish', async () => {
    await openObserve(`&context=game&on=2026-10-17&about=${encodeURIComponent('v Stars, Q3 0:05 left, turnover at GA: ')}`);
    expect(screen.getByDisplayValue('v Stars, Q3 0:05 left, turnover at GA: ')).toBeTruthy();
  });

  it('starts empty when it isn’t about a moment', async () => {
    await openObserve('&context=game&on=2026-10-17');
    expect(screen.queryByDisplayValue(/Q3/)).toBeNull();
  });

  it('is at training today when opened the usual way', async () => {
    await openObserve('');
    expect(await saved()).toMatchObject({ p_context: 'training', p_observed_on: TODAY });
  });

  it.each([
    ['a day still to come', '&context=game&on=2026-10-30'],
    ['something that isn’t a day', '&context=game&on=yesterday'],
  ])('falls back to today for %s', async (_, query) => {
    await openObserve(query);
    expect(await saved()).toMatchObject({ p_context: 'game', p_observed_on: TODAY });
  });

  it('ignores a kind of session it doesn’t know', async () => {
    await openObserve('&context=party&on=2026-10-17');
    expect(await saved()).toMatchObject({ p_context: 'training', p_observed_on: '2026-10-17' });
  });
});

describe('a game’s title and line', () => {
  it('names the opponent and the day', () => {
    expect(roundGameTitle(game())).toBe(`v Stars · ${d('2026-10-17')}`);
  });

  it('says whether there are stats to tap for, and copes with no round name', () => {
    expect(roundGameLine(game())).toBe('17 & Under A · Round 5 · tap for the game stats');
    expect(roundGameLine(game({ round_name: null, recorded: false }))).toBe('17 & Under A · not recorded');
  });
});
