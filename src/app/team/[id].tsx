import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { RosterEntry } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const teams = useTeams();
  const team = teams.find((t) => t.id === id);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      supabase
        .rpc('team_roster', { p_team_id: id })
        .then(({ data }) => setRoster((data as RosterEntry[] | null) ?? [])),
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: team?.name ?? 'Team' }} />
      {roster === null ? null : roster.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No one has been added to this team yet.
        </ThemedText>
      ) : (
        roster.map((member) => (
          <Card key={member.profile_id}>
            <ThemedText type="smallBold">{member.full_name ?? 'Unnamed member'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {teamPositionLabel(member.team_role, member.coach_title)}
            </ThemedText>
          </Card>
        ))
      )}
    </Screen>
  );
}
