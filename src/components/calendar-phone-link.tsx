import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { phoneLinkUrl } from '@/lib/calendar-phone-link';
import { useClubChoice } from '@/lib/club-choice';
import { supabase } from '@/lib/supabase';

type Asking = 'on' | 'reset' | 'off' | null;

/**
 * The phone link of a calendar kept in the app and shown to everyone, on the
 * admin's Calendars screen: off until an admin turns it on, then copied to
 * send to members, reset (the old link stops working) or turned off. Each
 * change asks once more first, saying what it does.
 */
export function CalendarPhoneLink({
  calendarId,
  token,
  onChanged,
}: {
  calendarId: string;
  /** The link's key, or null while it's off. */
  token: string | null;
  onChanged: () => PromiseLike<unknown>;
}) {
  const theme = useTheme();
  const { club } = useClubChoice();
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(action: 'on' | 'reset' | 'off') {
    setBusy(true);
    setError(null);
    const { error: failed } = await supabase.rpc('admin_set_calendar_phone_link', {
      p_calendar_id: calendarId,
      p_action: action,
    });
    setBusy(false);
    if (failed) {
      setError(failed.message);
      return;
    }
    setAsking(null);
    setCopied(false);
    await onChanged();
  }

  const ask = (what: Asking) => {
    setError(null);
    setAsking(what);
  };

  if (asking) {
    const words = {
      on: {
        title: 'Turn on a phone link?',
        text: 'Members add the link to their phone’s calendar, and this calendar’s events show there beside their own. Anyone who has the link sees each event’s name, time and place without signing in, so send it only to members. It never shows notes or suggested events. You can reset it or turn it off at any time.',
        yes: 'Turn on the phone link',
        no: 'Not now',
      },
      reset: {
        title: 'Reset the phone link?',
        text: 'The link members have now stops working, and their phones stop getting this calendar until they add the new link. Use this if the link has reached someone it shouldn’t.',
        yes: 'Reset the link',
        no: 'Keep this link',
      },
      off: {
        title: 'Turn off the phone link?',
        text: 'Phones that have the link stop getting this calendar. Members still see it in the app.',
        yes: 'Turn off the phone link',
        no: 'Keep it on',
      },
    }[asking];
    return (
      <View style={styles.box} testID="phone-link-confirm">
        <ThemedText type="smallBold">{words.title}</ThemedText>
        <ThemedText type="small">{words.text}</ThemedText>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button
          title={words.yes}
          variant={asking === 'on' ? 'primary' : 'danger'}
          busy={busy}
          onPress={() => change(asking)}
        />
        <Button title={words.no} variant="secondary" disabled={busy} onPress={() => ask(null)} />
      </View>
    );
  }

  if (!token) {
    return (
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">
          Phone link off
        </ThemedText>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => ask('on')}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Turn on
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const link = club ? phoneLinkUrl(club.supabaseUrl, token) : null;
  return (
    <View style={styles.box}>
      <ThemedText type="small" themeColor="textSecondary">
        Phone link on. Send it to members in a message; on their phone they add it as a subscribed
        calendar.
      </ThemedText>
      <Button
        title={copied ? 'Link copied' : 'Copy the phone link'}
        variant="secondary"
        disabled={!link}
        onPress={() => link && Clipboard.setStringAsync(link).then(() => setCopied(true))}
      />
      <View style={styles.row}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => ask('reset')}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Reset link
          </ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => ask('off')}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Turn off
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
  },
});
