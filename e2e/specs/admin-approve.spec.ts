import { openApp } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople } from '../support/people';
import { expect, test } from '../support/test';

test('an admin approves a member waiting for approval from Administration > Members', async ({ page }) => {
  const { admin, pending } = samplePeople();
  const people = [admin, pending];

  const backend = await openApp(page, {
    me: admin,
    teams: [openSquad],
    handle: (req) => {
      if (req.table === 'profiles') {
        const id = eq(req.params, 'id');
        if (id) return people.find((p) => p.id === id);
        if (req.head) return people.filter((p) => p.status === 'pending' && p.join_requested_at);
        if (eq(req.params, 'status') === 'approved') return people.filter((p) => p.status === 'approved');
        return people;
      }
      if (req.rpc === 'admin_save_member') {
        // The database approves them with the role and squad chosen.
        Object.assign(pending, { status: req.body.p_status, role: req.body.p_role });
        return null;
      }
      if (req.rpc === 'admin_set_member_details') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await page.getByRole('button', { name: /^Administration/ }).click();
  await page.getByRole('button', { name: 'Members 1 request waiting for approval' }).click();

  await expect(page.getByText('Waiting for approval', { exact: true })).toBeVisible();
  await expect(page.getByText('Asked to join as Athlete')).toBeVisible();
  await page.getByText(pending.full_name, { exact: true }).click();

  // The member page starts from what they asked for.
  await expect(page.getByText('Mixed Open Squad').filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('admin_save_member').length).toBe(1);
  const [saved] = backend.rpcCalls('admin_save_member');
  expect(saved).toMatchObject({
    p_profile_id: pending.id,
    p_role: 'athlete',
    p_status: 'approved',
    p_teams: [{ team_id: openSquad.id, team_role: 'athlete', coach_title: null, selection: null }],
    p_rejection_reason: null,
    p_under_17: false,
    p_guardian_ids: [],
    p_extra_roles: [],
  });
  // Their details are saved first.
  expect(backend.rpcCalls('admin_set_member_details')).toEqual([
    expect.objectContaining({ p_profile_id: pending.id, p_date_of_birth: '2001-03-09' }),
  ]);

  // Back on Members, they're approved and nobody is waiting.
  await expect(page.getByText('No requests waiting.')).toBeVisible();
  await expect(page.getByRole('button', { name: `${pending.full_name} Athlete`, exact: true })).toBeVisible();
  await expect(page.getByText('Asked to join as Athlete')).toHaveCount(0);
});
