import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HUB_TITLES, type HubName } from '@/lib/home-layout';

/**
 * Raise a concern, at the top of every tab: a shield and the words, so a
 * child never has to hunt for it or guess what an icon means.
 */
export function ConcernButton() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Tell the club safely about a worry"
      hitSlop={8}
      onPress={() => router.push('/concern/new')}
      style={({ pressed }) => [
        styles.concern,
        { borderColor: theme.backgroundSelected },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <Icon name="shield" size={16} color={theme.tint} />
      <ThemedText type="smallBold" style={styles.concernText}>
        Raise a concern
      </ThemedText>
    </Pressable>
  );
}

/**
 * The bar at the top of a tab: its name (or whatever `children` puts there
 * instead) on the left, Raise a concern on the right.
 */
export function TabHeader({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        {title ? (
          <ThemedText style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </ThemedText>
        ) : null}
        {children}
      </View>
      <ConcernButton />
    </View>
  );
}

/**
 * Team · Family · Club, for someone with more than one hub: a coach who is
 * also a parent, or an admin who coaches. One hub shows no switch.
 */
export function HubSwitch({ hubs, current }: { hubs: HubName[]; current: HubName }) {
  const theme = useTheme();
  if (hubs.length < 2) return null;
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.switch, { backgroundColor: theme.backgroundElement }]}>
      {hubs.map((hub) => {
        const selected = hub === current;
        return (
          <Pressable
            key={hub}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) router.navigate(`/${hub}`);
            }}
            style={[styles.segment, selected && { backgroundColor: theme.accent }]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.onAccent : theme.textSecondary }}>
              {HUB_TITLES[hub]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small heading over a group of rows, such as "Safety" in Me. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <ThemedText
      type="smallBold"
      themeColor="textSecondary"
      accessibilityRole="header"
      style={styles.sectionTitle}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 40,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minWidth: 0,
  },
  title: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 26,
    lineHeight: 32,
    flexShrink: 1,
  },
  concern: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    height: 36,
  },
  concernText: {
    fontSize: 13,
    lineHeight: 18,
  },
  switch: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
