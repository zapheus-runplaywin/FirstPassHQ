import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConcernLights } from '@/components/concern-lights';
import { EventGrid } from '@/components/event-card';
import { HomeHeader } from '@/components/home-header';
import { ChildCodeCard, WaitingForGuardian } from '@/components/guardian-link';
import { NoAppChildCard } from '@/components/no-app-child';
import { SafeguardingContactsCard } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { TodoList } from '@/components/todo-list';
import { VolunteerOnboarding } from '@/components/volunteer-onboarding';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAbsencesToReview, useLeadsAGroup } from '@/lib/absences';
import {
  roundsLabel,
  selectionHomeHref,
  selectionInfoLabel,
  useMySelectionInfo,
  useMySelectionRounds,
  useMySelectionTodos,
} from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { useConductTodos } from '@/lib/conduct';
import { safeguardingPostsLabel } from '@/lib/safeguarding-posts';
import { committeeCheckDue, isDatedExemption, statisticianCheckDue } from '@/lib/safety';
import {
  canSendOwnCheck,
  isGuest,
  ownCheckExpiring,
  submissionStatusText,
} from '@/lib/wwcc-submissions';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { useAwardSlots } from '@/lib/awards';
import { useClub } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';
import { guardianOfText } from '@/lib/guardian-links';
import {
  checkInOverviewLabel,
  checkInSummaryLabel,
  checkInTotals,
  today,
  useCanSeeCheckIns,
  useCheckInOverview,
  useCheckInSummary,
  useIsCheckInCoach,
  useMyCheckIn,
} from '@/lib/check-ins';
import { reflectionsToAnswer, useCoachTeamGames, useGoalBoard, useMyGoals } from '@/lib/goals';
import {
  formatDateString,
  injuriesSummary,
  useCanLogInjuries,
  useCanSeeInjuries,
  useLoggedInjuries,
  useOpenInjuries,
} from '@/lib/injuries';
import { useKpiPeople, useKpiReviewTodos, type KpiPerson } from '@/lib/kpis';
import { useCoachLoadFlagCount, useLoadPatternAlerts } from '@/lib/load-monitoring';
import { useMyMedicalReviews } from '@/lib/medical';
import { useGetsMessages, useUnreadCount } from '@/lib/messages';
import {
  pendingRequestsLabel,
  usePendingRequests,
  useSafetyTodos,
} from '@/lib/use-pending-requests';
import {
  captainTitle,
  rejectionReasonMessages,
  rolesLabel,
  staffTitle,
  teamPositionLabel,
} from '@/lib/labels';
import { useMessageAccessTodo } from '@/lib/message-access';
import { supabase } from '@/lib/supabase';
import { useConcernCounts, useNewConcerns } from '@/lib/concerns';
import { useCanReadReports } from '@/lib/report-access';
import { usePersonalTasks } from '@/lib/personal-tasks';
import { useSessionPlanSummary } from '@/lib/session-plans';
import { useCanSendSurveys, useMySurveys, surveysToAnswer } from '@/lib/surveys';
import {
  useCanReadRegisters,
  useMyConflictDeclaration,
  useMyPolicyReviews,
} from '@/lib/registers';
import { buildTodos } from '@/lib/todos';
import {
  asksCheckIns,
  type ChildConsent,
  consentTodoDetail,
  needsConsent,
} from '@/lib/consents';
import {
  isOutstanding,
  useClubHasTraining,
  useMyTraining,
  useTrainingToReview,
  type MyTraining,
} from '@/lib/training';
import type { AppRole, Profile, TeamMembership } from '@/lib/types';
import { useEvents } from '@/lib/use-events';
import { useWellbeingFlagAlerts } from '@/lib/wellbeing-flags';
import { hasRole, rolesOf } from '@/lib/roles';

/** Three rows of two tiles. */
const UPCOMING_COUNT = 6;

