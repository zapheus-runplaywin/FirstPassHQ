/**
 * What the message screens (src/app/(tabs)/messages.tsx and [id].tsx) show
 * each kind of member once they're open.
 *
 * Coaches, managers, captains, the committee and admins send messages
 * (`useCanSendMessages`); read receipts are for the sender only (section 11
 * of the user guide, and `message_receipts` in the database). Admins don't
 * read other people's messages (21 November 2026). Members archive their own
 * copy; nothing is deleted.
 * Messages are one way: nobody, and above all no one under 18, gets a reply
 * box or a way to message someone back (AGENTS.md, "No social media features
 * for children"). Every message offers a way to report it.
 */
import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { fireEvent, screen, within } from 'expo-router/testing-library';

import MessageScreen from '@/app/messages/[id]';
import MessagesScreen from '@/app/(tabs)/messages';
import { supabase } from '@/lib/supabase';
import type { MessageQuestion } from '@/lib/message-questions';
import type { InboxMessage, Message, MessageReceipt, SentMessage } from '@/lib/types';

import {
  inTabs,
  morePersonas,
  onATablet,
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
      screen.getByText(
        'No messages in your inbox. Messages from your coaches, managers, captains and the club will show here, and ones you archive are in Archived.',
      ),
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

  it('never asks for receipts for an admin who didn’t send it', async () => {
    await openMessage('admin', MESSAGE, [{ read_at: null, for_children: null, for_child_names: null }]);
    expect(screen.queryByText(/^Read by/)).toBeNull();
    expect(rpcNames()).not.toContain('message_receipts');
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

  it('reports the message itself, so the concern keeps a copy of it', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    try {
      await openMessage('athlete', MESSAGE);
      await fireEvent.press(screen.getByText('Report this message'));
      expect(push).toHaveBeenCalledWith({
        pathname: '/concern/new',
        params: { message: 'msg-1', context: expect.stringMatching(/^Message from Sample coach, /) },
      });
    } finally {
      push.mockRestore();
    }
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

// ---------------------------------------------------------------------------
// A message that asks a question (20261120300000_message_questions.sql)

const QUESTION_MESSAGE: Message = { ...MESSAGE, body: 'Extra session Friday?', answer_options: ['Yes', 'No', 'Not sure'] };

function question(extra: Partial<MessageQuestion> = {}): MessageQuestion {
  return {
    options: ['Yes', 'No', 'Not sure'],
    closed: false,
    totals_shared: false,
    can_close: false,
    my_answer: null,
    my_answer_by_name: null,
    my_answer_by_parent: false,
    can_answer_myself: true,
    children: [],
    totals: null,
    answers: null,
    not_answered: null,
    ...extra,
  };
}

async function openQuestion(who: Who, q: MessageQuestion, rpcErrors: Record<string, string> = {}) {
  await openScreen(who, { 'messages/[id]': MessageScreen }, '/messages/msg-1', {
    messages: [QUESTION_MESSAGE],
    message_recipients: [{ read_at: null, for_children: null, for_child_names: null, answer: null }],
  }, {
    rpcs: { message_receipts: RECEIPTS, message_question: q },
    rpcErrors,
  });
}

const SENDER_VIEW = question({
  can_answer_myself: false,
  can_close: true,
  totals: [1, 1, 1],
  answers: [
    { profile_id: 'kai', name: 'Kai Senior', answer: 1, answered_by_name: 'Kai Senior', answered_by_parent: false, answered_at: '2026-11-20T06:00:00Z' },
    { profile_id: 'jordan', name: 'Jordan Junior', answer: 0, answered_by_name: 'Logan Parent', answered_by_parent: true, answered_at: '2026-11-20T06:05:00Z' },
    { profile_id: 'morgan', name: 'Morgan Coach', answer: 2, answered_by_name: 'Morgan Coach', answered_by_parent: false, answered_at: '2026-11-20T06:10:00Z' },
  ],
  not_answered: ['Emery Manager'],
});

describe('a message that asks a question', () => {
  it('offers its answers as one tap each, and nothing to type', async () => {
    await openQuestion(morePersonas.under18Athlete, question());
    expect(screen.getByText('Your answer')).toBeTruthy();
    for (const o of ['Yes', 'No', 'Not sure']) expect(screen.getByText(o)).toBeTruthy();
    noTextBoxes();
    await fireEvent.press(screen.getByText('No'));
    await settle();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'answer_message_question',
      { p_message_id: 'msg-1', p_answer: 1, p_for_child: null },
    ]);
  });

  it('shows a member their answer once given, with no way to change it', async () => {
    await openQuestion('athlete', question({ my_answer: 0, my_answer_by_name: 'Sample athlete' }));
    expect(screen.getByText('Your answer: Yes')).toBeTruthy();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('tells a child when their parent answered for them', async () => {
    await openQuestion(morePersonas.under18Athlete, question({ my_answer: 0, my_answer_by_name: 'Logan Parent', my_answer_by_parent: true }));
    expect(screen.getByText('Your answer: Yes, answered by Logan Parent')).toBeTruthy();
  });

  it('shows members no names, and no totals unless shared', async () => {
    await openQuestion('athlete', question({ my_answer: 0 }));
    expect(screen.queryByText(/answered$/)).toBeNull();
    expect(screen.queryByText('Kai Senior')).toBeNull();
    expect(screen.queryByText('Close question')).toBeNull();
  });

  it('shows members the totals when the sender shares them, still without names', async () => {
    await openQuestion('athlete', question({ my_answer: 0, totals_shared: true, totals: [5, 2, 1] }));
    expect(screen.getByText('Totals for everyone it went to')).toBeTruthy();
    expect(screen.getByText('5 · 63%')).toBeTruthy();
    expect(screen.queryByText(/Not answered yet/)).toBeNull();
  });

  it('lets a parent answer for their child', async () => {
    await openQuestion('guardian', question({
      can_answer_myself: false,
      children: [{ id: 'child-1', name: 'Sample Child', answer: null, answered_by_name: null, answered_by_parent: false, answered_at: null }],
    }));
    expect(screen.queryByText('Your answer')).toBeNull();
    expect(screen.getByText('Answer for Sample Child')).toBeTruthy();
    await fireEvent.press(screen.getByText('Not sure'));
    await settle();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'answer_message_question',
      { p_message_id: 'msg-1', p_answer: 2, p_for_child: 'child-1' },
    ]);
  });

  it('shows a parent their child’s answer, who gave it and when', async () => {
    await openQuestion('guardian', question({
      can_answer_myself: false,
      children: [{ id: 'child-1', name: 'Sample Child', answer: 1, answered_by_name: 'Sample Child', answered_by_parent: false, answered_at: '2026-11-20T06:00:00Z' }],
    }));
    expect(screen.getByText('Sample Child: No')).toBeTruthy();
    expect(screen.getByText(/^Answered /)).toBeTruthy();
    expect(screen.queryByText('Answer for Sample Child')).toBeNull();
  });

  it('shows the sender every answer by name, Not sure first to follow up, and who hasn’t answered', async () => {
    await openQuestion('coach', SENDER_VIEW);
    expect(screen.getByText('3 answered')).toBeTruthy();
    expect(screen.getByText('Not sure (1): follow up')).toBeTruthy();
    expect(screen.getByText('Morgan Coach')).toBeTruthy();
    expect(screen.getByText('Jordan Junior (answered by Logan Parent)')).toBeTruthy();
    expect(screen.getByText('Not answered yet (1)')).toBeTruthy();
    expect(screen.getByText('Emery Manager')).toBeTruthy();
    const labels = screen.getAllByText(/^(Yes|No|Not sure) \(\d\)/).map((n) => n.props.children.join(''));
    expect(labels[0]).toMatch(/^Not sure/);
  });

  it('lets whoever may close it close it', async () => {
    await openQuestion('coach', SENDER_VIEW);
    await fireEvent.press(screen.getByText('Close question'));
    await settle();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual(['close_message_question', { p_message_id: 'msg-1' }]);
  });

  it('says when a question is closed and takes no more answers', async () => {
    await openQuestion('athlete', question({ closed: true }));
    expect(screen.getByText('Question (closed)')).toBeTruthy();
    expect(screen.getByText('You didn’t answer before it closed.')).toBeTruthy();
    expect(screen.queryByText('Not sure')).toBeNull();
  });

  it('shows the database’s refusal', async () => {
    await openQuestion('athlete', question(), { answer_message_question: 'This has already been answered' });
    await fireEvent.press(screen.getByText('Yes'));
    await settle();
    expect(screen.getByText('This has already been answered')).toBeTruthy();
  });

  it('asks nothing on a plain message', async () => {
    await openMessage('athlete', MESSAGE);
    expect(rpcNames()).not.toContain('message_question');
    expect(screen.queryByText('Question')).toBeNull();
  });

  it('tags a question in the inbox', async () => {
    await openList('athlete', [inboxRow({ message: QUESTION_MESSAGE, answer: null })]);
    expect(screen.getByText('Question: tap to answer')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Read controls: Mark all read, Hide read and Mark as unread. They change the
// member's own inbox only; the sender's receipt (read_at) is never sent from
// the app, so it can't be changed by them.

const READ_ROW = (id: string, body: string) =>
  inboxRow({
    read_at: '2026-10-17T09:00:00Z',
    unread: false,
    message: { ...MESSAGE, id, body },
  });

describe('read controls in the inbox', () => {
  const ALL_WHO_GET_MESSAGES: [string, Who][] = [...SENDERS, ...NOT_SENDERS.filter(([l]) => l !== 'guest')];

  it.each(ALL_WHO_GET_MESSAGES)('gives a %s Inbox, Archived and Mark all read', async (_l, who) => {
    await openList(who, [inboxRow(), READ_ROW('msg-3', 'Old news')]);
    expect(screen.getByText('Inbox')).toBeTruthy();
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.getByText('Mark all read')).toBeTruthy();
    expect(screen.getByText('1 unread')).toBeTruthy();
    expect(screen.getByText('Swipe a message to the left to archive it.')).toBeTruthy();
    expect(screen.queryByText('Hide read')).toBeNull();
  });

  it('follows the member’s own unread mark over the first read time', async () => {
    await openList('athlete', [
      // Opened, then put back for later.
      inboxRow({ read_at: '2026-10-17T09:00:00Z', unread: true }),
      // Never opened, cleared with Mark all read.
      inboxRow({ read_at: null, unread: false, message: { ...MESSAGE, id: 'msg-3', body: 'Cleared' } }),
    ]);
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1);
    expect(screen.getByText('1 unread')).toBeTruthy();
  });

  it('Mark all read clears every dot and asks the database to do the same', async () => {
    const inbox = [
      inboxRow(),
      inboxRow({ message: { ...MESSAGE, id: 'msg-3', body: 'Second' } }),
      READ_ROW('msg-4', 'Old news'),
    ];
    await openScreen('athlete', { 'messages/index': MessagesScreen }, '/messages', { message_recipients: inbox }, {
      rpcHandlers: {
        mark_all_messages_read: () => {
          inbox.forEach((row) => (row.unread = false));
          return 2;
        },
      },
    });
    expect(screen.getAllByLabelText('Unread')).toHaveLength(2);
    await fireEvent.press(screen.getByText('Mark all read'));
    await settle();
    expect(rpcNames()).toContain('mark_all_messages_read');
    expect(screen.queryAllByLabelText('Unread')).toHaveLength(0);
    expect(screen.getByText('All read')).toBeTruthy();
    expect(screen.queryByText('Mark all read')).toBeNull();
    // Nothing that would set a read receipt is called.
    expect(rpcNames()).not.toContain('mark_message_read');
  });

  it('hides Mark all read when nothing is unread', async () => {
    await openList('athlete', [READ_ROW('msg-3', 'Old news')]);
    expect(screen.queryByText('Mark all read')).toBeNull();
    expect(screen.getByText('All read')).toBeTruthy();
  });

  it('shows no controls in an empty inbox', async () => {
    await openList('athlete', []);
    expect(screen.queryByText('Mark all read')).toBeNull();
    expect(screen.queryByText('Swipe a message to the left to archive it.')).toBeNull();
  });

  it('keeps the read controls off the Sent list', async () => {
    await openList('coach');
    await fireEvent.press(screen.getByText('Sent'));
    await settle();
    expect(screen.queryByText('Mark all read')).toBeNull();
    expect(screen.queryByText('Swipe a message to the left to archive it.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Archive. Swiping left (or the card's Archive action, for screen readers)
// moves the member's own copy to Archived; nothing is deleted and nobody
// else's copy changes. Sent messages can't be archived.

const ARCHIVED_ROW = (id: string, body: string) =>
  inboxRow({
    read_at: null,
    unread: false,
    archived_at: '2026-10-18T09:00:00Z',
    message: { ...MESSAGE, id, body },
  });

/** Runs a card's screen-reader action, such as "Archive". */
async function cardAction(text: string, action: string) {
  let node = screen.getByText(text);
  while (node && !node.props.accessibilityActions) node = node.parent as typeof node;
  await fireEvent(node, 'accessibilityAction', { nativeEvent: { actionName: action } });
  await settle();
}

describe('archiving messages', () => {
  it('keeps archived copies out of the inbox and shows them under Archived', async () => {
    await openList('athlete', [inboxRow(), ARCHIVED_ROW('msg-5', 'Kit order closed')]);
    expect(screen.getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    expect(screen.queryByText('Kit order closed')).toBeNull();
    await fireEvent.press(screen.getByText('Archived'));
    await settle();
    expect(screen.getByText('Kit order closed')).toBeTruthy();
    expect(screen.queryByText('Training moves to 6pm on Thursday')).toBeNull();
    expect(screen.getByText('Swipe left to move a message back to your inbox.')).toBeTruthy();
  });

  it('archives a message from its card, and asks the database to move only this copy', async () => {
    await openList(morePersonas.under18Athlete, [inboxRow(), READ_ROW('msg-3', 'Old news')]);
    await cardAction('Training moves to 6pm on Thursday', 'Archive');
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual(['archive_message', { p_message_id: 'msg-1' }]);
    expect(screen.queryByText('Training moves to 6pm on Thursday')).toBeNull();
    expect(screen.getByText('Moved to Archived')).toBeTruthy();
    expect(screen.getByText('All read')).toBeTruthy();
    // Archiving never records the message as opened.
    expect(rpcNames()).not.toContain('mark_message_read');
    // There is no delete.
    expect(rpcNames().some((n) => /delete/.test(n))).toBe(false);
    await fireEvent.press(screen.getByText('Archived'));
    await settle();
    expect(screen.getByText('Training moves to 6pm on Thursday')).toBeTruthy();
  });

  it('Undo puts it straight back', async () => {
    await openList('athlete', [inboxRow()]);
    await cardAction('Training moves to 6pm on Thursday', 'Archive');
    await fireEvent.press(screen.getByText('Undo'));
    await settle();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'move_message_to_inbox',
      { p_message_id: 'msg-1' },
    ]);
    expect(screen.getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    expect(screen.queryByText('Moved to Archived')).toBeNull();
  });

  it('moves an archived message back to the inbox', async () => {
    await openList('guardian', [ARCHIVED_ROW('msg-5', 'Kit order closed')]);
    await fireEvent.press(screen.getByText('Archived'));
    await settle();
    await cardAction('Kit order closed', 'Move to inbox');
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'move_message_to_inbox',
      { p_message_id: 'msg-5' },
    ]);
    expect(screen.getByText('Nothing archived. Swipe a message to the left in your inbox to archive it.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Inbox'));
    await settle();
    expect(screen.getByText('Kit order closed')).toBeTruthy();
  });

  it('offers no archive on Sent', async () => {
    await openList('coach');
    await fireEvent.press(screen.getByText('Sent'));
    await settle();
    expect(screen.getByText('Bring a water bottle')).toBeTruthy();
    let node = screen.getByText('Bring a water bottle');
    while (node.parent && !node.props.accessibilityActions) node = node.parent as typeof node;
    expect(node.props.accessibilityActions ?? []).toEqual([]);
  });
});

describe('archive on an open message', () => {
  it('archives the member’s copy after the open is recorded, then goes back', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    const canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
    try {
      await openMessage('athlete', MESSAGE, [{ read_at: null, for_children: null, for_child_names: null }]);
      await fireEvent.press(screen.getByText('Archive'));
      await settle();
      const calls = (supabase.rpc as jest.Mock).mock.calls as [string, unknown][];
      const read = calls.findIndex(([n]) => n === 'mark_message_read');
      const archived = calls.findIndex(([n]) => n === 'archive_message');
      expect(read).toBeGreaterThanOrEqual(0);
      expect(archived).toBeGreaterThan(read);
      expect(calls[archived]).toEqual(['archive_message', { p_message_id: 'msg-1' }]);
      expect(back).toHaveBeenCalled();
    } finally {
      back.mockRestore();
      canGoBack.mockRestore();
    }
  });

  it('offers Move to inbox on an archived message', async () => {
    await openMessage('athlete', MESSAGE, [
      { read_at: null, archived_at: '2026-10-18T09:00:00Z', for_children: null, for_child_names: null },
    ]);
    expect(screen.queryByText('Archive')).toBeNull();
    await fireEvent.press(screen.getByText('Move to inbox'));
    await settle();
    expect((supabase.rpc as jest.Mock).mock.calls).toContainEqual([
      'move_message_to_inbox',
      { p_message_id: 'msg-1' },
    ]);
  });

  it('offers nothing to archive to the sender, who has no copy', async () => {
    await openMessage('coach', MESSAGE);
    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.queryByText('Move to inbox')).toBeNull();
  });
});

describe('mark as unread on an open message', () => {
  const OWN_COPY = [{ read_at: '2026-10-17T09:00:00Z', unread: false, for_children: null, for_child_names: null }];

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
    ['coach who got it', 'coach'],
    ['physio', 'physio'],
  ])('lets a %s who got it put it back as unread', async (_l, who) => {
    await openMessage(who, MESSAGE, OWN_COPY);
    expect(screen.getByText('Mark as unread')).toBeTruthy();
  });

  it('isn’t offered to the sender or an admin who has no copy', async () => {
    await openMessage('coach', MESSAGE);
    expect(screen.queryByText('Mark as unread')).toBeNull();
    await openMessage('admin', MESSAGE);
    expect(screen.queryByText('Mark as unread')).toBeNull();
  });

  it('marks it unread after the open is recorded, then goes back to the inbox', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    const canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
    try {
      await openMessage('athlete', MESSAGE, OWN_COPY);
      await fireEvent.press(screen.getByText('Mark as unread'));
      await settle();
      const calls = (supabase.rpc as jest.Mock).mock.calls as [string, unknown][];
      const read = calls.findIndex(([n]) => n === 'mark_message_read');
      const unread = calls.findIndex(([n]) => n === 'mark_message_unread');
      expect(unread).toBeGreaterThan(read);
      expect(read).toBeGreaterThanOrEqual(0);
      expect(calls[unread]).toEqual(['mark_message_unread', { p_message_id: 'msg-1' }]);
      expect(back).toHaveBeenCalled();
    } finally {
      back.mockRestore();
      canGoBack.mockRestore();
    }
  });

  it('opens the inbox when there is nothing to go back to', async () => {
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    const canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(false);
    try {
      await openMessage('athlete', MESSAGE, OWN_COPY);
      await fireEvent.press(screen.getByText('Mark as unread'));
      await settle();
      expect(replace).toHaveBeenCalledWith('/messages');
    } finally {
      replace.mockRestore();
      canGoBack.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// On a tablet: a message opens beside the list

describe('the messages list on a tablet', () => {
  onATablet();

  let push: jest.SpyInstance;
  let back: jest.SpyInstance;
  beforeEach(() => {
    push = jest.spyOn(router, 'push').mockImplementation(() => {});
    back = jest.spyOn(router, 'back').mockImplementation(() => {});
  });
  afterEach(() => {
    push.mockRestore();
    back.mockRestore();
  });

  const SECOND: Message = { ...MESSAGE, id: 'msg-3', body: 'Bibs are in the blue bag' };

  /** How many times the Messages tab's unread count was asked for. */
  let counts = 0;

  /** A backend that keeps what the member does to their own copies, as the database does. */
  async function open(who: Who, Screen: ComponentType = MessagesScreen) {
    counts = 0;
    const copies: (InboxMessage & { archived_at?: string | null })[] = [
      inboxRow(),
      inboxRow({ message: SECOND }),
    ];
    const copyOf = (id: unknown) => copies.find((c) => c.message.id === id);
    const change = (id: unknown, changes: Partial<InboxMessage> & { archived_at?: string | null }) =>
      Object.assign(copyOf(id) ?? {}, changes);
    await openScreen(who, { 'messages/index': Screen }, '/messages', {}, {
      rpcs: { my_sent_messages: SENT, message_receipts: RECEIPTS },
      tableHandlers: {
        // The list asks for the member's copies, a message's screen for one message and its copy.
        messages: (q) => [MESSAGE, SECOND, { ...MESSAGE, ...SENT[0], sender_id: 'coach' }].filter((m) => m.id === q.eq('id')),
        message_recipients: (q) => {
          if (q.eq('unread') === true) {
            counts += 1;
            return copies.filter((c) => c.unread ?? !c.read_at);
          }
          return q.eq('message_id') ? copies.filter((c) => c.message.id === q.eq('message_id')) : copies;
        },
      },
      rpcHandlers: {
        mark_message_read: (args) => change(args.p_message_id, { read_at: '2026-10-18T02:00:00Z', unread: false }),
        mark_message_unread: (args) => change(args.p_message_id, { unread: true }),
        archive_message: (args) => change(args.p_message_id, { archived_at: '2026-10-18T02:00:00Z' }),
      },
    });
  }
  const beside = () => within(screen.getByTestId('detail-pane'));
  const list = () => within(screen.getByTestId('list-pane'));
  const calls = (name: string) =>
    ((supabase.rpc as jest.Mock).mock.calls as [string, unknown][]).filter(([n]) => n === name);
  const tap = async (text: string) => {
    await fireEvent.press(list().getByText(text));
    await settle();
  };

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
    ['coach', 'coach'],
    ['admin', 'admin'],
  ])('opens nothing for a %s, and marks nothing read, until a message is tapped', async (_l, who) => {
    await open(who);
    expect(beside().getByText('Choose a message to read it here.')).toBeTruthy();
    expect(list().getAllByLabelText('Unread')).toHaveLength(2);
    expect(calls('mark_message_read')).toHaveLength(0);
  });

  it('opens the tapped message beside the list, and marks that one read', async () => {
    await open('athlete');
    await tap('Bibs are in the blue bag');
    expect(push).not.toHaveBeenCalled();
    expect(beside().getByText('Bibs are in the blue bag')).toBeTruthy();
    expect(beside().getByText('Mark as unread')).toBeTruthy();
    expect(calls('mark_message_read')).toEqual([['mark_message_read', { p_message_id: 'msg-3' }]]);
    // The list beside it drops that message's unread dot, and keeps the other's.
    expect(list().getAllByLabelText('Unread')).toHaveLength(1);
    expect(list().getByText('1 unread')).toBeTruthy();
    expect(list().getByText('Training moves to 6pm on Thursday')).toBeTruthy();
  });

  it.each<[string, string]>([
    ['read', 'Bibs are in the blue bag'],
    ['archived', 'Archive'],
    ['marked unread', 'Mark as unread'],
  ])('counts the tab’s unread messages again when a message beside the list is %s', async (_l, press) => {
    // With what the tabs share around the screen, as in the app.
    await open('athlete', inTabs(MessagesScreen));
    if (press !== 'Bibs are in the blue bag') await tap('Bibs are in the blue bag');
    const before = counts;
    const target = press === 'Bibs are in the blue bag' ? list() : beside();
    await fireEvent.press(target.getByText(press));
    await settle();
    expect(counts).toBeGreaterThan(before);
  });

  it('loads an open message once, not again each time the list reloads', async () => {
    await open('athlete');
    await tap('Bibs are in the blue bag');
    await settle();
    expect(calls('mark_message_read')).toHaveLength(1);
  });

  it.each<[string, Who]>([
    ['athlete', 'athlete'],
    ['under-18 athlete', morePersonas.under18Athlete],
    ['guardian', 'guardian'],
  ])('gives a %s no way to write back beside the list, and a way to report the message', async (_l, who) => {
    await open(who);
    await tap('Training moves to 6pm on Thursday');
    expect(screen.getByTestId('detail-pane').queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
    expect(beside().queryByText(/^Reply/)).toBeNull();
    expect(beside().getByText('Report this message')).toBeTruthy();
    // Read receipts are the sender's alone.
    expect(calls('message_receipts')).toHaveLength(0);
  });

  it('archives the open message: it closes, and leaves the inbox beside it', async () => {
    await open('athlete');
    await tap('Bibs are in the blue bag');
    await fireEvent.press(beside().getByText('Archive'));
    await settle();
    expect(calls('archive_message')).toEqual([['archive_message', { p_message_id: 'msg-3' }]]);
    expect(beside().getByText('Choose a message to read it here.')).toBeTruthy();
    expect(list().queryByText('Bibs are in the blue bag')).toBeNull();
    expect(list().getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    // The list is still the screen being looked at.
    expect(back).not.toHaveBeenCalled();
  });

  it('marks the open message unread: it closes, and its dot is back in the list', async () => {
    await open('athlete');
    await tap('Bibs are in the blue bag');
    expect(list().getAllByLabelText('Unread')).toHaveLength(1);
    await fireEvent.press(beside().getByText('Mark as unread'));
    await settle();
    expect(calls('mark_message_unread')).toEqual([['mark_message_unread', { p_message_id: 'msg-3' }]]);
    expect(beside().getByText('Choose a message to read it here.')).toBeTruthy();
    expect(list().getAllByLabelText('Unread')).toHaveLength(2);
    expect(back).not.toHaveBeenCalled();
  });

  it('opens a message its sender sent beside the list, with who has read it', async () => {
    await open('coach');
    await tap('Sent');
    await tap('Bring a water bottle');
    expect(push).not.toHaveBeenCalled();
    expect(beside().getByText('Read by 1 of 2')).toBeTruthy();
    expect(beside().getByText('Not read yet')).toBeTruthy();
  });

  it('keeps the open message while another box is looked at, until it is closed', async () => {
    await open('coach');
    await tap('Training moves to 6pm on Thursday');
    await tap('Sent');
    expect(beside().getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Close /));
    await settle();
    expect(beside().getByText('Choose a message to read it here.')).toBeTruthy();
  });
});

describe('the messages list on a phone', () => {
  it('opens a message on its own screen', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    try {
      await openList('athlete');
      expect(screen.queryByTestId('list-detail')).toBeNull();
      await fireEvent.press(screen.getByText('Training moves to 6pm on Thursday'));
      expect(push).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'msg-1' } });
      expect(rpcNames()).not.toContain('mark_message_read');
    } finally {
      push.mockRestore();
    }
  });
});
