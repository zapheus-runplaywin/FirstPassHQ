/**
 * Everything the tabs share: what the member has to do, what's coming up and
 * what each card says. It is loaded once, beside the tab bar
 * (src/app/(tabs)/_layout.tsx), so Today, the hubs and Me all read the same
 * answers and none of them loads them twice.
 *
 * The rules for who sees each card are the ones the single Home screen had.
 * Where a card goes is src/lib/home-layout.ts.
 */
import { createContext, use, useState, type ReactNode } from 'react';

import { useAbsencesToReview, useLeadsAGroup } from '@/lib/absences';
import {
  useMySelectionFeedback,
  useMySelectionInfo,
  useMySelectionRounds,
  useMySelectionTodos,
} from '@/lib/assessments';
import { useAuth } from '@/lib/auth';
import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { useAwardSlots } from '@/lib/awards';
import { useChatBlocksWaiting } from '@/lib/chat-blocks';
import {
  checkInTotals,
  today,
  useCanSeeCheckIns,
  useCheckInOverview,
  useCheckInSummary,
  useIsCheckInCoach,
  useMyCheckIn,
} from '@/lib/check-ins';
import { useClub } from '@/lib/club';
import { useConcernTimes } from '@/lib/concern-times';
import { useConcernClocks, useConcernCounts, useNewConcerns } from '@/lib/concerns';
import { useConductTodos } from '@/lib/conduct';
import { type MyChild, useMyChildren } from '@/lib/children';
import { reflectionsToAnswer, useCoachTeamGames, useGoalBoard, useMyGoals } from '@/lib/goals';
import { ownCheckReason, rolesHeldLabel } from '@/lib/home-labels';
import {
  cardsIn,
  HOME_CARDS,
  hubsFor,
  type HomeCard,
  type HubName,
  type Place,
  type PlacementFacts,
} from '@/lib/home-layout';
import {
  useCanLogInjuries,
  useCanSeeInjuries,
  useLoggedInjuries,
  useOpenInjuries,
} from '@/lib/injuries';
import { useKpiPeople, useKpiReviewTodos } from '@/lib/kpis';
import { captainTitle } from '@/lib/labels';
import { useCoachLoadFlagCount, useLoadPatternAlerts } from '@/lib/load-monitoring';
import { useMyMedicalReviews } from '@/lib/medical';
import { useMessageAccessTodo } from '@/lib/message-access';
import { useGetsMessages, useUnreadCount } from '@/lib/messages';
import { usePersonalTasks } from '@/lib/personal-tasks';
import {
  useCanReadRegisters,
  useMyConflictDeclaration,
  useMyPolicyReviews,
} from '@/lib/registers';
import { useCanReadReports } from '@/lib/report-access';
import { hasRole, rolesOf } from '@/lib/roles';
import { safeguardingPostsLabel } from '@/lib/safeguarding-posts';
import { useSessionPlanSummary } from '@/lib/session-plans';
import { surveysToAnswer, useCanSendSurveys, useMySurveys } from '@/lib/surveys';
import { buildTodos } from '@/lib/todos';
import { useClubHasTraining, useMyTraining, useTrainingToReview } from '@/lib/training';
import { useEvents } from '@/lib/use-events';
import { usePendingRequests, useSafetyTodos } from '@/lib/use-pending-requests';
import { useWellbeingFlagAlerts } from '@/lib/wellbeing-flags';
import { isGuest } from '@/lib/wwcc-submissions';

/** A child a parent or guardian looks after, with the consents in force for them. */
export type HomeChild = MyChild;

/**
 * People with one job to do keep one screen and no tab bar: a temporary
 * helper, a child locked until a parent is linked, someone waiting for
 * approval (or turned down), and someone whose only role is Studio.
 */
export type SingleScreen = 'helper' | 'locked' | 'join' | 'studio';

