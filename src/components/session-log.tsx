import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { today } from '@/lib/check-ins';
import { formatShortDay } from '@/lib/format';
import { parseDateString } from '@/lib/injuries';
import { loadChange, RPE_LABELS, sessionLine, weeklyLoads } from '@/lib/session-logs';
import type { SessionLog } from '@/lib/types';

export function dayLabel(day: string) {
  return day === today() ? 'Today' : formatShortDay(parseDateString(day));
}

/** Load for each of the last four weeks, this week first, and how it changed. */
export function WeeklyLoad({ logs }: { logs: SessionLog[] }) {
  const theme = useTheme();
  const weeks = weeklyLoads(logs, today());
  const change = loadChange(weeks);
  return (
    <Card style={styles.list}>
      {weeks.map((w, index) => (
        <View
          key={w.from}
          style={[
            styles.row,
            styles.rowHeader,
            index > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
          ]}>
          <ThemedText type={index === 0 ? 'smallBold' : 'small'}>
            {index === 0 ? 'Last 7 days' : `${dayLabel(w.from)} to ${dayLabel(w.to)}`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {w.sessions === 0
              ? 'No sessions'
              : `${w.sessions} ${w.sessions === 1 ? 'session' : 'sessions'} · ${w.minutes} min · load ${w.load} · average effort ${w.effort}`}
          </ThemedText>
        </View>
      ))}
      {change ? (
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
          <ThemedText type="small">{change}</ThemedText>
        </View>
      ) : null}
    </Card>
  );
}

/** Logged sessions, newest first. Tapping one edits it when onPress is given. */
export function SessionLogList({
  logs,
  onPress,
}: {
  logs: SessionLog[];
  onPress?: (log: SessionLog) => void;
}) {
  const theme = useTheme();
  if (logs.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No sessions logged.
      </ThemedText>
    );
  }
  return (
    <Card style={styles.list}>
      {logs.map((log, index) => {
        const content = (
          <>
            <ThemedText type="smallBold">{dayLabel(log.day)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {sessionLine(log)}
            </ThemedText>
          </>
        );
        const border = index > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected };
        return onPress ? (
          <Pressable
            key={log.id}
            accessibilityRole="button"
            accessibilityLabel={`Change ${dayLabel(log.day)}, ${sessionLine(log)}`}
            onPress={() => onPress(log)}
            style={({ pressed }) => [
              styles.row,
              border,
              pressed && { backgroundColor: theme.backgroundSelected },
            ]}>
            {content}
          </Pressable>
        ) : (
          <View key={log.id} style={[styles.row, border]}>
            {content}
          </View>
        );
      })}
    </Card>
  );
}

/** How hard a session felt, 1 to 10, as two rows of buttons. */
export function EffortScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <View style={styles.rowHeader}>
        <ThemedText type="smallBold">How hard did it feel?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {value ? RPE_LABELS[value] : ''}
        </ThemedText>
      </View>
      {[
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
      ].map((line) => (
        <View key={line[0]} style={styles.scale}>
          {line.map((score) => {
            const selected = value === score;
            return (
              <Pressable
                key={score}
                accessibilityRole="button"
                accessibilityLabel={`Effort ${score}: ${RPE_LABELS[score]}`}
                accessibilityState={{ selected }}
                onPress={() => onChange(score)}
                style={({ pressed }) => [
                  styles.score,
                  {
                    backgroundColor: selected
                      ? theme.accent
                      : pressed
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                  },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={selected ? { color: theme.onAccent } : undefined}>
                  {score}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.rowHeader}>
        <ThemedText type="small" themeColor="textSecondary">
          1 Very easy
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          10 Maximal
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.half },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  scale: { flexDirection: 'row', gap: Spacing.two },
  score: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
