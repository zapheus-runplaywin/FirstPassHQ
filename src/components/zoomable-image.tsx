import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * An image that fills its container and can be pinched to zoom, dragged
 * around while zoomed, and double-tapped to zoom in or back out.
 * It is kept in memory only, never in the image cache on disk.
 */
export function ZoomableImage({
  uri,
  label,
  onError,
}: {
  uri: string;
  label: string;
  onError: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  // The container's centre, which scaling happens around.
  const centreX = useSharedValue(0);
  const centreY = useSharedValue(0);
  // Where a pinch started, so the point between the fingers stays put.
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalX.value = e.focalX - centreX.value;
      focalY.value = e.focalY - centreY.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.8), MAX_SCALE);
      const k = scale.value / savedScale.value;
      x.value = focalX.value - k * (focalX.value - savedX.value);
      y.value = focalY.value - k * (focalY.value - savedY.value);
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        reset();
      } else {
        savedScale.value = scale.value;
        savedX.value = x.value;
        savedY.value = y.value;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value <= 1 && scale.value <= 1) return;
      x.value = savedX.value + e.translationX;
      y.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  // Zooms in on the point tapped, or back out.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.value > 1) {
        reset();
        return;
      }
      const offsetX = (e.x - centreX.value) * (1 - DOUBLE_TAP_SCALE);
      const offsetY = (e.y - centreY.value) * (1 - DOUBLE_TAP_SCALE);
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      x.value = withTiming(offsetX);
      y.value = withTiming(offsetY);
      savedScale.value = DOUBLE_TAP_SCALE;
      savedX.value = offsetX;
      savedY.value = offsetY;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View
        style={[styles.fill, styles.clip]}
        onLayout={(e) => {
          centreX.value = e.nativeEvent.layout.width / 2;
          centreY.value = e.nativeEvent.layout.height / 2;
        }}>
        <Animated.View style={[styles.fill, animatedStyle]}>
          <Image
            source={{ uri }}
            style={styles.fill}
            contentFit="contain"
            cachePolicy="memory"
            draggable={false}
            accessibilityLabel={label}
            onError={onError}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
  },
  clip: {
    overflow: 'hidden',
  },
});
