/**
 * Gathers what src/lib/session.ts needs to know about the signed-in member,
 * for the event's page. Today builds the same facts from what the tabs have
 * already loaded (src/app/(tabs)/index.tsx).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useCanTakeAttendance } from '@/lib/attendance';
import { useAuth } from '@/lib/auth';
import type { CalendarEvent } from '@/lib/calendar';
import { useCheckInSummary } from '@/lib/check-ins';
import { useMyChildren } from '@/lib/children';
import { useClub } from '@/lib/club';
import { hasRole } from '@/lib/roles';
import { sessionActions, type SessionAction, type SessionFacts } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type PlanRow = SessionFacts['plans'][number];

/** What the member's roles and places in squads and teams say, with nothing loaded. */
export function useSessionBasics() {
  const { session, profile, memberships, isAdmin } = useAuth();
  const { features } = useClub();
  const canTakeAttendance = useCanTakeAttendance();
  const approved = profile?.status === 'approved';
  return {
    userId: session?.user.id,
    approved,
    isGuardian: approved && hasRole(profile, 'guardian'),
    features: {
      attendance: features.attendance,
      sessionPlans: features.sessionPlans,
      checkIns: features.checkIns,
    },
    memberships: memberships.map((m) => ({ teamId: m.team.id, role: m.team_role })),
    isAthlete:
      approved &&
      (hasRole(profile, 'athlete') || memberships.some((m) => m.team_role === 'athlete')),
    canTakeAttendance,
    ledTeamIds: memberships
      .filter((m) => m.team_role === 'coach' || m.team_role === 'manager')
      .map((m) => m.team.id),
    leadsEveryTeam: approved && isAdmin,
    planTeamIds: memberships.filter((m) => m.team_role === 'coach').map((m) => m.team.id),
    plansForEveryTeam: approved && isAdmin,
  };
}

/**
 * The session plans the member can read: their own and those shared with
 * them. The database decides which rows come back.
 */
function useReadablePlans(enabled: boolean, userId: string | undefined) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const load = useCallback(async () => {
    if (!enabled || !userId) return;
    const [own, shared] = await Promise.all([
      supabase
        .from('session_plans')
        .select('id, team_id, title, session_on')
        .eq('author_id', userId)
        .order('session_on', { ascending: false })
        .limit(500),
      supabase.rpc('shared_session_plans'),
    ]);
    const rows = [...((own.data as PlanRow[] | null) ?? []), ...((shared.data as PlanRow[] | null) ?? [])];
    setPlans(rows.filter((row, i) => rows.findIndex((r) => r.id === row.id) === i));
  }, [enabled, userId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return enabled ? plans : [];
}

/** The shortcuts for one session, for the member looking at its page. */
export function useSessionActions(event: CalendarEvent | null | undefined): SessionAction[] {
  const { approved, isGuardian, ...basics } = useSessionBasics();
  const { children } = useMyChildren(isGuardian && basics.features.attendance);
  const { checkInSummary } = useCheckInSummary();
  const reads =
    approved &&
    basics.features.sessionPlans &&
    (basics.plansForEveryTeam ||
      isGuardian ||
      basics.isAthlete ||
      basics.planTeamIds.length > 0);
  const plans = useReadablePlans(reads, basics.userId);
  // When the page opened: what is offered doesn't change under the member's thumb.
  const [now] = useState(() => new Date());
  if (!event || !approved) return [];
  return sessionActions(event, {
    ...basics,
    now,
    children: children.map((c) => ({ id: c.id, name: c.name })),
    plans,
    checkIns: checkInSummary,
  });
}
