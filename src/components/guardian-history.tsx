import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { GuardianshipChange } from '@/lib/types';

/**
 * Every guardian link and unlink for a member, as an athlete or as a
 * guardian: whose, by whom, when and why. Admins only.
 */
export function GuardianHistory({
  memberId,
  whenEmpty,
}: {
  memberId: string;
  /** What to say once it has loaded and there is no history. Nothing, if left out. */
  whenEmpty?: string;
}) {
  const [changes, setChanges] = useState<GuardianshipChange[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('guardianship_history')
        .select('*')
        .or(`athlete_id.eq.${memberId},guardian_id.eq.${memberId}`)
        .order('changed_at', { ascending: false });
      setChanges((data as GuardianshipChange[] | null) ?? []);
    })();
  }, [memberId]);

  if (!changes) return null;
  if (changes.length === 0) {
    return whenEmpty ? (
      <ThemedText type="small" themeColor="textSecondary">
        {whenEmpty}
      </ThemedText>
    ) : null;
  }
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Guardian link history</ThemedText>
      {changes.map((c) => {
        const who =
          c.athlete_id === memberId
            ? (c.guardian_name ?? 'A former member')
            : `to ${c.athlete_name ?? 'a former member'}`;
        return (
          <ThemedText key={c.id} type="small" themeColor="textSecondary">
            {c.change === 'linked' ? 'Linked' : 'Unlinked'} {who}
            {c.athlete_id === memberId ? '' : ` as their guardian`}, {localDay(c.changed_at)}
            {c.changed_by_name ? ` by ${c.changed_by_name}` : ''}
            {c.reason ? `. Reason: ${c.reason}` : ''}.
          </ThemedText>
        );
      })}
      <ThemedText type="small" themeColor="textSecondary">
        Only admins see this. The child’s guardians, and the child from 13, get a message whenever
        a guardian is linked or unlinked; the reason isn’t in it.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
});
