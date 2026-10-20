/**
 * The zoomable image viewer for injury photos (src/components/zoomable-image.tsx).
 * A photo of a child's injury or medical letter is kept in memory only, never
 * in the image cache on disk. Pinching zooms between 0.8 and 6 times (and
 * springs back below 1), dragging only moves a zoomed image, and a double tap
 * zooms in on the point tapped or back out.
 *
 * The gesture builder and Reanimated are replaced with plain stand-ins that
 * keep each gesture's handlers, so the tests drive the handlers directly and
 * read the transform the image would get.
 */
import { render, screen } from '@testing-library/react-native';

import { ZoomableImage } from '@/components/zoomable-image';

type Handlers = Record<string, (e?: Record<string, number>) => void>;

jest.mock('react-native-gesture-handler', () => {
  const { View } = jest.requireActual('react-native');
  const made: Record<string, Handlers> = {};
  const builder = (kind: string) => {
    const handlers: Handlers = {};
    made[kind] = handlers;
    const b: Record<string, unknown> = {};
    for (const name of ['onStart', 'onUpdate', 'onEnd']) {
      b[name] = (fn: Handlers[string]) => {
        handlers[name] = fn;
        return b;
      };
    }
    b.averageTouches = () => b;
    b.numberOfTaps = (n: number) => {
      handlers.taps = (() => n) as never;
      return b;
    };
    return b;
  };
  return {
    __made: made,
    Gesture: {
      Pinch: () => builder('pinch'),
      Pan: () => builder('pan'),
      Tap: () => builder('tap'),
      Simultaneous: (...gestures: unknown[]) => gestures,
    },
    GestureDetector: ({ children }: { children: unknown }) => children,
    GestureHandlerRootView: View,
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const { useRef } = jest.requireActual('react');
  const state: { style: (() => unknown) | null } = { style: null };
  return {
    __esModule: true,
    __state: state,
    default: { View },
    useSharedValue: (initial: number) => useRef({ value: initial }).current,
    withTiming: (to: number) => to,
    useAnimatedStyle: (fn: () => unknown) => {
      state.style = fn;
      return {};
    },
  };
});

const gestures = () => (jest.requireMock('react-native-gesture-handler') as { __made: Record<string, Handlers> }).__made;
/** The transform the image has now: x, y and scale. */
function transform() {
  const { style } = (jest.requireMock('react-native-reanimated') as { __state: { style: () => { transform: Record<string, number>[] } } }).__state;
  const [x, y, s] = style().transform;
  return { x: x.translateX, y: y.translateY, scale: s.scale };
}

const onError = jest.fn();

function open() {
  render(<ZoomableImage uri="https://example.test/signed/photo.jpg" label="Photo of the letter" onError={onError} />);
  // A 300 by 400 viewer: its centre is (150, 200).
  const frame = screen.getByLabelText('Photo of the letter').parent!;
  let node = frame;
  while (node && !node.props.onLayout) node = node.parent!;
  node.props.onLayout({ nativeEvent: { layout: { width: 300, height: 400 } } });
}

function pinch(scale: number, focalX = 150, focalY = 200) {
  const p = gestures().pinch;
  p.onStart({ focalX, focalY });
  p.onUpdate({ scale });
  p.onEnd();
}

function drag(translationX: number, translationY: number) {
  gestures().pan.onUpdate({ translationX, translationY });
  gestures().pan.onEnd();
}

const doubleTap = (x: number, y: number) => gestures().tap.onEnd({ x, y });

beforeEach(() => onError.mockClear());

it('shows the image from memory only, never the disk cache', () => {
  open();
  const image = screen.getByLabelText('Photo of the letter');
  expect(image.props.cachePolicy ?? image.parent?.props.cachePolicy).toBe('memory');
  expect(transform()).toEqual({ x: 0, y: 0, scale: 1 });
});

it('reports an image that won’t load', () => {
  open();
  let node = screen.getByLabelText('Photo of the letter');
  while (node && !node.props.onError) node = node.parent!;
  node.props.onError({ nativeEvent: { error: 'expired link' } });
  expect(onError).toHaveBeenCalled();
});

it('double-tapping zooms in two and a half times on the point tapped, then back out', () => {
  open();
  expect((gestures().tap.taps as unknown as () => number)()).toBe(2);
  doubleTap(250, 200);
  // The tapped point, 100 right of centre, stays under the finger.
  expect(transform()).toEqual({ x: -150, y: -0, scale: 2.5 });
  doubleTap(10, 10);
  expect(transform()).toEqual({ x: 0, y: 0, scale: 1 });
});

it('pinching zooms around the fingers, up to six times', () => {
  open();
  pinch(2, 250, 200);
  expect(transform()).toEqual({ x: -100, y: 0, scale: 2 });
  pinch(10);
  expect(transform().scale).toBe(6);
});

it('pinching out below full size springs back', () => {
  open();
  const p = gestures().pinch;
  p.onStart({ focalX: 150, focalY: 200 });
  p.onUpdate({ scale: 0.1 });
  // Never smaller than 0.8 while pinching.
  expect(transform().scale).toBe(0.8);
  p.onEnd();
  expect(transform()).toEqual({ x: 0, y: 0, scale: 1 });
});

it('dragging only moves a zoomed image', () => {
  open();
  drag(40, 30);
  expect(transform()).toEqual({ x: 0, y: 0, scale: 1 });
  doubleTap(150, 200);
  drag(40, 30);
  expect(transform()).toEqual({ x: 40, y: 30, scale: 2.5 });
  // The next drag carries on from there.
  drag(-10, 0);
  expect(transform()).toEqual({ x: 30, y: 30, scale: 2.5 });
});
