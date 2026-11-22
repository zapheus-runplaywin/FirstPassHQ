import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import {
  GAMES_PAGE,
  adminGameDetail,
  adminGameStatus,
  adminGameTitle,
  fetchAdminGames,
  type AdminGame,
} from '@/lib/game-stats';

/**
 * The club's games recorded in FirstPass Vantage, newest first, for admins:
 * which games have been recorded, by whom, and whether each was finished.
 * It lists games only; the stats themselves stay with each team's coaches in
 * FirstPass Vision.
 */
export default function AdminGamesScreen() {
  const [games, setGames] = useState<AdminGame[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await fetchAdminGames(0);
      setGames(rows);
      setMore(rows.length === GAMES_PAGE);
      setError(null);
    } catch (err) {
      setGames((current) => current ?? []);
      setError((err as Error).message);
    }
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

  async function showMore() {
    if (!games) return;
    setLoadingMore(true);
    try {
      const rows = await fetchAdminGames(games.length);
      const have = new Set(games.map((g) => g.id));
      setGames([...games, ...rows.filter((g) => !have.has(g.id))]);
      setMore(rows.length === GAMES_PAGE);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoadingMore(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Games your statisticians have recorded in FirstPass Vantage, newest first. Coaches see each
        game’s stats in FirstPass Vision.
      </ThemedText>

      <ErrorText>{error}</ErrorText>

      {games === null ? null : games.length === 0 && !error ? (
        <ThemedText type="small" themeColor="textSecondary">
          No games have been recorded yet.
        </ThemedText>
      ) : (
        games.map((game) => (
          <Card key={game.id} style={styles.card}>
            <ThemedText type="smallBold">{adminGameTitle(game)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[game.round_name, game.team_name, formatDateTime(new Date(game.created_at))]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
            <ThemedText type="small">
              {adminGameStatus(game.status)}
              {game.from_fixture ? '' : ' · Not from the fixture list'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {adminGameDetail(game)}
            </ThemedText>
          </Card>
        ))
      )}

      {more ? (
        <Button title="Show earlier games" variant="secondary" onPress={showMore} busy={loadingMore} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.half,
  },
});
