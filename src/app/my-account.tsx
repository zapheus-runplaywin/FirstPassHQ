import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { signInMethod } from '@/lib/sign-in';

/**
 * My account, from the Me tab: how the member signs in, and the way to delete
 * their account. Delete sits here, alone at the bottom in red, rather than on
 * the Me tab beside Switch club and Sign out, where it could be tapped for one
 * of them. Pressing it opens the delete screen, which explains what is removed
 * and asks again before anything happens.
 */
export default function MyAccountScreen() {
  const club = useClub();
  const { session } = useAuth();
  const method = signInMethod(session?.user);
  const email = session?.user.email;

  return (
    <Screen>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Signed in with
        </ThemedText>
        <ThemedText>
          {[method, email].filter(Boolean).join(' · ') || 'Your sign-in account'}
        </ThemedText>
      </Card>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Club
        </ThemedText>
        <ThemedText>{club.name}</ThemedText>
      </Card>

      <View style={styles.danger}>
        <Button
          title="Delete my account"
          variant="dangerOutline"
          onPress={() => router.push('/delete-account')}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          Removes your account for good. You’ll see what is deleted and confirm before
          anything happens.
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  danger: {
    marginTop: Spacing.five,
    gap: Spacing.two,
  },
  note: {
    textAlign: 'center',
  },
});
