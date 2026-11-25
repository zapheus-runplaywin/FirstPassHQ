import { router } from 'expo-router';
import { useState } from 'react';

import { CardGrid } from '@/components/columns';
import { FeatureCard } from '@/components/home/feature-card';
import { Screen } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { adminMenuItems } from '@/lib/admin-menu';
import { useClub } from '@/lib/club';
import { pendingRequestsLabel, usePendingRequests } from '@/lib/use-pending-requests';

/**
 * Everything, A to Z: every screen an admin sets the club up with or looks
 * after it from, in one alphabetical list (Matt, 19 November 2026). The Club
 * tab has the same screens grouped into areas, and opens this from its foot.
 */
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
    <Screen wide refreshing={refreshing} onRefresh={onRefresh}>
      <CardGrid gap={Spacing.two}>
        {items.map((item) => {
          const waiting = item.href === '/admin' ? pendingCount : 0;
          return (
            <FeatureCard
              key={String(item.href)}
              icon={item.icon}
              title={item.title}
              detail={item.detail}
              detailTone={waiting > 0 ? 'attention' : 'quiet'}
              badge={waiting}
              onPress={() => router.push(item.href)}
            />
          );
        })}
      </CardGrid>
    </Screen>
  );
}
