import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CalendarEvent } from '@/lib/calendar';
import { supabase } from '@/lib/supabase';
import { manageErrorMessage } from '@/lib/team-events';
import { refreshEvents } from '@/lib/use-events';

type Asking = 'cancel' | 'remove' | null;

/**
 * What a squad's or team's coaches and managers can do with an event they
 * added in the app: change it, cancel it (it stays on the calendar, marked
 * cancelled), put a cancelled one back, or remove one that hasn't started.
 * Each asks once more first, and a weekly event offers "this and later weeks".
 */
export function TeamEventManage({ event }: { event: CalendarEvent }) {
  const theme = useTheme();
  const details = event.teamEvent;
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When the page opened: what is offered doesn't change under the member's thumb.
  const [now] = useState(() => Date.now());
  if (!details?.canManage) return null;

  const weekly = details.seriesId !== null;
  const notStarted = event.start.getTime() > now;

  async function run(key: string, call: () => PromiseLike<{ error: { message: string } | null }>, leave = false) {
    setBusy(key);
    setError(null);
    const { error: failed } = await call();
    setBusy(null);
    if (failed) {
      setError(manageErrorMessage(failed.message));
      return;
    }
    setAsking(null);
    refreshEvents(leave ? event.id : undefined);
    if (leave) router.back();
  }

  const cancel = (following: boolean) =>
    run(following ? 'cancel-later' : 'cancel', () =>
      supabase.rpc('cancel_team_event', { p_id: details.id, p_following: following }),
    );
  const remove = (following: boolean) =>
    run(
      following ? 'remove-later' : 'remove',
      () => supabase.rpc('remove_team_event', { p_id: details.id, p_following: following }),
      true,
    );

  if (asking) {
    const cancelling = asking === 'cancel';
    return (
      <Card style={styles.confirm} testID="event-confirm">
        <ThemedText type="smallBold">{cancelling ? 'Cancel this event?' : 'Remove this event?'}</ThemedText>
        <ThemedText type="small">
          {cancelling
            ? 'It stays on the calendar, marked cancelled, so everyone can see it’s off. You can put it back on later.'
            : 'It comes off the calendar altogether, as if it was never added. Use this for an event added by mistake. To call one off, cancel it instead.'}
        </ThemedText>
        <Button
          title={cancelling ? 'Cancel this one' : 'Remove this one'}
          variant="danger"
          busy={busy === asking}
          disabled={busy !== null}
          onPress={() => (cancelling ? cancel(false) : remove(false))}
        />
        {weekly ? (
          <Button
            title={cancelling ? 'Cancel this and later weeks' : 'Remove this and later weeks'}
            variant="dangerOutline"
            busy={busy === `${asking}-later`}
            disabled={busy !== null}
            onPress={() => (cancelling ? cancel(true) : remove(true))}
          />
        ) : null}
        <Button
          title={cancelling ? 'Keep it on' : 'Keep it'}
          variant="secondary"
          disabled={busy !== null}
          onPress={() => setAsking(null)}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    );
  }

  return (
    <View style={styles.manage} testID="event-manage">
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            title="Change"
            variant="secondary"
            onPress={() => router.push({ pathname: '/event/edit', params: { id: event.id } })}
          />
        </View>
        <View style={styles.flex}>
          {event.cancelled ? (
            <Button
              title="Put it back on"
              variant="secondary"
              busy={busy === 'restore'}
              onPress={() =>
                run('restore', () => supabase.rpc('restore_team_event', { p_id: details.id }))
              }
            />
          ) : (
            <Button title="Cancel event" variant="secondary" onPress={() => setAsking('cancel')} />
          )}
        </View>
      </View>
      {notStarted ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setAsking('remove')}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Added by mistake? Remove it
          </ThemedText>
        </Pressable>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  manage: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  confirm: {
    gap: Spacing.two,
  },
});
