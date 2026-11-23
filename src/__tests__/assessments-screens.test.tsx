/**
 * Selection assessments (Matt, 23 November 2026). For a round's panel: the
 * rounds they are on (src/app/assessments/index.tsx), a round's athletes, one
 * athlete's assessment and adding an observation. For admins, under
 * Administration: the criteria, opening a round and its panel, and the
 * Selection audit report, which is all an admin reads of a round.
 *
 * Who is on a panel, who may read an assessment and what an admin's report
 * holds are the database's call (supabase/tests/selection-assessments.sql).
 * The screens keep to that: they show what each function returns, send
 * exactly what the member chose, and show the database's refusal. The route
 * guards are in route-guards-roles.test.tsx and route-guards-features.test.tsx.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import * as Sharing from 'expo-sharing';

import AdminAuditScreen from '@/app/admin/assessments/audit';
import AdminCriteriaScreen from '@/app/admin/assessments/criteria';
import AdminAssessmentsScreen from '@/app/admin/assessments/index';
import AdminRoundScreen from '@/app/admin/assessments/round';
import AthleteAssessmentScreen from '@/app/assessments/athlete';
import AssessmentsScreen from '@/app/assessments/index';
import ObserveScreen from '@/app/assessments/observe';
import RoundScreen from '@/app/assessments/round';
import HomeScreen from '@/app/index';
import {
  makeCriteria,
  starterCriteria,
  type AdminRound,
  type AthleteAssessment,
  type MyRound,
  type Observation,
  type PanelMember,
  type RoundSheet,
  type SelectionAudit,
  type SheetAthlete,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

import { clearCalls, fieldLabelled, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import { readPdf } from './helpers/documents';
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

const written = (jest.requireMock('expo-file-system') as { File: { written: { uri: string; bytes: Uint8Array }[] } }).File
  .written;

type Who = PersonaName | Persona;

jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ selectionAssessments: true });
  clearCalls();
  written.length = 0;
  (Sharing.shareAsync as jest.Mock).mockClear();
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

const CRITERIA = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Coachability', scale: ['Developing', 'Meets standard', 'Exceeds standard'], items: ['Accepts feedback'] },
  { name: 'Team focus', items: ['Supports teammates'] },
]);

function myRound(extra: Partial<MyRound> = {}): MyRound {
  return {
    id: 'r1',
    name: '2027 selection phase',
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed_at: null,
    athletes: 14,
    my_observations: 3,
    ...extra,
  };
}

function sheetAthlete(extra: Partial<SheetAthlete> = {}): SheetAthlete {
  return {
    id: 'a1',
    name: 'Jordan Junior',
    is_minor: true,
    observations: 3,
    my_observations: 1,
    assessors: 2,
    groups_covered: 2,
    last_observed_on: '2026-10-16',
    ...extra,
  };
}

function sheet(extra: Partial<RoundSheet> = {}): RoundSheet {
  return {
    id: 'r1',
    name: '2027 selection phase',
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed: false,
    criteria: CRITERIA,
    today: TODAY,
    hidden: 0,
    athletes: [
      sheetAthlete(),
      sheetAthlete({ id: 'a2', name: 'Kai Senior', is_minor: false, observations: 0, assessors: 0, groups_covered: 0, last_observed_on: null }),
      sheetAthlete({ id: 'a3', name: null, observations: 1, assessors: 1, groups_covered: 1, last_observed_on: '2026-10-04' }),
    ],
    ...extra,
  };
}

function observation(extra: Partial<Observation> = {}): Observation {
  return {
    id: 'o1',
    author_name: 'Sam Selector',
    mine: false,
    can_change: false,
    context: 'game',
    observed_on: '2026-10-10',
    note: 'Won three intercepts in the second quarter',
    corrects_id: null,
    created_at: '2026-10-10T08:00:00Z',
    ratings: [{ item_key: 'passing', rating: 3 }],
    ...extra,
  };
}

function assessment(extra: Partial<AthleteAssessment> = {}): AthleteAssessment {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    closed: false,
    starts_on: '2026-10-05',
    criteria: CRITERIA,
    today: TODAY,
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    observations: [
      observation({
        id: 'o3',
        mine: true,
        can_change: true,
        author_name: 'Sample coach',
        context: 'training',
        observed_on: '2026-10-17',
        note: 'Listened and changed her footwork',
        ratings: [
          { item_key: 'accepts-feedback', rating: 2 },
          { item_key: 'catching', rating: null },
        ],
      }),
      observation({
        id: 'o2',
        mine: true,
        author_name: 'Sample coach',
        context: 'training',
        observed_on: '2026-10-12',
        note: null,
        ratings: [{ item_key: 'passing', rating: 2 }],
      }),
      observation(),
    ],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Home

describe('Home', () => {
  async function openHome(who: Who, rounds: MyRound[] | null) {
    await openScreen(who, { index: HomeScreen, 'assessments/index': placeholder('assessments/index') }, '/', {}, {
      rpcs: { my_selection_rounds: rounds },
    });
  }

  it('shows a coach on a panel their round, and opens the list', async () => {
    await openHome('coach', [myRound()]);
    expect(screen.getByText('Selection assessments')).toBeTruthy();
    expect(screen.getByText('2027 selection phase · 14 athletes')).toBeTruthy();
    await press('Selection assessments');
    expect(screen.getByText('screen:assessments/index')).toBeTruthy();
  });

  it('shows nothing to a coach who is on no panel', async () => {
    await openHome('coach', []);
    expect(rpcNames()).toContain('my_selection_rounds');
    expect(screen.queryByText('Selection assessments')).toBeNull();
  });

  it.each<PersonaName>(['athlete', 'guardian', 'manager', 'committee', 'physio'])(
    'never asks for rounds for %s',
    async (who) => {
      await openHome(who, [myRound()]);
      expect(rpcNames()).not.toContain('my_selection_rounds');
      expect(screen.queryByText('Selection assessments')).toBeNull();
    },
  );

  it('shows nothing, and asks for nothing, while the feature is off', async () => {
    setClubFeatures({});
    await openHome('coach', [myRound()]);
    expect(rpcNames()).not.toContain('my_selection_rounds');
    expect(screen.queryByText('Selection assessments')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A panel member's rounds

describe('my selection rounds', () => {
  async function openRounds(rounds: MyRound[] | null) {
    await openScreen(
      'coach',
      { 'assessments/index': AssessmentsScreen, 'assessments/round': RoundScreen },
      '/assessments',
      {},
      { rpcs: { my_selection_rounds: rounds, selection_round_sheet: sheet() } },
    );
  }

  it('lists each round with its group, dates and the member’s own count', async () => {
    await openRounds([
      myRound(),
      myRound({ id: 'r0', name: '2026 selection phase', closed_at: '2026-02-01T00:00:00Z', athletes: 1, my_observations: 1 }),
    ]);
    expect(screen.getByText('2027 selection phase')).toBeTruthy();
    expect(screen.getAllByText(`17 & Under squad · ${d('2026-10-05')} to ${d('2026-11-29')}`)).toHaveLength(2);
    expect(screen.getByText('14 athletes · you have written 3 observations')).toBeTruthy();
    expect(screen.getByText('2026 selection phase (closed)')).toBeTruthy();
    expect(screen.getByText('1 athlete · you have written 1 observation')).toBeTruthy();
  });

  it('tells a member on no panel how panels are chosen', async () => {
    await openRounds(null);
    expect(screen.getByText(/You aren’t on a selection panel/)).toBeTruthy();
  });

  it('reads the rounds again on pull to refresh', async () => {
    await openRounds([myRound()]);
    await pullToRefresh();
    expect(rpcCalls('my_selection_rounds')).toHaveLength(2);
  });

  it('opens a round with its id', async () => {
    await openRounds([myRound()]);
    await press('2027 selection phase');
    expect(rpcCalls('selection_round_sheet')).toEqual([{ p_round_id: 'r1' }]);
    expect(screen.getByText('Jordan Junior')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A round's athletes

describe('a round’s athletes', () => {
  async function openRound(round: RoundSheet = sheet(), options: BackendOptions = {}) {
    await openScreen(
      'coach',
      { 'assessments/round': RoundScreen, 'assessments/athlete': AthleteAssessmentScreen },
      '/assessments/round?id=r1',
      {},
      { rpcs: { selection_round_sheet: round, athlete_assessment: assessment() }, ...options },
    );
  }

  it('says how much is written about each athlete, and who has nothing yet or lately', async () => {
    await openRound();
    expect(screen.getByText(`17 & Under squad · ${d('2026-10-05')} to ${d('2026-11-29')}`)).toBeTruthy();
    expect(screen.getByText('3 observations from 2 selectors · 2 of 3 groups')).toBeTruthy();
    expect(screen.getByText('Nothing written yet')).toBeTruthy();
    expect(screen.getByText('Athlete')).toBeTruthy();
    expect(screen.getByText('1 observation from 1 selector · 1 of 3 groups · nothing for 14 days')).toBeTruthy();
  });

  it('shows counts only: no rating, evidence, score or ranking', async () => {
    await openRound();
    expect(screen.getByText(/There is no score or ranking/)).toBeTruthy();
    expect(screen.queryByText(/Meets standard|Exceeds standard|Below standard/)).toBeNull();
  });

  it('says how many athletes are left off because they are the member’s own child', async () => {
    await openRound(sheet({ hidden: 1 }));
    expect(screen.getByText(/1 athlete isn’t listed because you are their parent or guardian/)).toBeTruthy();
    await openRound(sheet({ hidden: 2 }));
    expect(screen.getByText(/2 athletes aren’t listed because you are their parent or guardian/)).toBeTruthy();
    await openRound();
    expect(screen.queryByText(/parent or guardian/)).toBeNull();
  });

  it('says a closed round takes nothing more, and when there is nobody to assess', async () => {
    await openRound(sheet({ closed: true, athletes: [] }));
    expect(screen.getByText(/closed, so nothing more can be added/)).toBeTruthy();
    expect(screen.getByText('There are no athletes in 17 & Under squad for you to assess.')).toBeTruthy();
  });

  it('reads the round again on pull to refresh', async () => {
    await openRound();
    await pullToRefresh();
    expect(rpcCalls('selection_round_sheet')).toEqual([{ p_round_id: 'r1' }, { p_round_id: 'r1' }]);
  });

  it('shows the database’s refusal to someone who isn’t on the panel', async () => {
    await openRound(sheet(), { rpcErrors: { selection_round_sheet: 'Only the round’s panel can open it' } });
    expect(screen.getByText('Only the round’s panel can open it')).toBeTruthy();
    expect(screen.queryByText('Jordan Junior')).toBeNull();
  });

  it('opens an athlete’s assessment with the round and the athlete', async () => {
    await openRound();
    await press('Jordan Junior');
    expect(rpcCalls('athlete_assessment')).toEqual([{ p_round_id: 'r1', p_athlete_id: 'a1' }]);
    expect(screen.getByText('The picture so far')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One athlete's assessment

describe('an athlete’s assessment', () => {
  async function openAthlete(loaded: AthleteAssessment = assessment(), options: BackendOptions = {}) {
    await openScreen(
      'coach',
      { 'assessments/athlete': AthleteAssessmentScreen, 'assessments/observe': placeholder('assessments/observe') },
      '/assessments/athlete?round=r1&athlete=a1',
      {},
      { rpcs: { athlete_assessment: loaded }, ...options },
    );
  }

  it('asks for the athlete in the round', async () => {
    await openAthlete();
    expect(onlyRpcCall('athlete_assessment')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
  });

  it('shows the picture against each criterion as counts in words, never a score', async () => {
    await openAthlete();
    expect(screen.getByText(/2027 selection phase · 3 observations from 2 selectors/)).toBeTruthy();
    expect(screen.getByText('Meets standard ×1, Exceeds standard ×1 · seen 2 times by 2 selectors')).toBeTruthy();
    expect(screen.getByText('Not rated · seen 1 time by 1 selector')).toBeTruthy();
    expect(screen.getByText('Meets standard ×1 · seen 1 time by 1 selector')).toBeTruthy();
    expect(screen.queryByText(/score|average|total|rank/i)).toBeNull();
  });

  it('names the groups with nothing written yet', async () => {
    await openAthlete();
    expect(screen.getByText('Nothing yet on: Team focus')).toBeTruthy();
  });

  it('reads the assessment again on pull to refresh', async () => {
    await openAthlete();
    await pullToRefresh();
    expect(rpcCalls('athlete_assessment')).toHaveLength(2);
  });

  it('names a group’s items nobody has seen', async () => {
    await openAthlete(assessment({ observations: [observation()] }));
    expect(screen.getByText('Nothing yet on: Catching')).toBeTruthy();
    expect(screen.getByText('Nothing yet on: Coachability, Team focus')).toBeTruthy();
    expect(screen.getByText(/1 observation from 1 selector/)).toBeTruthy();
  });

  it('lists each observation with its day, where, who, criteria and evidence', async () => {
    await openAthlete();
    expect(screen.getByText(`${d('2026-10-17')} · Training · You`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-10')} · Game · Sam Selector`)).toBeTruthy();
    expect(screen.getByText('Accepts feedback: Meets standard')).toBeTruthy();
    expect(screen.getByText('Passing: Exceeds standard')).toBeTruthy();
    expect(screen.getByText('Won three intercepts in the second quarter')).toBeTruthy();
  });

  it('offers Change on the member’s own while it is open, a correction once locked, and nothing on others’', async () => {
    await openAthlete();
    expect(screen.getAllByText('Change')).toHaveLength(1);
    expect(screen.getAllByText('Add a correction')).toHaveLength(1);
  });

  it('opens Change with the observation, and a correction with the one it corrects', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openAthlete();
    await press('Change');
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/assessments/observe',
      params: { round: 'r1', athlete: 'a1', id: 'o3' },
    });
    await openAthlete();
    await press('Add a correction');
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/assessments/observe',
      params: { round: 'r1', athlete: 'a1', corrects: 'o2' },
    });
    await openAthlete();
    await press('Add an observation');
    expect(push).toHaveBeenLastCalledWith({ pathname: '/assessments/observe', params: { round: 'r1', athlete: 'a1' } });
    push.mockRestore();
  });

  it('says which observation a correction corrects', async () => {
    await openAthlete(
      assessment({
        observations: [
          observation({ id: 'o4', corrects_id: 'o1', observed_on: '2026-10-11' }),
          observation({ id: 'o5', corrects_id: 'gone', observed_on: '2026-10-13' }),
          observation(),
        ],
      }),
    );
    expect(screen.getByText(`Corrects the observation of ${d('2026-10-10')}`)).toBeTruthy();
    expect(screen.getByText('Corrects an earlier observation')).toBeTruthy();
  });

  it('starts an athlete with nothing written on how little is needed', async () => {
    await openAthlete(assessment({ observations: [], athlete_name: null }));
    expect(screen.getByText('Athlete')).toBeTruthy();
    expect(screen.getByText(/2027 selection phase · nothing written yet/)).toBeTruthy();
    expect(screen.getByText(/A line after training or a game is enough/)).toBeTruthy();
    expect(screen.queryByText('The picture so far')).toBeNull();
    await press('Add an observation');
    expect(screen.getByText('screen:assessments/observe')).toBeTruthy();
  });

  it('takes nothing more once the round is closed', async () => {
    await openAthlete(assessment({ closed: true }));
    expect(screen.getByText(/2027 selection phase · closed/)).toBeTruthy();
    expect(screen.queryByText('Add an observation')).toBeNull();
    expect(screen.queryByText('Add a correction')).toBeNull();
  });

  it('shows the database’s refusal, such as a parent opening their own child', async () => {
    await openAthlete(assessment(), { rpcErrors: { athlete_assessment: 'You can’t assess your own child' } });
    expect(screen.getByText('You can’t assess your own child')).toBeTruthy();
    expect(screen.queryByText('Jordan Junior')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adding an observation

describe('adding an observation', () => {
  async function openObserve(query = '', loaded: AthleteAssessment = assessment(), options: BackendOptions = {}) {
    await openScreen('coach', { index: placeholder('index'), 'assessments/observe': ObserveScreen }, '/', {}, {
      rpcs: { athlete_assessment: loaded },
      ...options,
    });
    await pushTo(`/assessments/observe?round=r1&athlete=a1${query}`);
    await settle();
  }

  it('starts on training, today, with every group closed', async () => {
    await openObserve();
    expect(onlyRpcCall('athlete_assessment')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
    expect(screen.getByText(d(TODAY))).toBeTruthy();
    expect(screen.getByText('Passing, Catching')).toBeTruthy();
    expect(screen.queryByText('Seen, not rated')).toBeNull();
    expect(screen.getByText(/A worry about a child’s safety doesn’t go here/)).toBeTruthy();
  });

  it('sends where, when, the steps chosen and the evidence, then goes back', async () => {
    await openObserve();
    await press('Game');
    await press('Yesterday');
    await press('Technical ability');
    await press('Exceeds standard', 0);
    await press('Seen, not rated', 1);
    await fireEvent.changeText(screen.getByPlaceholderText(/What you saw/), 'Won three intercepts');
    await press('Add observation');
    expect(onlyRpcCall('save_assessment_observation')).toEqual({
      p_id: null,
      p_round_id: 'r1',
      p_athlete_id: 'a1',
      p_context: 'game',
      p_observed_on: '2026-10-17',
      p_note: 'Won three intercepts',
      p_ratings: [
        { item_key: 'passing', rating: 3 },
        { item_key: 'catching', rating: null },
      ],
      p_corrects_id: null,
    });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('counts the criteria chosen on a group, and a second tap on a step takes it off', async () => {
    await openObserve();
    await press('Technical ability');
    await press('Meets standard', 0);
    expect(screen.getByText('Technical ability (1)')).toBeTruthy();
    await press('Meets standard', 0);
    expect(screen.getByText('Technical ability')).toBeTruthy();
    await press('Tap to close');
    expect(screen.getByText('Passing, Catching')).toBeTruthy();
  });

  it('uses each group’s own scale', async () => {
    await openObserve();
    await press('Coachability');
    expect(screen.getByText('Developing')).toBeTruthy();
    expect(screen.queryByText('Below standard')).toBeNull();
  });

  it('saves nothing without one of the criteria', async () => {
    await openObserve();
    await fireEvent.changeText(screen.getByPlaceholderText(/What you saw/), 'Good session');
    await press('Add observation');
    expect(screen.getByText('Choose at least one of the criteria.')).toBeTruthy();
    expect(rpcCalls('save_assessment_observation')).toEqual([]);
  });

  it('saves nothing that is seen but neither rated nor described', async () => {
    await openObserve();
    await press('Team focus');
    await press('Seen, not rated');
    await press('Add observation');
    expect(screen.getByText('Write what you saw, or rate at least one of the criteria.')).toBeTruthy();
    expect(rpcCalls('save_assessment_observation')).toEqual([]);
  });

  it('shows the database’s refusal and stays on the screen', async () => {
    await openObserve('', assessment(), { rpcErrors: { save_assessment_observation: 'This round is closed' } });
    await press('Team focus');
    await press('Meets standard');
    await press('Add observation');
    expect(screen.getByText('This round is closed')).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });

  it('opens one of the member’s own filled in, with its groups open, and saves it under its id', async () => {
    await openObserve('&id=o3');
    expect(screen.getByDisplayValue('Listened and changed her footwork')).toBeTruthy();
    expect(screen.getByText(d('2026-10-17'))).toBeTruthy();
    expect(screen.getByText('Technical ability (1)')).toBeTruthy();
    expect(screen.getByText('Coachability (1)')).toBeTruthy();
    expect(screen.getAllByText('Tap to close')).toHaveLength(2);
    await press('Save');
    expect(onlyRpcCall('save_assessment_observation')).toMatchObject({
      p_id: 'o3',
      p_context: 'training',
      p_observed_on: '2026-10-17',
      p_note: 'Listened and changed her footwork',
      p_ratings: [
        { item_key: 'accepts-feedback', rating: 2 },
        { item_key: 'catching', rating: null },
      ],
      p_corrects_id: null,
    });
  });

  it('removes the member’s own only after they confirm', async () => {
    await openObserve('&id=o3');
    await press('Remove');
    expect(rpcCalls('delete_assessment_observation')).toEqual([]);
    expect(screen.getByText(/until the end of the day after you wrote it/)).toBeTruthy();
    await press('Remove observation');
    expect(onlyRpcCall('delete_assessment_observation')).toEqual({ p_id: 'o3' });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('shows why an observation couldn’t be removed', async () => {
    await openObserve('&id=o3', assessment(), {
      rpcErrors: { delete_assessment_observation: 'This observation is locked. Add a correction instead' },
    });
    await press('Remove');
    await press('Remove observation');
    expect(screen.getByText('This observation is locked. Add a correction instead')).toBeTruthy();
  });

  it('offers no Remove on a new observation', async () => {
    await openObserve();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('adds a correction beside the original, naming it', async () => {
    await openObserve('&corrects=o2');
    expect(screen.getByText(new RegExp(`A correction to your observation of ${d('2026-10-12')}`))).toBeTruthy();
    await press('Technical ability');
    await press('Below standard', 0);
    await press('Add correction');
    expect(onlyRpcCall('save_assessment_observation')).toMatchObject({
      p_id: null,
      p_corrects_id: 'o2',
      p_observed_on: TODAY,
      p_note: '',
      p_ratings: [{ item_key: 'passing', rating: 1 }],
    });
  });

  it('shows the database’s refusal when the athlete can’t be opened', async () => {
    await openObserve('', assessment(), { rpcErrors: { athlete_assessment: 'Only the round’s panel can open it' } });
    expect(screen.getByText('Only the round’s panel can open it')).toBeTruthy();
    expect(screen.queryByText('Add observation')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Administration > Selection assessments

function panelMember(extra: Partial<PanelMember> = {}): PanelMember {
  return {
    profile_id: 'c1',
    name: 'Casey Coach',
    added_at: '2026-10-05T01:00:00Z',
    added_by_name: 'Sample admin',
    removed_at: null,
    removed_by_name: null,
    declared_conflict: false,
    can_assess: true,
    own_children: 0,
    ...extra,
  };
}

function adminRound(extra: Partial<AdminRound> = {}): AdminRound {
  return {
    id: 'r1',
    team_id: 't1',
    team_name: '17 & Under squad',
    season: 2027,
    name: '2027 selection phase',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed_at: null,
    created_at: '2026-10-04T01:00:00Z',
    athletes: 14,
    observations: 22,
    panel: [
      panelMember(),
      panelMember({ profile_id: 'c2', name: 'Morgan Coach-Parent', own_children: 1, declared_conflict: true, added_by_name: null }),
      panelMember({ profile_id: 'c3', name: 'Drew Lapsed', removed_at: '2026-10-12T01:00:00Z', removed_by_name: 'Sample admin' }),
    ],
    ...extra,
  };
}

describe('Administration > Selection assessments', () => {
  async function openAdmin(rpcs: BackendOptions['rpcs'] = {}, options: BackendOptions = {}) {
    await openScreen(
      'admin',
      {
        'admin/assessments/index': AdminAssessmentsScreen,
        'admin/assessments/criteria': placeholder('admin/assessments/criteria'),
        'admin/assessments/round': placeholder('admin/assessments/round'),
      },
      '/admin/assessments',
      {},
      { rpcs: { admin_assessment_criteria: CRITERIA, admin_selection_rounds: [adminRound()], ...rpcs }, ...options },
    );
  }

  it('tells the admin they set it up and audit it, and don’t read assessments', async () => {
    await openAdmin();
    expect(screen.getByText(/Only a round’s panel reads them/)).toBeTruthy();
    expect(screen.getByText(/shows how the work was done, not what was said/)).toBeTruthy();
  });

  it('sums up the criteria and each round as counts', async () => {
    await openAdmin({
      admin_selection_rounds: [adminRound(), adminRound({ id: 'r0', name: '2026 selection phase', closed_at: '2026-02-01T00:00:00Z' })],
    });
    expect(screen.getByText('3 groups, 4 items')).toBeTruthy();
    expect(screen.getAllByText('2 selectors on the panel · 14 athletes · 22 observations')).toHaveLength(2);
    expect(screen.getByText('2026 selection phase (closed)')).toBeTruthy();
    expect(assessmentRpcs().sort()).toEqual(['admin_assessment_criteria', 'admin_selection_rounds']);
  });

  it('asks for the criteria first, and offers no round until they exist', async () => {
    await openAdmin({ admin_assessment_criteria: null, admin_selection_rounds: null });
    expect(screen.getByText('Not set up yet')).toBeTruthy();
    expect(screen.getByText(/Set up the assessment criteria first/)).toBeTruthy();
    expect(screen.queryByText('Open a selection round')).toBeNull();
  });

  it('says there are no rounds yet once the criteria exist', async () => {
    await openAdmin({ admin_selection_rounds: [] });
    expect(screen.getByText(/No rounds yet. Open one for a squad or team/)).toBeTruthy();
  });

  it('reads both again on pull to refresh', async () => {
    await openAdmin();
    await pullToRefresh();
    expect(assessmentRpcs().sort()).toEqual([
      'admin_assessment_criteria',
      'admin_assessment_criteria',
      'admin_selection_rounds',
      'admin_selection_rounds',
    ]);
  });

  it.each([
    ['Assessment criteria', 'admin/assessments/criteria'],
    ['Open a selection round', 'admin/assessments/round'],
    ['2027 selection phase', 'admin/assessments/round'],
  ])('%s opens %s', async (title, route) => {
    await openAdmin();
    await press(title);
    expect(screen.getByText(`screen:${route}`)).toBeTruthy();
  });

  it.each(['admin_assessment_criteria', 'admin_selection_rounds'])('shows the database’s refusal of %s', async (fn) => {
    await openAdmin({}, { rpcErrors: { [fn]: 'Only admins can set up selection assessments' } });
    expect(screen.getByText('Only admins can set up selection assessments')).toBeTruthy();
  });
});

describe('the assessment criteria', () => {
  async function openCriteria(saved: unknown = null, options: BackendOptions = {}) {
    await openScreen('admin', { index: placeholder('index'), 'admin/assessments/criteria': AdminCriteriaScreen }, '/', {}, {
      rpcs: { admin_assessment_criteria: saved },
      ...options,
    });
    await pushTo('/admin/assessments/criteria');
    await settle();
  }

  it('offers a club with none the netball example or a blank start, and no Save yet', async () => {
    await openCriteria();
    expect(screen.getByText('Start from the netball example')).toBeTruthy();
    expect(screen.getByText('Start blank')).toBeTruthy();
    expect(screen.queryByText('Save criteria')).toBeNull();
  });

  it('saves the netball example as it stands', async () => {
    await openCriteria();
    await press('Start from the netball example');
    expect(screen.getByDisplayValue('Technical ability')).toBeTruthy();
    expect(screen.getByDisplayValue('Team-first behaviour')).toBeTruthy();
    await press('Save criteria');
    expect(onlyRpcCall('admin_save_assessment_criteria')).toEqual({ p_criteria: starterCriteria() });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('builds criteria from blank: a group, its steps and items', async () => {
    await openCriteria();
    await press('Start blank');
    await press('Save criteria');
    expect(screen.getByText('Name each group.')).toBeTruthy();
    expect(rpcCalls('admin_save_assessment_criteria')).toEqual([]);

    await fill('Group 1', 'Attitude');
    await fill('Lowest step (group 1)', 'Emerging');
    await fill('Item 1 (group 1)', 'Effort');
    await press('Add an item to Attitude');
    await fill('Item 2 (group 1)', 'Respect');
    await press('Save criteria');
    expect(onlyRpcCall('admin_save_assessment_criteria')).toEqual({
      p_criteria: {
        groups: [
          {
            key: 'group',
            name: 'Attitude',
            scale: ['Emerging', 'Meets standard', 'Exceeds standard'],
            items: [
              { key: 'item', name: 'Effort' },
              { key: 'item-2', name: 'Respect' },
            ],
          },
        ],
      },
    });
  });

  it('opens the saved criteria, and removes an item and a group', async () => {
    await openCriteria(CRITERIA);
    expect(screen.queryByText('Start blank')).toBeNull();
    expect(screen.getByDisplayValue('Accepts feedback')).toBeTruthy();
    // Only a group with more than one item can lose one.
    expect(screen.getAllByText(/^Remove the last item from/)).toHaveLength(1);
    await press('Remove the last item from Technical ability');
    expect(screen.queryByDisplayValue('Catching')).toBeNull();
    await press('Remove Team focus');
    await press('Add a group');
    await fill('Group 3', 'Fitness');
    await fill('Item 1 (group 3)', 'Speed');
    await press('Save criteria');
    const saved = onlyRpcCall('admin_save_assessment_criteria').p_criteria as typeof CRITERIA;
    expect(saved.groups.map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['Technical ability', ['Passing']],
      ['Coachability', ['Accepts feedback']],
      ['Fitness', ['Speed']],
    ]);
    // Keys already used stay as they were, so earlier rounds still read them.
    expect(saved.groups[0].key).toBe('technical-ability');
    expect(saved.groups[0].items[0].key).toBe('passing');
  });

  it('names an unnamed group by its number on its buttons', async () => {
    await openCriteria();
    await press('Start blank');
    expect(screen.getByText('Add an item to group 1')).toBeTruthy();
    expect(screen.getByText('Remove group 1')).toBeTruthy();
    await press('Remove group 1');
    expect(screen.getByText('Start blank')).toBeTruthy();
  });

  it('shows the database’s refusal and stays on the screen', async () => {
    await openCriteria(CRITERIA, { rpcErrors: { admin_save_assessment_criteria: 'Only admins can change the criteria' } });
    await press('Save criteria');
    expect(screen.getByText('Only admins can change the criteria')).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });

  it('shows why the criteria couldn’t load', async () => {
    await openCriteria(null, { rpcErrors: { admin_assessment_criteria: 'Selection assessments are off' } });
    expect(screen.getByText('Selection assessments are off')).toBeTruthy();
  });
});

const TEAMS = [
  { id: 't1', name: '17 & Under squad', sort_order: 1, kind: 'squad', season: 2027, squad_id: null, selections_completed_at: null },
  { id: 't2', name: 'Open A', sort_order: 2, kind: 'team', season: 2027, squad_id: null, selections_completed_at: null },
];

/** The day's square in the nth month calendar on screen (Starts, then Ends). */
const pickDay = async (calendar: number, year: number, month: number, day: number) => {
  await fireEvent.press(screen.getAllByLabelText(new Date(year, month - 1, day).toDateString())[calendar]);
  await settle(2);
};

