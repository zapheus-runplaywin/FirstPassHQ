import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { findClub } from '@/constants/clubs';
import { useClubChoice } from '@/lib/club-choice';

/**
 * A club's join link, such as firstpasshq://club/THUNDER: picks the club, then
 * carries on to sign-in (or home, when already signed in to it).
 */
export default function ClubLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { club, choose, switchClub } = useClubChoice();
  const linked = findClub(code);

  useEffect(() => {
    if (linked && linked.code !== club?.code) choose(linked.code);
  }, [linked, club, choose]);

  if (linked && linked.code === club?.code) return <Redirect href="/" />;
  if (linked) return null;

  return (
    <Screen withTopInset>
      <ThemedText type="subtitle">Club not found</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        This link is for a club this app doesn’t know. Check the link with your club, or update
        the app.
      </ThemedText>
      <Button
        title="Enter a club code"
        onPress={() => {
          router.replace('/');
          switchClub();
        }}
      />
    </Screen>
  );
}
