import type { Href } from 'expo-router';

import type { AffiliationTodos } from '@/lib/affiliation';
import { slotTitle } from '@/lib/awards';
import { formatShortDay } from '@/lib/format';
import { gamePhase, gameTitle } from '@/lib/goals';
import { formatDateString, toDateString } from '@/lib/injuries';
import type { KpiReviewTodo } from '@/lib/kpis';
import { WWCC_WARNING_DAYS } from '@/lib/safety';
import { dueLabel, isOutstanding, type MyTraining } from '@/lib/training';
import type { AwardSlot, CoachTeamGame, GoalGame, Injury } from '@/lib/types';
import type { SafetyTodos } from '@/lib/use-pending-requests';
import { seasonLabel } from '@/lib/use-teams';

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
  goalCommentsTeamId,
  teamGames = [],
  training = [],
  certificatesToCheck = 0,
  declarationWaiting = false,
  newConcerns = 0,
  absencesToReview = 0,
  consentsNeeded = [],
  conduct = [],
  affiliation = null,
  kpiReviews = [],
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
  /** A squad or team with reflections waiting, whose page the to-do opens. */
  goalCommentsTeamId?: string;
  /** Next and last games of the groups the member coaches, for team goals. */
  teamGames?: CoachTeamGame[];
  /** Integrity training for the member and the athletes they are a guardian of. */
  training?: MyTraining[];
  /** Training certificates waiting for the committee that the member can check. */
  certificatesToCheck?: number;
  /** An admin recorded a volunteer exemption the member hasn't accepted yet. */
  declarationWaiting?: boolean;
  /** Concerns nobody has acted on yet, for the people who handle them. */
  newConcerns?: number;
  /** Absences reported or withdrawn for the member's squads and teams since they last looked. */
  absencesToReview?: number;
  /** A guardian's children under 18 still waiting for their consent. */
  consentsNeeded?: { id: string; name: string }[];
  /** Code of conduct acceptances still owed this season, for the member and their children. */
  conduct?: { id: string; name: string; forChild: boolean }[];
  /** Affiliation follow-ups, for admins of clubs that keep affiliation records. */
  affiliation?: AffiliationTodos | null;
  /** Season KPI reviews to write, and the member's own to confirm. */
  kpiReviews?: KpiReviewTodo[];
  today?: Date;
}): Todo[] {
  const todos: Todo[] = [];

  // A concern about a child can't wait, so it comes first.
  if (newConcerns > 0) {
    todos.push({
      key: 'concerns',
      title: `Look at ${newConcerns} new ${newConcerns === 1 ? 'concern' : 'concerns'}`,
      detail: 'Refer child abuse and serious crimes to Police straight away',
      href: '/concerns',
    });
  }

  // Their club role stays paused until they accept, so it comes first.
  if (declarationWaiting) {
    todos.push({
      key: 'volunteer-declaration',
      title: 'Accept the exemption declaration',
      detail: 'Your club role starts once you do',
      href: '/declaration',
    });
  }

  for (const child of consentsNeeded) {
    todos.push({
      key: `consent-${child.id}`,
      title: `Give consent for ${child.name}`,
      detail: 'Choose who sees their check-ins and injury details',
      href: `/consent/${child.id}`,
    });
  }

  for (const person of conduct) {
    todos.push({
      key: `conduct-${person.id}`,
      title: person.forChild
        ? `Accept the code of conduct for ${person.name}`
        : 'Accept the code of conduct',
      detail: person.forChild
        ? 'Go through it with them. Every member accepts it each season.'
        : 'Every member accepts it each season',
      href: { pathname: '/conduct/[id]', params: { id: person.id } },
    });
  }

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

  if (absencesToReview > 0) {
    todos.push({
      key: 'absences-to-review',
      title: `Review ${absencesToReview} new or changed ${absencesToReview === 1 ? 'absence' : 'absences'}`,
      detail: 'Athletes in your squads and teams reported or withdrew an absence',
      href: '/attendance',
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

  if (goalReflectionsToAnswer > 0 && goalCommentsTeamId) {
    todos.push({
      key: 'goal-comments',
      title: `Comment on ${goalReflectionsToAnswer} goal ${goalReflectionsToAnswer === 1 ? 'reflection' : 'reflections'}`,
      detail: 'Your athletes have said how their game went',
      href: { pathname: '/team/[id]', params: { id: goalCommentsTeamId } },
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

  // Integrity training, soonest due first. A long list is one item.
  const toComplete = training.filter(isOutstanding).sort((a, b) => a.due_on.localeCompare(b.due_on));
  if (toComplete.length > 2) {
    todos.push({
      key: 'training',
      title: `Complete ${toComplete.length} integrity training courses`,
      detail: `${dueLabel(toComplete[0].due_on, today)} · upload each certificate when done`,
      href: '/training',
    });
  } else {
    for (const row of toComplete) {
      const name = row.profile_name ?? 'your athlete';
      todos.push({
        key: `training-${row.requirement_id}-${row.profile_id}`,
        title:
          row.status === 'sent_back'
            ? `Upload ${row.is_me ? 'your' : `${name}’s`} ${row.name} certificate again`
            : `Complete ${row.name}${row.is_me ? '' : ` for ${name}`}`,
        detail:
          row.status === 'sent_back' && row.review_note
            ? `Sent back: ${row.review_note}`
            : `${dueLabel(row.due_on, today)} · then upload the certificate`,
        href: {
          pathname: '/training/submit',
          params: { profile: row.profile_id, requirement: row.requirement_id },
        },
      });
    }
  }

  if (certificatesToCheck > 0) {
    todos.push({
      key: 'training-certificates',
      title: `Check ${certificatesToCheck} training ${certificatesToCheck === 1 ? 'certificate' : 'certificates'}`,
      detail: 'Approve them, or send them back with a note',
      href: '/training/review',
    });
  }

  if (pendingCount > 0) {
    todos.push({
      key: 'join-requests',
      title: `Approve ${pendingCount} join ${pendingCount === 1 ? 'request' : 'requests'}`,
      detail: 'New members are waiting for you to approve them',
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
    if (safety.athletes_without_date_of_birth > 0) {
      todos.push({
        key: 'no-date-of-birth',
        title: `Add a date of birth for ${plural(safety.athletes_without_date_of_birth, 'athlete', 'athletes')}`,
        detail: 'Check it against PlayHQ or ID. It decides whether the under 18 rules apply.',
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
            ? `${plural(safety.wwcc_missing, 'member who needs one has', 'members who need one have')} none recorded or it has expired`
            : `Expiring in the next ${WWCC_WARNING_DAYS} days`,
        href: '/admin',
      });
    }
    if (safety.notices_to_report > 0) {
      todos.push({
        key: 'notices-to-report',
        title: `Tell the governing body about ${plural(safety.notices_to_report, 'Screening Unit notice', 'Screening Unit notices')}`,
        detail: 'In writing, then record the date on the member’s page',
        href: '/admin',
      });
    }
    if (safety.wwcc_to_validate > 0) {
      todos.push({
        key: 'wwcc-validate',
        title: `Validate ${plural(safety.wwcc_to_validate, 'Working With Children Check', 'Working With Children Checks')}`,
        detail: 'Never validated, or last validated over a year ago',
        href: '/admin',
      });
    }
    if (safety.wwcc_to_link > 0) {
      todos.push({
        key: 'wwcc-link',
        title: `Register ${plural(safety.wwcc_to_link, 'card', 'cards')} with the club`,
        detail: 'So the Screening Unit tells the club if a card’s status changes',
        href: '/admin',
      });
    }
    if (safety.wwc_officer_missing > 0) {
      todos.push({
        key: 'wwc-officer',
        title: 'Choose a WWC Registration Officer',
        detail: 'Under Safeguarding',
        href: '/admin/safeguarding',
      });
    }
    if (safety.exemptions_ending > 0) {
      todos.push({
        key: 'exemptions-ending',
        title: `${plural(safety.exemptions_ending, 'volunteer exemption ends', 'volunteer exemptions end')} soon`,
        detail: `Within ${WWCC_WARNING_DAYS} days. They’ll need a Working With Children Check to keep their role.`,
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
    if (safety.records_removal_off) {
      todos.push({
        key: 'records-removal-off',
        title: 'Old records are kept forever',
        detail: 'Switch on Remove old records in Club settings, under Keeping records',
        href: '/admin/club',
      });
    }
  }

  if (affiliation) {
    if (affiliation.missing > 0) {
      todos.push({
        key: 'affiliation-checklist',
        title: `Finish ${affiliation.missing} affiliation ${affiliation.missing === 1 ? 'item' : 'items'}`,
        detail: 'Required by your association or Netball WA',
        href: '/admin/affiliation',
      });
    }
    if (affiliation.toCheck > 0) {
      todos.push({
        key: 'playhq-registrations',
        title: `Check ${affiliation.toCheck} ${affiliation.toCheck === 1 ? 'member' : 'members'} in PlayHQ`,
        detail: `Whether they’re registered for ${affiliation.season ? seasonLabel(affiliation.season) : 'this season'}`,
        href: '/admin/affiliation/registrations',
      });
    }
    if (affiliation.notRegistered > 0) {
      todos.push({
        key: 'playhq-not-registered',
        title: `${affiliation.notRegistered} ${affiliation.notRegistered === 1 ? 'member isn’t' : 'members aren’t'} registered in PlayHQ`,
        detail: 'Ask them to register, then mark them registered',
        href: '/admin/affiliation/registrations',
      });
    }
    if (affiliation.returnDue) {
      todos.push({
        key: 'affiliation-return',
        title: 'Send the affiliation return',
        detail: 'None sent in the last year',
        href: '/admin/affiliation/return',
      });
    }
  }

  todos.push(...kpiReviewTodos(kpiReviews, toDateString(today)));

  return todos;
}

/** Reflection reminders stop a week after the game. */
const REFLECT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

function goalHref(game: GoalGame, athleteId: string | undefined): Href {
  return {
    pathname: '/goals/game',
    params: { athlete: athleteId ?? '', fixture: game.fixture_id },
  };
}

/**
 * Season KPI reviews: one item per review date and group to write (straight
 * to the person when there's only one), and one for each of the member's own
 * reviews to confirm.
 */
function kpiReviewTodos(rows: KpiReviewTodo[], today: string): Todo[] {
  const todos: Todo[] = [];
  const toWrite = new Map<string, KpiReviewTodo[]>();
  for (const row of rows.filter((r) => r.kind === 'write')) {
    const key = `${row.point_id}:${row.team_id}`;
    toWrite.set(key, [...(toWrite.get(key) ?? []), row]);
  }
  for (const [key, people] of toWrite) {
    const first = people[0];
    const due = `${first.due_on < today ? 'Was due' : 'Due'} ${formatDateString(first.due_on)}`;
    todos.push(
      people.length === 1
        ? {
            key: `kpi-review-${key}`,
            title: `Write ${first.full_name}’s KPI review`,
            detail: `${first.point_name} · ${first.team_name} · ${due}`,
            href: {
              pathname: '/kpis/person',
              params: { profile: first.profile_id, team: first.team_id },
            },
          }
        : {
            key: `kpi-review-${key}`,
            title: `Write ${people.length} KPI reviews`,
            detail: `${first.point_name} · ${first.team_name} · ${due}`,
            href: '/kpis',
          },
    );
  }
  for (const row of rows.filter((r) => r.kind === 'confirm')) {
    todos.push({
      key: `kpi-confirm-${row.point_id}:${row.team_id}`,
      title: 'Confirm your KPI review was done',
      detail: `${row.point_name} · ${row.team_name}`,
      href: { pathname: '/kpis/person', params: { profile: row.profile_id, team: row.team_id } },
    });
  }
  return todos;
}
