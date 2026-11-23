import { useWindowDimensions } from 'react-native';

/**
 * Window width, in points, from which HQ lays a screen out for a tablet. The
 * narrowest iPad (iPad mini, upright) is 744 wide. Phones stay below it, and so
 * does an iPad app sharing the screen in a narrow Split View or Stage Manager
 * window, which then gets the phone layout it has room for.
 */
export const WIDE_MIN_WIDTH = 700;

/**
 * Window width from which Columns sits side by side: an iPad on its side, or
 * the biggest iPad upright. Narrower tablets get one column of card grids,
 * which reads better than two thin columns.
 */
export const COLUMNS_MIN_WIDTH = 960;

/** The narrowest a card in a CardGrid gets before the grid drops a column. */
export const CARD_MIN_WIDTH = 300;

/** Most cards a CardGrid puts side by side. */
export const MAX_GRID_COLUMNS = 3;

/**
 * True on a tablet-sized window (or at least `minWidth` wide). Follows the window, not the device, so
 * turning an iPad or resizing its window changes the layout straight away.
 */
export function useWideLayout(minWidth = WIDE_MIN_WIDTH) {
  return useWindowDimensions().width >= minWidth;
}

/**
 * How many cards fit side by side in a space `width` points wide with `gap`
 * between them: one on a phone, two or three on a tablet.
 */
export function gridColumns(width: number, gap: number, max = MAX_GRID_COLUMNS) {
  if (!(width > 0)) return 1;
  const fit = Math.floor((width + gap) / (CARD_MIN_WIDTH + gap));
  return Math.max(1, Math.min(max, fit));
}

/** Splits `items` into rows of `columns`. */
export function toRows<T>(items: T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
