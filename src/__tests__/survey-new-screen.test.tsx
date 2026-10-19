/**
 * Making a survey (src/app/surveys/new.tsx): who it can go to, what each kind
 * of sender is offered, the checks before it's sent, and exactly what
 * `create_survey` is sent.
 *
 * The committee and admins send to everyone, a role, or any squad or team.
 * Coaches and managers send to the groups they lead, and only a quick poll
 * can stay with them; anything longer or with a written answer goes to admins
 * too. Captains send polls of up to 5 choice questions to the group they
 * captain (user guide sections 3, 4, 6 and 8). The database checks all of this
 * as well; these tests hold the screen to the same rules.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import NewSurveyScreen from '@/app/surveys/new';
import { endOfDayIso, startOfDayIso } from '@/lib/surveys';

import { clearCalls, onlyRpcCall, rpcCalls, rpcNames } from './helpers/calls';
import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
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

type Who = PersonaName | Persona;

// Each test fills in forms screen by screen; on a busy CI runner that can take
// longer than Jest's 5 second default.
jest.setTimeout(20000);

function SentSurvey() {
  return <Text>screen:surveys/[id]</Text>;
}

beforeEach(() => {
  resetClub();
  clearCalls();
});

async function openNew(who: Who, options: { error?: string } = {}) {
  await openScreen(
    who,
    { 'surveys/new': NewSurveyScreen, 'surveys/[id]': SentSurvey },
    '/surveys/new',
    { teams: [TEAM, TEAM_B] },
    {
      rpcHandlers: { create_survey: () => 'survey-new' },
      rpcErrors: options.error ? { create_survey: options.error } : {},
    },
  );
}

const press = async (text: string | RegExp, index = 0) => {
  fireEvent.press(screen.getAllByText(text)[index]);
  await settle(3);
};

const type = async (placeholder: string, value: string, index = 0) => {
  fireEvent.changeText(screen.getAllByPlaceholderText(placeholder)[index], value);
  await settle(2);
};

/** A title and one question with two choices: enough to send. */
async function fillMinimum(title = 'Training night') {
  await type('For example, End of season survey', title);
  await type('Write the question', 'Which night suits you?');
  await type('Write a choice', 'Tuesday', 0);
  await type('Write a choice', 'Thursday', 1);
}

async function send() {
  await press('Send survey');
  await settle();
}

const sent = () => onlyRpcCall('create_survey');

// The screen opens on 18 October 2026 and closes in two weeks by default.
const CLOSES_DEFAULT = endOfDayIso('2026-11-01');

