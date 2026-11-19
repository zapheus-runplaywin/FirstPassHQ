import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ConcernCounts } from '@/lib/concerns';

/**
 * Fixed traffic-light colours, whatever the club's colours, so they read the
 * same in every club. Each count passes WCAG AA on its light: white on red
 * (5.6:1) and green (5.1:1), black on the brand's blaze orange (6.2:1).
 */
export const LightColours = {
  red: { fill: '#C62828', ink: '#FFFFFF' },
  orange: { fill: '#F75C03', ink: '#000000' },
  green: { fill: '#2E7D32', ink: '#FFFFFF' },
} as const;

type Light = { key: keyof ConcernCounts; colour: keyof typeof LightColours; label: string };

const LIGHTS: Light[] = [
  { key: 'new', colour: 'red', label: 'New' },
  { key: 'inProgress', colour: 'orange', label: 'In progress' },
  { key: 'closedRecently', colour: 'green', label: 'Closed, 4 weeks' },
];

/** What a screen reader says for the three lights. */
export function concernLightsLabel(counts: ConcernCounts) {
  return `${counts.new} new, ${counts.inProgress} in progress, ${counts.closedRecently} closed in the last 4 weeks`;
}

/**
 * Red, orange and green counts for the Concerns card: new, in progress, and
 * closed in the last 4 weeks. Counts only, never what a concern says. A light
 * with nothing in it is dimmed, and each has a word, so colour isn't the only
 * way to tell them apart.
 */
export function ConcernLights({ counts }: { counts: ConcernCounts }) {
  return (
    <View
      accessible
      accessibilityLabel={concernLightsLabel(counts)}
      style={styles.row}
      testID="concern-lights">
      {LIGHTS.map(({ key, colour, label }) => {
        const { fill, ink } = LightColours[colour];
        const count = counts[key];
        return (
          <View key={key} style={styles.light}>
            <View
              testID={`concern-light-${colour}`}
              style={[styles.circle, { backgroundColor: fill }, count === 0 && styles.dim]}>
              <ThemedText type="smallBold" style={[styles.count, { color: ink }]}>
                {count}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {label}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const SIZE = 28;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
    rowGap: Spacing.two,
    marginTop: Spacing.two,
  },
  light: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  circle: {
    minWidth: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    opacity: 0.35,
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
});
