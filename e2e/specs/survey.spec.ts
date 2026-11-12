import type { Page } from '@playwright/test';

import { openApp } from '../support/app';
import { openSquad, samplePeople, uuid } from '../support/people';
import { expect, test } from '../support/test';

const questions = [
  { id: uuid(1311), kind: 'choice', prompt: 'Which night suits extra training?', options: ['Tuesday', 'Thursday'], rating_max: null, required: true },
  { id: uuid(1312), kind: 'rating', prompt: 'How was the season launch?', options: null, rating_max: 5, required: true },
  { id: uuid(1313), kind: 'multi_choice', prompt: 'Which skills sessions would you join?', options: ['Shooting', 'Defence', 'Footwork'], rating_max: null, required: false },
  { id: uuid(1314), kind: 'text', prompt: 'Anything else?', options: null, rating_max: null, required: false },
];

/** An open survey from the committee to the Mixed Open Squad, as `survey_detail` returns it. */
function survey(fields: Record<string, unknown>) {
  return {
    id: uuid(1301),
    title: 'Training nights for term 4',
    intro: null,
    identity: 'optional',
    audience: 'group',
    audience_role: null,
    audience_label: openSquad.name,
    opens_at: '2026-10-12T16:00:00Z',
    closes_at: '2026-10-24T16:00:00Z',
    created_by: uuid(1),
    created_by_name: 'Matt Admin',
    is_open: true,
    is_scheduled: false,
    is_recipient: true,
    sent_as: 'committee',
    share_with_committee: false,
    share_with_admins: true,
    everyone_answers: false,
    results_at_percent: null,
    results_to_group: false,
    can_see_results: false,
    can_close: false,
    for_child_names: null,
    from_child: false,
    can_answer: true,
    responded: false,
    questions,
    my_answers: null,
    children: [],
    ...fields,
  };
}

/** Opens Surveys from Home as an athlete with this survey waiting, answering it as the database would. */
async function openSurvey(page: Page, detail: ReturnType<typeof survey>) {
  const { athlete } = samplePeople();
  const backend = await openApp(page, {
    me: athlete,
    teams: [openSquad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: openSquad }],
    handle: (req) => {
      if (req.rpc === 'my_surveys') {
        return [
          {
            id: detail.id,
            title: detail.title,
            identity: detail.identity,
            opens_at: detail.opens_at,
            closes_at: detail.closes_at,
            created_by_name: detail.created_by_name,
            for_child_names: null,
            from_child: false,
            responded: detail.responded,
            is_open: true,
            everyone_answers: false,
          },
        ];
      }
      if (req.rpc === 'survey_detail') return detail;
      if (req.rpc === 'submit_survey_response') {
        const named = detail.identity === 'named' || req.body.p_give_name;
        Object.assign(detail, {
          responded: true,
          can_answer: false,
          my_answers: named
            ? req.body.p_answers.map((a: object & { question_id: string }) => ({ ...a }))
            : null,
        });
        return null;
      }
      return undefined;
    },
  });
  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  await page.getByRole('button', { name: 'Surveys 1 1 to answer' }).click();
  await page.getByRole('button', { name: new RegExp(`^${detail.title}`) }).click();
  // The list behind it also shows the title, so wait for the survey itself:
  // it asks for the survey when the screen comes into focus.
  await expect.poll(() => backend.rpcCalls('survey_detail')).toEqual([{ p_survey_id: detail.id }]);
  await expect(page.getByText(questions[0].prompt).filter({ visible: true })).toBeVisible();
  return { backend, athlete };
}

test('an athlete answers a name-optional survey and gives their name', async ({ page }) => {
  const detail = survey({ identity: 'optional' });
  const { backend } = await openSurvey(page, detail);

  await expect(
    page.getByText('You choose whether to give your name. Only whoever sent it, the committee and admins see answers.'),
  ).toBeVisible();
  // Required questions must be answered before anything is sent.
  await page.getByRole('button', { name: 'Send answers' }).click();
  await expect(page.getByText('Answer “Which night suits extra training?”.')).toBeVisible();
  expect(backend.rpcCalls('submit_survey_response')).toEqual([]);

  await page.getByRole('button', { name: 'Thursday', exact: true }).click();
  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.getByRole('button', { name: 'Footwork', exact: true }).click();
  await page.getByRole('button', { name: 'Shooting', exact: true }).click();
  await page.getByPlaceholder('Write your answer').fill('Could we start at 6:30?');
  await page.getByRole('button', { name: 'Give my name', exact: true }).click();
  await page.getByRole('button', { name: 'Send answers' }).click();

  await expect.poll(() => backend.rpcCalls('submit_survey_response').length).toBe(1);
  expect(backend.rpcCalls('submit_survey_response')[0]).toEqual({
    p_survey_id: detail.id,
    p_answers: [
      { question_id: questions[0].id, choices: [1], rating: null, text: null },
      { question_id: questions[1].id, choices: null, rating: 4, text: null },
      // Choices in the order they're listed, not the order tapped.
      { question_id: questions[2].id, choices: [0, 2], rating: null, text: null },
      { question_id: questions[3].id, choices: null, rating: null, text: 'Could we start at 6:30?' },
    ],
    p_give_name: true,
  });

  // The survey reloads with the answers in, and nothing left to send.
  await expect(page.getByText('✓ Thanks, your answers are in')).toBeVisible();
  await expect(page.getByText('Shooting, Footwork')).toBeVisible();
  await expect(page.getByText('4 out of 5')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send answers' })).toHaveCount(0);
});

test('an anonymous survey says so, offers no name choice and sends no name', async ({ page }) => {
  const detail = survey({ identity: 'anonymous', questions: questions.slice(0, 2) });
  const { backend, athlete } = await openSurvey(page, detail);

  await expect(
    page.getByText('This survey is anonymous. Nobody, including whoever sent it, can see who gave which answers.'),
  ).toBeVisible();
  await expect(page.getByText('Anonymous · From Matt Admin', { exact: false }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Give my name' })).toHaveCount(0);
  await expect(page.getByText('Your name', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tuesday', exact: true }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Send answers' }).click();

  await expect.poll(() => backend.rpcCalls('submit_survey_response').length).toBe(1);
  const [sent] = backend.rpcCalls('submit_survey_response');
  expect(sent).toEqual({
    p_survey_id: detail.id,
    p_answers: [
      { question_id: questions[0].id, choices: [0], rating: null, text: null },
      { question_id: questions[1].id, choices: null, rating: 2, text: null },
    ],
    p_give_name: false,
  });
  // Nothing in the answers says who sent them.
  const text = JSON.stringify(sent);
  for (const detailOfThem of [athlete.id, athlete.full_name, athlete.email]) {
    expect(text).not.toContain(detailOfThem);
  }

  await expect(page.getByText('✓ Thanks, your answers are in')).toBeVisible();
  await expect(page.getByText('Your answers aren’t linked to you, so they can’t be shown here.')).toBeVisible();
});
