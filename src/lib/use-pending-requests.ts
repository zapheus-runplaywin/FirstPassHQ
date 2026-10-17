import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/** How many join requests are waiting for an admin, refreshed when the screen is shown. */
export function usePendingRequests() {
  const { isAdmin } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const { count: pending } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .not('join_requested_at', 'is', null);
    setCount(pending ?? 0);
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { pendingCount: count, reloadPending: load };
}

export function pendingRequestsLabel(count: number) {
  return count === 0
    ? 'No requests waiting'
    : `${count} ${count === 1 ? 'request' : 'requests'} waiting for approval`;
}

/** Child-safety follow-ups for admins, from `admin_safety_todos`. */
export type SafetyTodos = {
  wwcc_missing: number;
  wwcc_expiring: number;
  minors_without_guardian: number;
  turning_18: number;
  /** Volunteer exemptions that end by themselves within 60 days. */
  exemptions_ending: number;
  /** Approved athletes with no checked date of birth, mostly from before it was needed. */
  athletes_without_date_of_birth: number;
  /** Current cards never validated, or validated over a year ago. */
  wwcc_to_validate: number;
  /** Current cards not registered with the club. */
  wwcc_to_link: number;
  /** Barring notices the governing body hasn't been told about. */
  notices_to_report: number;
  /** 1 when the club has no WWC Registration Officer. */
  wwc_officer_missing: number;
  /** Members behind any of the four card counts above, each counted once. */
  wwcc_people?: number;
  /** Club settings' "Remove old records" is off, so nothing past its keep period is removed. */
  records_removal_off?: boolean;
  /** Members with no squad, team or club role for 2 years, from `admin_inactive_members`. */
  inactive_members?: number;
};

/** Child-safety follow-ups for admins, refreshed when the screen is shown. */
export function useSafetyTodos() {
  const { isAdmin } = useAuth();
  const [safety, setSafety] = useState<SafetyTodos | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const [{ data }, { data: retention }, { data: inactive }] = await Promise.all([
      supabase.rpc('admin_safety_todos').maybeSingle(),
      supabase.rpc('record_retention').maybeSingle(),
      supabase.rpc('admin_inactive_members'),
    ]);
    const todos = (data as SafetyTodos | null) ?? null;
    const removalOn = (retention as { enabled?: unknown } | null)?.enabled;
    setSafety(
      todos && {
        ...todos,
        records_removal_off: retention != null && removalOn === false,
        inactive_members: Array.isArray(inactive) ? inactive.length : 0,
      },
    );
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { safetyTodos: isAdmin ? safety : null, reloadSafetyTodos: load };
}
