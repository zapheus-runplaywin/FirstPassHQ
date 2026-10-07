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
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

/** Space left above a focused field when it is scrolled into view. */
const FOCUS_MARGIN = 96;

const RevealFocusedInput = createContext<() => void>(() => {});

/** Scrolls the screen so the field being typed in sits above the keyboard. */
export function useRevealFocusedInput() {
  return use(RevealFocusedInput);
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  withTopInset = false,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Set on screens without a navigation header. */
  withTopInset?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
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
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      if (Platform.OS === 'android') setAndroidKeyboardHeight(event.endCoordinates.height);
      // Wait a frame for the extra room to be laid out.
      requestAnimationFrame(revealFocusedInput);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [revealFocusedInput]);

  return (
    <RevealFocusedInput value={revealFocusedInput}>
      <ThemedView style={styles.container}>
        <SafeAreaView
          style={styles.safeArea}
          edges={withTopInset ? undefined : ['bottom', 'left', 'right']}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.content,
              androidKeyboardHeight > 0 && { paddingBottom: androidKeyboardHeight + Spacing.four },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
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
    gap: Spacing.four,
  },
});
