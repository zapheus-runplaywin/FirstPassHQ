import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { outcomeLabel } from '@/lib/goals';
import type { TeamGameGoal } from '@/lib/types';

/** The coaches' goals for the whole team in a game, and how each went. Read only. */
export function TeamGoals({ goals }: { goals: TeamGameGoal[] }) {
  if (goals.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Team goals</ThemedText>
      {goals.map((goal) => (
        <Card key={goal.id} style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Set by Coach {goal.set_by_name}
          </ThemedText>
          <ThemedText>{goal.body}</ThemedText>
          {goal.outcome || goal.review ? (
            <View style={styles.review}>
              <ThemedText type="smallBold">
                {outcomeLabel(goal.outcome) ?? 'Coach’s review'}
              </ThemedText>
              {goal.review ? <ThemedText type="small">{goal.review}</ThemedText> : null}
              {goal.reviewed_by_name ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Coach {goal.reviewed_by_name}
                </ThemedText>
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}
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
  review: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
});
