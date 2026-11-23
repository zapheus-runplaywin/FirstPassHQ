/**
 * Selection rounds, phase 4 (Matt, 23 November 2026): feedback the head
 * coach writes for an athlete and chooses to share
 * (src/app/assessments/feedback.tsx), where feedback stands on a round's
 * list and on the athlete's assessment, what the athlete and their parents
 * read under Selection (src/app/selection.tsx) and on Home, and the record
 * of it in the admin's audit report.
 *
 * Who may write, share, take back or read feedback is the database's call
 * (supabase/tests/selection-feedback.sql). The screens show what each
 * function returns, send exactly what the member wrote, and show the
 * database's refusal. The route guards are in route-guards-roles.test.tsx
 * and route-guards-features.test.tsx.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AdminAuditScreen from '@/app/admin/assessments/audit';
import AthleteAssessmentScreen from '@/app/assessments/athlete';
import FeedbackScreen from '@/app/assessments/feedback';
import RoundScreen from '@/app/assessments/round';
import HomeScreen from '@/app/index';
import SelectionScreen from '@/app/selection';
import {
  makeCriteria,
  type AdminFeedback,
  type AthleteAssessment,
  type AthleteFeedback,
  type FeedbackStatus,
  type RoundSheet,
  type SelectionAudit,
  type SelectionInfo,
  type SharedFeedback,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

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
const ARGS = { p_round_id: 'r1', p_athlete_id: 'a1' };

function loaded(extra: Partial<AthleteFeedback> = {}): AthleteFeedback {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    closed: false,
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    is_minor: true,
    can_write: true,
    feedback: null,
    ...extra,
  };
}

const DRAFT = {
  went_well: 'Reads the play early',
  work_on: 'Left-hand pass',
  author_name: 'Casey Coach',
  shared_at: null as string | null,
  seen_at: null as string | null,
  updated_at: '2026-10-17T03:00:00Z',
};
const SHARED = { ...DRAFT, shared_at: '2026-10-17T03:00:00Z' };

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
  athletes: ['a1', 'a2', 'a3'].map((id, n) => ({
    id,
    name: n === 2 ? null : `Athlete ${n + 1}`,
    is_minor: true,
    observations: 2,
    my_observations: 1,
    assessors: 1,
    groups_covered: 1,
    last_observed_on: '2026-10-16',
  })),
};

// ---------------------------------------------------------------------------
// The head coach writes, shares and takes back

describe('feedback for an athlete, for the head coach', () => {
  async function openFeedback(
    feedback: AthleteFeedback | null = loaded(),
    statuses: FeedbackStatus[] | null = [],
    options: BackendOptions = {},
  ) {
    await openScreen('coach', { 'assessments/feedback': FeedbackScreen }, '/assessments/feedback?round=r1&athlete=a1', {}, {
      rpcs: { athlete_feedback: feedback, selection_round_sheet: SHEET, selection_round_feedback: statuses },
      ...options,
    });
  }

  it('asks for that athlete’s feedback in that round', async () => {
    await openFeedback();
    expect(onlyRpcCall('athlete_feedback')).toEqual(ARGS);
    expect(screen.getByText('Jordan Junior')).toBeTruthy();
    expect(screen.getByText('2027 selection phase')).toBeTruthy();
  });

  it('starts with two empty boxes and nothing else to fill in', async () => {
    await openFeedback();
    expect(fieldLabelled('What went well').props.value).toBe('');
    expect(fieldLabelled('What to work on').props.value).toBe('');
    expect(screen.getByText('Only you see a draft. Nothing about health, injuries or wellbeing goes here.')).toBeTruthy();
  });

  it('saves a draft with the words tidied, and says so', async () => {
    await openFeedback();
    await fill('What went well', '  Reads the play early ');
    await fill('What to work on', 'Left-hand pass');
    await press('Save draft');
    expect(onlyRpcCall('save_assessment_feedback')).toEqual({
      ...ARGS,
      p_went_well: 'Reads the play early',
      p_work_on: 'Left-hand pass',
      p_share: false,
    });
    expect(screen.getByText('Draft saved.')).toBeTruthy();
    expect(rpcCalls('athlete_feedback')).toHaveLength(2);
  });

  it('opens a draft with its words to carry on', async () => {
    await openFeedback(loaded({ feedback: DRAFT }));
    expect(fieldLabelled('What went well').props.value).toBe('Reads the play early');
    expect(fieldLabelled('What to work on').props.value).toBe('Left-hand pass');
    expect(screen.queryByText(/Shared by/)).toBeNull();
  });

  it('refuses to share nothing, without asking the database', async () => {
    await openFeedback();
    await press('Share with Jordan Junior');
    await press('Share now');
    expect(screen.getByText('Write some feedback before you share it')).toBeTruthy();
    expect(rpcCalls('save_assessment_feedback')).toEqual([]);
  });

  it('says who will read an under 18’s feedback before sharing, and shares only on the second press', async () => {
    await openFeedback(loaded({ feedback: DRAFT }));
    await press('Share with Jordan Junior');
    expect(
      screen.getByText(
        'Jordan Junior and their verified parents and guardians will read this under Selection. Nobody can reply in the app. You can take it back to change it.',
      ),
    ).toBeTruthy();
    expect(rpcCalls('save_assessment_feedback')).toEqual([]);
    await press('Share now');
    expect(onlyRpcCall('save_assessment_feedback')).toEqual({
      ...ARGS,
      p_went_well: 'Reads the play early',
      p_work_on: 'Left-hand pass',
      p_share: true,
    });
    expect(screen.queryByText('Draft saved.')).toBeNull();
  });

  it('names only the athlete as the reader when they are an adult', async () => {
    await openFeedback(loaded({ feedback: DRAFT, is_minor: false, athlete_name: 'Kai Senior' }));
    await press('Share with Kai Senior');
    expect(
      screen.getByText('Kai Senior will read this under Selection. Nobody can reply in the app. You can take it back to change it.'),
    ).toBeTruthy();
  });

  it('can cancel sharing', async () => {
    await openFeedback(loaded({ feedback: DRAFT }));
    await press('Share with Jordan Junior');
    await press('Cancel');
    expect(screen.getByText('Share with Jordan Junior')).toBeTruthy();
    expect(rpcCalls('save_assessment_feedback')).toEqual([]);
  });

  it('shows the database’s refusal and keeps what was written', async () => {
    await openFeedback(loaded(), [], { rpcErrors: { save_assessment_feedback: 'This round is closed' } });
    await fill('What went well', 'Good hands');
    await press('Save draft');
    expect(screen.getByText('This round is closed')).toBeTruthy();
    expect(fieldLabelled('What went well').props.value).toBe('Good hands');
    expect(screen.queryByText('Draft saved.')).toBeNull();
    expect(rpcCalls('athlete_feedback')).toHaveLength(1);
  });

  it('shows shared feedback locked, with who shared it and that it isn’t read yet', async () => {
    await openFeedback(loaded({ feedback: SHARED }));
    expect(screen.getByText(`Shared by Casey Coach on ${d('2026-10-17')} · not read yet`)).toBeTruthy();
    expect(screen.getByText('Reads the play early')).toBeTruthy();
    expect(screen.getByText('Left-hand pass')).toBeTruthy();
    expect(screen.queryByText('Save draft')).toBeNull();
    expect(screen.queryByText(/^Share with/)).toBeNull();
  });

  it('says when it was first read', async () => {
    await openFeedback(loaded({ feedback: { ...SHARED, seen_at: '2026-10-18T01:00:00Z' } }));
    expect(screen.getByText(`Shared by Casey Coach on ${d('2026-10-17')} · first read ${d('2026-10-18')}`)).toBeTruthy();
  });

  it('leaves out a box that was left empty', async () => {
    await openFeedback(loaded({ feedback: { ...SHARED, work_on: '' } }));
    expect(screen.getByText('What went well')).toBeTruthy();
    expect(screen.queryByText('What to work on')).toBeNull();
  });

  it('takes shared feedback back after a warning', async () => {
    await openFeedback(loaded({ feedback: SHARED }));
    await press('Take back to change');
    expect(
      screen.getByText(
        'Jordan Junior will no longer see this feedback until you share it again. Taking it back is kept in the audit report.',
      ),
    ).toBeTruthy();
    expect(rpcCalls('withdraw_assessment_feedback')).toEqual([]);
    await press('Take it back');
    expect(onlyRpcCall('withdraw_assessment_feedback')).toEqual(ARGS);
    expect(rpcCalls('athlete_feedback')).toHaveLength(2);
  });

  it('shows the database’s refusal to take it back', async () => {
    await openFeedback(loaded({ feedback: SHARED }), [], { rpcErrors: { withdraw_assessment_feedback: 'This round is closed' } });
    await press('Take back to change');
    await press('Take it back');
    expect(screen.getByText('This round is closed')).toBeTruthy();
    expect(rpcCalls('athlete_feedback')).toHaveLength(1);
  });

  it('offers the next athlete with nothing shared, and opens theirs in place of this one', async () => {
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    await openFeedback(loaded(), [{ athlete_id: 'a2', state: 'draft', seen: false }]);
    expect(onlyRpcCall('selection_round_feedback')).toEqual({ p_round_id: 'r1' });
    await press('Next: Athlete 2');
    expect(replace).toHaveBeenLastCalledWith({ pathname: '/assessments/feedback', params: { round: 'r1', athlete: 'a2' } });
    replace.mockRestore();
  });

  it('skips athletes whose feedback is shared, on shared feedback too', async () => {
    await openFeedback(loaded({ feedback: SHARED }), [
      { athlete_id: 'a1', state: 'shared', seen: false },
      { athlete_id: 'a2', state: 'shared', seen: true },
    ]);
    expect(screen.getByText('Next: Athlete')).toBeTruthy();
  });

  it('offers no next athlete once everyone’s is shared', async () => {
    await openFeedback(
      loaded({ feedback: SHARED }),
      ['a1', 'a2', 'a3'].map((athlete_id) => ({ athlete_id, state: 'shared' as const, seen: false })),
    );
    expect(screen.queryByText(/^Next:/)).toBeNull();
  });

  it('reads it again on pull to refresh', async () => {
    await openFeedback();
    await pullToRefresh();
    expect(rpcCalls('athlete_feedback')).toHaveLength(2);
  });

  it('shows the database’s refusal to open it, and nothing else', async () => {
    await openFeedback(loaded(), [], { rpcErrors: { athlete_feedback: 'You can’t see this athlete’s assessment' } });
    expect(screen.getByText('You can’t see this athlete’s assessment')).toBeTruthy();
    expect(screen.queryByText('Save draft')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rest of the panel, and a closed round

describe('feedback for an athlete, for anyone who can’t write it', () => {
  async function openFeedback(feedback: AthleteFeedback) {
    await openScreen('coach', { 'assessments/feedback': FeedbackScreen }, '/assessments/feedback?round=r1&athlete=a1', {}, {
      rpcs: { athlete_feedback: feedback, selection_round_sheet: SHEET, selection_round_feedback: [] },
    });
  }

  it('reads shared feedback, with nothing to change, take back or move on to', async () => {
    await openFeedback(loaded({ can_write: false, feedback: SHARED }));
    expect(screen.getByText('Reads the play early')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText('Take back to change')).toBeNull();
    expect(rpcNames()).not.toContain('selection_round_feedback');
  });

  it('says when the head coach hasn’t shared any', async () => {
    await openFeedback(loaded({ can_write: false }));
    expect(screen.getByText('The head coach hasn’t shared feedback with this athlete yet.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says none was shared once the round is closed', async () => {
    await openFeedback(loaded({ can_write: false, closed: true }));
    expect(screen.getByText('2027 selection phase · closed')).toBeTruthy();
    expect(screen.getByText('No feedback was shared with this athlete.')).toBeTruthy();
  });

  it('shows the head coach a draft left in a closed round as never shared', async () => {
    await openFeedback(loaded({ can_write: false, closed: true, feedback: DRAFT }));
    expect(screen.getByText('A draft that was never shared')).toBeTruthy();
    expect(screen.getByText('Left-hand pass')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// From the athlete's assessment and the round's list

describe('reaching feedback', () => {
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

  async function openAthlete(feedback: AthleteFeedback | null) {
    await openScreen(
      'coach',
      { 'assessments/athlete': AthleteAssessmentScreen, 'assessments/feedback': placeholder('assessments/feedback') },
      '/assessments/athlete?round=r1&athlete=a1',
      {},
      { rpcs: { athlete_assessment: ASSESSMENT, athlete_feedback: feedback } },
    );
  }

  it('offers the head coach “Write feedback” on the athlete’s assessment', async () => {
    await openAthlete(loaded());
    expect(onlyRpcCall('athlete_feedback')).toEqual(ARGS);
    await press('Write feedback');
    expect(screen.getByText('screen:assessments/feedback')).toBeTruthy();
  });

  it.each([
    ['a draft', DRAFT, 'Feedback is a draft'],
    ['shared', SHARED, 'Feedback shared, not read yet'],
    ['read', { ...SHARED, seen_at: '2026-10-18T01:00:00Z' }, 'Feedback shared and read'],
  ])('says on the button where feedback that is %s stands', async (_, feedback, title) => {
    await openAthlete(loaded({ feedback }));
    await press(title);
    expect(screen.getByText('screen:assessments/feedback')).toBeTruthy();
  });

  it('lets the rest of the panel open shared feedback', async () => {
    await openAthlete(loaded({ can_write: false, feedback: SHARED }));
    expect(screen.getByText('Feedback shared, not read yet')).toBeTruthy();
  });

  it.each([
    ['nothing shared', loaded({ can_write: false })],
    ['no answer from the database', null],
  ])('offers the rest of the panel nothing with %s', async (_, feedback) => {
    await openAthlete(feedback);
    expect(screen.getByText('My summary')).toBeTruthy();
    expect(screen.queryByText(/feedback/i)).toBeNull();
  });

  async function openRound(statuses: FeedbackStatus[] | null) {
    await openScreen('coach', { 'assessments/round': RoundScreen }, '/assessments/round?id=r1', {}, {
      rpcs: {
        selection_round_sheet: SHEET,
        selection_round_summaries: [{ athlete_id: 'a1', mine: 'signed', signed: 2 }],
        selection_round_feedback: statuses,
      },
    });
  }

  it('asks where the round’s feedback stands', async () => {
    await openRound([]);
    expect(onlyRpcCall('selection_round_feedback')).toEqual({ p_round_id: 'r1' });
  });

  it('says where each athlete’s feedback stands, on the same line as their summaries', async () => {
    await openRound([
      { athlete_id: 'a1', state: 'shared', seen: true },
      { athlete_id: 'a2', state: 'draft', seen: false },
    ]);
    expect(screen.getByText('Your summary is signed · 2 signed in all · Feedback shared and read')).toBeTruthy();
    expect(screen.getByText('Feedback is a draft')).toBeTruthy();
    expect(screen.getAllByText(/Feedback/)).toHaveLength(2);
  });

  it.each([[[] as FeedbackStatus[]], [null]])('says nothing about feedback when there is none (%j)', async (statuses) => {
    await openRound(statuses);
    expect(screen.getByText('Your summary is signed · 2 signed in all')).toBeTruthy();
    expect(screen.queryByText(/Feedback/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Athletes and parents

function shared(extra: Partial<SharedFeedback> = {}): SharedFeedback {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    team_name: '17 & Under squad',
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    is_me: true,
    went_well: 'Reads the play early',
    work_on: 'Left-hand pass',
    shared_on: '2026-10-17',
    from_name: 'Casey Coach',
    ...extra,
  };
}

function info(extra: Partial<SelectionInfo> = {}): SelectionInfo {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    team_name: '17 & Under squad',
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    is_me: true,
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    criteria: CRITERIA,
    dates: [{ title: 'Teams named', due_on: '2026-10-28', done: false }],
    ...extra,
  };
}

describe('feedback under Selection, for an athlete or a parent', () => {
  async function openSelection(who: Who, feedback: SharedFeedback[] | null, rounds: SelectionInfo[] = [], options: BackendOptions = {}) {
    await openScreen(who, { selection: SelectionScreen }, '/selection', {}, {
      rpcs: { my_selection_info: rounds, my_selection_feedback: feedback },
      ...options,
    });
  }

  it('asks only for the member’s own feedback and rounds', async () => {
    await openSelection('athlete', []);
    expect(assessmentRpcs().sort()).toEqual(['my_selection_feedback', 'my_selection_info']);
    expect(rpcCalls('my_selection_feedback')).toEqual([{}]);
  });

  it('shows an athlete their feedback, who it is from and when', async () => {
    await openSelection('athlete', [shared()]);
    expect(screen.getByText('Feedback for you')).toBeTruthy();
    expect(screen.getByText(`2027 selection phase · from Casey Coach, ${d('2026-10-17')}`)).toBeTruthy();
    expect(screen.getByText('What went well')).toBeTruthy();
    expect(screen.getByText('Reads the play early')).toBeTruthy();
    expect(screen.getByText('What to work on')).toBeTruthy();
    expect(screen.getByText('Left-hand pass')).toBeTruthy();
  });

  it('puts feedback above the round’s dates and criteria', async () => {
    await openSelection('athlete', [shared()], [info()]);
    const order = screen.getAllByText(/^(Feedback for you|What the selectors look for)$/).map((n) => n.props.children);
    expect(order).toEqual(['Feedback for you', 'What the selectors look for']);
  });

  it('names the child on a parent’s screen', async () => {
    await openSelection('guardian', [shared({ is_me: false }), shared({ is_me: false, athlete_id: 'a2', athlete_name: null })]);
    expect(screen.getByText('Feedback for Jordan Junior')).toBeTruthy();
    expect(screen.getByText('Feedback for your child')).toBeTruthy();
  });

  it('leaves out a box the coach left empty', async () => {
    await openSelection('athlete', [shared({ went_well: '' })]);
    expect(screen.queryByText('What went well')).toBeNull();
    expect(screen.getByText('What to work on')).toBeTruthy();
  });

  it('offers nothing to write, answer or press, and says so', async () => {
    await openSelection('athlete', [shared()], [info()]);
    expect(screen.getAllByText('You can’t reply here. Talk to your coach if you have a question.')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/Add|Comment|Send/)).toBeNull();
  });

  it('records that each piece of feedback shown was read, once', async () => {
    await openSelection('guardian', [shared({ is_me: false }), shared({ is_me: false, athlete_id: 'a2', round_id: 'r2' })]);
    expect(rpcCalls('mark_selection_feedback_seen')).toEqual([ARGS, { p_round_id: 'r2', p_athlete_id: 'a2' }]);
    await pullToRefresh();
    expect(rpcCalls('mark_selection_feedback_seen')).toHaveLength(2);
    expect(rpcCalls('my_selection_feedback')).toHaveLength(2);
  });

  it('records nothing with no feedback to show', async () => {
    await openSelection('athlete', [], [info()]);
    expect(rpcNames()).not.toContain('mark_selection_feedback_seen');
    expect(screen.queryByText(/Feedback/)).toBeNull();
  });

  it('shows feedback from a closed round with no round open, and none of the “no round” line', async () => {
    await openSelection('athlete', [shared()]);
    expect(screen.getByText('Feedback for you')).toBeTruthy();
    expect(screen.queryByText('There is no selection round open for you now.')).toBeNull();
    expect(screen.queryByText(/There is no score or ranking/)).toBeNull();
  });

  it.each([[[] as SharedFeedback[]], [null]])('still says when there is no round and no feedback (%j)', async (rows) => {
    await openSelection('athlete', rows);
    expect(screen.getByText('There is no selection round open for you now.')).toBeTruthy();
  });

  it('shows nothing, and asks for nothing, while the feature is off', async () => {
    setClubFeatures({});
    await openSelection('athlete', [shared()]);
    expect(rpcNames()).not.toContain('my_selection_feedback');
    expect(rpcNames()).not.toContain('mark_selection_feedback_seen');
    expect(screen.queryByText('Feedback for you')).toBeNull();
  });
});

describe('feedback on Home', () => {
  async function openHome(who: Who, rpcs: Record<string, unknown>) {
    await openScreen(who, { index: HomeScreen, selection: placeholder('selection') }, '/', {}, { rpcs });
  }

  it('leads the Selection card with the feedback, and opens Selection', async () => {
    await openHome('athlete', { my_selection_info: [info()], my_selection_feedback: [shared()] });
    expect(screen.getByText('Feedback from the coach')).toBeTruthy();
    await press('Feedback from the coach');
    expect(screen.getByText('screen:selection')).toBeTruthy();
  });

  it('shows the card for feedback from a closed round, with no round open', async () => {
    await openHome('guardian', { my_selection_info: [], my_selection_feedback: [shared({ is_me: false })] });
    expect(screen.getByText('Selection')).toBeTruthy();
    expect(screen.getByText('Feedback from the coach')).toBeTruthy();
  });

  it('goes back to the open round’s next date when the feedback is from an earlier round', async () => {
    await openHome('athlete', { my_selection_info: [info()], my_selection_feedback: [shared({ round_id: 'r0' })] });
    expect(screen.getByText(`2027 selection phase · next: Teams named, ${d('2026-10-28')}`)).toBeTruthy();
    expect(screen.queryByText('Feedback from the coach')).toBeNull();
  });

  it('shows no card with neither', async () => {
    await openHome('athlete', { my_selection_info: [], my_selection_feedback: [] });
    expect(rpcNames()).toContain('my_selection_feedback');
    expect(screen.queryByText('Selection')).toBeNull();
  });

  it.each(['coach', 'admin', 'committee'] as const)('asks for no feedback for a %s', async (who) => {
    await openHome(who, { my_selection_feedback: [shared()] });
    expect(rpcNames()).not.toContain('my_selection_feedback');
    expect(screen.queryByText('Feedback from the coach')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The audit report

describe('feedback in the Selection audit report', () => {
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
      criteria_groups: 1,
      criteria_items: 2,
      athletes: 3,
      observations: 0,
      today: TODAY,
    },
    panel: [],
    selectors: [],
    athletes: [],
  } as unknown as SelectionAudit;

  const RECORD: AdminFeedback = {
    athletes: 3,
    shared: [
      { athlete_name: 'Jordan Junior', shared_at: '2026-10-17T03:00:00Z', shared_by_name: 'Casey Coach', seen_at: '2026-10-18T01:00:00Z', withdrawn: 1 },
      { athlete_name: 'Kai Senior', shared_at: '2026-10-16T03:00:00Z', shared_by_name: 'Casey Coach', seen_at: null, withdrawn: 0 },
      { athlete_name: null, shared_at: null, shared_by_name: 'Casey Coach', seen_at: null, withdrawn: 2 },
    ],
  };

  async function openAudit(record: AdminFeedback | null, options: BackendOptions = {}) {
    await openScreen('admin', { 'admin/assessments/audit': AdminAuditScreen }, '/admin/assessments/audit?id=r1', {}, {
      rpcs: { admin_selection_audit: AUDIT, admin_selection_feedback: record },
      ...options,
    });
  }

  it('asks for that round’s feedback record', async () => {
    await openAudit(RECORD);
    expect(onlyRpcCall('admin_selection_feedback')).toEqual({ p_round_id: 'r1' });
  });

  it('shows who was given feedback, when, by whom, when it was read and how often it was taken back', async () => {
    await openAudit(RECORD);
    expect(screen.getByText('Feedback shared')).toBeTruthy();
    expect(screen.getByText(/2 of 3 athletes have feedback shared now\. What it says is not shown\./)).toBeTruthy();
    expect(screen.getByText('Jordan Junior')).toBeTruthy();
    expect(screen.getByText(`Shared: ${d('2026-10-17')}`)).toBeTruthy();
    expect(screen.getByText(`First read: ${d('2026-10-18')}`)).toBeTruthy();
    expect(screen.getByText('Taken back: 1 time')).toBeTruthy();
    expect(screen.getByText('First read: Not yet')).toBeTruthy();
    expect(screen.getByText('Shared: Taken back')).toBeTruthy();
    expect(screen.getByText('Taken back: 2 times')).toBeTruthy();
    expect(screen.getAllByText('By: Casey Coach')).toHaveLength(3);
  });

  it('says when none has been shared', async () => {
    await openAudit({ athletes: 3, shared: [] });
    expect(screen.getByText('No feedback has been shared.')).toBeTruthy();
    expect(screen.getByText(/0 of 3 athletes have feedback shared now/)).toBeTruthy();
  });

  it('leaves the section out when the database gives no record', async () => {
    await openAudit(null);
    expect(screen.getByText('The round')).toBeTruthy();
    expect(screen.queryByText('Feedback shared')).toBeNull();
  });

  it('asks for no record when the audit itself is refused', async () => {
    await openAudit(RECORD, { rpcErrors: { admin_selection_audit: 'Only admins can build the audit report' } });
    expect(screen.getByText('Only admins can build the audit report')).toBeTruthy();
    expect(rpcCalls('admin_selection_feedback')).toEqual([]);
  });
});