describe('a committee member or admin making a survey', () => {
  it('sends a club-wide anonymous survey exactly as filled in, then opens it', async () => {
    await openNew('committee');
    await type('What it’s for and how answers will be used', 'Help plan next season');
    await fillMinimum();
    await send();
    expect(sent()).toEqual({
      p_title: 'Training night',
      p_intro: 'Help plan next season',
      p_identity: 'anonymous',
      p_audience: 'club',
      p_role: null,
      p_team_id: null,
      // Opening today means straight away.
      p_opens_at: null,
      p_closes_at: CLOSES_DEFAULT,
      p_questions: [
        {
          kind: 'choice',
          prompt: 'Which night suits you?',
          options: ['Tuesday', 'Thursday'],
          rating_max: null,
          required: true,
        },
      ],
      p_share_with_committee: false,
      p_share_with_admins: false,
      p_everyone_answers: false,
      p_results_at_percent: null,
      p_results_to_group: false,
    });
    expect(screen.getByText('screen:surveys/[id]')).toBeTruthy();
    expect(screen).toHavePathname('/surveys/survey-new');
  });

  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['admin', 'admin'],
  ])('lets a %s send to everyone, a role, or any squad or team', async (_l, who) => {
    await openNew(who);
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.getByText('A role')).toBeTruthy();
    await press('A squad or team');
    expect(screen.getByText('Squad or team')).toBeTruthy();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
    // Results stay with the committee and admins, and nothing is shared with the team.
    expect(screen.queryByText('Who else sees it')).toBeNull();
    expect(screen.queryByText('Share results with the squad or team')).toBeNull();
    expect(screen.getByText(/Only you, the committee and admins see results\./)).toBeTruthy();
  });

  it('sends to every member of one role', async () => {
    await openNew('committee');
    await press('A role');
    await fillMinimum();
    await send();
    expect(screen.getByText('Choose who to send it to.')).toBeTruthy();
    expect(rpcNames()).not.toContain('create_survey');
    await press('Guardians');
    await send();
    expect(sent()).toMatchObject({ p_audience: 'role', p_role: 'guardian', p_team_id: null });
  });

  it('sends to a squad or team it picks, and asks for one first', async () => {
    await openNew('admin');
    await press('A squad or team');
    await fillMinimum();
    await send();
    expect(screen.getByText('Choose a squad or team.')).toBeTruthy();
    expect(rpcNames()).not.toContain('create_survey');
    await press(TEAM_B.name);
    await send();
    expect(sent()).toMatchObject({ p_audience: 'group', p_role: null, p_team_id: TEAM_B.id });
  });

  it('offers named club surveys a results target, and sends the share chosen', async () => {
    await openNew('committee');
    await press('Named');
    expect(screen.getByText('Results show')).toBeTruthy();
    expect(screen.getByText('From 3 answers')).toBeTruthy();
    // A named club survey sets its target instead of the Answering choice.
    expect(screen.queryByText('Answering')).toBeNull();
    await press('50% answered');
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({
      p_identity: 'named',
      p_everyone_answers: false,
      p_results_at_percent: 50,
    });
  });

  it('sends Everyone must answer on a named club survey with no percentage', async () => {
    await openNew('committee');
    await press('Named');
    await press('Everyone must answer');
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({ p_everyone_answers: true, p_results_at_percent: null });
  });

  it('never sends a percentage for anonymous or name-optional surveys', async () => {
    await openNew('admin');
    await press('Name optional');
    expect(screen.queryByText('Results show')).toBeNull();
    await press('Everyone must answer');
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({
      p_identity: 'optional',
      p_everyone_answers: true,
      p_results_at_percent: null,
    });
  });

  it('says how each kind of answer is kept before it’s sent', async () => {
    await openNew('committee');
    expect(
      screen.getByText(/^Nobody can see who gave which answers, not even admins\..*This can’t be changed once it’s sent\.$/),
    ).toBeTruthy();
    await press('Named');
    expect(screen.getByText(/^Every answer shows the member’s name\./)).toBeTruthy();
    expect(
      screen.getByText(
        'Parents and guardians of athletes under 18 get a copy so they can see what their child is asked. Only the child answers.',
      ),
    ).toBeTruthy();
  });

  it('sends every kind of question with its scale, choices and whether it can be skipped', async () => {
    await openNew('committee');
    await fillMinimum();
    await press('Add a choice');
    await type('Write a choice', '  ', 2);
    await press('Several choices');
    await press('Add a question');
    await type('Write the question', 'How was the season?', 1);
    await press('Rating', 1);
    await press('1 to 10');
    await press('Can skip', 1);
    await press('Add a question');
    await type('Write the question', 'Anything else?', 2);
    await press('Written answer', 2);
    await send();
    expect(sent().p_questions).toEqual([
      // A blank choice is left out.
      {
        kind: 'multi_choice',
        prompt: 'Which night suits you?',
        options: ['Tuesday', 'Thursday'],
        rating_max: null,
        required: true,
      },
      { kind: 'rating', prompt: 'How was the season?', options: null, rating_max: 10, required: false },
      { kind: 'text', prompt: 'Anything else?', options: null, rating_max: null, required: true },
    ]);
  });

  it('removes a question it was asked to', async () => {
    await openNew('committee');
    await fillMinimum();
    await press('Add a question');
    await type('Write the question', 'Second question', 1);
    expect(screen.getAllByText('Remove question')).toHaveLength(2);
    await press('Remove question', 0);
    expect(screen.queryByText('Remove question')).toBeNull();
    await type('Write a choice', 'Yes', 0);
    await type('Write a choice', 'No', 1);
    await send();
    expect(sent().p_questions).toEqual([
      expect.objectContaining({ prompt: 'Second question', options: ['Yes', 'No'] }),
    ]);
  });

  it('opens it later when a later day is picked', async () => {
    await openNew('committee');
    await press('Tomorrow');
    await press('4 weeks');
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({
      p_opens_at: startOfDayIso('2026-10-19'),
      p_closes_at: endOfDayIso('2026-11-15'),
    });
  });
});

