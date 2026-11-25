/**
 * Blocking in chat groups (supabase/migrations/20261125400000_chat_blocks.sql).
 *
 * A member blocks the author of a post in one of their groups, and stops
 * seeing that member's posts in every group. It is one way and the blocked
 * member isn't told. Blocking never hides a parent's copy of a post to or from
 * their child, or club messages, and deletes nothing. An adult can't block a
 * member under 18 (they ask a coach to hide the post or raise a concern); a
 * member under 18 can block anyone.
 *
 * Every block goes to the club's admins, Child Safety Officer and Complaints
 * Manager, never to the two members involved, as a to-do until one of them
 * records that it was followed up.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** Someone the signed-in member has blocked, from `my_chat_blocks`. */
export type MyChatBlock = {
  profile_id: string;
  name: string;
  blocked_at: string;
  group_name: string | null;
};

/** A block in the register, from `chat_block_register`. Names only, never posts. */
export type ChatBlockRecord = {
  id: string;
  created_at: string;
  blocker_name: string;
  blocked_name: string;
  blocker_under_18: boolean;
  blocked_under_18: boolean;
  group_name: string | null;
  unblocked_at: string | null;
  followed_up_at: string | null;
  followed_up_by_name: string | null;
  follow_up_note: string | null;
};

/** The longest follow-up note the database keeps. */
export const FOLLOW_UP_NOTE_MAX = 1000;

/** What blocking does, shown before the member confirms. */
export function blockWarning(name: string): string {
  return (
    `You won’t see ${name}’s posts in any of your chat groups. They aren’t told, and they still ` +
    'see your posts. Club messages from them still reach you. Your club’s admins and Child ' +
    'Safety Officer are told, so they can check you’re OK. You can unblock them in Blocked people.'
  );
}

/**
 * Whether the post screen offers Block: a post someone else wrote, in one of
 * the member's own groups (not a parent's copy of a post to their child).
 * The database also refuses an adult blocking a member under 18.
 */
export function canOfferBlock({
  isChatPost,
  inMyGroup,
  senderId,
  myId,
}: {
  isChatPost: boolean;
  inMyGroup: boolean;
  senderId: string | null;
  myId: string | undefined;
}): boolean {
  return isChatPost && inMyGroup && !!senderId && !!myId && senderId !== myId;
}

/** A block in the register, in one line: who blocked whom. */
export function blockLine(b: Pick<ChatBlockRecord, 'blocker_name' | 'blocked_name' | 'blocker_under_18' | 'blocked_under_18'>): string {
  const who = (name: string, under18: boolean) => (under18 ? `${name} (under 18)` : name);
  return `${who(b.blocker_name, b.blocker_under_18)} blocked ${who(b.blocked_name, b.blocked_under_18)}`;
}

/** Where a block in the register stands. */
export function blockStatus(b: Pick<ChatBlockRecord, 'unblocked_at' | 'followed_up_at' | 'followed_up_by_name'>): string {
  const parts = [b.unblocked_at ? 'Unblocked' : 'Still blocked'];
  parts.push(
    b.followed_up_at ? `Followed up by ${b.followed_up_by_name ?? 'someone'}` : 'Waiting for a follow-up',
  );
  return parts.join(' · ');
}

/** The to-do title for blocks waiting for the member's follow-up. */
export function blocksTodoTitle(waiting: number): string {
  return waiting === 1
    ? 'Follow up a block in chat groups'
    : `Follow up ${waiting} blocks in chat groups`;
}

/** How many blocks wait for the signed-in member's follow-up. */
export function useChatBlocksWaiting(enabled: boolean): number {
  const [waiting, setWaiting] = useState(0);
  const load = useCallback(async () => {
    if (!enabled) {
      setWaiting(0);
      return;
    }
    const { data } = await supabase.rpc('chat_blocks_waiting');
    const row = (Array.isArray(data) ? data[0] : data) as { waiting: number } | null;
    setWaiting(row?.waiting ?? 0);
  }, [enabled]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return waiting;
}
