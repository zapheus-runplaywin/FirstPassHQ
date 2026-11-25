import '@/global.css';

import { Platform } from 'react-native';

import { ClubDefaults, FirstPass } from '@/constants/club';

export type ClubColours = { background: string; text: string; hero: string };

/** The greens "done" is shown in: the first for light panels, the second for dark. */
export const StatusGreens = ['#166534', '#5BD68A'] as const;

/**
 * The app's palette, worked out from the club's three colours. The app has
 * one theme: the club's. Panels and secondary text are blends of the
 * background and text colours, so any pair stays readable.
 */
export function makeColors({ background, text, hero }: ClubColours) {
  // On FirstPass's own deep navy and white, panels and secondary text use the
  // brand guide's dark-theme colours rather than blends.
  const brand = same(background, FirstPass.navy) && same(text, '#FFFFFF');
  const panel = brand ? FirstPass.panel : mix(background, text, 0.11);
  return {
    text,
    background,
    backgroundElement: panel,
    backgroundSelected: mix(background, text, 0.18),
    textSecondary: brand ? FirstPass.inkMuted : mix(text, background, 0.286),
    /** Links, back buttons and other coloured text. */
    tint: hero,
    /** Filled buttons and selected chips. */
    accent: hero,
    /** Text on a filled button: black or white, whichever reads better. */
    onAccent: contrastRatio(hero, '#000000') >= contrastRatio(hero, '#FFFFFF') ? '#000000' : '#FFFFFF',
    /**
     * Something that needs the member, such as consent still to give. It is
     * the text colour, shown in bold with a mark beside it, and never the
     * club's colour: on a gold club a warning mustn't look like a link.
     */
    attention: text,
    /**
     * Done, or all clear: whichever green reads better on a panel. On the few
     * mid-tone clubs where neither reads well enough as text, it is the text
     * colour, and the tick beside it still says "done".
     */
    positive: positiveOn(panel, text),
  };
}

function positiveOn(panel: string, text: string) {
  const green = StatusGreens.reduce<string>(
    (best, next) => (contrastRatio(next, panel) > contrastRatio(best, panel) ? next : best),
    StatusGreens[0],
  );
  return contrastRatio(green, panel) >= 4.5 ? green : text;
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

function same(a: string, b: string) {
  return a.trim().toUpperCase() === b.toUpperCase();
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

/**
 * Montserrat, the FirstPass brand guide's only typeface, loaded in the root
 * layout. Each weight is its own family because Android can't pick a weight
 * from one.
 */
export const BrandFonts = {
  regular: 'Montserrat_400Regular',
  bold: 'Montserrat_700Bold',
  extraBold: 'Montserrat_800ExtraBold',
} as const;

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

/**
 * How wide a screen laid out in columns or a card grid gets on a tablet
 * (Screen's `wide`). Forms and reading stay at MaxContentWidth.
 */
export const MaxWideContentWidth = 1240;
