import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GroupActions, RemovedGroups } from '@/components/group-actions';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { GroupKind, Team } from '@/lib/types';
import {
  newestSquads,
  seasonLabel,
  squadsOf,
  TEAM_COLUMNS,
  teamLabel,
  teamsIn,
  useTeamList,
} from '@/lib/use-teams';

export default function SquadsScreen() {
  const { teams, reload } = useTeamList();
  const squads = squadsOf(teams);
  const [kind, setKind] = useState<GroupKind>('team');
  const [name, setName] = useState('');
  const [squadId, setSquadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Team[]>([]);

  // Squads and teams removed from a season that is still running.
  const seasons = [...new Set(teams.map((t) => t.season))].join(',');
  const loadRemoved = useCallback(() => {
    if (!seasons) return;
    supabase
      .from('teams')
      .select(TEAM_COLUMNS)
      .eq('archived', true)
      .in('season', seasons.split(',').map(Number))
      .order('sort_order')
      .then(({ data }) => setRemoved((data as Team[] | null) ?? []));
  }, [seasons]);

  useEffect(() => {
    loadRemoved();
  }, [loadRemoved]);

  const changed = useCallback(() => {
    reload();
    loadRemoved();
  }, [reload, loadRemoved]);

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
      // A team belongs to the same season as its squad; a new squad to the newest season.
      ...(squad
        ? { squad_id: squad.id, season: squad.season }
        : { season: newestSquads(teams)[0]?.season }),
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
        athletes and training partners from the squad. Everyone stays in their squad. Once the teams
        are named, mark the squad’s Selections Phase 2 complete so coaches only look after their
        team’s athletes.
      </ThemedText>

      {squads.map((squad) => (
        <View key={squad.id} style={styles.squad}>
          <PressableCard
            onPress={() => router.push({ pathname: '/team/[id]', params: { id: squad.id } })}>
            <ThemedText type="smallBold">{squad.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {seasonLabel(squad.season)} squad · see everyone in it
            </ThemedText>
          </PressableCard>
          <GroupActions key={squad.name} group={squad} onChange={changed} />
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
              <GroupActions key={team.name} group={team} onChange={changed} />
            </View>
          ))}
          <SelectionsPhase
            squad={squad}
            hasTeams={teamsIn(teams, squad.id).length > 0}
            onChange={reload}
          />
        </View>
      ))}

      <RemovedGroups groups={removed} onChange={changed} />

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
          placeholder={
            kind === 'team' ? 'For example, Mixed Open' : 'For example, Mixed Open Squad'
          }
        />
        {kind === 'team' ? (
          <ChipGroup
            label="Named from squad"
            options={squads.map((s) => ({ value: s.id, label: teamLabel(s, teams) }))}
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

/**
 * Selections Phase 2 for one squad. Once it's complete, the squad no longer
 * gives its coaches to-dos: they look after the athletes in their teams.
 */
function SelectionsPhase({
  squad,
  hasTeams,
  onChange,
}: {
  squad: Team;
  hasTeams: boolean;
  onChange: () => void;
}) {
  const theme = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completedAt = squad.selections_completed_at;

  async function save(complete: boolean) {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('set_selections_complete', {
      p_squad_id: squad.id,
      p_complete: complete,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setConfirming(false);
    onChange();
  }

  if (confirming) {
    return (
      <Card style={styles.team}>
        <ThemedText type="smallBold">Complete Selections Phase 2 for {squad.name}?</ThemedText>
        <ThemedText type="small">
          Coaches will only look after the touring athletes and training partners in their teams.
          Athletes left in the squad but not in a team won’t appear on coaches’ to-dos or check-in
          boards. Nobody is removed from the squad, and you can undo this.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        <Button title="Mark complete" onPress={() => save(true)} busy={saving} />
        <Pressable accessibilityRole="button" onPress={() => setConfirming(false)}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Cancel
          </ThemedText>
        </Pressable>
      </Card>
    );
  }

  return (
    <View style={[styles.team, styles.phase]}>
      <ThemedText type="small" themeColor="textSecondary">
        {completedAt
          ? `Selections Phase 2 complete since ${formatDay(new Date(completedAt))}. Coaches look after their team’s athletes.`
          : hasTeams
            ? 'Selections Phase 2 in progress. Coaches look after everyone in the squad.'
            : 'Name the teams from this squad to finish Selections Phase 2.'}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {completedAt ? (
        <Pressable accessibilityRole="button" onPress={() => save(false)} disabled={saving}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Undo
          </ThemedText>
        </Pressable>
      ) : hasTeams ? (
        <Pressable accessibilityRole="button" onPress={() => setConfirming(true)}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Mark Selections Phase 2 complete
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  squad: {
    gap: Spacing.two,
  },
  team: {
    marginLeft: Spacing.four,
    gap: Spacing.two,
  },
  phase: {
    gap: Spacing.one,
  },
  link: {
    paddingVertical: Spacing.one,
  },
  form: {
    gap: Spacing.three,
  },
});
