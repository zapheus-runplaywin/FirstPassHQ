import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
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
  selected,
}: {
  onPress: () => void;
  children: ReactNode;
  actions?: { label: string; onPress: () => void }[];
  /** The item this card opens is showing beside the list (src/components/list-detail.tsx). */
  selected?: boolean;
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
      // Said only where a card can be the chosen one, so other cards read as plain buttons.
      {...(selected === undefined
        ? {}
        : { accessibilityState: { selected }, 'aria-selected': selected })}
      style={({ pressed }) => [
        styles.card,
        inGrid && styles.fill,
        {
          backgroundColor:
            pressed || selected ? theme.backgroundSelected : theme.backgroundElement,
        },
        selected && styles.chosen,
      ]}>
      {/* Laid over the card's edge, so the card's contents don't move when it is chosen. */}
      {selected ? (
        <View testID="chosen-edge" style={[styles.chosenEdge, { backgroundColor: theme.accent }]} />
      ) : null}
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
  oneLine = false,
}: {
  label?: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  /**
   * Keeps the chips on one line, tighter, as tabs. If they still don't fit
   * (large text sizes), the line scrolls sideways rather than wrapping.
   */
  oneLine?: boolean;
}) {
  const theme = useTheme();
  const chips = options.map((option) => {
    const isSelected = selected.includes(option.value);
    return (
      <Pressable
        key={option.value}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        onPress={() => onToggle(option.value)}
        style={[
          styles.chip,
          oneLine && styles.tightChip,
          {
            backgroundColor: isSelected ? theme.accent : theme.backgroundElement,
          },
        ]}>
        <ThemedText
          type="small"
          numberOfLines={oneLine ? 1 : undefined}
          style={isSelected ? { color: theme.onAccent } : undefined}>
          {option.label}
        </ThemedText>
      </Pressable>
    );
  });
  if (oneLine) {
    return (
      <View style={styles.field}>
        {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipLine}>
          {chips}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={styles.field}>
      {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
      <View style={styles.chips}>{chips}</View>
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
  chosen: {
    // Keeps the edge inside the card's rounded corners.
    overflow: 'hidden',
  },
  chosenEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
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
  tightChip: {
    paddingHorizontal: 12,
  },
  chipLine: {
    flexDirection: 'row',
    gap: Spacing.two,
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
