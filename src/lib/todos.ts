import type { Href } from 'expo-router';

import type { AffiliationTodos } from '@/lib/affiliation';
import { slotTitle } from '@/lib/awards';
import { formatShortDay } from '@/lib/format';
import { gamePhase, gameTitle } from '@/lib/goals';
import { formatDateString, type LoggedInjury, toDateString } from '@/lib/injuries';
import type { KpiReviewTodo } from '@/lib/kpis';
import type { MedicalReview } from '@/lib/medical';
import { closingDay, surveysToAnswer, type MySurvey } from '@/lib/surveys';
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
  /** Such as "2026-10-17", when it has to be done by a certain day. */
  dueOn?: string;
  /** A red or amber warning: overdue or due soon, or a safety check needing attention. */
  alert?: TodoAlert;
};

/** Red for overdue or missing, amber for due soon or needing a check. */
export type TodoAlert = { level: 'red' | 'amber'; label: string };

/** To-dos due within this many days of today get an amber warning. */
export const DUE_SOON_DAYS = 3;

/** Red "Overdue", amber "Due soon" for within three days, or null. */
export function dueAlert(dueOn: string | null | undefined, today = new Date()): TodoAlert | null {
  if (!dueOn) return null;
  if (dueOn < toDateString(today)) return { level: 'red', label: 'Overdue' };
  const soon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + DUE_SOON_DAYS);
  return dueOn <= toDateString(soon) ? { level: 'amber', label: 'Due soon' } : null;
}

/**
 * Red warnings first, then amber, then the rest in the order they came.
 * Within red and amber, the earliest due date comes first.
 */
