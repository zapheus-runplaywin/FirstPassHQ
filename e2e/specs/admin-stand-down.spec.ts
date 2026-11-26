import { memberTab, openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople, TODAY, uuid } from '../support/people';
import { expect, test } from '../support/test';

test('an admin stands a coach down on Checks with a reason, and the member page then says so and offers Lift stand-down', async ({ page }) => {
  const { admin, coach } = samplePeople();
  const people = [admin, coach];
  const standDowns: object[] = [];

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
      if (req.table === 'team_members' && eq(req.params, 'profile_id') === coach.id) {
        return coach.stood_down_at
          ? []
          : [{ team_id: openSquad.id, team_role: 'coach', coach_title: 'head_coach', selection: null, team: { archived: false } }];
      }
      if (req.table === 'stand_downs') return standDowns;
      if (req.rpc === 'admin_stand_down') {
        // The database records the stand-down and pauses their coach role.
        coach.stood_down_at = TODAY.toISOString();
        standDowns.push({
          id: uuid(301),
          profile_id: coach.id,
          member_name: coach.full_name,
          reason: req.body.p_reason,
          note: req.body.p_note,
          started_at: TODAY.toISOString(),
          started_by_name: admin.full_name,
          lifted_at: null,
          lifted_by_name: null,
          lift_note: null,
        });
        return null;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await openTab(page, 'Club');
  // Nothing is waiting, so the admin opens People themselves.
  await page.getByRole('button', { name: /^People/ }).click();
  await page.getByRole('button', { name: /^Members/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${coach.full_name}`) }).click();

  // Their page opens on Overview; standing down is on Checks.
  await expect(memberTab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Stand down now' })).toBeHidden();
  await memberTab(page, 'Checks').click();
  await expect(page.getByText('Stand down', { exact: true }).filter({ visible: true })).toBeVisible();
  // The Stand down section: the innermost block holding its button (Screening
  // Unit notices above it have their own reason chips).
  const standDownNow = page.getByRole('button', { name: 'Stand down now' });
  const section = page.locator('div', { has: standDownNow }).last();
  await section.getByRole('button', { name: 'Interim negative notice' }).click();
  await section.getByPlaceholder('Kept with the record. Only admins see it.').fill('Screening Unit letter received');
  await standDownNow.click();

  await expect.poll(() => backend.rpcCalls('admin_stand_down').length).toBe(1);
  expect(backend.rpcCalls('admin_stand_down')[0]).toEqual({
    p_profile_id: coach.id,
    p_reason: 'interim_negative_notice',
    p_note: 'Screening Unit letter received',
  });

  // The member page closes, and Members lists them as stood down.
  const stoodDown = page.getByRole('button', { name: `${coach.full_name} Coach · Stood down`, exact: true });
  await expect(stoodDown).toBeVisible();
  // Opened again, their page says so above the tabs, and that line opens
  // Checks, with the stand-down and Lift stand-down.
  await stoodDown.click();
  const paused = page.getByTestId('member-paused').filter({ visible: true });
  await expect(paused).toContainText(/Stood down since .+ 2026\. Paused: Coach\.$/);
  await expect(page.getByRole('button', { name: 'Lift stand-down' })).toBeHidden();
  await paused.click();
  await expect(memberTab(page, 'Checks')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Lift stand-down' })).toBeVisible();
  await expect(
    page.getByText(/Stood down since .*: Interim negative notice \(Screening Unit letter received\)/).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stand down now' })).toHaveCount(0);
  expect(backend.rpcCalls('admin_lift_stand_down')).toEqual([]);
});
