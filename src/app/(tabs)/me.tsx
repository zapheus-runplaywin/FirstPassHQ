import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { HomeCardView, SECTION_CARDS } from '@/components/home/cards';
import { FeatureCard } from '@/components/home/feature-card';
import { SectionTitle, TabHeader } from '@/components/home/tab-header';
import { SafeguardingContactsCard } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useClubChoice } from '@/lib/club-choice';
import { useHome } from '@/lib/home';

/**
 * Me, the last tab: the member's own records, their tasks, who to talk to
 * about a child's safety, and their account. Anything of theirs that has no
 * hub to live in lands here too, so nothing they could reach before is lost.
 */
export default function MeScreen() {
  const home = useHome();
  const { profile, session, signOut } = useAuth();
  const { switchClub } = useClubChoice();
  const cards = home.cards('me');
  const tiles = cards.filter((card) => !SECTION_CARDS.includes(card));
  const sections = cards.filter((card) => SECTION_CARDS.includes(card));
  const tasks = home.personalTasks.length;

  return (
    <Screen
      tab
      wide
      showVersion
      refreshing={home.refreshing}
      onRefresh={home.onRefresh}
      header={<TabHeader title="Me" />}>
      <View style={styles.who}>
        <ThemedText style={styles.name} numberOfLines={2}>
          {profile?.full_name || profile?.preferred_name || session?.user.email || home.name}
        </ThemedText>
        {home.roles ? (
          <ThemedText type="small" themeColor="textSecondary">
            {home.roles}
          </ThemedText>
        ) : null}
      </View>

      <CardGrid gap={Spacing.two}>
        <FeatureCard
          icon="user"
          title="Your details"
          detail="Your name, contact details and notifications"
          onPress={() => router.push('/my-details')}
        />
        {tiles.map((card) => (
          <HomeCardView key={card} card={card} />
        ))}
        <FeatureCard
          icon="check-circle"
          title="Your tasks"
          detail={tasks > 0 ? `${tasks} to do` : 'Your own list of things to remember'}
          onPress={() => router.push('/tasks')}
        />
      </CardGrid>

      {sections.map((card) => (
        <HomeCardView key={card} card={card} />
      ))}

      <View style={styles.section}>
        <SectionTitle>Safety</SectionTitle>
        <FeatureCard
          icon="shield"
          title="Raise a concern"
          detail="Worried about a child, or something someone said or did? Tell the club safely. If a child is in danger now, call 000."
          onPress={() => router.push('/concern/new')}
        />
        <SafeguardingContactsCard />
      </View>

      <View style={styles.section}>
        <SectionTitle>Account</SectionTitle>
        <CardGrid gap={Spacing.two}>
          <FeatureCard icon="repeat" title="Switch club" onPress={switchClub} />
          <FeatureCard icon="log-out" title="Sign out" onPress={signOut} />
          <FeatureCard
            icon="trash-2"
            title="Delete account"
            onPress={() => router.push('/delete-account')}
          />
        </CardGrid>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: {
    gap: Spacing.half,
  },
  name: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 22,
    lineHeight: 28,
  },
  section: {
    gap: Spacing.two,
  },
});
