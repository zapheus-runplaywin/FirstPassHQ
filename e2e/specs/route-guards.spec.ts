import type { Page } from '@playwright/test';

import { openApp } from '../support/app';
import { samplePeople } from '../support/people';
import { expect, test } from '../support/test';

const concern = {
  id: '00000000-0000-0000-0000-000000000501',
  created_at: '2026-10-12T08:10:00Z',
  raised_by_name: 'Alex Morgan',
  anonymous: false,
  contact_ok: true,
  contact_details: null,
  about_member_id: null,
  about_member_name: null,
  about_text: 'Pick-up after Saturday training',
  happened_on: '2026-10-11',
  body: 'Two children were left waiting in the car park after training finished.',
  involves_child: 'yes',
  context: null,
  status: 'received',
  closed_at: null,
  last_action_at: null,
};

/** The deep link was refused: the member is on Home, at the root path. */
async function expectSentHome(page: Page, name: string) {
  await expect(page.getByText(`Hi ${name}`)).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
}

test.describe('deep links', () => {
  for (const path of ['/concerns/report', '/injuries']) {
    test(`a guest who opens ${path} is sent Home`, async ({ page }) => {
      const { guest } = samplePeople();
      const backend = await openApp(page, {
        me: guest,
        path,
        handle: (req) => (req.rpc === 'concern_register' ? [concern] : req.rpc === 'visible_injuries' ? [] : undefined),
      });
      await expectSentHome(page, guest.full_name);
      await expect(page.getByRole('heading', { name: 'Concerns register' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Injuries' })).toHaveCount(0);
      await expect(page.getByText(concern.body)).toHaveCount(0);
      // The screen never loaded, so it never asked the database for its records.
      expect(backend.called('rpc/concern_register')).toBe(false);
      expect(backend.called('rpc/visible_injuries')).toBe(false);
    });
  }

  test('an admin can open /concerns/report', async ({ page }) => {
    const { admin } = samplePeople();
    const backend = await openApp(page, {
      me: admin,
      path: '/concerns/report',
      handle: (req) => {
        if (req.rpc === 'concern_register') return [concern];
        if (req.rpc === 'concern_history') return [];
        return undefined;
      },
    });
    await expect(page).toHaveURL(/\/concerns\/report$/);
    await expect(page.getByRole('heading', { name: 'Concerns register' }).first()).toBeVisible();
    await expect(page.getByText(concern.body)).toBeVisible();
    expect(backend.rpcCalls('concern_register')).toHaveLength(1);
    expect(backend.rpcCalls('concern_history')).toEqual([{ p_concern_id: concern.id }]);
  });
});
