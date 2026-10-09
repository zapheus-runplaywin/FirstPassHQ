import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InjuryCard } from '@/components/injury-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Injury } from '@/lib/types';
import { hasRole } from '@/lib/roles';

export default function InjuriesScreen() {
  const { profile } = useAuth();
  const [showCleared, setShowCleared] = useState(false);
  const [injuries, setInjuries] = useState<Injury[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canReport = hasRole(profile, 'athlete', 'guardian');

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('visible_injuries', { p_include_cleared: showCleared });
    setInjuries((data as Injury[] | null) ?? []);
  }, [showCleared]);

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

  const waiting = injuries?.filter((i) => i.waiting_for_me) ?? [];
  const mine = injuries?.filter((i) => i.can_report && !i.waiting_for_me) ?? [];
  const others = injuries?.filter((i) => !i.can_report && !i.waiting_for_me) ?? [];
  const isGuardian = hasRole(profile, 'guardian');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {canReport ? (
        <Button title="Report an injury" onPress={() => router.push('/injuries/new')} />
      ) : null}

      <ChipGroup
        options={[
          { value: 'open', label: 'Current' },
          { value: 'all', label: 'Including cleared' },
        ]}
        selected={[showCleared ? 'all' : 'open']}
        onToggle={(value) => setShowCleared(value === 'all')}
      />

      {injuries === null ? null : injuries.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {showCleared ? 'No injuries have been reported.' : 'No current injuries.'}
        </ThemedText>
      ) : null}

      <Section title="Waiting for your sign-off" injuries={waiting} showAthlete />
      <Section
        title={isGuardian ? 'Your athletes' : 'Your injuries'}
        injuries={mine}
        showAthlete={isGuardian}
      />
      <Section title="Injured athletes" injuries={others} showAthlete />

      <ThemedText type="small" themeColor="textSecondary">
        Injury records are private. Only the athlete, their guardians, their coaches, physios
        and the committee can see them.
      </ThemedText>
    </Screen>
  );
}

function Section({
  title,
  injuries,
  showAthlete,
}: {
  title: string;
  injuries: Injury[];
  showAthlete: boolean;
}) {
  if (injuries.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {injuries.map((injury) => (
        <InjuryCard key={injury.id} injury={injury} showAthlete={showAthlete} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
