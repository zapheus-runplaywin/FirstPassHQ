import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonthGrid } from '@/components/month-grid';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayKey } from '@/lib/format';
import { formatDateString, parseDateString, toDateString } from '@/lib/injuries';

const noEvents = new Map<string, string[]>();

/**
 * Picks a day from a month calendar, for dates that can be many months away.
 * `value` is a "2026-10-07" style date.
 */
export function MonthDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const [month, setMonth] = useState(() => (value ? parseDateString(value) : new Date()));
  const [shownValue, setShownValue] = useState(value);

  // Show the chosen day's month when the value is loaded or changed elsewhere.
  if (value !== shownValue) {
    setShownValue(value);
    if (value) {
      const date = parseDateString(value);
      if (date.getFullYear() !== month.getFullYear() || date.getMonth() !== month.getMonth()) {
        setMonth(date);
      }
    }
  }

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.value}>
          {value ? formatDateString(value) : 'Choose a day'}
        </ThemedText>
        <MonthGrid
          month={month}
          eventDays={noEvents}
          selectedDay={value ? dayKey(parseDateString(value)) : null}
          onSelect={(date) => onChange(toDateString(date))}
          onChangeMonth={setMonth}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  box: {
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  value: {
    textAlign: 'center',
  },
});
