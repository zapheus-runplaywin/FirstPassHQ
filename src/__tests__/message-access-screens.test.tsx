/**
 * Safeguarding access to a member's messages, on screen: concern references,
 * the officers' "Ask to read messages", the requests list, answering one, and
 * reading under an approved request (src/app/concerns/message-access/).
 *
 * The database decides who sees and answers each request and logs every
 * reading (supabase/tests/message-archive-and-access.sql). These tests seed
 * what it would return for each member and check the screens ask for the
 * right things: only the Child Safety Officer and the Complaints Manager can
 * ask, an answer always needs a written justification or reasons, nothing
 * opens until it's approved, and only the requester reads, one logged message
 * at a time.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import RaiseConcernScreen from '@/app/concern/new';
import ConcernScreen from '@/app/concerns/[id]';
import ConcernsScreen from '@/app/concerns/index';
import MessageAccessRequestScreen from '@/app/concerns/message-access/[id]';
import MessageAccessScreen from '@/app/concerns/message-access/index';
import NewMessageAccessScreen from '@/app/concerns/message-access/new';
import type {
  AccessedMessage,
  MessageAccessLogEntry,
  MessageAccessRequest,
} from '@/lib/message-access';
import { supabase } from '@/lib/supabase';
import type { Concern, MyConcern } from '@/lib/types';

import {
  openScreen,
  personas,
  resetClub,
  settle,
  toneOf,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () =>
  jest.requireActual('./helpers/harness').clubChoiceModuleMock(),
);
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

const officer: Persona = { ...personas.coach, isSafeguardingOfficer: true };

/** Whether the chip holding this text is shown as chosen. */
function isChosen(text: string) {
  let node = screen.getByText(text) as ReturnType<typeof screen.getByText> | null;
  while (node && node.props.accessibilityState === undefined) node = node.parent;
  return node?.props.accessibilityState?.selected === true;
}
const rpcCalls = () =>
  (supabase.rpc as jest.Mock).mock.calls as [string, Record<string, unknown>][];
const rpcNames = () => rpcCalls().map(([n]) => n);

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
});

function concern(extra: Partial<Concern> = {}): Concern {
  return {
    id: 'con-1',
    created_at: '2026-10-16T02:00:00Z',
    raised_by_name: 'Sample Guardian',
    anonymous: false,
    contact_ok: false,
    contact_details: null,
    about_member_id: 'coach-2',
    about_member_name: 'Sample Assistant',
    about_text: null,
    happened_on: null,
    body: 'Messages to the under 16s late at night',
    involves_child: 'yes',
    context: null,
    status: 'received',
    closed_at: null,
    last_action_at: null,
    reference: 'C-0007',
    ...extra,
  };
}

function request(extra: Partial<MessageAccessRequest> = {}): MessageAccessRequest {
  return {
    id: 'req-1',
    reference: 'R-0003',
    created_at: '2026-10-17T02:00:00Z',
    concern_id: 'con-1',
    concern_reference: 'C-0007',
    concern_open: true,
    requested_by_name: 'Sample Officer',
    requested_post: 'child_safety_officer',
    subject_name: 'Sample Assistant',
    subject_link: 'about',
    from_date: '2026-09-18',
    to_date: '2026-10-18',
    reason: 'Check what was sent to the squad at night',
    status: 'pending',
    decided_by_name: null,
    decided_at: null,
    decision_note: null,
    access_expires_at: null,
    mine: false,
    can_decide: false,
    views: 0,
    ...extra,
  };
}

const APPROVED = {
  status: 'approved' as const,
  decided_by_name: 'Sample Admin',
  decided_at: '2026-10-18T01:00:00Z',
  decision_note: 'Serious concern, messages are relevant',
  access_expires_at: '2026-10-19T01:00:00Z',
};

// ---------------------------------------------------------------------------
// Concern references

