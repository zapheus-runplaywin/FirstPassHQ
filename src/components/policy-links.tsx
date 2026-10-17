import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClubPolicies } from '@/lib/consents';

/**
 * Links to the club's privacy policy, safeguarding policy and code of
 * conduct, for whichever the club has added. Nothing shows when none are.
 */
export function PolicyLinks({ intro, centred }: { intro?: string; centred?: boolean }) {
  const policies = useClubPolicies();
  const theme = useTheme();
  const links = [
    { label: 'Privacy policy', url: policies?.privacy_policy_url },
    { label: 'Child safeguarding policy', url: policies?.safeguarding_policy_url },
    { label: 'Code of conduct', url: policies?.code_of_conduct_url },
  ].filter((l): l is { label: string; url: string } => !!l.url);
  if (links.length === 0) return null;
  return (
    <View style={styles.box}>
      {intro ? (
        <ThemedText type="small" themeColor="textSecondary">
          {intro}
        </ThemedText>
      ) : null}
      <View style={[styles.row, centred && styles.centred]}>
        {links.map((l) => (
          <Pressable key={l.label} accessibilityRole="link" onPress={() => Linking.openURL(l.url)}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              {l.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  centred: { justifyContent: 'center' },
});
