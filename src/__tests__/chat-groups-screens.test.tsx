/**
 * Chat groups (src/app/messages/index.tsx's Groups tab, messages/group/[id]
 * and the admin screens in admin/chat-groups).
 *
 * The database decides who is in each group and who can post
 * (20261124600000_chat_groups.sql, tested in supabase/tests/chat-groups.sql);
 * these check what each screen shows from its answers:
 * - the Groups tab shows only while the club has Chat groups on;
 * - adults get a box to post in; a member under 18 gets one only where the
 *   database allows it (their own squad's or team's groups while a coach is
 *   in them), told that their parents get a copy, and otherwise a note and no
 *   box (AGENTS.md, "No social media features for children", reassessed
 *   24 November 2026);
 * - the group's coaches swipe a post to hide it (or show it again); nobody
 *   else is offered it;
 * - members can hide a group, and hidden groups fold away;
 * - admins set up groups by roles, squads and teams, and people.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import AdminChatGroupEdit from '@/app/admin/chat-groups/edit';
import AdminChatGroups from '@/app/admin/chat-groups/index';
import MessageScreen from '@/app/messages/[id]';
import ChatGroupScreen from '@/app/messages/group/[id]';
import MessagesScreen from '@/app/messages/index';
import {
  type AdminChatGroup,
  type ChatGroup,
  type ChatGroupMember,
  type ChatPost,
  POSTS_PAGE,
} from '@/lib/chat-groups';
import { supabase } from '@/lib/supabase';

import {
  morePersonas,
  openScreen,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
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
  useTodoNotifications: jest.fn(() => ({
    on: true,
    permission: 'granted',
    save: jest.fn(),
  })),
  openNotificationSettings: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

type Who = PersonaName | Persona;

const rpcCalls = (name: string) =>
  ((supabase.rpc as jest.Mock).mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);

beforeEach(() => {
  resetClub();
  setClubFeatures({ chatGroups: true });
  (supabase.rpc as jest.Mock).mockClear();
});

function group(extra: Partial<ChatGroup> = {}): ChatGroup {
  return {
    id: 'g-captains',
    kind: 'team_captains',
    name: `${TEAM.name} coaches and captains`,
    team_id: TEAM.id,
    is_member: true,
    can_post: true,
    read_only_reason: null,
    can_remove: false,
    member_count: 4,
    hidden: false,
    unread_count: 0,
    last_post_at: '2026-11-24T07:00:00Z',
    last_post: 'Warm-up at 5:30',
    last_sender: 'Sample coach',
    ...extra,
  };
}

const POSTS: ChatPost[] = [
  {
    id: 'p1',
    sender_id: 'coach',
    sender_name: 'Sample coach',
    body: 'Warm-up at 5:30',
    created_at: '2026-11-24T07:00:00Z',
    mine: false,
    body_removed: false,
    removed_by_name: null,
    read_count: null,
    recipient_count: null,
  },
  {
    id: 'p2',
    sender_id: 'someone',
    sender_name: 'Sample captain',
    body: 'Bring the cones',
    created_at: '2026-11-24T07:05:00Z',
    mine: false,
    body_removed: false,
    removed_by_name: 'Sample coach',
    read_count: null,
    recipient_count: null,
  },
];

const MEMBERS: ChatGroupMember[] = [
  {
    profile_id: 'coach',
    full_name: 'Sample coach',
    detail: 'Coach',
    under_18: false,
  },
  {
    profile_id: 'child',
    full_name: 'Sample captain',
    detail: 'Captain',
    under_18: true,
  },
];

// ---------------------------------------------------------------------------
// The Groups tab

async function openList(who: Who, groups: ChatGroup[]) {
  await openScreen(
    who,
    { 'messages/index': MessagesScreen },
    '/messages',
    { message_recipients: [] },
    {
      rpcs: { my_sent_messages: [], my_chat_groups: groups },
    },
  );
}

describe('the Groups tab', () => {
  it('isn’t there while the club has chat groups off', async () => {
    setClubFeatures({});
    await openList('coach', [group()]);
    expect(screen.queryByText(/^Groups/)).toBeNull();
    expect(rpcCalls('my_chat_groups')).toHaveLength(0);
  });

  it('lists the member’s groups, with unread counts, and folds hidden ones away', async () => {
    await openList('coach', [
      group({ unread_count: 2 }),
      group({
        id: 'g-hidden',
        name: 'All managers',
        hidden: true,
        last_post: null,
      }),
    ]);
    expect(screen.getByText('Groups (2)')).toBeTruthy();
    await fireEvent.press(screen.getByText('Groups (2)'));
    await settle();
    expect(screen.getByText(`${TEAM.name} coaches and captains`)).toBeTruthy();
    expect(screen.getByText('Sample coach: Warm-up at 5:30')).toBeTruthy();
    expect(screen.getByText('2 unread')).toBeTruthy();
    expect(screen.getByText('Hidden groups')).toBeTruthy();
    expect(screen.queryByText('All managers')).toBeNull();
    await fireEvent.press(screen.getByText('Hidden groups'));
    expect(screen.getByText('All managers')).toBeTruthy();
  });

  it('marks a group the member can’t post in as read only', async () => {
    await openList(morePersonas.under18Athlete, [
      group({
        can_post: false,
        read_only_reason: 'under_18',
        name: 'Selectors',
      }),
    ]);
    await fireEvent.press(screen.getByText('Groups'));
    await settle();
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('offers admins a New group button, even when they’re in no groups', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openList('admin', []);
    await fireEvent.press(screen.getByText('Groups'));
    await settle();
    expect(screen.getByText(/You’re not in any chat groups yet/)).toBeTruthy();
    await fireEvent.press(screen.getByText('New group'));
    expect(push).toHaveBeenCalledWith('/admin/chat-groups/edit');
    push.mockRestore();
  });

  it('shows the New group button above an admin’s groups too', async () => {
    await openList('admin', [group()]);
    await fireEvent.press(screen.getByText('Groups'));
    await settle();
    expect(screen.getByText('New group')).toBeTruthy();
  });

  it.each(['coach', 'manager', 'guardian', 'athlete'] as const)(
    'gives a %s no New group button',
    async (who) => {
      await openList(who, [group()]);
      await fireEvent.press(screen.getByText('Groups'));
      await settle();
      expect(screen.queryByText('New group')).toBeNull();
    },
  );

  it('keeps Inbox, Sent, Archived and Groups on one line', async () => {
    await openList('coach', [group({ unread_count: 12 })]);
    const line = screen.container.queryAll(
      (n) => n.props.horizontal === true && n.props.contentContainerStyle?.flexDirection === 'row',
    );
    expect(line).toHaveLength(1);
    for (const tab of ['Inbox', 'Sent', 'Archived', 'Groups (12)']) {
      expect(screen.getByText(tab).props.numberOfLines).toBe(1);
    }
  });

  it('says so when the member is in no groups', async () => {
    await openList('athlete', []);
    await fireEvent.press(screen.getByText('Groups'));
    await settle();
    expect(screen.getByText(/You’re not in any chat groups yet/)).toBeTruthy();
  });

  it('opens a group', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openList('coach', [group()]);
    await fireEvent.press(screen.getByText('Groups'));
    await settle();
    await fireEvent.press(screen.getByText(`${TEAM.name} coaches and captains`));
    expect(push).toHaveBeenCalledWith({
      pathname: '/messages/group/[id]',
      params: { id: 'g-captains' },
    });
    push.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// One group

async function openGroup(
  who: Who,
  g: ChatGroup,
  extra: {
    members?: ChatGroupMember[];
    posts?: ChatPost[];
    errors?: Record<string, string>;
  } = {},
) {
  await openScreen(
    who,
    { 'messages/group/[id]': ChatGroupScreen },
    `/messages/group/${g.id}`,
    {},
    {
      rpcs: {
        my_chat_groups: [g],
        chat_group_posts: extra.posts ?? POSTS,
        chat_group_members: extra.members ?? MEMBERS,
      },
      rpcErrors: extra.errors,
    },
  );
}

/** Scrolls the upside-down list of posts up to the oldest one shown. */
async function scrollToOldest() {
  await fireEvent(screen.getByTestId('chat-posts'), 'endReached', { distanceFromEnd: 0 });
  await settle();
}

