import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { closesLabel } from '@/lib/awards';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

type ClosedAward = { id: string; name: string; season: number; closes_at: string };

/** Awards whose voting has closed, newest first, to open their full results. */
export default function AwardResultsScreen() {
  const [awards, setAwards] = useState<ClosedAward[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('awards')
      .select('id, name, season, closes_at')
      .lte('closes_at', new Date().toISOString())
      .order('closes_at', { ascending: false });
    setAwards((data as ClosedAward[] | null) ?? []);
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

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Full results show once voting has closed.
      </ThemedText>
      {awards?.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No awards have closed yet.
        </ThemedText>
      ) : null}
      {awards?.map((award) => (
        <PressableCard
          key={award.id}
          onPress={() => router.push({ pathname: '/admin/reports/award', params: { id: award.id } })}>
          <ThemedText type="smallBold">{award.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {seasonLabel(award.season)} · {closesLabel(award.closes_at)}
          </ThemedText>
        </PressableCard>
      ))}
    </Screen>
  );
}
