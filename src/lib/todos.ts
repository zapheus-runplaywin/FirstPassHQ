import type { Href } from 'expo-router';

import { slotTitle } from '@/lib/awards';
import { formatShortDay } from '@/lib/format';
import { gamePhase, gameTitle } from '@/lib/goals';
import { formatDateString, toDateString } from '@/lib/injuries';
import type { AwardSlot, CoachTeamGame, GoalGame, Injury } from '@/lib/types';
import type { SafetyTodos } from '@/lib/use-pending-requests';

/** Something the member still has to do, shown at the top of the home screen. */
export type Todo = {
  key: string;
  title: string;
  detail: string;
  href: Href;
};

/**
 * Everything the member owes, daily items first, built from what the home
 * screen has already loaded. Each item disappears once it's done.
 */
export function buildTodos({
  userId,
  injuries,
  pendingCount,
  needsCheckIn,
  flaggedAthletes,
  awardSlots = [],
  safety = null,
  goals = null,
  goalReflectionsToAnswer = 0,
  teamGames = [],
  today = new Date(),
}: {
  userId: string | undefined;
  injuries: Injury[];
  pendingCount: number;
  /** An athlete who hasn't done today's check-in. */
  needsCheckIn: boolean;
  /** Athletes the member coaches who flagged a low score today. */
  flaggedAthletes: number;
  /** Award votes open to the member. */
  awardSlots?: AwardSlot[];
  /** Child-safety follow-ups, for admins. */
  safety?: SafetyTodos | null;
  /** The athlete's next game and last played game, for game goals. */
  goals?: { next: GoalGame | null; last: GoalGame | null } | null;
  /** Reflections from athletes the member coaches that no coach has answered. */
  goalReflectionsToAnswer?: number;
  /** Next and last games of the groups the member coaches, for team goals. */
  teamGames?: CoachTeamGame[];
  today?: Date;
}): Todo[] {
  const todos: Todo[] = [];

  if (needsCheckIn) {
    todos.push({
      key: 'check-in',
      title: 'Do your daily check-in',
      detail: 'Sleep, soreness, stress and mood. It takes 30 seconds.',
      href: '/check-in',
    });
  }

  if (flaggedAthletes > 0) {
    todos.push({
      key: 'check-in-flags',
      title: `Check in with ${flaggedAthletes} ${flaggedAthletes === 1 ? 'athlete' : 'athletes'}`,
      detail: 'They scored low on today’s check-in',
      href: '/check-ins',
    });
  }

  // Return-to-play sign-offs hold an athlete out of training until they are done.
  const toSignOff = injuries.filter((i) => i.waiting_for_me);
  if (toSignOff.length === 1) {
    const injury = toSignOff[0];
    todos.push({
      key: 'injury-sign-off',
      title: `Review ${injury.athlete_name ?? 'an athlete'}’s clearance`,
      detail: `${injury.body_area} · waiting for your sign-off`,
      href: { pathname: '/injuries/[id]', params: { id: injury.id } },
    });
  } else if (toSignOff.length > 1) {
    todos.push({
      key: 'injury-sign-off',
      title: `Review ${toSignOff.length} injury clearances`,
      detail: 'Athletes are waiting for your sign-off to return',
      href: '/injuries',
    });
  }

  // An athlete's own injury that has gone past the day they expected to be back.
  const todayString = toDateString(today);
  for (const injury of injuries) {
    if (
      !injury.can_report ||
      injury.status !== 'injured' ||
      !injury.expected_return ||
      injury.expected_return > todayString
    ) {
      continue;
    }
    const whose =
      injury.athlete_id === userId ? 'your' : `${injury.athlete_name ?? 'your athlete'}’s`;
    todos.push({
      key: `injury-update-${injury.id}`,
      title: `Update ${whose} ${injury.body_area.toLowerCase()} injury`,
      detail: `Expected back ${formatDateString(injury.expected_return)}. Ask for clearance or change the date.`,
      href: { pathname: '/injuries/[id]', params: { id: injury.id } },
    });
  }

  // Goals close when the game starts, so they come before anything that can wait.
  const next = goals?.next;
  if (next && next.goal_count === 0 && gamePhase(next, today) === 'open') {
    todos.push({
      key: 'game-goals',
      title: `Set your goals for ${gameTitle(next)}`,
      detail: `${formatShortDay(new Date(next.starts_at))} · goals close when the game starts`,
      href: goalHref(next, userId),
    });
  }

  // A game played in the last week whose goals the athlete hasn't reflected on.
  const last = goals?.last;
  if (
    last &&
    last.reflected_count < last.goal_count &&
    today.getTime() - new Date(last.played_at).getTime() < REFLECT_WITHIN_MS
  ) {
    todos.push({
      key: 'game-reflection',
      title: `Reflect on ${gameTitle(last)}`,
      detail: 'How did your goals go?',
      href: goalHref(last, userId),
    });
  }

  for (const game of teamGames) {
    if (!game.is_next || game.goal_count > 0 || gamePhase(game, today) !== 'open') continue;
    todos.push({
      key: `team-goals-${game.fixture_id}`,
      title: `Set team goals for ${game.team_name}`,
      detail: `${gameTitle(game)} · ${formatShortDay(new Date(game.starts_at))}`,
      href: { pathname: '/goals/team', params: { fixture: game.fixture_id } },
    });
  }

  if (goalReflectionsToAnswer > 0) {
    todos.push({
      key: 'goal-comments',
      title: `Comment on ${goalReflectionsToAnswer} goal ${goalReflectionsToAnswer === 1 ? 'reflection' : 'reflections'}`,
      detail: 'Your athletes have said how their game went',
      href: '/goals',
    });
  }

  // Match votes close a couple of days after the game, so they come before join requests.
  const toVote = awardSlots.filter((s) => !s.voted);
  if (toVote.length === 1) {
    const slot = toVote[0];
    todos.push({
      key: 'award-vote',
      title: `Vote for ${slot.award_name}`,
      detail: slotTitle(slot) || 'Voting is open',
      href: {
        pathname: '/awards/vote',
        params: {
          award: slot.award_id,
          team: slot.team_id ?? '',
          fixture: slot.fixture_id ?? '',
          preseason: slot.preseason ? '1' : '',
        },
      },
    });
  } else if (toVote.length > 1) {
    todos.push({
      key: 'award-vote',
      title: `Vote in ${toVote.length} awards`,
      detail: 'Voting is open',
      href: '/awards',
    });
  }

  if (pendingCount > 0) {
    todos.push({
      key: 'join-requests',
      title: `Approve ${pendingCount} join ${pendingCount === 1 ? 'request' : 'requests'}`,
      detail: 'New members are waiting to be added to a squad',
      href: '/admin',
    });
  }

  if (safety) {
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    if (safety.minors_without_guardian > 0) {
      todos.push({
        key: 'minors-without-guardian',
        title: `Link guardians for ${plural(safety.minors_without_guardian, 'athlete', 'athletes')} under 18`,
        detail: 'Every athlete under 18 needs a verified guardian',
        href: '/admin',
      });
    }
    const wwcc = safety.wwcc_missing + safety.wwcc_expiring;
    if (wwcc > 0) {
      todos.push({
        key: 'wwcc',
        title: `Check ${plural(wwcc, 'Working With Children Check', 'Working With Children Checks')}`,
        detail:
          safety.wwcc_missing > 0
            ? `${plural(safety.wwcc_missing, 'coach, manager or physio has', 'coaches, managers and physios have')} none recorded or it has expired`
            : 'Expiring in the next 30 days',
        href: '/admin',
      });
    }
    if (safety.turning_18 > 0) {
      todos.push({
        key: 'turning-18',
        title: `${plural(safety.turning_18, 'athlete turns', 'athletes turn')} 18 this month`,
        detail: 'Their guardian links end when you next save them',
        href: '/admin',
      });
    }
  }

  return todos;
}

/** Reflection reminders stop a week after the game. */
const REFLECT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

function goalHref(game: GoalGame, athleteId: string | undefined): Href {
  return { pathname: '/goals/game', params: { athlete: athleteId ?? '', fixture: game.fixture_id } };
}
