import { openApp, openTab } from '../support/app';
import { eq, type FakeRequest } from '../support/fake-supabase';
import { openSquad, samplePeople, uuid } from '../support/people';
import { expect, test } from '../support/test';

const injuryId = uuid(1201);

/** Alex Nguyen's left ankle, as `visible_injuries` returns it. */
function ankle(fields: Record<string, unknown> = {}) {
  return {
    id: injuryId,
    athlete_id: uuid(10),
    athlete_name: 'Alex Nguyen',
    body_area: 'Left ankle',
    description: 'Rolled it landing a jump shot at Saturday training.',
    injured_on: '2026-10-17',
    restrictions: 'No jumping',
    expected_return: '2026-11-01',
    status: 'injured',
    coach_endorsed_by: null,
    cleared_at: null,
    created_at: '2026-10-17T23:30:00Z',
    last_update_at: null,
    can_report: false,
    waiting_for_me: false,
    ...fields,
  };
}

const reported = {
  id: uuid(1211),
  author_name: 'Alex Nguyen',
  kind: 'reported',
  notes: 'Rolled it landing a jump shot at Saturday training.',
  restrictions: 'No jumping',
  expected_return: '2026-11-01',
  document_path: null,
  document_name: null,
  document_removed_at: null,
  created_at: '2026-10-17T23:30:00Z',
};

/** `visible_injuries`: one injury when the screen asks for it by id, else the list. */
function visible(req: FakeRequest, injuries: object[]) {
  return req.body?.p_injury_id ? injuries.filter((i: any) => i.id === req.body.p_injury_id) : injuries;
}

