import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { clubInitials } from '@/lib/club-logos';

const SIZE = 48;

/**
 * A club's logo in a list of clubs, or its initials when this device has no
 * logo for it or the image can't load (offline before it was ever shown).
 */
export function ClubBadge({ name, logo }: { name: string; logo: string | null | undefined }) {
  const theme = useTheme();
  // The logo that couldn't load, so a newer one is still tried.
  const [failed, setFailed] = useState<string | null>(null);

  if (logo && failed !== logo) {
    return (
      <Image
        source={{ uri: logo }}
        style={styles.badge}
        contentFit="contain"
        cachePolicy="memory-disk"
        onError={() => setFailed(logo)}
        // The card already reads the club's name.
        accessible={false}
        testID="club-logo"
      />
    );
  }
  return (
    <View
      style={[styles.badge, styles.initials, { backgroundColor: theme.backgroundSelected }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="club-initials">
      <ThemedText type="smallBold">{clubInitials(name)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: SIZE,
    height: SIZE,
  },
  initials: {
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
