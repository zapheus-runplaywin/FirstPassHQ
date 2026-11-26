/**
 * A squad or team on one screen: what the member can do there, then its
 * people, once. It is the Team tab's section for the chosen squad or team
 * (src/components/home/team-hub.tsx) and the page an admin opens from Squads
 * and teams (src/app/team/[id].tsx).
 *
 * The rows are the things that used to sit on a second page behind the
 * team's card: game goals, team goals, medical and emergency details and
 * choosing captains (Matt, 27 November 2026: the page listed the same people
 * again and cost a tap). A row shows only for someone who could already open
 * its screen, and each screen still has its own rule for who may open it.
 *
 * The people are names and positions only: no photos and no profiles. Team
 * goals stay with the team, so an admin who isn't its coach has no row for
 * them.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useGoalGames } from '@/components/goal-games';
import { StatusLine } from '@/components/home/feature-card';
import { SectionTitle } from '@/components/home/tab-header';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { formatShortDay } from '@/lib/format';
import {
  gamePhase,
  gameTitle,
  goalCountsLine,
  useCoachTeamGames,
  useGoalBoard,
} from '@/lib/goals';
import {
  injuredCountLabel,
  rosterCountLabel,
  splitRoster,
  type RosterStatus,
} from '@/lib/team-hub';
import type { CoachTeamGame, GoalBoardRow, GoalGame, RosterEntry, Team, TeamMembership } from '@/lib/types';
import { useTeamRoster } from '@/lib/use-team-roster';

const NO_STATUSES = new Map<string, RosterStatus>();

export function GroupPage({
  team,
  membership,
  statuses = NO_STATUSES,
  adminPage = false,
}: {
  team: Pick<Team, 'id' | 'name' | 'kind' | 'season'>;
  /** The member's own place in it, when they have one. */
  membership?: TeamMembership;
  /** Injury status beside athletes' names, for the group's coaches and physios. */
  statuses?: Map<string, RosterStatus>;
  /** Opened by an admin from Squads and teams: adds the way to change who is in a team. */
  adminPage?: boolean;
}) {
  const { session, profile, isAdmin } = useAuth();
  const { features } = useClub();
  const id = team.id;
  const role = membership?.team_role;
  const approved = profile?.status === 'approved';
  const { roster, positionLabel, captainNames } = useTeamRoster(id, team);
  const athleteCount = roster ? splitRoster(roster).athletes.length : 0;

  // Admins and the team's coaches choose its captains. Squads have none
  // (Matt, 20 November 2026): captains are chosen per team.
  const canChooseCaptains = team.kind === 'team' && (isAdmin || role === 'coach');
  // The group's coaches, managers and physios open its athletes' medical and
  // emergency details.
  const canSeeMedical = approved && (role === 'coach' || role === 'manager' || role === 'physio');
  // Game goals belong to teams: PlayHQ games are a team's, never a squad's.
  const goalsHere = features.goals && approved && team.kind === 'team';
  const goalAthlete = goalsHere && role === 'athlete';
  const goalCoach = goalsHere && role === 'coach' && !membership?.team.selections_completed_at;

  const myGames = useGoalGames(goalAthlete ? session?.user.id : undefined, id);
  const { goalBoard } = useGoalBoard();
  const { teamGames } = useCoachTeamGames();
  const athleteGoals = new Map(
    (goalCoach ? (goalBoard ?? []) : [])
      .filter((row) => row.team_id === id)
      .map((row) => [row.athlete_id, row]),
  );
  const coachGames = goalCoach ? (teamGames ?? []).filter((g) => g.team_id === id) : [];

  const rows: RowProps[] = [];
  if (adminPage && isAdmin && team.kind === 'team') {
    rows.push({
      testID: 'row-change-members',
      title: 'Change who’s in it',
      detail: 'Coaches, managers, physios and athletes',
      onPress: () => router.push({ pathname: '/admin/team/[id]', params: { id } }),
    });
  }
  if (goalAthlete && session) {
    const { next, past } = myGames;
    rows.push({
      testID: 'row-my-goals',
      title: 'My game goals',
      detail:
        next === undefined ? undefined : next ? nextGameLine(next) : 'No game in the next 7 days',
      onPress: next
        ? () =>
            router.push({
              pathname: '/goals/game',
              params: { athlete: session.user.id, fixture: next.fixture_id, name: '' },
            })
        : undefined,
    });
    rows.push({
      testID: 'row-played-games',
      title: 'Played games',
      detail:
        past === null
          ? undefined
          : past.length === 0
            ? 'No games played yet'
            : `${gameTitle(past[0])} · ${goalCountsLine(past[0])}`,
      onPress: () =>
        router.push({
          pathname: '/goals/athlete/[id]',
          params: { id: session.user.id, team: id },
        }),
    });
  }
  if (goalCoach) {
    if (coachGames.length === 0) {
      rows.push({
        testID: 'row-team-goals',
        title: 'Team goals',
        detail: 'No game in the next 7 days. They open a week before each game.',
      });
    }
    for (const game of coachGames) {
      rows.push({
        testID: game.is_next ? 'row-team-goals' : 'row-team-goals-last',
        title: game.is_next ? 'Team goals' : 'Team goals, last game',
        detail: `${gameTitle(game)} · ${formatShortDay(new Date(game.starts_at))} · ${teamGoalsLine(game)}`,
        onPress: () => router.push({ pathname: '/goals/team', params: { fixture: game.fixture_id } }),
      });
    }
  }
  if (canSeeMedical && athleteCount > 0) {
    rows.push({
      testID: 'row-medical',
      title: 'Medical and emergency details',
      detail: `${athleteCount} ${athleteCount === 1 ? 'athlete' : 'athletes'}`,
      onPress: () => router.push({ pathname: '/medical/team/[id]', params: { id, name: team.name } }),
    });
  }
  if (canChooseCaptains && athleteCount > 0) {
    rows.push({
      testID: 'row-captains',
      title: 'Choose captains',
      detail: captainNames ?? 'None chosen yet',
      onPress: () => router.push({ pathname: '/team/captains/[id]', params: { id } }),
    });
  }

  return (
    <View style={styles.section}>
      {rows.length > 0 ? (
        <Group testID="team-rows">
          {rows.map((row, index) => (
            <Row key={row.testID} {...row} divider={index > 0} />
          ))}
        </Group>
      ) : null}
      {roster === null ? null : roster.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No one has been added yet.
        </ThemedText>
      ) : (
        <People
          teamId={id}
          roster={roster}
          statuses={statuses}
          goals={athleteGoals}
          positionLabel={positionLabel}
        />
      )}
    </View>
  );
}

