/**
 * The cards that used to make up the one Home screen, one component for each,
 * drawn the same wherever src/lib/home-layout.ts puts them: a hub, Me, or the
 * top of Today. Each opens the screen it always opened and says what it
 * always said.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConcernLights } from '@/components/concern-lights';
import { VerificationCode } from '@/components/home/banners';
import { FeatureCard } from '@/components/home/feature-card';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { roundsLabel, selectionHomeHref, selectionInfoLabel } from '@/lib/assessments';
import { useAuth } from '@/lib/auth';
import { checkInOverviewLabel, checkInSummaryLabel } from '@/lib/check-ins';
import { useClub } from '@/lib/club';
import { clubToday } from '@/lib/club-time';
import { guardianOfText } from '@/lib/guardian-links';
import { useHome } from '@/lib/home';
import {
  awardsLabel,
  consentSummary,
  kpisLabel,
  sortMemberships,
  trainingLabel,
} from '@/lib/home-labels';
import type { HomeCard } from '@/lib/home-layout';
import { injuriesSummary } from '@/lib/injuries';
import { teamPositionLabel } from '@/lib/labels';
import { pendingRequestsLabel } from '@/lib/use-pending-requests';

/** One of the old Home cards, by name. */
export function HomeCardView({ card }: { card: HomeCard }) {
  const Component = CARDS[card];
  return <Component />;
}

function DailyCheckIn() {
  const { myCheckIn } = useHome();
  return (
    <FeatureCard
      icon="smile"
      title="Daily check-in"
      detail={myCheckIn ? '✓ Done for today' : 'Not done yet today'}
      onPress={() => router.push('/check-in')}
    />
  );
}

function CheckIns() {
  const { isCheckInCoach, checkInSummary, checkInOverview } = useHome();
  return (
    <FeatureCard
      icon="activity"
      title="Check-ins"
      detail={
        isCheckInCoach && checkInSummary.length > 0
          ? checkInSummaryLabel(checkInSummary)
          : checkInOverviewLabel(checkInOverview)
      }
      onPress={() => router.push('/check-ins')}
    />
  );
}

function Attendance() {
  const { canTakeAttendance } = useHome();
  return (
    <FeatureCard
      icon="clipboard"
      title="Attendance"
      detail={
        canTakeAttendance ? 'Take attendance and see past sessions' : 'See athletes’ attendance'
      }
      onPress={() => router.push('/attendance')}
    />
  );
}

function MyAttendance() {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <FeatureCard
      icon="check-square"
      title="My attendance"
      detail="Your sessions, and tell your coaches if you’ll be away"
      onPress={() =>
        router.push({ pathname: '/attendance/family/[id]', params: { id: session.user.id } })
      }
    />
  );
}

function Injuries() {
  const { canSeeInjuries, openInjuries, injuriesWaiting } = useHome();
  return (
    <FeatureCard
      icon="plus-circle"
      title="Injuries"
      detail={
        canSeeInjuries ? injuriesSummary(openInjuries) : 'Log an injury at training or a game'
      }
      badge={injuriesWaiting}
      onPress={() => router.push('/injuries')}
    />
  );
}

function SessionPlans() {
  const { plans } = useHome();
  return (
    <FeatureCard
      icon="file-text"
      title="Session plans"
      detail={
        plans.newShared > 0
          ? `${plans.newShared} new ${plans.newShared === 1 ? 'plan' : 'plans'} shared with you`
          : plans.canAdd
            ? 'Add a plan before or after a session'
            : 'Plans your coaches have shared'
      }
      badge={plans.newShared}
      onPress={() => router.push('/session-plans')}
    />
  );
}

function Concerns() {
  const { newConcerns, concernCounts } = useHome();
  return (
    <FeatureCard
      icon="shield"
      title="Concerns"
      detail={
        newConcerns > 0
          ? `${newConcerns} new ${newConcerns === 1 ? 'concern' : 'concerns'} to look at`
          : 'The concerns register'
      }
      onPress={() => router.push('/concerns')}>
      <ConcernLights counts={concernCounts} />
    </FeatureCard>
  );
}

