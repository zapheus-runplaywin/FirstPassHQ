import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ChildLinks } from '@/components/home/child-links';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyChildren } from '@/lib/children';
import { useClub } from '@/lib/club';
import { useOpenInjuries } from '@/lib/injuries';
import { useMyMedicalReviews } from '@/lib/medical';
import { hasRole } from '@/lib/roles';

/**
 * One child's page, opened from their card in the Family tab: everything
 * their parent or guardian opens for them, in the same order every time.
 *
 * The page shows a child only when the database lists them as the caller's
 * own (my_child_consents), so another member's child, or an id made up in a
 * link, shows nothing. Each row opens a screen with its own access rule.
 */
export default function ChildScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { profile } = useAuth();
  const { features } = useClub();
  const isGuardian = profile?.status === 'approved' && hasRole(profile, 'guardian');
  const { children, activityNew, loaded, reloadChildren } = useMyChildren(isGuardian);
  const { openInjuries, reloadInjuries } = useOpenInjuries();
  // Verified parents keep their child's medical details, checked yearly.
  const { medicalReviews, reloadMedicalReviews } = useMyMedicalReviews(
    isGuardian && !!profile?.verified_at,
  );
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([reloadChildren(), reloadInjuries(), reloadMedicalReviews()]);
    setRefreshing(false);
  }

  const child = children.find((c) => c.id === id);
  // Until the list is back the title is the name the card passed; it is never
  // shown for a child who turns out not to be theirs.
  const waiting = isGuardian && !loaded;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: child?.name ?? (waiting && name ? name : 'Your child') }} />
      {child ? (
        <ChildLinks
          child={child}
          facts={{
            newActivity: activityNew[child.id] ?? 0,
            injuries: features.injuries ? openInjuries : [],
            medicalReviews,
          }}
        />
      ) : waiting ? null : (
        <Card>
          <ThemedText type="smallBold">This child isn’t linked to you</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Your children are in the Family tab. To add a child, use their link code or ask the
            club to add a child who won’t use the app.
          </ThemedText>
          <Button title="Your children" onPress={() => router.replace('/children')} />
        </Card>
      )}
    </Screen>
  );
}
