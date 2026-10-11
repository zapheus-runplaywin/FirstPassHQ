import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_GOALS,
  fetchNextGame,
  fetchPastGames,
  gamePhase,
  gameTitle,
  gameWhen,
  goalCountsLine,
} from '@/lib/goals';
import type { GoalGame } from '@/lib/types';

/**
 * Loads an athlete's next game and played games, a page at a time. With a
 * squad or team, only that group's games.
 */
export function useGoalGames(athleteId: string | undefined, teamId?: string) {
  // undefined while loading.
  const [next, setNext] = useState<GoalGame | null>();
  const [past, setPast] = useState<GoalGame[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!athleteId) return;
    setError(null);
    try {
      const [nextGame, firstPage] = await Promise.all([
        fetchNextGame(athleteId),
        fetchPastGames(athleteId, 0, teamId),
      ]);
      // The athlete's one open game may be another group's.
      setNext(nextGame && teamId && nextGame.team_id !== teamId ? null : nextGame);
      setPast(firstPage.games);
      setMore(firstPage.more);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load games');
    }
  }, [athleteId, teamId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const loadMore = useCallback(async () => {
    if (!athleteId) return;
    setLoadingMore(true);
    try {
      const page = await fetchPastGames(athleteId, past?.length ?? 0, teamId);
      setPast([...(past ?? []), ...page.games]);
      setMore(page.more);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load games');
    }
    setLoadingMore(false);
  }, [athleteId, past, teamId]);

  return { next, past, more, loadingMore, error, reload, loadMore };
}

/**
 * An athlete's next game (the only one open for goals) and their played games
 * this season, a page at a time. Each opens the game's goals.
 */
export function GoalGames({
  athleteId,
  athleteName,
  own,
  guardianView = false,
  games,
}: {
  athleteId: string;
  athleteName?: string;
  /** The athlete is looking, rather than a coach or guardian. */
  own: boolean;
  /** A parent or guardian is looking: games open read-only. */
  guardianView?: boolean;
  games: ReturnType<typeof useGoalGames>;
}) {
  const { next, past, more, loadingMore, error, loadMore } = games;

  function open(game: GoalGame) {
    router.push({
      pathname: '/goals/game',
      params: {
        athlete: athleteId,
        fixture: game.fixture_id,
        name: athleteName ?? '',
        ...(guardianView ? { view: 'guardian' } : {}),
      },
    });
  }

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="smallBold">Next game</ThemedText>
        {next === undefined ? null : next === null ? (
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              No game in the next 7 days. Goals open a week before each game.
            </ThemedText>
          </Card>
        ) : (
          <PressableCard onPress={() => open(next)}>
            <ThemedText type="smallBold">{gameTitle(next)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {gameWhen(next)}
            </ThemedText>
            <ThemedText type="small">{nextGameLine(next, own)}</ThemedText>
          </PressableCard>
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Played games</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This season’s games, newest first.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        {past?.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No games played yet.
          </ThemedText>
        ) : null}
        {past?.map((game) => (
          <PressableCard key={game.fixture_id} onPress={() => open(game)}>
            <ThemedText type="smallBold">{gameTitle(game)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {gameWhen(game)}
            </ThemedText>
            <ThemedText type="small">{goalCountsLine(game)}</ThemedText>
          </PressableCard>
        ))}
        {more ? (
          <Button title="Load more" variant="secondary" onPress={loadMore} busy={loadingMore} />
        ) : null}
      </View>
    </>
  );
}

function nextGameLine(game: GoalGame, own: boolean) {
  const phase = gamePhase(game);
  if (phase === 'playing') return 'Game on. Reflections open after the game.';
  if (game.goal_count === 0) {
    return own ? 'Set your goals for this game' : 'No goals set yet';
  }
  return `${game.goal_count} of up to ${MAX_GOALS} goals set · they close when the game starts`;
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