function Reports() {
  return (
    <FeatureCard
      icon="bar-chart-2"
      title="Reports"
      detail="The club’s checks, medical details checks, training, attendance and award results"
      onPress={() => router.push('/admin/reports')}
    />
  );
}

function Administration() {
  const { pendingCount } = useHome();
  return (
    <FeatureCard
      icon="settings"
      title="Administration"
      detail={pendingRequestsLabel(pendingCount)}
      onPress={() => router.push('/administration')}
    />
  );
}

function Surveys() {
  const { surveysWaiting, canSendSurveys } = useHome();
  return (
    <FeatureCard
      icon="list"
      title="Surveys"
      detail={
        surveysWaiting > 0
          ? `${surveysWaiting} to answer`
          : canSendSurveys
            ? 'Send a survey and see results'
            : 'Nothing to answer'
      }
      badge={surveysWaiting}
      onPress={() => router.push('/surveys')}
    />
  );
}

function Awards() {
  const { awardSlots } = useHome();
  return (
    <FeatureCard
      icon="award"
      title="Awards"
      detail={awardsLabel(awardSlots.length, awardSlots.filter((s) => !s.voted).length)}
      onPress={() => router.push('/awards')}
    />
  );
}

function IntegrityTraining() {
  const { myTraining, certificatesToCheck } = useHome();
  return (
    <FeatureCard
      icon="book-open"
      title="Integrity training"
      detail={trainingLabel(myTraining, certificatesToCheck)}
      badge={certificatesToCheck}
      onPress={() => router.push('/training')}
    />
  );
}

function SeasonKpis() {
  const { kpiPeople } = useHome();
  return (
    <FeatureCard
      icon="target"
      title="Season KPIs"
      detail={kpisLabel(kpiPeople)}
      onPress={() => router.push('/kpis')}
    />
  );
}

function SelectionAssessments() {
  const { selectionRounds } = useHome();
  return (
    <FeatureCard
      icon="eye"
      title="Selection assessments"
      detail={roundsLabel(selectionRounds)}
      onPress={() => router.push(selectionHomeHref(selectionRounds))}
    />
  );
}

function Selection() {
  const { selectionInfo, selectionFeedback } = useHome();
  return (
    <FeatureCard
      icon="flag"
      title="Selection"
      detail={selectionInfoLabel(selectionInfo, clubToday(), selectionFeedback)}
      onPress={() => router.push('/selection')}
    />
  );
}

function Registers() {
  return (
    <FeatureCard
      icon="folder"
      title="Registers"
      detail="The club’s policies and conflicts of interest"
      onPress={() => router.push('/registers')}
    />
  );
}

/** An admin can still verify an approved guardian in person with this code. */
function Verification() {
  return (
    <Card>
      <ThemedText type="smallBold">Confirm who you are</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        A club admin verifies you before linking you to your child, against PlayHQ, by sighting
        your ID, or with this code in person or over a channel they already trust. Never share it
        with anyone else.
      </ThemedText>
      <VerificationCode />
    </Card>
  );
}

/**
 * A parent's children, and adding another (a link code, or a child who won't
 * use the app), behind one card.
 */
function GuardianOf() {
  const { children } = useHome();
  return (
    <FeatureCard
      icon="users"
      title="Guardian of"
      detail={guardianOfText(children.map((a) => a.name))}
      onPress={() => router.push('/children')}>
      <ThemedText type="small" themeColor="tint">
        {children.length > 0 ? 'Add another child' : 'Add your child'}
      </ThemedText>
    </FeatureCard>
  );
}

