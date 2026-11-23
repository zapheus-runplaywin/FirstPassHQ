import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';

import { useInCardGrid } from '@/components/columns';
import { useRevealFocusedInput } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Red, for actions that can't be undone. */
const DANGER = '#FF5A5A';

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  // In a CardGrid row, every card is as tall as the tallest.
  const inGrid = useInCardGrid();
  return (
    <View
      style={[
        styles.card,
        inGrid && styles.fill,
        { backgroundColor: theme.backgroundElement },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * A tappable card. `actions` are extra things a screen reader offers from the
 * card's actions menu, such as "Archive" on a message that can be swiped.
 */
export function PressableCard({
  onPress,
  children,
  actions,
}: {
  onPress: () => void;
  children: ReactNode;
  actions?: { label: string; onPress: () => void }[];
}) {
  const theme = useTheme();
  const inGrid = useInCardGrid();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityActions={actions?.map((a) => ({
        name: a.label,
        label: a.label,
      }))}
      onAccessibilityAction={(e) =>
        actions?.find((a) => a.label === e.nativeEvent.actionName)?.onPress()
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        inGrid && styles.fill,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      {children}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const filled = primary || variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary
            ? theme.accent
            : variant === 'danger'
              ? DANGER
              : theme.backgroundElement,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}>
      {busy ? (
        <ActivityIndicator color={filled ? theme.onAccent : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={filled ? { color: theme.onAccent } : undefined}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function TextField({ label, onFocus, ...rest }: TextInputProps & { label: string }) {
  const theme = useTheme();
  const revealFocusedInput = useRevealFocusedInput();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          rest.multiline && styles.multiline,
          { backgroundColor: theme.backgroundElement, color: theme.text },
        ]}
        onFocus={(event) => {
          onFocus?.(event);
          // When moving between fields the keyboard is already up, so it won't
          // announce itself again.
          if (Keyboard.isVisible()) revealFocusedInput();
        }}
        {...rest}
      />
    </View>
  );
}

export function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label?: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onToggle(option.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? theme.accent : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="small" style={isSelected ? { color: theme.onAccent } : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A delete button that asks once more before doing anything, explaining what
 * will be lost.
 */
export function ConfirmDelete({
  title,
  warning,
  confirmTitle,
  onConfirm,
  busy = false,
}: {
  title: string;
  warning: string;
  confirmTitle: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <Button title={title} variant="secondary" onPress={() => setConfirming(true)} />;
  }
  return (
    <Card style={styles.confirm}>
      <ThemedText type="small">{warning}</ThemedText>
      <Button title={confirmTitle} variant="danger" onPress={onConfirm} busy={busy} />
      <Button title="Cancel" variant="secondary" onPress={() => setConfirming(false)} />
    </Card>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <ThemedText type="small" style={styles.error}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.one,
  },
  fill: {
    flexGrow: 1,
  },
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    fontFamily: BrandFonts.regular,
    fontSize: 16,
  },
  multiline: {
    height: undefined,
    minHeight: 144,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    textAlignVertical: 'top',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  confirm: {
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: DANGER,
  },
  error: {
    color: '#DC2626',
  },
});
