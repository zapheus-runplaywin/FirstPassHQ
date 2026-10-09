import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateString } from '@/lib/injuries';
import {
  audienceLabel,
  countsLabel,
  type TrainingCounts,
  type TrainingRequirement,
} from '@/lib/training';
import type { Team } from '@/lib/types';
import { seasonLabel, teamLabel } from '@/lib/use-teams';

/** Season choices, newest first. */
export function SeasonChips({
  seasons,
  season,
  onChange,
}: {
  seasons: number[];
  season: number;
  onChange: (season: number) => void;
}) {
  if (seasons.length < 2) return null;
  return (
    <ChipGroup
      options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
      selected={[String(season)]}
      onToggle={(value) => onChange(Number(value))}
    />
  );
}

/** A season's training with who must do it and how many are done. */
export function TrainingList({
  requirements,
  counts,
  teams,
  onPress,
}: {
  requirements: TrainingRequirement[];
  counts: TrainingCounts[];
  teams: Team[];
  onPress: (requirement: TrainingRequirement) => void;
}) {
  return (
    <View style={styles.list}>
      {requirements.map((r) => {
        const groups = r.all_teams
          ? null
          : r.training_requirement_teams.map((g) => {
              const team = teams.find((t) => t.id === g.team_id);
              return team ? teamLabel(team, teams) : 'Archived group';
            });
        return (
          <PressableCard key={r.id} onPress={() => onPress(r)}>
            <ThemedText type="smallBold">
              {r.name}
              {r.archived ? ' (archived)' : ''}
            </ThemedText>
            <ThemedText type="small">{audienceLabel(r.roles, groups)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Due {formatDateString(r.due_on)} ·{' '}
              {countsLabel(counts.find((c) => c.requirement_id === r.id))}
            </ThemedText>
          </PressableCard>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
});
