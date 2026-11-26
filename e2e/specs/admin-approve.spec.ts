import { memberTab, openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople } from '../support/people';
import { expect, test } from '../support/test';

test('an admin approves a member waiting for approval from Club > People > Members', async ({ page }) => {
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
  await openTab(page, 'Club');
  // The request shows under People without opening the area.
  await expect(page.getByRole('button', { name: /^People/ })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Members 1 request waiting for approval' }).click();

  await expect(page.getByText('Waiting for approval', { exact: true })).toBeVisible();
  await expect(page.getByText('Asked to join as Athlete')).toBeVisible();
  await page.getByText(pending.full_name, { exact: true }).click();

  // Their request opens as one decision: what they asked for, the checks, then Approve.
  const request = page.getByTestId('join-request');
  await expect(request.getByText('Asked to join as an athlete · Mixed Open Squad')).toBeVisible();
  await expect(page.getByTestId('join-check-date-of-birth')).toContainText('Date of birth 09/03/2001');
  await expect(page.getByTestId('join-answers')).toContainText('Mixed Open Squad');
  // The full record is one tap away, and not in the way.
  await expect(request.getByRole('button', { name: 'Full record', exact: true })).toBeVisible();
  await expect(page.getByText('Other roles', { exact: true })).toHaveCount(0);
  await request.getByRole('button', { name: 'Approve Jordan', exact: true }).click();

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

test('an admin turns a request down from its summary, with a reason the member sees', async ({ page }) => {
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
        Object.assign(pending, { status: req.body.p_status, rejection_reason: req.body.p_rejection_reason });
        return null;
      }
      if (req.rpc === 'admin_set_member_details') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await page.getByText('Approve 1 join request', { exact: true }).click();
  const request = page.getByTestId('join-request');
  const decline = request.getByRole('button', { name: "Don't approve", exact: true });

  // The first tap shows the reasons and sends nothing; one has to be chosen.
  await decline.click();
  await expect(request.getByText('Reason if not approving')).toBeVisible();
  await decline.click();
  await expect(page.getByText('Choose a reason before turning this request down.')).toBeVisible();
  expect(backend.rpcCalls('admin_save_member')).toHaveLength(0);

  await request.getByRole('button', { name: 'Not registered with the club', exact: true }).click();
  await decline.click();
  await expect.poll(() => backend.rpcCalls('admin_save_member').length).toBe(1);
  expect(backend.rpcCalls('admin_save_member')[0]).toMatchObject({
    p_profile_id: pending.id,
    p_status: 'rejected',
    p_rejection_reason: 'not_registered',
  });

  // Back on Today, nobody is waiting.
  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await expect(page.getByText('Approve 1 join request', { exact: true })).toHaveCount(0);
});

test('the full record opens at its top from the foot of a request’s summary, and goes back', async ({ page }) => {
  const { admin, pending } = samplePeople();
  const people = [admin, pending];
  // A short phone, so Full record is below the fold and the summary has to be scrolled.
  await page.setViewportSize({ width: 390, height: 560 });

  const backend = await openApp(page, {
    me: admin,
    teams: [openSquad],
    handle: (req) => {
      if (req.table === 'profiles') {
        const id = eq(req.params, 'id');
        if (id) return people.find((p) => p.id === id);
        if (req.head) return people.filter((p) => p.status === 'pending' && p.join_requested_at);
        return people;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await page.getByText('Approve 1 join request', { exact: true }).click();
  const request = page.getByTestId('join-request');
  const fullRecord = request.getByRole('button', { name: 'Full record', exact: true });
  await expect(fullRecord).not.toBeInViewport();
  await fullRecord.click();

  // The full record starts at its top, where the way back is.
  const back = page.getByRole('button', { name: 'Back to the request’s summary', exact: true });
  await expect(back).toBeInViewport();
  // It opens on Overview; their roles are a tab away.
  await expect(memberTab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Other roles', { exact: true })).toBeHidden();
  await memberTab(page, 'Roles').click();
  await expect(page.getByText('Other roles', { exact: true })).toBeVisible();
  await memberTab(page, 'Overview').click();
  await back.click();
  await expect(request.getByText('Asked to join as an athlete · Mixed Open Squad')).toBeInViewport();
  expect(backend.rpcCalls('admin_save_member')).toHaveLength(0);
});
