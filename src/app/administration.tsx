import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { useClub } from '@/lib/club';
import { pendingRequestsLabel, usePendingRequests } from '@/lib/use-pending-requests';

export default function AdministrationScreen() {
  const { pendingCount, reloadPending } = usePendingRequests();
  const { features, squads, affiliation } = useClub();
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

      <PressableCard onPress={() => router.push('/admin/reports')}>
        <ThemedText type="smallBold">Reports</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Governance and compliance reports to save as PDFs
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/invite')}>
        <ThemedText type="smallBold">Invite members</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          A QR code and link that take new members to the club’s sign-in
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/safeguarding')}>
        <ThemedText type="smallBold">Safeguarding</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Child Safety Officer, Complaints Manager, governing body and policy
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/conduct')}>
        <ThemedText type="smallBold">Code of conduct</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Who has accepted it this season and who still has to
        </ThemedText>
      </PressableCard>

      {affiliation ? (
        <PressableCard onPress={() => router.push('/admin/affiliation')}>
          <ThemedText type="smallBold">Affiliation</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Checklist, primary contacts and PlayHQ registrations for your association
          </ThemedText>
        </PressableCard>
      ) : null}

      <PressableCard onPress={() => router.push('/admin/club')}>
        <ThemedText type="smallBold">Club settings</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Club name, colours, logo and which features are on
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/squads')}>
        <ThemedText type="smallBold">{squads ? 'Squads and teams' : 'Teams'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {squads ? 'Add squads and name teams at selections' : 'Add teams and choose who is in each'}
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/seasons')}>
        <ThemedText type="smallBold">Seasons</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Start the next season and archive the last one
        </ThemedText>
      </PressableCard>

      <PressableCard onPress={() => router.push('/admin/captains')}>
        <ThemedText type="smallBold">Club captains</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Choose the athletes who can message the whole club
        </ThemedText>
      </PressableCard>

      {features.awards ? (
        <PressableCard onPress={() => router.push('/admin/awards')}>
          <ThemedText type="smallBold">Awards</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Create award votes, see results and copy annual awards
          </ThemedText>
        </PressableCard>
      ) : null}

      {features.integrity ? (
        <PressableCard onPress={() => router.push('/admin/training')}>
          <ThemedText type="smallBold">Integrity training</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Sports Integrity Australia courses each role must complete, and who has
          </ThemedText>
        </PressableCard>
      ) : null}

      {features.calendar || features.awards || features.goals ? (
        <PressableCard onPress={() => router.push('/admin/fixtures')}>
          <ThemedText type="smallBold">Fixtures</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Import match fixtures from PlayHQ
          </ThemedText>
        </PressableCard>
      ) : null}

      {features.calendar ? (
        <PressableCard onPress={() => router.push('/admin/calendars')}>
          <ThemedText type="smallBold">Calendars</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add the club calendar and team calendars
          </ThemedText>
        </PressableCard>
      ) : null}

      {features.injuries ? (
        <PressableCard onPress={() => router.push('/admin/injuries')}>
          <ThemedText type="smallBold">Injury report</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Injuries and their status, as a PDF or CSV
          </ThemedText>
        </PressableCard>
      ) : null}

      <PressableCard onPress={() => router.push('/admin/club-password')}>
        <ThemedText type="smallBold">Club password</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          New members need it to ask to join
        </ThemedText>
      </PressableCard>
    </Screen>
  );
}
