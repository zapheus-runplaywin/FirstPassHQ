import { openApp } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople } from '../support/people';
import { expect, test } from '../support/test';

// Matt, 18 November 2026: a to-do about a member waiting for approval opens
// that member's approval, not the member list.
test('an admin taps the join request to-do and lands on that member’s approval', async ({ page }) => {
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
        Object.assign(pending, { status: req.body.p_status, role: req.body.p_role });
        return null;
      }
      if (req.rpc === 'admin_set_member_details') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await page.getByText('Approve 1 join request', { exact: true }).click();

  // Straight to their page, saying what to do, with the approval on it.
  // The home screen's own To do heading stays mounted underneath, so look in the card.
  const card = page.getByTestId('todo-banner');
  await expect(card.getByText('To do', { exact: true })).toBeVisible();
  await expect(card.getByText(/^Check who they are, choose their role/)).toBeVisible();
  await expect(page.getByText('Waiting for approval', { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/admin/${pending.id}`);

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => backend.rpcCalls('admin_save_member').length).toBe(1);
  expect(backend.rpcCalls('admin_save_member')[0]).toMatchObject({
    p_profile_id: pending.id,
    p_status: 'approved',
  });

  // Back home, the to-do has gone.
  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await expect(page.getByText('Approve 1 join request', { exact: true })).toHaveCount(0);
});
