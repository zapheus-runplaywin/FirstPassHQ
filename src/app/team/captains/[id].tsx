import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { CaptainRole, GroupCaptain, RosterEntry } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

type Pick = CaptainRole | 'none';

const options: { value: Pick; label: string }[] = [
  { value: 'captain', label: 'Captain' },
  { value: 'vice_captain', label: 'Vice captain' },
  { value: 'none', label: 'Neither' },
];

/**
 * Admins and a squad or team's coaches choose its captains and vice captains,
 * who can then message the group like its coaches.
 */
export default function ChooseCaptainsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = useAuth();
  const teams = useTeams();
  const team = teams.find((t) => t.id === id);
  const [athletes, setAthletes] = useState<RosterEntry[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [rosterResult, captainResult] = await Promise.all([
        supabase.rpc('team_roster', { p_team_id: id }),
        supabase.from('team_captains').select('team_id, profile_id, captain_role').eq('team_id', id),
      ]);
      const current = new Map(
        ((captainResult.data as GroupCaptain[] | null) ?? []).map((c) => [
          c.profile_id,
          c.captain_role,
        ]),
      );
      const members = ((rosterResult.data as RosterEntry[] | null) ?? []).filter(
        (m) => m.team_role === 'athlete',
      );
      setAthletes(members);
      setPicks(
        Object.fromEntries(members.map((m) => [m.profile_id, current.get(m.profile_id) ?? 'none'])),
      );
    })();
  }, [id]);

  // Any number of captains and vice captains: it's up to the coach.
  function choose(profileId: string, pick: Pick) {
    setPicks((current) => ({ ...current, [profileId]: pick }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const entries = Object.entries(picks);
    const { error: rpcError } = await supabase.rpc('set_group_captains', {
      p_team_id: id,
      p_captain_ids: entries.filter(([, pick]) => pick === 'captain').map(([pid]) => pid),
      p_vice_captain_ids: entries.filter(([, pick]) => pick === 'vice_captain').map(([pid]) => pid),
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    // The member may have made themselves a captain.
    refresh();
    router.back();
  }

  if (athletes === null) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: team ? `${team.name} captains` : 'Captains' }} />
      <ThemedText type="small" themeColor="textSecondary">
        Choose as many captains and vice captains as you like. They can all message everyone in
        this {team?.kind === 'squad' ? 'squad' : 'team'}, like its coaches. Messages from athletes under
        18 are copied to their parents or guardians.
      </ThemedText>

      {athletes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No athletes are in this group yet.
        </ThemedText>
      ) : (
        athletes.map((athlete) => (
          <View key={athlete.profile_id} style={styles.athlete}>
            <ChipGroup
              label={athlete.full_name ?? 'Unnamed member'}
              options={options}
              selected={[picks[athlete.profile_id] ?? 'none']}
              onToggle={(pick) => choose(athlete.profile_id, pick)}
            />
          </View>
        ))
      )}

      <ErrorText>{error}</ErrorText>
      <Button title="Save captains" onPress={save} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  athlete: {
    gap: Spacing.one,
  },
});
