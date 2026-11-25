import { openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople, TODAY_ISO_DAY, uuid } from '../support/people';
import { expect, test } from '../support/test';

test('an athlete does the daily check-in', async ({ page }) => {
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
          note: b.p_note,
          updated_at: '2026-10-17T23:30:00Z',
        };
        return null;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  // Today lists it as something that needs them.
  await page.getByRole('button', { name: /^Do your daily check-in/ }).click();

  await expect(page.getByText('How did you sleep?').filter({ visible: true })).toBeVisible();
  // Saving with questions unanswered is refused before anything is sent.
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByText('Answer all four questions.')).toBeVisible();
  expect(backend.rpcCalls('save_check_in')).toEqual([]);

  await page.getByRole('button', { name: '4: Well' }).click();
  await page.getByRole('button', { name: '2: Sore' }).click();
  await page.getByRole('button', { name: '3: Normal' }).click();
  await page.getByRole('button', { name: '5: Great' }).click();
  await page.getByPlaceholder('For example, tight calves after Sunday’s game').fill('Tight hamstring after Saturday');
  await page.getByRole('button', { name: 'Save check-in' }).click();

  await expect.poll(() => backend.rpcCalls('save_check_in').length).toBe(1);
  expect(backend.rpcCalls('save_check_in')[0]).toEqual({
    // Today in Perth, where the club is, not in UTC.
    p_day: TODAY_ISO_DAY,
    p_sleep: 4,
    p_soreness: 2,
    p_stress: 3,
    p_mood: 5,
    p_note: 'Tight hamstring after Saturday',
  });

  // Back on Today, nothing is left to do, and Me shows today's check-in as done.
  await expect(page.getByRole('button', { name: /^Do your daily check-in/ })).toHaveCount(0);
  await expect(page.getByText('You’re set for today')).toBeVisible();
  await openTab(page, 'Me');
  await expect(page.getByRole('button', { name: 'Daily check-in ✓ Done for today' })).toBeVisible();
});
