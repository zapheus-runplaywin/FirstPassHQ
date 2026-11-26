import { openApp, openTab } from '../support/app';
import { openSquad, samplePeople, uuid } from '../support/people';
import { expect, test } from '../support/test';

const membership = (team_role: string) => ({
  team_role,
  coach_title: team_role === 'coach' ? 'head_coach' : null,
  selection: null,
  team: openSquad,
});

/** The squad's people, in the database's order: staff, then athletes. */
const roster = [
  { profile_id: uuid(2), full_name: 'Cam Roberts', team_role: 'coach', coach_title: 'head_coach', selection: null },
  { profile_id: uuid(10), full_name: 'Alex Nguyen', team_role: 'athlete', coach_title: null, selection: null },
  { profile_id: uuid(500), full_name: 'Bo Tran', team_role: 'athlete', coach_title: null, selection: null },
  { profile_id: uuid(501), full_name: 'Kai Thompson', team_role: 'athlete', coach_title: null, selection: null },
];

const injuryId = uuid(1201);
const ankle = {
  id: injuryId,
  athlete_id: uuid(500),
  athlete_name: 'Bo Tran',
  body_area: 'Left ankle',
  description: 'Rolled it at training.',
  injured_on: '2026-10-10',
  restrictions: 'No jumping',
  expected_return: '2026-11-01',
  status: 'injured',
  coach_endorsed_by: null,
  cleared_at: null,
  created_at: '2026-10-10T08:00:00Z',
  last_update_at: null,
  can_report: false,
  waiting_for_me: false,
};

test('a coach’s Team tab leads with the numbers, and an injured athlete’s row opens the injury', async ({ page }) => {
  const { coach } = samplePeople();
  await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [membership('coach')],
    handle: (req) => {
      if (req.rpc === 'team_roster') return roster;
      if (req.rpc === 'visible_injuries') return [ankle];
      if (req.rpc === 'check_in_summary') {
        return [{ team_id: openSquad.id, team_name: openSquad.name, team_kind: 'squad', squad_id: null, athlete_count: 3, checked_in_count: 2, flagged_count: 1 }];
      }
      if (req.rpc === 'athlete_attendance_summary') {
        return [
          { profile_id: uuid(10), full_name: 'Alex Nguyen', session_count: 8, present_count: 8, last_present_at: null },
          { profile_id: uuid(500), full_name: 'Bo Tran', session_count: 8, present_count: 6, last_present_at: null },
        ];
      }
      if (req.table === 'injury_updates') return [];
      if (req.rpc === 'can_share_injury') return false;
      if (req.rpc === 'injury_document_log') return { __error: 'Not allowed' };
      if (req.rpc === 'log_record_view') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  await openTab(page, 'Team');

  // Check-ins, then attendance, then injuries, each leading with its number.
  const tiles = page.getByTestId('readiness-tiles');
  await expect(tiles.getByRole('button')).toHaveCount(3);
  await expect(tiles.getByRole('button').nth(0)).toHaveAccessibleName('Check-ins. 2 of 3 checked in today. 1 flagged');
  await expect(tiles.getByRole('button').nth(1)).toHaveAccessibleName('Attendance. 88% at sessions in 4 weeks');
  await expect(tiles.getByRole('button').nth(2)).toHaveAccessibleName('Injuries. 1 current injury');
  await expect(tiles.getByText('2/3', { exact: true })).toBeVisible();
  await expect(tiles.getByText('88%', { exact: true })).toBeVisible();

  // The squad's name and the coach's place in it, what they can do there (one tap each), then
  // its people: athletes first, and a status beside the injured one only.
  await expect(page.getByTestId('group-name')).toHaveText(openSquad.name);
  await expect(page.getByTestId('my-place')).toHaveText('Squad · Head Coach');
  const rows = page.getByTestId('team-rows');
  await expect(rows.getByRole('button')).toHaveCount(1);
  await expect(rows.getByRole('button')).toHaveAccessibleName('Medical and emergency details. 3 athletes');
  // Nothing opens a second page that lists the same people.
  await expect(page.getByRole('button', { name: new RegExp(`^${openSquad.name}`) })).toHaveCount(0);
  const people = page.getByTestId('people-list');
  await expect(page.getByTestId('people-count')).toHaveText('3 athletes · 1 staff');
  await expect(people.getByText(/^(Alex Nguyen|Bo Tran|Kai Thompson|Cam Roberts)$/)).toHaveText([
    'Alex Nguyen',
    'Bo Tran',
    'Kai Thompson',
    'Cam Roberts',
  ]);
  await expect(people.getByRole('button')).toHaveCount(1);
  await expect(people.getByRole('button')).toHaveAccessibleName('Bo Tran, Athlete. Injured');
  // The tiles come before the people.
  const tilesTop = (await tiles.boundingBox())!.y;
  const peopleTop = (await people.boundingBox())!.y;
  expect(tilesTop).toBeLessThan(peopleTop);

  await people.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/injuries/${injuryId}$`));
  await expect(page.getByText('No jumping', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('an athlete’s Team tab is their squad and its people: names and positions only', async ({ page }) => {
  const { athlete } = samplePeople();
  const backend = await openApp(page, {
    me: athlete,
    teams: [openSquad],
    memberships: [membership('athlete')],
    handle: (req) => {
      if (req.rpc === 'team_roster') return roster;
      // The database gives an athlete their own injury only.
      if (req.rpc === 'visible_injuries') return [{ ...ankle, athlete_id: athlete.id, athlete_name: athlete.full_name, can_report: true }];
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  await openTab(page, 'Team');

  const people = page.getByTestId('people-list');
  await expect(people.getByText('Bo Tran', { exact: true })).toBeVisible();
  await expect(people.getByText('Head Coach', { exact: true })).toBeVisible();
  // No tiles, no status beside anyone (their own name included), and nobody opens.
  await expect(page.getByTestId('readiness-tiles')).toHaveCount(0);
  await expect(people.getByRole('button')).toHaveCount(0);
  await expect(people.getByText('Injured')).toHaveCount(0);
  expect(backend.rpcCalls('athlete_attendance_summary')).toEqual([]);
  expect(backend.rpcCalls('check_in_summary')).toEqual([]);

  // The squad is on the tab itself: its name and the athlete's place in it, with nothing to
  // open (a squad has no game goals, and medical details and captains aren't an athlete's).
  await expect(page.getByTestId('group-name')).toHaveText(openSquad.name);
  await expect(page.getByTestId('my-place')).toHaveText('Squad · Athlete');
  await expect(page.getByTestId('team-rows')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(`^${openSquad.name}`) })).toHaveCount(0);
  await page.getByTestId('group-name').click();
  await expect(page).toHaveURL(/\/team$/);
});
