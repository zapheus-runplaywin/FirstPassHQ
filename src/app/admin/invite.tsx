import * as Clipboard from 'expo-clipboard';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import createQrCode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useClub } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';

/** A QR code as an image: black squares on white, with a quiet border so cameras find it. */
function qrImage(text: string) {
  const code = createQrCode(0, 'M');
  code.addData(text);
  code.make();
  return code.createDataURL(8, 4);
}

/**
 * firstpasshq://club/CODE, which opens the installed app on that club. Expo Go
 * can only open its own exp:// addresses, so there it's one of those.
 */
function joinLink(code: string) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return Linking.createURL(`club/${code}`);
  }
  return `${Constants.expoConfig?.scheme ?? 'firstpasshq'}://club/${code}`;
}

/**
 * The club's join link and QR code, for admins to share. Scanning or opening it
 * picks this club in the app, so new members go straight to its sign-in.
 */
export default function InviteScreen() {
  const { club: chosen } = useClubChoice();
  const club = useClub();
  const [copied, setCopied] = useState(false);
  const code = chosen?.code ?? '';
  const link = joinLink(code);
  const qr = useMemo(() => qrImage(link), [link]);
  const message =
    `Join ${club.name} on FirstPass HQ. Install the FirstPass HQ app, then open ${link} ` +
    `or enter the club code ${code}.`;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        New members scan this code with their phone’s camera, or open the link, and the app takes
        them to {club.name}’s sign-in. They still ask to join, with the club password if there is
        one, and an admin approves them.
      </ThemedText>

      <View style={styles.qrFrame}>
        <Image
          source={{ uri: qr }}
          style={styles.qr}
          contentFit="contain"
          accessibilityLabel={`QR code for ${club.name}`}
        />
      </View>

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Club code
        </ThemedText>
        <ThemedText type="subtitle" selectable>
          {code}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {link}
        </ThemedText>
      </Card>

      <Button title="Share invite" onPress={() => Share.share({ message })} />
      <Button
        title={copied ? 'Link copied' : 'Copy link'}
        variant="secondary"
        onPress={() => Clipboard.setStringAsync(link).then(() => setCopied(true))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  qrFrame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: Spacing.two,
  },
  qr: {
    width: 240,
    height: 240,
  },
});
