import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { captainRoleLabels, teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { CaptainRole, GroupCaptain, RosterEntry } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin, memberships } = useAuth();
  const teams = useTeams();
  const team = teams.find((t) => t.id === id);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [captains, setCaptains] = useState<Map<string, CaptainRole>>(new Map());
  const [clubCaptains, setClubCaptains] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const season = team?.season;

  // Admins and the group's coaches choose its captains.
  const canChooseCaptains =
    !!team &&
    (isAdmin || memberships.some((m) => m.team.id === id && m.team_role === 'coach'));

  const load = useCallback(async () => {
    const [rosterResult, captainResult, clubResult] = await Promise.all([
      supabase.rpc('team_roster', { p_team_id: id }),
      supabase.from('team_captains').select('team_id, profile_id, captain_role').eq('team_id', id),
      season === undefined
        ? Promise.resolve({ data: [] })
        : supabase.from('club_captains').select('profile_id').eq('season', season),
    ]);
    setRoster((rosterResult.data as RosterEntry[] | null) ?? []);
    setCaptains(
      new Map(
        ((captainResult.data as GroupCaptain[] | null) ?? []).map((c) => [
          c.profile_id,
          c.captain_role,
        ]),
      ),
    );
    setClubCaptains(
      new Set(((clubResult.data as { profile_id: string }[] | null) ?? []).map((c) => c.profile_id)),
    );
  }, [id, season]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function positionLabel(member: RosterEntry) {
    const parts = [teamPositionLabel(member.team_role, member.coach_title, member.selection)];
    if (member.team_role === 'athlete') {
      const captainRole = captains.get(member.profile_id);
      if (captainRole) parts.push(captainRoleLabels[captainRole]);
      if (clubCaptains.has(member.profile_id)) parts.push('Club captain');
    }
    return parts.join(' · ');
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: team?.name ?? 'Team' }} />
      {roster === null ? null : roster.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No one has been added yet.
        </ThemedText>
      ) : (
        roster.map((member) => (
          <Card key={member.profile_id}>
            <ThemedText type="smallBold">{member.full_name ?? 'Unnamed member'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {positionLabel(member)}
            </ThemedText>
          </Card>
        ))
      )}
      {canChooseCaptains && roster?.some((m) => m.team_role === 'athlete') ? (
        <Button
          title="Choose captains"
          variant="secondary"
          onPress={() => router.push({ pathname: '/team/captains/[id]', params: { id } })}
        />
      ) : null}
    </Screen>
  );
}
