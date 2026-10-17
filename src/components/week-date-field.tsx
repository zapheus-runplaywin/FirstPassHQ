import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, dayKey, formatMonth, formatShortDay, startOfWeek } from '@/lib/format';
import { parseDateString, toDateString } from '@/lib/injuries';

const NO_DAYS = new Map<string, string[]>();

/**
 * Picks a day from a week at a time, Monday to Sunday, with arrows to move
 * between weeks. `value` is a "2026-10-07" style date, or null for none.
 */
export function WeekDateField({
  label,
  value,
  onChange,
  emptyLabel,
  clearLabel,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Shown when no day is picked. */
  emptyLabel: string;
  /** The button that un-picks the day. */
  clearLabel: string;
}) {
  const theme = useTheme();
  const picked = value ? parseDateString(value) : null;
  const [weekStart, setWeekStart] = useState(() => startOfWeek(picked ?? new Date()));

  return (
    <View style={styles.field}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {/* Thursday decides the month, so a week across two months takes the one it mostly sits in. */}
        <ThemedText type="small" themeColor="textSecondary">
          {formatMonth(addDays(weekStart, 3))}
        </ThemedText>
      </View>
      <View style={[styles.strip, { backgroundColor: theme.backgroundElement }]}>
        <WeekStrip
          weekStart={weekStart}
          eventDays={NO_DAYS}
          selectedDay={picked ? dayKey(picked) : null}
          onSelect={(date) => onChange(toDateString(date))}
          onChangeWeek={setWeekStart}
        />
      </View>
      <View style={styles.header}>
        <ThemedText type="small" themeColor={picked ? undefined : 'textSecondary'}>
          {picked ? formatShortDay(picked) : emptyLabel}
        </ThemedText>
        {picked ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onChange(null)}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {clearLabel}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  strip: {
    borderRadius: 12,
    padding: Spacing.one,
  },
});
