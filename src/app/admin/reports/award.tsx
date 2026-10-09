import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui';
import { AWARD_COLUMNS, awardSummary, isClosed } from '@/lib/awards';
import { awardReport, type TurnoutRow, type VoteBreakdownRow } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Award, Team } from '@/lib/types';
import { seasonLabel, TEAM_COLUMNS, teamLabel } from '@/lib/use-teams';

type Data = {
  award: Award;
  teams: Team[];
  breakdown: VoteBreakdownRow[];
  turnout: TurnoutRow[];
};

/** An award's full voting results, once it has closed. */
export default function AwardReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [a, b, t] = await Promise.all([
      supabase.from('awards').select(AWARD_COLUMNS).eq('id', id).single(),
      supabase.rpc('award_vote_breakdown', { p_award_id: id }),
      supabase.rpc('award_turnout', { p_award_id: id }),
    ]);
    const award = a.data as Award | null;
    const failed = a.error ?? b.error ?? t.error;
    setError(failed?.message ?? null);
    if (!award) return;
    const { data: teams } = await supabase
      .from('teams')
      .select(TEAM_COLUMNS)
      .in(
        'id',
        award.award_groups.map((g) => g.team_id),
      );
    setData({
      award,
      teams: (teams as Team[] | null) ?? [],
      breakdown: (b.data as VoteBreakdownRow[] | null) ?? [],
      turnout: (t.data as TurnoutRow[] | null) ?? [],
    });
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

  if (!data) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const { award, teams } = data;
  const groupName = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    return team ? teamLabel(team, teams) : 'Removed group';
  };
  const groupNames = award.award_groups.map((g) => groupName(g.team_id));
  const closed = isClosed(award.closes_at);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: award.name }} />
      <ErrorText>{error}</ErrorText>
      {closed ? (
        <ReportView
          report={awardReport({
            award,
            seasonName: seasonLabel(award.season),
            summary: awardSummary(award, groupNames),
            groups: award.per_group
              ? award.award_groups.map((g) => ({ id: g.team_id, name: groupName(g.team_id) }))
              : [{ id: null, name: 'Club' }],
            breakdown: data.breakdown,
            turnout: data.turnout,
          })}
        />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Full results show once voting has closed.
        </ThemedText>
      )}
    </Screen>
  );
}
