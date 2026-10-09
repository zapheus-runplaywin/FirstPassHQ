import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FirstPass } from '@/constants/club';
import { useTheme } from '@/hooks/use-theme';
import { firstPassLogo } from '@/lib/club';

/**
 * A small FirstPass logo for the foot of a screen, so the app's own brand
 * stays visible once a club has set its own look. Picks the logo whose
 * lettering reads on the club's background.
 */
export function PoweredByFirstPass() {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textSecondary">
        Powered by
      </ThemedText>
      <Image
        source={firstPassLogo(theme.background)}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel={FirstPass.name}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  logo: {
    width: 120,
    height: 59,
  },
});
