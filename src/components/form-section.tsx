import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A titled part of a long form that opens and closes. Closed, it shows a
 * one-line summary of what is set. With no children it can't open.
 */
export function FormSection({
  title,
  summary,
  attention = false,
  initiallyOpen = false,
  children,
}: {
  title: string;
  summary: string;
  /** Shows the summary in the accent colour, for something that needs a look. */
  attention?: boolean;
  initiallyOpen?: boolean;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const canOpen = !!children;
  const shown = open && canOpen;

  return (
    <View style={[styles.section, { borderColor: theme.backgroundElement }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown, disabled: !canOpen }}
        disabled={!canOpen}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [
          styles.header,
          {
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          },
        ]}>
        <View style={styles.flex}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <ThemedText type="small" themeColor={attention ? 'accent' : 'textSecondary'}>
            {summary}
          </ThemedText>
        </View>
        {canOpen ? (
          <ThemedText style={styles.chevron} themeColor="textSecondary">
            {shown ? '▾' : '▸'}
          </ThemedText>
        ) : null}
      </Pressable>
      {shown ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  flex: {
    flex: 1,
    gap: Spacing.half,
  },
  chevron: {
    fontSize: 18,
    lineHeight: 24,
  },
  body: {
    gap: Spacing.three,
    padding: Spacing.three,
  },
});
