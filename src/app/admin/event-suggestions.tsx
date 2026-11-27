import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatEventTime, formatShortDay } from '@/lib/format';
import { waitingSuggestions } from '@/lib/team-events';
import { useEvents } from '@/lib/use-events';

/**
 * Events coaches, managers and committee members have suggested for a
 * calendar kept in the app, waiting for an admin: soonest first, a weekly one
 * once. Each opens the event, where the admin adds it, changes it first or
 * declines it.
 */
export default function EventSuggestionsScreen() {
  const { events, showMonthsAhead } = useEvents();
  // A suggestion can be for any day in the year ahead.
  useEffect(() => showMonthsAhead(12), [showMonthsAhead]);
  const waiting = useMemo(() => waitingSuggestions(events ?? []), [events]);

  if (events === null) return <Screen>{null}</Screen>;

  return (
    <Screen gap={Spacing.three}>
      <ThemedText type="small" themeColor="textSecondary">
        {waiting.length === 0
          ? 'No suggested events are waiting. When a coach, manager or committee member suggests one for a calendar kept in the app, it shows here.'
          : 'Only you, the other admins and the person who suggested each one see these until you add them.'}
      </ThemedText>
      {waiting.map(({ event, weeks }) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
          <Card style={styles.card}>
            <View style={[styles.stripe, { backgroundColor: event.color }]} />
            <View style={styles.text}>
              <ThemedText type="smallBold" numberOfLines={2}>
                {event.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatShortDay(event.start)} · {formatEventTime(event)}
                {weeks > 1 ? ` · weekly, ${weeks} weeks` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {[event.teamEvent?.createdByName, event.calendarName].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              ›
            </ThemedText>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stripe: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
});
