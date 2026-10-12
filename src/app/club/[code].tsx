import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { Screen } from "@/components/screen";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui";
import { findClub } from "@/constants/clubs";
import { useClubChoice } from "@/lib/club-choice";

/**
 * A club's join link, such as firstpasshq://club/THUNDER: picks the club, then
 * carries on to sign-in (or home, when already signed in to it).
 */
export default function ClubLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { ready, club, choose, switchClub } = useClubChoice();
  const linked = findClub(code);

  // A phone with no club yet goes straight in. One that already has a club asks
  // first, so a link can't quietly move someone to another club's sign-in.
  useEffect(() => {
    if (ready && linked && !club) choose(linked.code);
  }, [ready, linked, club, choose]);

  if (!ready) return null;
  if (linked && linked.code === club?.code) return <Redirect href="/" />;
  if (linked && club) {
    return (
      <Screen withTopInset>
        <ThemedText type="subtitle">Switch to {linked.name}?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This app is set up for {club.name}. Only switch if you trust where
          this link came from. Your {club.name} sign-in stays saved.
        </ThemedText>
        <Button
          title={`Switch to ${linked.name}`}
          onPress={() => choose(linked.code)}
        />
        <Button
          title={`Stay with ${club.name}`}
          variant="secondary"
          onPress={() => router.replace("/")}
        />
      </Screen>
    );
  }
  if (linked) return null;

  return (
    <Screen withTopInset>
      <ThemedText type="subtitle">Club not found</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        This link is for a club this app doesn’t know. Check the link with your
        club, or update the app.
      </ThemedText>
      <Button
        title="Enter a club code"
        onPress={() => {
          router.replace("/");
          switchClub();
        }}
      />
    </Screen>
  );
}
