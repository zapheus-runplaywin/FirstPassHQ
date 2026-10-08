import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { pluralRoleLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole, MessageAudience, Team } from '@/lib/types';

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
 * The squads and teams the member can message: every one for admins, and the
 * ones they coach or manage for everyone else. The database checks this too.
 */
export function useMessageGroups(teams: Team[]) {
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

/** Admins, the committee, coaches and managers can send messages. */
export function useCanSendMessages() {
  const { memberships, isAdmin, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return (
    isAdmin ||
    profile.role === 'committee' ||
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
