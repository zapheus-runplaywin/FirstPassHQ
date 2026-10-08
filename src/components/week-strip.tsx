import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, type Palette } from '@/constants/theme';
import { useTheme, useThemedStyles } from '@/hooks/use-theme';
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
  earliest,
  latest,
}: {
  weekStart: Date;
  /** Calendar colours with events on each day, by dayKey. */
  eventDays: Map<string, string[]>;
  selectedDay: string | null;
  onSelect: (date: Date) => void;
  onChangeWeek: (weekStart: Date) => void;
  /** The first day the strip may reach; earlier weeks are out of bounds. */
  earliest?: Date;
  /** Days on or after this are out of bounds. */
  latest?: Date;
}) {
  const styles = useThemedStyles(makeStyles);
  const previous = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <View style={styles.strip}>
      <Arrow
        label="Previous week"
        symbol="‹"
        disabled={earliest !== undefined && weekStart <= earliest}
        onPress={() => onChangeWeek(previous)}
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
      <Arrow
        label="Next week"
        symbol="›"
        disabled={latest !== undefined && next >= latest}
        onPress={() => onChangeWeek(next)}
      />
    </View>
  );
}

/** Up to three dots, one per calendar colour with events that day. */
export function DayDots({ colors = [], selected }: { colors?: string[]; selected: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
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
              style={[styles.dot, { backgroundColor: selected ? theme.onAccent : color }]}
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
  disabled = false,
}: {
  label: string;
  symbol: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={[styles.arrow, disabled && styles.arrowDisabled]}>
      <ThemedText style={styles.arrowText}>{symbol}</ThemedText>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
    backgroundColor: colors.accent,
  },
  dayToday: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  weekday: {
    fontSize: 12,
    textTransform: 'uppercase',
  },
  onAccent: {
    color: colors.onAccent,
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
  arrowDisabled: {
    opacity: 0.25,
  },
  arrowText: {
    color: colors.tint,
    fontSize: 28,
    lineHeight: 32,
  },
});
