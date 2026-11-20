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
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import MessageScreen from '@/app/messages/[id]';
import MessagesScreen from '@/app/messages/index';
import { supabase } from '@/lib/supabase';
import type { MessageQuestion } from '@/lib/message-questions';
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

  it.each(ALL_WHO_GET_MESSAGES)('gives a %s Hide read and Mark all read', async (_l, who) => {
    await openList(who, [inboxRow(), READ_ROW('msg-3', 'Old news')]);
    expect(screen.getByText('Hide read')).toBeTruthy();
    expect(screen.getByText('Mark all read')).toBeTruthy();
    expect(screen.getByText('1 unread')).toBeTruthy();
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

  it('Hide read shows only unread messages, and turns off again', async () => {
    await openList('athlete', [inboxRow(), READ_ROW('msg-3', 'Old news')]);
    expect(screen.getByText('Old news')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hide read'));
    expect(screen.queryByText('Old news')).toBeNull();
    expect(screen.getByText('Training moves to 6pm on Thursday')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hide read'));
    expect(screen.getByText('Old news')).toBeTruthy();
  });

  it('says how to see the rest when Hide read leaves nothing', async () => {
    await openList('athlete', [READ_ROW('msg-3', 'Old news')]);
    await fireEvent.press(screen.getByText('Hide read'));
    expect(screen.queryByText('Old news')).toBeNull();
    expect(screen.getByText('No unread messages. Turn off Hide read to see the rest.')).toBeTruthy();
  });

  it('shows no controls in an empty inbox', async () => {
    await openList('athlete', []);
    expect(screen.queryByText('Hide read')).toBeNull();
    expect(screen.queryByText('Mark all read')).toBeNull();
  });

  it('keeps the read controls off the Sent list', async () => {
    await openList('coach');
    await fireEvent.press(screen.getByText('Sent'));
    await settle();
    expect(screen.queryByText('Hide read')).toBeNull();
    expect(screen.queryByText('Mark all read')).toBeNull();
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
