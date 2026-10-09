import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

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
export function PoweredByFirstPass() {
  const theme = useTheme();
  return (
    <View style={styles.container} accessible accessibilityLabel={`Powered by ${FirstPass.appName}`}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        Powered by
      </ThemedText>
      <Image source={firstPassLogo(theme.background)} style={styles.logo} contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.two,
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
