import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { pluralRoleLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole, MessageAudience, Team } from '@/lib/types';
import { hasRole } from '@/lib/roles';

export const MESSAGE_COLUMNS =
  'id, sender_id, sender_name, body, audience, audience_role, audience_label, created_at';

/** Who a message went to, such as "Everyone in the club" or "Open Squad". */
export function audienceLabel(
  audience: MessageAudience,
  role: AppRole | 'partner' | null,
  label: string | null,
) {
  if (audience === 'club') return 'Everyone in the club';
  if (audience === 'role') {
    if (!role) return 'A role';
    // Sent before the Partner role was removed.
    if (role === 'partner') return 'All partners';
    return `All ${pluralRoleLabels[role].toLowerCase()}`;
  }
  return label ?? 'A squad or team';
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

/** Current squads and teams the member captains or vice captains while still an athlete in them. */
export function useCaptainedGroupIds() {
  const { memberships, captaincies } = useAuth();
  const athleteIn = new Set(
    memberships.filter((m) => m.team_role === 'athlete').map((m) => m.team.id),
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
 * Guests never get messages. Physios always get messages sent to the Physio
 * role, and messages to the whole club when an admin turns that on. The
 * database applies the same rules.
 */
export function useGetsMessages() {
  const { profile } = useAuth();
  return profile?.status === 'approved' && profile.role !== 'guest';
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
      .is('read_at', null);
    setCount(unread ?? 0);
  }, [userId, approved]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { unreadCount: count, reloadUnread: load };
}
