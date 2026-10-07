import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { CheckInHistory } from '@/components/check-in-history';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { CHECK_IN_COLUMNS } from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { CheckIn } from '@/lib/types';

/** How many days of an athlete's check-ins a coach sees. */
const HISTORY_DAYS = 28;

export default function AthleteCheckInsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [checkIns, setCheckIns] = useState<CheckIn[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - HISTORY_DAYS);
    const { data } = await supabase
      .from('check_ins')
      .select(CHECK_IN_COLUMNS)
      .eq('athlete_id', id)
      .gte('day', toDateString(since))
      .order('day', { ascending: false });
    setCheckIns((data as CheckIn[] | null) ?? []);
  }, [id]);

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
      {name ? <Stack.Screen options={{ title: name }} /> : null}
      <ThemedText type="small" themeColor="textSecondary">
        The last four weeks. Scores are 1 (bad) to 5 (good).
      </ThemedText>
      {checkIns ? <CheckInHistory checkIns={checkIns} /> : null}
    </Screen>
  );
}
