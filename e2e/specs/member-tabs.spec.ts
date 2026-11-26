import { memberTab, openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople } from '../support/people';
import { expect, test } from '../support/test';

// A member's page for admins, in tabs ("A member's page" in section 10 of
// docs/user-guide.md): Overview first, one Save for every tab.

const coachPlace = [
  { team_id: openSquad.id, team_role: 'coach', coach_title: 'head_coach', selection: null, team: { archived: false } },
];

test('an admin changes a role on one tab, looks at another, and saves both from Overview', async ({ page }) => {
  const { admin, coach } = samplePeople();
  const people = [admin, coach];

  const backend = await openApp(page, {
    me: admin,
    teams: [openSquad],
    handle: (req) => {
      if (req.table === 'profiles') {
        const id = eq(req.params, 'id');
        if (id) return people.find((p) => p.id === id);
        if (req.head) return [];
        return people;
      }
      if (req.table === 'team_members' && eq(req.params, 'profile_id') === coach.id) return coachPlace;
      if (req.rpc === 'admin_save_member' || req.rpc === 'admin_set_member_details') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await openTab(page, 'Club');
  await page.getByPlaceholder('Find a member or a setting').fill('cam');
  await page.getByRole('button', { name: new RegExp(`^${coach.full_name}`) }).click();

  // Who they are in one line, then Overview: nothing to sort out.
  await expect(page.getByTestId('member-lead')).toHaveText('Approved · Coach · Mixed Open Squad');
  await expect(memberTab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('needs-attention')).toHaveText(/Nothing needs attention/);
  await expect(page.getByTestId('member-paused')).toHaveCount(0);
  // Only one tab's part of the page shows at a time.
  await expect(page.getByText('Other roles', { exact: true })).toBeHidden();
  await expect(page.getByText('Card number', { exact: true })).toBeHidden();

  // Roles: they're also a parent.
  await memberTab(page, 'Roles').click();
  await expect(memberTab(page, 'Roles')).toHaveAttribute('aria-selected', 'true');
  // Guardian is offered twice: as their main role, then under Other roles.
  await page.getByText('Other roles', { exact: true }).locator('xpath=following::*[@role="button"][.="Guardian"][1]').click();

  // Checks: their card is still there, and a new expiry is typed.
  await memberTab(page, 'Checks').click();
  await expect(page.getByText('Other roles', { exact: true })).toBeHidden();
  const expires = page.getByText('Expires', { exact: true }).locator('xpath=following::input[1]');
  await expect(expires).toHaveValue('30/05/2028');
  await expires.fill('30/05/2029');

  // Save on Overview sends what was changed on both tabs.
  await memberTab(page, 'Overview').click();
  await expect(expires).toBeHidden();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('admin_save_member').length).toBe(1);
  expect(backend.rpcCalls('admin_save_member')[0]).toMatchObject({
    p_profile_id: coach.id,
    p_role: 'coach',
    p_status: 'approved',
    p_extra_roles: ['guardian'],
    p_teams: [{ team_id: openSquad.id, team_role: 'coach', coach_title: 'head_coach', selection: null }],
  });
  expect(backend.rpcCalls('admin_set_member_details')).toEqual([
    expect.objectContaining({ p_profile_id: coach.id, p_wwcc_number: 'WWC0277341', p_wwcc_expires_on: '2029-05-30' }),
  ]);
});

test('Overview says what needs attention, and a line opens the tab where it is sorted out', async ({ page }) => {
  const { admin, coach } = samplePeople();
  // Their card ran out last month.
  coach.wwcc_expires_on = '2026-09-30';
  const people = [admin, coach];
  // A narrow phone: every tab still fits across the page.
  await page.setViewportSize({ width: 320, height: 640 });

  const backend = await openApp(page, {
    me: admin,
    teams: [openSquad],
    handle: (req) => {
      if (req.table === 'profiles') {
        const id = eq(req.params, 'id');
        if (id) return people.find((p) => p.id === id);
        if (req.head) return [];
        return people;
      }
      if (req.table === 'team_members' && eq(req.params, 'profile_id') === coach.id) return coachPlace;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await openTab(page, 'Club');
  await page.getByPlaceholder('Find a member or a setting').fill('cam');
  await page.getByRole('button', { name: new RegExp(`^${coach.full_name}`) }).click();

  for (const name of ['Overview', 'Roles', 'Checks'] as const) {
    await expect(memberTab(page, name)).toBeInViewport({ ratio: 1 });
  }
  // Above the tabs: the role they can't use for now.
  await expect(page.getByTestId('member-paused')).toHaveText(
    /Paused: Coach\. They can’t use this role until their Working With Children Check is sorted out\./,
  );

  const line = page.getByTestId('needs-attention').getByRole('button', { name: /Opens the Checks tab$/ }).first();
  await expect(line).toBeVisible();
  await expect(page.getByText('Card number', { exact: true })).toBeHidden();
  await line.click();
  await expect(memberTab(page, 'Checks')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Card number', { exact: true })).toBeVisible();
  // The line about their roles stays in sight on every tab.
  await expect(page.getByTestId('member-paused')).toBeInViewport();
  // Looking changes nothing.
  expect(backend.rpcCalls('admin_save_member')).toEqual([]);
  expect(backend.rpcCalls('admin_set_member_details')).toEqual([]);
});

test('on the narrowest phone a child’s five tabs all show at once', async ({ page }) => {
  const { admin, minor } = samplePeople();
  const people = [admin, minor];
  await page.setViewportSize({ width: 320, height: 640 });

  await openApp(page, {
    me: admin,
    teams: [openSquad],
    handle: (req) => {
      if (req.table === 'profiles') {
        const id = eq(req.params, 'id');
        if (id) return people.find((p) => p.id === id);
        if (req.head) return [];
        return people;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await openTab(page, 'Club');
  await page.getByPlaceholder('Find a member or a setting').fill('riley');
  await page.getByRole('button', { name: new RegExp(`^${minor.full_name}`) }).click();

  for (const name of ['Overview', 'Roles', 'Checks', 'Family', 'History'] as const) {
    await expect(memberTab(page, name)).toBeInViewport({ ratio: 1 });
  }
  // With no verified parent linked they are locked, and Overview sends the admin to Family.
  await page.getByTestId('needs-attention').getByRole('button', { name: /^Locked.*Opens the Family tab$/ }).click();
  await expect(memberTab(page, 'Family')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Parents and guardians', { exact: true })).toBeVisible();
});
