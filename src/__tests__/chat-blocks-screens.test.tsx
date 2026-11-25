/**
 * Blocking in chat groups: Block and Unblock on a group post
 * (src/app/messages/[id].tsx), Blocked people (messages/blocked) and the
 * register admins and the safeguarding officers follow blocks up in
 * (concerns/blocks).
 *
 * The database decides who may block whom and who is told
 * (20261125400000_chat_blocks.sql, tested in supabase/tests/chat-blocks.sql);
 * these check what each screen offers from its answers:
 * - Block is offered only on someone else's post in the member's own group,
 *   never on a parent's copy of a post to their child, a club message or the
 *   member's own post, and only while Chat groups is on;
 * - Block asks once more, saying who is told; Unblock undoes it;
 * - the database refusing an adult blocking a child shows its reason;
 * - Blocked people lists blocks with Unblock;
 * - the register shows who blocked whom and records the follow-up.
 */
import { fireEvent, screen } from 'expo-router/testing-library';

import BlocksScreen from '@/app/concerns/blocks';
import MessageScreen from '@/app/messages/[id]';
import BlockedPeopleScreen from '@/app/messages/blocked';
import type { ChatBlockRecord, MyChatBlock } from '@/lib/chat-blocks';
import { supabase } from '@/lib/supabase';

import { openScreen, resetClub, setClubFeatures, settle, TEAM, type PersonaName } from './helpers/harness';

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

const rpcCalls = (name: string) =>
  ((supabase.rpc as jest.Mock).mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);

beforeEach(() => {
  resetClub();
  setClubFeatures({ chatGroups: true });
  (supabase.rpc as jest.Mock).mockClear();
});

const POST = {
  id: 'msg-1',
  sender_id: 'someone-else',
  sender_name: 'Sample Author',
  body: 'A post in the group',
  audience: 'chat' as const,
  audience_role: null,
  audience_label: `${TEAM.name} coaches and captains`,
  created_at: '2026-11-24T07:00:00Z',
  answer_options: null,
  removed_at: null,
  removed_by_name: null,
};
type Copy = {
  read_at: string | null;
  for_children: string[] | null;
  for_child_names: string[] | null;
  chat_group_id: string | null;
};
const MY_COPY: Copy = { read_at: null, for_children: null, for_child_names: null, chat_group_id: 'g-captains' };

async function openPost(
  who: PersonaName,
  extra: {
    post?: Partial<typeof POST>;
    copy?: Partial<Copy> | null;
    blocked?: boolean;
    errors?: Record<string, string>;
  } = {},
) {
  await openScreen(
    who,
    { 'messages/[id]': MessageScreen },
    '/messages/msg-1',
    {
      messages: [{ ...POST, ...extra.post }],
      message_recipients: extra.copy === null ? [] : [{ ...MY_COPY, ...extra.copy }],
    },
    { rpcs: { chat_member_blocked: extra.blocked ?? false }, rpcErrors: extra.errors },
  );
}

// ---------------------------------------------------------------------------
// Block and Unblock on a post

