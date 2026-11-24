/**
 * Chat groups: admins' groups for roles, squads and teams and named people,
 * and the automatic groups every squad and team gets. The database works out
 * who is in each group and who can post
 * (supabase/migrations/20261124600000_chat_groups.sql); these are the rules
 * the screens show.
 *
 * A post is an ordinary message sent to the people in the group at that
 * moment, so it is kept, archived and looked into like any other message.
 * Members under 18 post only in their own squad's or team's automatic groups
 * while a coach is in them, and read admins' groups; their parents and
 * guardians get a copy of every post. The group's coaches can remove a post.
 */
import { useFeature } from '@/lib/club';
import { pluralRoleLabels } from '@/lib/labels';
import type { AppRole } from '@/lib/types';

export type ChatGroupKind = 'team_staff' | 'team_captains' | 'team_physio' | 'managers' | 'custom';

/** Why a member can't post in a group. */
export type ReadOnlyReason = 'under_18' | 'left' | 'closed';

/** One of the signed-in member's groups, from `my_chat_groups`. */
export type ChatGroup = {
  id: string;
  kind: ChatGroupKind;
  name: string;
  team_id: string | null;
  is_member: boolean;
  can_post: boolean;
  read_only_reason: ReadOnlyReason | null;
  /** The group's coaches can remove posts. */
  can_remove: boolean;
  member_count: number;
  hidden: boolean;
  unread_count: number;
  last_post_at: string | null;
  last_post: string | null;
  last_sender: string | null;
};

/** A post in a group, from `chat_group_posts`. */
export type ChatPost = {
  id: string;
  sender_id: string | null;
  sender_name: string;
  body: string;
  created_at: string;
  mine: boolean;
  body_removed: boolean;
  /** Who removed it, when one of the group's coaches did. Its text isn't shown. */
  removed_by_name: string | null;
  /** For the member's own posts only. */
  read_count: number | null;
  recipient_count: number | null;
};

/** Someone in a group, from `chat_group_members`. */
export type ChatGroupMember = {
  profile_id: string;
  full_name: string | null;
  detail: string | null;
  under_18: boolean;
};

/** An admin's group, from `admin_chat_groups`. */
export type AdminChatGroup = {
  id: string;
  name: string;
  roles: AppRole[];
  team_ids: string[];
  people: string[];
  member_count: number;
  under_18_count: number;
  post_count: number;
  created_by_name: string | null;
  created_at: string;
  closed_at: string | null;
};

/** Whether the club has chat groups on (Messages on too). Off until an admin turns it on. */
export function useChatGroupsOn() {
  const messages = useFeature('messages');
  const chatGroups = useFeature('chatGroups');
  return messages && chatGroups;
}

/** The note under a group a member can't post in. */
export function readOnlyNote(reason: ReadOnlyReason | null): string | null {
  switch (reason) {
    case 'under_18':
      return 'You can read this group. Members under 18 post only in their own squad’s or team’s groups while a coach is in them. Your parents or guardians get a copy of every post.';
    case 'left':
      return 'You’re no longer in this group. You can still read what was posted while you were.';
    case 'closed':
      return 'An admin closed this group. Its posts are kept, but nobody can add to it.';
    default:
      return null;
  }
}

/** What a member under 18 is told above the box they post in. */
export const UNDER_18_POSTING_NOTE =
  'Your parents or guardians get a copy of everything posted here, your own posts too. The group’s coaches can remove any post.';

/** The note under the box adults post in. */
export function postingNote(hasUnder18s: boolean) {
  return hasUnder18s
    ? 'Everyone in the group sees your post. Members under 18 are in it, so their parents or guardians get a copy of every post.'
    : 'Everyone in the group sees your post. Posts are kept like other messages.';
}

/** What a removed post says in place of its text. */
export function removedLine(name: string | null) {
  return `Removed by ${name ?? 'a coach'}`;
}

/** The groups shown in the Groups tab, and the ones the member hid. */
export function splitHidden(groups: ChatGroup[]) {
  return {
    shown: groups.filter((g) => !g.hidden),
    hidden: groups.filter((g) => g.hidden),
  };
}

/** Unread posts across the groups the member hasn't hidden. */
export function groupsUnread(groups: ChatGroup[]) {
  return groups.filter((g) => !g.hidden).reduce((sum, g) => sum + g.unread_count, 0);
}

/** "3 people", "1 person". */
export function peopleCount(n: number) {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** Roles an admin can put in a group across the whole club. */
export const CLUB_ROLES: AppRole[] = [
  'admin',
  'committee',
  'coach',
  'manager',
  'physio',
  'athlete',
  'guardian',
  'statistician',
];

/** Roles an admin can pick inside chosen squads and teams: the roles people hold there. */
export const TEAM_ROLES: AppRole[] = ['coach', 'manager', 'physio', 'athlete'];

/** The roles that can be chosen, given whether squads or teams are chosen. */
export function choosableRoles(teamsChosen: boolean) {
  return teamsChosen ? TEAM_ROLES : CLUB_ROLES;
}

/** Keeps only the roles that still make sense once squads or teams are chosen or cleared. */
export function keepChoosableRoles(roles: AppRole[], teamsChosen: boolean) {
  const allowed = choosableRoles(teamsChosen);
  return roles.filter((r) => allowed.includes(r));
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Who an admin's group takes in, in words, such as "Coaches and managers in
 * Open A and 20 & Under, plus 2 people".
 */
export function groupRuleSummary(
  roles: AppRole[],
  teamNames: string[],
  peopleCountChosen: number,
): string {
  const roleWords = joinWords(
    roles.map((r, i) => {
      const label = pluralRoleLabels[r];
      return i === 0 ? label : label.toLowerCase();
    }),
  );
  let main = '';
  if (teamNames.length > 0) {
    main =
      roles.length > 0
        ? `${roleWords} in ${joinWords(teamNames)}`
        : `Everyone in ${joinWords(teamNames)}`;
  } else if (roles.length > 0) {
    main = `All ${roleWords.toLowerCase()}`;
    // "All committee" reads oddly; "All admins and committee" is fine.
    if (roles.length === 1 && roles[0] === 'committee') main = 'The committee';
  }
  if (peopleCountChosen === 0) return main || 'Nobody chosen yet';
  const people = peopleCount(peopleCountChosen);
  return main ? `${main}, plus ${people}` : people;
}

/** What an admin is told about the under-18s an unsaved group takes in. */
export function under18Note(count: number): string | null {
  if (count === 0) return null;
  return `${count === 1 ? '1 member is' : `${count} members are`} under 18. They can read the group but not post in an admin’s group, and their parents or guardians get a copy of every post, so write as you would to their parents. Check that a child needs to be in it.`;
}

/** The Groups tab's line about a group's latest post. */
export function lastPostLine(group: Pick<ChatGroup, 'last_post' | 'last_sender'>) {
  if (!group.last_post) return 'No posts yet';
  return `${group.last_sender ?? 'Club'}: ${group.last_post}`;
}
