import { StyleSheet } from 'react-native';

import { CardGrid } from '@/components/columns';
import { HomeCardView, SECTION_CARDS } from '@/components/home/cards';
import { HubSwitch, TabHeader } from '@/components/home/tab-header';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHome } from '@/lib/home';
import { HUB_TITLES, type HomeCard, type HubName } from '@/lib/home-layout';

/** What each hub leads with, before its other cards. */
const LEADS: Record<HubName, HomeCard[]> = {
  // Your squads and teams, then the tools for looking after them.
  team: ['groups'],
  // Your children first.
  family: ['guardianOf', 'children'],
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
 */
export function HubScreen({ hub }: { hub: HubName }) {
  const home = useHome();
  const cards = home.cards(hub);
  const leads = LEADS[hub].filter((card) => cards.includes(card));
  const rest = cards.filter((card) => !leads.includes(card));
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
      {cards.length === 0 ? (
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
