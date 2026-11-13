import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';

type StackScreenOptions = NonNullable<ComponentProps<typeof Stack>['screenOptions']>;

/**
 * Options for every screen in the app's navigation stack (src/app/_layout.tsx).
 *
 * `headerTransparent: false` keeps the header a solid bar in the club colours.
 * On iOS 26 and later the header is see-through by default (Liquid Glass), and
 * each screen then starts at the very top, under the header, so its first card
 * or button is hidden and can't be tapped. A solid header puts every screen
 * below it again.
 */
export const rootStackOptions = {
  headerBackButtonDisplayMode: 'minimal',
  headerTransparent: false,
} satisfies StackScreenOptions;
