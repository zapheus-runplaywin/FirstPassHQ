import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { flaggedAreas, scoresLine, today } from '@/lib/check-ins';
import { formatShortDay } from '@/lib/format';
import { parseDateString } from '@/lib/injuries';
import type { CheckIn } from '@/lib/types';

/** Recent check-ins, newest first, with low scores called out. */
export function CheckInHistory({ checkIns }: { checkIns: CheckIn[] }) {
  const theme = useTheme();

  if (checkIns.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No check-ins yet.
      </ThemedText>
    );
  }

  return (
    <Card style={styles.list}>
      {checkIns.map((c, index) => {
        const flagged = flaggedAreas(c);
        return (
          <View
            key={c.id}
            style={[
              styles.row,
              index > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
            ]}>
            <View style={styles.rowHeader}>
              <ThemedText type="smallBold">
                {c.day === today() ? 'Today' : formatShortDay(parseDateString(c.day))}
              </ThemedText>
              {flagged.length > 0 ? (
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  Low {flagged.join(', ').toLowerCase()}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {scoresLine(c)}
            </ThemedText>
            {c.note ? <ThemedText type="small">“{c.note}”</ThemedText> : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  row: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
