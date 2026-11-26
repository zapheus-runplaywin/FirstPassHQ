import { expectNowhereToWrite, openApp, openTab, tab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { samplePeople, u17Squad, uuid } from '../support/people';
import { expect, test } from '../support/test';

// AGENTS.md "No social media features for children": members under 18 never
// get replies to messages or direct messages.
test('an athlete under 18 reads a message, with no way to reply', async ({ page }) => {
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
  // The Messages tab counts the one they haven't opened.
  await expect(tab(page, 'Messages')).toContainText('1');
  await openTab(page, 'Messages');
  // Athletes can't send messages, so the inbox has no New message button.
  await expect(page.getByRole('button', { name: 'New message', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Unread ${message.sender_name} 7:05 am To ${u17Squad.name} ${message.body}` }).click();

  await expect(page).toHaveURL(new RegExp(`/messages/${message.id}$`));
  await expect(page.getByText(message.body, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText(`To ${u17Squad.name}`).filter({ visible: true })).toBeVisible();
  await expect.poll(() => backend.rpcCalls('mark_message_read')).toEqual([{ p_message_id: message.id }]);
  // Only the sender and admins see read receipts.
  expect(backend.called('rpc/message_receipts')).toBe(false);

  // Nowhere to write and nothing that replies or messages the sender, on any screen in the
  // stack. The inbox underneath has a search box, which is the only thing that takes typing.
  await expectNowhereToWrite(page);
  await expect(page.getByRole('button', { name: /reply|respond|message cam|send/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /reply|respond|message cam|send/i })).toHaveCount(0);
  await expect(page.getByText(/\breply\b/i)).toHaveCount(0);
  // The only thing to do with it is report it to the club safely.
  await expect(page.getByRole('link', { name: 'Report this message' })).toBeVisible();
  // And nothing was written back except the read receipt.
  const writes = backend.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !r.rpc);
  expect(writes).toEqual([]);

  // Back in the inbox, the search box sifts the messages already there. Typing in it finds the
  // message, sends nothing anywhere, and still leaves nothing to reply with.
  await page.goBack();
  const search = page.getByRole('searchbox', { name: 'Search messages' });
  await expect(search).toBeVisible();
  // Coming back reloads the inbox; once that has finished, nothing more is asked for.
  await expect(page.getByRole('button', { name: new RegExp(`^${message.sender_name}`) })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const before = backend.requests.length;
  await search.fill('lords oval');
  await expect(page.getByRole('button', { name: new RegExp(`^${message.sender_name}`) })).toBeVisible();
  await search.fill('nothing like this');
  await expect(page.getByText('Nothing found')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^${message.sender_name}`) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
  await expect(page.getByRole('button', { name: new RegExp(`^${message.sender_name}`) })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(backend.requests.length).toBe(before);
  await expectNowhereToWrite(page);
});
