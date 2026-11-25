import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { BrandFonts, Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        // What needs the member is in bold, in the text colour (never the club's).
        themeColor === 'attention' && (type === 'small' || type === 'default') && styles.attention,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  attention: {
    fontFamily: BrandFonts.bold,
  },
  small: {
    fontFamily: BrandFonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: BrandFonts.bold,
    fontSize: 14,
    lineHeight: 20,
  },
  default: {
    fontFamily: BrandFonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  title: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 48,
    lineHeight: 52,
  },
  subtitle: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 32,
    lineHeight: 44,
  },
  link: {
    fontFamily: BrandFonts.regular,
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    fontFamily: BrandFonts.regular,
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
