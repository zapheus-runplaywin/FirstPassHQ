import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { ConductStatus } from '@/lib/conduct';
import { roleLabels } from '@/lib/labels';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

/**
 * For admins: who has accepted the club's code of conduct this season and
 * who still has to, with under 18s accepted by a parent or guardian.
 */
export default function ConductStatusScreen() {
  const [rows, setRows] = useState<ConductStatus[] | null>(null);
  const [on, setOn] = useState(false);

  const load = useCallback(async () => {
    const [statusResult, settingResult] = await Promise.all([
      supabase.rpc('admin_conduct_status'),
      supabase.rpc('conduct_each_season_setting'),
    ]);
    setRows((statusResult.data as ConductStatus[] | null) ?? []);
    setOn(settingResult.data === true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (rows === null) return <Screen>{null}</Screen>;

  const waiting = rows.filter((r) => !r.accepted_at);
  const accepted = rows.filter((r) => r.accepted_at);

  function describe(row: ConductStatus) {
    const role = roleLabels[row.role as AppRole] ?? row.role;
    if (row.accepted_at) {
      return `${role} · ${localDay(row.accepted_at)}${row.accepted_by_name && row.under_18 ? ` by ${row.accepted_by_name}` : ''}`;
    }
    return row.under_18 ? `${role} · under 18, a parent or guardian accepts` : role;
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {!on
          ? 'Members aren’t asked to accept the code of conduct. To ask them once a season, turn on Code of conduct each season in Safeguarding.'
          : rows.length === 0
            ? 'Nobody is asked yet. Link the club’s code of conduct in Safeguarding and every member accepts it once a season, from their to-do list.'
            : 'Every member accepts the code of conduct once a season, from their to-do list. A verified parent or guardian accepts for an under 18. Guests and temporary helpers aren’t asked.'}
      </ThemedText>
      {[
        { title: `Still to accept (${waiting.length})`, list: waiting },
        { title: `Accepted (${accepted.length})`, list: accepted },
      ].map((section) =>
        section.list.length > 0 ? (
          <View key={section.title} style={styles.group}>
            <ThemedText type="smallBold">{section.title}</ThemedText>
            {section.list.map((row) => (
              <PressableCard
                key={row.profile_id}
                onPress={() =>
                  router.push({
                    pathname: '/conduct/[id]',
                    params: { id: row.profile_id },
                  })
                }>
                <ThemedText type="smallBold">{row.full_name ?? 'Unnamed member'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {describe(row)}
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null,
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
