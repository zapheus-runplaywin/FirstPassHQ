import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GoalGames, useGoalGames } from '@/components/goal-games';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { formatShortDay } from '@/lib/format';
import {
  fetchNextGame,
  gameTitle,
  gamePhase,
  useCoachTeamGames,
  useGoalBoard,
  useIsGoalAthlete,
  useIsGoalCoach,
  useIsGoalGuardian,
} from '@/lib/goals';
import { supabase } from '@/lib/supabase';
import type { CoachTeamGame, GoalBoardRow, GoalGame } from '@/lib/types';

export default function GoalsScreen() {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const isAthlete = useIsGoalAthlete();
  const isGuardian = useIsGoalGuardian();
  const isCoach = useIsGoalCoach();
  const { goalBoard, reloadGoalBoard } = useGoalBoard();
  const { teamGames, reloadTeamGames } = useCoachTeamGames();
  const myGames = useGoalGames(isAthlete ? userId : undefined);
  const guardian = useGuardianAthletes(isGuardian);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([
      myGames.reload(),
      guardian.reload(),
      reloadGoalBoard(),
      reloadTeamGames(),
    ]);
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {isAthlete && userId ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Set goals for your next game in the week before it, then say how they went once it’s
            played. Your coaches can add goals too and comment on your reflections.{' '}
            {profile && isMinor(profile.date_of_birth, profile.under_17)
              ? 'Your coaches and your parents or guardians can see your goals.'
              : 'Your coaches can see your goals.'}
          </ThemedText>
          <GoalGames athleteId={userId} own games={myGames} />
        </>
      ) : null}

      {isGuardian ? <GuardianAthletes athletes={guardian.athletes} /> : null}

      {isCoach ? <CoachTeamGames games={teamGames} /> : null}

      {isCoach ? <CoachBoard board={goalBoard} /> : null}
    </Screen>
  );
}

type GuardianAthlete = { profile_id: string; full_name: string | null; next: GoalGame | null };

/** A parent or guardian's athletes, each with their next game. */
function useGuardianAthletes(on: boolean) {
  const [athletes, setAthletes] = useState<GuardianAthlete[] | null>(null);

  const reload = useCallback(async () => {
    if (!on) return;
    const { data } = await supabase.rpc('my_athletes');
    const list = (data as { profile_id: string; full_name: string | null }[] | null) ?? [];
    setAthletes(
      await Promise.all(list.map(async (a) => ({ ...a, next: await fetchNextGame(a.profile_id) }))),
    );
  }, [on]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { athletes, reload };
}

function GuardianAthletes({ athletes }: { athletes: GuardianAthlete[] | null }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Your athletes</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        You can set goals and reflect on games for the athletes you look after.
      </ThemedText>
      {athletes?.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            A club admin will link you to your athlete once they have checked your PlayHQ
            registration.
          </ThemedText>
        </Card>
      ) : null}
      {athletes?.map((a) => {
        const name = a.full_name ?? 'Unnamed athlete';
        return (
          <PressableCard
            key={a.profile_id}
            onPress={() =>
              router.push({ pathname: '/goals/athlete/[id]', params: { id: a.profile_id, name } })
            }>
            <ThemedText type="smallBold">{name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {a.next
                ? `${gameTitle(a.next)} · ${formatShortDay(new Date(a.next.starts_at))} · ${goalsSet(a.next.goal_count)}`
                : 'No game in the next 7 days'}
            </ThemedText>
          </PressableCard>
        );
      })}
    </View>
  );
}

/** Team goals: each group the member coaches, with its next game and last played one. */
function CoachTeamGames({ games }: { games: CoachTeamGame[] | null }) {
  if (!games || games.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Team goals</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Set goals for the whole team before its next game, and say how the team went afterwards.
      </ThemedText>
      {games.map((game) => (
        <PressableCard
          key={game.fixture_id}
          onPress={() =>
            router.push({ pathname: '/goals/team', params: { fixture: game.fixture_id } })
          }>
          <ThemedText type="smallBold">
            {game.team_name} · {gameTitle(game)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {game.is_next ? 'Next game' : 'Last game'} · {formatShortDay(new Date(game.starts_at))}
          </ThemedText>
          <ThemedText type="small">{teamGoalsLine(game)}</ThemedText>
        </PressableCard>
      ))}
    </View>
  );
}

function teamGoalsLine(game: CoachTeamGame) {
  const phase = gamePhase(game);
  const n = game.goal_count;
  const goals = `${n} team ${n === 1 ? 'goal' : 'goals'}`;
  if (phase === 'open') return n === 0 ? 'No team goals yet' : `${goals} set`;
  if (phase === 'playing') return `${goals} · game on`;
  if (n === 0) return 'No team goals were set';
  return game.reviewed_count === n ? `${goals} · ✓ Reviewed` : `${goals} · ${game.reviewed_count} of ${n} reviewed`;
}

/** Each squad and team the member coaches, with every athlete's next game. */
function CoachBoard({ board }: { board: GoalBoardRow[] | null }) {
  const theme = useTheme();
  if (!board) return null;
  const groups: { id: string; name: string; rows: GoalBoardRow[] }[] = [];
  for (const row of board) {
    const last = groups[groups.length - 1];
    if (last?.id === row.team_id) last.rows.push(row);
    else groups.push({ id: row.team_id, name: row.team_name, rows: [row] });
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Athletes you coach</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Add goals for an athlete’s next game, and comment on their goals once it’s played.
      </ThemedText>
      {groups.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No athletes in your squads and teams yet.
        </ThemedText>
      ) : null}
      {groups.map((group) => (
        <View key={group.id} style={styles.group}>
          <ThemedText type="small" themeColor="textSecondary">
            {group.name}
          </ThemedText>
          {group.rows.map((row) => (
            <PressableCard
              key={row.athlete_id}
              onPress={() =>
                router.push({
                  pathname: '/goals/athlete/[id]',
                  params: { id: row.athlete_id, name: row.athlete_name },
                })
              }>
              <View style={styles.row}>
                <ThemedText type="smallBold" style={styles.flex}>
                  {row.athlete_name}
                </ThemedText>
                {row.reflections_to_answer > 0 ? (
                  <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                    <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                      {row.reflections_to_answer}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {row.next_label && row.next_starts_at
                  ? `${row.next_label} · ${formatShortDay(new Date(row.next_starts_at))} · ${goalsSet(row.next_goal_count)}`
                  : 'No game in the next 7 days'}
              </ThemedText>
              {row.reflections_to_answer > 0 ? (
                <ThemedText type="small">
                  {row.reflections_to_answer === 1
                    ? '1 reflection waiting for a comment'
                    : `${row.reflections_to_answer} reflections waiting for a comment`}
                </ThemedText>
              ) : null}
            </PressableCard>
          ))}
        </View>
      ))}
    </View>
  );
}

function goalsSet(count: number) {
  return count === 0 ? 'no goals yet' : `${count} ${count === 1 ? 'goal' : 'goals'}`;
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  group: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
