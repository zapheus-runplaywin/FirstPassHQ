/**
 * What the message screens (src/app/messages/index.tsx and [id].tsx) show
 * each kind of member once they're open.
 *
 * Coaches, managers, captains, the committee and admins send messages
 * (`useCanSendMessages`); read receipts are for the sender and admins only
 * (section 11 of the user guide, and `message_receipts` in the database).
 * Messages are one way: nobody, and above all no one under 18, gets a reply
 * box or a way to message someone back (AGENTS.md, "No social media features
 * for children"). Every message offers a way to report it.
 */
import { fireEvent, screen } from 'expo-router/testing-library';

import MessageScreen from '@/app/messages/[id]';
import MessagesScreen from '@/app/messages/index';
import { supabase } from '@/lib/supabase';
import type { InboxMessage, Message, MessageReceipt, SentMessage } from '@/lib/types';

import {
  morePersonas,
  openScreen,
  personas,
  resetClub,
  settle,
  TEAM,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

type Who = PersonaName | Persona;

const rpcNames = () => ((supabase.rpc as jest.Mock).mock.calls as [string][]).map(([n]) => n);

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

const MESSAGE: Message = {
  id: 'msg-1',
  sender_id: 'coach',
  sender_name: 'Sample coach',
  body: 'Training moves to 6pm on Thursday',
  audience: 'group',
  audience_role: null,
  audience_label: TEAM.name,
  created_at: '2026-10-17T07:00:00Z',
};

const RECEIPTS: MessageReceipt[] = [
  { profile_id: 'athlete', full_name: 'Sample athlete', read_at: '2026-10-17T08:00:00Z' },
  { profile_id: 'child-1', full_name: 'Sample Child', read_at: null },
];

/** Every member who could be messaged or send one, and whether they can send. */
const SENDERS: [string, Who][] = [
  ['coach', 'coach'],
  ['assistant coach', morePersonas.assistantCoach],
  ['manager', 'manager'],
  ['committee member', 'committee'],
  ['admin', 'admin'],
  ['athlete who also coaches', morePersonas.athleteCoach],
  ['club captain', { ...personas.athlete, isClubCaptain: true }],
  [
    'team captain',
    { ...personas.athlete, captaincies: [{ team_id: TEAM.id, profile_id: 'athlete', captain_role: 'captain' }] },
  ],
];

const NOT_SENDERS: [string, Who][] = [
  ['athlete', 'athlete'],
  ['under-18 athlete', morePersonas.under18Athlete],
  ['guardian', 'guardian'],
  ['physio', 'physio'],
  ['guest', 'guest'],
  ['coach whose check lapsed', 'coachExpiredCheck'],
  ['stood-down coach', 'stoodDownCoach'],
  ['stood-down admin', 'stoodDownAdmin'],
];

function noTextBoxes() {
  expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
  expect(screen.queryByText(/^Reply/)).toBeNull();
}

// ---------------------------------------------------------------------------
// The messages list

function inboxRow(extra: Partial<InboxMessage> = {}): InboxMessage {
  return { read_at: null, for_children: null, for_child_names: null, message: MESSAGE, ...extra };
}

const SENT: SentMessage[] = [
  {
    id: 'msg-2',
    body: 'Bring a water bottle',
    audience: 'group',
    audience_role: null,
    audience_label: TEAM.name,
    created_at: '2026-10-16T07:00:00Z',
    recipient_count: 12,
    read_count: 9,
  },
];

async function openList(who: Who, inbox: InboxMessage[] = [inboxRow()]) {
  await openScreen(who, { 'messages/index': MessagesScreen }, '/messages', { message_recipients: inbox }, {
    rpcs: { my_sent_messages: SENT },
  });
}

describe('the messages list', () => {
  it.each(SENDERS)('lets a %s write a message and see what they sent', async (_l, who) => {
    await openList(who);
    expect(screen.getByText('New message')).toBeTruthy();
    expect(screen.getByText('Inbox')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sent'));
    await settle();
    expect(screen.getByText('Bring a water bottle')).toBeTruthy();
    expect(screen.getByText('Read by 9 of 12')).toBeTruthy();
  });

  it.each(NOT_SENDERS)('gives a %s an inbox only, with no way to write or reply', async (_l, who) => {
    await openList(who);
    expect(screen.queryByText('New message')).toBeNull();
    expect(screen.queryByText('Sent')).toBeNull();
    expect(rpcNames()).not.toContain('my_sent_messages');
    expect(screen.getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    noTextBoxes();
  });

  it('shows who sent each message, who it went to, and whether it’s unread', async () => {
    await openList('athlete', [inboxRow(), inboxRow({ read_at: '2026-10-17T09:00:00Z', message: { ...MESSAGE, id: 'msg-3', sender_name: null } })]);
    expect(screen.getByText('Sample coach')).toBeTruthy();
    expect(screen.getByText('Club')).toBeTruthy();
    expect(screen.getAllByText(`To ${TEAM.name}`)).toHaveLength(2);
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1);
  });

  it('tells a guardian which child a copy was for', async () => {
    await openList('guardian', [inboxRow({ for_children: ['child-1'], for_child_names: ['Sample Child'] })]);
    expect(screen.getByText('Copied to you as Sample Child’s parent or guardian')).toBeTruthy();
  });

  it('tells a guardian when their child sent the message', async () => {
    await openList('guardian', [
      inboxRow({
        for_children: ['child-1'],
        for_child_names: ['Sample Child'],
        message: { ...MESSAGE, sender_id: 'child-1', sender_name: 'Sample Child' },
      }),
    ]);
    expect(screen.getByText('Copied to you because Sample Child sent it')).toBeTruthy();
  });

  it('says what an empty inbox is for', async () => {
    await openList('athlete', []);
    expect(
      screen.getByText('No messages yet. Messages from your coaches, managers, captains and the club will show here.'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One message

async function openMessage(who: Who, shown: Message | null, copy: object[] = []) {
  await openScreen(who, { 'messages/[id]': MessageScreen }, '/messages/msg-1', {
    messages: shown ? [shown] : [],
    message_recipients: copy,
  }, {
    rpcs: { message_receipts: RECEIPTS },
  });
}

describe('one message', () => {
  it('shows its sender the read receipts', async () => {
    await openMessage('coach', MESSAGE);
    expect(screen.getByText('Read by 1 of 2')).toBeTruthy();
    expect(screen.getByText('Sample athlete')).toBeTruthy();
    expect(screen.getByText(/^✓ Read /)).toBeTruthy();
    expect(screen.getByText('Not read yet')).toBeTruthy();
    noTextBoxes();
  });

  it('shows an admin the read receipts of a message they didn’t send', async () => {
    await openMessage('admin', MESSAGE);
    expect(screen.getByText('Read by 1 of 2')).toBeTruthy();
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
    ['another coach', morePersonas.assistantCoach],
    ['committee member', 'committee'],
    ['physio', 'physio'],
    ['stood-down admin', 'stoodDownAdmin'],
  ])('shows a %s who got it the message, but not who else read it', async (_l, who) => {
    await openMessage(who, MESSAGE, [{ read_at: null, for_children: null, for_child_names: null }]);
    expect(screen.getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    expect(screen.getByText('Sample coach')).toBeTruthy();
    expect(screen.queryByText(/^Read by/)).toBeNull();
    expect(screen.queryByText('Sample athlete')).toBeNull();
    expect(rpcNames()).not.toContain('message_receipts');
    noTextBoxes();
  });

  it('marks it read when opened', async () => {
    await openMessage('athlete', MESSAGE);
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'mark_message_read',
      { p_message_id: 'msg-1' },
    ]);
  });

  it('lets anyone who got it report it as a concern', async () => {
    await openMessage(morePersonas.under18Athlete, MESSAGE);
    expect(screen.getByText('Report this message')).toBeTruthy();
  });

  it('tells a guardian which child their copy was for', async () => {
    await openMessage('guardian', MESSAGE, [
      { read_at: null, for_children: ['child-1'], for_child_names: ['Sample Child'] },
    ]);
    expect(screen.getByText('Copied to you as Sample Child’s parent or guardian')).toBeTruthy();
  });

  it('says so when the database doesn’t return it', async () => {
    await openMessage('athlete', null);
    expect(screen.getByText('This message isn’t available.')).toBeTruthy();
    expect(rpcNames()).not.toContain('mark_message_read');
  });
});
