import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { authRedirectUrl, signIn, usesNativeApple, type Provider } from '@/lib/sign-in';

export default function SignInScreen() {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(provider: Provider) {
    setBusy(provider);
    setError(null);
    try {
      await signIn(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/logo.png')}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="West Coast Thunder"
          />
          <ThemedText themeColor="textSecondary">
            Sign in with the Google or Apple account you use for the club.
          </ThemedText>
        </View>

        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => handle('google')}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
            ]}>
            {busy === 'google' ? (
              <ActivityIndicator />
            ) : (
              <ThemedText type="smallBold">Continue with Google</ThemedText>
            )}
          </Pressable>

          {usesNativeApple() ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                colorScheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={12}
              style={styles.button}
              onPress={() => handle('apple')}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => handle('apple')}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
              ]}>
              {busy === 'apple' ? (
                <ActivityIndicator />
              ) : (
                <ThemedText type="smallBold">Continue with Apple</ThemedText>
              )}
            </Pressable>
          )}

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          {__DEV__ ? (
            <ThemedText type="small" themeColor="textSecondary" selectable>
              Development only. Add this to Supabase Redirect URLs if sign-in returns to
              localhost: {authRedirectUrl()}
            </ThemedText>
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.five,
  },
  header: {
    gap: Spacing.two,
  },
  logo: {
    width: 200,
    height: 200,
    alignSelf: 'center',
  },
  buttons: {
    gap: Spacing.three,
  },
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#DC2626',
  },
});