describe('the checks before a survey is sent', () => {
  async function expectRefused(message: string) {
    await send();
    expect(screen.getByText(message)).toBeTruthy();
    expect(rpcCalls('create_survey')).toEqual([]);
  }

  it('asks for a title', async () => {
    await openNew('committee');
    await type('Write the question', 'Q');
    await expectRefused('Give the survey a title.');
  });

  it('asks for a title that isn’t only spaces', async () => {
    await openNew('committee');
    await type('For example, End of season survey', '   ');
    await expectRefused('Give the survey a title.');
  });

  it('asks for each question to be written, by number', async () => {
    await openNew('committee');
    await fillMinimum();
    await press('Add a question');
    await expectRefused('Write question 2.');
  });

  it('asks for at least two choices', async () => {
    await openNew('committee');
    await type('For example, End of season survey', 'Poll');
    await type('Write the question', 'Coming?');
    await type('Write a choice', 'Yes', 0);
    await expectRefused('Give question 1 at least two choices.');
  });

  it('refuses a closing day before the opening day', async () => {
    await openNew('committee');
    await fillMinimum();
    await press('In 1 week');
    // Closes: step back from 1 Nov to 24 Oct, a day before it opens.
    const closesBack = () => screen.getAllByLabelText('Day before')[1];
    for (let i = 0; i < 8; i++) fireEvent.press(closesBack());
    await settle();
    await expectRefused('Choose a closing day on or after the opening day.');
  });

  it('shows the database’s refusal and stays on the form', async () => {
    await openNew('committee', { error: 'Only the committee and admins can send club surveys' });
    await fillMinimum();
    await send();
    expect(screen.getByText('Only the committee and admins can send club surveys')).toBeTruthy();
    expect(screen.queryByText('screen:surveys/[id]')).toBeNull();
  });
});

