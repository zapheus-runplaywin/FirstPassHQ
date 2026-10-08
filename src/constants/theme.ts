import '@/global.css';

import { Platform } from 'react-native';

import { ClubDefaults } from '@/constants/club';

export type ClubColours = { background: string; text: string; hero: string };

/**
 * The app's palette, worked out from the club's three colours. The app has
 * one theme: the club's. Panels and secondary text are blends of the
 * background and text colours, so any pair stays readable.
 */
export function makeColors({ background, text, hero }: ClubColours) {
  return {
    text,
    background,
    backgroundElement: mix(background, text, 0.11),
    backgroundSelected: mix(background, text, 0.18),
    textSecondary: mix(text, background, 0.286),
    /** Links, back buttons and other coloured text. */
    tint: hero,
    /** Filled buttons and selected chips. */
    accent: hero,
    /** Text on a filled button: black or white, whichever reads better. */
    onAccent: contrastRatio(hero, '#000000') >= contrastRatio(hero, '#FFFFFF') ? '#000000' : '#FFFFFF',
  };
}

export type Palette = ReturnType<typeof makeColors>;

/** The palette built into the app, before any club settings load. */
export const Colors: Palette = makeColors(ClubDefaults);

export function isHexColour(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

/** WCAG contrast ratio between two #RRGGBB colours, from 1 to 21. */
export function contrastRatio(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function channels(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `from` moved `amount` (0 to 1) of the way towards `to`. */
function mix(from: string, to: string, amount: number) {
  const a = channels(from);
  const b = channels(to);
  return (
    '#' +
    a
      .map((c, i) => Math.round(c + (b[i] - c) * amount))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export type ThemeColor = keyof Palette;

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
