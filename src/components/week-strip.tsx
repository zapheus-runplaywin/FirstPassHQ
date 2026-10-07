import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { addDays, dayKey, formatWeekday, isToday } from '@/lib/format';

/**
 * One week, Monday to Sunday, with a dot under days that have events.
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
  /** dayKey of every day with at least one event. */
  eventDays: Set<string>;
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
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: eventDays.has(key)
                    ? selected
                      ? Colors.onAccent
                      : Colors.accent
                    : 'transparent',
                },
              ]}
            />
          </Pressable>
        );
      })}
      <Arrow label="Next week" symbol="›" onPress={() => onChangeWeek(addDays(weekStart, 7))} />
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
