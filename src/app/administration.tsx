import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { pendingRequestsLabel, usePendingRequests } from '@/lib/use-pending-requests';

export default function AdministrationScreen() {
  const { pendingCount, reloadPending } = usePendingRequests();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reloadPending();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PressableCard onPress={() => router.push('/admin')}>
        <ThemedText type="smallBold">Members</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {pendingRequestsLabel(pendingCount)}
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/squads')}>
        <ThemedText type="smallBold">Squads and teams</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Add squads and name teams at selections
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/seasons')}>
        <ThemedText type="smallBold">Seasons</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Start next season in May and archive the last one after Easter
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/calendars')}>
        <ThemedText type="smallBold">Calendars</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Add the club calendar and team calendars
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/injuries')}>
        <ThemedText type="smallBold">Injury report</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Injuries and their status, with a CSV export
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/club-password')}>
        <ThemedText type="smallBold">Club password</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          New members need it to ask to join
        </ThemedText>
      </PressableCard>
    </Screen>
  );
}