export default function HomeScreen() {
  const theme = useTheme();
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
    waitingForGuardian,
    isLocked,
    refresh,
    signOut,
  } = useAuth();
  // Admins reach Reports from Administration; checked committee members from here.
  const canReadReports = useCanReadReports();
  // Admins and the two safeguarding officers handle concerns members raise.
  const handlesConcerns = isAdmin || isSafeguardingOfficer;
  const newConcerns = useNewConcerns(handlesConcerns);
  const concernCounts = useConcernCounts(handlesConcerns);
  const messageAccess = useMessageAccessTodo(handlesConcerns);
  const { switchClub } = useClubChoice();
  const club = useClub();
  const { features } = club;
  // The Child Safety Officer sees athletes flagged again and again.
  const wellbeingFlags = useWellbeingFlagAlerts(handlesConcerns && features.checkIns);
  // ...and children whose training load shows a pattern.
  const loadPatterns = useLoadPatternAlerts(wellbeingFlags.isOfficer && features.trainingLoad);
  const [refreshing, setRefreshing] = useState(false);
  const [athletes, setAthletes] = useState<
    {
      id: string;
      name: string;
      data: boolean;
      health: boolean;
      canConsent: boolean;
      checkInsOn: boolean;
      needsConsent: boolean;
      consentDetail: string;
    }[]
  >([]);
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
    // A guest's card is optional: one sent back shows in My details, not as a to-do.
    wwccSubmission: isGuest(profile, paused?.roles) ? null : wwccSubmission,
    newConcerns,
    messageAccess,
    wellbeingFlagAlerts: wellbeingFlags.repeated,
    loadPatternAlerts: loadPatterns,
    loadFlags,
    absencesToReview: absencesToReview.length,
    consentsNeeded: athletes
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

  const isGuardian = profile?.status === 'approved' && hasRole(profile, 'guardian');
  // How many changes each child has had since their guardian last looked.
  const [activityNew, setActivityNew] = useState<Record<string, number>>({});

  // The athletes a parent or guardian looks after.
  const loadAthletes = useCallback(async () => {
    if (!isGuardian) return;
    // Each child under 18 with the consents in force for them.
    const [{ data }, activity] = await Promise.all([
      supabase.rpc('my_child_consents'),
      supabase.rpc('child_activity_new'),
    ]);
    const counts: Record<string, number> = {};
    for (const row of (activity.data as { athlete_id: string; new_count: number }[] | null) ?? []) {
      counts[row.athlete_id] = row.new_count;
    }
    setActivityNew(counts);
    setAthletes(
      ((data as ChildConsent[] | null) ?? []).map((a) => ({
        id: a.athlete_id,
        name: a.full_name ?? 'Unnamed athlete',
        data: a.data,
        health: a.health,
        canConsent: a.can_consent,
        checkInsOn: asksCheckIns(a),
        needsConsent: needsConsent(a),
        consentDetail: consentTodoDetail(a),
      })),
    );
  }, [isGuardian]);

  useFocusEffect(
    useCallback(() => {
      loadAthletes();
    }, [loadAthletes]),
  );

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
      reloadMySurveys(),
      reloadAbsencesToReview(),
      loadAthletes(),
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
  const approved = profile?.status === 'approved';
  // Athletes see their own attendance and report absences.
  const isAthlete =
    approved &&
    (hasRole(profile, 'athlete') || memberships.some((m) => m.team_role === 'athlete'));
  // Committee members and admins aren't in squads, so they only see this
  // section when they are in one, for example as a coach too.
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

  return (
    <Screen withTopInset refreshing={refreshing} onRefresh={onRefresh} showVersion>
      <HomeHeader
        name={name}
        roles={
          approved && profile
            ? rolesHeldLabel(profile, memberships, paused?.roles ?? [])
            : undefined
        }
        titles={
          approved && profile
            ? [
                captainTitle(captaincies, memberships, isClubCaptain),
                safeguardingPostsLabel(safeguardingPosts),
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        logo={club.logo}
        clubName={club.name}
      />

      {volunteer ? (
        <VolunteerOnboarding verificationCode={<VerificationCode />} />
      ) : isLocked ? (
        // Approved, but locked until a verified parent or guardian is linked.
        <>
          <WaitingForGuardian />
          <ThemedText type="small" themeColor="textSecondary">
            If anything worries you, these people can help:
          </ThemedText>
          <SafeguardingContactsCard />
        </>
      ) : !approved ? (
        <JoinStatus />
      ) : studioOnly ? (
        <StudioOnly paused={!!paused?.roles.includes('studio')} />
      ) : null}

      {volunteer || waitingForGuardian || studioOnly ? null : (
        <>

        {approved ? <PausedRoles /> : null}

        {approved ? <CommitteeCheckDue /> : null}

        {approved ? <StatisticianCheckDue /> : null}

        {approved ? <AdminChildInjuriesClosed /> : null}

        {/* Main order: To do, Messages, Coming up, check-ins, attendance, Injuries, Session
            plans, Concerns, Reports or Administration. Raise a concern stays last. */}
        {approved ? (
          <TodoList todos={todos} personalTasks={personalTasks} onToggleTask={setTaskDone} />
        ) : null}

        {getsMessages && features.messages ? (
          <PressableCard onPress={() => router.push('/messages')}>
            <View style={styles.cardTitleRow}>
              <ThemedText type="smallBold">Messages</ThemedText>
              {unreadCount > 0 ? (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    {unreadCount}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {unreadCount === 0
                ? 'No new messages'
                : `${unreadCount} new ${unreadCount === 1 ? 'message' : 'messages'}`}
            </ThemedText>
          </PressableCard>
        ) : null}

        {approved && features.calendar ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="smallBold">Coming up</ThemedText>
              <Pressable accessibilityRole="button" onPress={() => router.push('/calendar')}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  Full calendar
                </ThemedText>
              </Pressable>
            </View>
            {events === null ? null : events.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing on the calendar yet.
              </ThemedText>
            ) : (
              <EventGrid events={events.slice(0, UPCOMING_COUNT)} showDay />
            )}
          </View>
        ) : null}

        {features.checkIns && myCheckIn !== undefined ? (
          <PressableCard onPress={() => router.push('/check-in')}>
            <ThemedText type="smallBold">Daily check-in</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {myCheckIn ? '✓ Done for today' : 'Not done yet today'}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.checkIns && canSeeCheckIns ? (
          <PressableCard onPress={() => router.push('/check-ins')}>
            <ThemedText type="smallBold">Check-ins</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isCheckInCoach && checkInSummary.length > 0
                ? checkInSummaryLabel(checkInSummary)
                : checkInOverviewLabel(checkInOverview)}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.attendance && (canTakeAttendance || canViewAttendance) ? (
          <PressableCard onPress={() => router.push('/attendance')}>
            <ThemedText type="smallBold">Attendance</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {canTakeAttendance
                ? 'Take attendance and see past sessions'
                : 'See athletes’ attendance'}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.attendance && isAthlete && session ? (
          <PressableCard
            onPress={() =>
              router.push({ pathname: '/attendance/family/[id]', params: { id: session.user.id } })
            }>
            <ThemedText type="smallBold">My attendance</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your sessions, and tell your coaches if you’ll be away
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.injuries && (canSeeInjuries || canLogInjuries) ? (
          <PressableCard onPress={() => router.push('/injuries')}>
            <View style={styles.cardTitleRow}>
              <ThemedText type="smallBold">Injuries</ThemedText>
              {injuriesWaiting > 0 ? (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    {injuriesWaiting}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {canSeeInjuries
                ? injuriesSummary(openInjuries)
                : 'Log an injury at training or a game'}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.sessionPlans && (plans.canAdd || plans.shared > 0) ? (
          <PressableCard onPress={() => router.push('/session-plans')}>
            <View style={styles.cardTitleRow}>
              <ThemedText type="smallBold">Session plans</ThemedText>
              {plans.newShared > 0 ? (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    {plans.newShared}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {plans.newShared > 0
                ? `${plans.newShared} new ${plans.newShared === 1 ? 'plan' : 'plans'} shared with you`
                : plans.canAdd
                  ? 'Add a plan before or after a session'
                  : 'Plans your coaches have shared'}
            </ThemedText>
          </PressableCard>
        ) : null}

        {handlesConcerns ? (
          <PressableCard onPress={() => router.push('/concerns')}>
            <ThemedText type="smallBold">Concerns</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {newConcerns > 0
                ? `${newConcerns} new ${newConcerns === 1 ? 'concern' : 'concerns'} to look at`
                : 'The concerns register'}
            </ThemedText>
            <ConcernLights counts={concernCounts} />
          </PressableCard>
        ) : null}

        {canReadReports && !isAdmin ? (
          <PressableCard onPress={() => router.push('/admin/reports')}>
            <ThemedText type="smallBold">Reports</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              The club’s checks, medical details checks, training, attendance and award results
            </ThemedText>
          </PressableCard>
        ) : null}

        {isAdmin ? (
          <PressableCard onPress={() => router.push('/administration')}>
            <ThemedText type="smallBold">Administration</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {pendingRequestsLabel(pendingCount)}
            </ThemedText>
          </PressableCard>
        ) : null}

        {/* Cards outside the main order, in their earlier order. */}

        {features.surveys && (canSendSurveys || mySurveys.length > 0) ? (
          <PressableCard onPress={() => router.push('/surveys')}>
            <View style={styles.cardTitleRow}>
              <ThemedText type="smallBold">Surveys</ThemedText>
              {surveysWaiting > 0 ? (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    {surveysWaiting}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {surveysWaiting > 0
                ? `${surveysWaiting} to answer`
                : canSendSurveys
                  ? 'Send a survey and see results'
                  : 'Nothing to answer'}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.awards && approved && awardSlots.length > 0 ? (
          <PressableCard onPress={() => router.push('/awards')}>
            <ThemedText type="smallBold">Awards</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {awardsLabel(awardSlots.length, awardSlots.filter((s) => !s.voted).length)}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.integrity && ((myTraining ?? []).length > 0 || clubHasTraining) ? (
          <PressableCard onPress={() => router.push('/training')}>
            <View style={styles.cardTitleRow}>
              <ThemedText type="smallBold">Integrity training</ThemedText>
              {certificatesToCheck > 0 ? (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    {certificatesToCheck}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {trainingLabel(myTraining ?? [], certificatesToCheck)}
            </ThemedText>
          </PressableCard>
        ) : null}

        {features.kpis && (kpiPeople ?? []).some((p) => !p.archived) ? (
          <PressableCard onPress={() => router.push('/kpis')}>
            <ThemedText type="smallBold">Season KPIs</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {kpisLabel(kpiPeople ?? [])}
            </ThemedText>
          </PressableCard>
        ) : null}

        {selectionRounds.length > 0 ? (
          <PressableCard onPress={() => router.push(selectionHomeHref(selectionRounds))}>
            <ThemedText type="smallBold">Selection assessments</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {roundsLabel(selectionRounds)}
            </ThemedText>
          </PressableCard>
        ) : null}

        {selectionInfo.length > 0 ? (
          <PressableCard onPress={() => router.push('/selection')}>
            <ThemedText type="smallBold">Selection</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {selectionInfoLabel(selectionInfo, clubToday())}
            </ThemedText>
          </PressableCard>
        ) : null}

        {canReadRegisters ? (
          <PressableCard onPress={() => router.push('/registers')}>
            <ThemedText type="smallBold">Registers</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              The club’s policies and conflicts of interest
            </ThemedText>
          </PressableCard>
        ) : null}

        {isGuardian && !profile?.verified_at ? (
          // An admin can still verify an approved guardian in person with this code.
          <Card>
            <ThemedText type="smallBold">Confirm who you are</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              A club admin verifies you before linking you to your child, against PlayHQ, by
              sighting your ID, or with this code in person or over a channel they already trust.
              Never share it with anyone else.
            </ThemedText>
            <VerificationCode />
          </Card>
        ) : null}

        {isGuardian ? (
          // Their children, and adding another (a link code, or a child who
          // won't use the app), sit behind one card so Home stays short.
          <PressableCard onPress={() => router.push('/children')}>
            <ThemedText type="smallBold">Guardian of</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {guardianOfText(athletes.map((a) => a.name))}
            </ThemedText>
            <ThemedText type="small" themeColor="tint">
              {athletes.length > 0 ? 'Add another child' : 'Add your child'}
            </ThemedText>
          </PressableCard>
        ) : null}

        {isGuardian && features.goals && athletes.length > 0 ? (
          // Guardians aren't in a squad, so their athletes' game goals open from here.
          <View style={styles.section}>
            <ThemedText type="smallBold">Game goals</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() =>
                  router.push({
                    pathname: '/goals/athlete/[id]',
                    params: { id: a.id, name: a.name, view: 'guardian' },
                  })
                }>
                <ThemedText type="smallBold">{a.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Game goals and reflections
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {isGuardian && athletes.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Consent</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() => router.push({ pathname: '/consent/[id]', params: { id: a.id } })}>
                <ThemedText type="smallBold">{a.name}</ThemedText>
                <ThemedText
                  type="small"
                  themeColor={a.needsConsent ? 'tint' : 'textSecondary'}>
                  {consentSummary(a)}
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {isGuardian && athletes.length > 0 && profile?.verified_at ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Medical and emergency</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() => router.push({ pathname: '/medical/[id]', params: { id: a.id } })}>
                <ThemedText type="smallBold">{a.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Emergency contacts, allergies, conditions, medications and an action plan
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {isGuardian && features.attendance && athletes.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Attendance</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() =>
                  router.push({
                    pathname: '/attendance/family/[id]',
                    params: { id: a.id, name: a.name },
                  })
                }>
                <ThemedText type="smallBold">{a.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Their sessions, and tell their coaches if they’ll be away
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {isGuardian && features.checkIns && athletes.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Check-ins</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() =>
                  router.push({
                    pathname: '/check-ins/athlete/[id]',
                    params: { id: a.id, name: a.name },
                  })
                }>
                <ThemedText type="smallBold">{a.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Their daily check-ins and notes from the last four weeks
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {isGuardian && athletes.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">What’s changed</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() =>
                  router.push({ pathname: '/activity/[id]', params: { id: a.id, name: a.name } })
                }>
                <View style={styles.cardTitleRow}>
                  <ThemedText type="smallBold">{a.name}</ThemedText>
                  {(activityNew[a.id] ?? 0) > 0 ? (
                    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                      <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                        {activityNew[a.id]}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  New coaches, managers and physios, guardians, consents and shared documents
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {isGuardian && athletes.length > 0 && profile?.verified_at ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Who has viewed their records</ThemedText>
            {athletes.map((a) => (
              <PressableCard
                key={a.id}
                onPress={() =>
                  router.push({ pathname: '/records/[id]', params: { id: a.id, name: a.name } })
                }>
                <ThemedText type="smallBold">{a.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Who at the club opened their injuries, check-ins, game goals, season KPIs, named survey answers, medical details or member record
                </ThemedText>
              </PressableCard>
            ))}
          </View>
        ) : null}

        {showGroups ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">{club.squads ? 'My squads and teams' : 'My teams'}</ThemedText>
            {memberships.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                You are not in a {club.squads ? 'squad' : 'team'} yet.
              </ThemedText>
            ) : (
              sortMemberships(memberships).map((m) => (
                <PressableCard
                  key={m.team.id}
                  onPress={() => router.push({ pathname: '/team/[id]', params: { id: m.team.id } })}>
                  <ThemedText type="smallBold">{m.team.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {m.team.kind === 'squad' ? 'Squad' : 'Team'} ·{' '}
                    {teamPositionLabel(m.team_role, m.coach_title, m.selection)}
                  </ThemedText>
                </PressableCard>
              ))
            )}
          </View>
        ) : null}
        </>
      )}

      <PressableCard onPress={() => router.push('/concern/new')}>
        <ThemedText type="smallBold">Raise a concern</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Worried about a child, or something someone said or did? Tell the club safely. If a child
          is in danger now, call 000.
        </ThemedText>
      </PressableCard>

      <View style={styles.footer}>
        {waitingForGuardian ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/my-details')}
            style={styles.footerLink}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              Your details
            </ThemedText>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.footerLink}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Sign out
          </ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={switchClub} style={styles.footerLink}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Switch club
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/delete-account')}
          style={styles.footerLink}>
          <ThemedText type="small" themeColor="textSecondary">
            Delete account
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

function awardsLabel(open: number, toVote: number) {
  if (toVote === 0)
    return `✓ You’ve voted in all ${open === 1 ? 'open award' : `${open} open awards`}`;
  return `${toVote} ${toVote === 1 ? 'vote' : 'votes'} waiting for you`;
}

function trainingLabel(rows: MyTraining[], toCheck: number) {
  const left = rows.filter(isOutstanding).length;
  const parts = [];
  if (rows.length > 0) {
    parts.push(left === 0 ? '✓ All your training is in' : `${left} still to complete`);
  }
  if (toCheck > 0) parts.push(`${toCheck} ${toCheck === 1 ? 'certificate' : 'certificates'} to check`);
  return parts.join(' · ') || 'Certificates and everyone’s progress';
}

/** Such as "3 of yours · 12 people you set them for". */
function kpisLabel(people: KpiPerson[]) {
  const current = people.filter((p) => !p.archived);
  const mine = current
    .filter((p) => p.relation === 'self')
    .reduce((n, p) => n + p.kpi_count, 0);
  const children = new Set(current.filter((p) => p.relation === 'guardian').map((p) => p.profile_id));
  const setting = new Set(current.filter((p) => p.relation === 'setter').map((p) => p.profile_id));
  const parts = [];
  if (mine > 0) parts.push(`${mine} of yours`);
  if (children.size > 0) parts.push(children.size === 1 ? 'Your child’s' : 'Your children’s');
  if (setting.size > 0) {
    parts.push(`${setting.size} ${setting.size === 1 ? 'person' : 'people'} you set them for`);
  }
  return parts.join(' · ') || 'What each person is working to achieve this season';
}

/** Named teams first, then squads, in club order. */
function sortMemberships(memberships: TeamMembership[]) {
  return [...memberships].sort(
    (a, b) =>
      (a.team.kind === 'team' ? 0 : 1) - (b.team.kind === 'team' ? 0 : 1) ||
      a.team.sort_order - b.team.sort_order ||
      a.team.name.localeCompare(b.team.name),
  );
}

/** The member's roles for the header, with any paused ones marked. */
function rolesHeldLabel(
  profile: Profile,
  memberships: TeamMembership[],
  pausedRoles: AppRole[],
) {
  const usable = rolesLabel(
    rolesOf(profile),
    profile.title,
    profile.head_physio,
    staffTitle(memberships),
  );
  if (pausedRoles.length === 0) return usable;
  const pausedLabel = `${rolesLabel(pausedRoles)} (paused)`;
  // A member with every role paused shows as a guest; say what they hold instead.
  return hasRole(profile, 'guest') && rolesOf(profile).length === 1
    ? pausedLabel
    : `${usable}, ${pausedLabel}`;
}

/** Why the member's roles are paused, in a sentence or two. */
function pausedReason(
  paused: NonNullable<ReturnType<typeof useAuth>['paused']>,
  what: string,
): string {
  if (paused.stoodDown) {
    return `Your ${what} paused by a club admin. Talk to a club admin about it.`;
  }
  const application = paused.application;
  if (application?.status === 'waiting_for_declaration') {
    return `Your ${what} paused until you accept the declaration for your Working With Children Check application. Open it from your to-do list.`;
  }
  if (application?.status === 'lapsed') {
    return `Your Working With Children Check application has lapsed because nobody confirmed it’s still being assessed, so your ${what} paused. Ask a club admin to check it, or add your card below if it has arrived.`;
  }
  const exemption = paused.exemption;
  if (exemption && !exemption.declared_at) {
    return `Your ${what} paused until you accept the exemption declaration. Open it from your to-do list.`;
  }
  if (exemption) {
    const ended =
      exemption.basis === 'parent_volunteer'
        ? `Your exemption as ${exemption.child_name ?? 'your child'}’s parent no longer applies`
        : isDatedExemption(exemption.basis)
          ? `Your ${exemption.basis === 'national_event' ? 'national event' : 'short-term visitor'} exemption ended${
              exemption.ends_on ? ` on ${formatDateString(exemption.ends_on)}` : ''
            }`
          : 'Your exemption as an under-18 volunteer ended when you turned 18';
    return `${ended}, so your ${what} paused. Apply for a Working With Children Check, then add your card below. A club admin checks it, and your role starts again once they accept it.`;
  }
  return `Your Working With Children Check has expired or isn't recorded, so your ${what} paused. Apply for one or renew it, then add your card below. A club admin checks it, and your role starts again once they accept it. If you never work with children, ask an admin to exempt you with the reason.`;
}

/**
 * Why the member should send in their own card, for the to-do list: a role
 * paused for want of a check (not a stand-down, and not waiting on a
 * declaration they can accept), or their card expiring soon.
 */
function ownCheckReason(
  profile: Profile | null,
  paused: ReturnType<typeof useAuth>['paused'],
  exemption: ReturnType<typeof useAuth>['exemption'],
  application: ReturnType<typeof useAuth>['wwccApplication'],
): 'paused' | 'expiring' | null {
  if (!canSendOwnCheck(profile, paused?.roles)) return null;
  // A guest's card is optional, so it never becomes a to-do.
  if (isGuest(profile, paused?.roles)) return null;
  if (paused) return waitsOnDeclaration(exemption, application) ? null : 'paused';
  return ownCheckExpiring(profile) ? 'expiring' : null;
}

/** A declaration the member can accept from their to-do list starts their role instead. */
function waitsOnDeclaration(
  exemption: ReturnType<typeof useAuth>['exemption'],
  application: ReturnType<typeof useAuth>['wwccApplication'],
) {
  return (
    (!!exemption && !exemption.declared_at) ||
    (!!application && !application.declared_at && application.status === 'waiting_for_declaration')
  );
}

/** Roles the member holds but can't use: an expired check or a stand-down. */
function PausedRoles() {
  const { profile, paused } = useAuth();
  if (!paused) return null;
  const roles = rolesLabel(paused.roles);
  const what = `${roles.toLowerCase()} ${paused.roles.length > 1 ? 'roles are' : 'role is'}`;
  const canSend =
    canSendOwnCheck(profile, paused.roles) &&
    !waitsOnDeclaration(paused.exemption, paused.application);
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">{roles} paused</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {pausedReason(paused, what)}
      </ThemedText>
      {canSend ? <SendOwnCheck /> : null}
    </Card>
  );
}

/**
 * Where the member's own card is up to, with the button to send it: waiting
 * for an admin, sent back with a note, or not sent yet.
 */
function SendOwnCheck() {
  const { wwccSubmission: submission } = useAuth();
  return (
    <>
      {submission ? (
        <ThemedText type="small">{submissionStatusText(submission)}</ThemedText>
      ) : null}
      <Button
        title={
          !submission
            ? 'Add your card'
            : submission.status === 'returned'
              ? 'Send it again'
              : 'Change what you sent'
        }
        variant={submission?.status === 'waiting' ? 'secondary' : 'primary'}
        onPress={() => router.push('/wwcc')}
      />
    </>
  );
}

/**
 * A committee member who kept their role without a check: from the club's
 * committee checks date it pauses unless they have one or are exempt.
 */
function CommitteeCheckDue() {
  const { profile, committeeChecksFrom } = useAuth();
  if (!profile || !committeeCheckDue(profile, committeeChecksFrom)) return null;
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">
        Your committee role needs a Working With Children Check from{' '}
        {formatDate(committeeChecksFrom)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your committee role pauses on that day unless a check is recorded. Apply for one, then add
        your card below for a club admin to check. If you never work with children, ask an admin to
        exempt you with the reason.
      </ThemedText>
      <SendOwnCheck />
    </Card>
  );
}

/**
 * Home for someone whose only role is Studio: what the role does, and that
 * HQ has nothing else for them.
 */
function StudioOnly({ paused }: { paused: boolean }) {
  return (
    <Card>
      <ThemedText type="smallBold">
        {paused ? 'Your Studio role is paused' : 'You can show this club’s live game stats'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {paused
          ? 'A club admin has stood you down, so FirstPass Studio can’t read this club’s stats until they lift it.'
          : 'Sign in to this club from FirstPass Studio with this Google account. Studio can then read the stats the club records for its PlayHQ games, live and finished, to show on streams. Athletes under 18 are only named with their own stats when a parent or guardian has agreed; otherwise Studio shows team totals. Studio can’t change anything, and you won’t see the club’s members, squads, calendar or messages.'}
      </ThemedText>
    </Card>
  );
}

/**
 * A statistician who kept their role without a check: from the club's
 * statistician checks date it pauses unless they have one or are exempt.
 */
function StatisticianCheckDue() {
  const { profile, statisticianChecksFrom } = useAuth();
  if (!profile || !statisticianCheckDue(profile, statisticianChecksFrom)) return null;
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">
        Your statistician role needs a Working With Children Check from{' '}
        {formatDate(statisticianChecksFrom)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your statistician role pauses on that day, in HQ and in Vantage, unless a check is
        recorded. Apply for one, then add your card below for a club admin to check. If you only
        record opens games and never work with children, ask an admin to exempt you with the
        reason.
      </ThemedText>
      <SendOwnCheck />
    </Card>
  );
}

/**
 * An admin whose check expired or is missing for over 30 days: they keep
 * every admin power, but don't see under 18s' injuries until it's sorted.
 */
function AdminChildInjuriesClosed() {
  const { isAdmin } = useAuth();
  const [closed, setClosed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setClosed(false);
        return;
      }
      supabase.rpc('my_admin_sees_children_injuries').then(({ data }) => setClosed(data === false));
    }, [isAdmin]),
  );
  if (!closed) return null;
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">You can’t see under 18s’ injuries right now</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your Working With Children Check expired or isn’t recorded, and it’s been over 30 days. You
        keep everything else an admin can do. Add your current card below for another admin to
        check, or ask them to record an application you’ve lodged, and you’ll see children’s
        injuries again.
      </ThemedText>
      <SendOwnCheck />
    </Card>
  );
}

function JoinStatus() {
  const { profile, waitingForGuardian } = useAuth();

  if (profile?.status === 'rejected') {
    return (
      <Card>
        <ThemedText type="smallBold">Request not approved</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {profile.rejection_reason
            ? rejectionReasonMessages[profile.rejection_reason]
            : 'Your request to join was not approved. Check your details and try again, or show a club admin the code below.'}
        </ThemedText>
        <VerificationCode />
        <View style={styles.cardAction}>
          <Button title="Request again" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  if (!profile?.join_requested_at) {
    return (
      <Card>
        <ThemedText type="smallBold">Request to join the club</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tell us who you are so an admin can approve you and, if you play, coach or manage, add
          you to your squad or team.
        </ThemedText>
        <View style={styles.cardAction}>
          <Button title="Request to join" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  // A child under 18 asking to join, with a link code for their parent or guardian.
  const child = !!waitingForGuardian;
  const guardian = profile.requested_role === 'guardian';

  return (
    <>
      <Card>
        <ThemedText type="smallBold">Waiting for approval</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {guardian
            ? 'A club admin checks who you are and that you’re your child’s parent or guardian, then approves you, which links you to them. Pull down to check again.'
            : profile.requested_role === 'committee' || profile.requested_role === 'guest'
              ? 'A club admin will approve your request. Pull down to check again.'
              : 'A club admin will approve your request and add you to your squad or team. Pull down to check again.'}
        </ThemedText>
        {profile.verified_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            ✓ A club admin has confirmed who you are.
          </ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              If an admin can’t match you to your PlayHQ registration, they may ask for this code in
              person or over a channel they already trust. Never share it with anyone else.
            </ThemedText>
            <VerificationCode />
          </>
        )}
        <View style={styles.cardAction}>
          <Button title="Edit request" variant="secondary" onPress={() => router.push('/join')} />
        </View>
      </Card>
      {guardian ? <ChildCodeCard /> : null}
      {guardian ? <NoAppChildCard /> : null}
      {child ? <WaitingForGuardian /> : null}
      {child ? (
        <ThemedText type="small" themeColor="textSecondary">
          If anything worries you, these people can help:
        </ThemedText>
      ) : null}
      {child ? <SafeguardingContactsCard /> : null}
    </>
  );
}

/** The member's 6-digit code, which an admin enters to confirm who they are. */
function VerificationCode() {
  const theme = useTheme();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('my_verification_code').then(({ data }) => setCode(data as string | null));
  }, []);

  if (!code) return null;
  return (
    <View style={styles.code} accessibilityLabel={`Your code is ${code.split('').join(' ')}`}>
      <ThemedText type="small" themeColor="textSecondary">
        Your code
      </ThemedText>
      <ThemedText type="title" style={[styles.codeDigits, { color: theme.accent }]} selectable>
        {code.slice(0, 3)} {code.slice(3)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pausedCard: { gap: Spacing.two },
  code: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  codeDigits: {
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardAction: {
    marginTop: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: Spacing.three,
  },
  footerLink: {
    paddingVertical: Spacing.two,
  },
});

/**
 * Such as "Check-ins: yes · Injuries: not given". Check-ins are left out while
 * Daily check-ins is off for the child and no consent was given for them.
 */
function consentSummary(a: {
  data: boolean;
  health: boolean;
  canConsent: boolean;
  checkInsOn: boolean;
}) {
  if (!a.canConsent && !a.data && !a.health) return 'Waiting for an admin to verify you';
  const word = (on: boolean) => (on ? 'yes' : 'not given');
  const injuries = `Injuries: ${word(a.health)}`;
  return a.checkInsOn || a.data ? `Check-ins: ${word(a.data)} · ${injuries}` : injuries;
}
