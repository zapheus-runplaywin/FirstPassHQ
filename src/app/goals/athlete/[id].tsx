import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { GoalGames, useGoalGames } from '@/components/goal-games';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { useIsGoalCoach } from '@/lib/goals';
import { logRecordView } from '@/lib/record-access';

/**
 * One athlete's games: for the athlete themselves (Played games in their Team
 * tab), their coaches (from the team's people) and their parents or guardians.
 */
export default function AthleteGoalsScreen() {
  const { id, name, team, view } = useLocalSearchParams<{
    id: string;
    name?: string;
    team?: string;
    /** 'guardian' when opened from Guardian of on the home screen. */
    view?: string;
  }>();
  const { session, profile } = useAuth();
  const isCoach = useIsGoalCoach();
  // The athlete looking at their own games.
  const own = session?.user.id === id;
  // Parents and guardians only read their athlete's goals and reflections.
  const guardianView = !own && (view === 'guardian' || !isCoach);
  // Opened from a squad or team's page, only that group's games.
  const games = useGoalGames(id, team || undefined);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Looking at your own goals isn't a look at someone's record.
      if (!own) logRecordView(id, 'goals');
    }, [id, own]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await games.reload();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {own ? (
        <Stack.Screen options={{ title: 'My game goals' }} />
      ) : name ? (
        <Stack.Screen options={{ title: name }} />
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {own
          ? `Set goals for your next game in the week before it, then say how they went once it’s played. Your coaches can add goals too and comment on your reflections. ${
              profile && isMinor(profile.date_of_birth, profile.under_17)
                ? 'Your coaches and your parents or guardians can see your goals.'
                : 'Your coaches can see your goals.'
            }`
          : guardianView
          ? 'See the goals your athlete and their coaches set for each game, and how your athlete thinks it went once it’s played. Your athlete sets and reflects on their goals in their own app.'
          : 'Add goals for the next game. Once it’s played, read the athlete’s reflections and comment on each goal.'}
      </ThemedText>
      <GoalGames
        athleteId={id}
        athleteName={name}
        own={own}
        guardianView={guardianView}
        games={games}
      />
    </Screen>
  );
}
