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
/** Height of the FirstPass HQ logo itself, which fills the middle 62% of the splash image's width. */
const FIRSTPASS_HEIGHT = Math.round((LOGO_SIZE * 0.62 * 66) / 401);
const GAP = 32;
/** How far the FirstPass logo rises so it and the club's logo sit centred together. */
const SHIFT = (GAP + CLUB_LOGO_SIZE) / 2;

/**
 * Plays over the app when it opens, on the splash screen's FirstPass navy:
 * the FirstPass logo from the splash screen pulses and, once an admin has
 * uploaded the club's own logo, rises to make room for it beneath, so the
 * pair sits centred on the screen. Then both zoom and
 * fade away to reveal the first screen.
 */
export function BrandIntro({ onDone }: { onDone: () => void }) {
  const club = useClub();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const clubOpacity = useSharedValue(0);
  const rise = useSharedValue(0);
  /** Extra time on screen so the club's logo can be seen. */
  const hold = club.hasLogo ? 1000 : 0;

  useEffect(() => {
    const finish = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDone);
    };
    const shift = club.hasLogo ? -SHIFT : 0;
    if (reduceMotion) {
      clubOpacity.value = 1;
      rise.value = shift;
      opacity.value = withDelay(400 + hold, withTiming(0, { duration: 250 }, finish));
      return;
    }
    // Centred first, as the splash left it; after the pulse it rises and the club's logo fades in.
    rise.value = withDelay(600, withTiming(shift, { duration: 450, easing: Easing.inOut(Easing.cubic) }));
    clubOpacity.value = withDelay(850, withTiming(1, { duration: 350 }));
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
  }, [club.hasLogo, clubOpacity, hold, onDone, opacity, reduceMotion, rise, scale]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: rise.value }, { scale: scale.value }],
  }));
  const clubStyle = useAnimatedStyle(() => ({ opacity: clubOpacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, { backgroundColor: FirstPass.navy }, overlayStyle]}
    >
      <Animated.View style={[styles.logo, club.hasLogo && styles.pairOrigin, logoStyle]}>
        <Image
          source={FirstPass.splash}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel={FirstPass.appName}
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
  /** Zoom from the middle of the pair rather than the middle of the FirstPass logo. */
  pairOrigin: {
    transformOrigin: [LOGO_SIZE / 2, LOGO_SIZE / 2 + SHIFT, 0],
  },
  /** A gap below the FirstPass logo, which fills the middle of its square. */
  clubLogo: {
    position: 'absolute',
    top: (LOGO_SIZE + FIRSTPASS_HEIGHT) / 2 + GAP,
    alignSelf: 'center',
  },
  clubLogoImage: {
    width: CLUB_LOGO_SIZE,
    height: CLUB_LOGO_SIZE,
  },
});
