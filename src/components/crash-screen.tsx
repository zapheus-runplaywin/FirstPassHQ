import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { reportCrash } from '@/lib/crash-reports';
import { logger } from '@/lib/log';

const log = logger('app');

/**
 * Shown in place of a blank screen when the app hits an error it can't carry
 * on from (the root layout's ErrorBoundary). It never shows the error's own
 * words, which could name someone. It uses the built-in colours and the
 * phone's font, because the club's look and the brand fonts may be what broke.
 */
export function CrashScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    log.error('Something went wrong screen', { error });
    reportCrash(error);
  }, [error]);

  async function restart() {
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // Development builds and the web can't restart this way; try the screen again instead.
      setRestarting(false);
      await retry();
    }
  }

  return (
    <View style={styles.screen} accessibilityRole="alert">
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        The app hit a problem and couldn’t show this screen. Nothing you saved has been lost.
        Try again, or restart the app.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={restart}
        disabled={restarting}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>{restarting ? 'Restarting…' : 'Restart the app'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        <Text style={styles.secondaryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    backgroundColor: Colors.background,
  },
  title: { color: Colors.text, fontSize: 24, fontWeight: '800' },
  body: { color: Colors.textSecondary, fontSize: 16, lineHeight: 22 },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: Spacing.three,
    backgroundColor: Colors.accent,
  },
  buttonText: { color: Colors.onAccent, fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', paddingVertical: Spacing.three },
  secondaryText: { color: Colors.tint, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
