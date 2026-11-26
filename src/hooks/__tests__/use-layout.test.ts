/**
 * How HQ decides between the phone and tablet layouts (src/hooks/use-layout.ts):
 * how many cards a row holds, and from what window width screens sit in columns.
 */
import { renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { Dimensions } from 'react-native';

import {
  CARD_MIN_WIDTH,
  COLUMNS_MIN_WIDTH,
  gridColumns,
  MAX_GRID_COLUMNS,
  ShareOfWindow,
  toRows,
  useLayoutWidth,
  useWideLayout,
  WIDE_MIN_WIDTH,
} from '@/hooks/use-layout';

/** Window sizes in points, upright unless named otherwise. */
const SIZES = {
  smallPhone: { width: 375, height: 667 },
  bigPhone: { width: 430, height: 932 },
  ipadMini: { width: 744, height: 1133 },
  ipadMiniSideways: { width: 1133, height: 744 },
  ipadAir: { width: 820, height: 1180 },
  ipadAirSideways: { width: 1180, height: 820 },
  ipadPro13: { width: 1032, height: 1376 },
  ipadSplitHalf: { width: 590, height: 820 },
  androidTablet: { width: 800, height: 1280 },
};

function setWindow(size: { width: number; height: number }) {
  Dimensions.set({
    window: { ...size, scale: 2, fontScale: 1 },
    screen: { ...size, scale: 2, fontScale: 1 },
  });
}

afterEach(() => setWindow(SIZES.bigPhone));

describe('useWideLayout', () => {
  it.each([
    ['smallPhone', false],
    ['bigPhone', false],
    ['ipadSplitHalf', false],
    ['ipadMini', true],
    ['ipadAir', true],
    ['androidTablet', true],
    ['ipadAirSideways', true],
  ] as const)('%s is wide: %s', async (name, wide) => {
    setWindow(SIZES[name]);
    const { result } = await renderHook(() => useWideLayout());
    expect(result.current).toBe(wide);
  });

  it.each([
    ['ipadMini', false],
    ['ipadAir', false],
    ['androidTablet', false],
    ['ipadPro13', true],
    ['ipadMiniSideways', true],
    ['ipadAirSideways', true],
  ] as const)('%s has room for two columns: %s', async (name, wide) => {
    setWindow(SIZES[name]);
    const { result } = await renderHook(() => useWideLayout(COLUMNS_MIN_WIDTH));
    expect(result.current).toBe(wide);
  });

  it('follows the window when an iPad is turned', async () => {
    setWindow(SIZES.ipadAir);
    const { result, rerender } = await renderHook(() => useWideLayout(COLUMNS_MIN_WIDTH));
    expect(result.current).toBe(false);
    setWindow(SIZES.ipadAirSideways);
    await rerender({});
    expect(result.current).toBe(true);
  });

  it('keeps every phone below the tablet width and every iPad at or above it', () => {
    expect(SIZES.bigPhone.width).toBeLessThan(WIDE_MIN_WIDTH);
    expect(SIZES.ipadMini.width).toBeGreaterThanOrEqual(WIDE_MIN_WIDTH);
  });
});

describe('a screen sharing the window', () => {
  /** What a screen works out about its room: its width, tablet-sized, room for two columns. */
  const useRoom = () => [useLayoutWidth(), useWideLayout(), useWideLayout(COLUMNS_MIN_WIDTH)] as const;
  const sharing = (share: number | null) => ({
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(ShareOfWindow, { value: share }, children),
  });

  it.each([
    ['a list beside its item', 380, false, false],
    ['an item beside its list on an iPad on its side', 800, true, false],
    ['an item beside its list on the biggest iPad on its side', 996, true, true],
  ] as const)('%s lays out for its share, not the window', async (_label, share, wide, columns) => {
    setWindow(SIZES.ipadAirSideways);
    const { result } = await renderHook(useRoom, sharing(share));
    expect(result.current).toEqual([share, wide, columns]);
  });

  it('has the whole window when it shares it with nothing', async () => {
    setWindow(SIZES.ipadAirSideways);
    const { result } = await renderHook(useRoom, sharing(null));
    expect(result.current).toEqual([SIZES.ipadAirSideways.width, true, true]);
    const alone = await renderHook(useRoom);
    expect(alone.result.current).toEqual([SIZES.ipadAirSideways.width, true, true]);
  });
});

describe('gridColumns', () => {
  it('gives a phone one column', () => {
    expect(gridColumns(430 - 48, 8)).toBe(1);
    expect(gridColumns(375 - 48, 24)).toBe(1);
  });

  it('gives an upright tablet two columns (screen width less padding)', () => {
    expect(gridColumns(744 - 48, 8)).toBe(2);
    expect(gridColumns(800 - 48, 8)).toBe(2);
  });

  it('gives a wide screen three columns at most', () => {
    expect(gridColumns(1240 - 48, 8)).toBe(3);
    expect(gridColumns(4000, 8)).toBe(MAX_GRID_COLUMNS);
    expect(gridColumns(4000, 8, 2)).toBe(2);
  });

  it('only adds a column once each card can be CARD_MIN_WIDTH wide', () => {
    expect(gridColumns(CARD_MIN_WIDTH * 2 + 8, 8)).toBe(2);
    expect(gridColumns(CARD_MIN_WIDTH * 2 + 7, 8)).toBe(1);
  });

  it('falls back to one column before the space is measured', () => {
    expect(gridColumns(0, 8)).toBe(1);
    expect(gridColumns(-5, 8)).toBe(1);
    expect(gridColumns(Number.NaN, 8)).toBe(1);
  });
});

describe('toRows', () => {
  it('splits into full rows and a shorter last row', () => {
    expect(toRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(toRows([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('handles nothing, and never makes empty rows', () => {
    expect(toRows([], 3)).toEqual([]);
    expect(toRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});
