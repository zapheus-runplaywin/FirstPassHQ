import { useMemo } from 'react';

import type { Palette } from '@/constants/theme';
import { useClubColors } from '@/lib/club';

/** The app's colours: the club's, as set by an admin. There is only one theme. */
export function useTheme() {
  return useClubColors();
}

/**
 * Styles that use the club's colours, rebuilt when an admin changes them.
 * Pass a function defined outside the component so it isn't rebuilt every render.
 */
export function useThemedStyles<T>(make: (colors: Palette) => T): T {
  const colors = useTheme();
  return useMemo(() => make(colors), [colors, make]);
}
