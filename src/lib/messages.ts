import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';
import { hasRole } from '@/lib/roles';

export const MESSAGE_COLUMNS =
  'id, sender_id, sender_name, body, audience, audience_role, audience_label, created_at, answer_options, removed_at, removed_by_name';

// Who a message went to, in words. It lives with the list's other wording, which
// has no need of the signed-in member.
export { audienceLabel } from '@/lib/message-list';

/** Columns of the member's own copy of a message. */
export const RECIPIENT_COLUMNS =
  'read_at, unread, archived_at, for_children, for_child_names, answer, chat_group_id';

/**
 * Why a parent or guardian got their copy of a message, naming the children
 * it was for, or null when the message is the member's own.
 */
export function guardianCopyLabel(
  senderId: string | null,
  children: string[] | null,
  names: string[] | null,
) {
  if (!children?.length || !names?.length) return null;
  if (children.length === 1 && children[0] === senderId) {
    return `Copied to you because ${names[0]} sent it`;
  }
  return `Copied to you as ${joinNames(names.map((n) => `${n}’s`))} parent or guardian`;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The squads and teams the member coaches or manages: every one for admins.
 * Used for attendance, which captains don't take.
 */
export function useLedGroups(teams: Team[]) {
  const { memberships, isAdmin, profile } = useAuth();
  if (profile?.status !== 'approved') return [];
  if (isAdmin) return teams;
  const ledIds = new Set(
    memberships
      .filter((m) => m.team_role === 'coach' || m.team_role === 'manager')
      .map((m) => m.team.id),
  );
  // `teams` leaves out past seasons, which can't be messaged.
  return teams.filter((t) => ledIds.has(t.id));
}

/**
 * Current teams the member captains or vice captains while still an athlete
 * in them. Captains are chosen per team; a squad captaincy from before
 * 20 November 2026 no longer counts.
 */
export function useCaptainedGroupIds() {
  const { memberships, captaincies } = useAuth();
  const athleteIn = new Set(
    memberships
      .filter((m) => m.team_role === 'athlete' && m.team.kind === 'team')
      .map((m) => m.team.id),
  );
  return new Set(captaincies.map((c) => c.team_id).filter((id) => athleteIn.has(id)));
}

/**
 * The squads and teams the member can message: every one for admins; the
 * ones they coach, manage or captain for everyone else. The database checks
 * this too.
 */
export function useMessageGroups(teams: Team[]) {
  const led = useLedGroups(teams);
  const captained = useCaptainedGroupIds();
  const ledIds = new Set(led.map((t) => t.id));
  return teams.filter((t) => ledIds.has(t.id) || captained.has(t.id));
}

/** Admins, the committee and club captains can message the whole club. */
export function useCanMessageClub() {
  const { isAdmin, isClubCaptain, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return isAdmin || hasRole(profile, 'committee') || isClubCaptain;
}

/**
 * Guests, temporary helpers and Studio on its own never get messages. Physios always get messages sent to the Physio
 * role, and messages to the whole club when an admin turns that on. The
 * database applies the same rules.
 */
export function useGetsMessages() {
  const { profile } = useAuth();
  return (
    profile?.status === 'approved' &&
    profile.role !== 'guest' &&
    profile.role !== 'volunteer' &&
    profile.role !== 'studio'
  );
}

/** Admins, the committee, coaches, managers and captains can send messages. */
export function useCanSendMessages() {
  const { memberships, profile } = useAuth();
  const canMessageClub = useCanMessageClub();
  const captained = useCaptainedGroupIds();
  if (profile?.status !== 'approved') return false;
  return (
    canMessageClub ||
    captained.size > 0 ||
    memberships.some((m) => m.team_role === 'coach' || m.team_role === 'manager')
  );
}

/** How many messages the member hasn't opened yet, refreshed when the screen is shown. */
export function useUnreadCount() {
  const { session, profile } = useAuth();
  const [count, setCount] = useState(0);
  const userId = session?.user.id;
  const approved = profile?.status === 'approved';

  const load = useCallback(async () => {
    if (!userId || !approved) return;
    const { count: unread } = await supabase
      .from('message_recipients')
      .select('message_id', { count: 'exact', head: true })
      .eq('profile_id', userId)
      .eq('unread', true);
    setCount(unread ?? 0);
  }, [userId, approved]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { unreadCount: count, reloadUnread: load };
}
