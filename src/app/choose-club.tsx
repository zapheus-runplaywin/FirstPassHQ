import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { findClub } from '@/constants/clubs';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { firstPassLogo } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';

/**
 * Finds the member's club by its code. Each club has its own database, so this
 * decides which one the app connects to. Only shown when the app serves more
 * than one club.
 */
export default function ChooseClubScreen() {
  const theme = useTheme();
  const { choose } = useClubChoice();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const club = findClub(code);

  function handleContinue() {
    if (!club || !choose(club.code)) {
      setError('No club has that code. Check it with your club.');
    }
  }

  return (
    <Screen withTopInset>
      <View style={styles.header}>
        <Image
          source={firstPassLogo(theme.background)}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="FirstPass HQ"
        />
        <ThemedText type="subtitle" style={styles.centred}>
          Find your club
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centred}>
          Your club gives you its club code, or a link that fills it in.
        </ThemedText>
      </View>

      <TextField
        label="Club code"
        value={code}
        onChangeText={(value) => {
          setCode(value);
          setError(null);
        }}
        onSubmitEditing={handleContinue}
        placeholder="For example THUNDER"
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
  logo: {
    width: 300,
    height: 49,
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  centred: {
    textAlign: 'center',
  },
});
