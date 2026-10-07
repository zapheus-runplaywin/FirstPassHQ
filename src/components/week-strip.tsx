import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { addDays, dayKey, formatWeekday, isToday } from '@/lib/format';

/**
 * One week, Monday to Sunday, with a dot in each calendar's colour under days
 * that have events.
 * Tapping a day selects it.
 */
export function WeekStrip({
  weekStart,
  eventDays,
  selectedDay,
  onSelect,
  onChangeWeek,
}: {
  weekStart: Date;
  /** Calendar colours with events on each day, by dayKey. */
  eventDays: Map<string, string[]>;
  selectedDay: string | null;
  onSelect: (date: Date) => void;
  onChangeWeek: (weekStart: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <View style={styles.strip}>
      <Arrow
        label="Previous week"
        symbol="‹"
        onPress={() => onChangeWeek(addDays(weekStart, -7))}
      />
      {days.map((date) => {
        const key = dayKey(date);
        const today = isToday(date);
        const selected = key === selectedDay;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={date.toDateString()}
            onPress={() => onSelect(date)}
            style={[
              styles.day,
              selected && styles.daySelected,
              today && !selected && styles.dayToday,
            ]}>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={[styles.weekday, selected && styles.onAccent]}>
              {formatWeekday(date).slice(0, 1)}
            </ThemedText>
            <ThemedText type="smallBold" style={selected && styles.onAccent}>
              {date.getDate()}
            </ThemedText>
            <DayDots colors={eventDays.get(key)} selected={selected} />
          </Pressable>
        );
      })}
      <Arrow label="Next week" symbol="›" onPress={() => onChangeWeek(addDays(weekStart, 7))} />
    </View>
  );
}

/** Up to three dots, one per calendar colour with events that day. */
export function DayDots({ colors = [], selected }: { colors?: string[]; selected: boolean }) {
  return (
    <View style={styles.dots}>
      {colors.length === 0 ? (
        <View style={styles.dot} />
      ) : (
        colors
          .slice(0, 3)
          .map((color) => (
            <View
              key={color}
              style={[styles.dot, { backgroundColor: selected ? Colors.onAccent : color }]}
            />
          ))
      )}
    </View>
  );
}

export function Arrow({
  label,
  symbol,
  onPress,
}: {
  label: string;
  symbol: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={styles.arrow}>
      <ThemedText style={styles.arrowText}>{symbol}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  day: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 12,
    gap: Spacing.half,
  },
  daySelected: {
    backgroundColor: Colors.accent,
  },
  dayToday: {
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  weekday: {
    fontSize: 12,
    textTransform: 'uppercase',
  },
  onAccent: {
    color: Colors.onAccent,
  },
  dots: {
    flexDirection: 'row',
    gap: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  arrow: {
    paddingHorizontal: Spacing.one,
  },
  arrowText: {
    color: Colors.tint,
    fontSize: 28,
    lineHeight: 32,
  },
});
