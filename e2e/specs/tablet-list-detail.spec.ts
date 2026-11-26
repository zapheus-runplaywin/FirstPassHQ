import { memberTab, openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, samplePeople, TODAY, u17Squad, uuid } from '../support/people';
import { expect, test } from '../support/test';

// On an iPad on its side a list keeps its place and the item tapped opens
// beside it ("Using HQ on a tablet" in section 3 of docs/user-guide.md).

/** An iPad Air on its side. */
const TABLET = { width: 1180, height: 820 };

test('on a tablet, an admin stands a coach down beside the Members list, which then says so', async ({ page }) => {
  await page.setViewportSize(TABLET);
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
  await page.getByRole('button', { name: /^People/ }).click();
  await page.getByRole('button', { name: /^Members/ }).click();

  // The list on the left, and room beside it with nobody open yet.
  const list = page.getByTestId('list-pane').filter({ visible: true });
  const beside = page.getByTestId('detail-pane').filter({ visible: true });
  await expect(beside).toHaveText('Choose a member to open their page here.');
  const card = list.getByRole('button', { name: new RegExp(`^${coach.full_name}`) });
  await card.click();

  // Their page opens beside the list: the address is still the list's.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(beside.getByRole('heading', { name: coach.full_name! })).toBeVisible();
  await expect(card).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('button', { name: new RegExp(`^${admin.full_name}`) })).toHaveAttribute('aria-selected', 'false');
  await expect(memberTab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  // The list keeps its 380 points, and the page has the rest.
  expect((await list.boundingBox())?.width).toBe(380);
  expect((await beside.boundingBox())?.width).toBeGreaterThan(700);

  await memberTab(page, 'Checks').click();
  // The Stand down section: the innermost block holding its button.
  const standDownNow = page.getByRole('button', { name: 'Stand down now' });
  const section = beside.locator('div', { has: standDownNow }).last();
  await section.getByRole('button', { name: 'Interim negative notice' }).click();
  await section.getByPlaceholder('Kept with the record. Only admins see it.').fill('Screening Unit letter received');
  await standDownNow.click();
  await expect.poll(() => backend.rpcCalls('admin_stand_down').length).toBe(1);

  // Their page closes, and the list beside it already says they're stood down.
  await expect(beside).toHaveText('Choose a member to open their page here.');
  await expect(list.getByRole('button', { name: `${coach.full_name} Coach · Stood down`, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
});

test('on a tablet, an athlete under 18 reads a message beside the inbox, with no way to reply', async ({ page }) => {
  await page.setViewportSize(TABLET);
  const { minor } = samplePeople();
  const message = {
    id: uuid(901),
    sender_id: uuid(2),
    sender_name: 'Cam Roberts',
    body: 'Training moves to Lords Oval tonight, 6:30 start. Bring a light and dark top.',
    audience: 'group',
    audience_role: null,
    audience_label: u17Squad.name,
    created_at: '2026-10-17T23:05:00Z',
  };
  let readAt: string | null = null;

  const backend = await openApp(page, {
    me: minor,
    teams: [u17Squad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: u17Squad }],
    handle: (req) => {
      if (req.table === 'message_recipients') {
        if (req.head) return readAt ? [] : [{ read_at: null }];
        const copy = { read_at: readAt, for_children: null, for_child_names: null };
        if (eq(req.params, 'message_id')) return copy;
        // Their inbox; nothing is archived.
        if (req.params.get('archived_at') === 'not.is.null') return [];
        return [{ ...copy, message }];
      }
      if (req.table === 'messages' && eq(req.params, 'id') === message.id) return message;
      if (req.rpc === 'mark_message_read') {
        readAt = '2026-10-17T23:30:00Z';
        return null;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${minor.full_name}`)).toBeVisible();
  await openTab(page, 'Messages');
  const list = page.getByTestId('list-pane').filter({ visible: true });
  const beside = page.getByTestId('detail-pane').filter({ visible: true });

  // Nothing is open, and nothing is marked read, until they tap a message.
  await expect(beside).toHaveText('Choose a message to read it here.');
  await expect(list.getByLabel('Unread')).toHaveCount(1);
  expect(backend.rpcCalls('mark_message_read')).toEqual([]);

  await list.getByRole('button', { name: new RegExp(`^Unread ${message.sender_name}`) }).click();

  // It opens beside the inbox, which drops its unread dot.
  await expect(page).toHaveURL(/\/messages$/);
  await expect(beside.getByText(message.body, { exact: true })).toBeVisible();
  await expect(beside.getByRole('heading', { name: 'Message' })).toBeVisible();
  await expect.poll(() => backend.rpcCalls('mark_message_read')).toEqual([{ p_message_id: message.id }]);
  await expect(list.getByLabel('Unread')).toHaveCount(0);
  await expect(list.getByText('All read')).toBeVisible();
  expect(backend.called('rpc/message_receipts')).toBe(false);

  // Nowhere to type and nothing that replies, in the list or beside it.
  await expect(page.locator('textarea, input, [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /reply|respond|message cam|send/i })).toHaveCount(0);
  await expect(page.getByText(/\breply\b/i)).toHaveCount(0);
  await expect(beside.getByRole('link', { name: 'Report this message' })).toBeVisible();

  // The cross closes it, and the inbox stays.
  await beside.getByRole('button', { name: 'Close Message' }).click();
  await expect(beside).toHaveText('Choose a message to read it here.');
  await expect(list.getByText(message.body)).toBeVisible();
  const writes = backend.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !r.rpc);
  expect(writes).toEqual([]);
});

test('on an iPad upright, a message opens on its own screen as on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const { minor } = samplePeople();
  const message = {
    id: uuid(901),
    sender_id: uuid(2),
    sender_name: 'Cam Roberts',
    body: 'Training moves to Lords Oval tonight.',
    audience: 'group',
    audience_role: null,
    audience_label: u17Squad.name,
    created_at: '2026-10-17T23:05:00Z',
  };

  await openApp(page, {
    me: minor,
    teams: [u17Squad],
    memberships: [{ team_role: 'athlete', coach_title: null, selection: null, team: u17Squad }],
    handle: (req) => {
      if (req.table === 'message_recipients') {
        if (req.head) return [{ read_at: null }];
        const copy = { read_at: null, for_children: null, for_child_names: null };
        if (eq(req.params, 'message_id')) return copy;
        if (req.params.get('archived_at') === 'not.is.null') return [];
        return [{ ...copy, message }];
      }
      if (req.table === 'messages' && eq(req.params, 'id') === message.id) return message;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${minor.full_name}`)).toBeVisible();
  await openTab(page, 'Messages');
  await expect(page.getByTestId('list-detail')).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(`^Unread ${message.sender_name}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${message.id}$`));
});
