import { openApp } from '../support/app';
import { samplePeople } from '../support/people';
import { expect, test } from '../support/test';

test('an admin’s Today leads with Safeguarding: the counts, the new concern, then the register', async ({ page }) => {
  const { admin } = samplePeople();
  await openApp(page, {
    me: admin,
    handle: (req) => {
      if (req.rpc === 'new_concerns_count') return 1;
      if (req.rpc === 'concern_counts') return { new_count: 1, in_progress_count: 2, closed_recent_count: 3 };
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  const panel = page.getByTestId('safeguarding-panel');
  await expect(panel.getByText('Safeguarding', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('concern-lights')).toHaveAttribute(
    'aria-label',
    '1 new, 2 in progress, 3 closed in the last 4 weeks',
  );
  // The new concern is in the panel, marked Urgent, and not repeated under Needs you.
  await expect(panel.getByRole('button', { name: /Look at 1 new concern/ })).toBeVisible();
  await expect(panel.getByText('Urgent', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Look at 1 new concern/ })).toHaveCount(1);
  await expect(page.getByText('You’re set for today')).toHaveCount(0);

  // It comes before what's next on the calendar.
  const panelTop = (await panel.boundingBox())!.y;
  const nextUpTop = (await page.getByTestId('next-up').boundingBox())!.y;
  expect(panelTop).toBeLessThan(nextUpTop);

  // Its heading opens the register.
  await panel.getByRole('button', { name: /^Safeguarding\./ }).click();
  await expect(page).toHaveURL(/\/concerns$/);
  await expect(page.getByRole('button', { name: 'Export the register as a PDF' })).toBeVisible();
});

test('an athlete has no Safeguarding panel', async ({ page }) => {
  const { athlete } = samplePeople();
  const backend = await openApp(page, { me: athlete });
  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  await expect(page.getByTestId('next-up')).toBeVisible();
  await expect(page.getByTestId('safeguarding-panel')).toHaveCount(0);
  expect(backend.rpcCalls('concern_counts')).toEqual([]);
  expect(backend.rpcCalls('new_concerns_count')).toEqual([]);
});
