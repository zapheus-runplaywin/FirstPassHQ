import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Arrow, DayDots } from '@/components/week-strip';
import { Colors, Spacing } from '@/constants/theme';
import { addDays, dayKey, formatMonth, isToday, startOfWeek } from '@/lib/format';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A classic month calendar with coloured dots under days that have events. */
export function MonthGrid({
  month,
  eventDays,
  selectedDay,
  onSelect,
  onChangeMonth,
}: {
  /** Any date in the month to show. */
  month: Date;
  /** Calendar colours with events on each day, by dayKey. */
  eventDays: Map<string, string[]>;
  selectedDay: string | null;
  onSelect: (date: Date) => void;
  onChangeMonth: (month: Date) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const weeks: Date[][] = [];
  for (let start = gridStart; weeks.length < 6; start = addDays(start, 7)) {
    if (weeks.length > 0 && start.getMonth() !== first.getMonth()) break;
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }

  return (
    <View style={styles.grid}>
      <View style={styles.header}>
        <Arrow
          label="Previous month"
          symbol="‹"
          onPress={() => onChangeMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1))}
        />
        <ThemedText type="smallBold" style={styles.monthName}>
          {formatMonth(first)}
        </ThemedText>
        <Arrow
          label="Next month"
          symbol="›"
          onPress={() => onChangeMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1))}
        />
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.weekday}>
            {d}
          </ThemedText>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={dayKey(week[0])} style={styles.week}>
          {week.map((date) => {
            const key = dayKey(date);
            const inMonth = date.getMonth() === first.getMonth();
            const selected = key === selectedDay;
            const today = isToday(date);
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={date.toDateString()}
                onPress={() => onSelect(date)}
                style={[
                  styles.cell,
                  selected && styles.cellSelected,
                  today && !selected && styles.cellToday,
                ]}>
                <ThemedText
                  type="small"
                  themeColor={inMonth ? 'text' : 'textSecondary'}
                  style={[!inMonth && styles.outside, selected && styles.onAccent]}>
                  {date.getDate()}
                </ThemedText>
                <DayDots colors={eventDays.get(key)} selected={selected} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.one,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.two,
  },
  monthName: {
    fontSize: 16,
  },
  week: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    gap: Spacing.half,
  },
  cellSelected: {
    backgroundColor: Colors.accent,
  },
  cellToday: {
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  outside: {
    opacity: 0.4,
  },
  onAccent: {
    color: Colors.onAccent,
  },
});