describe('opening a selection round', () => {
  async function openNew(options: BackendOptions = {}) {
    await openScreen('admin', { index: placeholder('index'), 'admin/assessments/round': AdminRoundScreen }, '/', { teams: TEAMS }, options);
    await pushTo('/admin/assessments/round');
    await settle();
  }

  it('explains what a round copies and who starts on its panel', async () => {
    await openNew();
    expect(screen.getByText(/It takes a copy of the criteria as they are now/)).toBeTruthy();
    expect(screen.getByText(/coaches who hold a current Working With Children Check/)).toBeTruthy();
    expect(screen.queryByText('Panel')).toBeNull();
    expect(rpcNames()).not.toContain('admin_selection_rounds');
  });

  it('names everything still to choose, and sends nothing', async () => {
    await openNew();
    await press('Open round');
    expect(screen.getByText('Choose a squad or team, a name, a start date, an end date.')).toBeTruthy();
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
  });

  it('refuses a round that ends before it starts', async () => {
    await openNew();
    await press('17 & Under squad');
    await fill('Name', '2027 selection phase');
    await pickDay(0, 2026, 10, 20);
    await pickDay(1, 2026, 10, 19);
    await press('Open round');
    expect(screen.getByText('The round ends before it starts.')).toBeTruthy();
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
  });

  it('opens the round for the group with its name and dates, then goes back', async () => {
    await openNew();
    await press('17 & Under squad');
    await fill('Name', '2027 selection phase');
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 30);
    await press('Open round');
    expect(onlyRpcCall('admin_open_selection_round')).toEqual({
      p_team_id: 't1',
      p_name: '2027 selection phase',
      p_starts_on: '2026-10-19',
      p_ends_on: '2026-10-30',
    });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('shows the database’s refusal, such as a group that already has an open round', async () => {
    await openNew({ rpcErrors: { admin_open_selection_round: 'This squad already has an open round' } });
    await press('Open A');
    await fill('Name', 'Trials');
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 19);
    await press('Open round');
    expect(screen.getByText('This squad already has an open round')).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });
});

