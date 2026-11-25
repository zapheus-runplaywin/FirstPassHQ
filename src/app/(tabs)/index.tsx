import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { Columns } from '@/components/columns';
import { WaitingForGuardian } from '@/components/guardian-link';
import {
  AdminChildInjuriesClosed,
  CommitteeCheckDue,
  JoinStatus,
  PausedRoles,
  StatisticianCheckDue,
  StudioOnly,
  VerificationCode,
} from '@/components/home/banners';
import { HomeCardView } from '@/components/home/cards';
import { TabHeader } from '@/components/home/tab-header';
import { ClubAndDate, Greeting, LaterEvents, NeedsYou, NextUp } from '@/components/home/today';
import { HomeHeader } from '@/components/home-header';
import { SafeguardingContactsCard } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { VolunteerOnboarding } from '@/components/volunteer-onboarding';
import { Spacing } from '@/constants/theme';
import { COLUMNS_MIN_WIDTH, useWideLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';
import { useHome, type SingleScreen } from '@/lib/home';
import { sessionActions } from '@/lib/session';
import { useSessionBasics } from '@/lib/use-session-actions';
import type { HomeCard } from '@/lib/home-layout';
import { upcoming } from '@/lib/today';

/**
 * Today, the first tab: where the member needs to be next and what needs
 * them, then a clear finish. People with one job to do (waiting for approval,
 * a child waiting for a parent, temporary helpers, Studio on its own) get that
 * one screen here instead, with no tab bar.
 */
export default function TodayScreen() {
  const home = useHome();
  return home.single ? <OneScreen which={home.single} /> : <Today />;
}

/** How many shortcuts sit under Next up: enough for two children and a register. */
const NEXT_UP_ACTIONS = 3;

/** The cards that come before everything else on Today. */
const LEADS: HomeCard[] = ['verification', 'concerns'];

function Today() {
  const home = useHome();
  const club = useClub();
  const now = useNow();
  // A tablet on its side: the calendar on the left, what needs you on the right.
  const sideBySide = useWideLayout(COLUMNS_MIN_WIDTH);
  const { next, later, laterTitle } = upcoming(home.events ?? [], now);
  // The two things most people do about a session, one tap from Today. Its
  // plan and check-ins are on the session's own page.
  const { approved, isGuardian, ...basics } = useSessionBasics();
  const nextActions =
    next && approved
      ? sessionActions(next, {
          ...basics,
          now,
          children: isGuardian ? home.children.map((c) => ({ id: c.id, name: c.name })) : [],
          plans: [],
          checkIns: [],
        })
          .filter((a) => a.kind === 'absence' || a.kind === 'attendance')
          .slice(0, NEXT_UP_ACTIONS)
      : [];

  const nextUp = club.features.calendar && home.events !== null ? (
    <NextUp event={next} now={now} actions={nextActions} />
  ) : null;
  const laterEvents =
    club.features.calendar && home.events !== null && next ? (
      <LaterEvents
        title={laterTitle}
        events={later}
        now={now}
        onOpenCalendar={() => router.navigate('/calendar')}
      />
    ) : null;
  const cards = home.cards('today');
  // The work of these weeks (a selection round that is running) sits with what needs you.
  const needsYou = (
    <>
      {cards
        .filter((card) => !LEADS.includes(card))
        .map((card) => (
          <HomeCardView key={card} card={card} />
        ))}
      <NeedsYou
        todos={home.todos}
        personalTasks={home.personalTasks}
        onToggleTask={home.setTaskDone}
        now={now}
      />
    </>
  );

  return (
    <Screen
      tab
      wide
      showVersion
      refreshing={home.refreshing}
      onRefresh={home.onRefresh}
      header={
        <TabHeader>
          <ClubAndDate logo={club.logo} clubName={club.name} now={now} />
        </TabHeader>
      }>
      <Greeting name={home.name} roles={home.roles} titles={home.titles} />

      <PausedRoles />
      <CommitteeCheckDue />
      <StatisticianCheckDue />
      <AdminChildInjuriesClosed />

      {/* A parent's code to confirm who they are, and safeguarding work, lead the day. */}
      {cards
        .filter((card) => LEADS.includes(card))
        .map((card) => (
          <HomeCardView key={card} card={card} />
        ))}

      {sideBySide ? (
        <Columns
          firstFlex={2}
          secondFlex={3}
          first={
            <>
              {nextUp}
              {laterEvents}
            </>
          }
          second={needsYou}
        />
      ) : (
        <>
          {nextUp}
          {needsYou}
          {laterEvents}
        </>
      )}
    </Screen>
  );
}

/**
 * The time, refreshed whenever Today is looked at again (coming back to the
 * tab, or back to the app), so "Next up" moves on once a session is over.
 */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, []),
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => listener.remove();
  }, []);
  return now;
}

/** The one screen for someone with one job to do, as it has always been. */
function OneScreen({ which }: { which: SingleScreen }) {
  const theme = useTheme();
  const home = useHome();
  const club = useClub();
  const { paused, waitingForGuardian, signOut } = useAuth();
  const { switchClub } = useClubChoice();

  return (
    <Screen withTopInset refreshing={home.refreshing} onRefresh={home.onRefresh} showVersion wide>
      <HomeHeader
        name={home.name}
        roles={home.roles}
        titles={home.titles}
        logo={club.logo}
        clubName={club.name}
      />

      {which === 'helper' ? (
        <VolunteerOnboarding verificationCode={<VerificationCode />} />
      ) : which === 'locked' ? (
        // Approved, but locked until a verified parent or guardian is linked.
        <>
          <WaitingForGuardian />
          <ThemedText type="small" themeColor="textSecondary">
            If anything worries you, these people can help:
          </ThemedText>
          <SafeguardingContactsCard />
        </>
      ) : which === 'join' ? (
        <JoinStatus />
      ) : (
        <StudioOnly paused={!!paused?.roles.includes('studio')} />
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

const styles = StyleSheet.create({
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