/** A panel of rows with a line between them. */
function Group({ testID, children }: { testID: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.list, { backgroundColor: theme.backgroundElement }]}>
      {children}
    </View>
  );
}

type RowProps = {
  testID: string;
  title: string;
  detail?: string;
  /** Without one the row only says something, such as "No game in the next 7 days". */
  onPress?: () => void;
};

function Row({ testID, title, detail, onPress, divider }: RowProps & { divider: boolean }) {
  const theme = useTheme();
  const line = divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected };
  const words = (
    <View style={styles.text}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {detail ? (
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      ) : null}
    </View>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, line]}>
        {words}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        line,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      {words}
      <Icon name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

/** A squad or team's athletes, then its coaches, managers and physios. */
function People({
  teamId,
  roster,
  statuses,
  goals,
  positionLabel,
}: {
  teamId: string;
  roster: RosterEntry[];
  statuses: Map<string, RosterStatus>;
  goals: Map<string, GoalBoardRow>;
  positionLabel: (member: RosterEntry) => string;
}) {
  const { athletes, staff } = splitRoster(roster);
  const injured = injuredCountLabel(roster, statuses);
  return (
    <>
      <View style={styles.peopleHead}>
        <SectionTitle>People</SectionTitle>
        <ThemedText type="small" themeColor="textSecondary" testID="people-count">
          {rosterCountLabel(roster)}
        </ThemedText>
      </View>
      {injured ? <StatusLine text={injured} tone="attention" /> : null}
      <Group testID="people-list">
        {[...athletes, ...staff].map((member, index) => (
          <PersonRow
            key={member.profile_id}
            teamId={teamId}
            id={member.profile_id}
            name={member.full_name ?? 'Unnamed member'}
            position={positionLabel(member)}
            status={member.team_role === 'athlete' ? statuses.get(member.profile_id) : undefined}
            goals={member.team_role === 'athlete' ? goals.get(member.profile_id) : undefined}
            divider={index > 0}
          />
        ))}
      </Group>
    </>
  );
}

/**
 * One person. For the team's coach an athlete's row says how their next
 * game's goals stand and opens their goals; an injury status opens the
 * injury, on its own when the row opens goals. Everyone else's rows say a
 * name and a position and open nothing.
 */
