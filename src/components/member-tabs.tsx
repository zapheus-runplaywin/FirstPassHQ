/**
 * The parts of a member's page for admins that make it a page in tabs
 * (src/app/admin/[id].tsx): the bar that stays at the top (who they are, a
 * line when their roles are paused, and the tabs), a tab's content, and the
 * "Needs attention" list that leads Overview.
 *
 * Every tab's content stays on the page while another tab shows, so what an
 * admin has typed on one tab is still there when they come back, and Save
 * saves all of it.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { FocusOffset } from '@/components/focus-anchor';
import { StatusLine } from '@/components/home/feature-card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { memberTabLabels, type MemberAttention, type MemberTab } from '@/lib/member-tabs';

/** Stays at the top of the page while a tab scrolls under it. */
export function MemberHeader({
  lead,
  notice,
  onNotice,
  tabs,
  tab,
  onTab,
}: {
  /** Who they are in one line (`memberLead`). */
  lead: string;
  /** Their roles are paused (`pausedNotice`): said on every tab. */
  notice: string | null;
  /** Opens the tab where a stand-down or a check is sorted out, when the member has it. */
  onNotice?: () => void;
  tabs: MemberTab[];
  tab: MemberTab;
  onTab: (tab: MemberTab) => void;
}) {
  return (
    <View style={styles.header} testID="member-header">
      <ThemedText type="smallBold" numberOfLines={2} testID="member-lead">
        {lead}
      </ThemedText>
      {notice ? (
        onNotice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${notice} Opens the Checks tab`}
            onPress={onNotice}
            testID="member-paused">
            <StatusLine text={notice} tone="attention" />
          </Pressable>
        ) : (
          <View testID="member-paused">
            <StatusLine text={notice} tone="attention" />
          </View>
        )
      ) : null}
      <TabBar tabs={tabs} tab={tab} onTab={onTab} />
    </View>
  );
}

/** Under this width (the narrowest phones) five tabs only fit with smaller words and less room. */
const TIGHT_UNDER = 350;

/**
 * The tabs, sharing the width of a phone between them so all five show at
 * once, drawn tighter on the narrowest phones. At large text sizes, where
 * they can't all show, the line scrolls sideways.
 */
function TabBar({
  tabs,
  tab,
  onTab,
}: {
  tabs: MemberTab[];
  tab: MemberTab;
  onTab: (tab: MemberTab) => void;
}) {
  const theme = useTheme();
  const tight = useWindowDimensions().width < TIGHT_UNDER;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={[styles.tabs, tight && styles.tightTabs]}>
      {tabs.map((value) => {
        const selected = value === tab;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            // The web reads the chosen tab from this, not from accessibilityState.
            aria-selected={selected}
            onPress={() => onTab(value)}
            style={[
              styles.tab,
              tight && styles.tightTab,
              { backgroundColor: selected ? theme.accent : theme.backgroundElement },
            ]}>
            <ThemedText
              type="small"
              numberOfLines={1}
              style={[styles.tabText, tight && styles.tightTabText, selected && { color: theme.onAccent }]}>
              {memberTabLabels[value]}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * One tab's content. It stays on the page, out of sight and out of a screen
 * reader's reach, while another tab shows, so nothing typed in it is lost.
 */
export function MemberPane({
  tab,
  current,
  part = 'main',
  children,
}: {
  tab: MemberTab;
  /** The tab showing now. */
  current: MemberTab;
  /** Overview has a second block after the page's Save button. */
  part?: 'main' | 'end';
  children: ReactNode;
}) {
  // Where it starts on the screen, for a to-do's anchor inside it.
  const [y, setY] = useState(0);
  return (
    <View
      testID={part === 'main' ? `member-pane-${tab}` : `member-pane-${tab}-${part}`}
      style={[styles.pane, tab !== current && styles.hidden]}
      onLayout={(event) => setY(event.nativeEvent.layout.y)}>
      <FocusOffset y={y}>{children}</FocusOffset>
    </View>
  );
}

/**
 * Background reading on a tab, folded to one line so what an admin fills in
 * comes first. It stays on the page while folded, like a tab that isn't
 * showing.
 */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.fold}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((o) => !o)}
        style={styles.foldTitle}>
        <ThemedText type="small" style={[styles.grow, { color: theme.tint }]}>
          {title}
        </ThemedText>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} color={theme.tint} />
      </Pressable>
      <View style={[styles.foldBody, !open && styles.hidden]}>{children}</View>
    </View>
  );
}

/**
 * What needs an admin's attention about this member, each line opening the
 * tab where it is sorted out, or one line saying nothing does.
 */
export function NeedsAttention({
  items,
  tabs,
  onOpen,
}: {
  items: MemberAttention[];
  /** The tabs this member has: a line only opens one of them. */
  tabs: MemberTab[];
  onOpen: (tab: MemberTab) => void;
}) {
  const theme = useTheme();
  if (items.length === 0) {
    return (
      <Card testID="needs-attention">
        <StatusLine text="Nothing needs attention" tone="done" />
      </Card>
    );
  }
  return (
    <Card testID="needs-attention">
      <ThemedText type="smallBold" accessibilityRole="header">
        Needs attention
      </ThemedText>
      {items.map((item) =>
        tabs.includes(item.tab) ? (
          <Pressable
            key={item.text}
            accessibilityRole="button"
            accessibilityLabel={`${item.text}. Opens the ${memberTabLabels[item.tab]} tab`}
            onPress={() => onOpen(item.tab)}
            style={styles.row}>
            <View style={styles.grow}>
              <StatusLine text={item.text} tone="attention" />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {memberTabLabels[item.tab]}
            </ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : (
          <StatusLine key={item.text} text={item.text} tone="attention" />
        ),
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
  },
  tabs: {
    flexGrow: 1,
    flexDirection: 'row',
    gap: Spacing.one,
  },
  tab: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  tabText: {
    fontSize: 13,
  },
  tightTabs: {
    gap: 2,
  },
  tightTab: {
    paddingHorizontal: 3,
  },
  tightTabText: {
    fontSize: 12,
  },
  fold: {
    gap: Spacing.two,
  },
  foldTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 32,
  },
  foldBody: {
    gap: Spacing.two,
  },
  // The same space between a tab's parts as between a screen's.
  pane: {
    gap: Spacing.four,
  },
  hidden: {
    display: 'none',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
    minHeight: 32,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
});
