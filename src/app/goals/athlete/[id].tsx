import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { GoalGames, useGoalGames } from '@/components/goal-games';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useIsGoalCoach } from '@/lib/goals';

/** One athlete's games, for their coaches (from a team's page) and their parents or guardians. */
export default function AthleteGoalsScreen() {
  const { id, name, team, view } = useLocalSearchParams<{
    id: string;
    name?: string;
    team?: string;
    /** 'guardian' when opened from Guardian of on the home screen. */
    view?: string;
  }>();
  const isCoach = useIsGoalCoach();
  // Parents and guardians only read their athlete's goals and reflections.
  const guardianView = view === 'guardian' || !isCoach;
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
        {guardianView
          ? 'See the goals your athlete and their coaches set for each game, and how your athlete thinks it went once it’s played. Your athlete sets and reflects on their goals in their own app.'
          : 'Add goals for the next game. Once it’s played, read the athlete’s reflections and comment on each goal.'}
      </ThemedText>
      <GoalGames
        athleteId={id}
        athleteName={name}
        own={false}
        guardianView={guardianView}
        games={games}
      />
    </Screen>
  );
}
