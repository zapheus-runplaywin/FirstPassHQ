import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useEffect } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { useClub } from '@/lib/club';

/** Matches `imageWidth` for the splash screen in app.json, so the hand-off is seamless. */
export const LOGO_SIZE = 240;

/**
 * Plays over the app when it opens: the logo from the splash screen pulses,
 * then zooms and fades away to reveal the first screen.
 */
export function BrandIntro({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const club = useClub();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    const finish = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDone);
    };
    if (reduceMotion) {
      opacity.value = withDelay(400, withTiming(0, { duration: 250 }, finish));
      return;
    }
    scale.value = withSequence(
      withTiming(0.92, { duration: 180, easing: Easing.out(Easing.quad) }),
      withSpring(1.06, {
        damping: 6,
        stiffness: 180,
        reduceMotion: ReduceMotion.Never,
      }),
      withDelay(250, withTiming(1.35, { duration: 380, easing: Easing.in(Easing.cubic) })),
    );
    opacity.value = withDelay(
      950,
      withTiming(0, { duration: 330, easing: Easing.in(Easing.quad) }, finish),
    );
  }, [onDone, opacity, reduceMotion, scale]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, { backgroundColor: theme.background }, overlayStyle]}
    >
      <Animated.View style={logoStyle}>
        <Image
          source={club.logo}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel={club.name}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
