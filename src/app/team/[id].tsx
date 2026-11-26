import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { GroupPage } from '@/components/team/group-page';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { seasonLabel, useTeams } from '@/lib/use-teams';

/**
 * A squad or team's own page. Admins open it from Squads and teams: its
 * people, choosing a team's captains and changing who is in it. A member's
 * own squads and teams are in their Team tab, which shows the same thing
 * without a second page (Matt, 27 November 2026); this page still opens for
 * them from an older link.
 *
 * The database answers only for the group's own members and admins
 * (team_roster). Team goals stay with the team: an admin who isn't its coach
 * sees none here.
 */
export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin, memberships } = useAuth();
  const teams = useTeams();
  const membership = memberships.find((m) => m.team.id === id);
  const team = membership?.team ?? teams.find((t) => t.id === id);
  const [refreshing, setRefreshing] = useState(false);
  // Pulling down loads the page's people and rows again.
  const [round, setRound] = useState(0);

  async function onRefresh() {
    setRefreshing(true);
    setRound((n) => n + 1);
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: team?.name ?? 'Team' }} />
      {team ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {seasonLabel(team.season)} {team.kind}
          </ThemedText>
          <GroupPage key={round} team={team} membership={membership} adminPage={isAdmin} />
        </>
      ) : null}
    </Screen>
  );
}
