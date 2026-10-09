import { router } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { useClub } from '@/lib/club';

/** Governance and compliance reports for admins, each saved as a PDF. */
export default function ReportsScreen() {
  const { features } = useClub();
  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Each report shows on screen and saves as a PDF for the committee or an audit.
      </ThemedText>

      <PressableCard onPress={() => router.push('/admin/reports/wwcc')}>
        <ThemedText type="smallBold">Working With Children Checks</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Every coach, manager and physio’s check, and which are missing or expiring
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/reports/under-18s')}>
        <ThemedText type="smallBold">Under 18s and their guardians</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Athletes under 18 with their parents and guardians
        </ThemedText>
      </PressableCard>

      {features.integrity ? (
        <PressableCard onPress={() => router.push('/admin/reports/integrity')}>
          <ThemedText type="smallBold">Integrity training</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Sports Integrity Australia courses: who has finished and who hasn’t
          </ThemedText>
        </PressableCard>
      ) : null}

      {features.attendance ? (
        <PressableCard onPress={() => router.push('/admin/reports/attendance')}>
          <ThemedText type="smallBold">Attendance</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Each athlete’s attendance for a period and the squads and teams you choose
          </ThemedText>
        </PressableCard>
      ) : null}

      {features.awards ? (
        <PressableCard onPress={() => router.push('/admin/reports/awards')}>
          <ThemedText type="smallBold">Award results</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Full voting results for awards that have closed
          </ThemedText>
        </PressableCard>
      ) : null}
    </Screen>
  );
}
