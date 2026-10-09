import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PoweredByFirstPass } from '@/components/firstpass-logo';
import { PdfView } from '@/components/pdf-view';
import { ThemedText } from '@/components/themed-text';
import { ZoomableImage } from '@/components/zoomable-image';
import { FirstPass } from '@/constants/club';
import { Spacing } from '@/constants/theme';
import { isImageDocument } from '@/lib/injuries';

/**
 * Shows a private document, such as proof of clearance or a training
 * certificate, inside the app from a short-lived link. There is no save or
 * share button here, and nothing is kept on the phone.
 */
export function DocumentViewer({
  path,
  name,
  fallbackName,
  signedUrl,
}: {
  path: string;
  name?: string;
  /** Used for the title and photo label when the file has no name. */
  fallbackName: string;
  signedUrl: (path: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const image = isImageDocument(path);

  useEffect(() => {
    let current = true;
    signedUrl(path)
      .then((signed) => current && setUrl(signed))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [path, signedUrl]);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <Stack.Screen options={{ title: name || 'Document' }} />
      <SafeAreaView style={styles.fill} edges={['bottom', 'left', 'right']}>
        {error ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            {error}
          </ThemedText>
        ) : !url ? (
          <View style={styles.centre}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : image ? (
          <>
            <ZoomableImage
              uri={url}
              label={name || fallbackName}
              onError={() => setError('This photo couldn’t be shown. Go back and try again.')}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Pinch to zoom. Double-tap to zoom in or back out.
            </ThemedText>
          </>
        ) : (
          <PdfView uri={url} />
        )}
        <PoweredByFirstPass />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: FirstPass.navy,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    padding: Spacing.four,
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
    padding: Spacing.two,
  },
});