describe('concern references', () => {
  it('shows each concern’s reference in the register', async () => {
    await openScreen(
      'admin',
      { 'concerns/index': ConcernsScreen },
      '/concerns',
      {},
      {
        rpcs: {
          concern_register: [concern()],
          message_access_todo: [{ to_decide: 2, open_access: 0, only_one_admin: false }],
        },
      },
    );
    expect(screen.getByText(/^C-0007 · /)).toBeTruthy();
    expect(screen.getByText('Message access (2 to answer)')).toBeTruthy();
  });

  it('gives the person who raised a concern its reference', async () => {
    const mine: MyConcern[] = [
      {
        id: 'con-1',
        created_at: '2026-10-16T02:00:00Z',
        status: 'received',
        about_text: 'A coach',
        anonymous: false,
        reference: 'C-0007',
      },
    ];
    await openScreen(
      'athlete',
      { 'concern/new': RaiseConcernScreen },
      '/concern/new',
      {},
      {
        rpcs: { my_concerns: mine },
      },
    );
    expect(screen.getByText(/C-0007 · /)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Asking

async function openConcern(who: Who, shown: Concern) {
  await openScreen(
    who,
    { 'concerns/[id]': ConcernScreen },
    `/concerns/${shown.id}`,
    {},
    {
      rpcs: {
        concern_register: [shown],
        concern_history: [],
        concern_about_people: [],
        concern_guardians: [],
        concern_guardian_views: [],
      },
    },
  );
}

describe('asking to read messages', () => {
  it('offers the Child Safety Officer or Complaints Manager the request on an open concern', async () => {
    await openConcern(officer, concern());
    expect(screen.getByText(/^C-0007 · Received/)).toBeTruthy();
    expect(screen.getByText('Ask to read messages')).toBeTruthy();
  });

  it('never offers it to an admin who isn’t an officer: admins answer, they don’t ask', async () => {
    await openConcern('admin', concern());
    expect(screen.queryByText('Ask to read messages')).toBeNull();
  });

  it('offers nothing on a closed concern', async () => {
    await openConcern(officer, concern({ status: 'closed' }));
    expect(screen.queryByText('Ask to read messages')).toBeNull();
  });

  async function openForm() {
    await openScreen(
      officer,
      { 'concerns/message-access/new': NewMessageAccessScreen },
      '/concerns/message-access/new?concern=con-1&reference=C-0007',
      {},
      {
        rpcs: {
          message_access_people: [
            { link: 'about', profile_id: 'coach-2', name: 'Sample Assistant' },
            { link: 'raised_by', profile_id: 'guardian', name: 'Sample Guardian' },
          ],
          concern_about_people: [{ id: 'kid-1', name: 'Sample Child' }],
          request_message_access: 'req-9',
        },
      },
    );
  }

  it('names who the concern is about and who raised it, or someone else involved', async () => {
    await openForm();
    expect(screen.getByText('For concern C-0007')).toBeTruthy();
    expect(screen.getByText('Who the concern is about: Sample Assistant')).toBeTruthy();
    expect(screen.getByText('Who raised the concern: Sample Guardian')).toBeTruthy();
    expect(screen.getByText('Someone else involved')).toBeTruthy();
    expect(
      screen.getByText(/Nobody else is told: not the person, their parents or the committee\./),
    ).toBeTruthy();
  });

  it('needs a person and a reason before asking', async () => {
    await openForm();
    await fireEvent.press(screen.getByText('Send to an admin'));
    expect(screen.getByText('Choose whose messages to read')).toBeTruthy();
    await fireEvent.press(screen.getByText('Who the concern is about: Sample Assistant'));
    await fireEvent.press(screen.getByText('Send to an admin'));
    expect(screen.getByText('Give a reason of at least 10 characters')).toBeTruthy();
    expect(rpcNames()).not.toContain('request_message_access');
  });

  it('sends the request for the last 30 days, then opens it', async () => {
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    try {
      await openForm();
      await fireEvent.press(screen.getByText('Who the concern is about: Sample Assistant'));
      await fireEvent.changeText(
        screen.getByPlaceholderText(/What you’re checking/),
        'Check the late night messages',
      );
      await fireEvent.press(screen.getByText('Send to an admin'));
      await settle();
      expect(rpcCalls()).toContainEqual([
        'request_message_access',
        {
          p_concern_id: 'con-1',
          p_subject_id: 'coach-2',
          p_link: 'about',
          p_from: '2026-09-18',
          p_to: '2026-10-18',
          p_reason: 'Check the late night messages',
        },
      ]);
      expect(replace).toHaveBeenCalledWith({
        pathname: '/concerns/message-access/[id]',
        params: { id: 'req-9' },
      });
    } finally {
      replace.mockRestore();
    }
  });

  it('offers each person a concern is about on its own, and asks for the one picked', async () => {
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    try {
      await openScreen(
        officer,
        { 'concerns/message-access/new': NewMessageAccessScreen },
        '/concerns/message-access/new?concern=con-1&reference=C-0007',
        {},
        {
          rpcs: {
            message_access_people: [
              { link: 'about', profile_id: 'coach-2', name: 'Sample Assistant' },
              { link: 'about', profile_id: 'kid-1', name: 'Sample Child' },
              { link: 'raised_by', profile_id: 'guardian', name: 'Sample Guardian' },
            ],
            concern_about_people: [],
            request_message_access: 'req-9',
          },
        },
      );
      expect(screen.getByText('Who the concern is about: Sample Assistant')).toBeTruthy();
      await fireEvent.press(screen.getByText('Who the concern is about: Sample Child'));
      expect(isChosen('Who the concern is about: Sample Child')).toBe(true);
      expect(isChosen('Who the concern is about: Sample Assistant')).toBe(false);
      await fireEvent.changeText(
        screen.getByPlaceholderText(/What you’re checking/),
        'Check the late night messages',
      );
      await fireEvent.press(screen.getByText('Send to an admin'));
      await settle();
      expect(rpcCalls().find(([n]) => n === 'request_message_access')?.[1]).toMatchObject({
        p_subject_id: 'kid-1',
        p_link: 'about',
      });
    } finally {
      replace.mockRestore();
    }
  });

  it('searches every member for someone else involved', async () => {
    await openForm();
    await fireEvent.press(screen.getByText('Someone else involved'));
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Sam');
    await fireEvent.press(screen.getByText('Sample Child'));
    expect(screen.getByText('Sample Child. Say in the reason how they’re involved.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The list

describe('the requests list', () => {
  it('puts requests waiting for an answer first, and says which are for you', async () => {
    await openScreen(
      'admin',
      { 'concerns/message-access/index': MessageAccessScreen },
      '/concerns/message-access',
      {},
      {
        rpcs: {
          message_access_requests: [
            request({ can_decide: true }),
            request({ id: 'req-2', reference: 'R-0002', ...APPROVED }),
            request({
              id: 'req-3',
              reference: 'R-0001',
              status: 'rejected',
              decision_note: 'Talk to the parents first',
            }),
          ],
        },
      },
    );
    expect(screen.getByText('R-0003 · concern C-0007')).toBeTruthy();
    expect(screen.getByText('For you to answer')).toBeTruthy();
    expect(toneOf(screen.getByText('For you to answer'))).toBe('attention');
    expect(screen.getByText('Refused')).toBeTruthy();
    expect(screen.getByText('Approved · 23 hours left')).toBeTruthy();
    expect(screen.getByText(/Requests and who read what are kept for good\./)).toBeTruthy();
  });

  it('says when there’s nothing', async () => {
    await openScreen(
      officer,
      { 'concerns/message-access/index': MessageAccessScreen },
      '/concerns/message-access',
      {},
      {
        rpcs: { message_access_requests: [] },
      },
    );
    expect(screen.getByText('Nothing waiting.')).toBeTruthy();
    expect(screen.getByText('None answered yet.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One request

async function openRequest(
  who: Who,
  shown: MessageAccessRequest | null,
  extra: { messages?: AccessedMessage[]; log?: MessageAccessLogEntry[]; error?: string } = {},
) {
  await openScreen(
    who,
    { 'concerns/message-access/[id]': MessageAccessRequestScreen },
    '/concerns/message-access/req-1',
    {},
    {
      rpcs: {
        message_access_requests: shown ? [shown] : [],
        message_access_log: extra.log ?? [],
        accessed_messages: extra.messages ?? [],
      },
      rpcHandlers: {
        open_accessed_message: (args) => [
          { message_id: args.p_message_id, body: 'Text of the late message' },
        ],
      },
      rpcErrors: extra.error ? { decide_message_access: extra.error } : {},
    },
  );
}

const LISTED: AccessedMessage[] = [
  {
    message_id: 'msg-1',
    created_at: '2026-10-10T13:30:00Z',
    sender_name: 'Sample Assistant',
    sent_by_member: true,
    audience: 'group',
    audience_role: null,
    audience_label: 'Under 16s',
    member_read_at: null,
    member_archived_at: null,
    text_removed: false,
  },
  {
    message_id: 'msg-2',
    created_at: '2026-10-09T02:00:00Z',
    sender_name: 'Sample Admin',
    sent_by_member: false,
    audience: 'club',
    audience_role: null,
    audience_label: null,
    member_read_at: '2026-10-09T03:00:00Z',
    member_archived_at: '2026-10-09T04:00:00Z',
    text_removed: false,
  },
];

describe('one request', () => {
  it('says so when the database doesn’t return it (for example, it’s about you)', async () => {
    await openRequest(officer, null);
    expect(screen.getByText('This request isn’t available to you.')).toBeTruthy();
  });

  it('shows what was asked, by whom and why', async () => {
    await openRequest('admin', request());
    expect(screen.getByText('R-0003 · concern C-0007')).toBeTruthy();
    expect(screen.getByText('How they’re involved: Who the concern is about')).toBeTruthy();
    expect(screen.getByText(/^Asked by: Sample Officer \(Child Safety Officer\)/)).toBeTruthy();
    expect(screen.getByText('Why: Check what was sent to the squad at night')).toBeTruthy();
    expect(screen.getByText('Waiting for an answer')).toBeTruthy();
    expect(toneOf(screen.getByText('Waiting for an answer'))).toBe('attention');
  });

  it('gives no answer buttons to someone who can’t answer it, such as the requester', async () => {
    await openRequest(officer, request({ mine: true }));
    expect(screen.queryByText('Approve for 24 hours')).toBeNull();
    expect(screen.queryByText('Show the messages')).toBeNull();
  });

  it('needs a justification to approve, and sends it', async () => {
    await openRequest('admin', request({ can_decide: true }));
    await fireEvent.changeText(
      screen.getByPlaceholderText('At least 10 characters'),
      'Serious concern, messages are relevant',
    );
    await fireEvent.press(screen.getByText('Approve for 24 hours'));
    await settle();
    expect(rpcCalls()).toContainEqual([
      'decide_message_access',
      { p_request_id: 'req-1', p_approve: true, p_note: 'Serious concern, messages are relevant' },
    ]);
  });

  it('refuses with reasons', async () => {
    await openRequest('admin', request({ can_decide: true }));
    await fireEvent.changeText(
      screen.getByPlaceholderText('At least 10 characters'),
      'Talk to the parents first',
    );
    await fireEvent.press(screen.getByText('Refuse'));
    await settle();
    expect(rpcCalls()).toContainEqual([
      'decide_message_access',
      { p_request_id: 'req-1', p_approve: false, p_note: 'Talk to the parents first' },
    ]);
  });

  it('shows the database’s refusal, such as a missing justification', async () => {
    await openRequest('admin', request({ can_decide: true }), {
      error: 'Record why you’re approving it, in at least 10 characters',
    });
    await fireEvent.press(screen.getByText('Approve for 24 hours'));
    await settle();
    expect(
      screen.getByText('Record why you’re approving it, in at least 10 characters'),
    ).toBeTruthy();
  });

  it('shows who approved it and why', async () => {
    await openRequest('admin', request(APPROVED));
    expect(screen.getByText('Approved · 23 hours left')).toBeTruthy();
    expect(screen.getByText(/^Approved by: Sample Admin/)).toBeTruthy();
    expect(screen.getByText('Justification: Serious concern, messages are relevant')).toBeTruthy();
  });

  it('never lets the admin who approved it read the messages', async () => {
    await openRequest('admin', request(APPROVED));
    expect(screen.queryByText('Show the messages')).toBeNull();
    expect(rpcNames()).not.toContain('accessed_messages');
  });

  it('lets the requester list the messages, then read one at a time', async () => {
    await openRequest(officer, request({ ...APPROVED, mine: true }), { messages: LISTED });
    expect(screen.getByText('Messages · 23 hours left')).toBeTruthy();
    // Nothing is listed until they ask, so the list itself is a logged step.
    expect(rpcNames()).not.toContain('accessed_messages');
    await fireEvent.press(screen.getByText('Show the messages'));
    await settle();
    expect(rpcCalls()).toContainEqual(['accessed_messages', { p_request_id: 'req-1' }]);
    expect(screen.getByText('Sent by Sample Assistant')).toBeTruthy();
    expect(screen.getByText('From Sample Admin')).toBeTruthy();
    expect(screen.getByText('To Everyone in the club · opened · archived')).toBeTruthy();
    expect(screen.queryByText('Text of the late message')).toBeNull();
    expect(rpcNames()).not.toContain('open_accessed_message');
    await fireEvent.press(screen.getByText('Sent by Sample Assistant'));
    await settle();
    expect(rpcCalls()).toContainEqual([
      'open_accessed_message',
      { p_request_id: 'req-1', p_message_id: 'msg-1' },
    ]);
    expect(screen.getByText('Text of the late message')).toBeTruthy();
    // There's nothing to type, forward or change.
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
  });

  it('closes when the 24 hours are up', async () => {
    await openRequest(
      officer,
      request({ ...APPROVED, mine: true, access_expires_at: '2026-10-18T01:59:00Z' }),
    );
    expect(screen.getByText('Approved · access ended')).toBeTruthy();
    expect(screen.queryByText('Show the messages')).toBeNull();
  });

  it('shows the log of who read what once answered', async () => {
    await openRequest('admin', request(APPROVED), {
      log: [
        {
          viewed_at: '2026-10-18T01:30:00Z',
          viewed_by_name: 'Sample Officer',
          kind: 'opened',
          message_sent_at: '2026-10-10T13:30:00Z',
          message_sender_name: 'Sample Assistant',
        },
        {
          viewed_at: '2026-10-18T01:20:00Z',
          viewed_by_name: 'Sample Officer',
          kind: 'listed',
          message_sent_at: null,
          message_sender_name: null,
        },
      ],
    });
    expect(screen.getByText('Who read what')).toBeTruthy();
    expect(
      screen.getByText(/Sample Officer opened the message from Sample Assistant/),
    ).toBeTruthy();
    expect(screen.getByText(/Sample Officer listed the messages/)).toBeTruthy();
  });

  it('shows no log while it’s waiting', async () => {
    await openRequest('admin', request());
    expect(screen.queryByText('Who read what')).toBeNull();
  });
});