describe('a coach or manager making a survey', () => {
  it.each<[string, Who]>([
    ['head coach', 'coach'],
    ['assistant coach', morePersonas.assistantCoach],
    ['manager', 'manager'],
  ])('lets a %s send only to the group they lead, picked for them', async (_l, who) => {
    await openNew(who);
    // No club or role audiences, and no other team.
    expect(screen.queryByText('Everyone')).toBeNull();
    expect(screen.queryByText('A role')).toBeNull();
    expect(screen.queryByText(TEAM_B.name)).toBeNull();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({
      p_audience: 'group',
      p_role: null,
      p_team_id: TEAM.id,
      // A quick poll stays with them.
      p_share_with_committee: false,
      p_share_with_admins: false,
      p_results_at_percent: null,
      p_results_to_group: false,
    });
  });

  it('keeps a quick poll with the coach unless they share it', async () => {
    await openNew('coach');
    expect(screen.getByText('Who else sees it')).toBeTruthy();
    expect(screen.getByText('Just me')).toBeTruthy();
    expect(screen.getByText(/Only you see results\./)).toBeTruthy();
    await press('Admins');
    expect(screen.getByText(/Only you and admins see results\./)).toBeTruthy();
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({ p_share_with_committee: false, p_share_with_admins: true });
  });

  it('shares with admins and the committee when the coach chooses both', async () => {
    await openNew('coach');
    await press('Admins and committee');
    expect(screen.getByText(/Only you, the committee and admins see results\./)).toBeTruthy();
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({ p_share_with_committee: true, p_share_with_admins: true });
  });

  it('sends a survey with a written answer to admins too, with no way to keep it', async () => {
    await openNew('coach');
    await fillMinimum();
    await press('Add a question');
    await type('Write the question', 'Anything else?', 1);
    await press('Written answer', 1);
    expect(screen.queryByText('Just me')).toBeNull();
    expect(screen.getByText(/^Admins see surveys with more than 5 questions or a written answer/)).toBeTruthy();
    await send();
    expect(sent()).toMatchObject({ p_share_with_committee: false, p_share_with_admins: true });
  });

  it('sends a survey of more than 5 questions to admins too', async () => {
    await openNew('coach');
    await fillMinimum();
    for (let n = 2; n <= 6; n++) {
      await press('Add a question');
      await press('Rating', n - 1);
      await type('Write the question', `Question ${n}`, n - 1);
    }
    expect(screen.queryByText('Just me')).toBeNull();
    await send();
    expect(sent()).toMatchObject({ p_share_with_admins: true });
    expect(sent().p_questions).toHaveLength(6);
  });

  it('shares the totals with the team only when asked', async () => {
    await openNew('coach');
    await press('Yes, the totals');
    expect(screen.getByText(/The squad or team sees the totals too\.$/)).toBeTruthy();
    await press('Everyone must answer');
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({ p_results_to_group: true, p_everyone_answers: true });
  });

  it('lets a coach ask any kind of question', async () => {
    await openNew('coach');
    for (const kind of ['One choice', 'Several choices', 'Rating', 'Written answer']) {
      expect(screen.getByText(kind)).toBeTruthy();
    }
  });

  it('tells a coach with no current squad or team that they can’t send yet', async () => {
    await openScreen('coach', { 'surveys/new': NewSurveyScreen }, '/surveys/new', {
      teams: [TEAM_B],
    });
    expect(
      screen.getByText(
        'You can send surveys to the squads and teams you coach or manage once an admin adds you to one.',
      ),
    ).toBeTruthy();
    await fillMinimum();
    await send();
    expect(screen.getByText('Choose a squad or team.')).toBeTruthy();
    expect(rpcCalls('create_survey')).toEqual([]);
  });

  it('lets an athlete who coaches another team send only to the team they coach', async () => {
    const athleteCoach = personas.athleteCoach;
    await openNew(athleteCoach);
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
    expect(screen.queryByText(TEAM.name)).toBeNull();
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({ p_team_id: TEAM_B.id });
  });
});

describe('a captain’s poll', () => {
  it('offers only questions with choices', async () => {
    await openNew('captain');
    expect(screen.getByText('One choice')).toBeTruthy();
    expect(screen.getByText('Several choices')).toBeTruthy();
    expect(screen.queryByText('Rating')).toBeNull();
    expect(screen.queryByText('Written answer')).toBeNull();
  });

  it('has up to 5 questions', async () => {
    await openNew('captain');
    for (let n = 2; n <= 5; n++) await press('Add a question');
    expect(screen.getAllByText(/^Question \d$/)).toHaveLength(5);
    expect(screen.queryByText('Add a question')).toBeNull();
  });

  it('goes to the team they captain, seen by them and its coaches and managers only', async () => {
    await openNew('captain');
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.queryByText(TEAM_B.name)).toBeNull();
    // Captains can't keep a poll from the coaches or share it with the committee.
    expect(screen.queryByText('Who else sees it')).toBeNull();
    expect(
      screen.getByText(/Only you and the coaches and managers of your squad or team see results\./),
    ).toBeTruthy();
    await press('Yes, the totals');
    await fillMinimum();
    await send();
    expect(sent()).toMatchObject({
      p_audience: 'group',
      p_team_id: TEAM.id,
      p_share_with_committee: false,
      p_share_with_admins: false,
      p_results_at_percent: null,
      p_results_to_group: true,
    });
  });

  it('has no group to send to when the club has captains’ polls off', async () => {
    setClubFeatures({ captainPolls: false });
    await openNew('captain');
    expect(
      screen.getByText(
        'You can send surveys to the squads and teams you coach or manage once an admin adds you to one.',
      ),
    ).toBeTruthy();
    // With no group to pick, nothing can be sent.
    await fillMinimum();
    await send();
    expect(rpcCalls('create_survey')).toEqual([]);
  });
});
