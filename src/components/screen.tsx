import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppVersion } from '@/components/app-version';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, MaxWideContentWidth, Spacing } from '@/constants/theme';

/** A tab screen's safe edges: the tab bar looks after the bottom. */
const TAB_EDGES = ['top', 'left', 'right'] as const;

/** Space left above a focused field when it is scrolled into view. */
const FOCUS_MARGIN = 96;

const RevealFocusedInput = createContext<() => void>(() => {});
const ScrollToY = createContext<(y: number) => void>(() => {});

/** Scrolls the screen so the field being typed in sits above the keyboard. */
export function useRevealFocusedInput() {
  return use(RevealFocusedInput);
}

/** Scrolls the screen to a position within its content. */
export function useScrollToY() {
  return use(ScrollToY);
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  withTopInset = false,
  gap = Spacing.four,
  stickyHeaderIndices,
  showVersion = false,
  wide = false,
  tab = false,
  header,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Set on screens without a navigation header. */
  withTopInset?: boolean;
  /** Space between the screen's children. */
  gap?: number;
  /** Children (by position) that stay pinned to the top while scrolling past them. */
  stickyHeaderIndices?: number[];
  /** Shows the app's version and build in small print at the foot (src/components/app-version.tsx). */
  showVersion?: boolean;
  /**
   * Lets the screen use a tablet's width, for screens laid out with Columns or
   * CardGrid (src/components/columns.tsx). Other screens stay MaxContentWidth.
   */
  wide?: boolean;
  /**
   * Set on the screens inside the tab bar (src/app/(tabs)). They have no
   * navigation header, so they keep clear of the status bar themselves; the
   * tab bar already keeps clear of the bottom of the phone; and the version,
   * where one shows, goes to the end of what scrolls, so it doesn't sit on top
   * of the tab bar.
   */
  tab?: boolean;
  /** Stays at the top while the rest scrolls, such as a tab's title bar. */
  header?: ReactNode;
}) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Screens stay mounted underneath the one on top, and keyboard events reach
  // every one of them. Only the screen being looked at reacts, or a hidden
  // screen can be scrolled out of place by typing on another one.
  const isFocused = useIsFocused();
  // Where the screen is scrolled to and how much there is to scroll, so a
  // screen left scrolled past the end of its content can be put right.
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const dragging = useRef(false);
  // Room under the content for the keyboard to cover. This is added as padding
  // on both platforms rather than letting iOS adjust the scroll insets itself:
  // those insets are native state that could be left behind when a screen lost
  // focus with the keyboard up, so content could be scrolled away into empty
  // space. Padding is part of the layout, so it always comes off again.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const revealFocusedInput = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    const content = scrollRef.current?.getInnerViewRef();
    if (!input || !content) return;
    input.measureLayout(content, (_x, y) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - FOCUS_MARGIN), animated: true });
    });
  }, []);

  // When the content is shorter than where the screen is scrolled to (it shrank,
  // or the keyboard room came off), iOS leaves the screen showing empty space.
  // Scroll back so the end of the content is in view.
  const keepContentInView = useCallback(() => {
    if (dragging.current) return;
    const maxY = Math.max(0, contentHeight.current - viewportHeight.current);
    if (scrollY.current > maxY + 1) {
      scrollY.current = maxY;
      scrollRef.current?.scrollTo({ y: maxY, animated: false });
    }
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    // iOS announces the keyboard before it moves, so the room is ready as it
    // slides up. Android only says once it is up.
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      // Wait a frame for the extra room to be laid out.
      requestAnimationFrame(revealFocusedInput);
    });
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboardHeight(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
      setKeyboardHeight(0);
    };
  }, [isFocused, revealFocusedInput]);

  // Coming back to a screen that shrank while away puts its content back in view.
  useFocusEffect(keepContentInView);

  const scrollToY = useCallback(
    (y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true }),
    [],
  );

  return (
    <ScrollToY value={scrollToY}>
      <RevealFocusedInput value={revealFocusedInput}>
        <ThemedView style={styles.container}>
          <SafeAreaView
            style={[styles.safeArea, wide && styles.wide]}
            edges={tab ? TAB_EDGES : withTopInset ? undefined : ['bottom', 'left', 'right']}>
            {header ? <View style={styles.header}>{header}</View> : null}
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={[
                styles.content,
                { gap },
                keyboardHeight > 0 && { paddingBottom: keyboardHeight + Spacing.four },
              ]}
              stickyHeaderIndices={stickyHeaderIndices}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              scrollEventThrottle={16}
              onScroll={(event) => {
                scrollY.current = event.nativeEvent.contentOffset.y;
              }}
              onScrollBeginDrag={() => {
                dragging.current = true;
              }}
              onScrollEndDrag={() => {
                dragging.current = false;
              }}
              onMomentumScrollEnd={keepContentInView}
              onContentSizeChange={(_width, height) => {
                contentHeight.current = height;
                keepContentInView();
              }}
              onLayout={(event) => {
                viewportHeight.current = event.nativeEvent.layout.height;
                keepContentInView();
              }}
              refreshControl={
                onRefresh ? (
                  <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} />
                ) : undefined
              }>
              {children}
              {tab && showVersion ? <AppVersion /> : null}
            </ScrollView>
            {/*
              No FirstPass logo inside the app: the app icon and the opening
              screen carry the brand (Matt, 26 November 2026). The version
              stays at the foot of the few screens that show it, and steps
              aside for the keyboard.
            */}
            {showVersion && !tab && keyboardHeight === 0 ? (
              <View style={styles.version}>
                <AppVersion />
              </View>
            ) : null}
          </SafeAreaView>
        </ThemedView>
      </RevealFocusedInput>
    </ScrollToY>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  wide: {
    maxWidth: MaxWideContentWidth,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  content: {
    padding: Spacing.four,
  },
  version: {
    paddingVertical: Spacing.two,
  },
});
