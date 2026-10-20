import { openApp } from '../support/app';
import { expect, test } from '../support/test';

test.describe('signed out', () => {
  test('with no club picked, the app asks to find your club', async ({ page }) => {
    const backend = await openApp(page, { club: null });
    await expect(page.getByText('Find your club', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expect(page.getByText('Sign in / Register')).toHaveCount(0);

    // Typing the club's code finds it and leads to its sign-in screen.
    await page.getByRole('textbox').fill('thunder');
    await page.getByRole('button', { name: 'Continue to West Coast Thunder' }).click();
    await expect(page.getByText('Sign in / Register')).toBeVisible();
    // Nobody is signed in, so nothing is read from the club's database.
    expect(backend.requests.filter((r) => !r.table.startsWith('/auth/'))).toEqual([]);
  });

  test('with the club picked, the app opens on sign-in', async ({ page }) => {
    const backend = await openApp(page);
    await expect(page.getByText('Sign in / Register')).toBeVisible();
    await expect(page.getByText('Continue with Google')).toBeVisible();
    await expect(page.getByText('Change club')).toBeVisible();
    await expect(page.getByText('Find your club')).toHaveCount(0);
    expect(backend.requests.filter((r) => !r.table.startsWith('/auth/'))).toEqual([]);
  });

  test('a signed-out deep link to a member screen opens sign-in', async ({ page }) => {
    await openApp(page, { path: '/admin' });
    await expect(page.getByText('Sign in / Register')).toBeVisible();
    await expect(page.getByText('Waiting for approval')).toHaveCount(0);
  });
});
