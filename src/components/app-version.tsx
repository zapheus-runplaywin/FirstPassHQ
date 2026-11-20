import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { appVersionLines } from '@/lib/app-version';

/**
 * The app's version, build and any over-the-air update, in small print, so a
 * tester can say which copy they have. See src/lib/app-version.ts.
 */
export function AppVersion({ color }: { color?: string }) {
  const lines = appVersionLines();
  if (lines.length === 0) return null;
  const textStyle: StyleProp<TextStyle> = [styles.text, color ? { color } : null];
  return (
    <View
      testID="app-version"
      accessible
      accessibilityLabel={lines.join('. ')}
      style={styles.container}>
      {lines.map((line) => (
        <ThemedText key={line} type="small" themeColor="textSecondary" style={textStyle}>
          {line}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  text: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
});
