import { openApp } from '../support/app';
import { openSquad, openSquadAthletes, samplePeople, uuid } from '../support/people';
import { expect, test } from '../support/test';

// What a member can do about a session, from Today and from the session's own
// page ("A session's page" in section 3 of docs/user-guide.md).

/** The club's absence reasons, from Club setup. */
const reasons = [
  { id: uuid(601), name: 'Planned event', active: true, sort_order: 1 },
  { id: uuid(602), name: 'Illness', active: true, sort_order: 2 },
];

/** A PlayHQ match for the Mixed Open Squad. */
function match(startsAt: string) {
  return {
    id: uuid(301),
    team_id: openSquad.id,
    team_name: openSquad.name,
    opponent: 'Rockets',
    round_name: 'Round 4',
    grade_name: 'Division 1',
    starts_at: startsAt,
    time_tbc: false,
    venue: 'State Netball Centre',
    court: 'Court 2',
    is_home: true,
    team: { kind: 'squad' },
  };
}

test('an athlete says they can’t make the next session, straight from Today', async ({ page }) => {
  const { athlete } = samplePeople();
  // Tuesday 20 October, 6:30 pm in Perth: two days after "today".
  const game = match('2026-10-20T10:30:00Z');

  const backend = await openApp(page, {
    me: athlete,
    teams: [openSquad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: openSquad }],
    handle: (req) => {
      if (req.table === 'fixtures') return [game];
      if (req.table === 'absence_categories') return reasons;
      if (req.rpc === 'report_absence') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  // Next up is their squad's match, with the one thing they might do about it.
  await expect(page.getByTestId('next-up')).toContainText('Mixed Open Squad v Rockets');
  await page.getByTestId('next-up-actions').getByRole('button', { name: 'Can’t make it' }).click();

  // The absence form opens on the day of the match, so only the reason is left.
  await expect(page).toHaveURL(/\/attendance\/absence\?.*day=2026-10-20/);
  await page.getByRole('button', { name: 'Illness', exact: true }).click();
  await page.getByRole('button', { name: 'Report absence', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('report_absence').length).toBe(1);
  expect(backend.rpcCalls('report_absence')[0]).toEqual({
    p_athlete_id: athlete.id,
    p_from: '2026-10-20',
    p_to: '2026-10-20',
    p_category_id: reasons[1].id,
    // No details typed.
    p_reason: '',
  });
});

test('a coach takes attendance from the session’s page, with the squad and its name filled in', async ({ page }) => {
  const { coach } = samplePeople();
  // This evening, 6:30 pm in Perth.
  const game = match('2026-10-18T10:30:00Z');

  const backend = await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
    handle: (req) => {
      if (req.table === 'fixtures') return [game];
      if (req.rpc === 'attendance_roster') return openSquadAthletes;
      if (req.rpc === 'save_attendance') return uuid(703);
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  // Today offers the register; the session's page has it with the plan too.
  await expect(page.getByTestId('next-up-actions').getByRole('button', { name: 'Take attendance' })).toBeVisible();
  await page.getByTestId('next-up').click();
  await expect(page).toHaveURL(/\/event\//);
  const actions = page.getByTestId('session-actions');
  await expect(actions.getByRole('button', { name: /^Add a session plan/ })).toBeVisible();
  // A coach doesn't report themselves away.
  await expect(actions.getByRole('button', { name: /Can’t make it/ })).toHaveCount(0);
  await actions.getByRole('button', { name: /^Take attendance/ }).click();

  // The register opens for the session's squad, named after the session.
  await expect(page.getByText('0 of 3 present · 3 not marked')).toBeVisible();
  expect(backend.rpcCalls('attendance_roster')).toEqual([{ p_team_id: openSquad.id }]);
  await expect(page.getByPlaceholder('For example, Tuesday training')).toHaveValue('Mixed Open Squad v Rockets');
  await page.getByRole('button', { name: 'Mark the rest present' }).click();
  await page.getByRole('button', { name: 'Save attendance' }).click();

  await expect.poll(() => backend.rpcCalls('save_attendance').length).toBe(1);
  expect(backend.rpcCalls('save_attendance')[0]).toMatchObject({
    p_session_id: null,
    p_team_id: openSquad.id,
    p_name: 'Mixed Open Squad v Rockets',
    // The register is for the session, so it is held when the session starts.
    p_held_at: '2026-10-18T10:30:00.000Z',
  });
});