test('an athlete reports their own injury, and it opens with their next steps', async ({ page }) => {
  const { athlete } = samplePeople();
  const injuries: object[] = [];

  const backend = await openApp(page, {
    me: athlete,
    teams: [openSquad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: openSquad }],
    handle: (req) => {
      if (req.rpc === 'visible_injuries') return visible(req, injuries);
      if (req.table === 'injury_updates') return eq(req.params, 'injury_id') === injuryId ? [reported] : [];
      if (req.rpc === 'can_share_injury') return false;
      if (req.rpc === 'injury_document_log') return [];
      if (req.rpc === 'log_record_view') return null;
      if (req.rpc === 'report_injury') {
        injuries.push(
          ankle({
            body_area: req.body.p_body_area,
            description: req.body.p_description,
            injured_on: req.body.p_injured_on,
            restrictions: req.body.p_restrictions,
            expected_return: req.body.p_expected_return,
            can_report: true,
          }),
        );
        return injuryId;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  // An athlete's own injuries are with their own things, in Me.
  await openTab(page, 'Me');
  await page.getByRole('button', { name: 'Injuries No current injuries' }).click();
  await expect(page.getByText('No current injuries.')).toBeVisible();
  await page.getByRole('button', { name: 'Report an injury' }).click();

  await expect(page.getByText('Your coaches, physios and the committee will see this.', { exact: false })).toBeVisible();
  // Athletes report for themselves, so there's no athlete to choose.
  expect(backend.called('rpc/my_athletes')).toBe(false);
  await page.getByPlaceholder('For example, left ankle').fill('Left ankle');
  await page
    .getByPlaceholder('How it happened and what the doctor or physio said')
    .fill('Rolled it landing a jump shot at Saturday training.');
  await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
  await page.getByPlaceholder('For example, no jumping or tumbling').fill('No jumping');

  // Expected back is needed before anything is sent.
  await page.getByRole('button', { name: 'Report injury', exact: true }).click();
  await expect(page.getByText('Choose when you expect to be back. A physio can change it later.')).toBeVisible();
  expect(backend.rpcCalls('report_injury')).toEqual([]);

  await page.getByRole('button', { name: '2 weeks', exact: true }).click();
  await page.getByRole('button', { name: 'Report injury', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('report_injury').length).toBe(1);
  expect(backend.rpcCalls('report_injury')[0]).toEqual({
    p_athlete_id: athlete.id,
    p_body_area: 'Left ankle',
    p_description: 'Rolled it landing a jump shot at Saturday training.',
    // Yesterday and two weeks from today, in Perth.
    p_injured_on: '2026-10-17',
    p_restrictions: 'No jumping',
    p_expected_return: '2026-11-01',
    p_concussion: false,
  });

  // It opens on the new injury, where the athlete adds updates and asks for clearance.
  await expect(page).toHaveURL(new RegExp(`/injuries/${injuryId}$`));
  await expect(page.getByText('Left ankle', { exact: true }).filter({ visible: true })).toBeVisible();
  // The status pill, and the Injured date beside it.
  await expect(page.getByText('Injured', { exact: true }).filter({ visible: true })).toHaveCount(2);
  await expect(page.getByText(/^Sun,? 1 Nov,? 2026$/).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Reported the injury').filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add physio update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask for clearance' })).toBeVisible();
  expect(backend.rpcCalls('visible_injuries')).toContainEqual({ p_include_cleared: true, p_injury_id: injuryId });
});

test('a coach has Log an injury but no Report an injury, and their athlete’s injury opens read-only', async ({ page }) => {
  const { coach } = samplePeople();
  const injuries = [ankle()];

  const backend = await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
    handle: (req) => {
      if (req.rpc === 'visible_injuries') return visible(req, injuries);
      if (req.table === 'injury_updates') return [reported];
      if (req.rpc === 'can_share_injury') return false;
      // Only the athlete, their guardians and admins see who opened documents.
      if (req.rpc === 'injury_document_log') return { __error: 'Not allowed' };
      if (req.rpc === 'log_record_view') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  // A coach's athletes' injuries are with their squads, in Team.
  await openTab(page, 'Team');
  await page.getByRole('button', { name: 'Injuries 1 current injury' }).click();
  await expect(page.getByText('Injured athletes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report an injury' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log an injury' })).toBeVisible();
  await page.getByRole('button', { name: /^Alex Nguyen · Left ankle/ }).click();

  await expect(page).toHaveURL(new RegExp(`/injuries/${injuryId}$`));
  await expect(page.getByText('No jumping', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Reported the injury').filter({ visible: true })).toBeVisible();
  // Nothing to add, ask for or sign off.
  for (const name of ['Add physio update', 'Ask for clearance', 'Endorse clearance', 'Accept clearance', 'Send back']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('textbox')).toHaveCount(0);
  // The view is offered to the record-access log; the database decides whether it counts.
  await expect
    .poll(() => backend.rpcCalls('log_record_view'))
    .toEqual([{ p_subject_id: uuid(10), p_kind: 'injury', p_record_id: injuryId }]);
  const writes = backend.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !r.rpc);
  expect(writes).toEqual([]);
});

test('a coach logs an injury at training for one of their athletes', async ({ page }) => {
  const { coach } = samplePeople();

  const backend = await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
    handle: (req) => {
      if (req.rpc === 'visible_injuries') return [];
      if (req.rpc === 'injury_loggable_athletes') {
        return [
          { athlete_id: uuid(10), athlete_name: 'Alex Nguyen', logged_as: 'coach' },
          { athlete_id: uuid(11), athlete_name: 'Riley Evans', logged_as: 'coach' },
        ];
      }
      if (req.rpc === 'log_injury') return injuryId;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  await openTab(page, 'Team');
  await page.getByRole('button', { name: 'Injuries No current injuries' }).click();
  await page.getByRole('button', { name: 'Log an injury' }).click();
  await expect(page).toHaveURL(/\/injuries\/log$/);

  await page.getByRole('button', { name: 'Alex Nguyen', exact: true }).click();
  await page.getByPlaceholder('For example, left ankle').fill('Head');
  await page
    .getByPlaceholder('What happened, where and when, and what first aid was given')
    .fill('Clash of heads in a contest at training. Sat out, ice pack.');
  await page.getByRole('switch', { name: 'Possible concussion' }).click();
  await expect(page.getByText(/^If in doubt, sit them out\./)).toBeVisible();
  await page.getByRole('button', { name: 'Log injury', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('log_injury').length).toBe(1);
  expect(backend.rpcCalls('log_injury')[0]).toEqual({
    p_athlete_id: uuid(10),
    p_body_area: 'Head',
    p_description: 'Clash of heads in a contest at training. Sat out, ice pack.',
    p_injured_on: '2026-10-18',
    p_restrictions: '',
    p_expected_return: null,
    p_concussion: true,
  });
  await expect(page.getByText('Injury logged')).toBeVisible();
  await expect(page.getByText(/^Alex Nguyen and their parents or guardians have been told\./)).toBeVisible();
});

test('a coach who opens /injuries/new is sent Home', async ({ page }) => {
  const { coach } = samplePeople();
  const backend = await openApp(page, {
    me: coach,
    path: '/injuries/new',
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
  });
  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByPlaceholder('For example, left ankle')).toHaveCount(0);
  expect(backend.called('rpc/report_injury')).toBe(false);
});

test('an athlete’s own injury waiting for clearance is read-only', async ({ page }) => {
  const { athlete } = samplePeople();
  const injuries = [ankle({ status: 'clearance_requested', can_report: true })];

  await openApp(page, {
    me: athlete,
    path: `/injuries/${injuryId}`,
    teams: [openSquad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: openSquad }],
    handle: (req) => {
      if (req.rpc === 'visible_injuries') return visible(req, injuries);
      if (req.table === 'injury_updates') return [reported];
      if (req.rpc === 'can_share_injury') return false;
      if (req.rpc === 'injury_document_log') return [];
      if (req.rpc === 'log_record_view') return null;
      return undefined;
    },
  });

  await expect(page.getByText('Waiting for a coach or physio', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(
    page.getByText('Waiting for one of the athlete’s coaches or a physio to endorse it.').filter({ visible: true }),
  ).toBeVisible();
  for (const name of ['Add physio update', 'Ask for clearance', 'Endorse clearance', 'Send back']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
