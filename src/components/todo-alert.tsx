import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { TodoAlert } from '@/lib/todos';

/**
 * Fixed red and amber, whatever the club's colours, so a warning looks the
 * same in every club. Each pair passes WCAG AA as label text.
 */
const AlertColours = {
  red: { fill: '#C62828', ink: '#FFFFFF' },
  amber: { fill: '#F2B705', ink: '#000000' },
} as const;

type AlertProps = { alert: TodoAlert | null | undefined };

/**
 * A drawn warning before the title: a red circle with a white ! or an amber
 * triangle with a black !.
 */
export function AlertIcon({ alert }: AlertProps) {
  if (!alert) return null;
  const { fill, ink } = AlertColours[alert.level];
  return (
    <View accessible accessibilityLabel={alert.label} style={styles.icon}>
      {alert.level === 'red' ? (
        <View style={[styles.circle, { backgroundColor: fill }]} />
      ) : (
        <View style={[styles.triangle, { borderBottomColor: fill }]} />
      )}
      <ThemedText style={[styles.bang, alert.level === 'amber' && styles.bangInTriangle, { color: ink }]}>
        !
      </ThemedText>
    </View>
  );
}

/** A red or amber label such as "Overdue" or "Due soon". */
export function AlertBadge({ alert }: AlertProps) {
  if (!alert) return null;
  const { fill, ink } = AlertColours[alert.level];
  return (
    <View style={[styles.badge, { backgroundColor: fill }]}>
      <ThemedText type="smallBold" style={[styles.badgeText, { color: ink }]}>
        {alert.label}
      </ThemedText>
    </View>
  );
}

/** A red or amber bar down the left edge of the row. */
export function AlertEdge({ alert }: AlertProps) {
  if (!alert) return null;
  return <View style={[styles.edge, { backgroundColor: AlertColours[alert.level].fill }]} />;
}

const ICON = 20;

const styles = StyleSheet.create({
  icon: {
    width: ICON,
    height: ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
    width: ICON,
    height: ICON,
    borderRadius: ICON / 2,
  },
  // A triangle drawn from borders, so no image or icon library is needed.
  triangle: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 19,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  bang: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  bangInTriangle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  edge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
});
