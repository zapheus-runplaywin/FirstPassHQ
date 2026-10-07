import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { authRedirectUrl, signInWithGoogle } from '@/lib/sign-in';

export default function SignInScreen() {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
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
            Sign in with the Google account you use for the club.
          </ThemedText>
        </View>

        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={handleGoogle}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
            ]}>
            {busy ? (
              <ActivityIndicator />
            ) : (
              <ThemedText type="smallBold">Continue with Google</ThemedText>
            )}
          </Pressable>


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