function useHomeData() {
  const {
    session,
    profile,
    paused,
    exemption,
    wwccApplication,
    wwccSubmission,
    memberships,
    captaincies,
    isClubCaptain,
    isAdmin,
    isSafeguardingOfficer,
    safeguardingPosts,
    actingSafeguardingPosts,
    hasEscalatedConcerns,
    isLocked,
    refresh,
  } = useAuth();
  // Admins reach Reports from their menu in the Club tab; checked committee members from its Reports card.
  const canReadReports = useCanReadReports();
  // Admins and the two safeguarding officers handle concerns members raise,
  // and so does anyone a concern was escalated to by name (that one only).
  const handlesConcerns = isAdmin || isSafeguardingOfficer || hasEscalatedConcerns;
  const newConcerns = useNewConcerns(handlesConcerns);
  const concernClocks = useConcernClocks(handlesConcerns);
  // How long a clearance can wait for sign-off before it's Important, then Urgent.
  const concernTimes = useConcernTimes(!!session);
  const concernCounts = useConcernCounts(handlesConcerns);
  const messageAccess = useMessageAccessTodo(handlesConcerns);
  const club = useClub();
  const { features } = club;
  // Blocks in chat groups, for admins and the two safeguarding officers.
  const chatBlocksWaiting = useChatBlocksWaiting(
    (isAdmin || isSafeguardingOfficer) && features.chatGroups,
  );
  // The Child Safety Officer sees athletes flagged again and again.
  const wellbeingFlags = useWellbeingFlagAlerts(handlesConcerns && features.checkIns);
  // ...and children whose training load shows a pattern.
  const loadPatterns = useLoadPatternAlerts(wellbeingFlags.isOfficer && features.trainingLoad);
  const [refreshing, setRefreshing] = useState(false);
  const approved = profile?.status === 'approved';
  const isGuardian = approved && hasRole(profile, 'guardian');
  // The athletes a parent or guardian looks after, and how many changes each
  // has had since their guardian last looked.
  const { children, activityNew, reloadChildren } = useMyChildren(isGuardian);
  const { events, reload: reloadEvents } = useEvents();
  const { unreadCount, reloadUnread } = useUnreadCount();
  const { pendingCount, reloadPending } = usePendingRequests();
  const { safetyTodos, reloadSafetyTodos } = useSafetyTodos();
  const { conductTodos, reloadConductTodos } = useConductTodos();
  const { personalTasks, reloadPersonalTasks, setTaskDone } = usePersonalTasks();
  const plans = useSessionPlanSummary();
  const { kpiPeople, reloadKpiPeople } = useKpiPeople();
  const { kpiReviewTodos, reloadKpiReviewTodos } = useKpiReviewTodos();
  // Athletes 18 or over and verified parents keep medical details, checked yearly.
  const { medicalReviews, reloadMedicalReviews } = useMyMedicalReviews(
    profile?.status === 'approved' &&
      (hasRole(profile, 'athlete') || (hasRole(profile, 'guardian') && !!profile.verified_at)),
  );
  const { mySurveys, reloadMySurveys } = useMySurveys();
  const { policyReviews, reloadPolicyReviews } = useMyPolicyReviews();
  const { conflictDeclaration, reloadConflictDeclaration } = useMyConflictDeclaration();
  const { selectionRounds, reloadSelectionRounds } = useMySelectionRounds();
  const { selectionTodos, reloadSelectionTodos } = useMySelectionTodos();
  const { selectionInfo, reloadSelectionInfo } = useMySelectionInfo();
  const { selectionFeedback, reloadSelectionFeedback } = useMySelectionFeedback();
  const canReadRegisters = useCanReadRegisters() && features.registers;
  const canSendSurveys = useCanSendSurveys();
  const surveysWaiting = surveysToAnswer(mySurveys).length;
  const { absencesToReview, reloadAbsencesToReview } = useAbsencesToReview(useLeadsAGroup());
  const canSeeInjuries = useCanSeeInjuries();
  const canLogInjuries = useCanLogInjuries();
  const { loggedInjuries, reloadLoggedInjuries } = useLoggedInjuries();
  const canTakeAttendance = useCanTakeAttendance();
  const canViewAttendance = useCanViewAttendance();
  const { openInjuries, reloadInjuries } = useOpenInjuries();
  const injuriesWaiting = openInjuries.filter((i) => i.waiting_for_me).length;
  const { myCheckIn, reloadMyCheckIn } = useMyCheckIn();
  const canSeeCheckIns = useCanSeeCheckIns();
  const { checkInSummary, reloadCheckInSummary } = useCheckInSummary();
  const isCheckInCoach = useIsCheckInCoach();
  const loadFlags = useCoachLoadFlagCount(
    isCheckInCoach && features.checkIns && features.trainingLoad,
  );
  const { checkInOverview, reloadCheckInOverview } = useCheckInOverview(today());
  const { awardSlots, reloadAwardSlots } = useAwardSlots();
  const { myGoals, reloadMyGoals } = useMyGoals();
  const { goalBoard, reloadGoalBoard } = useGoalBoard();
  const { teamGames, reloadTeamGames } = useCoachTeamGames();
  const { myTraining, reloadMyTraining } = useMyTraining();
  const { toReview, reloadToReview } = useTrainingToReview();
  const { clubHasTraining, reloadClubHasTraining } = useClubHasTraining();
  const certificatesToCheck = (toReview ?? []).filter((c) => c.can_review).length;
  const goalComments = reflectionsToAnswer(goalBoard);
  // Game goals live on each squad or team's page; the to-do list links straight there.
  const goalCommentsTeamId = goalBoard?.find((row) => row.reflections_to_answer > 0)?.team_id;
  // Turned-off features add nothing to the to-do list.
  const todos = buildTodos({
    userId: session?.user.id,
    injuries: features.injuries ? openInjuries : [],
    loggedInjuries: features.injuries ? loggedInjuries : [],
    pendingCount,
    needsCheckIn: features.checkIns && myCheckIn === null,
    flaggedAthletes: features.checkIns ? checkInTotals(checkInSummary).flagged : 0,
    awardSlots: features.awards ? awardSlots : [],
    safety: safetyTodos,
    goals: myGoals ?? null,
    goalReflectionsToAnswer: goalComments,
    goalCommentsTeamId,
    teamGames: teamGames ?? [],
    training: features.integrity ? (myTraining ?? []) : [],
    certificatesToCheck: features.integrity ? certificatesToCheck : 0,
    declarationWaiting: !!exemption && !exemption.declared_at,
    applicationDeclarationWaiting:
      !!wwccApplication &&
      !wwccApplication.declared_at &&
      wwccApplication.status === 'waiting_for_declaration',
    ownCheck: ownCheckReason(profile, paused, exemption, wwccApplication),
    // A guest's card is optional: one sent back shows in Your details, not as a to-do.
    wwccSubmission: isGuest(profile, paused?.roles) ? null : wwccSubmission,
    newConcerns,
    concernClocks,
    concernTimes,
    messageAccess,
    chatBlocksWaiting,
    wellbeingFlagAlerts: wellbeingFlags.repeated,
    loadPatternAlerts: loadPatterns,
    loadFlags,
    absencesToReview: absencesToReview.length,
    consentsNeeded: children
      .filter((a) => a.needsConsent)
      .map((a) => ({ id: a.id, name: a.name, detail: a.consentDetail })),
    conduct: conductTodos.map((t) => ({
      id: t.profile_id,
      name: t.full_name ?? 'your child',
      forChild: t.for_child,
    })),
    kpiReviews: kpiReviewTodos,
    surveys: features.surveys ? mySurveys : [],
    medicalReviews,
    policyReviews,
    selectionTodos,
    conflictDeclaration,
  });

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([
      refresh(),
      reloadPending(),
      reloadSafetyTodos(),
      reloadConductTodos(),
      reloadPersonalTasks(),
      plans.reloadSummary(),
      reloadKpiPeople(),
      reloadKpiReviewTodos(),
      reloadMedicalReviews(),
      reloadPolicyReviews(),
      reloadConflictDeclaration(),
      reloadSelectionRounds(),
      reloadSelectionTodos(),
      reloadSelectionInfo(),
      reloadSelectionFeedback(),
      reloadMySurveys(),
      reloadAbsencesToReview(),
      reloadChildren(),
      reloadEvents(),
      reloadUnread(),
      reloadInjuries(),
      reloadLoggedInjuries(),
      reloadMyCheckIn(),
      reloadCheckInSummary(),
      reloadCheckInOverview(),
      reloadAwardSlots(),
      reloadMyGoals(),
      reloadGoalBoard(),
      reloadTeamGames(),
      reloadMyTraining(),
      reloadToReview(),
      reloadClubHasTraining(),
    ]);
    setRefreshing(false);
  }

  const name = profile?.preferred_name || profile?.full_name || session?.user.email || 'there';
  // Athletes see their own attendance and report absences.
  const isAthlete =
    approved &&
    (hasRole(profile, 'athlete') || memberships.some((m) => m.team_role === 'athlete'));
  // Committee members and admins aren't in squads, so they only see their
  // squads and teams when they are in one, for example as a coach too.
  const showGroups =
    approved && (memberships.length > 0 || !(isAdmin || hasRole(profile, 'committee')));
  const getsMessages = useGetsMessages();
  // Temporary helpers only see the steps to be cleared, and Raise a concern.
  // Checked on the roles held, so a stood-down helper still only sees these.
  const volunteer =
    profile?.status !== 'rejected' &&
    (approved
      ? hasRole(profile, 'volunteer') || !!paused?.roles.includes('volunteer')
      : !!profile?.join_requested_at && profile.requested_role === 'volunteer');
  // Studio on its own (someone who runs the club's live streams) isn't a club
  // member: they only see what the role is for, and Raise a concern. Checked
  // on the roles held, so a stood-down operator (shown as a guest) still only
  // sees this.
  const heldRoles =
    approved && profile
      ? paused?.roles.length
        ? [...rolesOf(profile).filter((r) => r !== 'guest'), ...paused.roles]
        : rolesOf(profile)
      : [];
  const studioOnly = heldRoles.length > 0 && heldRoles.every((r) => r === 'studio');
  const single: SingleScreen | null = volunteer
    ? 'helper'
    : isLocked
      ? 'locked'
      : !approved
        ? 'join'
        : studioOnly
          ? 'studio'
          : null;

  // Each card shows by the rule it had on the one Home screen.
  const shows: Record<HomeCard, boolean> = {
    verification: isGuardian && !profile?.verified_at,
    concerns: handlesConcerns,
    dailyCheckIn: features.checkIns && myCheckIn !== undefined,
    checkIns: features.checkIns && canSeeCheckIns,
    attendance: features.attendance && (canTakeAttendance || canViewAttendance),
    myAttendance: features.attendance && isAthlete && !!session,
    injuries: features.injuries && (canSeeInjuries || canLogInjuries),
    sessionPlans: features.sessionPlans && (plans.canAdd || plans.shared > 0),
    reports: canReadReports && !isAdmin,
    administration: isAdmin,
    surveys: features.surveys && (canSendSurveys || mySurveys.length > 0),
    awards: features.awards && approved && awardSlots.length > 0,
    integrity: features.integrity && ((myTraining ?? []).length > 0 || clubHasTraining),
    kpis: features.kpis && (kpiPeople ?? []).some((p) => !p.archived),
    selectionAssessments: selectionRounds.length > 0,
    selection: selectionInfo.length > 0 || selectionFeedback.length > 0,
    registers: canReadRegisters,
    guardianOf: isGuardian,
    children: isGuardian && children.length > 0,
    groups: showGroups,
  };
  const shown = single ? [] : HOME_CARDS.filter((card) => shows[card]);

  const facts: PlacementFacts = {
    athlete: isAthlete,
    staff:
      approved &&
      (hasRole(profile, 'coach', 'manager', 'physio') ||
        memberships.some(
          (m) => m.team_role === 'coach' || m.team_role === 'manager' || m.team_role === 'physio',
        )),
    guardian: isGuardian,
    clubOfficer: approved && (isAdmin || hasRole(profile, 'committee')),
    canSendSurveys,
    hasSurveys: mySurveys.length > 0,
    hasOwnTraining: (myTraining ?? []).length > 0,
    kpiRelations: [...new Set((kpiPeople ?? []).filter((p) => !p.archived).map((p) => p.relation))],
  };
  const hubs: HubName[] = single ? [] : hubsFor(facts);

  return {
    /** One focused screen instead of the tabs, and which. */
    single,
    approved,
    name,
    roles:
      approved && profile ? rolesHeldLabel(profile, memberships, paused?.roles ?? []) : undefined,
    titles:
      approved && profile
        ? [
            captainTitle(captaincies, memberships, isClubCaptain),
            safeguardingPostsLabel(safeguardingPosts, actingSafeguardingPosts),
          ]
            .filter(Boolean)
            .join(' · ')
        : undefined,
    hubs,
    /** The cards that live in one place, in order. */
    cards: (place: Place) => cardsIn(place, shown, facts),
    getsMessages: getsMessages && features.messages,
    refreshing,
    onRefresh,
    todos,
    personalTasks,
    setTaskDone,
    events,
    unreadCount,
    reloadUnread,
    // What the cards say.
    myCheckIn,
    reloadMyCheckIn,
    isCheckInCoach,
    checkInSummary,
    checkInOverview,
    canTakeAttendance,
    canViewAttendance,
    /** Absences reported or withdrawn since a coach or manager last looked. */
    absencesToReview: absencesToReview.length,
    canSeeInjuries,
    openInjuries,
    injuriesWaiting,
    plans,
    newConcerns,
    concernCounts,
    pendingCount,
    canSendSurveys,
    surveysWaiting,
    awardSlots,
    myTraining: myTraining ?? [],
    certificatesToCheck,
    kpiPeople: kpiPeople ?? [],
    selectionRounds,
    selectionInfo,
    selectionFeedback,
    children,
    activityNew,
    medicalReviews,
  };
}

export type Home = ReturnType<typeof useHomeData>;

const HomeContext = createContext<Home | null>(null);

/** Loads what the tabs share. Mounted once, around the tab bar. */
export function HomeProvider({ children }: { children: ReactNode }) {
  const home = useHomeData();
  return <HomeContext value={home}>{children}</HomeContext>;
}

/** What the member has to do, what's coming up, and what each card says. */
export function useHome(): Home {
  const home = use(HomeContext);
  if (!home) throw new Error('useHome is only for screens inside the tabs');
  return home;
}
