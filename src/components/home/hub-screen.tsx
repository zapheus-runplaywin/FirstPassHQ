import { StyleSheet } from 'react-native';

import { CardGrid } from '@/components/columns';
import { HomeCardView, SECTION_CARDS } from '@/components/home/cards';
import { ClubHub } from '@/components/home/club-hub';
import { HubSwitch, TabHeader } from '@/components/home/tab-header';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHome } from '@/lib/home';
import { HUB_TITLES, type HomeCard, type HubName } from '@/lib/home-layout';
import { useClubAreas } from '@/lib/use-club-areas';

/** What each hub leads with, before its other cards. */
const LEADS: Record<HubName, HomeCard[]> = {
  // Your squads and teams, then the tools for looking after them.
  team: ['groups'],
  // Your children first, one card each.
  family: ['children'],
  club: [],
};

/** What each hub ends with, after its other cards. */
const LAST: Record<HubName, HomeCard[]> = {
  team: [],
  // Adding another child is rare once a child is linked.
  family: ['guardianOf'],
  club: [],
};

const EMPTY: Record<HubName, string> = {
  team: 'Nothing for your squads and teams yet.',
  family: 'Nothing for your family yet.',
  club: 'Nothing for the club yet.',
};

/**
 * A hub: the fourth tab, named for what the member looks after. Team for
 * athletes, coaches, managers and physios; Family for parents and guardians;
 * Club for the committee and admins. Someone with more than one gets a switch
 * at the top. Every card here opens a screen that has its own rule for who may
 * open it (src/lib/route-access.ts).
 *
 * Club groups what it holds into areas (src/components/home/club-hub.tsx).
 */
export function HubScreen({ hub }: { hub: HubName }) {
  const home = useHome();
  const areas = useClubAreas();
  const inAreas = hub === 'club';
  const cards = inAreas ? [] : home.cards(hub);
  // A parent with no child linked yet starts with adding one.
  const nothingToLead = !LEADS[hub].some((card) => cards.includes(card));
  const leads = (nothingToLead ? [...LEADS[hub], ...LAST[hub]] : LEADS[hub]).filter((card) =>
    cards.includes(card),
  );
  const last = LAST[hub].filter((card) => cards.includes(card) && !leads.includes(card));
  const rest = cards.filter((card) => !leads.includes(card) && !last.includes(card));
  const tiles = rest.filter((card) => !SECTION_CARDS.includes(card));
  const sections = rest.filter((card) => SECTION_CARDS.includes(card));

  return (
    <Screen
      tab
      wide
      refreshing={home.refreshing}
      onRefresh={home.onRefresh}
      header={<TabHeader title={HUB_TITLES[hub]} />}>
      <HubSwitch hubs={home.hubs} current={hub} />
      {inAreas ? <ClubHub areas={areas} /> : null}
      {leads.map((card) => (
        <HomeCardView key={card} card={card} />
      ))}
      {tiles.length > 0 ? (
        <CardGrid gap={Spacing.two}>
          {tiles.map((card) => (
            <HomeCardView key={card} card={card} />
          ))}
        </CardGrid>
      ) : null}
      {sections.map((card) => (
        <HomeCardView key={card} card={card} />
      ))}
      {last.map((card) => (
        <HomeCardView key={card} card={card} />
      ))}
      {cards.length === 0 && (!inAreas || areas.length === 0) ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          {EMPTY[hub]}
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
});
