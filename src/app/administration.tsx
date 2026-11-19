import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { adminMenuItems } from '@/lib/admin-menu';
import { useClub } from '@/lib/club';
import { pendingRequestsLabel, usePendingRequests } from '@/lib/use-pending-requests';

export default function AdministrationScreen() {
  const { pendingCount, reloadPending } = usePendingRequests();
  const { features, squads } = useClub();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reloadPending();
    setRefreshing(false);
  }

  const items = adminMenuItems({
    features,
    squads,
    membersDetail: pendingRequestsLabel(pendingCount),
  });

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {items.map((item) => (
        <PressableCard key={String(item.href)} onPress={() => router.push(item.href)}>
          <ThemedText type="smallBold">{item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.detail}
          </ThemedText>
        </PressableCard>
      ))}
    </Screen>
  );
}
