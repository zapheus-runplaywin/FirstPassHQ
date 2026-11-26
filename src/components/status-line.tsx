import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * How a line of status reads: quietly, as something that needs the member, or
 * as done. Never in the club's colour, which is kept for buttons, links and
 * the current tab: on a gold club a warning mustn't look like a link.
 */
export type StatusTone = 'quiet' | 'attention' | 'done';

/**
 * One line saying where something is up to. What needs the member is bold in
 * the text colour with a ! in a circle; done is green with a tick; anything
 * else is quiet.
 */
export function StatusLine({
  text,
  tone = 'quiet',
  bold = false,
  inline = false,
  style,
}: {
  text: string;
  tone?: StatusTone;
  /** Bold whatever the tone, for a status that is also a heading. */
  bold?: boolean;
  /** Set at the end of a row, where the line is only as wide as its words. */
  inline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const type = bold ? 'smallBold' : 'small';
  if (tone === 'quiet') {
    return (
      <ThemedText type={type} themeColor="textSecondary" style={style}>
        {text}
      </ThemedText>
    );
  }
  const done = tone === 'done';
  return (
    <View style={[styles.status, style]} testID={done ? 'status-done' : 'status-attention'}>
      <Icon
        name={done ? 'check' : 'alert-circle'}
        size={14}
        color={done ? theme.positive : theme.attention}
        style={styles.mark}
      />
      <ThemedText
        type={type}
        themeColor={done ? 'positive' : 'attention'}
        style={inline ? undefined : styles.text}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  // Level with the first line of the text beside it.
  mark: {
    marginTop: 3,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
