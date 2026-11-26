import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListHeading } from '@/components/messages/parts';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  keepNewFrom,
  newFromTime,
  newHeading,
  splitByNew,
  type ChildActivity,
} from '@/lib/child-activity';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/**
 * What has changed around an under 18, newest first, for their parents and
 * guardians: adults joining or leaving their squads and teams, the child's
 * own groups, guardian links, consents and shared injury documents. What has
 * happened since the parent last looked sits at the top under its own
 * heading, picked out, with the rest under "Earlier".
 */
export default function ChildActivityScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const theme = useTheme();
  const [entries, setEntries] = useState<ChildActivity[] | null>(null);
  const [newFrom, setNewFrom] = useState<string | null>(null);
  const newFromRef = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Both are read before the list is marked seen, so the count still says
    // what was new when the parent opened it.
    const [{ data }, counts] = await Promise.all([
      supabase.rpc('child_activity', { p_athlete_id: id }),
      supabase.rpc('child_activity_new'),
    ]);
    const rows = (data as ChildActivity[] | null) ?? [];
    const count =
      ((counts.data as { athlete_id: string; new_count: number }[] | null) ?? []).find(
        (c) => c.athlete_id === id,
      )?.new_count ?? 0;
    newFromRef.current = keepNewFrom(newFromRef.current, newFromTime(rows, count));
    setNewFrom(newFromRef.current);
    setEntries(rows);
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
  const { fresh, earlier } = splitByNew(entries ?? [], newFrom);

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
        <>
          {fresh.length > 0 ? (
            <>
              <View style={styles.newHeading} accessibilityRole="header">
                <View style={[styles.dot, { backgroundColor: theme.text }]} />
                <ThemedText type="smallBold" style={styles.newHeadingText}>
                  {newHeading(fresh.length)}
                </ThemedText>
              </View>
              <Card
                testID="activity-new"
                style={[styles.newCard, { backgroundColor: theme.backgroundSelected }]}>
                {fresh.map((e, i) => (
                  <View
                    key={`${e.happened_at}-${i}`}
                    style={styles.row}
                    accessible
                    accessibilityLabel={`New. ${e.summary} ${formatDateTime(new Date(e.happened_at))}`}>
                    <View style={styles.newLine}>
                      <View style={[styles.dot, styles.rowDot, { backgroundColor: theme.text }]} />
                      <ThemedText type="smallBold" style={styles.newSummary}>
                        {e.summary}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.newDate}>
                      {formatDateTime(new Date(e.happened_at))}
                    </ThemedText>
                  </View>
                ))}
              </Card>
              {earlier.length > 0 ? <ListHeading>Earlier</ListHeading> : null}
            </>
          ) : null}
          {earlier.length > 0 ? (
            <Card testID="activity-earlier">
              {earlier.map((e, i) => (
                <View key={`${e.happened_at}-${i}`} style={styles.row}>
                  <ThemedText type="small">{e.summary}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDateTime(new Date(e.happened_at))}
                  </ThemedText>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const DOT = 8;

const styles = StyleSheet.create({
  row: { gap: Spacing.half, paddingVertical: Spacing.one },
  newHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  newHeadingText: { flexShrink: 1 },
  newCard: { gap: Spacing.one },
  newLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  newSummary: { flex: 1 },
  // Lines the date up under the words, past the dot.
  newDate: { marginLeft: DOT + Spacing.two },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  // Centres the dot on the first line of 20 px text.
  rowDot: { marginTop: (20 - DOT) / 2 },
});
