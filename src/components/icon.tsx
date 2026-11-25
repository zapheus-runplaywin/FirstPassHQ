import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The app's icons: the Feather set (MIT, assets/fonts/Feather-LICENSE.txt),
 * shipped as one font file with the app's own code. No icon package is
 * installed, so an icon can go out in an over-the-air update.
 *
 * Only the icons the app uses are named here. To add one, look its code up at
 * feathericons.com (the font's glyph map) and add a line.
 */
const GLYPHS = {
  activity: 61696,
  'alert-circle': 61698,
  'alert-triangle': 61700,
  archive: 61707,
  award: 61721,
  'bar-chart-2': 61723,
  bell: 61726,
  'book-open': 61731,
  briefcase: 61734,
  calendar: 61735,
  check: 61739,
  'check-circle': 61740,
  'check-square': 61741,
  'chevron-down': 61742,
  'chevron-left': 61743,
  'chevron-right': 61744,
  'chevron-up': 61745,
  clipboard: 61752,
  clock: 61753,
  'credit-card': 61777,
  'edit-2': 61792,
  eye: 61795,
  'file-text': 61804,
  flag: 61807,
  folder: 61808,
  grid: 61821,
  heart: 61825,
  home: 61828,
  image: 61829,
  info: 61831,
  list: 61841,
  lock: 61843,
  'log-out': 61845,
  'map-pin': 61848,
  'message-square': 61854,
  phone: 61878,
  plus: 61888,
  'plus-circle': 61889,
  repeat: 61897,
  search: 61904,
  settings: 61907,
  shield: 61910,
  sliders: 61920,
  smile: 61922,
  star: 61925,
  target: 61933,
  'toggle-right': 61939,
  'trash-2': 61942,
  'trending-up': 61945,
  user: 61957,
  'user-check': 61958,
  'user-plus': 61960,
  users: 61962,
  video: 61963,
  x: 61974,
  'x-circle': 61975,
} as const;

export type IconName = keyof typeof GLYPHS;

/** The font family the icons are drawn in, loaded in the root layout. */
export const ICON_FONT_FAMILY = 'Feather';

/** For the root layout's `useFonts`, beside Montserrat. */
export const iconFonts = {
  // A relative path: Jest maps "@/" to src/, and the fonts live outside it.
  [ICON_FONT_FAMILY]: require('../../assets/fonts/Feather.ttf'),
};

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

/**
 * One icon. It is decoration: screen readers skip it, so whatever it sits in
 * needs its own words or label.
 */
export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  /** Defaults to the club's text colour. */
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      aria-hidden
      allowFontScaling={false}
      selectable={false}
      style={[
        styles.icon,
        { fontSize: size, lineHeight: size, width: size, height: size, color: color ?? theme.text },
        style,
      ]}>
      {String.fromCodePoint(GLYPHS[name])}
    </Text>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontFamily: ICON_FONT_FAMILY,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAlign: 'center',
  },
});
