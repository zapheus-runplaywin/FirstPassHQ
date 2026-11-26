/**
 * The Team tab for the people who look after a squad or team: tiles that lead
 * with the number that matters (check-ins, attendance, injuries), and the
 * chosen squad or team itself: what the member can do there and its people.
 *
 * Every tile opens the screen its card always opened, and that screen has its
 * own rule for who may open it. The list of people is names and positions
 * only: no photos and no profiles.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { IconSquare, StatusLine } from '@/components/home/feature-card';
import { SectionTitle } from '@/components/home/tab-header';
import { Icon, type IconName } from '@/components/icon';
import { GroupPage } from '@/components/team/group-page';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup } from '@/components/ui';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { checkInTotals } from '@/lib/check-ins';
import { useClub } from '@/lib/club';
import { useHome } from '@/lib/home';
import { sortMemberships } from '@/lib/home-labels';
import type { HomeCard } from '@/lib/home-layout';
import {
  absencesLabel,
  groupChipLabel,
  myPlaceLabel,
  rosterStatuses,
  seesRosterStatus,
  type RosterStatus,
} from '@/lib/team-hub';
import { useAttendanceRate } from '@/lib/use-attendance-rate';

/** Above this text size the tiles stack, one a row, so their words have room. */
const MAX_FONT_SCALE_ACROSS = 1.15;

/** On a window narrower than this (the smallest phones) they stack too. */
const MIN_WIDTH_ACROSS = 350;

/** What a tile says: its number when there is one, what the number counts, and what is waiting. */
type TileFacts = {
  /** The number that matters, such as "10/12" or "88%". */
  figure?: string;
  /** The number as it is read out, such as "10 of 12". */
  spoken?: string;
  /** What the number counts, or what the tile opens when there is no number. */
  caption: string;
  /** Something waiting on the member. */
  attention?: string;
};

/** The readiness tiles, in the member's order (readinessTiles in src/lib/team-hub.ts). */
export function ReadinessTiles({ cards }: { cards: HomeCard[] }) {
  const { fontScale, width } = useWindowDimensions();
  const stacked = fontScale > MAX_FONT_SCALE_ACROSS || width < MIN_WIDTH_ACROSS;
  if (cards.length === 0) return null;
  return (
    <View testID="readiness-tiles" style={stacked ? styles.tilesStacked : styles.tilesAcross}>
      {cards.map((card) =>
        card === 'checkIns' ? (
          <CheckInsTile key={card} stacked={stacked} />
        ) : card === 'attendance' ? (
          <AttendanceTile key={card} stacked={stacked} />
        ) : card === 'injuries' ? (
          <InjuriesTile key={card} stacked={stacked} />
        ) : null,
      )}
    </View>
  );
}

function CheckInsTile({ stacked }: { stacked: boolean }) {
  const { isCheckInCoach, checkInSummary, checkInOverview } = useHome();
  let facts: TileFacts;
  if (isCheckInCoach && checkInSummary.length > 0) {
    // A coach: their own athletes, and how many are flagged.
    const { athletes, checkedIn, flagged } = checkInTotals(checkInSummary);
    facts = {
      figure: `${checkedIn}/${athletes}`,
      spoken: `${checkedIn} of ${athletes}`,
      caption: 'checked in today',
      attention: flagged > 0 ? `${flagged} flagged` : undefined,
    };
  } else if (checkInOverview && checkInOverview.length > 0) {
    // A physio: squad and team totals, never individuals.
    const athletes = checkInOverview.reduce((n, g) => n + g.athlete_count, 0);
    const checkedIn = checkInOverview.reduce((n, g) => n + g.checked_in_count, 0);
    facts = {
      figure: `${checkedIn}/${athletes}`,
      spoken: `${checkedIn} of ${athletes}`,
      caption: 'athletes checked in today',
    };
  } else {
    facts = { caption: 'See how squads and teams are feeling' };
  }
  return (
    <StatTile
      icon="activity"
      title="Check-ins"
      facts={facts}
      stacked={stacked}
      onPress={() => router.push('/check-ins')}
    />
  );
}

function AttendanceTile({ stacked }: { stacked: boolean }) {
  const { canTakeAttendance, canViewAttendance, absencesToReview } = useHome();
  const rate = useAttendanceRate(canViewAttendance);
  return (
    <StatTile
      icon="clipboard"
      title="Attendance"
      facts={{
        ...(rate
          ? { figure: rate, caption: 'at sessions in 4 weeks' }
          : {
              caption: canTakeAttendance
                ? 'Take attendance and see past sessions'
                : 'See athletes’ attendance',
            }),
        attention: absencesToReview > 0 ? absencesLabel(absencesToReview) : undefined,
      }}
      stacked={stacked}
      onPress={() => router.push('/attendance')}
    />
  );
}