export function sortByAlert<T>(
  items: T[],
  alertOf: (item: T) => TodoAlert | null | undefined,
  dueOf: (item: T) => string | null | undefined,
) {
  const rank = (item: T) => {
    const level = alertOf(item)?.level;
    return level === 'red' ? 0 : level === 'amber' ? 1 : 2;
  };
  return items
    .map((item, index) => ({ item, index, rank: rank(item), due: dueOf(item) ?? '9999' }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.rank < 2 && a.due !== b.due) return a.due.localeCompare(b.due);
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Everything the member owes, daily items first, built from what the home
 * screen has already loaded. Each item disappears once it's done.
 *
 * `member_todos` in the database works out the same list for push
 * notifications (supabase/migrations/20261023150000_todo_push_notifications.sql).
 * When an item is added or changed here, change it there too, in a new migration.
 */
export function buildTodos({
  userId,
  injuries,
  loggedInjuries = [],
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
  applicationDeclarationWaiting = false,
  newConcerns = 0,
  wellbeingFlagAlerts = 0,
  absencesToReview = 0,
  consentsNeeded = [],
  conduct = [],
  affiliation = null,
  kpiReviews = [],
  surveys = [],
  medicalReviews = [],
  today = new Date(),
}: {
  userId: string | undefined;
  injuries: Injury[];
  /** Injuries a coach, manager or physio logged for the member or their child, not yet opened. */
  loggedInjuries?: LoggedInjury[];
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
  goals?: { next: GoalGame | null; recent: GoalGame[] } | null;
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
  /** An admin recorded the member's check application, and they haven't accepted its declaration. */
  applicationDeclarationWaiting?: boolean;
  /** Concerns nobody has acted on yet, for the people who handle them. */
  newConcerns?: number;
  /** Athletes flagged on 3 or more days in the last 7, for the Child Safety Officer. */
  wellbeingFlagAlerts?: number;
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
  /** Surveys sent to the member, including ones already answered. */
  surveys?: MySurvey[];
  /** Medical details the member keeps that need adding or their yearly check. */
  medicalReviews?: MedicalReview[];
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

  // A run of low check-ins can be the first sign something is wrong.
  if (wellbeingFlagAlerts > 0) {
    todos.push({
      key: 'wellbeing-flags',
      title: `Look at ${wellbeingFlagAlerts} ${wellbeingFlagAlerts === 1 ? 'athlete' : 'athletes'} flagged 3 times this week`,
      detail: 'Low check-in scores on 3 of the last 7 days',
      href: '/concerns/wellbeing',
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
  if (applicationDeclarationWaiting) {
    todos.push({
      key: 'wwcc-application-declaration',
      title: 'Confirm your Working With Children Check application',
      detail: 'It counts as your check once you accept the declaration',
      href: '/wwcc-application',
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

  // A coach, manager or physio logged an injury at training or a game.
  for (const logged of loggedInjuries) {
    const whose =
      logged.athlete_id === userId ? 'you' : (logged.athlete_name ?? 'your athlete');
    todos.push({
      key: `injury-logged-${logged.injury_id}`,
      title: `Look at the injury ${logged.logged_by_name ?? 'a club member'} logged for ${whose}`,
      detail: `${logged.body_area} · logged by their ${logged.logged_by_role}. Add the physio’s updates from there.`,
      href: { pathname: '/injuries/[id]', params: { id: logged.injury_id } },
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
      detail: waitingLabel(uniqueNames(toSignOff.map((i) => i.athlete_name ?? 'An athlete'))),
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
      dueOn: injury.expected_return,
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
      dueOn: toDateString(new Date(next.starts_at)),
    });
  }

  // Every game played in the last week whose goals the athlete hasn't reflected on,
  // oldest first, so two games in one week each get their own reminder.
  const toReflect = (goals?.recent ?? [])
    .filter(
      (game) =>
        game.reflected_count < game.goal_count &&
        today.getTime() - new Date(game.played_at).getTime() < REFLECT_WITHIN_MS,
    )
    .reverse();
  for (const game of toReflect) {
    todos.push({
      key: `game-reflection-${game.fixture_id}`,
      title: `Reflect on ${gameTitle(game)}`,
      detail: 'How did your goals go?',
      href: goalHref(game, userId),
    });
  }

  for (const game of teamGames) {
    if (!game.is_next || game.goal_count > 0 || gamePhase(game, today) !== 'open') continue;
    todos.push({
      key: `team-goals-${game.fixture_id}`,
      title: `Set team goals for ${game.team_name}`,
      detail: `${gameTitle(game)} · ${formatShortDay(new Date(game.starts_at))}`,
      href: { pathname: '/goals/team', params: { fixture: game.fixture_id } },
      dueOn: toDateString(new Date(game.starts_at)),
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
    // Name whose courses they are, so a parent of several children can tell.
    const whose = uniqueNames(
      toComplete.map((row) => (row.is_me ? 'you' : (row.profile_name ?? 'your athlete'))),
    );
    todos.push({
      key: 'training',
      title: `Complete ${toComplete.length} integrity training courses${
        whose.length === 1 && whose[0] === 'you' ? '' : ` for ${joinNames(whose)}`
      }`,
      detail: `${dueLabel(toComplete[0].due_on, today)} · upload each certificate when done`,
      href: '/training',
      dueOn: toComplete[0].due_on,
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
        dueOn: row.due_on,
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
    // One tile for every card problem. wwcc_people counts each member once;
    // an older database without it falls back to adding up the counts.
    const wwccParts = [
      [safety.wwcc_missing ?? 0, 'missing or expired'],
      [safety.wwcc_expiring ?? 0, 'expiring'],
      [safety.wwcc_to_validate ?? 0, 'to validate'],
      [safety.wwcc_to_link ?? 0, 'to register'],
    ] as const;
    const wwcc =
      safety.wwcc_people ?? wwccParts.reduce((total, [count]) => total + count, 0);
    if (wwcc > 0) {
      todos.push({
        key: 'wwcc',
        title: `Sort out ${plural(wwcc, 'Working With Children Check', 'Working With Children Checks')}`,
        detail: wwccParts
          .filter(([count]) => count > 0)
          .map(([count, label]) => `${count} ${label}`)
          .join(', '),
        href: '/admin',
        // Red when anyone's check is missing or expired, otherwise amber.
        alert:
          (safety.wwcc_missing ?? 0) > 0
            ? { level: 'red', label: 'Missing' }
            : {
                level: 'amber',
                label:
                  (safety.wwcc_expiring ?? 0) > 0
                    ? 'Expiring'
                    : (safety.wwcc_to_validate ?? 0) > 0
                      ? 'Validate'
                      : 'Register',
              },
      });
    }
    const applicationsDue = safety.wwcc_applications_due ?? 0;
    const applicationsLapsed = safety.wwcc_applications_lapsed ?? 0;
    if (applicationsDue + applicationsLapsed > 0) {
      const count = applicationsDue + applicationsLapsed;
      todos.push({
        key: 'wwcc-applications',
        title: `Confirm ${plural(count, 'check application is', 'check applications are')} still being assessed`,
        detail:
          applicationsLapsed > 0
            ? `${applicationsLapsed} lapsed. Check online, then confirm on the member’s page.`
            : 'Check online, then confirm on the member’s page',
        href: '/admin',
        alert:
          applicationsLapsed > 0
            ? { level: 'red', label: 'Lapsed' }
            : { level: 'amber', label: 'Confirm' },
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
    if (safety.wwc_officer_missing > 0) {
      todos.push({
        key: 'wwc-officer',
        title: 'Choose a WWC Registration Officer',
        detail: 'Under Safeguarding',
        href: '/admin/safeguarding',
      });
    }
    if ((safety.child_safety_officer_missing ?? 0) > 0) {
      todos.push({
        key: 'child-safety-officer',
        title: 'Name a Child Safety Officer',
        detail: 'Nobody with a current check holds it. Under Safeguarding',
        href: '/admin/safeguarding',
      });
    }
    if ((safety.complaints_manager_missing ?? 0) > 0) {
      todos.push({
        key: 'complaints-manager',
        title: 'Name a Complaints Manager',
        detail: 'Nobody with a current check holds it. Under Safeguarding',
        href: '/admin/safeguarding',
      });
    }
    const unendorsable = safety.unendorsable_clearances ?? [];
    if (unendorsable.length > 0) {
      todos.push({
        key: 'unendorsable-clearances',
        title:
          unendorsable.length === 1
            ? `Nobody can endorse ${unendorsable[0]}’s clearance`
            : `Nobody can endorse ${unendorsable.length} clearances`,
        detail: 'Make a physio Head Physio, or place a physio in their squad or team',
        href: '/admin',
        alert: { level: 'amber', label: 'Stuck' },
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
    if ((safety.inactive_members ?? 0) > 0) {
      todos.push({
        key: 'inactive-members',
        title: `${plural(safety.inactive_members ?? 0, 'member has', 'members have')} had no team or role for 2 years`,
        detail: 'Delete them if they’ve left the club. Their safeguarding records stay.',
        href: '/admin',
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

  for (const survey of surveysToAnswer(surveys)) {
    const closes = closingDay(survey.closes_at);
    todos.push({
      key: `survey-${survey.id}`,
      title: `Answer the survey “${survey.title}”`,
      detail: `${survey.everyone_answers ? 'Everyone must answer. ' : ''}Open until ${formatDateString(closes)}`,
      href: { pathname: '/surveys/[id]', params: { id: survey.id } },
      dueOn: closes,
    });
  }

  for (const review of medicalReviews) {
    const own = review.athlete_id === userId;
    const whose = own ? 'your' : `${review.athlete_name}’s`;
    const href: Href = { pathname: '/medical/[id]', params: { id: review.athlete_id } };
    if (review.status === 'missing' || !review.due_on) {
      todos.push({
        key: `medical-${review.athlete_id}`,
        title: `Add ${whose} medical and emergency details`,
        detail: 'Emergency contacts, allergies, conditions and medications, for training and games',
        href,
      });
    } else {
      todos.push({
        key: `medical-${review.athlete_id}`,
        title: `Check ${whose} medical details are still right`,
        detail: `Once a year. Due ${formatDateString(review.due_on)}`,
        href,
        dueOn: review.due_on,
      });
    }
  }

  return todos.map((todo) =>
    todo.alert || !todo.dueOn ? todo : { ...todo, alert: dueAlert(todo.dueOn, today) ?? undefined },
  );
}

/** Reflection reminders stop a week after the game. */
const REFLECT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

function waitingLabel(names: string[]) {
  return `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} waiting for your sign-off to return`;
}

/** Each name once, in the order first seen. */
function uniqueNames(names: string[]) {
  return [...new Set(names)];
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

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
            dueOn: first.due_on,
          }
        : {
            key: `kpi-review-${key}`,
            title: `Write ${people.length} KPI reviews`,
            detail: `${first.point_name} · ${first.team_name} · ${due}`,
            href: '/kpis',
            dueOn: first.due_on,
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
