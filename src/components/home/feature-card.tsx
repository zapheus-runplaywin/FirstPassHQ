import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useInCardGrid } from '@/components/columns';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A count in the club's hero colour, such as new messages or votes waiting. */
export function CountBadge({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
      <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
        {count}
      </ThemedText>
    </View>
  );
}

/** The rounded square an icon sits in at the start of a row. */
export function IconSquare({ name }: { name: IconName }) {
  const theme = useTheme();
  return (
    <View style={[styles.square, { backgroundColor: theme.backgroundSelected }]}>
      <Icon name={name} size={18} color={theme.tint} />
    </View>
  );
}

/**
 * One feature in a hub or in Me: an icon, its name, a line saying where it's
 * up to, a count when something is waiting, and the whole row opens it.
 */
export function FeatureCard({
  icon,
  title,
  detail,
  detailColor = 'textSecondary',
  badge = 0,
  onPress,
  children,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  detailColor?: 'textSecondary' | 'tint';
  badge?: number;
  onPress: () => void;
  /** More under the detail line, such as the concern traffic lights. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  // In a CardGrid row, every card is as tall as the tallest.
  const inGrid = useInCardGrid();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        inGrid && styles.fill,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <IconSquare name={icon} />
      <View style={styles.text}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor={detailColor}>
            {detail}
          </ThemedText>
        ) : null}
        {children}
      </View>
      <CountBadge count={badge} />
      <Icon name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
  },
  fill: {
    flexGrow: 1,
  },
  square: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