describe('Block on a group post', () => {
  it('is offered on someone else’s post in the member’s own group, and asks once more', async () => {
    await openPost('athlete');
    expect(rpcCalls('chat_member_blocked')).toEqual([{ p_profile_id: 'someone-else' }]);
    await fireEvent.press(screen.getByText('Block Sample Author'));
    // Says who is told, and that club messages still come.
    expect(screen.getByText(/admins and Child Safety Officer are told/)).toBeTruthy();
    expect(screen.getByText(/Club messages from them still reach you/)).toBeTruthy();
    expect(rpcCalls('block_chat_member')).toEqual([]);
    await fireEvent.press(screen.getByText('Block'));
    await settle();
    expect(rpcCalls('block_chat_member')).toEqual([{ p_message_id: 'msg-1' }]);
    expect(screen.getByText('Unblock Sample Author')).toBeTruthy();
  });

  it('can be cancelled', async () => {
    await openPost('coach');
    await fireEvent.press(screen.getByText('Block Sample Author'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(rpcCalls('block_chat_member')).toEqual([]);
    expect(screen.getByText('Block Sample Author')).toBeTruthy();
  });

  it('is offered to a member under 18 too', async () => {
    await openPost('minorAthlete');
    expect(screen.getByText('Block Sample Author')).toBeTruthy();
  });

  it('shows the database’s reason when an adult tries to block a child', async () => {
    await openPost('coach', {
      errors: { block_chat_member: 'Adults can’t block a member under 18. Ask a coach to hide the post, or raise a concern' },
    });
    await fireEvent.press(screen.getByText('Block Sample Author'));
    await fireEvent.press(screen.getByText('Block'));
    await settle();
    expect(screen.getByText(/Adults can’t block a member under 18/)).toBeTruthy();
    expect(screen.queryByText('Unblock Sample Author')).toBeNull();
  });

  it('offers Unblock when the author is blocked', async () => {
    await openPost('athlete', { blocked: true });
    expect(screen.getByText(/You’ve blocked Sample Author/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Unblock Sample Author'));
    await settle();
    expect(rpcCalls('unblock_chat_member')).toEqual([{ p_profile_id: 'someone-else' }]);
    expect(screen.getByText('Block Sample Author')).toBeTruthy();
  });

  it('isn’t offered on a parent’s copy of a post to their child', async () => {
    await openPost('guardian', {
      copy: { chat_group_id: null, for_children: ['child'], for_child_names: ['Sample Child'] },
    });
    expect(screen.getByText('A post in the group')).toBeTruthy();
    expect(screen.queryByText(/^Block /)).toBeNull();
    expect(rpcCalls('chat_member_blocked')).toEqual([]);
  });

  it('isn’t offered on a club message', async () => {
    await openPost('athlete', {
      post: { audience: 'group' as never, audience_label: TEAM.name },
      copy: { chat_group_id: null },
    });
    expect(screen.queryByText(/^Block /)).toBeNull();
  });

  it('isn’t offered while Chat groups is off', async () => {
    setClubFeatures({ chatGroups: false });
    await openPost('athlete');
    expect(screen.queryByText(/^Block /)).toBeNull();
  });

  it('keeps Report this message beside it', async () => {
    await openPost('athlete');
    expect(screen.getByText('Report this message')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Blocked people

describe('Blocked people', () => {
  const BLOCK: MyChatBlock = {
    profile_id: 'someone-else',
    name: 'Sample Author',
    blocked_at: '2026-11-24T07:00:00Z',
    group_name: `${TEAM.name} coaches and captains`,
  };

  it('lists blocks, and unblocks', async () => {
    await openScreen('athlete', { 'messages/blocked': BlockedPeopleScreen }, '/messages/blocked', {}, {
      rpcs: { my_chat_blocks: [BLOCK] },
    });
    expect(screen.getByText('Sample Author')).toBeTruthy();
    expect(screen.getByText(new RegExp(`in ${TEAM.name} coaches and captains`))).toBeTruthy();
    await fireEvent.press(screen.getByText('Unblock'));
    await settle();
    expect(rpcCalls('unblock_chat_member')).toEqual([{ p_profile_id: 'someone-else' }]);
  });

  it('says when nobody is blocked', async () => {
    await openScreen('athlete', { 'messages/blocked': BlockedPeopleScreen }, '/messages/blocked', {}, {
      rpcs: { my_chat_blocks: [] },
    });
    expect(screen.getByText('You haven’t blocked anyone.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The register

describe('Blocks in chat groups, for admins and the safeguarding officers', () => {
  const WAITING: ChatBlockRecord = {
    id: 'b-1',
    created_at: '2026-11-24T07:00:00Z',
    blocker_name: 'Sample Child',
    blocked_name: 'Sample Adult',
    blocker_under_18: true,
    blocked_under_18: false,
    group_name: `${TEAM.name} coaches and captains`,
    unblocked_at: null,
    followed_up_at: null,
    followed_up_by_name: null,
    follow_up_note: null,
  };
  const DONE: ChatBlockRecord = {
    ...WAITING,
    id: 'b-2',
    blocker_name: 'Sample Manager',
    blocker_under_18: false,
    unblocked_at: '2026-11-24T09:00:00Z',
    followed_up_at: '2026-11-24T10:00:00Z',
    followed_up_by_name: 'Sample Officer',
    follow_up_note: 'Spoke to them both',
  };

  it('shows who blocked whom, marks a child, and records a follow-up with a note', async () => {
    await openScreen('safeguardingOfficer', { 'concerns/blocks': BlocksScreen }, '/concerns/blocks', {}, {
      rpcs: { chat_block_register: [WAITING, DONE] },
    });
    expect(screen.getByText('Sample Child (under 18) blocked Sample Adult')).toBeTruthy();
    expect(screen.getByText(/Still blocked · Waiting for a follow-up/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What you did (optional)'), 'Called their parent');
    await fireEvent.press(screen.getByText('Mark as followed up'));
    await settle();
    expect(rpcCalls('follow_up_chat_block')).toEqual([{ p_id: 'b-1', p_note: 'Called their parent' }]);
  });

  it('folds the followed-up ones, with who did it and their note', async () => {
    await openScreen('admin', { 'concerns/blocks': BlocksScreen }, '/concerns/blocks', {}, {
      rpcs: { chat_block_register: [DONE] },
    });
    expect(screen.getByText('Nothing to follow up.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Followed up'));
    expect(screen.getByText('Sample Manager blocked Sample Adult')).toBeTruthy();
    expect(screen.getByText(/Unblocked · Followed up by Sample Officer/)).toBeTruthy();
    expect(screen.getByText('Spoke to them both')).toBeTruthy();
    expect(screen.queryByText('Mark as followed up')).toBeNull();
  });
});
