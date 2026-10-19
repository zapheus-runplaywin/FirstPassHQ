import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AWARD_COLUMNS, awardSummary, closesLabel, isClosed } from '@/lib/awards';
import { formatShortDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Award, AwardResult, AwardTurnout } from '@/lib/types';
import { seasonLabel, teamLabel, useTeams } from '@/lib/use-teams';

type UpcomingGame = {
  team_id: string;
  opponent: string;
  round_name: string | null;
  starts_at: string;
};

/** One award for admins: its settings, standings and who has voted. */
export default function AdminAwardScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teams = useTeams();
  const [award, setAward] = useState<Award | null>(null);
  const [results, setResults] = useState<AwardResult[]>([]);
  const [turnout, setTurnout] = useState<AwardTurnout[]>([]);
  // Each group's linked PlayHQ games still to come, soonest first.
  const [upcoming, setUpcoming] = useState<UpcomingGame[]>([]);
  // Possible nominees with no date of birth, for an award with an age limit.
  const [missingBirthdays, setMissingBirthdays] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [a, r, t] = await Promise.all([
      supabase.from('awards').select(AWARD_COLUMNS).eq('id', id).single(),
      supabase.rpc('award_results', { p_award_id: id }),
      supabase.rpc('award_turnout', { p_award_id: id }),
    ]);
    setAward(a.data as Award | null);
    setResults((r.data as AwardResult[] | null) ?? []);
    setTurnout((t.data as AwardTurnout[] | null) ?? []);
    const loaded = a.data as Award | null;
    if ((loaded?.nominee_max_age || loaded?.nominee_min_age) && loaded.nominees !== 'listed') {
      const { data } = await supabase.rpc('admin_award_missing_birthdays', {
        p_award_id: loaded.id,
      });
      setMissingBirthdays((data as number | null) ?? 0);
    } else {
      setMissingBirthdays(0);
    }
    if (loaded?.by_match) {
      const { data } = await supabase
        .from('fixtures')
        .select('team_id, opponent, round_name, starts_at')
        .in(
          'team_id',
          loaded.award_groups.map((g) => g.team_id),
        )
        .not('opponent', 'is', null)
        .gte('starts_at', new Date().toISOString())
        .order('starts_at');
      setUpcoming((data as UpcomingGame[] | null) ?? []);
    }
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
          {weighted && award.preseason_closes_at
            ? ` · Preseason vote ${closesLabel(award.preseason_closes_at).replace(/^C/, 'c')}`
            : ''}
        </ThemedText>
        {award.nominees === 'listed' ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nominees: {award.award_candidates.map((c) => c.name).join(', ')}
          </ThemedText>
        ) : null}
        {missingBirthdays > 0 ? (
          <ThemedText type="small" themeColor="accent">
            {missingBirthdays} possible {missingBirthdays === 1 ? 'nominee has' : 'nominees have'}{' '}
            no date of birth, so they can’t be voted for. Add it on their page in Members.
          </ThemedText>
        ) : null}
      </Card>

      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button
            title="Edit award"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/admin/awards/edit', params: { id: award.id } })
            }
          />
        </View>
        <View style={styles.flex}>
          <Button
            title="Duplicate"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/admin/awards/edit', params: { from: award.id } })
            }
          />
        </View>
      </View>

      {isClosed(award.closes_at) ? (
        <Button
          title="Full results report"
          onPress={() =>
            router.push({ pathname: '/admin/reports/award', params: { id: award.id } })
          }
        />
      ) : null}

      {groups.map((group) => {
        const standings = results.filter((r) => r.team_id === group.id);
        const rounds = turnout.filter((t) => t.team_id === group.id);
        const next = upcoming.find((g) => g.team_id === group.id);
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
            ) : null}
            {award.by_match ? (
              next ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Next match: {next.round_name ?? 'Match'} v {next.opponent} ·{' '}
                  {formatShortDay(new Date(next.starts_at))}. Its vote opens when it starts.
                </ThemedText>
              ) : rounds.some((t) => t.fixture_id) ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No more matches from PlayHQ.
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="accent">
                  No PlayHQ games are linked to {group.name ?? 'this group'}, so no match votes will
                  open. Link it under Fixtures.
                </ThemedText>
              )
            ) : null}
          </View>
        );
      })}

      <ThemedText type="small" themeColor="textSecondary">
        Only admins see results. Nobody, admins included, can see who voted for whom.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  buttons: {
    flexDirection: 'row',
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
