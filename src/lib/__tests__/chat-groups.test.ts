import {
  CLUB_POSTS,
  CLUB_ROLES,
  clubRolesOf,
  groupRuleSummary,
  groupsUnread,
  lastPostLine,
  mergePosts,
  peopleCount,
  postingNote,
  readOnlyNote,
  hiddenLine,
  splitHidden,
  SWIPE_ACTION_WIDTH,
  swipeStaysOpen,
  TEAM_ROLES,
  under18Note,
  useChatGroupsOn,
  type ChatGroup,
  type ChatPost,
} from '@/lib/chat-groups';
import { useFeature } from '@/lib/club';
import { hiddenNote, messageBoxes } from '@/lib/inbox';

jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

function group(id: string, extra: Partial<ChatGroup> = {}): ChatGroup {
  return {
    id,
    kind: 'custom',
    name: id,
    team_id: null,
    is_member: true,
    can_post: true,
    read_only_reason: null,
    can_remove: false,
    member_count: 3,
    hidden: false,
    unread_count: 0,
    last_post_at: null,
    last_post: null,
    last_sender: null,
    ...extra,
  };
}

describe('readOnlyNote', () => {
  it('explains each reason a member can’t post', () => {
    expect(readOnlyNote('under_18')).toMatch(
      /Members under 18 post only in their own squad’s or team’s groups/,
    );
    expect(readOnlyNote('under_18')).toMatch(/parents or guardians get a copy/);
    expect(readOnlyNote('left')).toMatch(/no longer in this group/);
    expect(readOnlyNote('closed')).toMatch(/closed this group/);
    expect(readOnlyNote(null)).toBeNull();
  });
});

describe('the Groups tab', () => {
  it('puts hidden groups apart and counts unread only in the others', () => {
    const groups = [group('a', { unread_count: 2 }), group('b', { hidden: true, unread_count: 5 })];
    expect(splitHidden(groups).shown.map((g) => g.id)).toEqual(['a']);
    expect(splitHidden(groups).hidden.map((g) => g.id)).toEqual(['b']);
    expect(groupsUnread(groups)).toBe(2);
  });

  it('shows Groups after Archived only while chat groups are on, with the unread count', () => {
    expect(messageBoxes(true, true).map((b) => b.label)).toEqual([
      'Inbox',
      'Sent',
      'Archived',
      'Groups',
    ]);
    expect(messageBoxes(false, true, 3).map((b) => b.label)).toEqual([
      'Inbox',
      'Archived',
      'Groups (3)',
    ]);
    expect(messageBoxes(true, false, 3).map((b) => b.value)).toEqual(['inbox', 'sent', 'archived']);
  });

  it('describes the latest post', () => {
    expect(lastPostLine({ last_post: null, last_sender: null })).toBe('No posts yet');
    expect(lastPostLine({ last_post: 'Hi', last_sender: null })).toBe('Club: Hi');
    expect(lastPostLine({ last_post: 'Hi', last_sender: 'Casey' })).toBe('Casey: Hi');
  });
});

describe('notes', () => {
  it('counts people', () => {
    expect(peopleCount(1)).toBe('1 person');
    expect(peopleCount(0)).toBe('0 people');
    expect(peopleCount(4)).toBe('4 people');
  });

  it('tells adults when parents are copied', () => {
    expect(postingNote(true)).toMatch(/parents or guardians get a copy/);
    expect(postingNote(false)).not.toMatch(/parents/);
  });

  it('names who removed a post, in the group and on the message', () => {
    expect(hiddenLine('Casey Coach')).toBe(
      'Hidden by Casey Coach. Only its author, the group’s coaches and the author’s parents see it.',
    );
    expect(hiddenLine(null)).toMatch(/^Hidden by a coach\./);
    expect(hiddenNote({ removed_at: '2026-11-24T00:00:00Z', removed_by_name: 'Casey' })).toBe(
      'Hidden from the group by Casey. Only its author, the group’s coaches and the author’s parents see it.',
    );
    expect(hiddenNote({ removed_at: '2026-11-24T00:00:00Z', removed_by_name: null })).toMatch(
      /^Hidden from the group by a coach\./,
    );
    expect(hiddenNote({ removed_at: null, removed_by_name: null })).toBeNull();
  });

  it('tells an admin about the under-18s a group takes in', () => {
    expect(under18Note(0)).toBeNull();
    expect(under18Note(1)).toMatch(/^1 member is under 18\. .*not post in an admin’s group/);
    expect(under18Note(3)).toMatch(/^3 members are under 18/);
    expect(under18Note(2)).toMatch(/Check that a child needs to be in it\.$/);
  });
});

