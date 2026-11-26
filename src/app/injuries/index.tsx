import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import InjuryScreen from '@/app/injuries/[id]';
import { CardGrid } from '@/components/columns';
import { InjuryCard } from '@/components/injury-card';
import { ListDetail, useListDetail } from '@/components/list-detail';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useCanLogInjuries, useCanSeeInjuries } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Injury } from '@/lib/types';
import { hasRole } from '@/lib/roles';

export default function InjuriesScreen() {
  const { profile } = useAuth();
  const [showCleared, setShowCleared] = useState(false);
  const [injuries, setInjuries] = useState<Injury[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canReport = hasRole(profile, 'athlete', 'guardian');
  const canLog = useCanLogInjuries();
  const canSee = useCanSeeInjuries();

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
  // On a tablet an injury opens beside the list; otherwise on its own screen.
  const detail = useListDetail<{ id: string }>((params) =>
    router.push({ pathname: '/injuries/[id]', params }),
  );
  const chosen = { chosenId: detail.chosen?.id ?? null, onOpen: detail.split ? detail.open : undefined };

  const list = (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {canReport ? (
        <Button title="Report an injury" onPress={() => router.push('/injuries/new')} />
      ) : null}
      {canLog ? (
        <Button
          title="Log an injury"
          variant={canReport ? 'secondary' : 'primary'}
          onPress={() => router.push('/injuries/log')}
        />
      ) : null}
      {canLog && !canSee ? (
        <ThemedText type="small" themeColor="textSecondary">
          Log an injury when it happens at training or a game. It goes to the athlete and their
          parents or guardians, who keep the record from there. Managers don’t see injury records.
        </ThemedText>
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

      <Section title="Waiting for your sign-off" injuries={waiting} showAthlete {...chosen} />
      <Section
        title={isGuardian ? 'Your athletes' : 'Your injuries'}
        injuries={mine}
        showAthlete={isGuardian}
        {...chosen}
      />
      <Section title="Injured athletes" injuries={others} showAthlete {...chosen} />

      <ThemedText type="small" themeColor="textSecondary">
        Injury records are private. Only the athlete, their guardians, their coaches, physios, the
        committee and admins can see them. An athlete under 18 shows to their coaches, physios and
        the committee members cleared to work with children only once a parent or guardian gives
        consent.
      </ThemedText>
    </Screen>
  );
  return (
    <ListDetail
      chosen={detail.chosen}
      detail={<InjuryScreen />}
      title="Injury"
      hint="Choose an injury to open it here."
      onLeave={() => {
        detail.close();
        load();
      }}
      onChanged={load}>
      {list}
    </ListDetail>
  );
}

function Section({
  title,
  injuries,
  showAthlete,
  chosenId,
  onOpen,
}: {
  title: string;
  injuries: Injury[];
  showAthlete: boolean;
  /** The injury open beside the list, if one is. */
  chosenId: string | null;
  /** Opens an injury beside the list. Left out, a card opens the injury's own screen. */
  onOpen?: (params: { id: string }) => void;
}) {
  if (injuries.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <CardGrid>
        {injuries.map((injury) => (
          <InjuryCard
            key={injury.id}
            injury={injury}
            showAthlete={showAthlete}
            onOpen={onOpen}
            selected={chosenId === null ? undefined : injury.id === chosenId}
          />
        ))}
      </CardGrid>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
