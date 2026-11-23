/**
 * Selection rounds, phase 3 (Matt, 23 November 2026): a selector's own
 * summary of an athlete (src/app/assessments/summary.tsx), written without
 * seeing anyone else's, signed and locked, then shown side by side with the
 * other signed ones and saved as a PDF; where summaries stand on a round's
 * list; the recommendations in the criteria; who has signed, for an admin
 * (src/app/admin/assessments/summaries.tsx), and in the audit report; and
 * the to-do to sign them.
 *
 * Who may read, sign or reopen what is the database's call
 * (supabase/tests/selection-summaries.sql). The screens show what each
 * function returns, send exactly what the member chose, and show the
 * database's refusal. The route guards are in route-guards-roles.test.tsx
 * and route-guards-features.test.tsx.
 */
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import * as Sharing from 'expo-sharing';

import AdminAuditScreen from '@/app/admin/assessments/audit';
import AdminCriteriaScreen from '@/app/admin/assessments/criteria';
import AdminRoundScreen from '@/app/admin/assessments/round';
import AdminSummariesScreen from '@/app/admin/assessments/summaries';
import AthleteAssessmentScreen from '@/app/assessments/athlete';
import RoundScreen from '@/app/assessments/round';
import SummaryScreen from '@/app/assessments/summary';
import HomeScreen from '@/app/index';
import {
  makeCriteria,
  type AdminRound,
  type AdminSummaries,
  type AssessmentSummary,
  type AthleteAssessment,
  type Criteria,
  type RoundSheet,
  type SelectionAudit,
  type SelectionTodo,
  type SummaryStatus,
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

const GROUPS = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Coachability', scale: ['Developing', 'Meets standard', 'Exceeds standard'], items: ['Accepts feedback'] },
]);
const CRITERIA: Criteria = { ...GROUPS, recommendations: ['Select', 'Not selected this time'] };

function summary(extra: Partial<AssessmentSummary> = {}): AssessmentSummary {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    team_name: '17 & Under squad',
    closed: false,
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    criteria: CRITERIA,
    today: TODAY,
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    my_name: 'Casey Coach',
    mine: null,
    prefill: [{ item_key: 'passing', rating: 2 }],
    my_observations: { total: 3, training: 2, game: 1, trial: 0, other: 0 },
    last_reopened: null,
    can_reopen: false,
    others_signed: 0,
    others: [],
    ...extra,
  };
}

const MINE = {
  id: 's1',
  ratings: [
    { item_key: 'passing', rating: 3 },
    { item_key: 'accepts-feedback', rating: 2 },
  ],
  recommendation: 'Select',
  strengths: 'Reads the play early',
  priorities: 'Left-hand pass',
  comments: null,
  signed_at: null as string | null,
  updated_at: '2026-10-17T03:00:00Z',
};
const SIGNED = { ...MINE, signed_at: '2026-10-17T03:00:00Z' };

const OTHER = {
  id: 's2',
  author_name: 'Ola Selector',
  ratings: [{ item_key: 'catching', rating: 1 }],
  recommendation: 'Not selected this time',
  strengths: null,
  priorities: 'Catching under pressure',
  comments: null,
  signed_at: '2026-10-16T03:00:00Z',
};

const ARGS = { p_round_id: 'r1', p_athlete_id: 'a1' };

// ---------------------------------------------------------------------------
// A selector's summary

