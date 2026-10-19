import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import { type RecordAccess, recordKindLabels } from '@/lib/record-access';
import { supabase } from '@/lib/supabase';

/**
 * Everyone who has opened an under 18's records, newest first: for their
 * verified parents and guardians and admins.
 */
export default function RecordAccessScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [entries, setEntries] = useState<RecordAccess[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [allowedResult, historyResult] = await Promise.all([
      supabase.rpc('can_see_record_access', { p_subject_id: id }),
      supabase.rpc('record_access_history', { p_subject_id: id }),
    ]);
    setAllowed(allowedResult.data === true);
    setEntries((historyResult.data as RecordAccess[] | null) ?? []);
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

  const who = name ? `${name}’s` : 'their';

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Every time someone at the club opened {who} injuries, injury documents, check-ins, game
        goals, season KPIs, named survey answers or member record in the app, newest first. Views
        by them and by their parents and guardians aren’t listed. Opening the same thing again within 30 minutes counts once.
      </ThemedText>
      {!allowed ? (
        <ThemedText type="small" themeColor="textSecondary">
          Only the child’s verified parents and guardians, and admins, can see this.
        </ThemedText>
      ) : entries === null ? null : entries.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Nobody else has opened {who} records yet.
          </ThemedText>
        </Card>
      ) : (
        <Card>
          {entries.map((e) => (
            <View key={e.id} style={styles.row}>
              <ThemedText type="smallBold">
                {e.viewer_name}
                {e.viewer_role ? ` (${e.viewer_role})` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {recordKindLabels[e.kind]}, {formatDateTime(new Date(e.created_at))}
              </ThemedText>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.half, paddingVertical: Spacing.one },
});
