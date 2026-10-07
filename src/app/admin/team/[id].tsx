import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { RosterEntry, Team, TeamSelection } from '@/lib/types';
import { TEAM_COLUMNS } from '@/lib/use-teams';

/** For each squad member: how they are selected for this team, if at all. */
type Pick = TeamSelection | 'in' | 'out';

const athleteOptions: { value: Pick; label: string }[] = [
  { value: 'touring', label: 'Touring' },
  { value: 'training_partner', label: 'Training partner' },
  { value: 'out', label: 'Not selected' },
];
const staffOptions: { value: Pick; label: string }[] = [
  { value: 'in', label: 'In this team' },
  { value: 'out', label: 'Not in this team' },
];

export default function NameTeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [squad, setSquad] = useState<Team | null>(null);
  const [squadMembers, setSquadMembers] = useState<RosterEntry[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: teamRow } = await supabase
        .from('teams')
        .select(TEAM_COLUMNS)
        .eq('id', id)
        .single();
      const loadedTeam = teamRow as Team | null;
      if (!loadedTeam?.squad_id) {
        setError('Team not found.');
        return;
      }
      const [squadResult, squadRoster, teamRoster] = await Promise.all([
        supabase.from('teams').select(TEAM_COLUMNS).eq('id', loadedTeam.squad_id).single(),
        supabase.rpc('team_roster', { p_team_id: loadedTeam.squad_id }),
        supabase.rpc('team_roster', { p_team_id: id }),
      ]);
      const current = new Map(
        ((teamRoster.data as RosterEntry[] | null) ?? []).map((m) => [m.profile_id, m]),
      );
      const members = (squadRoster.data as RosterEntry[] | null) ?? [];
      setTeam(loadedTeam);
      setSquad(squadResult.data as Team | null);
      setSquadMembers(members);
      setPicks(
        Object.fromEntries(
          members.map((m) => {
            const inTeam = current.get(m.profile_id);
            if (!inTeam) return [m.profile_id, 'out'];
            return [m.profile_id, inTeam.selection ?? 'in'];
          }),
        ),
      );
    })();
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_team_members', {
      p_team_id: id,
      p_members: Object.entries(picks)
        .filter(([, pick]) => pick !== 'out')
        .map(([profile_id, pick]) => ({
          profile_id,
          selection: pick === 'in' ? null : pick,
        })),
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.back();
  }

  if (!team || !squadMembers) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const count = (pick: Pick) => Object.values(picks).filter((p) => p === pick).length;

  return (
    <Screen>
      <Stack.Screen options={{ title: team.name }} />

      <Card>
        <ThemedText type="smallBold">
          {count('touring')} touring · {count('training_partner')} training partners
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Choosing from the {squad?.name ?? 'squad'}. People not selected stay in the squad.
        </ThemedText>
      </Card>

      {squadMembers.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No one is in the squad yet. Add members to the squad from Members first.
        </ThemedText>
      ) : (
        squadMembers.map((member) => (
          <View key={member.profile_id} style={styles.member}>
            <ChipGroup
              label={`${member.full_name ?? 'Unnamed member'} · ${teamPositionLabel(member.team_role, member.coach_title)}`}
              options={member.team_role === 'athlete' ? athleteOptions : staffOptions}
              selected={[picks[member.profile_id] ?? 'out']}
              onToggle={(pick) => setPicks((current) => ({ ...current, [member.profile_id]: pick }))}
            />
          </View>
        ))
      )}

      <ErrorText>{error}</ErrorText>
      <Button title="Save team" onPress={save} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  member: {
    gap: Spacing.one,
  },
});
