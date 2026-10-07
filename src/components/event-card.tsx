import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CalendarEvent } from '@/lib/calendar';
import { formatEventTime, formatShortDay } from '@/lib/format';

/** Events as compact tiles, two to a row. */
export function EventGrid({ events, showDay = false }: { events: CalendarEvent[]; showDay?: boolean }) {
  const rows: CalendarEvent[][] = [];
  for (let i = 0; i < events.length; i += 2) rows.push(events.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row[0].id} style={styles.row}>
          {row.map((event) => (
            <EventTile key={event.id} event={event} showDay={showDay} />
          ))}
          {row.length === 1 ? <View style={styles.tileSpace} /> : null}
        </View>
      ))}
    </View>
  );
}

function EventTile({ event, showDay }: { event: CalendarEvent; showDay: boolean }) {
  const theme = useTheme();
  const when = showDay
    ? `${formatShortDay(event.start)} · ${formatEventTime(event)}`
    : formatEventTime(event);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${when}${event.location ? `, ${event.location}` : ''}`}
      onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {when}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={2}>
        {event.title}
      </ThemedText>
      {event.location ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {event.location}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tile: {
    flex: 1,
    minHeight: 96,
    padding: 12,
    borderRadius: 12,
    gap: Spacing.half,
  },
  tileSpace: {
    flex: 1,
  },
});