function PersonRow({
  teamId,
  id,
  name,
  position,
  status,
  goals,
  divider,
}: {
  teamId: string;
  id: string;
  name: string;
  position: string;
  status: RosterStatus | undefined;
  goals: GoalBoardRow | undefined;
  divider: boolean;
}) {
  const theme = useTheme();
  const line = divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected };
  const openInjury = status
    ? () => router.push({ pathname: '/injuries/[id]', params: { id: status.injuryId } })
    : undefined;
  const statusWords = status ? (
    <>
      <Icon name="alert-circle" size={14} color={theme.attention} />
      <ThemedText type="small" themeColor="attention" style={styles.statusText}>
        {status.label}
      </ThemedText>
    </>
  ) : null;
  const nameAndPosition = (
    <>
      <ThemedText type="smallBold">{name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {position}
      </ThemedText>
    </>
  );

  if (goals) {
    const waiting = goals.reflections_to_answer;
    const goalsLine = athleteGoalsLine(goals);
    const waitingLine =
      waiting === 0
        ? null
        : waiting === 1
          ? '1 reflection waiting for a comment'
          : `${waiting} reflections waiting for a comment`;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[name, position, goalsLine, waitingLine].filter(Boolean).join('. ')}
        accessibilityHint="Opens their game goals"
        onPress={() =>
          router.push({ pathname: '/goals/athlete/[id]', params: { id, name, team: teamId } })
        }
        style={({ pressed }) => [
          styles.row,
          line,
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}>
        <View style={styles.text}>
          {nameAndPosition}
          <ThemedText type="small">{goalsLine}</ThemedText>
          {waitingLine ? <ThemedText type="small">{waitingLine}</ThemedText> : null}
          {status ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}. ${status.label}`}
              accessibilityHint="Opens the injury"
              hitSlop={6}
              onPress={openInjury}
              style={styles.statusUnder}>
              {statusWords}
            </Pressable>
          ) : null}
        </View>
        {waiting > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
              {waiting}
            </ThemedText>
          </View>
        ) : null}
        <Icon name="chevron-right" size={18} color={theme.textSecondary} />
      </Pressable>
    );
  }

  if (!status) {
    return (
      <View style={[styles.row, line]}>
        <View style={styles.text}>{nameAndPosition}</View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${position}. ${status.label}`}
      accessibilityHint="Opens the injury"
      onPress={openInjury}
      style={({ pressed }) => [
        styles.row,
        line,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <View style={styles.text}>{nameAndPosition}</View>
      <View style={styles.statusBeside}>{statusWords}</View>
      <Icon name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function goalsSet(count: number) {
  return count === 0 ? 'no goals yet' : `${count} ${count === 1 ? 'goal' : 'goals'}`;
}

/** Such as "Round 3 v Comets · Sat 29 Nov · 2 goals", for the athlete's own next game. */
function nextGameLine(game: GoalGame) {
  const when = `${gameTitle(game)} · ${formatShortDay(new Date(game.starts_at))}`;
  if (gamePhase(game) === 'playing') return `${when} · game on`;
  return `${when} · ${game.goal_count === 0 ? 'set your goals' : goalsSet(game.goal_count)}`;
}

/** An athlete's next game and its goals, for their coach. */
function athleteGoalsLine(goals: GoalBoardRow) {
  return goals.next_label && goals.next_starts_at
    ? `${goals.next_label} · ${formatShortDay(new Date(goals.next_starts_at))} · ${goalsSet(goals.next_goal_count)}`
    : 'No game in the next 7 days';
}

function teamGoalsLine(game: CoachTeamGame) {
  const phase = gamePhase(game);
  const n = game.goal_count;
  const goals = `${n} team ${n === 1 ? 'goal' : 'goals'}`;
  if (phase === 'open') return n === 0 ? 'no team goals yet' : `${goals} set`;
  if (phase === 'playing') return `${goals} · game on`;
  if (n === 0) return 'no team goals were set';
  return game.reviewed_count === n
    ? `${goals} · ✓ Reviewed`
    : `${goals} · ${game.reviewed_count} of ${n} reviewed`;
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  peopleHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  list: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  statusBeside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
    maxWidth: '55%',
  },
  statusUnder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingTop: Spacing.half,
  },
  statusText: {
    flexShrink: 1,
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
