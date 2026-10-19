import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventGrid } from '@/components/event-card';
import { SafeguardingContactsCard } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { TodoList } from '@/components/todo-list';
import { VolunteerOnboarding } from '@/components/volunteer-onboarding';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAbsencesToReview, useLeadsAGroup } from '@/lib/absences';
import { useAffiliationTodos } from '@/lib/affiliation';
import { useConductTodos } from '@/lib/conduct';
import { committeeCheckDue, isDatedExemption } from '@/lib/safety';
import { formatDate, isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { useAwardSlots } from '@/lib/awards';
import { useClub } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';
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
  useCanSeeInjuries,
  useOpenInjuries,
} from '@/lib/injuries';
import { useKpiPeople, useKpiReviewTodos, type KpiPerson } from '@/lib/kpis';
import { useGetsMessages, useUnreadCount } from '@/lib/messages';
import {
  pendingRequestsLabel,
  usePendingRequests,
  useSafetyTodos,
} from '@/lib/use-pending-requests';
import { rejectionReasonMessages, rolesLabel, staffTitle, teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { useNewConcerns } from '@/lib/concerns';
import { usePersonalTasks } from '@/lib/personal-tasks';
import { useSessionPlanSummary } from '@/lib/session-plans';
import { useCanSendSurveys, useMySurveys, surveysToAnswer } from '@/lib/surveys';
import { buildTodos } from '@/lib/todos';
import type { ChildConsent } from '@/lib/consents';
import {
  isOutstanding,
  useClubHasTraining,
  useMyTraining,
  useTrainingToReview,
  type MyTraining,
} from '@/lib/training';
import type { AppRole, Profile, TeamMembership } from '@/lib/types';
import { useEvents } from '@/lib/use-events';
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
    memberships,
    isAdmin,
    isSafeguardingOfficer,
    refresh,
    signOut,
  } = useAuth();
  // Admins and the two safeguarding officers handle concerns members raise.
  const handlesConcerns = isAdmin || isSafeguardingOfficer;
  const newConcerns = useNewConcerns(handlesConcerns);
  const { switchClub } = useClubChoice();
  const club = useClub();
  const { features } = club;
  const [refreshing, setRefreshing] = useState(false);
  const [athletes, setAthletes] = useState<
    { id: string; name: string; data: boolean; health: boolean; canConsent: boolean }[]
  >([]);
  const { events, reload: reloadEvents } = useEvents();
  const { unreadCount, reloadUnread } = useUnreadCount();
  const { pendingCount, reloadPending } = usePendingRequests();
  const { safetyTodos, reloadSafetyTodos } = useSafetyTodos();
  const { affiliationTodos, reloadAffiliationTodos } = useAffiliationTodos();
  const { conductTodos, reloadConductTodos } = useConductTodos();
  const { personalTasks, reloadPersonalTasks, setTaskDone } = usePersonalTasks();
  const plans = useSessionPlanSummary();
  const { kpiPeople, reloadKpiPeople } = useKpiPeople();
  const { kpiReviewTodos, reloadKpiReviewTodos } = useKpiReviewTodos();
  const { mySurveys, reloadMySurveys } = useMySurveys();
  const canSendSurveys = useCanSendSurveys();
  const surveysWaiting = surveysToAnswer(mySurveys).length;
  const { absencesToReview, reloadAbsencesToReview } = useAbsencesToReview(useLeadsAGroup());
  const canSeeInjuries = useCanSeeInjuries();
  const canTakeAttendance = useCanTakeAttendance();
  const canViewAttendance = useCanViewAttendance();
  const { openInjuries, reloadInjuries } = useOpenInjuries();
  const injuriesWaiting = openInjuries.filter((i) => i.waiting_for_me).length;
  const { myCheckIn, reloadMyCheckIn } = useMyCheckIn();
  const canSeeCheckIns = useCanSeeCheckIns();
  const { checkInSummary, reloadCheckInSummary } = useCheckInSummary();
  const isCheckInCoach = useIsCheckInCoach();
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
    newConcerns,
    absencesToReview: absencesToReview.length,
    consentsNeeded: athletes.filter((a) => a.canConsent && (!a.data || !a.health)),
    conduct: conductTodos.map((t) => ({
      id: t.profile_id,
      name: t.full_name ?? 'your child',
      forChild: t.for_child,
    })),
    affiliation: affiliationTodos,
    kpiReviews: kpiReviewTodos,
    surveys: features.surveys ? mySurveys : [],
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
      reloadAffiliationTodos(),
      reloadConductTodos(),
      reloadPersonalTasks(),
      plans.reloadSummary(),
      reloadKpiPeople(),
      reloadKpiReviewTodos(),
      reloadMySurveys(),
      reloadAbsencesToReview(),
      loadAthletes(),
      reloadEvents(),
      reloadUnread(),
      reloadInjuries(),
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

  return (
    <Screen withTopInset refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Hi {name}</ThemedText>
          {approved && profile ? (
            <ThemedText themeColor="textSecondary">
              {rolesHeldLabel(profile, memberships, paused?.roles ?? [])}
            </ThemedText>
          ) : null}
        </View>
        <Image
          source={club.logo}
          style={styles.headerLogo}
          contentFit="contain"
          accessibilityLabel={club.name}
        />
      </View>

      {volunteer ? (
        <VolunteerOnboarding verificationCode={<VerificationCode />} />
      ) : !approved ? (
        <JoinStatus />
      ) : null}

      {volunteer ? null : (
        <>

        {approved ? <PausedRoles /> : null}

        {approved ? <CommitteeCheckDue /> : null}

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

        {features.injuries && canSeeInjuries ? (
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
              {injuriesSummary(openInjuries)}
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

        {handlesConcerns ? (
          <PressableCard onPress={() => router.push('/concerns')}>
            <ThemedText type="smallBold">Concerns</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {newConcerns > 0
                ? `${newConcerns} new ${newConcerns === 1 ? 'concern' : 'concerns'} to look at`
                : 'The concerns register'}
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

        {isGuardian && features.goals && athletes.length > 0 ? (
          // Guardians aren't in a squad, so their athletes' game goals open from here.
          <View style={styles.section}>
            <ThemedText type="smallBold">Guardian of</ThemedText>
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
        ) : isGuardian ? (
          <Card>
            <ThemedText type="smallBold">Guardian of</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {athletes.length > 0
                ? athletes.map((a) => a.name).join(', ')
                : 'A club admin will link you to your athlete once they have checked your PlayHQ registration.'}
            </ThemedText>
          </Card>
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
                  themeColor={a.canConsent && (!a.data || !a.health) ? 'tint' : 'textSecondary'}>
                  {consentSummary(a)}
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
                  Who at the club opened their injuries, check-ins, game goals, season KPIs, named survey answers or member record
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
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/my-details')}
          style={styles.footerLink}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Your details
          </ThemedText>
        </Pressable>
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
    return `${ended}, so your ${what} paused. Apply for a Working With Children Check, then send a club admin the card number and expiry date.`;
  }
  return `Your Working With Children Check has expired or isn't recorded, so your ${what} paused. Apply for one or renew it, then send a club admin the card number and expiry date. If you never work with children, ask an admin to exempt you with the reason.`;
}

/** Roles the member holds but can't use: an expired check or a stand-down. */
function PausedRoles() {
  const { paused } = useAuth();
  if (!paused) return null;
  const roles = rolesLabel(paused.roles);
  const what = `${roles.toLowerCase()} ${paused.roles.length > 1 ? 'roles are' : 'role is'}`;
  return (
    <Card>
      <ThemedText type="smallBold">{roles} paused</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {pausedReason(paused, what)}
      </ThemedText>
    </Card>
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
    <Card>
      <ThemedText type="smallBold">
        Your committee role needs a Working With Children Check from{' '}
        {formatDate(committeeChecksFrom)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your committee role pauses on that day unless a check is recorded. Apply for one, then send
        a club admin the card number and expiry date. If you never work with children, ask an admin
        to exempt you with the reason.
      </ThemedText>
    </Card>
  );
}

function JoinStatus() {
  const { profile } = useAuth();

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

  // What they said at Join; the admin checks it before approving them.
  const child =
    profile.requested_role === 'athlete' &&
    !!profile.declared_date_of_birth &&
    isMinor(profile.declared_date_of_birth, false);

  return (
    <>
      <Card>
        <ThemedText type="smallBold">Waiting for approval</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {profile.requested_role === 'committee' || profile.requested_role === 'guest'
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
      {child ? (
        <Card>
          <ThemedText type="smallBold">Ask your parent or guardian to join</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            You’re under 18, so a parent or guardian needs to join the club in the app too
            {profile.guardian_email ? `, signing in with ${profile.guardian_email}` : ''}. A club
            admin checks who they are and links them to you, and then you can be approved.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            If anything worries you, these people can help:
          </ThemedText>
        </Card>
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
  code: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  codeDigits: {
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  header: {
    flex: 1,
    gap: Spacing.one,
  },
  headerLogo: {
    width: 112,
    height: 112,
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

/** Such as "Check-ins: yes · Injuries: not yet". */
function consentSummary(a: { data: boolean; health: boolean; canConsent: boolean }) {
  if (!a.canConsent && !a.data && !a.health) return 'Waiting for an admin to verify you';
  const word = (on: boolean) => (on ? 'yes' : 'not given');
  return `Check-ins: ${word(a.data)} · Injuries: ${word(a.health)}`;
}
