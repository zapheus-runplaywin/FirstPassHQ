import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GoalGames, useGoalGames } from '@/components/goal-games';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { formatShortDay } from '@/lib/format';
import { gamePhase, gameTitle, useAdminTeamGames, useCoachTeamGames, useGoalBoard } from '@/lib/goals';
import { captainRoleLabels, teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type {
  CaptainRole,
  CoachTeamGame,
  GoalBoardRow,
  GroupCaptain,
  RosterEntry,
} from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile, isAdmin, memberships } = useAuth();
  const { features } = useClub();
  const teams = useTeams();
  const team = teams.find((t) => t.id === id);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [captains, setCaptains] = useState<Map<string, CaptainRole>>(new Map());
  const [clubCaptains, setClubCaptains] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const season = team?.season;

  // Admins and the group's coaches choose its captains.
  const canChooseCaptains =
    !!team && (isAdmin || memberships.some((m) => m.team.id === id && m.team_role === 'coach'));

  // The group's coaches, managers and physios open its athletes' medical and
  // emergency details.
  const canSeeMedical =
    profile?.status === 'approved' &&
    memberships.some(
      (m) =>
        m.team.id === id &&
        (m.team_role === 'coach' || m.team_role === 'manager' || m.team_role === 'physio'),
    );

  // Game goals live on the team's page: PlayHQ games belong to teams, not squads.
  const membership = memberships.find((m) => m.team.id === id);
  const goalsHere =
    features.goals && profile?.status === 'approved' && membership?.team.kind === 'team';
  const goalAthlete = goalsHere && membership?.team_role === 'athlete';
  const goalCoach =
    goalsHere && membership?.team_role === 'coach' && !membership.team.selections_completed_at;
  // Admins read a team's goals and comments, whether or not they're in it.
  const goalAdmin =
    features.goals &&
    profile?.status === 'approved' &&
    isAdmin &&
    team?.kind === 'team' &&
    !goalCoach;
  const adminGames = useAdminTeamGames(!!goalAdmin);
  const myGames = useGoalGames(goalAthlete ? session?.user.id : undefined, id);
  const { goalBoard, reloadGoalBoard } = useGoalBoard();
  const { teamGames, reloadTeamGames } = useCoachTeamGames();
  const athleteGoals = new Map(
    (goalCoach ? (goalBoard ?? []) : [])
      .filter((row) => row.team_id === id)
      .map((row) => [row.athlete_id, row]),
  );

  const load = useCallback(async () => {
    const [rosterResult, captainResult, clubResult] = await Promise.all([
      supabase.rpc('team_roster', { p_team_id: id }),
      supabase.from('team_captains').select('team_id, profile_id, captain_role').eq('team_id', id),
      season === undefined
        ? Promise.resolve({ data: [] })
        : supabase.from('club_captains').select('profile_id').eq('season', season),
    ]);
    setRoster((rosterResult.data as RosterEntry[] | null) ?? []);
    setCaptains(
      new Map(
        ((captainResult.data as GroupCaptain[] | null) ?? []).map((c) => [
          c.profile_id,
          c.captain_role,
        ]),
      ),
    );
    setClubCaptains(
      new Set(
        ((clubResult.data as { profile_id: string }[] | null) ?? []).map((c) => c.profile_id),
      ),
    );
  }, [id, season]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), myGames.reload(), reloadGoalBoard(), reloadTeamGames()]);
    setRefreshing(false);
  }

  function positionLabel(member: RosterEntry) {
    const parts = [teamPositionLabel(member.team_role, member.coach_title, member.selection)];
    if (member.team_role === 'athlete') {
      const captainRole = captains.get(member.profile_id);
      if (captainRole) parts.push(captainRoleLabels[captainRole]);
      if (clubCaptains.has(member.profile_id)) parts.push('Club captain');
    }
    return parts.join(' · ');
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: team?.name ?? 'Team' }} />

      {goalAthlete && session ? (
        <View style={styles.section}>
          <ThemedText type="subtitle">Game goals</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Set goals for your next game in the week before it, then say how they went once it’s
            played. Your coaches can add goals too and comment on your reflections.{' '}
            {profile && isMinor(profile.date_of_birth, profile.under_17)
              ? 'Your coaches and your parents or guardians can see your goals.'
              : 'Your coaches can see your goals.'}
          </ThemedText>
          <GoalGames athleteId={session.user.id} own games={myGames} />
        </View>
      ) : null}

      {goalCoach ? (
        <TeamGoalGames games={(teamGames ?? []).filter((g) => g.team_id === id)} />
      ) : goalAdmin ? (
        <TeamGoalGames games={(adminGames ?? []).filter((g) => g.team_id === id)} readOnly />
      ) : null}

      <View style={styles.section}>
        {goalAthlete || goalCoach || goalAdmin ? (
          <ThemedText type="subtitle">People</ThemedText>
        ) : null}
        {goalCoach ? (
          <ThemedText type="small" themeColor="textSecondary">
            Open an athlete to add goals for their next game, or to comment on their goals once it’s
            played.
          </ThemedText>
        ) : null}
        {roster === null ? null : roster.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No one has been added yet.
          </ThemedText>
        ) : (
          roster.map((member) => {
            const goals = athleteGoals.get(member.profile_id);
            const name = member.full_name ?? 'Unnamed member';
            const position = (
              <ThemedText type="small" themeColor="textSecondary">
                {positionLabel(member)}
              </ThemedText>
            );
            if (!goals) {
              return (
                <Card key={member.profile_id}>
                  <ThemedText type="smallBold">{name}</ThemedText>
                  {position}
                </Card>
              );
            }
            return (
              <PressableCard
                key={member.profile_id}
                onPress={() =>
                  router.push({
                    pathname: '/goals/athlete/[id]',
                    params: { id: member.profile_id, name, team: id },
                  })
                }>
                <AthleteGoalsRow name={name} goals={goals} />
                {position}
              </PressableCard>
            );
          })
        )}
        {canSeeMedical && roster?.some((m) => m.team_role === 'athlete') ? (
          <Button
            title="Medical and emergency details"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/medical/team/[id]', params: { id, name: team?.name } })
            }
          />
        ) : null}
        {canChooseCaptains && roster?.some((m) => m.team_role === 'athlete') ? (
          <Button
            title="Choose captains"
            variant="secondary"
            onPress={() => router.push({ pathname: '/team/captains/[id]', params: { id } })}
          />
        ) : null}
      </View>
    </Screen>
  );
}

