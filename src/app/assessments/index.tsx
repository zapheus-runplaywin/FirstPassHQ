import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { groupRounds, roundTitle, shortDate, shortRange, type MyRound } from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { supabase } from '@/lib/supabase';

/**
 * The selection rounds whose panel the member is on. Each opens its
 * athletes; closed rounds stay to read.
 */
export default function AssessmentsScreen() {
  const [rounds, setRounds] = useState<MyRound[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_selection_rounds');
    setRounds((data as MyRound[] | null) ?? []);
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

  if (rounds === null) return <Screen>{null}</Screen>;
  const today = clubToday();
  const grouped = groupRounds(rounds, today);
  // Running now, coming up, then finished.
  const ordered = [...grouped.now, ...grouped.coming, ...grouped.finished];

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Only a round’s panel reads what is written in it.
      </ThemedText>
      {rounds.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You aren’t on a selection panel. An admin opens a round and chooses its panel.
        </ThemedText>
      ) : (
        ordered.map((round) => (
          <PressableCard
            key={round.id}
            onPress={() => router.push({ pathname: '/assessments/round', params: { id: round.id } })}>
            <ThemedText type="smallBold">
              {roundTitle(round)}
              {round.closed_at ? ' (closed)' : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {round.team_name} · {shortRange(round)}
            </ThemedText>
            {round.criteria_set_name ? (
              <ThemedText type="small" themeColor="textSecondary">
                {round.criteria_set_name}
              </ThemedText>
            ) : null}
            {!round.closed_at && round.starts_on > today ? (
              <ThemedText type="smallBold">Starts {shortDate(round.starts_on, true)}</ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {round.athletes} {round.athletes === 1 ? 'athlete' : 'athletes'} · you have written{' '}
                {round.my_observations} {round.my_observations === 1 ? 'observation' : 'observations'}
              </ThemedText>
            )}
          </PressableCard>
        ))
      )}
    </Screen>
  );
}
