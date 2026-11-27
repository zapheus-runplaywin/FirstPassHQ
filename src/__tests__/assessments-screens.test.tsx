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
import { act, fireEvent, screen, within } from 'expo-router/testing-library';
import { Text } from 'react-native';
import * as Sharing from 'expo-sharing';

import AdminAuditScreen from '@/app/admin/assessments/audit';
import AdminRoundScreen from '@/app/admin/assessments/round';
import AthleteAssessmentScreen from '@/app/assessments/athlete';
import AssessmentsScreen from '@/app/assessments/index';
import ObserveScreen from '@/app/assessments/observe';
import RoundScreen from '@/app/assessments/round';
import ClubHubScreen from '@/app/(tabs)/club';
import TodayScreen from '@/app/(tabs)/index';
import MeScreen from '@/app/(tabs)/me';
import TeamHubScreen from '@/app/(tabs)/team';
import {
  makeCriteria,
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
  inTabs,
  openScreen,
  refreshControl,
  resetClub,
  setClubFeatures,
  settle,
  type BackendOptions,
  type Persona,
  type PersonaName,
} from './helpers/harness';

/** Today, with what the tabs share loaded around it. */
const HomeScreen = inTabs(TodayScreen);

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

  it('shows a coach on one panel their round, and opens it without a list in between', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openHome('coach', [myRound()]);
    expect(screen.getByText('Selection assessments')).toBeTruthy();
    expect(screen.getByText('2027 selection phase · 14 athletes')).toBeTruthy();
    await press('Selection assessments');
    expect(push).toHaveBeenLastCalledWith({ pathname: '/assessments/round', params: { id: 'r1' } });
    push.mockRestore();
  });

  it('opens the list of rounds for a coach on more than one panel', async () => {
    await openHome('coach', [myRound(), myRound({ id: 'r2', name: 'Open squad selections' })]);
    await press('Selection assessments');
    expect(screen.getByText('screen:assessments/index')).toBeTruthy();
  });

  it('keeps the card with a coach’s squads in Team too, and in Club for an admin on a panel', async () => {
    const rpcs = { my_selection_rounds: [myRound()] };
    await openScreen('coach', { team: inTabs(TeamHubScreen) }, '/team', {}, { rpcs });
    expect(screen.getByText('Selection assessments')).toBeTruthy();
    expect(screen.getByText('2027 selection phase · 14 athletes')).toBeTruthy();
    await openScreen('admin', { club: inTabs(ClubHubScreen) }, '/club', {}, { rpcs });
    // An admin's Club tab is in areas: the card is in Season, which opens where it is.
    expect(screen.queryByText('Selection assessments')).toBeNull();
    const season = within(screen.getByTestId('club-area-season'));
    await fireEvent.press(season.getAllByRole('button')[0]);
    expect(season.getByText('Selection assessments')).toBeTruthy();
    expect(season.getByText('2027 selection phase · 14 athletes')).toBeTruthy();
  });

  it('has no copy in Me, which is for the member’s own things', async () => {
    await openScreen('coach', { me: inTabs(MeScreen) }, '/me', {}, {
      rpcs: { my_selection_rounds: [myRound()] },
    });
    expect(screen.queryByText('Selection assessments')).toBeNull();
  });

  it('shows nothing in Team to a coach who is on no panel', async () => {
    await openScreen('coach', { team: inTabs(TeamHubScreen) }, '/team', {}, {
      rpcs: { my_selection_rounds: [] },
    });
    expect(screen.queryByText('Selection assessments')).toBeNull();
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
    expect(screen.getAllByText('17 & Under squad · 5 Oct to 29 Nov')).toHaveLength(2);
    expect(screen.getByText('14 athletes · you have written 3 observations')).toBeTruthy();
    expect(screen.getByText('2026 selection phase (closed)')).toBeTruthy();
    expect(screen.getByText('1 athlete · you have written 1 observation')).toBeTruthy();
  });

  it('puts running rounds first, then coming up with when it starts and no + yet, then finished', async () => {
    await openRounds([
      myRound({ id: 'r0', name: 'Old', closed_at: '2026-02-01T00:00:00Z' }),
      myRound({ id: 'r2', name: 'Phase 1, Round 3', phase: 1, round_number: 3, starts_on: '2026-12-01', ends_on: '2027-01-31', criteria_set_name: 'Junior criteria' }),
      myRound({ phase: 1, round_number: 2, name: 'Trials', criteria_set_name: 'Senior criteria' }),
    ]);
    const titles = screen.getAllByText(/^(Phase 1, Round \d.*|Old \(closed\))$/).map((n) => n.props.children);
    expect(titles.map((t: unknown) => (Array.isArray(t) ? t.join('') : t))).toEqual([
      'Phase 1, Round 2 · Trials',
      'Phase 1, Round 3',
      'Old (closed)',
    ]);
    expect(screen.getByText('Senior criteria')).toBeTruthy();
    expect(screen.getByText('Junior criteria')).toBeTruthy();
    expect(screen.getByText('Starts Tue 1 Dec')).toBeTruthy();
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

  it('heads the round with its phase, group, dates and criteria, and hides + until it starts', async () => {
    await openRound(sheet({ phase: 1, round_number: 2, name: 'Trials', criteria_set_name: 'Senior criteria', starts_on: '2026-12-01', ends_on: '2027-01-31' }));
    expect(screen.getByText('Phase 1, Round 2 · Trials')).toBeTruthy();
    expect(screen.getByText('17 & Under squad · 1 Dec to 31 Jan · Senior criteria')).toBeTruthy();
    expect(screen.getByText('Starts Tue 1 Dec')).toBeTruthy();
    expect(screen.queryByLabelText(/Add an observation about/)).toBeNull();
  });

  it('says how much is written about each athlete, and who has nothing yet or lately', async () => {
    await openRound();
    expect(screen.getByText('17 & Under squad · 5 Oct to 29 Nov')).toBeTruthy();
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

  it('opens on the picture, and shows the observations instead on their tab', async () => {
    await openAthlete();
    expect(screen.getByText('Observations (3)')).toBeTruthy();
    expect(screen.getByText('Nothing yet on: Team focus')).toBeTruthy();
    expect(screen.queryByText('Won three intercepts in the second quarter')).toBeNull();
    await press('Observations (3)');
    expect(screen.getByText('Won three intercepts in the second quarter')).toBeTruthy();
    expect(screen.queryByText('Nothing yet on: Team focus')).toBeNull();
    await press('The picture so far');
    expect(screen.getByText('Nothing yet on: Team focus')).toBeTruthy();
    expect(screen.queryByText('Won three intercepts in the second quarter')).toBeNull();
  });

  it('lists each observation with its day, where, who, criteria and evidence', async () => {
    await openAthlete();
    await press(/^Observations \(/);
    expect(screen.getByText(`${d('2026-10-17')} · Training · You`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-10')} · Game · Sam Selector`)).toBeTruthy();
    expect(screen.getByText('Accepts feedback: Meets standard')).toBeTruthy();
    expect(screen.getByText('Passing: Exceeds standard')).toBeTruthy();
    expect(screen.getByText('Won three intercepts in the second quarter')).toBeTruthy();
  });

  it('offers Change on the member’s own while it is open, a correction once locked, and nothing on others’', async () => {
    await openAthlete();
    await press(/^Observations \(/);
    expect(screen.getAllByText('Change')).toHaveLength(1);
    expect(screen.getAllByText('Add a correction')).toHaveLength(1);
  });

  it('opens Change with the observation, and a correction with the one it corrects', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openAthlete();
    await press(/^Observations \(/);
    await press('Change');
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/assessments/observe',
      params: { round: 'r1', athlete: 'a1', id: 'o3' },
    });
    await openAthlete();
    await press(/^Observations \(/);
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
    await press(/^Observations \(/);
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
    await press(/^Observations \(/);
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
    expect(screen.getByText(/A worry about a child’s safety is raised as a\s+concern from Today, not here\./)).toBeTruthy();
  });

  it('sends where, when, the steps chosen and the evidence, then goes back', async () => {
    await openObserve();
    await press('Game');
    await press('Yesterday');
    await press('Technical ability');
    await press('Exceeds standard', 0);
    await press('Seen, not rated', 1);
    await fireEvent.changeText(fieldLabelled('What you saw'), 'Won three intercepts');
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
    await fireEvent.changeText(fieldLabelled('What you saw'), 'Good session');
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

// The admins' list of rounds and criteria sets, a criteria set and opening a
// round are tested in criteria-sets-screens.test.tsx (criteria sets, 27 November 2026).

const TEAMS = [
  { id: 't1', name: '17 & Under squad', sort_order: 1, kind: 'squad', season: 2027, squad_id: null, selections_completed_at: null },
  { id: 't2', name: 'Open A', sort_order: 2, kind: 'team', season: 2027, squad_id: null, selections_completed_at: null },
];

/** The day's square in the nth month calendar on screen (Starts, then Ends). */
const pickDay = async (calendar: number, year: number, month: number, day: number) => {
  await fireEvent.press(screen.getAllByLabelText(new Date(year, month - 1, day).toDateString())[calendar]);
  await settle(2);
};

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
    await press('Details');
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
    await press(/^Panel \(/);
    expect(screen.getByText(`Added ${d('2026-10-05')} by Sample admin`)).toBeTruthy();
    expect(screen.getByText(`Added ${d('2026-10-05')}`)).toBeTruthy();
    expect(screen.getByText('Declared a conflict of interest this season')).toBeTruthy();
    expect(screen.getByText('Can’t assess 1 athlete in this round: their own child')).toBeTruthy();
    expect(screen.getByText(/Nobody on it can assess their own child/)).toBeTruthy();
  });

  it('keeps who has left the panel, with who removed them', async () => {
    await openRound();
    await press(/^Panel \(/);
    expect(screen.getByText('No longer on the panel')).toBeTruthy();
    expect(
      screen.getByText(`Drew Lapsed: added ${d('2026-10-05')}, removed ${d('2026-10-12')} by Sample admin`),
    ).toBeTruthy();
    expect(screen.queryByText('Take Drew Lapsed off the panel')).toBeNull();
  });

  it('says when nobody is on the panel, and shows no list of leavers when none have left', async () => {
    await openRound(adminRound({ panel: [] }));
    await press(/^Panel \(/);
    expect(screen.getByText('Nobody is on the panel.')).toBeTruthy();
    expect(screen.queryByText('No longer on the panel')).toBeNull();
  });

  it('offers no removal for a panel member whose account is gone', async () => {
    await openRound(adminRound({ panel: [panelMember({ profile_id: null, name: 'Former Coach' })] }));
    await press(/^Panel \(/);
    expect(screen.getByText('Former Coach')).toBeTruthy();
    expect(screen.queryByText(/^Take .* off the panel$/)).toBeNull();
  });

  it('takes a selector off the panel', async () => {
    await openRound();
    await press(/^Panel \(/);
    await press('Take Casey Coach off the panel');
    expect(onlyRpcCall('admin_remove_selection_panel_member')).toEqual({ p_round_id: 'r1', p_profile_id: 'c1' });
    expect(rpcCalls('admin_selection_rounds')).toHaveLength(2);
  });

  it('offers only people with a current check as selectors, and adds one', async () => {
    await openRound();
    await press(/^Panel \(/);
    expect(rpcNames()).not.toContain('admin_selection_panel_choices');
    await press('Add a selector');
    expect(onlyRpcCall('admin_selection_panel_choices')).toEqual({ p_round_id: 'r1' });
    // A guest and nothing else is how a club adds an independent selector, and is marked.
    expect(screen.getByText('Add Indy Independent (guest)')).toBeTruthy();
    expect(screen.queryByText('Add Indy Independent')).toBeNull();
    expect(screen.getByText('Add Member')).toBeTruthy();
    expect(screen.getByText('Nico Nocheck: needs a current Working With Children Check first')).toBeTruthy();
    expect(screen.queryByText('Add Nico Nocheck')).toBeNull();
    expect(screen.getByText(/For an independent selector, approve the person as a Guest and record their check/)).toBeTruthy();
    await press('Add Indy Independent (guest)');
    expect(onlyRpcCall('admin_add_selection_panel_member')).toEqual({ p_round_id: 'r1', p_profile_id: 'g1' });
    // The list closes, so it is read again next time.
    expect(screen.getByText('Add a selector')).toBeTruthy();
    expect(screen.queryByText('Add Indy Independent (guest)')).toBeNull();
  });

  it('marks nobody as a guest who also holds another role', async () => {
    await openRound(adminRound(), {
      rpcs: {
        admin_selection_rounds: [adminRound()],
        admin_selection_panel_choices: [
          { profile_id: 'g5', name: 'Gus Guestcoach', roles: ['guest', 'coach'], cleared: true },
          { profile_id: 'g6', name: 'Ada Admin', roles: ['admin'], cleared: true },
        ],
      },
    });
    await press(/^Panel \(/);
    await press('Add a selector');
    expect(screen.getByText('Add Gus Guestcoach')).toBeTruthy();
    expect(screen.getByText('Add Ada Admin')).toBeTruthy();
    expect(screen.queryByText(/\(guest\)$/)).toBeNull();
  });

  it('says which panel members are independent, on the panel and among those who left', async () => {
    await openRound(
      adminRound({
        panel: [
          panelMember(),
          panelMember({ profile_id: 'g1', name: 'Indy Independent', independent: true }),
          panelMember({ profile_id: 'g7', name: 'Olly Outside', independent: true, removed_at: '2026-10-12T01:00:00Z', removed_by_name: 'Sample admin' }),
          panelMember({ profile_id: 'c3', name: 'Drew Lapsed', removed_at: '2026-10-12T01:00:00Z', removed_by_name: 'Sample admin' }),
        ],
      }),
    );
    await press(/^Panel \(/);
    expect(screen.getAllByText('Independent: a guest with no other role in the club')).toHaveLength(1);
    expect(screen.getByText(new RegExp(`^Olly Outside \\(independent\\): added ${d('2026-10-05')}, removed`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Drew Lapsed: added ${d('2026-10-05')}, removed`))).toBeTruthy();
  });

  it('shows no independent note from a database not yet updated', async () => {
    await openRound();
    await press(/^Panel \(/);
    expect(screen.queryByText(/Independent/)).toBeNull();
    expect(screen.queryByText(/\(independent\)/)).toBeNull();
  });

  it('says when there is nobody else to add, and names someone without a name or a check as Member', async () => {
    await openRound(adminRound(), { rpcs: { admin_selection_rounds: [adminRound()], admin_selection_panel_choices: null } });
    await press(/^Panel \(/);
    await press('Add a selector');
    expect(screen.getByText('There is nobody else to add.')).toBeTruthy();
    await openRound(adminRound(), {
      rpcs: {
        admin_selection_rounds: [adminRound()],
        admin_selection_panel_choices: [{ profile_id: 'g4', name: null, roles: ['guest'], cleared: false }],
      },
    });
    await press(/^Panel \(/);
    await press('Add a selector');
    expect(screen.getByText('Member: needs a current Working With Children Check first')).toBeTruthy();
  });

  it.each([
    ['admin_selection_panel_choices', /^Panel \(/, 'Add a selector'],
    ['admin_remove_selection_panel_member', /^Panel \(/, 'Take Casey Coach off the panel'],
    ['admin_close_selection_round', 'Details', 'Close the round'],
  ])('shows the database’s refusal of %s', async (fn, tab, button) => {
    await openRound(adminRound(), { rpcErrors: { [fn]: 'Only admins can change a selection round' } });
    await press(tab);
    await press(button);
    expect(screen.getByText('Only admins can change a selection round')).toBeTruthy();
  });

  it('saves a changed name and dates under the round’s id, and says so', async () => {
    await openRound();
    await press('Details');
    await fill('Name', '2027 trials');
    await pickDay(0, 2026, 10, 6);
    await press('Save');
    expect(onlyRpcCall('admin_save_selection_round')).toEqual({
      p_round_id: 'r1',
      p_name: '2027 trials',
      p_starts_on: '2026-10-06',
      p_ends_on: '2026-11-29',
      p_phase: null,
      p_round_number: null,
    });
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('won’t save a round with no name', async () => {
    await openRound();
    await press('Details');
    await fill('Name', '  ');
    await press('Save');
    expect(screen.getByText('Choose a name.')).toBeTruthy();
    expect(rpcCalls('admin_save_selection_round')).toEqual([]);
  });

  it('shows why a save was refused', async () => {
    await openRound(adminRound(), { rpcErrors: { admin_save_selection_round: 'The round can’t start after its first observation' } });
    await press('Details');
    await press('Save');
    expect(screen.getByText('The round can’t start after its first observation')).toBeTruthy();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('closes an open round', async () => {
    await openRound();
    await press('Details');
    expect(screen.getByText(/Close the round once the teams are named/)).toBeTruthy();
    await press('Close the round');
    expect(onlyRpcCall('admin_close_selection_round')).toEqual({ p_round_id: 'r1', p_closed: true });
  });

  it('opens a closed round again', async () => {
    await openRound(adminRound({ closed_at: '2026-10-15T03:00:00Z' }));
    await press('Details');
    expect(screen.getByText(/This round is closed: the panel can still read it/)).toBeTruthy();
    await press('Open the round again');
    expect(onlyRpcCall('admin_close_selection_round')).toEqual({ p_round_id: 'r1', p_closed: false });
  });

  it('opens the audit report', async () => {
    await openRound();
    await press('Reports');
    await press('Selection audit report');
    expect(screen.getByText('screen:admin/assessments/audit')).toBeTruthy();
  });

  it('opens on its dates, with the panel, reports and details one tap away each', async () => {
    await openRound();
    expect(screen.getByText('Dates (0)')).toBeTruthy();
    expect(screen.getByText('Panel (2)')).toBeTruthy();
    expect(screen.getByText('Add a date')).toBeTruthy();
    // Nothing from the other tabs until it is asked for.
    expect(screen.queryByText('Take Casey Coach off the panel')).toBeNull();
    expect(screen.queryByText('Selection audit report')).toBeNull();
    expect(screen.queryByDisplayValue('2027 selection phase')).toBeNull();
    expect(screen.queryByText('Close the round')).toBeNull();
    await press('Panel (2)');
    expect(screen.getByText('Take Casey Coach off the panel')).toBeTruthy();
    expect(screen.queryByText('Add a date')).toBeNull();
    await press('Reports');
    expect(screen.getByText('Selection audit report')).toBeTruthy();
    expect(screen.queryByText('Take Casey Coach off the panel')).toBeNull();
    await press('Details');
    expect(screen.getByDisplayValue('2027 selection phase')).toBeTruthy();
    expect(screen.getByText('Close the round')).toBeTruthy();
    expect(screen.queryByText('Selection audit report')).toBeNull();
  });

  it('leaves a message on the tab it was about', async () => {
    await openRound(adminRound(), { rpcErrors: { admin_remove_selection_panel_member: 'Only admins can change a selection round' } });
    await press('Panel (2)');
    await press('Take Casey Coach off the panel');
    expect(screen.getByText('Only admins can change a selection round')).toBeTruthy();
    await press('Details');
    expect(screen.queryByText('Only admins can change a selection round')).toBeNull();
    await press('Save');
    expect(screen.getByText('Saved.')).toBeTruthy();
    await press('Dates (0)');
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('keeps what was typed in Details while another tab is looked at', async () => {
    await openRound();
    await press('Details');
    await fill('Name', '2027 trials');
    await press('Reports');
    await press('Details');
    expect(screen.getByDisplayValue('2027 trials')).toBeTruthy();
  });

  it('puts the panel two a row on a tablet', async () => {
    await openRound();
    await press('Panel (2)');
    await fireEvent(screen.getByTestId('card-grid-1'), 'layout', { nativeEvent: { layout: { width: 772, height: 600, x: 0, y: 0 } } });
    expect(screen.getByTestId('card-grid-2')).toBeTruthy();
    expect(screen.getByText('Take Casey Coach off the panel')).toBeTruthy();
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
    // And who was given feedback and when: never what it says.
    // And which criteria the round used and what changed about it (part 4).
    expect(assessmentRpcs()).toEqual([
      'admin_selection_audit',
      'admin_selection_milestones',
      'admin_selection_summaries',
      'admin_selection_feedback',
      'admin_selection_round_record',
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
    // Folded: each section is one line until it is tapped, and one is open at a time.
    expect(screen.queryByText('Jordan Junior (under 18)')).toBeNull();
    await press('Evidence about each athlete');
    expect(screen.getByText('Jordan Junior (under 18)')).toBeTruthy();
    await press('What each selector wrote');
    expect(screen.queryByText('Jordan Junior (under 18)')).toBeNull();
    expect(screen.getByText(/3 \/ 1 \/ 0 \/ 0/)).toBeTruthy();
    expect(screen.getByText(/1 panel member has written nothing yet/)).toBeTruthy();
    await press('The panel');
    expect(screen.getByText(/Declared a conflict of interest this season/)).toBeTruthy();
    expect(screen.getByText(/it holds no ratings, evidence, recommendations or names of criteria/)).toBeTruthy();
    await press('The panel');
    expect(screen.queryByText(/Declared a conflict of interest this season/)).toBeNull();
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
