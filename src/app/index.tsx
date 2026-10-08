import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventGrid } from '@/components/event-card';
import { Screen } from '@/components/screen';
import { TodoList } from '@/components/todo-list';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { useAwardSlots } from '@/lib/awards';
import { useClub } from '@/lib/club';
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
import { injuriesSummary, useCanSeeInjuries, useOpenInjuries } from '@/lib/injuries';
import { useUnreadCount } from '@/lib/messages';
import {
  pendingRequestsLabel,
  usePendingRequests,
  useSafetyTodos,
} from '@/lib/use-pending-requests';
import { rejectionReasonMessages, roleLabels, teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { buildTodos } from '@/lib/todos';
import type { TeamMembership } from '@/lib/types';
import { useEvents } from '@/lib/use-events';

/** Three rows of two tiles. */
const UPCOMING_COUNT = 6;

export default function HomeScreen() {
  const theme = useTheme();
  const { session, profile, memberships, isAdmin, refresh, signOut } = useAuth();
  const club = useClub();
  const { features } = club;
  const [refreshing, setRefreshing] = useState(false);
  const [athletes, setAthletes] = useState<string[]>([]);
  const { events, reload: reloadEvents } = useEvents();
  const { unreadCount, reloadUnread } = useUnreadCount();
  const { pendingCount, reloadPending } = usePendingRequests();
  const { safetyTodos, reloadSafetyTodos } = useSafetyTodos();
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
  // Turned-off features add nothing to the to-do list.
  const todos = buildTodos({
    userId: session?.user.id,
    injuries: features.injuries ? openInjuries : [],
    pendingCount,
    needsCheckIn: features.checkIns && myCheckIn === null,
    flaggedAthletes: features.checkIns ? checkInTotals(checkInSummary).flagged : 0,
    awardSlots: features.awards ? awardSlots : [],
    safety: safetyTodos,
  });

  const isGuardian = profile?.status === 'approved' && profile.role === 'guardian';

  // The athletes a parent or guardian looks after.
  const loadAthletes = useCallback(async () => {
    if (!isGuardian) return;
    const { data } = await supabase.rpc('my_athletes');
    setAthletes(
      ((data as { full_name: string | null }[] | null) ?? []).map(
        (a) => a.full_name ?? 'Unnamed athlete',
      ),
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
      loadAthletes(),
      reloadEvents(),
      reloadUnread(),
      reloadInjuries(),
      reloadMyCheckIn(),
      reloadCheckInSummary(),
      reloadCheckInOverview(),
      reloadAwardSlots(),
    ]);
    setRefreshing(false);
  }

  const name = profile?.full_name || session?.user.email || 'there';
  const approved = profile?.status === 'approved';

  return (
    <Screen withTopInset refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Hi {name}</ThemedText>
          {approved && profile ? (
            <ThemedText themeColor="textSecondary">{roleLabels[profile.role]}</ThemedText>
          ) : null}
        </View>
        <Image
          source={club.logo}
          style={styles.headerLogo}
          contentFit="contain"
          accessibilityLabel={club.name}
        />
      </View>

      {!approved ? <JoinStatus /> : null}

      {approved ? <TodoList todos={todos} /> : null}

      {approved && features.messages ? (
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

      {features.awards && approved && awardSlots.length > 0 ? (
        <PressableCard onPress={() => router.push('/awards')}>
          <ThemedText type="smallBold">Awards</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {awardsLabel(awardSlots.length, awardSlots.filter((s) => !s.voted).length)}
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

      {isGuardian ? (
        <Card>
          <ThemedText type="smallBold">Guardian of</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {athletes.length > 0
              ? athletes.join(', ')
              : 'A club admin will link you to your athlete once they have checked your PlayHQ registration.'}
          </ThemedText>
        </Card>
      ) : null}

      {approved ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">My squads and teams</ThemedText>
          {memberships.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              You are not in a squad yet.
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

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.footerLink}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Sign out
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

/** Named teams first, then squads, in club order. */
function sortMemberships(memberships: TeamMembership[]) {
  return [...memberships].sort(
    (a, b) =>
      (a.team.kind === 'team' ? 0 : 1) - (b.team.kind === 'team' ? 0 : 1) ||
      a.team.sort_order - b.team.sort_order ||
      a.team.name.localeCompare(b.team.name),
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
          Tell us who you are so an admin can add you to your team.
        </ThemedText>
        <View style={styles.cardAction}>
          <Button title="Request to join" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">Waiting for approval</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        A club admin will approve your request and add you to your team. Pull down to check again.
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
    width: 64,
    height: 64,
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
    justifyContent: 'space-between',
  },
  footerLink: {
    paddingVertical: Spacing.two,
  },
});
