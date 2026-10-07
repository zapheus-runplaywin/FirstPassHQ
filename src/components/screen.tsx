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
} from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

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
}) {
  const scrollRef = useRef<ScrollView>(null);
  // Screens stay mounted underneath the one on top, and keyboard events reach
  // every one of them. Only the screen being looked at reacts, or a hidden
  // screen can be scrolled out of place by typing on another one.
  const isFocused = useIsFocused();
  // Where the screen is scrolled to and how much there is to scroll, so a
  // screen that comes back scrolled past its content can be put right.
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  // Android draws behind the keyboard (edge to edge), so the content needs room
  // to scroll above it. iOS adjusts the scroll insets itself.
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const revealFocusedInput = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    // getInnerViewRef is missing from React Native's legacy type definitions.
    const content = (
      scrollRef.current as unknown as {
        getInnerViewRef(): Parameters<TextInput['measureLayout']>[0];
      } | null
    )?.getInnerViewRef();
    if (!input || !content) return;
    input.measureLayout(content, (_x, y) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - FOCUS_MARGIN), animated: true });
    });
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      if (Platform.OS === 'android') setAndroidKeyboardHeight(event.endCoordinates.height);
      // Wait a frame for the extra room to be laid out.
      requestAnimationFrame(revealFocusedInput);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
      setAndroidKeyboardHeight(0);
    };
  }, [isFocused, revealFocusedInput]);

  // Coming back to a screen that is scrolled past the end of its content
  // (it shrank while away) scrolls it back to the end.
  useFocusEffect(
    useCallback(() => {
      const maxY = Math.max(0, contentHeight.current - viewportHeight.current);
      if (scrollY.current > maxY) scrollRef.current?.scrollTo({ y: maxY, animated: false });
    }, []),
  );

  const scrollToY = useCallback(
    (y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true }),
    [],
  );

  return (
    <ScrollToY value={scrollToY}>
      <RevealFocusedInput value={revealFocusedInput}>
        <ThemedView style={styles.container}>
          <SafeAreaView
            style={styles.safeArea}
            edges={withTopInset ? undefined : ['bottom', 'left', 'right']}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={[
                styles.content,
                { gap },
                androidKeyboardHeight > 0 && {
                  paddingBottom: androidKeyboardHeight + Spacing.four,
                },
              ]}
              stickyHeaderIndices={stickyHeaderIndices}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets={isFocused}
              scrollEventThrottle={100}
              onScroll={(event) => {
                scrollY.current = event.nativeEvent.contentOffset.y;
              }}
              onContentSizeChange={(_width, height) => {
                contentHeight.current = height;
              }}
              onLayout={(event) => {
                viewportHeight.current = event.nativeEvent.layout.height;
              }}
              refreshControl={
                onRefresh ? (
                  <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} />
                ) : undefined
              }>
              {children}
            </ScrollView>
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
  content: {
    padding: Spacing.four,
  },
});
