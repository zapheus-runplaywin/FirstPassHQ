import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/check-ins';
import { reviewState, type ConflictRow, type RegisterPolicy } from '@/lib/registers';
import { supabase } from '@/lib/supabase';

/**
 * The club's governance registers (customer review R9): policies with their
 * owners and review dates, and this season's conflict-of-interest
 * declarations. The committee reads them; admins change them.
 */
export default function RegistersScreen() {
  const { isAdmin } = useAuth();
  const [policies, setPolicies] = useState<RegisterPolicy[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: season } = await supabase.rpc('conduct_season');
    const [policiesResult, conflictsResult] = await Promise.all([
      supabase.rpc('policy_register_list'),
      supabase.rpc('conflict_register', { p_season: season }),
    ]);
    setPolicies((policiesResult.data as RegisterPolicy[] | null) ?? []);
    setConflicts((conflictsResult.data as ConflictRow[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const due = (policies ?? []).filter((p) => reviewState(p.review_on, today()) !== 'later');
  const overdue = due.filter((p) => reviewState(p.review_on, today()) === 'overdue');
  const toDeclare = (conflicts ?? []).filter((c) => !c.declared).length;
  const declaredConflicts = (conflicts ?? []).filter((c) => c.declared && c.has_conflict).length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        {isAdmin
          ? 'The club’s policies and conflicts of interest, for the committee and an audit. You add and change them; the committee reads them.'
          : 'The club’s policies and conflicts of interest. You can read them; admins make the changes.'}
      </ThemedText>

      <PressableCard onPress={() => router.push('/registers/policies')}>
        <ThemedText type="smallBold">Policies</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {policies === null
            ? 'Each policy’s owner, version and review date'
            : policies.length === 0
              ? 'No policies yet'
              : [
                  `${policies.length} ${policies.length === 1 ? 'policy' : 'policies'}`,
                  overdue.length > 0 ? `${overdue.length} overdue for review` : null,
                  due.length - overdue.length > 0 ? `${due.length - overdue.length} due within 30 days` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/registers/conflicts')}>
        <ThemedText type="smallBold">Conflicts of interest</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {conflicts === null
            ? 'What the committee and coaches declared this season'
            : [
                `${declaredConflicts} declared this season`,
                toDeclare > 0 ? `${toDeclare} still to declare` : 'everyone has declared',
              ].join(' · ')}
        </ThemedText>
      </PressableCard>
    </Screen>
  );
}