describe('a round and its panel, for an admin', () => {
  const CHOICES = [
    { profile_id: 'g1', name: 'Indy Independent', roles: ['guest'], cleared: true },
    { profile_id: 'g2', name: 'Nico Nocheck', roles: ['coach'], cleared: false },
    { profile_id: 'g3', name: null, roles: ['admin'], cleared: true },
  ];

  async function openRound(round: AdminRound | null = adminRound(), options: BackendOptions = {}) {
    await openScreen(
      'admin',
      { 'admin/assessments/round': AdminRoundScreen, 'admin/assessments/audit': placeholder('admin/assessments/audit') },
      '/admin/assessments/round?id=r1',
      { teams: TEAMS },
      { rpcs: { admin_selection_rounds: round ? [round] : [], admin_selection_panel_choices: CHOICES }, ...options },
    );
  }

  it('shows counts for the round, never an assessment', async () => {
    await openRound();
    expect(screen.getByText('17 & Under squad · 14 athletes · 22 observations')).toBeTruthy();
    expect(screen.getByDisplayValue('2027 selection phase')).toBeTruthy();
    expect(screen.queryByText('Squad or team')).toBeNull();
    expect(rpcNames()).not.toContain('athlete_assessment');
    expect(rpcNames()).not.toContain('selection_round_sheet');
  });

  it('counts one athlete and one observation in the singular, and says when it closed', async () => {
    await openRound(adminRound({ athletes: 1, observations: 1, closed_at: '2026-10-15T03:00:00Z' }));
    expect(screen.getByText(`17 & Under squad · 1 athlete · 1 observation · closed ${d('2026-10-15')}`)).toBeTruthy();
  });

  it('lists the panel with who added each, and what the admin should know', async () => {
    await openRound();
    expect(screen.getByText(`Added ${d('2026-10-05')} by Sample admin`)).toBeTruthy();
    expect(screen.getByText(`Added ${d('2026-10-05')}`)).toBeTruthy();
    expect(screen.getByText('Declared a conflict of interest this season')).toBeTruthy();
    expect(screen.getByText('Can’t assess 1 athlete in this round: their own child')).toBeTruthy();
    expect(screen.getByText(/Nobody on it can assess their own child/)).toBeTruthy();
  });

  it('keeps who has left the panel, with who removed them', async () => {
    await openRound();
    expect(screen.getByText('No longer on the panel')).toBeTruthy();
    expect(
      screen.getByText(`Drew Lapsed: added ${d('2026-10-05')}, removed ${d('2026-10-12')} by Sample admin`),
    ).toBeTruthy();
    expect(screen.queryByText('Take Drew Lapsed off the panel')).toBeNull();
  });

  it('says when nobody is on the panel, and shows no list of leavers when none have left', async () => {
    await openRound(adminRound({ panel: [] }));
    expect(screen.getByText('Nobody is on the panel.')).toBeTruthy();
    expect(screen.queryByText('No longer on the panel')).toBeNull();
  });

  it('offers no removal for a panel member whose account is gone', async () => {
    await openRound(adminRound({ panel: [panelMember({ profile_id: null, name: 'Former Coach' })] }));
    expect(screen.getByText('Former Coach')).toBeTruthy();
    expect(screen.queryByText(/^Take .* off the panel$/)).toBeNull();
  });

  it('takes a selector off the panel', async () => {
    await openRound();
    await press('Take Casey Coach off the panel');
    expect(onlyRpcCall('admin_remove_selection_panel_member')).toEqual({ p_round_id: 'r1', p_profile_id: 'c1' });
    expect(rpcCalls('admin_selection_rounds')).toHaveLength(2);
  });

  it('offers only people with a current check as selectors, and adds one', async () => {
    await openRound();
    expect(rpcNames()).not.toContain('admin_selection_panel_choices');
    await press('Add a selector');
    expect(onlyRpcCall('admin_selection_panel_choices')).toEqual({ p_round_id: 'r1' });
    expect(screen.getByText('Add Indy Independent')).toBeTruthy();
    expect(screen.getByText('Add Member')).toBeTruthy();
    expect(screen.getByText('Nico Nocheck: needs a current Working With Children Check first')).toBeTruthy();
    expect(screen.queryByText('Add Nico Nocheck')).toBeNull();
    expect(screen.getByText(/A guest is how you add an independent selector/)).toBeTruthy();
    await press('Add Indy Independent');
    expect(onlyRpcCall('admin_add_selection_panel_member')).toEqual({ p_round_id: 'r1', p_profile_id: 'g1' });
    // The list closes, so it is read again next time.
    expect(screen.getByText('Add a selector')).toBeTruthy();
    expect(screen.queryByText('Add Indy Independent')).toBeNull();
  });

  it('says when there is nobody else to add, and names someone without a name or a check as Member', async () => {
    await openRound(adminRound(), { rpcs: { admin_selection_rounds: [adminRound()], admin_selection_panel_choices: null } });
    await press('Add a selector');
    expect(screen.getByText('There is nobody else to add.')).toBeTruthy();
    await openRound(adminRound(), {
      rpcs: {
        admin_selection_rounds: [adminRound()],
        admin_selection_panel_choices: [{ profile_id: 'g4', name: null, roles: ['guest'], cleared: false }],
      },
    });
    await press('Add a selector');
    expect(screen.getByText('Member: needs a current Working With Children Check first')).toBeTruthy();
  });

  it.each([
    ['admin_selection_panel_choices', 'Add a selector'],
    ['admin_remove_selection_panel_member', 'Take Casey Coach off the panel'],
    ['admin_close_selection_round', 'Close the round'],
  ])('shows the database’s refusal of %s', async (fn, button) => {
    await openRound(adminRound(), { rpcErrors: { [fn]: 'Only admins can change a selection round' } });
    await press(button);
    expect(screen.getByText('Only admins can change a selection round')).toBeTruthy();
  });

  it('saves a changed name and dates under the round’s id, and says so', async () => {
    await openRound();
    await fill('Name', '2027 trials');
    await pickDay(0, 2026, 10, 6);
    await press('Save');
    expect(onlyRpcCall('admin_save_selection_round')).toEqual({
      p_round_id: 'r1',
      p_name: '2027 trials',
      p_starts_on: '2026-10-06',
      p_ends_on: '2026-11-29',
    });
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('won’t save a round with no name', async () => {
    await openRound();
    await fill('Name', '  ');
    await press('Save');
    expect(screen.getByText('Choose a name.')).toBeTruthy();
    expect(rpcCalls('admin_save_selection_round')).toEqual([]);
  });

  it('shows why a save was refused', async () => {
    await openRound(adminRound(), { rpcErrors: { admin_save_selection_round: 'The round can’t start after its first observation' } });
    await press('Save');
    expect(screen.getByText('The round can’t start after its first observation')).toBeTruthy();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('closes an open round', async () => {
    await openRound();
    expect(screen.getByText(/Close the round once the teams are named/)).toBeTruthy();
    await press('Close the round');
    expect(onlyRpcCall('admin_close_selection_round')).toEqual({ p_round_id: 'r1', p_closed: true });
  });

  it('opens a closed round again', async () => {
    await openRound(adminRound({ closed_at: '2026-10-15T03:00:00Z' }));
    expect(screen.getByText(/This round is closed: the panel can still read it/)).toBeTruthy();
    await press('Open the round again');
    expect(onlyRpcCall('admin_close_selection_round')).toEqual({ p_round_id: 'r1', p_closed: false });
  });

  it('opens the audit report', async () => {
    await openRound();
    await press('Selection audit report');
    expect(screen.getByText('screen:admin/assessments/audit')).toBeTruthy();
  });

  it('says when the round can’t be found, or why it couldn’t load', async () => {
    await openRound(null);
    expect(screen.getByText('This round can’t be found.')).toBeTruthy();
    await openRound(adminRound(), { rpcErrors: { admin_selection_rounds: 'Only admins can see selection rounds' } });
    expect(screen.getByText('Only admins can see selection rounds')).toBeTruthy();
    expect(screen.queryByText('Panel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The Selection audit report

describe('the Selection audit report', () => {
  const AUDIT: SelectionAudit = {
    round: {
      id: 'r1',
      name: '2027 selection phase',
      team_name: '17 & Under squad',
      season: 2027,
      starts_on: '2026-10-05',
      ends_on: '2026-11-29',
      opened_at: '2026-10-04T01:00:00Z',
      opened_by_name: 'Sample admin',
      closed_at: null,
      closed_by_name: null,
      criteria_groups: 3,
      criteria_items: 4,
      athletes: 2,
      observations: 4,
      today: TODAY,
    },
    panel: [panelMember(), panelMember({ profile_id: 'c2', name: 'Sam Selector', declared_conflict: true })],
    selectors: [
      {
        name: 'Casey Coach',
        on_panel: true,
        observations: 4,
        athletes_covered: 1,
        groups_covered: 2,
        first_on: '2026-10-06',
        last_on: '2026-10-17',
        weeks_active: 2,
        training: 3,
        game: 1,
        trial: 0,
        other: 0,
        without_evidence: 1,
        written_late: 0,
        corrections: 0,
      },
      {
        name: 'Sam Selector',
        on_panel: true,
        observations: 0,
        athletes_covered: 0,
        groups_covered: 0,
        first_on: null,
        last_on: null,
        weeks_active: 0,
        training: 0,
        game: 0,
        trial: 0,
        other: 0,
        without_evidence: 0,
        written_late: 0,
        corrections: 0,
      },
    ],
    athletes: [
      { name: 'Jordan Junior', is_minor: true, observations: 4, selectors: 1, groups_covered: 2, last_observed_on: '2026-10-17' },
      { name: 'Kai Senior', is_minor: false, observations: 0, selectors: 0, groups_covered: 0, last_observed_on: null },
    ],
  };

  async function openAudit(options: BackendOptions = {}) {
    await openScreen('admin', { 'admin/assessments/audit': AdminAuditScreen }, '/admin/assessments/audit?id=r1', {}, {
      rpcs: { admin_selection_audit: AUDIT },
      ...options,
    });
  }

  it('asks for the round’s audit and nothing that holds an assessment', async () => {
    await openAudit();
    // The round's dates come with it: titles, days and who marked them done.
    // And who has signed their summaries: names, counts and dates.
    expect(assessmentRpcs()).toEqual([
      'admin_selection_audit',
      'admin_selection_milestones',
      'admin_selection_summaries',
    ]);
    expect(onlyRpcCall('admin_selection_audit')).toEqual({ p_round_id: 'r1' });
    expect(onlyRpcCall('admin_selection_milestones')).toEqual({ p_round_id: 'r1' });
  });

  it('builds the report again on pull to refresh', async () => {
    await openAudit();
    await pullToRefresh();
    expect(rpcCalls('admin_selection_audit')).toHaveLength(2);
  });

  it('shows the round, the panel, what each selector wrote and the evidence about each athlete', async () => {
    await openAudit();
    for (const title of ['The round', 'Dates', 'The panel', 'What each selector wrote', 'Evidence about each athlete']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText('Jordan Junior (under 18)')).toBeTruthy();
    expect(screen.getByText(/3 \/ 1 \/ 0 \/ 0/)).toBeTruthy();
    expect(screen.getByText(/Declared a conflict of interest this season/)).toBeTruthy();
    expect(screen.getByText(/it holds no ratings, evidence, recommendations or names of criteria/)).toBeTruthy();
    expect(screen.getByText(/1 panel member has written nothing yet/)).toBeTruthy();
  });

  it('exports the same report as a landscape PDF, with no rating or criterion in it', async () => {
    await openAudit();
    await fireEvent.press(screen.getByText('Export PDF'));
    await settle();
    expect(written).toHaveLength(1);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(written[0].uri, expect.objectContaining({ mimeType: 'application/pdf' }));
    const pdf = readPdf(written[0].bytes);
    expect(pdf.pages[0].width).toBeGreaterThan(pdf.pages[0].height);
    expect(pdf.text).toContain('Selection audit report');
    expect(pdf.text).toContain('2027 selection phase');
    expect(pdf.text).toContain('Casey Coach');
    expect(pdf.text).toContain('Kai Senior');
    expect(pdf.text).not.toMatch(/Meets standard|Exceeds standard|Below standard|Passing|Coachability/);
  });

  it('shows the database’s refusal and no report', async () => {
    await openAudit({ rpcErrors: { admin_selection_audit: 'Only admins can build the audit report' } });
    expect(screen.getByText('Only admins can build the audit report')).toBeTruthy();
    expect(screen.queryByText('Export PDF')).toBeNull();
  });
});
