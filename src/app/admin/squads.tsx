import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import type { GroupKind } from '@/lib/types';
import { squadsOf, teamsIn, useTeamList } from '@/lib/use-teams';

export default function SquadsScreen() {
  const { teams, reload } = useTeamList();
  const squads = squadsOf(teams);
  const [kind, setKind] = useState<GroupKind>('team');
  const [name, setName] = useState('');
  const [squadId, setSquadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    const squad = squads.find((s) => s.id === squadId);
    if (kind === 'team' && !squad) {
      setError('Choose the squad the team is named from.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('teams').insert({
      name: name.trim(),
      kind,
      // A team belongs to the same season as its squad.
      ...(squad ? { squad_id: squad.id, season: squad.season } : {}),
      sort_order: kind === 'team' ? teamsIn(teams, squad!.id).length + 1 : squads.length + 1,
    });
    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'There is already a squad or team with that name this season.'
          : insertError.message,
      );
      return;
    }
    setName('');
    reload();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        New members are added to a squad. At selections, name the teams here and pick touring
        athletes and training partners from the squad. Everyone stays in their squad.
      </ThemedText>

      {squads.map((squad) => (
        <View key={squad.id} style={styles.squad}>
          <PressableCard
            onPress={() => router.push({ pathname: '/team/[id]', params: { id: squad.id } })}>
            <ThemedText type="smallBold">{squad.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {squad.season} squad · see everyone in it
            </ThemedText>
          </PressableCard>
          {teamsIn(teams, squad.id).map((team) => (
            <View key={team.id} style={styles.team}>
              <PressableCard
                onPress={() =>
                  router.push({ pathname: '/admin/team/[id]', params: { id: team.id } })
                }>
                <ThemedText type="smallBold">{team.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Team · choose who is selected
                </ThemedText>
              </PressableCard>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.form}>
        <ThemedText type="smallBold">Add a squad or team</ThemedText>
        <ChipGroup
          options={[
            { value: 'team' as const, label: 'Team' },
            { value: 'squad' as const, label: 'Squad' },
          ]}
          selected={[kind]}
          onToggle={setKind}
        />
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder={kind === 'team' ? 'For example, Mixed Open' : 'For example, Mixed Open Squad'}
        />
        {kind === 'team' ? (
          <ChipGroup
            label="Named from squad"
            options={squads.map((s) => ({ value: s.id, label: s.name }))}
            selected={squadId ? [squadId] : []}
            onToggle={setSquadId}
          />
        ) : null}
        <ErrorText>{error}</ErrorText>
        <Button title={kind === 'team' ? 'Add team' : 'Add squad'} onPress={add} busy={saving} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  squad: {
    gap: Spacing.two,
  },
  team: {
    paddingLeft: Spacing.four,
  },
  form: {
    gap: Spacing.three,
  },
});