describe('a selector’s summary of an athlete', () => {
  async function openSummary(loaded: AssessmentSummary | null = summary(), options: BackendOptions = {}) {
    await openScreen('coach', { 'assessments/summary': SummaryScreen }, '/assessments/summary?round=r1&athlete=a1', {}, {
      rpcs: { my_assessment_summary: loaded },
      ...options,
    });
  }

  it('asks for the member’s own summary of that athlete, and nothing else', async () => {
    await openSummary();
    expect(assessmentRpcs()).toEqual(['my_assessment_summary']);
    expect(onlyRpcCall('my_assessment_summary')).toEqual(ARGS);
  });

  it('shows the athlete, the round and the member’s own observations', async () => {
    await openSummary();
    expect(screen.getByText('Jordan Junior')).toBeTruthy();
    expect(screen.getByText('2027 selection phase · Your 3 observations: 2 training, 1 game')).toBeTruthy();
  });

  it('starts a new one from the member’s own latest steps and says so', async () => {
    await openSummary();
    expect(screen.getByText(/Each step starts as the latest one in your own observations/)).toBeTruthy();
    expect(screen.getByText(/1 of 3 criteria so far/)).toBeTruthy();
    expect(screen.getByText('Technical ability (1 of 2)')).toBeTruthy();
    expect(screen.getByText('Coachability (0 of 1)')).toBeTruthy();
  });

  it('says how many other selectors have signed, and shows nothing of theirs', async () => {
    await openSummary(summary({ others_signed: 2 }));
    expect(screen.getByText(/2 other selectors have signed\./)).toBeTruthy();
    expect(screen.queryByText('Export PDF')).toBeNull();
    await openSummary(summary({ others_signed: 1 }));
    expect(screen.getByText(/1 other selector has signed\./)).toBeTruthy();
    await openSummary();
    expect(screen.queryByText(/other selectors? ha(s|ve) signed/)).toBeNull();
  });

  it('saves a draft with exactly what was chosen and written, and stays on the screen', async () => {
    await openSummary();
    await press('Technical ability (1 of 2)');
    await press('Exceeds standard'); // Passing: from Meets to Exceeds
    await press('Below standard', 1); // Catching
    await press('Select');
    await fill('Strengths', '  Reads the play early ');
    await fill('Development priorities', 'Left-hand pass');
    await press('Save draft');
    expect(onlyRpcCall('save_assessment_summary')).toEqual({
      ...ARGS,
      p_ratings: [
        { item_key: 'passing', rating: 3 },
        { item_key: 'catching', rating: 1 },
      ],
      p_recommendation: 'Select',
      p_strengths: 'Reads the play early',
      p_priorities: 'Left-hand pass',
      p_comments: '',
      p_sign: false,
    });
    expect(screen.getByText('Draft saved. Only you can see it until you sign.')).toBeTruthy();
    // It reads the summary again, as saved.
    expect(rpcCalls('my_assessment_summary')).toHaveLength(2);
  });

  it('takes a step off on a second tap, and a recommendation too', async () => {
    await openSummary();
    await press('Technical ability (1 of 2)');
    await press('Meets standard');
    expect(screen.getByText('Technical ability (0 of 2)')).toBeTruthy();
    await press('Select');
    await press('Select');
    await press('Save draft');
    expect(onlyRpcCall('save_assessment_summary')).toMatchObject({ p_ratings: [], p_recommendation: null });
  });

  it('closes a group on a second tap', async () => {
    await openSummary();
    await press('Technical ability (1 of 2)');
    expect(screen.getByText('Tap to close')).toBeTruthy();
    await press('Technical ability (1 of 2)');
    expect(screen.queryByText('Tap to close')).toBeNull();
    expect(screen.getByText('Passing, Catching')).toBeTruthy();
  });

  it('signs only after a second, clearly worded press', async () => {
    await openSummary(summary({ mine: MINE }));
    await press('Sign my summary');
    expect(screen.getByText(/Signing locks your summary and shows it to the other selectors who have signed theirs/)).toBeTruthy();
    expect(rpcCalls('save_assessment_summary')).toEqual([]);
    await press('Cancel');
    expect(rpcCalls('save_assessment_summary')).toEqual([]);
    await press('Sign my summary');
    await press('Sign and lock');
    expect(onlyRpcCall('save_assessment_summary')).toEqual({
      ...ARGS,
      p_ratings: MINE.ratings,
      p_recommendation: 'Select',
      p_strengths: 'Reads the play early',
      p_priorities: 'Left-hand pass',
      p_comments: '',
      p_sign: true,
    });
    expect(screen.queryByText('Draft saved. Only you can see it until you sign.')).toBeNull();
  });

  it('won’t sign without a step or without a recommendation, and sends nothing', async () => {
    await openSummary(summary({ prefill: [] }));
    await press('Sign my summary');
    await press('Sign and lock');
    expect(screen.getByText('Choose a step for at least one of the criteria before you sign.')).toBeTruthy();
    await openSummary();
    await press('Sign my summary');
    await press('Sign and lock');
    expect(screen.getByText('Choose a recommendation before you sign.')).toBeTruthy();
    expect(rpcCalls('save_assessment_summary')).toEqual([]);
  });

  it('offers no recommendation when the round lists none, and signs without one', async () => {
    await openSummary(summary({ criteria: GROUPS }));
    expect(screen.queryByText('Your recommendation')).toBeNull();
    await press('Sign my summary');
    await press('Sign and lock');
    expect(onlyRpcCall('save_assessment_summary')).toMatchObject({ p_recommendation: null, p_sign: true });
  });

  it('opens a saved draft as it was saved', async () => {
    await openSummary(summary({ mine: MINE }));
    expect(screen.getByDisplayValue('Reads the play early')).toBeTruthy();
    expect(screen.getByDisplayValue('Left-hand pass')).toBeTruthy();
    expect(screen.getByText('Technical ability (1 of 2)')).toBeTruthy();
    expect(screen.getByText('Coachability (1 of 1)')).toBeTruthy();
    expect(screen.getByText(/Open a group to change a step/)).toBeTruthy();
  });

  it('says who reopened it and that it needs signing again', async () => {
    await openSummary(summary({ mine: MINE, last_reopened: { by_name: 'Alex Admin', at: '2026-10-17T05:00:00Z' } }));
    expect(screen.getByText(new RegExp(`Reopened by Alex Admin on ${d('2026-10-17')}\\.`))).toBeTruthy();
  });

  it('shows the database’s refusal to save and keeps what was written', async () => {
    await openSummary(summary(), { rpcErrors: { save_assessment_summary: 'This round is closed' } });
    await fill('Comments', 'Keen');
    await press('Save draft');
    expect(screen.getByText('This round is closed')).toBeTruthy();
    expect(screen.getByDisplayValue('Keen')).toBeTruthy();
    expect(screen.queryByText('Draft saved. Only you can see it until you sign.')).toBeNull();
  });

  it('shows why it couldn’t load, with nothing to fill in', async () => {
    await openSummary(null, { rpcErrors: { my_assessment_summary: 'You can’t see this athlete’s assessment' } });
    expect(screen.getByText('You can’t see this athlete’s assessment')).toBeTruthy();
    expect(screen.queryByText('Save draft')).toBeNull();
  });

  it('warns that health and safety worries don’t go here', async () => {
    await openSummary();
    expect(screen.getByText(/Nothing about health, injuries or wellbeing\s+goes here/)).toBeTruthy();
  });

  it('reads it again on pull to refresh', async () => {
    await openSummary();
    await pullToRefresh();
    expect(rpcCalls('my_assessment_summary')).toHaveLength(2);
  });

  it('has nothing to write or show for an unsigned summary in a closed round', async () => {
    await openSummary(summary({ closed: true, mine: MINE, others_signed: 1 }));
    expect(screen.getByText(/This round is closed and you didn’t sign a summary/)).toBeTruthy();
    expect(screen.queryByText('Save draft')).toBeNull();
    expect(screen.queryByText('Sign my summary')).toBeNull();
    expect(screen.queryByText('Export PDF')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Once signed

describe('a signed summary', () => {
  async function openSigned(extra: Partial<AssessmentSummary> = {}, options: BackendOptions = {}) {
    await openScreen('coach', { 'assessments/summary': SummaryScreen }, '/assessments/summary?round=r1&athlete=a1', {}, {
      rpcs: { my_assessment_summary: summary({ mine: SIGNED, others: [OTHER], others_signed: 1, ...extra }) },
      ...options,
    });
  }

  it('is locked: nothing to fill in, save or sign', async () => {
    await openSigned();
    expect(screen.getByText(new RegExp(`You signed your summary on ${d('2026-10-17')}, so it can’t be changed\\.`))).toBeTruthy();
    expect(screen.queryByText('Save draft')).toBeNull();
    expect(screen.queryByText('Sign my summary')).toBeNull();
    expect(screen.queryByDisplayValue('Reads the play early')).toBeNull();
  });

  it('shows the member’s own and the other signed summaries side by side', async () => {
    await openSigned();
    expect(screen.getByText(/1 other selector has signed one\./)).toBeTruthy();
    expect(screen.getByText('Casey Coach: Exceeds standard')).toBeTruthy(); // Passing
    expect(screen.getByText('Ola Selector: Below standard')).toBeTruthy(); // Catching
    expect(screen.getByText('Recommends: Select')).toBeTruthy();
    expect(screen.getByText('Recommends: Not selected this time')).toBeTruthy();
    expect(screen.getByText('Development priorities: Catching under pressure')).toBeTruthy();
  });

  it('says when nobody else has signed yet', async () => {
    await openSigned({ others: [], others_signed: 0 });
    expect(screen.getByText(/No other selector has signed one for this athlete yet\./)).toBeTruthy();
    await openSigned({ others: [OTHER, { ...OTHER, id: 's3', author_name: 'Morgan Coach-Parent' }] });
    expect(screen.getByText(/2 other selectors have signed one\./)).toBeTruthy();
  });

  it('saves the sheet as a PDF with every signed summary and no score', async () => {
    await openSigned();
    await fireEvent.press(screen.getByText('Export PDF'));
    await settle();
    expect(written).toHaveLength(1);
    expect(written[0].uri).toMatch(/selection-assessment-2026-10-18\.pdf$/);
    const pdf = readPdf(written[0].bytes);
    for (const text of ['Jordan Junior', 'Casey Coach', 'Ola Selector', 'Exceeds standard', 'Not selected this time', 'Reads the play early']) {
      expect(pdf.text).toContain(text);
    }
    expect(pdf.text).toContain('There is no total or score');
    expect(pdf.text).not.toMatch(/average|ranking|\bRank\b/);
  });

  it('tells a selector who isn’t the head coach who can reopen it, and offers no reopening', async () => {
    await openSigned();
    expect(screen.getByText('Signed by mistake? The head coach or an admin can reopen it for you.')).toBeTruthy();
    expect(screen.queryByText(/^Reopen/)).toBeNull();
    await openSigned({ closed: true });
    expect(screen.getByText('This round is closed.')).toBeTruthy();
    expect(screen.queryByText(/^Reopen/)).toBeNull();
  });

  it('lets the head coach reopen their own, after confirming, and reads it again', async () => {
    await openSigned({ can_reopen: true });
    await press('Reopen my summary');
    expect(rpcCalls('reopen_assessment_summary')).toEqual([]);
    expect(screen.getByText(/Until then you won’t see the other selectors’ summaries\./)).toBeTruthy();
    await press('Reopen my summary');
    expect(onlyRpcCall('reopen_assessment_summary')).toEqual({ p_summary_id: 's1' });
    expect(rpcCalls('my_assessment_summary')).toHaveLength(2);
  });

  it('lets the head coach reopen another selector’s by name', async () => {
    await openSigned({ can_reopen: true });
    await press('Reopen Ola Selector’s summary');
    expect(screen.getByText('Ola Selector can change their summary and must sign it again.')).toBeTruthy();
    await press('Reopen Ola Selector’s summary');
    expect(onlyRpcCall('reopen_assessment_summary')).toEqual({ p_summary_id: 's2' });
  });

  it('shows the database’s refusal to reopen', async () => {
    await openSigned({ can_reopen: true }, { rpcErrors: { reopen_assessment_summary: 'This round is closed. Open it again first.' } });
    await press('Reopen my summary');
    await press('Reopen my summary');
    expect(screen.getByText('This round is closed. Open it again first.')).toBeTruthy();
    expect(rpcCalls('my_assessment_summary')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// From the athlete's assessment and the round's list

describe('reaching a summary', () => {
  const ASSESSMENT: AthleteAssessment = {
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

  async function openAthlete(closed = false) {
    await openScreen(
      'coach',
      { 'assessments/athlete': AthleteAssessmentScreen, 'assessments/summary': placeholder('assessments/summary') },
      '/assessments/athlete?round=r1&athlete=a1',
      {},
      { rpcs: { athlete_assessment: { ...ASSESSMENT, closed } } },
    );
  }

  it('opens from the athlete’s assessment, and reads no summary until then', async () => {
    await openAthlete();
    expect(assessmentRpcs()).not.toContain('my_assessment_summary');
    expect(screen.getByText(/You see the other selectors’ summaries once you have\s+signed yours\./)).toBeTruthy();
    await press('My summary');
    expect(screen.getByText('screen:assessments/summary')).toBeTruthy();
  });

  it('still opens once the round is closed, to read a signed one', async () => {
    await openAthlete(true);
    expect(screen.queryByText('Add an observation')).toBeNull();
    await press('My summary');
    expect(screen.getByText('screen:assessments/summary')).toBeTruthy();
  });

  const SHEET: RoundSheet = {
    id: 'r1',
    name: '2027 selection phase',
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed: false,
    criteria: CRITERIA,
    today: TODAY,
    hidden: 0,
    athletes: ['a1', 'a2', 'a3', 'a4'].map((id, n) => ({
      id,
      name: `Athlete ${n + 1}`,
      is_minor: true,
      observations: 2,
      my_observations: 1,
      assessors: 1,
      groups_covered: 1,
      last_observed_on: '2026-10-16',
    })),
  };

  async function openRound(statuses: SummaryStatus[] | null, options: BackendOptions = {}) {
    await openScreen('coach', { 'assessments/round': RoundScreen }, '/assessments/round?id=r1', {}, {
      rpcs: { selection_round_sheet: SHEET, selection_round_summaries: statuses },
      ...options,
    });
  }

  it('asks where the round’s summaries stand', async () => {
    await openRound([]);
    expect(onlyRpcCall('selection_round_summaries')).toEqual({ p_round_id: 'r1' });
  });

  it('says under each athlete where the member’s own stands and how many are signed', async () => {
    await openRound([
      { athlete_id: 'a1', mine: 'signed', signed: 2 },
      { athlete_id: 'a2', mine: 'draft', signed: 0 },
      { athlete_id: 'a3', mine: 'none', signed: 1 },
      { athlete_id: 'a4', mine: 'none', signed: 0 },
    ]);
    expect(screen.getByText('Your summary is signed · 2 signed in all')).toBeTruthy();
    expect(screen.getByText('Your summary is a draft · 0 signed in all')).toBeTruthy();
    expect(screen.getByText('No summary from you yet · 1 signed in all')).toBeTruthy();
    expect(screen.getAllByText(/signed in all/)).toHaveLength(3);
  });

  it('says nothing about summaries before anyone starts one, or with no answer', async () => {
    await openRound(null);
    expect(screen.getByText('Athlete 1')).toBeTruthy();
    expect(screen.queryByText(/signed in all/)).toBeNull();
  });

  it('never asks about summaries when the round is refused', async () => {
    await openRound([], { rpcErrors: { selection_round_sheet: 'You are not on this round’s panel' } });
    expect(screen.getByText('You are not on this round’s panel')).toBeTruthy();
    expect(rpcCalls('selection_round_summaries')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The criteria: recommendations

describe('the recommendations in the criteria', () => {
  async function openCriteria(saved: unknown = null) {
    await openScreen('admin', { index: placeholder('index'), 'admin/assessments/criteria': AdminCriteriaScreen }, '/', {}, {
      rpcs: { admin_assessment_criteria: saved },
    });
    await pushTo('/admin/assessments/criteria');
    await settle();
  }
  const savedCriteria = () => onlyRpcCall('admin_save_assessment_criteria').p_criteria as Criteria;

  it('offers none until there is a group', async () => {
    await openCriteria();
    expect(screen.queryByText('Recommendations')).toBeNull();
  });

  it('starts the netball example with the usual four', async () => {
    await openCriteria();
    await press('Start from the netball example');
    expect(screen.getByDisplayValue('Select as a training partner')).toBeTruthy();
    expect(screen.queryByText('Use the usual four')).toBeNull();
    await press('Save criteria');
    expect(savedCriteria().recommendations).toEqual([
      'Select',
      'Select as a training partner',
      'Not selected this time',
      'More evidence needed',
    ]);
  });

  it('saves criteria from before recommendations as they are, with none', async () => {
    await openCriteria(GROUPS);
    expect(screen.getByText('Use the usual four')).toBeTruthy();
    await press('Save criteria');
    expect(savedCriteria()).toEqual(GROUPS);
  });

  it('adds the usual four to saved criteria in one press', async () => {
    await openCriteria(GROUPS);
    await press('Use the usual four');
    await press('Save criteria');
    expect(savedCriteria().recommendations).toHaveLength(4);
    expect(savedCriteria().groups).toEqual(GROUPS.groups);
  });

  it('renames, adds and removes them', async () => {
    await openCriteria(CRITERIA);
    await fill('Recommendation 2', 'Not yet');
    await press('Add a recommendation');
    await fill('Recommendation 3', 'Train on');
    await press('Add a recommendation');
    await press('Remove the last recommendation');
    await press('Save criteria');
    expect(savedCriteria().recommendations).toEqual(['Select', 'Not yet', 'Train on']);
  });

  it('won’t save one alone or an empty one, and sends nothing', async () => {
    await openCriteria(CRITERIA);
    await press('Remove the last recommendation');
    await press('Save criteria');
    expect(screen.getByText('Give selectors at least two recommendations to choose from, or none.')).toBeTruthy();
    await press('Add a recommendation');
    await press('Save criteria');
    expect(screen.getByText('Name each recommendation, or remove the empty one.')).toBeTruthy();
    expect(rpcCalls('admin_save_assessment_criteria')).toEqual([]);
  });

  it('stops offering more at eight, and removing the last two leaves none', async () => {
    await openCriteria({ ...GROUPS, recommendations: Array.from({ length: 8 }, (_, i) => `Choice ${i + 1}`) });
    expect(screen.queryByText('Add a recommendation')).toBeNull();
    await openCriteria(CRITERIA);
    await press('Remove the last recommendation');
    await press('Remove the last recommendation');
    expect(screen.queryByText('Remove the last recommendation')).toBeNull();
    await press('Save criteria');
    expect(savedCriteria().recommendations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// An admin: who has signed

const ADMIN_SUMMARIES: AdminSummaries = {
  ends_on: '2026-11-29',
  closed: false,
  selectors: [
    { name: 'Casey Coach', on_panel: true, athletes: 14, signed: 14, signed_late: 0, drafts: 0, reopened: 1 },
    { name: 'Ola Selector', on_panel: true, athletes: 14, signed: 9, signed_late: 2, drafts: 3, reopened: 2 },
    { name: 'Drew Lapsed', on_panel: false, athletes: 14, signed: 1, signed_late: 0, drafts: 0, reopened: 0 },
  ],
  signed: [
    { id: 's1', selector_name: 'Casey Coach', athlete_name: 'Jordan Junior', signed_at: '2026-10-17T03:00:00Z', late: false },
    { id: 's2', selector_name: 'Ola Selector', athlete_name: null, signed_at: '2026-10-16T03:00:00Z', late: true },
  ],
  reopenings: [
    { selector_name: 'Casey Coach', athlete_name: 'Jordan Junior', by_name: 'Sample admin', at: '2026-10-15T02:00:00Z' },
    { selector_name: 'Ola Selector', athlete_name: null, by_name: 'Casey Coach', at: '2026-10-15T02:00:00Z' },
  ],
};

describe('who has signed, for an admin', () => {
  async function openSummaries(loaded: AdminSummaries | null = ADMIN_SUMMARIES, options: BackendOptions = {}) {
    await openScreen('admin', { 'admin/assessments/summaries': AdminSummariesScreen }, '/admin/assessments/summaries?id=r1', {}, {
      rpcs: { admin_selection_summaries: loaded },
      ...options,
    });
  }

  it('asks who has signed, and for no summary or assessment', async () => {
    await openSummaries();
    expect(assessmentRpcs()).toEqual(['admin_selection_summaries']);
    expect(onlyRpcCall('admin_selection_summaries')).toEqual({ p_round_id: 'r1' });
  });

  it('says it never shows what a summary says, and the round’s last day', async () => {
    await openSummaries();
    expect(screen.getByText(new RegExp(`never what a summary says\\. The round’s last day is\\s+${d('2026-11-29')}\\.`))).toBeTruthy();
  });

  it('counts each selector’s summaries: signed, late, in draft, not started and reopened', async () => {
    await openSummaries();
    expect(screen.getByText('Signed 14 of 14 · reopened once')).toBeTruthy();
    expect(screen.getByText('Signed 9 of 14, 2 after the last day · 3 in draft · 2 not started · reopened 2 times')).toBeTruthy();
    expect(screen.getByText('Drew Lapsed (not on the panel now)')).toBeTruthy();
    expect(screen.getByText('Signed 1 of 14')).toBeTruthy();
  });

  it('lists each signed summary by selector and athlete with its day, and nothing it says', async () => {
    await openSummaries();
    expect(screen.getByText('Casey Coach about Jordan Junior')).toBeTruthy();
    expect(screen.getByText(`Signed ${d('2026-10-17')}`)).toBeTruthy();
    expect(screen.getByText('Ola Selector about an athlete')).toBeTruthy();
    expect(screen.getByText(`Signed ${d('2026-10-16')}, after the last day`)).toBeTruthy();
    expect(screen.queryByText(/standard|Passing|Recommend|Not selected|Strengths/)).toBeNull();
  });

  it('reopens one after confirming, then reads the list again', async () => {
    await openSummaries();
    await press('Reopen');
    expect(screen.getByText('Casey Coach can change this summary and must sign it again.')).toBeTruthy();
    expect(rpcCalls('reopen_assessment_summary')).toEqual([]);
    await press('Reopen Casey Coach’s summary about Jordan Junior');
    expect(onlyRpcCall('reopen_assessment_summary')).toEqual({ p_summary_id: 's1' });
    expect(rpcCalls('admin_selection_summaries')).toHaveLength(2);
  });

  it('names an unnamed athlete plainly when reopening', async () => {
    await openSummaries();
    await press('Reopen', 1);
    await press('Reopen Ola Selector’s summary about this athlete');
    expect(onlyRpcCall('reopen_assessment_summary')).toEqual({ p_summary_id: 's2' });
  });

  it('shows the database’s refusal to reopen', async () => {
    await openSummaries(ADMIN_SUMMARIES, { rpcErrors: { reopen_assessment_summary: 'This summary isn’t signed' } });
    await press('Reopen');
    await press('Reopen Casey Coach’s summary about Jordan Junior');
    expect(screen.getByText('This summary isn’t signed')).toBeTruthy();
    expect(rpcCalls('admin_selection_summaries')).toHaveLength(1);
  });

  it('offers no reopening on a closed round, and says why', async () => {
    await openSummaries({ ...ADMIN_SUMMARIES, closed: true });
    expect(screen.getByText('The round is closed, so a summary can’t be reopened. Open the round again first.')).toBeTruthy();
    expect(screen.queryByText('Reopen')).toBeNull();
  });

  it('lists every reopening with who did it and when', async () => {
    await openSummaries();
    expect(screen.getByText(`Casey Coach about Jordan Junior: reopened by Sample admin on ${d('2026-10-15')}`)).toBeTruthy();
    expect(screen.getByText(`Ola Selector about an athlete: reopened by Casey Coach on ${d('2026-10-15')}`)).toBeTruthy();
  });

  it('says when nobody has signed, with no list of reopenings', async () => {
    await openSummaries({ ...ADMIN_SUMMARIES, signed: [], reopenings: [] });
    expect(screen.getByText('Nobody has signed a summary yet.')).toBeTruthy();
    expect(screen.queryByText('Reopened')).toBeNull();
  });

  it('shows why it couldn’t load', async () => {
    await openSummaries(null, { rpcErrors: { admin_selection_summaries: 'Only admins can see who has signed' } });
    expect(screen.getByText('Only admins can see who has signed')).toBeTruthy();
    expect(screen.queryByText('Signed summaries')).toBeNull();
  });

  it('reads it again on pull to refresh', async () => {
    await openSummaries();
    await pullToRefresh();
    expect(rpcCalls('admin_selection_summaries')).toHaveLength(2);
  });

  it('opens from the round’s set-up', async () => {
    const round: AdminRound = {
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
      panel: [],
    };
    await openScreen(
      'admin',
      { 'admin/assessments/round': AdminRoundScreen, 'admin/assessments/summaries': placeholder('admin/assessments/summaries') },
      '/admin/assessments/round?id=r1',
      { teams: [{ id: 't1', name: '17 & Under squad', sort_order: 1, kind: 'squad', season: 2027, squad_id: null, selections_completed_at: null }] },
      { rpcs: { admin_selection_rounds: [round] } },
    );
    expect(screen.getByText(/What a summary says stays with the panel\./)).toBeTruthy();
    expect(assessmentRpcs()).not.toContain('admin_selection_summaries');
    await press('Summaries signed');
    expect(screen.getByText('screen:admin/assessments/summaries')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The audit report

describe('summaries in the Selection audit report', () => {
  const AUDIT = {
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
      criteria_groups: 2,
      criteria_items: 3,
      athletes: 0,
      observations: 0,
      today: TODAY,
    },
    panel: [],
    selectors: [],
    athletes: [],
  } as unknown as SelectionAudit;

  async function openAudit(summaries: AdminSummaries | null, options: BackendOptions = {}) {
    await openScreen('admin', { 'admin/assessments/audit': AdminAuditScreen }, '/admin/assessments/audit?id=r1', {}, {
      rpcs: { admin_selection_audit: AUDIT, admin_selection_summaries: summaries },
      ...options,
    });
  }

  it('asks who has signed for that round', async () => {
    await openAudit(ADMIN_SUMMARIES);
    expect(onlyRpcCall('admin_selection_summaries')).toEqual({ p_round_id: 'r1' });
  });

  it('shows each selector’s counts and every reopening', async () => {
    await openAudit(ADMIN_SUMMARIES);
    expect(screen.getByText('Summaries')).toBeTruthy();
    expect(screen.getByText('Signed late: 2')).toBeTruthy();
    expect(screen.getByText('Summaries reopened')).toBeTruthy();
    expect(screen.getAllByText('Reopened by: Sample admin')).toHaveLength(1);
  });

  it('leaves the part out when there is no answer, as from a database not yet updated', async () => {
    await openAudit(null);
    expect(screen.getByText('The round')).toBeTruthy();
    expect(screen.queryByText('Summaries')).toBeNull();
  });

  it('puts the counts in the PDF, and nothing a summary says', async () => {
    await openAudit(ADMIN_SUMMARIES);
    await fireEvent.press(screen.getByText('Export PDF'));
    await settle();
    const pdf = readPdf(written[0].bytes);
    expect(pdf.text).toContain('Summaries reopened');
    expect(pdf.text).toContain('Drew Lapsed (not on the panel now)');
    expect(pdf.text).not.toMatch(/Meets standard|Passing|Not selected this time/);
  });

  it('never asks who has signed when the audit is refused', async () => {
    await openAudit(ADMIN_SUMMARIES, { rpcErrors: { admin_selection_audit: 'Only admins can build the audit report' } });
    expect(rpcCalls('admin_selection_summaries')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Home

describe('the to-do to sign summaries', () => {
  const TODO: SelectionTodo = {
    kind: 'summaries',
    round_id: 'r1',
    round_name: '2027 selection phase',
    milestone_id: null,
    title: null,
    due_on: '2026-10-22',
    athletes: 4,
    for_admin: false,
  };

  async function openHome(who: Who) {
    await openScreen(who, { index: HomeScreen, 'assessments/round': placeholder('assessments/round') }, '/', {}, {
      rpcs: { my_selection_todos: [TODO] },
    });
  }

  it('tells a panel member how many summaries they still have to sign, opening the round', async () => {
    await openHome('coach');
    expect(screen.getByText('Sign your 4 summaries: 2027 selection phase')).toBeTruthy();
    expect(screen.getByText(new RegExp(`The round ends ${d('2026-10-22')}`))).toBeTruthy();
    await press('Sign your 4 summaries: 2027 selection phase');
    expect(screen.getByText('screen:assessments/round')).toBeTruthy();
  });

  it.each<PersonaName>(['athlete', 'guardian', 'manager', 'committee', 'physio'])('never shows it to %s', async (who) => {
    await openHome(who);
    expect(screen.queryByText(/Sign your/)).toBeNull();
  });

  it('shows nothing while the feature is off', async () => {
    setClubFeatures({});
    await openHome('coach');
    expect(screen.queryByText(/Sign your/)).toBeNull();
  });
});
