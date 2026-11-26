import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';

import { CheckInSheet } from '@/components/check-in-sheet';
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
import {
  CHECK_IN_SAVED_MS,
  CheckInSaved,
  ClubAndDate,
  Greeting,
  LaterEvents,
  NeedsYou,
  NextUp,
  SafeguardingPanel,
} from '@/components/home/today';
import { HomeHeader } from '@/components/home-header';
import { SafeguardingContactsCard } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { VolunteerOnboarding } from '@/components/volunteer-onboarding';
import { Spacing } from '@/constants/theme';
import { COLUMNS_MIN_WIDTH, useWideLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { useClubChoice } from '@/lib/club-choice';
import { guideLinks } from '@/lib/guides';
import { useHome, type SingleScreen } from '@/lib/home';
import { sessionActions } from '@/lib/session';
import { useSessionBasics } from '@/lib/use-session-actions';
import type { HomeCard } from '@/lib/home-layout';
import { splitSafeguarding, upcoming } from '@/lib/today';

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
const LEADS: HomeCard[] = ['verification'];

/** Today shows this card as the safeguarding panel, with the safeguarding to-dos in it. */
const AS_PANEL: HomeCard = 'concerns';

/**
 * The daily check-in over Today: the to-do opens it as a sheet, and once it
 * has saved, Today says so for a few seconds with the way to change it.
 */
function useCheckInSheet() {
  const [open, setOpen] = useState(false);
  // When the sheet last saved, while Today is still saying so.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), CHECK_IN_SAVED_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);
  // Leaving Today ends it: the check-in is changed from its own page after that.
  useFocusEffect(useCallback(() => () => setSavedAt(null), []));
  return { open, setOpen, saved: savedAt !== null, setSavedAt };
}

function Today() {
  const home = useHome();
  const club = useClub();
  const now = useNow();
  const { profile } = useAuth();
  const checkIn = useCheckInSheet();
  const { reloadMyCheckIn } = home;
  function openCheckIn() {
    // In case it was done or changed on another phone since Today last loaded.
    reloadMyCheckIn();
    checkIn.setOpen(true);
  }
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
  const cards = home.cards('today').filter((card) => card !== AS_PANEL);
  // Safeguarding work leads the day in its own panel, for the people the
  // concerns register is open to; everything else stays under Needs you.
  const registerOpen = home.cards('today').includes(AS_PANEL);
  const { safeguarding, rest } = splitSafeguarding(home.todos);
  const showPanel = registerOpen || safeguarding.length > 0;
  // The work of these weeks (a selection round that is running) sits with what needs you.
  const needsYou = (
    <>
      {cards
        .filter((card) => !LEADS.includes(card))
        .map((card) => (
          <HomeCardView key={card} card={card} />
        ))}
      <NeedsYou
        todos={rest}
        otherWork={safeguarding.length > 0}
        personalTasks={home.personalTasks}
        onToggleTask={home.setTaskDone}
        onCheckIn={openCheckIn}
        now={now}
      />
      {checkIn.saved ? <CheckInSaved onChange={openCheckIn} /> : null}
    </>
  );

  return (
    <Screen
      tab
      wide
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
      {showPanel ? (
        <SafeguardingPanel todos={safeguarding} counts={registerOpen ? home.concernCounts : null} />
      ) : null}

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

      {checkIn.open ? (
        <CheckInSheet
          existing={home.myCheckIn ?? null}
          minor={!!profile && isMinor(profile.date_of_birth, profile.under_17)}
          onSaved={async () => {
            await reloadMyCheckIn();
            checkIn.setSavedAt(Date.now());
          }}
          onClose={() => checkIn.setOpen(false)}
        />
      ) : null}
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
  const { profile, paused, waitingForGuardian, signOut } = useAuth();
  const { switchClub, club: chosenClub } = useClubChoice();
  // A temporary helper and a child waiting for their parent are members with a
  // role and a guide for it, and no Me tab to find it in.
  const guide =
    profile && (which === 'helper' || which === 'locked')
      ? guideLinks(chosenClub?.code, [profile.role])[0]
      : null;

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
        {guide ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${guide.title}, a PDF that opens in your browser`}
            onPress={() => {
              Linking.openURL(guide.url).catch(() => {});
            }}
            style={styles.footerLink}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              User guide
            </ThemedText>
          </Pressable>
        ) : null}
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