function InjuriesTile({ stacked }: { stacked: boolean }) {
  const { canSeeInjuries, openInjuries, injuriesWaiting } = useHome();
  const count = openInjuries.length;
  const facts: TileFacts = !canSeeInjuries
    ? // A manager logs injuries and doesn't see them.
      { caption: 'Log an injury at training or a game' }
    : count === 0
      ? { caption: 'No current injuries' }
      : {
          figure: String(count),
          caption: count === 1 ? 'current injury' : 'current injuries',
          attention: injuriesWaiting > 0 ? `${injuriesWaiting} waiting for you` : undefined,
        };
  return (
    <StatTile
      icon="plus-circle"
      title="Injuries"
      facts={facts}
      stacked={stacked}
      onPress={() => router.push('/injuries')}
    />
  );
}

/** One tile: its name, its number (or its icon when there is none), and what the number counts. */
function StatTile({
  icon,
  title,
  facts,
  stacked,
  onPress,
}: {
  icon: IconName;
  title: string;
  facts: TileFacts;
  stacked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { figure, spoken, caption, attention } = facts;
  const label = [title, figure ? `${spoken ?? figure} ${caption}` : caption, attention]
    .filter(Boolean)
    .join('. ');
  const number = figure ? (
    <ThemedText style={styles.figure} numberOfLines={1} adjustsFontSizeToFit>
      {figure}
    </ThemedText>
  ) : (
    <IconSquare name={icon} />
  );
  const words = (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        {caption}
      </ThemedText>
      {attention ? <StatusLine text={attention} tone="attention" /> : null}
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        stacked ? styles.tileStacked : styles.tileAcross,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      {stacked ? (
        <>
          <View style={styles.stackedNumber}>{number}</View>
          <View style={styles.tileText}>
            <ThemedText type="smallBold">{title}</ThemedText>
            {words}
          </View>
          <Icon name="chevron-right" size={18} color={theme.textSecondary} />
        </>
      ) : (
        <>
          <ThemedText
            type="smallBold"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={styles.tileTitle}>
            {title}
          </ThemedText>
          {number}
          {words}
        </>
      )}
    </Pressable>
  );
}

/**
 * The member's squads and teams in the Team tab: a switch when they are in
 * more than one, then the chosen one on this screen (what they can do there
 * and its people, src/components/team/group-page.tsx). Nothing opens a second
 * page that lists the same people again (Matt, 27 November 2026). Its coaches
 * and physios see an injury status beside an athlete who has one; everyone
 * else sees names and positions only.
 */
export function TeamPeople() {
  const { memberships } = useAuth();
  const club = useClub();
  const { openInjuries } = useHome();
  const groups = sortMemberships(memberships);
  const [chosen, setChosen] = useState<string | null>(null);
  const current = groups.find((m) => m.team.id === chosen) ?? groups[0];
  const statuses =
    club.features.injuries && seesRosterStatus(current?.team_role)
      ? rosterStatuses(openInjuries)
      : new Map<string, RosterStatus>();

  return (
    <View style={styles.section} testID="team-people">
      <SectionTitle>{club.squads ? 'My squads and teams' : 'My teams'}</SectionTitle>
      {!current ? (
        <ThemedText type="small" themeColor="textSecondary">
          You are not in a {club.squads ? 'squad' : 'team'} yet.
        </ThemedText>
      ) : (
        <>
          {groups.length > 1 ? (
            <ChipGroup
              options={groups.map((m) => ({ value: m.team.id, label: groupChipLabel(m.team, groups) }))}
              selected={[current.team.id]}
              onToggle={setChosen}
            />
          ) : (
            // One squad or team: its name, where the switch would be.
            <ThemedText type="smallBold" testID="group-name">
              {current.team.name}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary" testID="my-place">
            {myPlaceLabel(current)}
          </ThemedText>
          <GroupPage
            key={current.team.id}
            team={current.team}
            membership={current}
            statuses={statuses}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tilesAcross: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  tilesStacked: {
    gap: Spacing.two,
  },
  tile: {
    borderRadius: 12,
  },
  // Three across on a 360-wide phone leaves each about 105 wide, so the padding is tighter than a card's.
  tileAcross: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
  },
  // "Attendance" on one line in a tile a third of a small phone wide.
  tileTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  tileStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  stackedNumber: {
    minWidth: 72,
    alignItems: 'flex-start',
  },
  tileText: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  figure: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 26,
    lineHeight: 36,
  },
  section: {
    gap: Spacing.two,
  },
});
