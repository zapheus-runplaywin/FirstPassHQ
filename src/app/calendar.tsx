import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { EventCard } from '@/components/event-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDay, groupByDay } from '@/lib/format';
import { useEvents } from '@/lib/use-events';

export default function CalendarScreen() {
  const { events, failed, reload } = useEvents();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {failed.length > 0 ? (
        <ErrorText>
          {Platform.OS === 'web'
            ? 'Outlook calendars only load in the phone app, because web browsers block them. Open the app in Expo Go to see events.'
            : `Couldn't load ${failed.join(', ')}. Pull down to try again.`}
        </ErrorText>
      ) : null}
      {events === null ? null : events.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing on the calendar yet.
        </ThemedText>
      ) : (
        groupByDay(events).map((day) => (
          <View key={day.key} style={styles.day}>
            <ThemedText type="smallBold">{formatDay(day.date)}</ThemedText>
            {day.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: {
    gap: Spacing.two,
  },
});
