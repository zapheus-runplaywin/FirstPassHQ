import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ClubBadge } from '@/components/club-badge';
import { Screen } from '@/components/screen';
import { SwipeAction } from '@/components/swipe-action';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard, TextField } from '@/components/ui';
import { findClub, type ClubEntry } from '@/constants/clubs';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { defaultLogo } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';
import { useSavedClubLogos } from '@/lib/club-logos';

/**
 * Finds the member's club by its code. Each club has its own database, so this
 * decides which one the app connects to. Shown on the first open and after
 * Switch club.
 */
export default function ChooseClubScreen() {
  const theme = useTheme();
  const { choose, recent, remove } = useClubChoice();
  const logos = useSavedClubLogos(recent);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The club just taken off the list, named so the member knows it worked.
  const [removed, setRemoved] = useState<string | null>(null);
  const club = findClub(code);
  const removedNote = removed ? (
    <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
      {`Removed ${removed} and signed out of it on this device. Enter its code to add it again.`}
    </ThemedText>
  ) : null;

  function handleRemove(c: ClubEntry) {
    remove(c.code);
    setRemoved(c.name);
  }

  function handleContinue() {
    if (!club || !choose(club.code)) {
      setError('No club has that code. Check it with your club.');
    }
  }

  return (
    <Screen withTopInset showVersion>
      <View style={styles.header}>
        <Image
          source={defaultLogo(theme.background)}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="FirstPass"
        />
        <ThemedText type="subtitle" style={styles.centred}>
          Find your club
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centred}>
          Enter the code your club gave you. A club’s QR code or link fills it in for you.
        </ThemedText>
      </View>

      {recent.length > 0 ? (
        <View style={styles.recent}>
          <ThemedText type="smallBold">Your clubs</ThemedText>
          {recent.map((c) => (
            <SwipeAction key={c.code} label="Remove" onAction={() => handleRemove(c)}>
              {(swiped) => (
                <PressableCard
                  onPress={() => {
                    // The web reports letting go of a swipe as a tap.
                    if (!swiped()) choose(c.code);
                  }}
                  actions={[{ label: 'Remove', onPress: () => handleRemove(c) }]}>
                  <View style={styles.clubRow}>
                    <ClubBadge name={c.name} logo={logos[c.code]} />
                    <View style={styles.clubText}>
                      <ThemedText type="smallBold">{c.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {c.code}
                      </ThemedText>
                    </View>
                  </View>
                </PressableCard>
              )}
            </SwipeAction>
          ))}
          {removedNote ?? (
            <ThemedText type="small" themeColor="textSecondary">
              Swipe left on a club to remove it.
            </ThemedText>
          )}
          <ThemedText type="smallBold" style={styles.another}>
            Another club
          </ThemedText>
        </View>
      ) : (
        removedNote
      )}

      <TextField
        label="Club code"
        value={code}
        onChangeText={(value) => {
          setCode(value);
          setError(null);
        }}
        onSubmitEditing={handleContinue}
        accessibilityLabel="Club code"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
      />

      {club ? (
        <Card>
          <ThemedText type="smallBold">{club.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Next, sign in with the account you use for this club.
          </ThemedText>
        </Card>
      ) : null}

      <Button
        title={club ? `Continue to ${club.name}` : 'Continue'}
        onPress={handleContinue}
        disabled={!code.trim()}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
    marginTop: Spacing.five,
  },
  // The 1P mark is 512 by 337.
  logo: {
    width: 160,
    height: 105,
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  recent: {
    gap: Spacing.two,
  },
  clubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  clubText: {
    flex: 1,
  },
  another: {
    marginTop: Spacing.three,
  },
  centred: {
    textAlign: 'center',
  },
});
