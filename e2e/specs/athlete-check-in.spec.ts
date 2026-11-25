import { openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople, TODAY_ISO_DAY, uuid } from '../support/people';
import { expect, test } from '../support/test';

import type { Page } from '@playwright/test';

/** An athlete on Today with the check-in to do, on a backend that keeps what is saved. */
async function openAthlete(page: Page) {
  const { athlete } = samplePeople();
  let saved: Record<string, unknown> | null = null;

  const backend = await openApp(page, {
    me: athlete,
    teams: [openSquad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: openSquad }],
    handle: (req) => {
      if (req.table === 'check_ins') {
        if (req.single) return eq(req.params, 'day') === TODAY_ISO_DAY ? (saved ?? undefined) : undefined;
        return saved ? [saved] : [];
      }
      if (req.rpc === 'save_check_in') {
        const b = req.body;
        saved = {
          id: uuid(801),
          athlete_id: athlete.id,
          day: b.p_day,
          sleep: b.p_sleep,
          soreness: b.p_soreness,
          stress: b.p_stress,
          mood: b.p_mood,
          note: b.p_note || null,
          updated_at: '2026-10-17T23:30:00Z',
        };
        return null;
      }
      return undefined;
    },
  });
  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  return backend;
}

test('an athlete does the daily check-in in four taps, on a sheet over Today', async ({ page }) => {
  const backend = await openAthlete(page);
  // Today lists it as something that needs them, and it opens over Today.
  await page.getByRole('button', { name: /^Do your daily check-in/ }).click();
  const sheet = page.getByTestId('check-in-sheet');
  await expect(sheet.getByText('Daily check-in', { exact: true })).toBeVisible();
  await expect(sheet.getByTestId('check-in-progress')).toHaveText('0 of 4');
  await expect(sheet.getByText('Saves when you answer the last one.')).toBeVisible();
  // Nothing to press to save.
  await expect(sheet.getByRole('button', { name: 'Save check-in' })).toHaveCount(0);

  await sheet.getByRole('button', { name: '4: Well' }).click();
  await sheet.getByRole('button', { name: '2: Sore', exact: true }).click();
  await sheet.getByRole('button', { name: '3: Normal' }).click();
  await expect(sheet.getByTestId('check-in-progress')).toHaveText('3 of 4');
  expect(backend.rpcCalls('save_check_in')).toEqual([]);
  // The last answer saves it.
  await sheet.getByRole('button', { name: '5: Great' }).click();

  await expect.poll(() => backend.rpcCalls('save_check_in').length).toBe(1);
  expect(backend.rpcCalls('save_check_in')[0]).toEqual({
    // Today in Perth, where the club is, not in UTC.
    p_day: TODAY_ISO_DAY,
    p_sleep: 4,
    p_soreness: 2,
    p_stress: 3,
    p_mood: 5,
    p_note: '',
  });

  // The sheet closes itself: nothing is left to do, and Today says the check-in is saved.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Do your daily check-in/ })).toHaveCount(0);
  await expect(page.getByText('You’re set for today')).toBeVisible();
  const savedLine = page.getByTestId('check-in-saved');
  await expect(savedLine).toContainText('Check-in saved for today');

  // A mistaken tap is corrected from there: each change saves.
  await savedLine.getByRole('button', { name: 'Change' }).click();
  await expect(sheet.getByTestId('check-in-progress')).toHaveText('4 of 4');
  await sheet.getByRole('button', { name: '4: Fine' }).click();
  await expect.poll(() => backend.rpcCalls('save_check_in').length).toBe(2);
  expect(backend.rpcCalls('save_check_in')[1]).toMatchObject({ p_sleep: 4, p_soreness: 4, p_stress: 3, p_mood: 5 });
  await expect(sheet.getByText('Saved.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);

  // Me shows today's check-in as done.
  await openTab(page, 'Me');
  await expect(page.getByRole('button', { name: 'Daily check-in Done for today' })).toBeVisible();
});

test('an athlete adds a note: the sheet hands its answers to the full check-in', async ({ page }) => {
  const backend = await openAthlete(page);
  await page.getByRole('button', { name: /^Do your daily check-in/ }).click();
  const sheet = page.getByTestId('check-in-sheet');
  await sheet.getByRole('button', { name: '4: Well' }).click();
  await sheet.getByRole('button', { name: '2: Sore', exact: true }).click();
  await sheet.getByRole('button', { name: 'Add a note' }).click();

  // The full check-in, with the two answers already given.
  await expect(sheet).toHaveCount(0);
  const note = page.getByPlaceholder('For example, tight calves after Sunday’s game');
  await expect(note).toBeVisible();
  // Each answer given shows in words beside its question.
  await expect(page.getByText('Well', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Sore', { exact: true }).filter({ visible: true })).toBeVisible();
  // Saving with questions unanswered is refused before anything is sent.
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByText('Answer all four questions.')).toBeVisible();
  expect(backend.rpcCalls('save_check_in')).toEqual([]);

  await page.getByRole('button', { name: '3: Normal' }).click();
  await page.getByRole('button', { name: '5: Great' }).click();
  await note.fill('Tight hamstring after Saturday');
  await page.getByRole('button', { name: 'Save check-in' }).click();

  await expect.poll(() => backend.rpcCalls('save_check_in').length).toBe(1);
  expect(backend.rpcCalls('save_check_in')[0]).toEqual({
    p_day: TODAY_ISO_DAY,
    p_sleep: 4,
    p_soreness: 2,
    p_stress: 3,
    p_mood: 5,
    p_note: 'Tight hamstring after Saturday',
  });

  // Back on Today, nothing is left to do.
  await expect(page.getByRole('button', { name: /^Do your daily check-in/ })).toHaveCount(0);
  await expect(page.getByText('You’re set for today')).toBeVisible();
});
