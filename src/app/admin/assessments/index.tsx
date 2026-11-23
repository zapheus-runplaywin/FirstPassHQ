import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, PressableCard } from '@/components/ui';
import {
  adminRoundLine,
  criteriaSummary,
  roundDates,
  type AdminRound,
  type Criteria,
} from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

/**
 * Administration > Selection assessments: the club's criteria and its
 * selection rounds. Admins set these up and read the audit report; they
 * never see an assessment.
 */
export default function AdminAssessmentsScreen() {
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [rounds, setRounds] = useState<AdminRound[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [{ data: saved, error: criteriaError }, { data: list, error: roundsError }] = await Promise.all([
      supabase.rpc('admin_assessment_criteria'),
      supabase.rpc('admin_selection_rounds'),
    ]);
    setError(criteriaError?.message ?? roundsError?.message ?? null);
    setCriteria((saved as Criteria | null) ?? { groups: [] });
    setRounds((list as AdminRound[] | null) ?? []);
  }, []);

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

  if (!criteria) return <Screen>{null}</Screen>;

  const ready = criteria.groups.length > 0;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Selectors add short observations about each athlete over a selection round, against the
        club’s criteria. Only a round’s panel reads them. You set up the criteria, the rounds and
        their panels, and build an audit report that shows how the work was done, not what was
        said.
      </ThemedText>
      <ErrorText>{error}</ErrorText>

      <PressableCard onPress={() => router.push('/admin/assessments/criteria')}>
        <ThemedText type="smallBold">Assessment criteria</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {criteriaSummary(criteria)}
        </ThemedText>
      </PressableCard>

      <ThemedText type="subtitle">Selection rounds</ThemedText>
      {rounds.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {ready
            ? 'No rounds yet. Open one for a squad or team when its selection phase starts.'
            : 'Set up the assessment criteria first. A round takes its own copy of them when it opens.'}
        </ThemedText>
      ) : (
        rounds.map((round) => (
          <PressableCard
            key={round.id}
            onPress={() => router.push({ pathname: '/admin/assessments/round', params: { id: round.id } })}>
            <ThemedText type="smallBold">
              {round.name}
              {round.closed_at ? ' (closed)' : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {round.team_name} · {roundDates(round)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {adminRoundLine(round)}
            </ThemedText>
          </PressableCard>
        ))
      )}
      {ready ? (
        <Button title="Open a selection round" onPress={() => router.push('/admin/assessments/round')} />
      ) : null}
    </Screen>
  );
}