describe('who an admin’s group takes in', () => {
  it('offers club roles without guests, helpers or Studio, and team roles in squads', () => {
    expect(CLUB_ROLES).toEqual(expect.arrayContaining(['admin', 'committee', 'physio']));
    expect(CLUB_ROLES).not.toContain('guest');
    expect(CLUB_ROLES).not.toContain('volunteer');
    expect(CLUB_ROLES).not.toContain('studio');
    expect(TEAM_ROLES).toEqual(['coach', 'manager', 'physio', 'athlete']);
  });

  it('offers the safeguarding posts and Head Physio', () => {
    expect(CLUB_POSTS.map((p) => p.label)).toEqual([
      'Child Safety Officer',
      'Complaints Manager',
      'WWC Registration Officer',
      'Head Physio',
    ]);
  });

  it('reads club roles from groups saved before they could sit beside squads', () => {
    // No squads: roles were the club roles.
    expect(clubRolesOf(['committee'], false)).toEqual(['committee']);
    expect(clubRolesOf(['committee'], false, ['admin', 'committee'])).toEqual([
      'committee',
      'admin',
    ]);
    // With squads, roles are the roles in them.
    expect(clubRolesOf(['coach'], true, ['admin'])).toEqual(['admin']);
    expect(clubRolesOf(['coach'], true)).toEqual([]);
  });

  it('describes the choice in words', () => {
    expect(groupRuleSummary([], [], 0)).toBe('Nobody chosen yet');
    expect(groupRuleSummary(['coach'], [], 0)).toBe('All coaches');
    expect(groupRuleSummary(['coach', 'manager'], [], 0)).toBe('All coaches and managers');
    expect(groupRuleSummary(['committee'], [], 0)).toBe('The committee');
    expect(groupRuleSummary([], ['Open A', '20 & Under'], 0)).toBe(
      'Everyone in Open A and 20 & Under',
    );
    expect(groupRuleSummary(['coach', 'manager'], ['Open A'], 2)).toBe(
      'Coaches and managers in Open A, plus 2 people',
    );
    expect(groupRuleSummary([], [], 1)).toBe('1 person');
  });

  it('adds club roles and posts to squads and teams', () => {
    expect(groupRuleSummary(['coach'], ['Open Squad'], 1, { clubRoles: ['admin'] })).toBe(
      'Coaches in Open Squad and all admins, plus 1 person',
    );
    expect(
      groupRuleSummary([], [], 0, {
        clubRoles: ['admin', 'committee'],
        posts: ['complaints_manager', 'child_safety_officer'],
      }),
    ).toBe('All admins and committee, the Child Safety Officer and the Complaints Manager');
    expect(groupRuleSummary([], [], 0, { posts: ['head_physio'] })).toBe('The Head Physio');
    expect(groupRuleSummary([], [], 0, { clubRoles: ['committee'] })).toBe('The committee');
    expect(groupRuleSummary(['committee'], [], 0, { clubRoles: ['admin'] })).toBe(
      'All committee and admins',
    );
  });
});

describe('useChatGroupsOn', () => {
  it('needs Messages and Chat groups both on', () => {
    const feature = useFeature as jest.Mock;
    feature.mockImplementation(() => true);
    expect(useChatGroupsOn()).toBe(true);
    feature.mockImplementation((key: string) => key !== 'chatGroups');
    expect(useChatGroupsOn()).toBe(false);
    feature.mockImplementation((key: string) => key !== 'messages');
    expect(useChatGroupsOn()).toBe(false);
  });
});

describe('mergePosts', () => {
  const post = (id: string, minute: number, body = id): ChatPost => ({
    id,
    sender_id: 's',
    sender_name: 'Sam',
    body,
    created_at: new Date(Date.UTC(2026, 10, 24, 9, minute)).toISOString(),
    mine: false,
    body_removed: false,
    removed_by_name: null,
    read_count: null,
    recipient_count: null,
  });

  it('puts the newest first, each post once', () => {
    const merged = mergePosts([post('b', 2), post('a', 1)], [post('c', 3), post('b', 2)]);
    expect(merged.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('adds an older page below what is shown', () => {
    const merged = mergePosts([post('c', 3), post('b', 2)], [post('a', 1)]);
    expect(merged.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('takes the newer copy of a post, so a removal shows', () => {
    const merged = mergePosts([post('a', 1, 'Hello')], [post('a', 1, 'Removed by Cam')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].body).toBe('Removed by Cam');
  });

  it('orders posts sent in the same minute by id', () => {
    expect(mergePosts([], [post('a', 1), post('b', 1)]).map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('swipeStaysOpen', () => {
  it('stays open past half the action, or on a flick left', () => {
    expect(swipeStaysOpen(-SWIPE_ACTION_WIDTH / 2 - 1, 0)).toBe(true);
    expect(swipeStaysOpen(-SWIPE_ACTION_WIDTH / 2, 0)).toBe(false);
    expect(swipeStaysOpen(-10, -0.6)).toBe(true);
    expect(swipeStaysOpen(-10, -0.5)).toBe(false);
    expect(swipeStaysOpen(0, 0)).toBe(false);
  });
});
