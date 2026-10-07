import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { CalendarEvent } from '@/lib/calendar';
import {
  dayKey,
  formatEventTime,
  formatMonth,
  formatWeekday,
  isToday,
  monthKey,
} from '@/lib/format';

/**
 * The full calendar as a flat list of month headings and event rows, so the
 * screen can pin each month heading while scrolling. Returns the rows and the
 * positions of the headings.
 */
export function agendaRows(
  events: CalendarEvent[],
  /** Reports where each day starts, so the screen can scroll to it. */
  onDayLayout?: (dayKey: string, y: number) => void,
) {
  const rows: ReactElement[] = [];
  const headingIndexes: number[] = [];
  let month = '';
  let day = '';
  for (const event of events) {
    if (monthKey(event.start) !== month) {
      month = monthKey(event.start);
      headingIndexes.push(rows.length);
      rows.push(<MonthHeading key={`month-${month}`} date={event.start} />);
    }
    const firstOfDay = dayKey(event.start) !== day;
    day = dayKey(event.start);
    const key = day;
    rows.push(
      <AgendaRow
        key={event.id}
        event={event}
        showDate={firstOfDay}
        onLayout={
          firstOfDay && onDayLayout ? (e) => onDayLayout(key, e.nativeEvent.layout.y) : undefined
        }
      />,
    );
  }
  return { rows, headingIndexes };
}

function MonthHeading({ date }: { date: Date }) {
  return (
    <View style={styles.monthHeading}>
      <ThemedText type="smallBold" style={styles.monthText}>
        {formatMonth(date)}
      </ThemedText>
    </View>
  );
}

export function AgendaRow({
  event,
  showDate,
  onLayout,
}: {
  event: CalendarEvent;
  showDate: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const today = isToday(event.start);
  const details = [formatEventTime(event), event.location].filter(Boolean).join(' · ');
  return (
    <Pressable
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${details}, ${event.calendarName}`}
      onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.date, showDate && today && styles.dateToday]}>
        {showDate ? (
          <>
            <ThemedText
              type="small"
              style={[styles.weekday, today && styles.onAccent]}
              themeColor="textSecondary">
              {today ? 'Today' : formatWeekday(event.start)}
            </ThemedText>
            <ThemedText style={[styles.dayNumber, today && styles.onAccent]}>
              {event.start.getDate()}
            </ThemedText>
          </>
        ) : null}
      </View>
      <View style={styles.card}>
        <View
          style={[
            styles.stripe,
            { backgroundColor: event.color },
          ]}
        />
        <View style={styles.cardText}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {event.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {details}
          </ThemedText>
          {!event.clubWide ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {event.calendarName}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  monthHeading: {
    backgroundColor: Colors.background,
    paddingVertical: Spacing.two,
  },
  monthText: {
    color: Colors.tint,
    fontSize: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  rowPressed: {
    opacity: 0.7,
  },
  date: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: Spacing.one,
  },
  dateToday: {
    backgroundColor: Colors.accent,
  },
  weekday: {
    textTransform: 'uppercase',
    fontSize: 12,
  },
  dayNumber: {
    color: Colors.tint,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: 700,
  },
  onAccent: {
    color: Colors.onAccent,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.backgroundElement,
  },
  stripe: {
    width: 4,
  },
  cardText: {
    flex: 1,
    padding: 12,
    gap: Spacing.half,
  },
});
