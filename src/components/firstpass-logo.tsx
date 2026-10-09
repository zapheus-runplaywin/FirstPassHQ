import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { FirstPass } from '@/constants/club';
import { useTheme } from '@/hooks/use-theme';
import { firstPassLogo } from '@/lib/club';

/**
 * The FirstPass HQ logo, which stays on every screen whatever look the club
 * sets: in the navigation header, and at the foot of screens without one.
 * Picks the logo whose lettering reads on the club's background.
 */
export function FirstPassLogo({ size = 'footer' }: { size?: 'header' | 'footer' }) {
  const theme = useTheme();
  return (
    <Image
      source={firstPassLogo(theme.background)}
      style={size === 'header' ? styles.header : styles.footer}
      contentFit="contain"
      accessibilityLabel={FirstPass.appName}
    />
  );
}

/** For `headerRight` in screen options. */
export function HeaderFirstPassLogo() {
  return <FirstPassLogo size="header" />;
}

// The logo is 401 by 66.
const styles = StyleSheet.create({
  header: {
    width: 97,
    height: 16,
  },
  footer: {
    width: 160,
    height: 26,
    alignSelf: 'center',
  },
});
