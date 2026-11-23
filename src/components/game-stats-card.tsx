import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { statLines, type GameStats } from '@/lib/game-stats';

/**
 * The athlete's own figures from the game, beside their goals for it, for
 * their coaches (a selection round's panel sees the same figures on the
 * athlete's assessment). Only this athlete's figures are here, never a team mate's or
 * the team's.
 */
export function GameStatsCard({ stats }: { stats: GameStats }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Game stats</ThemedText>
      <Card style={styles.card}>
        {statLines(stats).map((line) => (
          <View key={line.label} style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary">
              {line.label}
            </ThemedText>
            <ThemedText type="small" style={styles.value}>
              {line.value}
            </ThemedText>
          </View>
        ))}
      </Card>
      <ThemedText type="small" themeColor="textSecondary">
        From the game recorded in FirstPass Vantage. Only the athlete’s coaches see these, and their selectors during a selection round.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
