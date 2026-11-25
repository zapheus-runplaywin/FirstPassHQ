import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { adminMenuItems } from '@/lib/admin-menu';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { clubAreas, type ClubArea, type ClubWaiting, type SearchableMember } from '@/lib/club-areas';
import { useHome } from '@/lib/home';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { pendingRequestsLabel } from '@/lib/use-pending-requests';

const counted = (count: number, one: string, many: string, rest: string): ClubWaiting => ({
  count,
  text: `${count} ${count === 1 ? one : many} ${rest}`,
});

/**
 * The member's Club tab as areas (src/lib/club-areas.ts): the Club cards they
 * are shown and, for an admin, their menu, with the work waiting behind each.
 */
export function useClubAreas(): ClubArea[] {
  const home = useHome();
  const { features, squads } = useClub();
  const cards = home.cards('club');
  // Only an admin is shown the Administration card, which stands for the menu.
  const links = cards.includes('administration')
    ? adminMenuItems({
        features,
        squads,
        membersDetail: pendingRequestsLabel(home.pendingCount),
      })
    : [];
  return clubAreas({
    cards,
    links,
    waiting: {
      '/admin': { count: home.pendingCount, text: pendingRequestsLabel(home.pendingCount) },
      concerns: counted(home.newConcerns, 'new concern', 'new concerns', 'to look at'),
      integrity: counted(home.certificatesToCheck, 'certificate', 'certificates', 'to check'),
      injuries: counted(home.injuriesWaiting, 'injury', 'injuries', 'waiting for you'),
      sessionPlans: counted(home.plans.newShared, 'new plan', 'new plans', 'shared with you'),
      surveys: counted(home.surveysWaiting, 'survey', 'surveys', 'to answer'),
    },
  });
}

/** A member as the Club tab's search shows them. */
export type FoundMember = SearchableMember &
  Pick<Profile, 'role' | 'extra_roles' | 'status' | 'join_requested_at'>;

const FINDER_COLUMNS =
  'id, full_name, preferred_name, email, playhq_email, role, extra_roles, status, join_requested_at';

/**
 * The club's members, for an admin's search in the Club tab. Loaded when a
 * search first needs them, and only for an admin: the database gives nobody
 * else the list.
 */
export function useMemberFinder(wanted: boolean) {
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<FoundMember[] | null>(null);
  const needed = isAdmin && wanted;

  // Again each time the tab is come back to, so someone just approved reads as they are now.
  useFocusEffect(
    useCallback(() => {
      if (!needed) return;
      let current = true;
      supabase
        .from('profiles')
        .select(FINDER_COLUMNS)
        .order('full_name', { nullsFirst: false })
        .then(({ data }) => {
          if (current) setMembers((data as FoundMember[] | null) ?? []);
        });
      return () => {
        current = false;
      };
    }, [needed]),
  );

  return { members: isAdmin ? members : null };
}
