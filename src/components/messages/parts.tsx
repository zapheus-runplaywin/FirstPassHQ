import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { initials, readShare } from '@/lib/message-list';

/**
 * The pieces the Messages screens share: the circle beside each sender, the
 * Inbox / Sent / Archived / Groups bar, the search box, the quick filters,
 * the "nothing here" panel, the read bar and the New message button.
 */

/**
 * The circle at the start of a message: the sender's initials, or an icon for
 * a group or the club. Letters and icons only. Members have no pictures, and
 * tapping it does nothing: there are no profiles to open (AGENTS.md, "No
 * social media features for children"). Screen readers skip it; the name is
 * beside it.
 */
export function Monogram({
  name,
  icon,
  size = 40,
  onPage = false,
}: {
  name?: string | null;
  /** Shown instead of initials, for a group, a role or the whole club. */
  icon?: IconName;
  size?: number;
  /** Set when it sits on the page itself and not on a card, so it still shows as a circle. */
  onPage?: boolean;
}) {
  const theme = useTheme();
  const letters = icon ? '' : initials(name);
  return (
    <View
      testID="monogram"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[
        styles.monogram,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: onPage ? theme.backgroundElement : theme.background,
        },
      ]}>
      {letters ? (
        <ThemedText
          allowFontScaling={false}
          style={[styles.monogramText, { fontSize: size * 0.36, lineHeight: size * 0.5 }]}>
          {letters}
        </ThemedText>
      ) : (
        <Icon name={icon ?? 'shield'} size={size * 0.45} color={theme.text} />
      )}
    </View>
  );
}

/** A count in a small pill, such as unread posts beside a group. */
export function CountBadge({ count, label }: { count: number; label: string }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: theme.accent }]}>
      <ThemedText allowFontScaling={false} style={[styles.badgeText, { color: theme.onAccent }]}>
        {count > 99 ? '99+' : count}
      </ThemedText>
    </View>
  );
}

/**
 * Inbox, Sent, Archived and Groups as one bar across the top, each with its
 * unread count. They share the width when they fit and scroll sideways when
 * they don't (large text sizes), rather than wrapping.
 */
export function Segments<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string; count?: number }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: theme.backgroundElement }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segmentLine}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          const count = option.count ?? 0;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={count > 0 ? `${option.label}, ${count} unread` : option.label}
              onPress={() => onSelect(option.value)}
              style={[styles.segment, isSelected && { backgroundColor: theme.accent }]}>
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                style={{ color: isSelected ? theme.onAccent : theme.textSecondary }}>
                {option.label}
              </ThemedText>
              {count > 0 ? (
                <View
                  style={[
                    styles.segmentCount,
                    // On the chosen box the count is the page's own colours, so it
                    // stands out from the club colour behind it.
                    { backgroundColor: isSelected ? theme.background : theme.accent },
                  ]}>
                  <ThemedText
                    allowFontScaling={false}
                    style={[styles.badgeText, { color: isSelected ? theme.text : theme.onAccent }]}>
                    {count > 99 ? '99+' : count}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * The search box over a list. It is a search box to screen readers and
 * browsers, not a box to write a message in: nothing typed here is sent
 * anywhere.
 */
export function SearchField({
  value,
  onChangeText,
  label,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** What it searches, such as "Search messages". Also the placeholder. */
  label: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.search,
        // The whole box shows it is being typed in, not just the words inside it.
        { backgroundColor: theme.backgroundElement, borderColor: focused ? theme.text : 'transparent' },
      ]}>
      <Icon name="search" size={18} color={theme.textSecondary} />
      <TextInput
        role="searchbox"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.searchInput, { color: theme.text }]}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
          onPress={() => onChangeText('')}>
          <Icon name="x-circle" size={18} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A quick filter over a list, such as "2 unread". Tapping it again shows everything. */
export function FilterChip({
  label,
  selected,
  onPress,
  hint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  hint: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={hint}
      hitSlop={6}
      onPress={onPress}
      style={[
        styles.filter,
        { borderColor: selected ? theme.text : theme.backgroundSelected },
        selected && { backgroundColor: theme.backgroundSelected },
      ]}>
      <ThemedText type={selected ? 'smallBold' : 'small'} style={styles.filterText}>
        {label}
      </ThemedText>
      {selected ? <Icon name="x" size={12} color={theme.text} /> : null}
    </Pressable>
  );
}

/** A heading over part of a list, such as "Today". */
export function ListHeading({ children }: { children: string }) {
  return (
    <ThemedText
      type="smallBold"
      themeColor="textSecondary"
      accessibilityRole="header"
      style={styles.heading}>
      {children}
    </ThemedText>
  );
}

/**
 * What a list shows when there is nothing in it: an icon, what belongs here,
 * and how it gets here. `children` is for a button, when there is something
 * the member can do about it.
 */
export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon: IconName;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundElement }]}>
        <Icon name={icon} size={28} color={theme.textSecondary} />
      </View>
      <ThemedText style={styles.emptyTitle} accessibilityRole="header">
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        {text}
      </ThemedText>
      {children}
    </View>
  );
}

/**
 * How much of a sent message has been read, as a bar. Decoration: the words
 * beside it ("Read by 5 of 8") say the same.
 */
export function ReadBar({ read, of }: { read: number; of: number }) {
  const theme = useTheme();
  const share = readShare(read, of);
  return (
    <View
      testID="read-bar"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[styles.bar, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.barFill,
          {
            width: `${Math.round(share * 100)}%`,
            backgroundColor: share === 1 ? theme.positive : theme.textSecondary,
          },
        ]}
      />
    </View>
  );
}

/**
 * New message, floating over the foot of the list where a thumb reaches it,
 * as in a mail app. Goes in Screen's `floating`.
 */
export function ComposeButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.compose,
        { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
      ]}>
      <Icon name="edit-3" size={18} color={theme.onAccent} />
      <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

/** Room at the foot of a list for the floating button, so it never covers the last row. */
export const COMPOSE_BUTTON_ROOM = 72;

const styles = StyleSheet.create({
  monogram: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    fontFamily: BrandFonts.bold,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: BrandFonts.bold,
    fontSize: 12,
    lineHeight: 16,
  },
  segments: {
    borderRadius: 12,
    padding: 4,
  },
  segmentLine: {
    flexDirection: 'row',
    flexGrow: 1,
    gap: 4,
  },
  segment: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    borderRadius: 9,
    paddingHorizontal: 10,
  },
  segmentCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    height: 42,
    fontFamily: BrandFonts.regular,
    fontSize: 16,
    // In a browser the box's own border shows the focus, in place of the browser's ring.
    ...Platform.select({ web: { outlineStyle: 'none' } as object }),
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    height: 32,
  },
  filterText: {
    lineHeight: 18,
  },
  heading: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: Spacing.two,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.three,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  emptyTitle: {
    fontFamily: BrandFonts.bold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 320,
  },
  bar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
    // A soft shadow lifts it off the list on both platforms and the web.
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
});
