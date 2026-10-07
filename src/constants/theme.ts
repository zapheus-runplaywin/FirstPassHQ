/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Club colours from the West Coast Thunder logo: yellow, black, grey and white.
const ThunderYellow = '#FFCD00';

export const Colors = {
  light: {
    text: '#111111',
    background: '#FFFFFF',
    backgroundElement: '#F2F2F2',
    backgroundSelected: '#E2E2E2',
    textSecondary: '#5C5C5C',
    /** Links and other coloured text; darker than the brand yellow so it reads on white. */
    tint: '#8A6600',
    /** Filled buttons and selected chips. */
    accent: ThunderYellow,
    onAccent: '#000000',
  },
  dark: {
    text: '#FFFFFF',
    background: '#000000',
    backgroundElement: '#1C1C1C',
    backgroundSelected: '#2E2E2E',
    textSecondary: '#B6B6B6',
    tint: ThunderYellow,
    accent: ThunderYellow,
    onAccent: '#000000',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
