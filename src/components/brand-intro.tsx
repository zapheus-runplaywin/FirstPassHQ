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

import { FirstPass } from '@/constants/club';
import { useClub } from '@/lib/club';

/** Matches `imageWidth` for the splash screen in app.json, so the hand-off is seamless. */
export const LOGO_SIZE = 360;
const CLUB_LOGO_SIZE = 120;

/**
 * Plays over the app when it opens, on the splash screen's FirstPass navy:
 * the FirstPass logo from the splash screen pulses, the club's own logo
 * (once an admin has uploaded one) appears beneath it, then both zoom and
 * fade away to reveal the first screen.
 */
export function BrandIntro({ onDone }: { onDone: () => void }) {
  const club = useClub();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const clubOpacity = useSharedValue(0);
  /** Extra time on screen so the club's logo can be seen. */
  const hold = club.hasLogo ? 500 : 0;

  useEffect(() => {
    const finish = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDone);
    };
    if (reduceMotion) {
      clubOpacity.value = 1;
      opacity.value = withDelay(400 + hold, withTiming(0, { duration: 250 }, finish));
      return;
    }
    clubOpacity.value = withDelay(150, withTiming(1, { duration: 300 }));
    scale.value = withSequence(
      withTiming(0.92, { duration: 180, easing: Easing.out(Easing.quad) }),
      withSpring(1.06, {
        damping: 6,
        stiffness: 180,
        reduceMotion: ReduceMotion.Never,
      }),
      withDelay(250 + hold, withTiming(1.35, { duration: 380, easing: Easing.in(Easing.cubic) })),
    );
    opacity.value = withDelay(
      950 + hold,
      withTiming(0, { duration: 330, easing: Easing.in(Easing.quad) }, finish),
    );
  }, [clubOpacity, hold, onDone, opacity, reduceMotion, scale]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const clubStyle = useAnimatedStyle(() => ({ opacity: clubOpacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, { backgroundColor: FirstPass.navy }, overlayStyle]}
    >
      <Animated.View style={[styles.logo, logoStyle]}>
        <Image
          source={FirstPass.splash}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel={FirstPass.name}
        />
        {club.hasLogo ? (
          <Animated.View style={[styles.clubLogo, clubStyle]}>
            <Image
              source={club.logo}
              style={styles.clubLogoImage}
              contentFit="contain"
              accessibilityLabel={club.name}
            />
          </Animated.View>
        ) : null}
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
  /** Below the FirstPass logo, which fills the middle of its square, so it stays where the splash put it. */
  clubLogo: {
    position: 'absolute',
    top: LOGO_SIZE * 0.72,
    alignSelf: 'center',
  },
  clubLogoImage: {
    width: CLUB_LOGO_SIZE,
    height: CLUB_LOGO_SIZE,
  },
});
