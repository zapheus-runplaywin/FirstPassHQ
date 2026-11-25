import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A question answered on a scale of 1 (bad) to 5 (good). */
export function CheckInScale({
  question,
  answers,
  value,
  onChange,
  disabled = false,
}: {
  question: string;
  answers: string[];
  value: number | null;
  onChange: (value: number) => void;
  /** While a save is on its way. */
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.questionRow}>
        <ThemedText type="smallBold">{question}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {value ? answers[value - 1] : ''}
        </ThemedText>
      </View>
      <View style={styles.scale}>
        {answers.map((label, index) => {
          const score = index + 1;
          const selected = value === score;
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={`${score}: ${label}`}
              accessibilityState={{ selected }}
              // Only while saving: Pressable adds it to what a screen reader hears.
              disabled={disabled ? true : undefined}
              onPress={() => onChange(score)}
              style={({ pressed }) => [
                styles.score,
                {
                  backgroundColor: selected
                    ? theme.accent
                    : pressed
                      ? theme.backgroundSelected
                      : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="smallBold" style={selected ? { color: theme.onAccent } : undefined}>
                {score}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ends}>
        <ThemedText type="small" themeColor="textSecondary">
          {answers[0]}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {answers[answers.length - 1]}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  questionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  scale: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  score: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
