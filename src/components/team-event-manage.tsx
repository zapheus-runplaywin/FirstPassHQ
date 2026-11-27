import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import type { CalendarEvent } from '@/lib/calendar';
import { supabase } from '@/lib/supabase';
import { manageErrorMessage } from '@/lib/team-events';
import { refreshEvents } from '@/lib/use-events';

type Asking = 'cancel' | 'remove' | 'decline' | null;

/**
 * What can be done with an event added in the app.
 *
 * A squad's or team's event, by its coaches and managers, and an event on a
 * calendar kept in the app, by admins: change it, cancel it (it stays on the
 * calendar, marked cancelled), put a cancelled one back, or remove one that
 * hasn't started. Each asks once more first, and a weekly event offers "this
 * and later weeks".
 *
 * A suggestion for a calendar kept in the app: an admin adds it to the
 * calendar, changes it first, or declines it with a reason; the person who
 * suggested it changes it or takes it back while it waits, and clears it away
 * once declined.
 */
export function TeamEventManage({ event }: { event: CalendarEvent }) {
  const theme = useTheme();
  const { isAdmin } = useAuth();
  const details = event.teamEvent;
  const [asking, setAsking] = useState<Asking>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When the page opened: what is offered doesn't change under the member's thumb.
  const [now] = useState(() => Date.now());
  if (!details) return null;
  // A declined suggestion can still be cleared away by the person who made it.
  const ownDeclined = event.pending === 'declined' && !!details.mine;
  if (!details.canManage && !ownDeclined) return null;

  const inApp = !!details.hqCalendarId;
  const weekly = details.seriesId !== null;
  const notStarted = event.start.getTime() > now;
  const rpc = {
    cancel: inApp ? 'cancel_hq_event' : 'cancel_team_event',
    restore: inApp ? 'restore_hq_event' : 'restore_team_event',
    remove: inApp ? 'remove_hq_event' : 'remove_team_event',
  } as const;

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
      supabase.rpc(rpc.cancel, { p_id: details.id, p_following: following }),
    );
  const remove = (following: boolean) =>
    run(
      following ? 'remove-later' : 'remove',
      () => supabase.rpc(rpc.remove, { p_id: details.id, p_following: following }),
      true,
    );
  const decide = (accept: boolean) =>
    run(
      accept ? 'accept' : 'decline',
      () =>
        supabase.rpc('decide_event_suggestion', {
          p_id: details.id,
          p_accept: accept,
          p_reason: accept ? null : reason,
        }),
      // Declined, it leaves the admin's calendar; accepted, it stays to look at.
      !accept,
    );
  const change = () => router.push({ pathname: '/event/edit', params: { id: event.id } });

  if (asking === 'decline') {
    return (
      <Card style={styles.confirm} testID="event-confirm">
        <ThemedText type="smallBold">Decline this suggestion?</ThemedText>
        <ThemedText type="small">
          {details.createdByName ?? 'The person who suggested it'} sees your reason. Nobody else
          sees the suggestion.{weekly ? ' Every week of it is declined.' : ''}
        </ThemedText>
        <TextField
          label="Why"
          value={reason}
          maxLength={300}
          multiline
          placeholder="Such as The hall is booked that night"
          onChangeText={setReason}
        />
        <Button
          title="Decline it"
          variant="danger"
          busy={busy === 'decline'}
          disabled={busy !== null}
          onPress={() => {
            if (!reason.trim()) setError('Say why, so they know.');
            else decide(false);
          }}
        />
        <Button title="Go back" variant="secondary" disabled={busy !== null} onPress={() => setAsking(null)} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    );
  }

  if (asking) {
    const cancelling = asking === 'cancel';
    // A suggestion was never on the calendar, so taking it back needs fewer words.
    const suggestion = !!event.pending;
    return (
      <Card style={styles.confirm} testID="event-confirm">
        <ThemedText type="smallBold">
          {cancelling ? 'Cancel this event?' : suggestion ? 'Take this suggestion away?' : 'Remove this event?'}
        </ThemedText>
        <ThemedText type="small">
          {cancelling
            ? 'It stays on the calendar, marked cancelled, so everyone can see it’s off. You can put it back on later.'
            : suggestion
              ? 'It was never on the calendar, so nobody else notices.'
              : 'It comes off the calendar altogether, as if it was never added. Use this for an event added by mistake. To call one off, cancel it instead.'}
        </ThemedText>
        <Button
          title={cancelling ? 'Cancel this one' : suggestion ? 'Take this one away' : 'Remove this one'}
          variant="danger"
          busy={busy === asking}
          disabled={busy !== null}
          onPress={() => (cancelling ? cancel(false) : remove(false))}
        />
        {weekly ? (
          <Button
            title={
              cancelling
                ? 'Cancel this and later weeks'
                : suggestion
                  ? 'Take away this and later weeks'
                  : 'Remove this and later weeks'
            }
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

  // A suggestion waiting for an admin, as an admin sees it: the answer first.
  if (event.pending === 'suggested' && isAdmin) {
    return (
      <View style={styles.manage} testID="event-manage">
        <Button
          title={weekly ? 'Add every week to the calendar' : 'Add to the calendar'}
          busy={busy === 'accept'}
          disabled={busy !== null}
          onPress={() => decide(true)}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button title="Change it first" variant="secondary" disabled={busy !== null} onPress={change} />
          </View>
          <View style={styles.flex}>
            <Button
              title="Decline"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => {
                setError(null);
                setAsking('decline');
              }}
            />
          </View>
        </View>
        {weekly ? (
          <ThemedText type="small" themeColor="textSecondary">
            Changing it first adds this week only, as you change it. The other weeks keep waiting.
          </ThemedText>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    );
  }

  // The member's own suggestion: change it or take it back while it waits,
  // and clear it away once it's declined.
  if (event.pending) {
    return (
      <View style={styles.manage} testID="event-manage">
        <View style={styles.row}>
          {event.pending === 'suggested' ? (
            <View style={styles.flex}>
              <Button title="Change" variant="secondary" onPress={change} />
            </View>
          ) : null}
          <View style={styles.flex}>
            <Button
              title={event.pending === 'suggested' ? 'Take it back' : 'Clear it away'}
              variant="secondary"
              onPress={() => setAsking('remove')}
            />
          </View>
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </View>
    );
  }

  return (
    <View style={styles.manage} testID="event-manage">
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Change" variant="secondary" onPress={change} />
        </View>
        <View style={styles.flex}>
          {event.cancelled ? (
            <Button
              title="Put it back on"
              variant="secondary"
              busy={busy === 'restore'}
              onPress={() => run('restore', () => supabase.rpc(rpc.restore, { p_id: details.id }))}
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
