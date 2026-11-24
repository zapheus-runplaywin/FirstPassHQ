import { type ReactNode, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { SWIPE_ACTION_WIDTH, swipeStaysOpen } from '@/lib/chat-groups';

/**
 * Swipe left on a row to show one action behind it, as in a messaging app,
 * then tap it. Swiping back, or tapping the action, closes the row. Screen
 * readers get the same action from the row's actions menu.
 */
export function SwipeAction({
  label,
  onAction,
  children,
}: {
  /** The action, such as "Hide". */
  label: string;
  onAction: () => void;
  /**
   * The row. `swiped()` says whether it was just dragged, so a tap handler in
   * it can ignore the release of a swipe (the web reports that as a click).
   */
  children: (swiped: () => boolean) => ReactNode;
}) {
  const theme = useTheme();
  const [x] = useState(() => new Animated.Value(0));
  // Whether the action can be tapped: only while the row is swiped open.
  const [shown, setShown] = useState(false);

  const [{ responder, settle, swiped }] = useState(() => {
    // Whether the row is swiped open, kept across drags.
    const open = { current: false };
    // Whether the row was dragged, until just after it's let go.
    const moved = { current: false };
    const letGo = () => setTimeout(() => (moved.current = false), 300);
    const settleTo = (toOpen: boolean) => {
      open.current = toOpen;
      setShown(toOpen);
      Animated.spring(x, {
        toValue: toOpen ? -SWIPE_ACTION_WIDTH : 0,
        useNativeDriver: false,
        bounciness: 0,
      }).start();
    };
    const from = () => (open.current ? -SWIPE_ACTION_WIDTH : 0);
    return {
      swiped: () => moved.current,
      settle: settleTo,
      responder: PanResponder.create({
        // Only a sideways drag swipes; an up-and-down one scrolls the list.
        // Taken in the capture phase, so the post under the finger isn't
        // opened as well, as a tap would.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          moved.current = true;
        },
        onPanResponderMove: (_e, g) => {
          x.setValue(Math.max(-SWIPE_ACTION_WIDTH * 1.5, Math.min(0, from() + g.dx)));
        },
        onPanResponderRelease: (_e, g) => {
          settleTo(swipeStaysOpen(from() + g.dx, g.vx));
          letGo();
        },
        onPanResponderTerminate: () => {
          settleTo(open.current);
          letGo();
        },
      }),
    };
  });
  // The action shows only as the row slides away from it.
  const actionOpacity = x.interpolate({
    inputRange: [-SWIPE_ACTION_WIDTH, -12, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });

  function act() {
    settle(false);
    onAction();
  }

  return (
    <View
      style={styles.wrap}
      accessibilityActions={[{ name: 'swipeAction', label }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'swipeAction') act();
      }}>
      <Animated.View
        pointerEvents={shown ? 'box-none' : 'none'}
        style={[styles.behind, { opacity: actionOpacity }]}>
        <Pressable
          accessibilityRole="button"
          onPress={act}
          style={[styles.action, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {label}
          </ThemedText>
        </Pressable>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children(swiped)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  behind: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  action: {
    width: SWIPE_ACTION_WIDTH - 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
