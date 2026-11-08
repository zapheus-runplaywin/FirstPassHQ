import { openApp } from '../support/app';
import { eq, type Handler } from '../support/fake-supabase';
import { openSquad, openSquadAthletes, samplePeople, TODAY, u17Squad, uuid } from '../support/people';
import { expect, test } from '../support/test';

const sentId = uuid(911);

/** Sends a message as the database would, and shows it to its sender with read receipts. */
function sendsMessages(sender: { id: string; full_name: string }) {
  let sent: Record<string, unknown> | null = null;
  const handle: Handler = (req) => {
    if (req.rpc === 'my_sent_messages') return sent ? [{ ...sent, recipient_count: 3, read_count: 0 }] : [];
    if (req.rpc === 'send_group_message') {
      const team = [openSquad, u17Squad].find((t) => t.id === req.body.p_team_id);
      sent = {
        id: sentId,
        sender_id: sender.id,
        sender_name: sender.full_name,
        body: req.body.p_body,
        audience: req.body.p_audience,
        audience_role: req.body.p_role,
        audience_label: team?.name ?? null,
        created_at: TODAY.toISOString(),
      };
      return sentId;
    }
    if (req.table === 'messages' && eq(req.params, 'id') === sentId) return sent ?? undefined;
    if (req.rpc === 'mark_message_read') return null;
    if (req.rpc === 'message_receipts') {
      return openSquadAthletes.map((a) => ({ profile_id: a.profile_id, full_name: a.full_name, read_at: null }));
    }
    return undefined;
  };
  return handle;
}

test('a coach messages their squad, and sees who has read it', async ({ page }) => {
  const { coach } = samplePeople();
  const body = 'Training moves to Lords Oval on Tuesday, 6:30 start.';

  const backend = await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
    handle: sendsMessages(coach),
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  await page.getByRole('button', { name: 'Messages No new messages' }).click();
  // Exact: "New message" is also part of the Home card's name ("Messages No new
  // messages"), which can still be showing when the click starts. Playwright then
  // picks the card, which Home hides a moment later, and waits for it until timeout.
  await page.getByRole('button', { name: 'New message', exact: true }).click();

  // Their one squad is chosen for them; coaches can't message the club or a role.
  await expect(page.getByRole('button', { name: openSquad.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Everyone', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'A role', exact: true })).toHaveCount(0);
  // An empty message is refused before anything is sent.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Write a message first.')).toBeVisible();
  expect(backend.rpcCalls('send_group_message')).toEqual([]);

  await page.getByPlaceholder('Write your message').fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('send_group_message').length).toBe(1);
  expect(backend.rpcCalls('send_group_message')[0]).toEqual({
    p_body: body,
    p_audience: 'group',
    p_role: null,
    p_team_id: openSquad.id,
  });

  // The sent message opens, with its read receipts.
  await expect(page).toHaveURL(new RegExp(`/messages/${sentId}$`));
  await expect(page.getByText(body, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText(`To ${openSquad.name}`).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Read by 0 of 3')).toBeVisible();
  await expect(page.getByText('Not read yet')).toHaveCount(3);
  expect(backend.rpcCalls('message_receipts')).toEqual([{ p_message_id: sentId }]);
});

test('a coach of two squads chooses which one to message', async ({ page }) => {
  const { coach } = samplePeople();
  const backend = await openApp(page, {
    me: coach,
    path: '/messages/new',
    teams: [openSquad, u17Squad],
    memberships: [
      { team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad },
      { team_role: 'coach', coach_title: 'assistant_coach', selection: null, team: u17Squad },
    ],
    handle: sendsMessages(coach),
  });

  await page.getByPlaceholder('Write your message').fill('Bring a light and dark top.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Choose a squad or team.')).toBeVisible();
  expect(backend.rpcCalls('send_group_message')).toEqual([]);

  await page.getByRole('button', { name: u17Squad.name, exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('send_group_message').length).toBe(1);
  expect(backend.rpcCalls('send_group_message')[0]).toEqual({
    p_body: 'Bring a light and dark top.',
    p_audience: 'group',
    p_role: null,
    p_team_id: u17Squad.id,
  });
  await expect(page.getByText(`To ${u17Squad.name}`).filter({ visible: true })).toBeVisible();
});

test('an athlete has no New message button, and /messages/new sends them Home', async ({ page }) => {
  const { athlete } = samplePeople();
  const memberships = [{ team_role: 'athlete', coach_title: null, selection: null, team: openSquad }];

  const backend = await openApp(page, { me: athlete, teams: [openSquad], memberships });
  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  await page.getByRole('button', { name: 'Messages No new messages' }).click();
  await expect(page.getByText('No messages yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New message', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sent', exact: true })).toHaveCount(0);
  expect(backend.called('rpc/my_sent_messages')).toBe(false);

  await page.goto('/messages/new');
  await expect(page.getByText(`Hi ${athlete.full_name}`)).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByPlaceholder('Write your message')).toHaveCount(0);
  expect(backend.called('rpc/send_group_message')).toBe(false);
});
