import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { GoalGames, useGoalGames } from '@/components/goal-games';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useIsGoalGuardian } from '@/lib/goals';

/** One athlete's games, for their coaches (from a team's page) and their parents or guardians. */
export default function AthleteGoalsScreen() {
  const { id, name, team } = useLocalSearchParams<{ id: string; name?: string; team?: string }>();
  const isGuardian = useIsGoalGuardian();
  // Opened from a squad or team's page, only that group's games.
  const games = useGoalGames(id, team || undefined);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await games.reload();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {name ? <Stack.Screen options={{ title: name }} /> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {isGuardian
          ? 'Set goals for the next game with your athlete, and help them reflect once it’s played.'
          : 'Add goals for the next game. Once it’s played, read the athlete’s reflections and comment on each goal.'}
      </ThemedText>
      <GoalGames athleteId={id} athleteName={name} own={isGuardian} games={games} />
    </Screen>
  );
}