/** The group's coach's swipe action on each post, newest first. */
function swipeRows() {
  return screen.container.queryAll(
    (n) => n.props.accessibilityActions?.[0]?.name === 'swipeAction',
  );
}

async function swipeAction(row: ReturnType<typeof swipeRows>[number]) {
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'swipeAction' } });
  await settle();
}

describe('a chat group', () => {
  it('shows its posts, marks them read and lets an adult post', async () => {
    await openGroup('coach', group());
    expect(screen.getByText('Warm-up at 5:30')).toBeTruthy();
    expect(screen.getByText('Bring the cones')).toBeTruthy();
    expect(screen.getByText(/^Hidden by Sample coach\./)).toBeTruthy();
    expect(rpcCalls('mark_chat_group_read')).toEqual([{ p_group_id: 'g-captains' }]);
    expect(
      screen.getByText(/Members under 18 are in it, so their parents or guardians get a copy/),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('Write a message'), 'See you there');
    await fireEvent.press(screen.getByText('Post'));
    await settle();
    expect(rpcCalls('post_to_chat_group')).toEqual([
      { p_group_id: 'g-captains', p_body: 'See you there' },
    ]);
  });

  it('won’t post nothing', async () => {
    await openGroup('coach', group());
    await fireEvent.press(screen.getByText('Post'));
    expect(screen.getByText('Write a message first.')).toBeTruthy();
    expect(rpcCalls('post_to_chat_group')).toHaveLength(0);
  });

  it('shows the database’s refusal', async () => {
    await openGroup('coach', group(), {
      errors: { post_to_chat_group: 'You’re not in this group' },
    });
    await fireEvent.changeText(screen.getByPlaceholderText('Write a message'), 'Hi');
    await fireEvent.press(screen.getByText('Post'));
    await settle();
    expect(screen.getByText('You’re not in this group')).toBeTruthy();
  });

  it('lists who is in it for adults, and notes under-18s', async () => {
    await openGroup('coach', group());
    expect(screen.getByText('2 people')).toBeTruthy();
    await fireEvent.press(screen.getByText('About this group'));
    expect(screen.getByText('Sample captain (under 18)')).toBeTruthy();
    expect(screen.getByText('Captain')).toBeTruthy();
  });

  it('lets an under-18 captain post in their team’s group, telling them their parents get a copy', async () => {
    await openGroup(morePersonas.under18Athlete, group(), { members: [] });
    expect(screen.getByPlaceholderText('Write a message')).toBeTruthy();
    expect(
      screen.getByText(/Your parents or guardians get a copy of everything posted here/),
    ).toBeTruthy();
    // No list of who else is in it, only a way to hide it or report a post.
    expect(screen.getByText('Hide it, or report a post')).toBeTruthy();
    expect(screen.queryByText('Hide')).toBeNull();
  });

  it('gives an under-18 no box where they read only', async () => {
    await openGroup(
      morePersonas.under18Athlete,
      group({ can_post: false, read_only_reason: 'under_18' }),
      {
        members: [],
      },
    );
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
    expect(
      screen.getByText(/Members under 18 post only in their own squad’s or team’s groups/),
    ).toBeTruthy();
  });

  it.each([
    ['left', /no longer in this group/],
    ['closed', /An admin closed this group/],
  ] as const)('explains a group that is read only because the member %s', async (reason, note) => {
    await openGroup('coach', group({ can_post: false, read_only_reason: reason }));
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
    expect(screen.getByText(note)).toBeTruthy();
  });

  it('lets the group’s coach swipe a post to hide it, or a hidden one to show it again', async () => {
    await openGroup('coach', group({ can_remove: true }));
    // Behind each post, shown only once it's swiped left: Hide, or Show on a hidden one.
    expect(swipeRows().map((r) => r.props.accessibilityActions[0].label)).toEqual(['Show', 'Hide']);
    await fireEvent.press(screen.getByText('Hide'));
    expect(rpcCalls('remove_chat_post')).toHaveLength(0);
    await swipeAction(swipeRows()[1]);
    expect(rpcCalls('remove_chat_post')).toEqual([{ p_message_id: 'p1' }]);
    await swipeAction(swipeRows()[0]);
    expect(rpcCalls('show_chat_post')).toEqual([{ p_message_id: 'p2' }]);
  });

  it('shows the database’s refusal to hide a post', async () => {
    await openGroup('coach', group({ can_remove: true }), {
      errors: { remove_chat_post: 'Only the group’s coaches can hide posts' },
    });
    await swipeAction(swipeRows()[1]);
    expect(screen.getByText('Only the group’s coaches can hide posts')).toBeTruthy();
  });

  it('offers nobody else a way to hide posts', async () => {
    await openGroup('manager', group({ can_remove: false }));
    expect(screen.queryByText('Hide')).toBeNull();
    expect(screen.queryByText('Show')).toBeNull();
  });

  it('hides the group and goes back, or shows a hidden one again', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    await openGroup('coach', group());
    await fireEvent.press(screen.getByText('About this group'));
    await fireEvent.press(screen.getByText('Hide this group'));
    await settle();
    expect(rpcCalls('set_chat_group_hidden')).toEqual([
      { p_group_id: 'g-captains', p_hidden: true },
    ]);
    back.mockRestore();

    (supabase.rpc as jest.Mock).mockClear();
    await openGroup('coach', group({ hidden: true }));
    await fireEvent.press(screen.getByText('About this group'));
    await fireEvent.press(screen.getByText('Show in my groups'));
    await settle();
    expect(rpcCalls('set_chat_group_hidden')).toEqual([
      { p_group_id: 'g-captains', p_hidden: false },
    ]);
  });

  it('shows a group an admin set up with nobody else in it yet, without a box to post in', async () => {
    await openGroup('admin', group({ kind: 'custom', name: 'Just me', member_count: 1 }), {
      posts: [],
      members: [MEMBERS[0]],
    });
    expect(screen.container.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
    expect(screen.getByText(/^Nobody else is in this group yet\./)).toBeTruthy();
    expect(screen.getByText('No posts yet.')).toBeTruthy();
  });

  it('says so when the group isn’t available', async () => {
    await openScreen(
      'coach',
      { 'messages/group/[id]': ChatGroupScreen },
      '/messages/group/nope',
      {},
      {
        rpcs: { my_chat_groups: [] },
      },
    );
    expect(screen.getByText('This group isn’t available.')).toBeTruthy();
  });

  it('invites the first post in an empty group', async () => {
    await openGroup('coach', group(), { posts: [] });
    expect(screen.getByText(/No posts yet\. Start the conversation below\./)).toBeTruthy();
  });

  it('shows read counts on the member’s own posts', async () => {
    await openGroup('coach', group(), {
      posts: [{ ...POSTS[0], mine: true, read_count: 2, recipient_count: 3 }],
    });
    // The member's own posts don't carry their name, as in a messaging app.
    expect(screen.queryByText(POSTS[0].sender_name)).toBeNull();
    expect(screen.getByText(/Read by 2 of 3/)).toBeTruthy();
  });

  it('opens at the newest post and loads older ones as the member scrolls up', async () => {
    const page = Array.from({ length: POSTS_PAGE }, (_, i) => ({
      ...POSTS[0],
      id: `p${i}`,
      body: `Post ${i}`,
      created_at: new Date(Date.UTC(2026, 10, 24, 0, i)).toISOString(),
    }));
    await openGroup('coach', group(), { posts: page });
    // Drawn upside down, newest first, so it starts at the newest post.
    const list = screen.getByTestId('chat-posts');
    expect(list.props.inverted).toBe(true);
    expect(screen.getByText(`Post ${POSTS_PAGE - 1}`)).toBeTruthy();
    expect(screen.queryByText('Start of the group')).toBeNull();
    await scrollToOldest();
    expect(rpcCalls('chat_group_posts').at(-1)).toEqual({
      p_group_id: 'g-captains',
      p_before: page[0].created_at,
    });
  });

  it('says where the group starts and asks for nothing older', async () => {
    await openGroup('coach', group());
    expect(screen.getByText('Start of the group')).toBeTruthy();
    const before = rpcCalls('chat_group_posts').length;
    await scrollToOldest();
    expect(rpcCalls('chat_group_posts')).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------
// Admins' groups

const ADMIN_GROUP: AdminChatGroup = {
  id: 'g-selectors',
  name: 'Selectors',
  roles: ['coach'],
  team_ids: [TEAM.id],
  people: ['admin'],
  member_count: 5,
  under_18_count: 1,
  post_count: 3,
  created_by_name: 'Sample admin',
  created_at: '2026-11-24T07:00:00Z',
  closed_at: null,
};

describe('admins’ chat groups', () => {
  it('lists the groups admins set up, with who is in them but no posts', async () => {
    await openScreen(
      'admin',
      { 'admin/chat-groups/index': AdminChatGroups },
      '/admin/chat-groups',
      {
        teams: [TEAM],
      },
      {
        rpcs: {
          admin_chat_groups: [
            ADMIN_GROUP,
            {
              ...ADMIN_GROUP,
              id: 'g2',
              name: 'Old',
              closed_at: '2026-11-01T00:00:00Z',
              under_18_count: 0,
              post_count: 1,
            },
          ],
        },
      },
    );
    expect(screen.getByText('Selectors')).toBeTruthy();
    expect(screen.getAllByText(`Coaches in ${TEAM.name}, plus 1 person`)).toHaveLength(2);
    expect(screen.getByText(/5 people, 1 under 18 · 3 posts/)).toBeTruthy();
    expect(screen.getByText('Old (closed)')).toBeTruthy();
    expect(screen.getByText(/1 post$/)).toBeTruthy();
  });

  it('says so when there are none', async () => {
    await openScreen(
      'admin',
      { 'admin/chat-groups/index': AdminChatGroups },
      '/admin/chat-groups',
      {},
      {
        rpcs: { admin_chat_groups: [] },
      },
    );
    expect(screen.getByText('No groups set up yet.')).toBeTruthy();
  });

  it('sets up a new group with the admin in it, by squad or team and role', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    await openScreen(
      'admin',
      { 'admin/chat-groups/edit': AdminChatGroupEdit },
      '/admin/chat-groups/edit',
      {
        teams: [TEAM],
        profiles: [
          {
            id: 'admin',
            full_name: 'Sample admin',
            email: 'admin@example.test',
          },
        ],
      },
      {
        rpcs: {
          admin_chat_group_preview: [{ member_count: 3, under_18_count: 1 }],
        },
      },
    );
    expect(screen.getByText('3 people now. It follows squad and team changes.')).toBeTruthy();
    expect(screen.getByText('⚠ This group includes members under 18')).toBeTruthy();
    expect(screen.getByText(/1 member is under 18/)).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('Such as Selectors'), 'Selectors');
    // Club roles until a team is chosen, then only roles people hold in teams.
    expect(screen.getByText('Committee')).toBeTruthy();
    await fireEvent.press(screen.getByText('Committee'));
    await fireEvent.press(screen.getByText(TEAM.name));
    expect(screen.queryByText('Committee')).toBeNull();
    await fireEvent.press(screen.getByText('Coaches'));
    // With an under 18 in it, the first Save only asks again.
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(rpcCalls('admin_save_chat_group')).toHaveLength(0);
    expect(screen.getByText('Tap Save again to set it up with them in it.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save with under 18s in it'));
    await settle();
    expect(rpcCalls('admin_save_chat_group')).toEqual([
      {
        p_id: null,
        p_name: 'Selectors',
        p_roles: ['coach'],
        p_team_ids: [TEAM.id],
        p_people: ['admin'],
      },
    ]);
    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });

  it('shows the database’s refusal when saving', async () => {
    await openScreen(
      'admin',
      { 'admin/chat-groups/edit': AdminChatGroupEdit },
      '/admin/chat-groups/edit',
      {
        profiles: [],
      },
      { rpcErrors: { admin_save_chat_group: 'Give the group a name' } },
    );
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Give the group a name')).toBeTruthy();
  });

  it('changes and closes an existing group', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    await openScreen(
      'admin',
      { 'admin/chat-groups/edit': AdminChatGroupEdit },
      '/admin/chat-groups/edit?id=g-selectors',
      {
        teams: [TEAM],
        profiles: [{ id: 'admin', full_name: 'Sample admin', email: null }],
      },
      {
        rpcs: {
          admin_chat_groups: [ADMIN_GROUP],
          admin_chat_group_preview: [{ member_count: 5, under_18_count: 0 }],
        },
      },
    );
    expect(screen.getByDisplayValue('Selectors')).toBeTruthy();
    expect(screen.queryByText('⚠ This group includes members under 18')).toBeNull();
    await fireEvent.press(screen.getByText('Close the group'));
    await settle();
    expect(rpcCalls('admin_set_chat_group_closed')).toEqual([
      { p_id: 'g-selectors', p_closed: true },
    ]);
    back.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// A post opened on its own

describe('a group post opened on its own', () => {
  const POST = {
    id: 'msg-1',
    sender_id: 'someone',
    sender_name: 'Sample captain',
    body: 'Something a coach removed',
    audience: 'chat' as const,
    audience_role: null,
    audience_label: `${TEAM.name} coaches and captains`,
    created_at: '2026-11-24T07:00:00Z',
    removed_at: '2026-11-24T08:00:00Z',
    removed_by_name: 'Sample coach',
  };
  const COPY = {
    read_at: null,
    for_children: null,
    for_child_names: null,
    chat_group_id: 'g-captains',
  };

  it('shows a hidden post greyed out with who hid it, and no inbox buttons for a member’s own copy', async () => {
    await openScreen('coach', { 'messages/[id]': MessageScreen }, '/messages/msg-1', {
      messages: [POST],
      message_recipients: [COPY],
    });
    // Only its author, the group's coaches and the author's parents still get it.
    expect(screen.getByText('Something a coach removed')).toBeTruthy();
    expect(screen.getByText(/^Hidden from the group by Sample coach\./)).toBeTruthy();
    expect(screen.getByText(`To ${TEAM.name} coaches and captains`)).toBeTruthy();
    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.getByText('Report this message')).toBeTruthy();
  });

  it('keeps the inbox buttons on a parent’s copy, which lives in their inbox', async () => {
    await openScreen('guardian', { 'messages/[id]': MessageScreen }, '/messages/msg-1', {
      messages: [{ ...POST, removed_at: null, removed_by_name: null }],
      message_recipients: [
        {
          ...COPY,
          chat_group_id: null,
          for_children: ['child'],
          for_child_names: ['Sample Child'],
        },
      ],
    });
    expect(screen.getByText('Something a coach removed')).toBeTruthy();
    expect(screen.getByText('Archive')).toBeTruthy();
  });
});
