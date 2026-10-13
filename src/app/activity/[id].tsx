import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Activity = { kind: string; summary: string; happened_at: string };

/**
 * What has changed around an under 18, newest first, for their parents and
 * guardians: adults joining or leaving their squads and teams, the child's
 * own groups, guardian links, consents and shared injury documents.
 */
export default function ChildActivityScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [entries, setEntries] = useState<Activity[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('child_activity', { p_athlete_id: id });
    setEntries((data as Activity[] | null) ?? []);
    await supabase.rpc('mark_child_activity_seen', { p_athlete_id: id });
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
        Coaches, managers and physios added to or leaving {who} squads and teams, {who} own squad
        and team changes, parents and guardians linked or unlinked, consents, and injury documents
        shared out of the app. Newest first.
      </ThemedText>
      {entries === null ? null : entries.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Nothing has changed yet.
          </ThemedText>
        </Card>
      ) : (
        <Card>
          {entries.map((e, i) => (
            <View key={`${e.happened_at}-${i}`} style={styles.row}>
              <ThemedText type="small">{e.summary}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(new Date(e.happened_at))}
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
