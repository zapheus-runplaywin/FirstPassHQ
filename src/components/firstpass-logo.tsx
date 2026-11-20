import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppVersion } from '@/components/app-version';
import { ThemedText } from '@/components/themed-text';
import { FirstPass } from '@/constants/club';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { firstPassLogo } from '@/lib/club';

/**
 * "Powered by" over the FirstPass HQ logo, at the foot of every screen
 * whatever look the club sets. Picks the logo whose lettering reads on the
 * club's background.
 */
export function PoweredByFirstPass({ showVersion = false }: { showVersion?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <View
        style={styles.brand}
        accessible
        accessibilityLabel={`Powered by ${FirstPass.appName}`}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
          Powered by
        </ThemedText>
        <Image source={firstPassLogo(theme.background)} style={styles.logo} contentFit="contain" />
      </View>
      {/* Which version and build this is, on Find your club, sign-in and home. */}
      {showVersion ? <AppVersion /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  brand: {
    alignItems: 'center',
    gap: 2,
  },
  text: {
    fontSize: 12,
    lineHeight: 16,
  },
  // The logo is 401 by 66.
  logo: {
    width: 110,
    height: 18,
  },
});
