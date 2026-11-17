import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from "expo-apple-authentication";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PoweredByFirstPass } from "@/components/firstpass-logo";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useClub } from "@/lib/club";
import { useClubChoice } from "@/lib/club-choice";
import {
  appleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
} from "@/lib/sign-in";

export default function SignInScreen() {
  const theme = useTheme();
  const club = useClub();
  const { club: chosen, switchClub } = useClubChoice();
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Apple's button shows only on an iPhone or iPad where Apple offers it.
  const [apple, setApple] = useState(false);

  useEffect(() => {
    let live = true;
    appleSignInAvailable().then((available) => {
      if (live) setApple(available);
    });
    return () => {
      live = false;
    };
  }, []);

  async function run(which: "apple" | "google", signIn: () => Promise<void>) {
    if (busy) return;
    setBusy(which);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(null);
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
            {apple ? (
              // Apple's own button, unstyled, as App Review expects. White
              // stands out on the club's dark background.
              <AppleAuthenticationButton
                testID="apple-sign-in"
                buttonType={AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={12}
                onPress={() => run("apple", signInWithApple)}
                style={styles.appleButton}
              />
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => run("google", signInWithGoogle)}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.backgroundElement,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {busy === "google" ? (
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
  // Apple's button takes its colour and corners from its own props, never
  // from style, and needs a height and width to show at all.
  appleButton: {
    height: 52,
    width: "100%",
  },
  error: {
    color: "#DC2626",
  },
  switch: {
    paddingVertical: Spacing.two,
  },
});
