import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipGroup } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateString, parseDateString, toDateString } from '@/lib/injuries';

/**
 * Picks a calendar day with back and forward arrows, plus a few quick choices.
 * `value` is a "2026-10-07" style date, or null when `optional` and unset.
 */
export function DateField({
  label,
  value,
  onChange,
  quickPicks,
  max,
  optional = false,
  emptyLabel = 'Not sure',
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  quickPicks: { label: string; days: number }[];
  max?: string;
  optional?: boolean;
  /** The choice that leaves an optional date unset. */
  emptyLabel?: string;
}) {
  const theme = useTheme();
  const today = toDateString(new Date());

  function shift(days: number) {
    const date = parseDateString(value ?? today);
    date.setDate(date.getDate() + days);
    const next = toDateString(date);
    onChange(max && next > max ? max : next);
  }

  function fromToday(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return toDateString(date);
  }

  const options = quickPicks.map((pick) => ({
    value: fromToday(pick.days),
    label: pick.label,
  }));
  if (optional) options.push({ value: '', label: emptyLabel });

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <Arrow label="Day before" symbol="‹" onPress={() => shift(-1)} />
        <ThemedText style={styles.value}>
          {value
            ? formatDateString(value)
            : emptyLabel === 'Not sure'
              ? 'Not sure yet'
              : emptyLabel}
        </ThemedText>
        <Arrow
          label="Day after"
          symbol="›"
          onPress={() => shift(1)}
          disabled={!!max && (value ?? today) >= max}
        />
      </View>
      <ChipGroup
        options={options}
        selected={[value ?? '']}
        onToggle={(next) => onChange(next || null)}
      />
    </View>
  );
}

function Arrow({
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
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.arrow, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}>
      <ThemedText type="subtitle" style={{ color: theme.tint }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
  },
  arrow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    flex: 1,
    textAlign: 'center',
  },
});
