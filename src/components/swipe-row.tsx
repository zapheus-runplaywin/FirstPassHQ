import { useMemo, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { swipeArchives } from '@/lib/inbox';

/**
 * A row that does one thing when swiped to the left, such as "Archive". The
 * action shows behind the row as it slides. Nothing depends on swiping: the
 * row's card should offer the same action to screen readers (PressableCard's
 * `actions`), and the open message offers it as a button.
 *
 * Built on React Native's own PanResponder, so it needs no gesture root and
 * works the same on iPhone, Android and the web.
 */
export function SwipeRow({
  actionLabel,
  onSwipe,
  children,
}: {
  actionLabel: string;
  onSwipe: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [x] = useState(() => new Animated.Value(0));
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Only a clearly sideways drag to the left takes over, so scrolling and
        // tapping the row work as before.
        onMoveShouldSetPanResponder: (_e, g) => g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderMove: (_e, g) => x.setValue(Math.min(0, g.dx)),
        onPanResponderRelease: (_e, g) => {
          if (swipeArchives(g.dx)) {
            Animated.timing(x, {
              toValue: -600,
              duration: 150,
              useNativeDriver: false,
            }).start(() => {
              onSwipe();
              x.setValue(0);
            });
          } else {
            Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
        },
      }),
    [onSwipe, x],
  );

  return (
    <View style={styles.wrap}>
      <View
        style={[styles.behind, { backgroundColor: theme.accent }]}
        importantForAccessibility="no-hide-descendants">
        <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
          {actionLabel}
        </ThemedText>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  behind: {
    ...StyleSheet.absoluteFill,
    borderRadius: 12,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
});
