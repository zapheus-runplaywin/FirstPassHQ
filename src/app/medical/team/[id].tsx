import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorText, PressableCard } from '@/components/ui';
import { teamMedicalLine, type TeamMedicalRow } from '@/lib/medical';
import { supabase } from '@/lib/supabase';

/**
 * A squad or team's athletes for its coaches, managers and physios: tap one
 * to open their medical and emergency details. The list shows no details, so
 * opening it isn't logged; opening an athlete is.
 */
export default function TeamMedicalScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [rows, setRows] = useState<TeamMedicalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('team_medical_profiles', { p_team_id: id });
    setError(rpcError?.message ?? null);
    setRows((data as TeamMedicalRow[] | null) ?? []);
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
        Emergency contacts, allergies, conditions, medications and action plans, kept by each
        athlete or, for an under 18, their parents. Each time you open someone’s it’s recorded, and
        they, or a parent for an under 18, can see that you did.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {rows === null ? null : rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No athletes here yet.
        </ThemedText>
      ) : (
        rows.map((row) =>
          row.can_open ? (
            <PressableCard
              key={row.athlete_id}
              onPress={() => router.push({ pathname: '/medical/[id]', params: { id: row.athlete_id } })}>
              <ThemedText type="smallBold">{row.athlete_name}</ThemedText>
              <StatusLine text={teamMedicalLine(row)} tone={row.has_contacts ? 'quiet' : 'attention'} />
            </PressableCard>
          ) : (
            <Card key={row.athlete_id}>
              <ThemedText type="smallBold">{row.athlete_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {teamMedicalLine(row)}
              </ThemedText>
            </Card>
          ),
        )
      )}
    </Screen>
  );
}