/** Everything a parent or guardian opens for each child, a section for each kind. */
function Children() {
  const { profile } = useAuth();
  const { features } = useClub();
  const { children, activityNew } = useHome();
  const verified = !!profile?.verified_at;
  return (
    <>
      {features.goals ? (
        // Guardians aren't in a squad, so their athletes' game goals open from here.
        <View style={styles.section}>
          <ThemedText type="smallBold">Game goals</ThemedText>
          {children.map((a) => (
            <FeatureCard
              key={a.id}
              icon="target"
              title={a.name}
              detail="Game goals and reflections"
              onPress={() =>
                router.push({
                  pathname: '/goals/athlete/[id]',
                  params: { id: a.id, name: a.name, view: 'guardian' },
                })
              }
            />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold">Consent</ThemedText>
        {children.map((a) => (
          <FeatureCard
            key={a.id}
            icon="check-square"
            title={a.name}
            detail={consentSummary(a)}
            detailColor={a.needsConsent ? 'tint' : 'textSecondary'}
            onPress={() => router.push({ pathname: '/consent/[id]', params: { id: a.id } })}
          />
        ))}
      </View>

      {verified ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Medical and emergency</ThemedText>
          {children.map((a) => (
            <FeatureCard
              key={a.id}
              icon="heart"
              title={a.name}
              detail="Emergency contacts, allergies, conditions, medications and an action plan"
              onPress={() => router.push({ pathname: '/medical/[id]', params: { id: a.id } })}
            />
          ))}
        </View>
      ) : null}

      {features.attendance ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Attendance</ThemedText>
          {children.map((a) => (
            <FeatureCard
              key={a.id}
              icon="clipboard"
              title={a.name}
              detail="Their sessions, and tell their coaches if they’ll be away"
              onPress={() =>
                router.push({
                  pathname: '/attendance/family/[id]',
                  params: { id: a.id, name: a.name },
                })
              }
            />
          ))}
        </View>
      ) : null}

      {features.checkIns ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Check-ins</ThemedText>
          {children.map((a) => (
            <FeatureCard
              key={a.id}
              icon="activity"
              title={a.name}
              detail="Their daily check-ins and notes from the last four weeks"
              onPress={() =>
                router.push({
                  pathname: '/check-ins/athlete/[id]',
                  params: { id: a.id, name: a.name },
                })
              }
            />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold">What’s changed</ThemedText>
        {children.map((a) => (
          <FeatureCard
            key={a.id}
            icon="clock"
            title={a.name}
            detail="New coaches, managers and physios, guardians, consents and shared documents"
            badge={activityNew[a.id] ?? 0}
            onPress={() =>
              router.push({ pathname: '/activity/[id]', params: { id: a.id, name: a.name } })
            }
          />
        ))}
      </View>

      {verified ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Who has viewed their records</ThemedText>
          {children.map((a) => (
            <FeatureCard
              key={a.id}
              icon="eye"
              title={a.name}
              detail="Who at the club opened their injuries, check-ins, game goals, season KPIs, named survey answers, medical details or member record"
              onPress={() =>
                router.push({ pathname: '/records/[id]', params: { id: a.id, name: a.name } })
              }
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/** The squads and teams the member is in, each opening its page. */
function Groups() {
  const { memberships } = useAuth();
  const club = useClub();
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{club.squads ? 'My squads and teams' : 'My teams'}</ThemedText>
      {memberships.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You are not in a {club.squads ? 'squad' : 'team'} yet.
        </ThemedText>
      ) : (
        sortMemberships(memberships).map((m) => (
          <FeatureCard
            key={m.team.id}
            icon="users"
            title={m.team.name}
            detail={`${m.team.kind === 'squad' ? 'Squad' : 'Team'} · ${teamPositionLabel(
              m.team_role,
              m.coach_title,
              m.selection,
            )}`}
            onPress={() => router.push({ pathname: '/team/[id]', params: { id: m.team.id } })}
          />
        ))
      )}
    </View>
  );
}

const CARDS: Record<HomeCard, () => ReactNode> = {
  verification: Verification,
  concerns: Concerns,
  dailyCheckIn: DailyCheckIn,
  checkIns: CheckIns,
  attendance: Attendance,
  myAttendance: MyAttendance,
  injuries: Injuries,
  sessionPlans: SessionPlans,
  reports: Reports,
  administration: Administration,
  surveys: Surveys,
  awards: Awards,
  integrity: IntegrityTraining,
  kpis: SeasonKpis,
  selectionAssessments: SelectionAssessments,
  selection: Selection,
  registers: Registers,
  guardianOf: GuardianOf,
  children: Children,
  groups: Groups,
};

/** The cards that are sections of their own, not tiles for a grid. */
export const SECTION_CARDS: HomeCard[] = ['children', 'groups'];

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
