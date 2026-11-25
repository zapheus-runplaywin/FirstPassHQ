import { openApp, openTab, tab } from '../support/app';
import { eq, type Handler } from '../support/fake-supabase';
import { samplePeople, u17Squad, uuid } from '../support/people';
import { expect, test } from '../support/test';

/** The club's absence reasons, from Club setup. */
const reasons = [
  { id: uuid(601), name: 'Planned event', active: true, sort_order: 1 },
  { id: uuid(602), name: 'Illness', active: true, sort_order: 2 },
];

/** Answers for a guardian of one child under 18, Riley Evans. */
function guardianOf(child: { id: string; full_name: string }): Handler {
  return (req) => {
    if (req.rpc === 'my_child_consents') {
      return [{ athlete_id: child.id, full_name: child.full_name, data: true, health: true, can_consent: true }];
    }
    if (req.rpc === 'child_activity_new') return [];
    return undefined;
  };
}

test('a guardian sees their child in Family and reports them away tomorrow', async ({ page }) => {
  const { guardian, minor } = samplePeople();
  const absences: object[] = [];
  const family = guardianOf(minor);

  const backend = await openApp(page, {
    me: guardian,
    handle: (req) => {
      const answer = family(req);
      if (answer !== undefined) return answer;
      if (req.table === 'absence_categories') return reasons;
      if (req.rpc === 'is_athlete_or_guardian') return req.body.p_athlete_id === minor.id;
      if (req.rpc === 'athlete_attendance') return [];
      if (req.rpc === 'my_absences') return absences;
      if (req.rpc === 'report_absence') {
        absences.push({
          id: uuid(611),
          from_day: req.body.p_from,
          to_day: req.body.p_to,
          category: reasons.find((r) => r.id === req.body.p_category_id)?.name ?? null,
          reason: req.body.p_reason,
          reported_by_name: guardian.full_name,
          reported_as: 'guardian',
          created_at: '2026-10-17T23:30:00Z',
          withdrawn_at: null,
        });
        return null;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${guardian.full_name}`)).toBeVisible();
  // Their children are in the Family tab.
  await openTab(page, 'Family');
  // One card for each child, which opens the child's own page.
  await expect(page.getByRole('button', { name: /^Add another child/ })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${minor.full_name}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/child/${minor.id}`));
  await expect(page.getByRole('button', { name: 'Game goals Goals and reflections' })).toBeVisible();
  await page.getByRole('button', { name: 'Attendance Their sessions and absences' }).click();

  // Their child's attendance, where they report and withdraw absences.
  await expect(page.getByText('None coming up.')).toBeVisible();
  expect(backend.rpcCalls('my_absences')).toEqual([{ p_athlete_id: minor.id }]);
  expect(backend.rpcCalls('is_athlete_or_guardian')).toEqual([{ p_athlete_id: minor.id }]);
  await page.getByRole('button', { name: 'Report an absence' }).click();

  await expect(
    page.getByText(`Tell ${minor.full_name}’s coaches and managers they’ll be away, or were away.`, { exact: false }),
  ).toBeVisible();
  // Saving with no reason chosen is refused before anything is sent.
  await page.getByRole('button', { name: 'Report absence', exact: true }).click();
  await expect(page.getByText('Choose a reason.')).toBeVisible();
  expect(backend.rpcCalls('report_absence')).toEqual([]);

  // First day away: tomorrow, which moves the last day along with it.
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).first().click();
  await page.getByRole('button', { name: 'Planned event', exact: true }).click();
  await page.getByPlaceholder('For example, school camp').fill('School camp');
  await page.getByRole('button', { name: 'Report absence', exact: true }).click();

  await expect.poll(() => backend.rpcCalls('report_absence').length).toBe(1);
  expect(backend.rpcCalls('report_absence')[0]).toEqual({
    p_athlete_id: minor.id,
    // Tomorrow in Perth: Monday 19 October.
    p_from: '2026-10-19',
    p_to: '2026-10-19',
    p_category_id: reasons[0].id,
    p_reason: 'School camp',
  });

  // Back on their child's attendance, the absence is listed and can be withdrawn.
  await expect(page.getByText('Planned event · School camp · Reported by Dana Evans')).toBeVisible();
  await expect(page.getByText(/^Mon,? 19 Oct,? 2026$/).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  expect(backend.rpcCalls('withdraw_absence')).toEqual([]);
});

// AGENTS.md "No social media features for children": no direct messages or
// replies, and a guardian gets nothing meant for coaches or admins.
test('a guardian reads the copy of a message to their child, with no way to reply or message the coach', async ({
  page,
}) => {
  const { guardian, minor } = samplePeople();
  const message = {
    id: uuid(903),
    sender_id: uuid(2),
    sender_name: 'Cam Roberts',
    body: 'Riley’s squad trains at Lords Oval on Tuesday, 6:30 start.',
    audience: 'group',
    audience_role: null,
    audience_label: u17Squad.name,
    created_at: '2026-10-17T22:00:00Z',
  };
  const copy = { read_at: null, for_children: [minor.id], for_child_names: [minor.full_name] };
  const family = guardianOf(minor);

  const backend = await openApp(page, {
    me: guardian,
    handle: (req) => {
      const answer = family(req);
      if (answer !== undefined) return answer;
      if (req.table === 'message_recipients') {
        if (req.head) return [{ read_at: null }];
        if (eq(req.params, 'message_id')) return copy;
        return [{ ...copy, message }];
      }
      if (req.table === 'messages' && eq(req.params, 'id') === message.id) return message;
      if (req.rpc === 'mark_message_read') return null;
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${guardian.full_name}`)).toBeVisible();
  // No Team or Club tab, and nothing for coaches, admins or the concerns
  // register on Today or in Family.
  await expect(tab(page, 'Team')).toHaveCount(0);
  await expect(tab(page, 'Club')).toHaveCount(0);
  const staffCards = [/^People/, /^Club setup/, /^Attendance Take attendance/, /^Concerns/, /^Check-ins/, /^Session plans Add/];
  for (const card of staffCards) {
    await expect(page.getByRole('button', { name: card })).toHaveCount(0);
  }
  await openTab(page, 'Family');
  await expect(page.getByRole('button', { name: /^Add another child/ })).toBeVisible();
  for (const card of staffCards) {
    await expect(page.getByRole('button', { name: card })).toHaveCount(0);
  }
  expect(backend.called('rpc/absences_to_review')).toBe(false);

  await expect(tab(page, 'Messages')).toContainText('1');
  await openTab(page, 'Messages');
  // Guardians can't send messages.
  await expect(page.getByText(`Copied to you as ${minor.full_name}’s parent or guardian`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New message', exact: true })).toHaveCount(0);
  expect(backend.called('rpc/my_sent_messages')).toBe(false);
  await page.getByRole('button', { name: new RegExp(`^Unread ${message.sender_name}`) }).click();

  await expect(page).toHaveURL(new RegExp(`/messages/${message.id}$`));
  await expect(page.getByText(message.body, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect.poll(() => backend.rpcCalls('mark_message_read')).toEqual([{ p_message_id: message.id }]);
  expect(backend.called('rpc/message_receipts')).toBe(false);
  // Nowhere to type, and nothing that replies or messages the coach.
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /reply|respond|message cam|send/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /reply|respond|message cam|send/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Report this message' })).toBeVisible();
  const writes = backend.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !r.rpc);
  expect(writes).toEqual([]);
});

test('a guardian who opens /messages/new is sent Home', async ({ page }) => {
  const { guardian, minor } = samplePeople();
  const backend = await openApp(page, { me: guardian, path: '/messages/new', handle: guardianOf(minor) });
  await expect(page.getByText(`Hi ${guardian.full_name}`)).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByPlaceholder('Write your message')).toHaveCount(0);
  expect(backend.called('rpc/send_group_message')).toBe(false);
});