/** For the group's coaches (and, read only, admins): its next game and last played one, for team goals. */
function TeamGoalGames({ games, readOnly = false }: { games: CoachTeamGame[]; readOnly?: boolean }) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Team goals</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {readOnly
          ? 'The goals its coaches set for the whole team before each game, how they said it went, and the team’s comments.'
          : 'Set goals for the whole team before its next game, and say how it went afterwards.'}
      </ThemedText>
      {games.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            No game in the next 7 days. Team goals open a week before each game.
          </ThemedText>
        </Card>
      ) : null}
      {games.map((game) => (
        <PressableCard
          key={game.fixture_id}
          onPress={() =>
            router.push({ pathname: '/goals/team', params: { fixture: game.fixture_id } })
          }>
          <ThemedText type="smallBold">{gameTitle(game)}</ThemedText>
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
  return game.reviewed_count === n
    ? `${goals} · ✓ Reviewed`
    : `${goals} · ${game.reviewed_count} of ${n} reviewed`;
}

/** An athlete's name, their next game's goals and reflections waiting for a comment. */
function AthleteGoalsRow({ name, goals }: { name: string; goals: GoalBoardRow }) {
  const theme = useTheme();
  const waiting = goals.reflections_to_answer;
  return (
    <>
      <View style={styles.row}>
        <ThemedText type="smallBold" style={styles.flex}>
          {name}
        </ThemedText>
        {waiting > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
              {waiting}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="small">
        {goals.next_label && goals.next_starts_at
          ? `${goals.next_label} · ${formatShortDay(new Date(goals.next_starts_at))} · ${goalsSet(goals.next_goal_count)}`
          : 'No game in the next 7 days'}
      </ThemedText>
      {waiting > 0 ? (
        <ThemedText type="small">
          {waiting === 1
            ? '1 reflection waiting for a comment'
            : `${waiting} reflections waiting for a comment`}
        </ThemedText>
      ) : null}
    </>
  );
}

function goalsSet(count: number) {
  return count === 0 ? 'no goals yet' : `${count} ${count === 1 ? 'goal' : 'goals'}`;
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
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
