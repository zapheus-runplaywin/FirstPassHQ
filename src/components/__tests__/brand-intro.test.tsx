/**
 * The opening screen that follows the native splash (src/components/brand-intro.tsx):
 * the FirstPass mark, and the app's version and build at the foot so a tester
 * can see which copy opened.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandIntro } from '@/components/brand-intro';
import { appVersionLines } from '@/lib/app-version';

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('@/lib/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').clubModuleMock(),
);
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/club-choice', () =>
  jest.requireActual('../../__tests__/helpers/harness').clubChoiceModuleMock(),
);
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/app-version', () => ({ appVersionLines: jest.fn() }));
// The animation itself isn't under test: values jump straight to where they end.
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: () => void) => fn() }));
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const { useRef } = jest.requireActual('react');
  const to = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View },
    Easing: { inOut: to, in: to, out: to, cubic: 0, quad: 0 },
    ReduceMotion: { Never: 'never' },
    useReducedMotion: () => false,
    useSharedValue: (initial: number) => useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    withDelay: (_ms: number, value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withSpring: to,
    withTiming: to,
  };
});

const lines = jest.mocked(appVersionLines);

/** A phone with a home indicator 34 points tall. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function show() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <BrandIntro onDone={() => {}} />
    </SafeAreaProvider>,
  );
}

describe('BrandIntro', () => {
  beforeEach(() => {
    lines.mockReturnValue(['Version 1.0.0 (23) · Build 714', 'Update 1a2b3c4d · 20 Nov 2026']);
  });

  it('shows the FirstPass mark', async () => {
    await show();
    expect(screen.getByLabelText('FirstPass HQ')).toBeTruthy();
  });

  it('shows the version, build and update at the foot, in the brand’s muted ink on navy', async () => {
    await show();
    expect(screen.getByTestId('app-version')).toBeTruthy();
    const version = screen.getByText('Version 1.0.0 (23) · Build 714');
    expect(StyleSheet.flatten(version.props.style).color).toBe('#CBD5E1');
    expect(screen.getByText('Update 1a2b3c4d · 20 Nov 2026')).toBeTruthy();
  });

  it('keeps the version clear of the home indicator', async () => {
    await show();
    const holder = screen.getByTestId('app-version').parent;
    expect(StyleSheet.flatten(holder?.props.style)).toMatchObject({ position: 'absolute', bottom: 34 + 24 });
  });

  it('shows no version line when nothing is known', async () => {
    lines.mockReturnValue([]);
    await show();
    expect(screen.queryByTestId('app-version')).toBeNull();
  });
});
