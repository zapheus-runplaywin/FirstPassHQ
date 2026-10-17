import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** How many picked each choice, or each point on a rating scale, as bars. */
export function SurveyBars({
  question: q,
}: {
  question: {
    kind: string;
    options: string[] | null;
    rating_max: number | null;
    counts: number[] | null;
    answered: number;
  };
}) {
  const theme = useTheme();
  if (!q.counts) return null;
  const labels =
    q.kind === 'rating'
      ? Array.from({ length: q.rating_max ?? 0 }, (_, n) => String(n + 1))
      : (q.options ?? []);
  return (
    <View style={styles.bars}>
      {labels.map((label, i) => {
        const count = q.counts?.[i] ?? 0;
        const share = q.answered > 0 ? count / q.answered : 0;
        return (
          <View key={i} style={styles.bar}>
            <View style={styles.barLabel}>
              <ThemedText type="small" style={styles.grow}>
                {label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {count} · {Math.round(share * 100)}%
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[styles.fill, { width: `${share * 100}%`, backgroundColor: theme.accent }]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: {
    gap: Spacing.two,
  },
  bar: {
    gap: Spacing.half,
  },
  barLabel: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
});
