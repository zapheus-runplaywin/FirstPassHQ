import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { AWARD_COLUMNS, awardSummary, votingLabel } from '@/lib/awards';
import { supabase } from '@/lib/supabase';
import type { Award } from '@/lib/types';
import { seasonLabel, teamLabel, useTeamList } from '@/lib/use-teams';

/** Every award by season. Open one to duplicate it into a new award. */
export default function AdminAwardsScreen() {
  const { teams, reload: reloadTeams } = useTeamList();
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('awards')
      .select(AWARD_COLUMNS)
      .order('season', { ascending: false })
      .order('closes_at');
    setAwards((data as Award[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      reloadTeams();
    }, [load, reloadTeams]),
  );

  const seasons = [
    ...new Set([...(awards ?? []).map((a) => a.season), ...teams.map((t) => t.season)]),
  ].sort((a, b) => b - a);
  const season = choice ? Number(choice) : seasons[0];
  const shown = (awards ?? []).filter((a) => a.season === season);

  if (awards === null) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Button title="New award" onPress={() => router.push('/admin/awards/edit')} />

      {seasons.length > 1 ? (
        <ChipGroup
          options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          selected={season ? [String(season)] : []}
          onToggle={setChoice}
        />
      ) : null}

      {shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No awards for {season ? seasonLabel(season) : 'this season'} yet.
        </ThemedText>
      ) : (
        <View style={styles.section}>
          {shown.map((award) => {
            const groupNames = award.award_groups.map((g) => {
              const team = teams.find((t) => t.id === g.team_id);
              return team ? teamLabel(team, teams) : 'Archived group';
            });
            return (
              <PressableCard
                key={award.id}
                onPress={() =>
                  router.push({ pathname: '/admin/awards/[id]', params: { id: award.id } })
                }>
                <ThemedText type="smallBold">{award.name}</ThemedText>
                <ThemedText type="small">{awardSummary(award, groupNames)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {votingLabel(award)}
                </ThemedText>
              </PressableCard>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
