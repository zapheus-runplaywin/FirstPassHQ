import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AWARD_COLUMNS, awardSummary, closesLabel } from '@/lib/awards';
import { formatShortDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Award, AwardResult, AwardTurnout } from '@/lib/types';
import { seasonLabel, teamLabel, useTeams } from '@/lib/use-teams';

/** One award for admins: its settings, standings and who has voted. */
export default function AdminAwardScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teams = useTeams();
  const [award, setAward] = useState<Award | null>(null);
  const [results, setResults] = useState<AwardResult[]>([]);
  const [turnout, setTurnout] = useState<AwardTurnout[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, r, t] = await Promise.all([
      supabase.from('awards').select(AWARD_COLUMNS).eq('id', id).single(),
      supabase.rpc('award_results', { p_award_id: id }),
      supabase.rpc('award_turnout', { p_award_id: id }),
    ]);
    setAward(a.data as Award | null);
    setResults((r.data as AwardResult[] | null) ?? []);
    setTurnout((t.data as AwardTurnout[] | null) ?? []);
  }, [id]);

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

  if (!award) return <Screen>{null}</Screen>;

  const groupNames = award.award_groups.map((g) => {
    const team = teams.find((t) => t.id === g.team_id);
    return team ? teamLabel(team, teams) : 'Archived group';
  });
  const weighted = award.preseason_weight > 0;
  const groups = award.per_group
    ? award.award_groups.map((g, i) => ({ id: g.team_id as string | null, name: groupNames[i] }))
    : [{ id: null, name: null }];

  async function copy() {
    if (!award) return;
    setCopying(true);
    setError(null);
    setNotice(null);
    const next = award.season + 1;
    const { data, error: copyError } = await supabase.rpc('admin_copy_awards', {
      p_award_ids: [award.id],
      p_season: next,
    });
    setCopying(false);
    if (copyError) {
      setError(copyError.message);
      return;
    }
    const copied = (data as { award_id: string; missing_groups: number }[] | null) ?? [];
    if (copied.length === 0) {
      setNotice(`It’s already been copied into ${seasonLabel(next)}.`);
      return;
    }
    router.replace({ pathname: '/admin/awards/[id]', params: { id: copied[0].award_id } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: award.name }} />
      <Card>
        <ThemedText type="smallBold">{award.name}</ThemedText>
        {award.description ? <ThemedText type="small">{award.description}</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary">
          {awardSummary(award, groupNames)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {seasonLabel(award.season)} · {closesLabel(award.closes_at)}
          {award.preseason_closes_at
            ? ` · Preseason vote ${closesLabel(award.preseason_closes_at).replace(/^C/, 'c')}`
            : ''}
        </ThemedText>
        {award.nominees === 'listed' ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nominees: {award.award_candidates.map((c) => c.name).join(', ')}
          </ThemedText>
        ) : null}
      </Card>

      <Button
        title="Edit award"
        variant="secondary"
        onPress={() => router.push({ pathname: '/admin/awards/edit', params: { id: award.id } })}
      />

      {groups.map((group) => {
        const standings = results.filter((r) => r.team_id === group.id);
        const rounds = turnout.filter((t) => t.team_id === group.id);
        return (
          <View key={group.id ?? 'club'} style={styles.section}>
            <ThemedText type="smallBold">{group.name ?? 'Results'}</ThemedText>
            {standings.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No votes yet.
              </ThemedText>
            ) : (
              <Card>
                {standings.map((r, i) => (
                  <View key={`${r.nominee_name}-${i}`} style={styles.resultRow}>
                    <ThemedText
                      type={i === 0 ? 'smallBold' : 'small'}
                      style={[styles.flex, i === 0 ? { color: theme.accent } : undefined]}>
                      {i + 1}. {r.nominee_name}
                    </ThemedText>
                    <ThemedText type={i === 0 ? 'smallBold' : 'small'}>
                      {weighted
                        ? `${Number(r.score).toFixed(1)}%`
                        : `${r.score} ${Number(r.score) === 1 ? 'point' : 'points'}`}
                    </ThemedText>
                  </View>
                ))}
                {weighted ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {award.preseason_weight}% from the preseason vote,{' '}
                    {100 - award.preseason_weight}% from matches. Points:{' '}
                    {standings
                      .slice(0, 3)
                      .map((r) => `${r.nominee_name} ${r.preseason_points} + ${r.match_points}`)
                      .join(', ')}
                    .
                  </ThemedText>
                ) : null}
              </Card>
            )}

            {rounds.length > 0 ? (
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  Who has voted
                </ThemedText>
                {rounds.map((t) => (
                  <View
                    key={`${t.fixture_id ?? ''}${t.preseason ? 'pre' : ''}`}
                    style={styles.resultRow}>
                    <ThemedText type="small" style={styles.flex}>
                      {t.preseason
                        ? 'Preseason'
                        : t.fixture_label
                          ? `${t.fixture_label}${t.starts_at ? ` · ${formatShortDay(new Date(t.starts_at))}` : ''}`
                          : 'Ballots'}
                    </ThemedText>
                    <ThemedText type="small">
                      {t.ballots} of {t.voters}
                    </ThemedText>
                  </View>
                ))}
              </Card>
            ) : award.by_match ? (
              <ThemedText type="small" themeColor="textSecondary">
                No matches played yet.
              </ThemedText>
            ) : null}
          </View>
        );
      })}

      <ThemedText type="small" themeColor="textSecondary">
        Only admins see results. Nobody, admins included, can see who voted for whom.
      </ThemedText>

      {award.annual ? (
        <Button
          title={`Copy into ${seasonLabel(award.season + 1)}`}
          variant="secondary"
          onPress={copy}
          busy={copying}
        />
      ) : null}
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
});
