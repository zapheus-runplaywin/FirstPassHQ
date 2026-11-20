import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from "expo-apple-authentication";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PoweredByFirstPass } from "@/components/firstpass-logo";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { isDemoClub } from "@/constants/clubs";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useClub } from "@/lib/club";
import { useClubChoice } from "@/lib/club-choice";
import { signInToDemoClub } from "@/lib/demo-sign-in";
import {
  appleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
} from "@/lib/sign-in";

// Google's standard multicolour "G" (assets/images/google-g.svg is the source).
// Relative, not "@/assets", so Jest can load it too.
const GOOGLE_G = require("../../assets/images/google-g.png");
// Colours of Google's light-theme sign-in button.
const GOOGLE_TEXT = "#1F1F1F";
const GOOGLE_OUTLINE = "#747775";

export default function SignInScreen() {
  const theme = useTheme();
  const club = useClub();
  const { club: chosen, switchClub } = useClubChoice();
  const [busy, setBusy] = useState<"apple" | "google" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Apple's button shows only on an iPhone or iPad where Apple offers it.
  const [apple, setApple] = useState(false);
  // The demo club, and only the demo club, signs in with a password.
  const demo = isDemoClub(chosen);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let live = true;
    appleSignInAvailable().then((available) => {
      if (live) setApple(available);
    });
    return () => {
      live = false;
    };
  }, []);

  async function run(
    which: "apple" | "google" | "demo",
    signIn: () => Promise<void>,
  ) {
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
            {demo ? (
              <>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.title}
                >
                  Demo club. Sample people only.
                </ThemedText>
                <TextInput
                  testID="demo-email"
                  accessibilityLabel="Email"
                  placeholder="Email"
                  placeholderTextColor={theme.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="username"
                  style={[
                    styles.input,
                    { backgroundColor: theme.backgroundElement, color: theme.text },
                  ]}
                />
                <TextInput
                  testID="demo-password"
                  accessibilityLabel="Password"
                  placeholder="Password"
                  placeholderTextColor={theme.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  onSubmitEditing={() =>
                    run("demo", () => signInToDemoClub(chosen, email, password))
                  }
                  style={[
                    styles.input,
                    { backgroundColor: theme.backgroundElement, color: theme.text },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={() =>
                    run("demo", () => signInToDemoClub(chosen, email, password))
                  }
                  style={({ pressed }) => [
                    styles.button,
                    {
                      backgroundColor: theme.backgroundElement,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {busy === "demo" ? (
                    <ActivityIndicator />
                  ) : (
                    <ThemedText type="smallBold">Sign in</ThemedText>
                  )}
                </Pressable>
              </>
            ) : (
              <>
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

                {/* Google's light-theme button from its sign-in branding
                    guidelines (white, grey outline, dark text, the full-colour
                    G never recoloured), sized and lettered to match Apple's
                    button above it. */}
                <Pressable
                  testID="google-sign-in"
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  disabled={busy !== null}
                  onPress={() => run("google", signInWithGoogle)}
                  style={({ pressed }) => [
                    styles.button,
                    styles.googleButton,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  {busy === "google" ? (
                    <ActivityIndicator color={GOOGLE_TEXT} />
                  ) : (
                    <View style={styles.googleContent}>
                      <Image
                        testID="google-logo"
                        source={GOOGLE_G}
                        style={styles.googleLogo}
                        contentFit="contain"
                        accessible={false}
                      />
                      <Text style={styles.googleText}>Continue with Google</Text>
                    </View>
                  )}
                </Pressable>
              </>
            )}

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

        <PoweredByFirstPass showVersion />
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
  googleButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: GOOGLE_OUTLINE,
  },
  googleContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  googleLogo: {
    width: 18,
    height: 18,
  },
  // The phone's own font at the size Apple's 52-high button uses, so the two
  // buttons read the same (Roboto on Android, as Google asks).
  googleText: {
    color: GOOGLE_TEXT,
    fontSize: 20,
    fontWeight: "500",
  },
  input: {
    height: 52,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: "#DC2626",
  },
  switch: {
    paddingVertical: Spacing.two,
  },
});
