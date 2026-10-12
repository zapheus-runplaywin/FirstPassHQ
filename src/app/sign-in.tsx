import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PoweredByFirstPass } from "@/components/firstpass-logo";
import { PolicyLinks } from "@/components/policy-links";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useClub } from "@/lib/club";
import { useClubChoice } from "@/lib/club-choice";
import { signInWithGoogle } from "@/lib/sign-in";

export default function SignInScreen() {
  const theme = useTheme();
  const club = useClub();
  const { club: chosen, switchClub } = useClubChoice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.body}>
          <View style={styles.header}>
            {/* The club's logo, or the FirstPass 1P mark until the club adds one. */}
            <Image
              source={club.logo}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel={club.name}
            />
            <ThemedText type="subtitle" style={styles.title}>
              Sign in / Register
            </ThemedText>
          </View>

          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={handleGoogle}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.backgroundElement,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
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

            <Pressable
              accessibilityRole="button"
              onPress={switchClub}
              style={styles.switch}
            >
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.title}
              >
                Not {chosen?.name}?{" "}
                <ThemedText type="small" style={{ color: theme.tint }}>
                  Change club
                </ThemedText>
              </ThemedText>
            </Pressable>
            <PolicyLinks centred />
          </View>
        </View>

        <PoweredByFirstPass />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
  },
  safeArea: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.five,
  },
  header: {
    gap: Spacing.two,
  },
  title: {
    textAlign: "center",
  },
  logo: {
    width: 200,
    height: 200,
    alignSelf: "center",
  },
  buttons: {
    gap: Spacing.three,
  },
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: "#DC2626",
  },
  switch: {
    paddingVertical: Spacing.two,
  },
});
