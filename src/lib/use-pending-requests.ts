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
