import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { concernStatusLabels } from '@/lib/concerns';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Concern } from '@/lib/types';

/**
 * The concerns register, for the Child Safety Officer, the Complaints Manager
 * and admins. Nobody sees a concern about themselves.
 */
export default function ConcernsScreen() {
  const { isAdmin, isSafeguardingOfficer } = useAuth();
  // The route guard lets only these in; this keeps the register's controls
  // to them even so. The database returns no concerns to anyone else.
  const handles = isAdmin || isSafeguardingOfficer;
  const [concerns, setConcerns] = useState<Concern[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('concern_register');
    setConcerns((data as Concern[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const open = (concerns ?? []).filter((c) => c.status !== 'closed');
  const closed = (concerns ?? []).filter((c) => c.status === 'closed');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {handles ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Concerns raised by members, newest first. Only the Child Safety Officer, the Complaints
            Manager and admins see them, and nobody sees one about themselves. Child abuse and serious
            crimes go to Police and the governing body straight away.
          </ThemedText>
          <Button
            title="Export the register as a PDF"
            variant="secondary"
            onPress={() => router.push('/concerns/report')}
          />
        </>
      ) : null}
      <Section title="Open" concerns={open} empty="No open concerns." />
      <Section title="Closed" concerns={closed} empty="None closed yet." />
    </Screen>
  );
}

function Section({ title, concerns, empty }: { title: string; concerns: Concern[]; empty: string }) {
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {concerns.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      ) : (
        concerns.map((c) => (
          <PressableCard
            key={c.id}
            onPress={() => router.push({ pathname: '/concerns/[id]', params: { id: c.id } })}>
            <ThemedText type="smallBold">
              {localDay(c.created_at)}
              {c.about_member_name || c.about_text
                ? ` · about ${c.about_member_name ?? c.about_text}`
                : ''}
            </ThemedText>
            <ThemedText type="small" numberOfLines={2}>
              {c.body}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor={c.status === 'received' ? 'tint' : 'textSecondary'}>
              {concernStatusLabels[c.status]}
              {c.involves_child === 'yes' ? ' · child’s safety' : ''}
              {c.anonymous ? ' · name not shown' : ` · from ${c.raised_by_name ?? 'a former member'}`}
            </ThemedText>
          </PressableCard>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
