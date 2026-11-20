import { Image, type ImageSource } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Spacing } from '@/constants/theme';

/** Size of the club logo at the top right of the home screen. */
export const HOME_LOGO_SIZE = 136;

/**
 * The top of the home screen: "Hi <name>" with the roles held beneath it, any
 * titles held (captaincies and safeguarding posts such as Child Safety
 * Officer) under those, and the
 * club's logo on the right. The greeting is kept smaller than a page title
 * so most names fit on one line beside the larger logo; a long name wraps to a
 * second line and, on phones, shrinks a little rather than run to a third.
 */
export function HomeHeader({
  name,
  roles,
  titles,
  logo,
  clubName,
}: {
  name: string;
  roles?: string;
  /** Titles held, such as "Captain, Open A · Child Safety Officer", under the roles. */
  titles?: string;
  logo: ImageSource | number;
  clubName: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <ThemedText
          style={styles.greeting}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          accessibilityRole="header">
          Hi {name}
        </ThemedText>
        {roles ? <ThemedText themeColor="textSecondary">{roles}</ThemedText> : null}
        {titles ? (
          <ThemedText testID="home-titles" themeColor="textSecondary">
            {titles}
          </ThemedText>
        ) : null}
      </View>
      <Image
        testID="home-club-logo"
        source={logo}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel={clubName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  text: {
    flex: 1,
    gap: Spacing.one,
  },
  greeting: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 22,
    lineHeight: 28,
  },
  logo: {
    width: HOME_LOGO_SIZE,
    height: HOME_LOGO_SIZE,
  },
});
