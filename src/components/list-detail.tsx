/**
 * A list with the chosen item open beside it, on a window wide enough for
 * both: an iPad on its side, or the biggest iPad upright (SPLIT_MIN_WIDTH).
 * On anything narrower the list is all there is, and tapping an item opens
 * its own screen on top, as on a phone.
 *
 * The item beside the list is the item's own screen (the same component the
 * route shows), told which item to show through `useScreenParams` instead of
 * the address. So it shows exactly what its screen shows, to the same
 * people. A list only puts a screen beside it that the same guard in
 * src/app/_layout.tsx opens, and nothing opens there until it is tapped:
 * opening some items is recorded, and a tablet at the court shouldn't show
 * one nobody asked for.
 */
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { COLUMNS_MIN_WIDTH, ShareOfWindow } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

/** Window width from which a list and its chosen item sit side by side. */
export const SPLIT_MIN_WIDTH = COLUMNS_MIN_WIDTH;

/** How wide the list is when an item sits beside it. */
export const LIST_WIDTH = 380;

type Params = Record<string, string | undefined>;

type PaneValue = {
  params: Params;
  /** The item is finished with (saved and done, deleted, archived): close it and reload the list. */
  leave: () => void;
  /** The item changed and stays open: reload the list. */
  changed: () => void;
  setTitle: (title: string) => void;
};

const Pane = createContext<PaneValue | null>(null);

/**
 * True when lists open their items beside them. A list that is itself beside
 * another list has no room to, and opens its items on their own screens.
 */
export function useSplitLayout() {
  const shares = use(ShareOfWindow) !== null;
  const { width } = useWindowDimensions();
  return !shares && width >= SPLIT_MIN_WIDTH;
}

/** True for a screen shown beside its list. */
export function useBesideList() {
  return use(Pane) !== null;
}

/**
 * What a screen was asked to show: the address's parameters, or, beside a
 * list, the item chosen there.
 */
export function useScreenParams<T extends Params>(): T {
  const pane = use(Pane);
  const route = useLocalSearchParams();
  return (pane ? pane.params : route) as T;
}

/**
 * Leaves a screen that is finished with: back to where the member came from
 * (or to `fallback` when the screen was opened from a link, with nothing to
 * go back to). Beside a list it closes the item and the list reloads.
 */
export function useLeaveScreen(fallback?: Href) {
  const pane = use(Pane);
  return useCallback(() => {
    if (pane) pane.leave();
    else if (!fallback || router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [pane, fallback]);
}

/**
 * Tells the list beside a screen that the item changed, so the list shows
 * it. On a screen of its own it does nothing: the list reloads when the
 * member goes back to it.
 */
export function useListChanged() {
  const pane = use(Pane);
  return useCallback(() => pane?.changed(), [pane]);
}

/** A screen's title: in the bar at the top, or above the item beside a list. */
export function ScreenTitle({ title }: { title: string }) {
  const pane = use(Pane);
  useEffect(() => {
    pane?.setTitle(title);
  }, [pane, title]);
  return pane ? null : <Stack.Screen options={{ title }} />;
}

/**
 * The state a list keeps for the item beside it. `open` shows an item beside
 * the list on a wide window, and otherwise opens its own screen with `push`.
 */
export function useListDetail<P extends Params>(push: (params: P) => void) {
  const split = useSplitLayout();
  const [chosen, setChosen] = useState<P | null>(null);
  const open = (params: P) => {
    if (split) setChosen(params);
    else push(params);
  };
  const close = useCallback(() => setChosen(null), []);
  return { split, chosen: split ? chosen : null, open, close };
}

/**
 * Lays a list out with the chosen item beside it. `children` is the list's
 * own screen; on a narrow window it is returned as it is.
 */
export function ListDetail({
  children,
  chosen,
  detail,
  title,
  hint,
  onLeave,
  onChanged,
  tab = false,
}: {
  children: ReactNode;
  /** The chosen item's parameters, as its screen's address would carry them. */
  chosen: Params | null;
  /** The item's screen, such as `<ConcernScreen />`. */
  detail: ReactNode;
  /** What the item is called until its screen names it, such as "Concern". */
  title: string;
  /** Said beside the list while nothing is chosen. */
  hint: string;
  /** The item was finished with: forget it and reload the list. */
  onLeave: () => void;
  /** The item changed and stays open: reload the list. */
  onChanged: () => void;
  /** Set on a list inside the tab bar, which has no bar of its own keeping clear of the top. */
  tab?: boolean;
}) {
  const split = useSplitLayout();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  if (!split) return <>{children}</>;
  return (
    <View style={[styles.split, { backgroundColor: theme.background }]} testID="list-detail">
      <View style={styles.list} testID="list-pane">
        <ShareOfWindow value={LIST_WIDTH}>{children}</ShareOfWindow>
      </View>
      <SafeAreaView
        edges={tab ? ['top'] : []}
        style={[styles.detail, { borderLeftColor: theme.backgroundElement }]}
        testID="detail-pane">
        {chosen ? (
          // A different item starts its screen afresh.
          <ChosenItem
            key={JSON.stringify(chosen)}
            params={chosen}
            title={title}
            onLeave={onLeave}
            onChanged={onChanged}>
            <ShareOfWindow value={width - LIST_WIDTH}>{detail}</ShareOfWindow>
          </ChosenItem>
        ) : (
          <View style={styles.hint}>
            <ThemedText themeColor="textSecondary" style={styles.hintText}>
              {hint}
            </ThemedText>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function ChosenItem({
  params,
  title: fallbackTitle,
  onLeave,
  onChanged,
  children,
}: {
  params: Params;
  title: string;
  onLeave: () => void;
  onChanged: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [title, setTitle] = useState(fallbackTitle);
  // The list hands over new functions each time it draws. The item's screen
  // keeps the same ones, so a screen that reloads when they change (a message
  // marks itself read, which reloads the list) doesn't go round in circles.
  const latest = useRef({ onLeave, onChanged });
  useEffect(() => {
    latest.current = { onLeave, onChanged };
  });
  const value = useMemo(
    () => ({
      params,
      leave: () => latest.current.onLeave(),
      changed: () => latest.current.onChanged(),
      setTitle,
    }),
    [params],
  );
  return (
    <Pane value={value}>
      <View style={[styles.bar, { borderBottomColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" accessibilityRole="header" numberOfLines={1} style={styles.grow}>
          {title}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          hitSlop={8}
          onPress={onLeave}
          style={styles.close}>
          <Icon name="x" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.grow}>{children}</View>
    </Pane>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: 'row',
  },
  list: {
    width: LIST_WIDTH,
  },
  detail: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grow: {
    flex: 1,
  },
  close: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
  },
  hintText: {
    textAlign: 'center',
  },
});
