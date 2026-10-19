/**
 * The survey list (src/app/surveys/index.tsx), one survey
 * (src/app/surveys/[id].tsx) and its results (src/app/surveys/results.tsx).
 *
 * What a member may see is decided by the database (`my_surveys`,
 * `manage_surveys`, `survey_detail`, `survey_results`), so these tests seed
 * what it would return and check the screen keeps to it: anonymous answers
 * are never shown back, even to the member who gave them; a parent's copy of
 * a child's survey never lets the parent answer; only senders, the committee
 * and admins get results; captains can't download them; and the team only
 * ever sees totals (user guide sections 3, 5, 6 and 8).
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text, TextInput } from 'react-native';

import SurveyScreen from '@/app/surveys/[id]';
import SurveysScreen from '@/app/surveys/index';
import SurveyResultsScreen from '@/app/surveys/results';
import { formatDateString } from '@/lib/injuries';
import { sharePdf } from '@/lib/reports';
import { shareXlsx } from '@/lib/survey-reports';
import type {
  ManagedSurvey,
  MySurvey,
  SurveyDetail,
  SurveyGroupResults,
  SurveyResults,
} from '@/lib/surveys';

import { clearCalls, onlyRpcCall, rpcCalls, rpcNames } from './helpers/calls';
import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TODAY,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  useAdminPushNotifications: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
// The share sheet and file building, so downloads can be checked without a phone.
jest.mock('@/lib/reports', () => ({
  ...jest.requireActual('@/lib/reports'),
  sharePdf: jest.fn(async () => {}),
}));
jest.mock('@/lib/survey-reports', () => ({
  ...jest.requireActual('@/lib/survey-reports'),
  shareXlsx: jest.fn(async () => {}),
}));
jest.mock('@/lib/pdf', () => ({ reportPdf: jest.fn(() => new Uint8Array([1])) }));
jest.mock('@/lib/xlsx', () => ({ workbookXlsx: jest.fn(() => new Uint8Array([2])) }));

type Who = PersonaName | Persona;

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  clearCalls();
  (sharePdf as jest.Mock).mockClear();
  (shareXlsx as jest.Mock).mockClear();
});

function Placeholder({ route }: { route: string }) {
  return <Text>{`screen:${route}`}</Text>;
}
const placeholder = (route: string) =>
  function Shown() {
    return <Placeholder route={route} />;
  };

const press = async (text: string | RegExp, index = 0) => {
  fireEvent.press(screen.getAllByText(text)[index]);
  await settle(4);
};

// ---------------------------------------------------------------------------
// The list

function mine(extra: Partial<MySurvey> = {}): MySurvey {
  return {
    id: 's1',
    title: 'End of season survey',
    identity: 'anonymous',
    opens_at: '2026-10-10T00:00:00Z',
    closes_at: '2026-10-25T00:00:00Z',
    created_by_name: 'Sample committee',
    for_child_names: null,
    from_child: false,
    responded: false,
    is_open: true,
    everyone_answers: false,
    ...extra,
  };
}

function managed(extra: Partial<ManagedSurvey> = {}): ManagedSurvey {
  return {
    id: 'm1',
    title: 'Friday extra session',
    identity: 'named',
    audience: 'group',
    audience_role: null,
    audience_label: TEAM.name,
    opens_at: '2026-10-10T00:00:00Z',
    closes_at: '2026-10-25T00:00:00Z',
    created_by: 'coach',
    created_by_name: 'Sample coach',
    sent_as: 'leader',
    share_with_committee: false,
    share_with_admins: false,
    sent_to: 12,
    answered: 4,
    status: 'open',
    ...extra,
  };
}

async function openList(who: Who, my: MySurvey[], club: ManagedSurvey[] = []) {
  await openScreen(
    who,
    { 'surveys/index': SurveysScreen, 'surveys/[id]': placeholder('surveys/[id]'), 'surveys/new': placeholder('surveys/new') },
    '/surveys',
    {},
    { rpcs: { my_surveys: my, manage_surveys: club } },
  );
}

const closesDay = formatDateString('2026-10-24');

describe('the survey list', () => {
  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
    ['physio', 'physio'],
    ['coach whose check lapsed', 'coachExpiredCheck'],
    ['stood-down coach', 'stoodDownCoach'],
    ['committee member whose check lapsed', 'committeeExpiredCheck'],
  ])('gives a %s only the surveys sent to them, with no way to send one', async (_l, who) => {
    await openList(who, [mine()], [managed()]);
    expect(screen.queryByText('New survey')).toBeNull();
    expect(screen.queryByText('Sent to me')).toBeNull();
    expect(rpcNames()).not.toContain('manage_surveys');
    expect(screen.getByText('End of season survey')).toBeTruthy();
    expect(screen.queryByText('Friday extra session')).toBeNull();
  });

  it.each<[string, string, Who]>([
    ['committee member', 'Club surveys', 'committee'],
    ['admin', 'Club surveys', 'admin'],
    ['coach', 'My groups', 'coach'],
    ['assistant coach', 'My groups', morePersonas.assistantCoach],
    ['manager', 'My groups', 'manager'],
    ['captain', 'My groups', 'captain'],
  ])('lets a %s send surveys and read the ones they can manage, under %s', async (_l, tab, who) => {
    await openList(who, [mine()], [managed()]);
    expect(screen.getByText('New survey')).toBeTruthy();
    expect(screen.getByText('Sent to me')).toBeTruthy();
    expect(screen.getByText(tab)).toBeTruthy();
    // They start on the surveys sent to them, when there are some.
    expect(screen.getByText('End of season survey')).toBeTruthy();
    await press(tab);
    expect(screen.getByText('Friday extra session')).toBeTruthy();
    expect(screen.queryByText('End of season survey')).toBeNull();
  });

  it('doesn’t let a captain send polls while the club has captains’ polls off', async () => {
    setClubFeatures({ captainPolls: false });
    await openList('captain', [mine()]);
    expect(screen.queryByText('New survey')).toBeNull();
    expect(rpcNames()).not.toContain('manage_surveys');
  });

  it('starts a committee member with no surveys of their own on the club’s', async () => {
    await openList('committee', [], [managed()]);
    expect(screen.getByText('Friday extra session')).toBeTruthy();
  });

  it('opens New survey', async () => {
    await openList('coach', []);
    await press('New survey');
    expect(screen.getByText('screen:surveys/new')).toBeTruthy();
  });

  it('says where each survey sent to the member is up to', async () => {
    await openList('athlete', [
      mine({ id: 'a', title: 'Open, not answered' }),
      mine({ id: 'b', title: 'Answered', responded: true }),
      mine({ id: 'c', title: 'Missed', is_open: false }),
      mine({ id: 'd', title: 'Named one', identity: 'named', responded: true, is_open: false }),
    ]);
    expect(screen.getByText('Not answered yet')).toBeTruthy();
    expect(screen.getAllByText('✓ You’ve answered')).toHaveLength(2);
    expect(screen.getByText('You didn’t answer')).toBeTruthy();
    expect(screen.getAllByText(`Anonymous · Open until ${closesDay}`)).toHaveLength(2);
    expect(screen.getByText(`Anonymous · Closed ${closesDay}`)).toBeTruthy();
    expect(screen.getByText(`Named · Closed ${closesDay}`)).toBeTruthy();
  });

  it('marks a parent’s copies as their child’s to answer, or sent by their child', async () => {
    await openList('guardian', [
      mine({ id: 'a', for_child_names: ['Sample Child'] }),
      mine({ id: 'b', title: 'Team dinner', for_child_names: ['Sample Child'], from_child: true }),
    ]);
    expect(screen.getByText('For Sample Child to answer')).toBeTruthy();
    expect(screen.getByText('Sent by Sample Child')).toBeTruthy();
    expect(screen.queryByText('Not answered yet')).toBeNull();
  });

  it('opens a survey when tapped', async () => {
    await openList('athlete', [mine()]);
    await press('End of season survey');
    expect(screen.getByText('screen:surveys/[id]')).toBeTruthy();
    expect(screen).toHavePathname('/surveys/s1');
  });

  it('shows each managed survey’s audience, sender, sharing and answers', async () => {
    await openList('admin', [], [
      managed(),
      managed({ id: 'm2', title: 'Shared one', share_with_admins: true, share_with_committee: true }),
      managed({ id: 'm3', title: 'Admins only', share_with_admins: true, created_by_name: null }),
      managed({
        id: 'm4',
        title: 'Club survey',
        identity: 'anonymous',
        audience: 'role',
        audience_role: 'guardian',
        audience_label: null,
        sent_as: 'committee',
        status: 'scheduled',
        opens_at: '2026-10-20T00:00:00Z',
      }),
      managed({ id: 'm5', title: 'Old one', status: 'closed', audience: 'club' }),
    ]);
    expect(screen.getByText(`Named · To ${TEAM.name} · From Sample coach`)).toBeTruthy();
    expect(
      screen.getByText(`Named · To ${TEAM.name} · From Sample coach · Shared with the committee and admins`),
    ).toBeTruthy();
    expect(screen.getByText(`Named · To ${TEAM.name} · From a member · Shared with admins`)).toBeTruthy();
    // The committee's own surveys don't name a sender.
    expect(screen.getByText('Anonymous · To All guardians')).toBeTruthy();
    expect(screen.getByText(`Opens ${formatDateString('2026-10-20')} · 4 of 12 answered`)).toBeTruthy();
    expect(screen.getByText('Named · To Everyone in the club · From Sample coach')).toBeTruthy();
    expect(screen.getByText(`Closed ${closesDay} · 4 of 12 answered`)).toBeTruthy();
  });

  it('says what an empty list is for', async () => {
    await openList('athlete', []);
    expect(screen.getByText('No surveys yet. Surveys and polls sent to you will show here.')).toBeTruthy();
  });

  it('says what an empty club list is for', async () => {
    await openList('committee', [], []);
    expect(screen.getByText('No surveys yet. Tap New survey to send the first one.')).toBeTruthy();
  });

  it('doesn’t ask for surveys while the club has Surveys off', async () => {
    setClubFeatures({ surveys: false });
    await openList('athlete', [mine()]);
    expect(rpcNames()).not.toContain('my_surveys');
    expect(screen.queryByText('End of season survey')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One survey

const QUESTIONS: SurveyDetail['questions'] = [
  { id: 'q1', kind: 'choice', prompt: 'Which night suits you?', options: ['Tuesday', 'Thursday'], rating_max: null, required: true },
  { id: 'q2', kind: 'multi_choice', prompt: 'What should we add?', options: ['Yoga', 'Gym', 'Pool'], rating_max: null, required: false },
  { id: 'q3', kind: 'rating', prompt: 'How was the season?', options: null, rating_max: 5, required: false },
  { id: 'q4', kind: 'text', prompt: 'Anything else?', options: null, rating_max: null, required: false },
];

function detail(extra: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1',
    title: 'End of season survey',
    intro: 'Help plan next season',
    identity: 'anonymous',
    audience: 'club',
    audience_role: null,
    audience_label: null,
    opens_at: '2026-10-10T00:00:00Z',
    closes_at: '2026-10-25T00:00:00Z',
    created_by: 'committee',
    created_by_name: 'Sample committee',
    is_open: true,
    is_scheduled: false,
    is_recipient: true,
    sent_as: 'committee',
    share_with_committee: false,
    share_with_admins: false,
    everyone_answers: false,
    results_at_percent: null,
    results_to_group: false,
    can_see_results: false,
    can_close: false,
    for_child_names: null,
    from_child: false,
    can_answer: true,
    responded: false,
    questions: QUESTIONS,
    my_answers: null,
    children: [],
    ...extra,
  };
}

const GROUP_RESULTS: SurveyGroupResults = {
  sent_to: 10,
  answered: 6,
  wait: null,
  closed: false,
  questions: [
    { id: 'q1', kind: 'choice', prompt: 'Which night suits you?', options: ['Tuesday', 'Thursday'], rating_max: null, answered: 6, counts: [4, 2], average: null },
    { id: 'q3', kind: 'rating', prompt: 'How was the season?', options: null, rating_max: 5, answered: 5, counts: [0, 0, 1, 2, 2], average: 4.2 },
  ],
};

async function openSurvey(
  who: Who,
  shown: SurveyDetail | ((call: number) => SurveyDetail),
  { error, groupResults = GROUP_RESULTS, submitError, closeError }: {
    error?: string;
    groupResults?: SurveyGroupResults;
    submitError?: string;
    closeError?: string;
  } = {},
) {
  let calls = 0;
  await openScreen(
    who,
    { 'surveys/[id]': SurveyScreen, 'surveys/results': placeholder('surveys/results') },
    '/surveys/s1',
    {},
    {
      rpcHandlers: {
        survey_detail: () => (typeof shown === 'function' ? shown(calls++) : shown),
        survey_group_results: () => groupResults,
      },
      rpcErrors: {
        ...(error ? { survey_detail: error } : {}),
        ...(submitError ? { submit_survey_response: submitError } : {}),
        ...(closeError ? { set_survey_closing: closeError } : {}),
      },
    },
  );
}

describe('answering a survey', () => {
  it('asks for the survey by its id', async () => {
    await openSurvey('athlete', detail());
    expect(rpcCalls('survey_detail')).toEqual([{ p_survey_id: 's1' }]);
    expect(screen.getByText('End of season survey')).toBeTruthy();
    expect(screen.getByText('Anonymous · From Sample committee · To Everyone in the club')).toBeTruthy();
    expect(screen.getByText(`Open until ${closesDay}`)).toBeTruthy();
    expect(screen.getByText('Help plan next season')).toBeTruthy();
  });

  it('tells the member an anonymous survey can’t be traced to them', async () => {
    await openSurvey('athlete', detail());
    expect(
      screen.getByText(
        'This survey is anonymous. Nobody, including whoever sent it, can see who gave which answers.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Your name')).toBeNull();
  });

  it.each<[string, Partial<SurveyDetail>, string]>([
    ['from the committee', { sent_as: 'committee' }, 'whoever sent it, the committee and admins'],
    ['from a coach, kept with them', { sent_as: 'leader' }, 'whoever sent it'],
    ['from a coach, shared with admins', { sent_as: 'leader', share_with_admins: true }, 'whoever sent it and admins'],
    [
      'from a coach, shared with the committee',
      { sent_as: 'leader', share_with_admins: true, share_with_committee: true },
      'whoever sent it, the committee and admins',
    ],
    ['from a captain', { sent_as: 'captain' }, 'whoever sent it and the group’s coaches and managers'],
  ])('says who sees named answers on a survey %s', async (_l, extra, seenBy) => {
    await openSurvey('athlete', detail({ identity: 'named', ...extra }));
    expect(screen.getByText(`Your name goes with your answers. Only ${seenBy} see them.`)).toBeTruthy();
  });

  it('says the team sees only the totals when they’re shared', async () => {
    await openSurvey('athlete', detail({ identity: 'named', sent_as: 'leader', results_to_group: true, is_open: true }), {
      groupResults: { ...GROUP_RESULTS, wait: 'min' },
    });
    expect(screen.getByText('Everyone it went to sees the totals, never who picked what.')).toBeTruthy();
  });

  it('won’t send until every required question is answered', async () => {
    await openSurvey('athlete', detail());
    await press('Send answers');
    expect(screen.getByText('Answer “Which night suits you?”.')).toBeTruthy();
    expect(rpcCalls('submit_survey_response')).toEqual([]);
  });

  it('sends each kind of answer, skipping the optional ones left blank', async () => {
    await openSurvey('athlete', detail());
    await press('Thursday');
    await press('Pool');
    await press('Yoga');
    await press('Gym');
    // Tapping a picked choice again takes it off.
    await press('Gym');
    await press('4');
    fireEvent.changeText(screen.getByPlaceholderText('Write your answer'), 'More pool sessions');
    await press('Send answers');
    expect(onlyRpcCall('submit_survey_response')).toEqual({
      p_survey_id: 's1',
      p_answers: [
        { question_id: 'q1', choices: [1], rating: null, text: null },
        // In the order the choices are listed, whatever order they were tapped.
        { question_id: 'q2', choices: [0, 2], rating: null, text: null },
        { question_id: 'q3', choices: null, rating: 4, text: null },
        { question_id: 'q4', choices: null, rating: null, text: 'More pool sessions' },
      ],
      p_give_name: false,
    });
    // It loads again to show the answers are in.
    expect(rpcCalls('survey_detail')).toHaveLength(2);
  });

  it('keeps one choice on a one-choice question', async () => {
    await openSurvey('athlete', detail({ questions: [QUESTIONS[0]] }));
    await press('Tuesday');
    await press('Thursday');
    await press('Send answers');
    expect(onlyRpcCall('submit_survey_response').p_answers).toEqual([
      { question_id: 'q1', choices: [1], rating: null, text: null },
    ]);
  });

  it('shows the rating scale the sender chose', async () => {
    await openSurvey('athlete', detail({ questions: [{ ...QUESTIONS[2], rating_max: 10 }] }));
    expect(screen.getByText('1 is lowest, 10 is highest')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('1. How was the season? (optional)')).toBeTruthy();
  });

  it.each([
    ['gives their name', 'Give my name', true],
    ['keeps their name off', 'Don’t give my name', false],
  ] as const)('sends whether a member %s on a name-optional survey', async (_l, chip, given) => {
    await openSurvey('athlete', detail({ identity: 'optional', questions: [QUESTIONS[0]] }));
    expect(screen.getByText('Your name')).toBeTruthy();
    await press('Tuesday');
    await press(chip);
    await press('Send answers');
    expect(onlyRpcCall('submit_survey_response').p_give_name).toBe(given);
  });

  it('never sends a name on an anonymous survey', async () => {
    await openSurvey('athlete', detail({ questions: [QUESTIONS[0]] }));
    await press('Tuesday');
    await press('Send answers');
    expect(onlyRpcCall('submit_survey_response').p_give_name).toBe(false);
  });

  it('shows the database’s refusal and keeps the answers', async () => {
    await openSurvey('athlete', detail({ questions: [QUESTIONS[0]] }), {
      submitError: 'You’ve already answered this survey',
    });
    await press('Tuesday');
    await press('Send answers');
    expect(screen.getByText('You’ve already answered this survey')).toBeTruthy();
    expect(screen.getByText('Send answers')).toBeTruthy();
    expect(rpcCalls('survey_detail')).toHaveLength(1);
  });

  it.each<[string, Partial<SurveyDetail>]>([
    ['anonymous', {}],
    ['name-optional', { identity: 'optional' }],
  ])('reminds an under-18 athlete nobody can reply to a written %s answer', async (_l, extra) => {
    await openSurvey(morePersonas.under18Athlete, detail(extra));
    expect(screen.getByText(/^Because you might not give your name, nobody can reply to what you write here\./)).toBeTruthy();
  });

  it.each<[string, Who, Partial<SurveyDetail>]>([
    ['an adult athlete', 'athlete', {}],
    ['an under-18 athlete on a named survey', morePersonas.under18Athlete, { identity: 'named' }],
    ['an under-18 athlete with no written question', morePersonas.under18Athlete, { questions: [QUESTIONS[0]] }],
  ])('doesn’t show the reminder to %s', async (_l, who, extra) => {
    await openSurvey(who, detail(extra));
    expect(screen.queryByText(/^Because you might not give your name/)).toBeNull();
  });

  it('says when everyone must answer while it’s open', async () => {
    await openSurvey('athlete', detail({ everyone_answers: true }));
    expect(screen.getByText('Everyone must answer this one.')).toBeTruthy();
  });

  it('shows a closed survey’s questions with no way to answer', async () => {
    await openSurvey('athlete', detail({ is_open: false, can_answer: false, everyone_answers: true }));
    expect(screen.getByText(`Closed ${closesDay}`)).toBeTruthy();
    expect(screen.queryByText('Everyone must answer this one.')).toBeNull();
    expect(screen.queryByText('Send answers')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
    expect(screen.getByText('Tuesday · Thursday')).toBeTruthy();
    expect(screen.getByText('Rating from 1 to 5')).toBeTruthy();
    expect(screen.getByText('Written answer')).toBeTruthy();
  });

  it('says when a scheduled survey opens', async () => {
    await openSurvey('committee', detail({ is_scheduled: true, is_open: false, can_answer: false, opens_at: '2026-10-20T00:00:00Z' }));
    expect(screen.getByText(`Opens ${formatDateString('2026-10-20')}`)).toBeTruthy();
  });

  it('shows the database’s refusal when the survey can’t be opened', async () => {
    await openSurvey('athlete', detail(), { error: 'Survey not found' });
    expect(screen.getByText('Survey not found')).toBeTruthy();
    expect(screen.queryByText('Send answers')).toBeNull();
  });
});

describe('after answering', () => {
  it('never shows an anonymous answer back, even to the member who gave it', async () => {
    await openSurvey('athlete', detail({ can_answer: false, responded: true, my_answers: null }));
    expect(screen.getByText('✓ Thanks, your answers are in')).toBeTruthy();
    expect(screen.getByText('Your answers aren’t linked to you, so they can’t be shown here.')).toBeTruthy();
    expect(screen.queryByText('Skipped')).toBeNull();
  });

  it('shows a member their own named answers, and what they skipped', async () => {
    await openSurvey(
      'athlete',
      detail({
        identity: 'named',
        can_answer: false,
        responded: true,
        my_answers: [
          { question_id: 'q1', choices: [0], rating: null, text: null },
          { question_id: 'q2', choices: [0, 2], rating: null, text: null },
          { question_id: 'q3', choices: null, rating: 4, text: null },
        ],
      }),
    );
    expect(screen.getByText('Tuesday')).toBeTruthy();
    expect(screen.getByText('Yoga, Pool')).toBeTruthy();
    expect(screen.getByText('4 out of 5')).toBeTruthy();
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.queryByText(/aren’t linked to you/)).toBeNull();
  });
});

describe('a parent’s copy of their child’s survey', () => {
  const copy = (extra: Partial<SurveyDetail> = {}) =>
    detail({ can_answer: false, is_recipient: false, for_child_names: ['Sample Child'], ...extra });

  it('shows what the child is asked, with no way for the parent to answer', async () => {
    await openSurvey('guardian', copy());
    expect(screen.getByText('Sent to Sample Child. Your copy shows what they’re asked.')).toBeTruthy();
    expect(
      screen.getByText('Answers are anonymous, so nobody can see your child’s answers, including you.'),
    ).toBeTruthy();
    expect(screen.queryByText('Send answers')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });

  it('shows the child’s named answers once they’ve sent them', async () => {
    await openSurvey(
      'guardian',
      copy({
        identity: 'named',
        children: [{ name: 'Sample Child', responded: true, answers: [{ question_id: 'q1', choices: [1], rating: null, text: null }] }],
      }),
    );
    expect(screen.getByText('You can read your child’s answers here once they’ve answered.')).toBeTruthy();
    expect(screen.getByText('Their answers:')).toBeTruthy();
    expect(screen.getByText('Thursday')).toBeTruthy();
  });

  it('says when a child answered without their name, and shows nothing of it', async () => {
    await openSurvey(
      'guardian',
      copy({ identity: 'optional', children: [{ name: 'Sample Child', responded: true, answers: [] }] }),
    );
    expect(
      screen.getByText('Answered without giving their name, so their answers can’t be shown.'),
    ).toBeTruthy();
    expect(screen.queryByText('Skipped')).toBeNull();
  });

  it('says when a child hasn’t answered yet', async () => {
    await openSurvey('guardian', copy({ identity: 'named', children: [{ name: 'Sample Child', responded: false, answers: [] }] }));
    expect(screen.getByText('Hasn’t answered yet.')).toBeTruthy();
  });

  it('tells a parent when their child sent the poll, without the teammates’ answers', async () => {
    await openSurvey('guardian', copy({ identity: 'named', sent_as: 'captain', from_child: true }));
    expect(
      screen.getByText('Copied to you because Sample Child sent it. Your copy shows what they asked.'),
    ).toBeTruthy();
    expect(screen.queryByText(/You can read your child’s answers/)).toBeNull();
    expect(screen.queryByText('See results')).toBeNull();
  });
});

describe('the team’s totals', () => {
  it('shows a recipient the counts and averages the sender shared, never names', async () => {
    await openSurvey('athlete', detail({ identity: 'named', sent_as: 'leader', results_to_group: true, can_answer: false, responded: true, my_answers: [] }));
    expect(rpcCalls('survey_group_results')).toEqual([{ p_survey_id: 's1' }]);
    expect(screen.getByText('Results for the team')).toBeTruthy();
    expect(screen.getByText('6 of 10 answered (60%)')).toBeTruthy();
    expect(screen.getByText('4 · 67%')).toBeTruthy();
    expect(screen.getByText('5 answered · Average 4.2 out of 5')).toBeTruthy();
  });

  it('says what the totals are waiting for', async () => {
    await openSurvey('athlete', detail({ results_to_group: true }), { groupResults: { ...GROUP_RESULTS, wait: 'closing' } });
    expect(screen.getByText(/^Results show once the survey closes, or once everyone has answered/)).toBeTruthy();
    expect(screen.queryByText('4 · 67%')).toBeNull();
  });

  it.each<[string, Partial<SurveyDetail>]>([
    ['the sender didn’t share them', { results_to_group: false }],
    ['the member wasn’t sent it', { results_to_group: true, is_recipient: false }],
    ['it hasn’t opened yet', { results_to_group: true, is_scheduled: true }],
  ])('doesn’t ask for them when %s', async (_l, extra) => {
    await openSurvey('athlete', detail(extra));
    expect(rpcNames()).not.toContain('survey_group_results');
    expect(screen.queryByText('Results for the team')).toBeNull();
  });
});

describe('results and closing from the survey', () => {
  it('offers See results only to those the database lets see them', async () => {
    await openSurvey('athlete', detail());
    expect(screen.queryByText('See results')).toBeNull();
    expect(screen.queryByText('Close it now')).toBeNull();
  });

  it('opens the results', async () => {
    await openSurvey('committee', detail({ can_see_results: true, can_answer: false }));
    await press('See results');
    expect(screen.getByText('screen:surveys/results')).toBeTruthy();
    expect(screen).toHavePathnameWithParams('/surveys/results?id=s1');
  });

  it('closes it now, after asking once more', async () => {
    await openSurvey('coach', detail({ can_see_results: true, can_close: true, can_answer: false }));
    await press('Close it now');
    expect(screen.getByText('Nobody else can answer once it’s closed.')).toBeTruthy();
    expect(rpcCalls('set_survey_closing')).toEqual([]);
    await press('Close the survey');
    expect(onlyRpcCall('set_survey_closing')).toEqual({
      p_survey_id: 's1',
      p_closes_at: TODAY.toISOString(),
    });
    expect(rpcCalls('survey_detail')).toHaveLength(2);
  });

  it('shows why it couldn’t be closed', async () => {
    await openSurvey('coach', detail({ can_see_results: true, can_close: true, can_answer: false }), {
      closeError: 'Only whoever sent it can close it',
    });
    await press('Close it now');
    await press('Close the survey');
    expect(screen.getByText('Only whoever sent it can close it')).toBeTruthy();
  });

  it('can’t be closed by someone who only reads the results', async () => {
    await openSurvey('committee', detail({ can_see_results: true, can_close: false, can_answer: false }));
    expect(screen.getByText('See results')).toBeTruthy();
    expect(screen.queryByText('Close it now')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Results

function results(extra: Partial<SurveyResults> = {}, survey: Partial<SurveyResults['survey']> = {}): SurveyResults {
  return {
    survey: {
      id: 's1',
      title: 'End of season survey',
      identity: 'anonymous',
      audience: 'club',
      audience_role: null,
      audience_label: null,
      opens_at: '2026-10-10T00:00:00Z',
      closes_at: '2026-10-25T00:00:00Z',
      created_by_name: 'Sample committee',
      sent_as: 'committee',
      everyone_answers: false,
      results_at_percent: null,
      results_to_group: false,
      ...survey,
    },
    can_export: true,
    sent_to: 20,
    answered: 5,
    hidden: false,
    wait: null,
    closed: true,
    can_close: false,
    min_responses: 3,
    questions: [
      { id: 'q1', kind: 'choice', prompt: 'Which night suits you?', options: ['Tuesday', 'Thursday'], rating_max: null, answered: 5, counts: [3, 2], average: null, texts: null },
      { id: 'q3', kind: 'rating', prompt: 'How was the season?', options: null, rating_max: 5, answered: 4, counts: [0, 0, 1, 1, 2], average: 4.3, texts: null },
      {
        id: 'q4',
        kind: 'text',
        prompt: 'Anything else?',
        options: null,
        rating_max: null,
        answered: 2,
        counts: null,
        average: null,
        texts: [
          { text: 'More pool sessions', name: null },
          { text: 'Thanks coaches', name: 'Sample athlete' },
        ],
      },
    ],
    respondents: [],
    waiting: [],
    ...extra,
  };
}

async function openResults(
  who: Who,
  shown: SurveyResults,
  { error, closeError, exportError }: { error?: string; closeError?: string; exportError?: string } = {},
) {
  await openScreen(
    who,
    { 'surveys/results': SurveyResultsScreen },
    '/surveys/results?id=s1',
    {},
    {
      rpcHandlers: {
        survey_results: () => shown,
        survey_export: () => ({
          survey: shown.survey,
          sent_to: shown.sent_to,
          answered: shown.answered,
          questions: shown.questions.map(({ id, kind, prompt, options, rating_max }) => ({ id, kind, prompt, options, rating_max })),
          responses: [],
          waiting: [],
        }),
      },
      rpcErrors: {
        ...(error ? { survey_results: error } : {}),
        ...(closeError ? { set_survey_closing: closeError } : {}),
        ...(exportError ? { survey_export: exportError } : {}),
      },
    },
  );
}

describe('a survey’s results', () => {
  it('asks for the survey’s results by its id', async () => {
    await openResults('committee', results());
    expect(rpcCalls('survey_results')).toEqual([{ p_survey_id: 's1' }]);
    expect(screen.getByText('5 of 20 answered (25%)')).toBeTruthy();
  });

  it('shows the counts, averages and every written answer, with names only where given', async () => {
    await openResults('committee', results());
    expect(screen.getByText('1. Which night suits you?')).toBeTruthy();
    expect(screen.getByText('3 · 60%')).toBeTruthy();
    expect(screen.getByText('4 answered · Average 4.3 out of 5')).toBeTruthy();
    expect(screen.getByText('More pool sessions')).toBeTruthy();
    expect(screen.getByText('Thanks coaches')).toBeTruthy();
    expect(screen.getByText('Sample athlete')).toBeTruthy();
    expect(screen.queryByText('Named answers')).toBeNull();
    expect(screen.queryByText('Not answered yet')).toBeNull();
  });

  it('shows each named answer with its name, and who hasn’t answered', async () => {
    await openResults(
      'coach',
      results(
        {
          respondents: [
            {
              name: 'Sample athlete',
              submitted_at: '2026-10-15T00:00:00Z',
              answers: [
                { question_id: 'q1', choices: [1], rating: null, text: null },
                { question_id: 'q3', choices: null, rating: 5, text: null },
              ],
            },
          ],
          waiting: ['Sample Child', 'Another Athlete'],
        },
        { identity: 'named' },
      ),
    );
    expect(screen.getByText('Named answers')).toBeTruthy();
    expect(screen.getByText('Which night suits you?: Thursday')).toBeTruthy();
    expect(screen.getByText('How was the season?: 5 out of 5')).toBeTruthy();
    expect(screen.getByText('Not answered yet')).toBeTruthy();
    expect(screen.getByText('Sample Child, Another Athlete')).toBeTruthy();
  });

  it('says what hidden results wait for, and shows none of them', async () => {
    await openResults('committee', results({ hidden: true, wait: 'closing', closed: false, answered: 2, questions: [] }));
    expect(screen.getByText(/^Results show once the survey closes, or once everyone has answered/)).toBeTruthy();
    expect(screen.queryByText('Download PDF summary')).toBeNull();
    expect(screen.queryByText('Close now and see results')).toBeNull();
  });

  it.each([
    ['min', { identity: 'named' as const }, 'Results show once at least 3 people have answered.'],
    ['min', { identity: 'anonymous' as const }, 'Results show once at least 3 people have answered, so nobody can be picked out.'],
    ['everyone', { everyone_answers: true }, 'Everyone must answer, so results show once everyone has answered or the survey closes.'],
    ['percent', { identity: 'named' as const, results_at_percent: 80 }, 'Results show once 80% have answered, or the survey closes.'],
  ] as const)('explains a %s wait in words', async (wait, survey, text) => {
    await openResults('committee', results({ hidden: true, wait, closed: false }, survey));
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('closes a waiting survey to accept the answers so far, after asking once more', async () => {
    await openResults(
      'committee',
      results({ hidden: true, wait: 'everyone', closed: false, can_close: true, answered: 4 }, { identity: 'named', everyone_answers: true }),
    );
    expect(screen.getByText('Everyone must answer.')).toBeTruthy();
    await press('Close now and see results');
    expect(
      screen.getByText('Nobody else can answer once it’s closed. Results show with the answers so far.'),
    ).toBeTruthy();
    await press('Close the survey');
    expect(onlyRpcCall('set_survey_closing')).toEqual({ p_survey_id: 's1', p_closes_at: TODAY.toISOString() });
    expect(rpcCalls('survey_results')).toHaveLength(2);
  });

  it('warns that an anonymous survey with too few answers still won’t show results', async () => {
    await openResults('committee', results({ hidden: true, wait: 'closing', closed: false, can_close: true, answered: 2 }));
    await press('Close now and see results');
    expect(
      screen.getByText('Nobody else can answer once it’s closed, and results still need at least 3 answers.'),
    ).toBeTruthy();
  });

  it('shows why a survey couldn’t be closed', async () => {
    await openResults('committee', results({ hidden: true, wait: 'closing', closed: false, can_close: true }), {
      closeError: 'This survey has already closed',
    });
    await press('Close now and see results');
    await press('Close the survey');
    expect(screen.getByText('This survey has already closed')).toBeTruthy();
  });

  it('tells the squad’s sender the team sees only totals', async () => {
    await openResults('coach', results({}, { results_to_group: true, everyone_answers: true }));
    expect(
      screen.getByText(
        'Everyone must answer. The squad or team sees how many picked each choice, never names or written answers.',
      ),
    ).toBeTruthy();
  });

  it('gives a captain no downloads', async () => {
    await openResults('captain', results({ can_export: false }, { sent_as: 'captain', identity: 'named' }));
    expect(screen.getByText('1. Which night suits you?')).toBeTruthy();
    expect(screen.queryByText('Download PDF summary')).toBeNull();
    expect(screen.queryByText('Download spreadsheet')).toBeNull();
  });

  it('says anonymous downloads carry no names or times', async () => {
    await openResults('committee', results());
    expect(screen.getByText(/ Anonymous answers have no names or times\.$/)).toBeTruthy();
  });

  it('reminds whoever downloads named answers to keep them safe', async () => {
    await openResults('committee', results({}, { identity: 'named' }));
    expect(screen.getByText(/ Keep files with members’ names safe, and delete them when you’re done\.$/)).toBeTruthy();
  });

  it('downloads the PDF summary named for the club, survey and day', async () => {
    await openResults('committee', results());
    await press('Download PDF summary');
    expect(sharePdf).toHaveBeenCalledWith('sample-end-of-season-survey-2026-10-18.pdf', new Uint8Array([1]));
  });

  it('downloads the spreadsheet from survey_export', async () => {
    await openResults('committee', results());
    await press('Download spreadsheet');
    expect(onlyRpcCall('survey_export')).toEqual({ p_survey_id: 's1' });
    expect(shareXlsx).toHaveBeenCalledWith('sample-end-of-season-survey-2026-10-18.xlsx', new Uint8Array([2]));
  });

  it('shows why the spreadsheet couldn’t be made', async () => {
    await openResults('committee', results(), { exportError: 'Not allowed' });
    await press('Download spreadsheet');
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(shareXlsx).not.toHaveBeenCalled();
  });

  it('shows the database’s refusal for someone who can’t see the results', async () => {
    await openResults(personas.athlete, results(), { error: 'You can’t see these results' });
    expect(screen.getByText('You can’t see these results')).toBeTruthy();
    expect(screen.queryByText('1. Which night suits you?')).toBeNull();
  });
});
