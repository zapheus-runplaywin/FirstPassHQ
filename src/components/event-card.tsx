import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { CalendarEvent } from '@/lib/calendar';
import { formatEventTime } from '@/lib/format';

export function EventCard({ event }: { event: CalendarEvent }) {
  return (
    <Card>
      <ThemedText type="smallBold">{event.title}</ThemedText>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatEventTime(event)}
          {event.location ? ` · ${event.location}` : ''}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {event.calendarName}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
