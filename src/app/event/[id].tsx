import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, formatEventTime } from '@/lib/format';
import { useEvent } from '@/lib/use-events';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const theme = useTheme();

  if (event === undefined) return <Screen>{null}</Screen>;
  if (event === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This event is no longer on the calendar.
        </ThemedText>
      </Screen>
    );
  }

  const notes = event.description?.trim();

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle" selectable>
          {event.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {event.calendarName}
        </ThemedText>
      </View>

      <Card>
        <Detail label="When">
          {formatDay(event.start)}, {formatEventTime(event)}
        </Detail>
        {event.location ? (
          <View style={styles.whereRow}>
            <View style={styles.whereText}>
              <Detail label="Where">
                <ThemedText
                  type="small"
                  style={{ color: theme.tint }}
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(mapsUrl(event.location!))}>
                  {event.location}
                </ThemedText>
              </Detail>
            </View>
            <CopyButton text={event.location} />
          </View>
        ) : null}
      </Card>

      {notes ? (
        <Card>
          <ThemedText type="smallBold">Notes</ThemedText>
          <ThemedText type="small" selectable>
            {linkify(notes).map((part, i) =>
              part.url ? (
                <ThemedText
                  key={i}
                  type="small"
                  style={{ color: theme.tint }}
                  onPress={() => Linking.openURL(part.url!)}>
                  {part.text}
                </ThemedText>
              ) : (
                part.text
              ),
            )}
          </ThemedText>
        </Card>
      ) : null}
    </Screen>
  );
}

function CopyButton({ text }: { text: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy address"
      hitSlop={8}
      onPress={() => Clipboard.setStringAsync(text).then(() => setCopied(true))}
      style={({ pressed }) => [
        styles.copyButton,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.background },
      ]}>
      <ThemedText type="small" style={{ color: theme.tint }}>
        {copied ? 'Copied' : 'Copy'}
      </ThemedText>
    </Pressable>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small" selectable>
        {children}
      </ThemedText>
    </View>
  );
}

function mapsUrl(location: string) {
  const q = encodeURIComponent(location);
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Splits text so web addresses in event notes can be tapped. */
function linkify(text: string) {
  const parts: { text: string; url?: string }[] = [];
  const pattern = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], url: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  detail: {
    gap: Spacing.half,
  },
  whereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  whereText: {
    flex: 1,
  },
  copyButton: {
    paddingHorizontal: 12,
    paddingVertical: Spacing.one,
    borderRadius: 8,
  },
});
