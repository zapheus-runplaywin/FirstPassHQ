// The tab bar: Today, Calendar, Messages, the member's hub and Me, in the real
// web build. Which tabs each role has is covered role by role in
// src/__tests__/home-by-role.test.tsx; this checks the bar itself works.
import { openApp, openTab, tab, type Tab } from '../support/app';
import { openSquad, samplePeople } from '../support/people';
import { expect, test } from '../support/test';

const ALL_TABS: Tab[] = ['Today', 'Calendar', 'Messages', 'Team', 'Family', 'Club', 'Me'];

/** The tabs showing in the bar, left to right. */
async function tabsShown(page: Parameters<typeof tab>[0]) {
  const shown: Tab[] = [];
  for (const name of ALL_TABS) {
    if ((await tab(page, name).count()) > 0 && (await tab(page, name).isVisible())) shown.push(name);
  }
  return shown;
}

test('a coach moves between Today, their Team hub and Me from the tab bar', async ({ page }) => {
  const { coach } = samplePeople();
  await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  expect(await tabsShown(page)).toEqual(['Today', 'Calendar', 'Messages', 'Team', 'Me']);
  // Today says what needs them, or that nothing does. Raise a concern is at the top of every tab.
  await expect(page.getByText('You’re set for today')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Raise a concern' })).toBeVisible();

  await openTab(page, 'Team');
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole('button', { name: new RegExp(`^${openSquad.name}`) })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Attendance Take attendance/ })).toBeVisible();
  // The tab's own heading, with Raise a concern beside it.
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();

  await openTab(page, 'Me');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole('button', { name: /^Your details/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // A screen opened from a tab covers the bar and has its own way back.
  await page.getByRole('button', { name: /^Your details/ }).click();
  await expect(page).toHaveURL(/\/my-details$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/me$/);

  await openTab(page, 'Today');
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
});

test('a guest has Today, Calendar and Me, and no Messages or hub', async ({ page }) => {
  const { guest } = samplePeople();
  await openApp(page, { me: guest });
  await expect(page.getByText(`Hi ${guest.full_name}`)).toBeVisible();
  expect(await tabsShown(page)).toEqual(['Today', 'Calendar', 'Me']);

  // A hub that isn't theirs, typed as an address, sends them back to Today.
  await page.goto('/club');
  await expect(page.getByText(`Hi ${guest.full_name}`)).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('button', { name: /^Administration/ })).toHaveCount(0);
});

test('a member waiting for approval keeps one screen, with no tab bar', async ({ page }) => {
  const { pending } = samplePeople();
  await openApp(page, {
    me: pending,
    handle: (req) => (req.rpc === 'my_verification_code' ? '123456' : undefined),
  });
  await expect(page.getByText('Waiting for approval', { exact: true })).toBeVisible();
  await expect(page.getByText('123 456')).toBeVisible();
  expect(await tabsShown(page)).toEqual([]);
  // Their account links stay on that screen.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Raise a concern/ })).toBeVisible();

  for (const path of ['/me', '/team', '/calendar']) {
    await page.goto(path);
    await expect(page.getByText('Waiting for approval', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  }
});
