import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { AWARD_COLUMNS, awardSummary, closesLabel } from '@/lib/awards';
import { supabase } from '@/lib/supabase';
import type { Award } from '@/lib/types';
import { seasonLabel, teamLabel, useTeamList } from '@/lib/use-teams';

type Copied = { award_id: string; award_name: string; missing_groups: number };

/** Every award by season, with a way to copy the annual ones into the next season. */
export default function AdminAwardsScreen() {
  const { teams, reload: reloadTeams } = useTeamList();
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState<{ season: number; awards: Copied[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const next = season + 1;
  // Annual awards this season that haven't been copied into the next one yet.
  const toCopy = shown.filter(
    (a) => a.annual && !(awards ?? []).some((c) => c.copied_from === a.id && c.season === next),
  );

  async function copyAnnual() {
    setCopying(true);
    setError(null);
    const { data, error: copyError } = await supabase.rpc('admin_copy_awards', {
      p_award_ids: toCopy.map((a) => a.id),
      p_season: next,
    });
    setCopying(false);
    if (copyError) {
      setError(copyError.message);
      return;
    }
    setCopied({ season: next, awards: (data as Copied[] | null) ?? [] });
    setChoice(String(next));
    load();
  }

  if (awards === null) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Button title="New award" onPress={() => router.push('/admin/awards/edit')} />

      {seasons.length > 1 ? (
        <ChipGroup
          options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          selected={season ? [String(season)] : []}
          onToggle={(value) => {
            setChoice(value);
            setCopied(null);
          }}
        />
      ) : null}

      {copied ? (
        <Card>
          <ThemedText type="smallBold">
            Copied {copied.awards.length} {copied.awards.length === 1 ? 'award' : 'awards'} into{' '}
            {seasonLabel(copied.season)}
          </ThemedText>
          {copied.awards
            .filter((c) => c.missing_groups > 0)
            .map((c) => (
              <ThemedText key={c.award_id} type="small" themeColor="textSecondary">
                {c.award_name}: {c.missing_groups}{' '}
                {c.missing_groups === 1 ? 'squad or team has' : 'squads or teams have'} no match in
                the new season yet. Add them once they’re named.
              </ThemedText>
            ))}
        </Card>
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
                  {closesLabel(award.closes_at)}
                  {award.annual ? ' · Every year' : ''}
                </ThemedText>
              </PressableCard>
            );
          })}
        </View>
      )}

      {toCopy.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Copies {toCopy.length === 1 ? 'the annual award' : `the ${toCopy.length} annual awards`}{' '}
            with the same settings, closing a year later, for the squads and teams with the same
            names in {seasonLabel(next)}.
          </ThemedText>
          <Button
            title={`Copy annual awards into ${seasonLabel(next)}`}
            variant="secondary"
            onPress={copyAnnual}
            busy={copying}
          />
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
