import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { CardGrid } from '@/components/columns';
import { Screen } from '@/components/screen';
import { SelectionAuditReport } from '@/components/selection-audit-report';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { auditAthleteLine, personHistoryLine, roundTitle, shortRange, type AuditRound } from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

/**
 * A round for its auditor, in three tabs: its athletes, the audit report,
 * and who is on the panel and auditing. Nothing here changes anything.
 */
export default function AuditRoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [round, setRound] = useState<AuditRound | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'athletes' | 'report' | 'panel'>('athletes');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('auditor_selection_round', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setRound(data as AuditRound);
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

  if (!round) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="subtitle">{roundTitle(round)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {[round.team_name, shortRange(round), round.criteria_set_name].filter(Boolean).join(' · ')}
        {round.closed ? ' · closed' : ''}
      </ThemedText>
      <ThemedText type="smallBold">You are auditing this round. You can read everything and change nothing.</ThemedText>
      <ChipGroup
        options={[
          { value: 'athletes' as const, label: `Athletes (${round.athletes.length})` },
          { value: 'report' as const, label: 'Report' },
          { value: 'panel' as const, label: 'Panel' },
        ]}
        selected={[tab]}
        onToggle={setTab}
      />
      <ErrorText>{error}</ErrorText>

      {tab === 'athletes' ? (
        <>
          {round.athletes.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              There are no athletes in {round.team_name} for you to check.
            </ThemedText>
          ) : (
            <CardGrid gap={Spacing.four}>
              {round.athletes.map((athlete) => (
                <PressableCard
                  key={athlete.id}
                  onPress={() => router.push({ pathname: '/audits/athlete', params: { round: round.id, athlete: athlete.id } })}>
                  <ThemedText type="smallBold">{athlete.name ?? 'Athlete'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {auditAthleteLine(athlete)}
                  </ThemedText>
                  {athlete.feedback === 'shared' ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Feedback shared
                    </ThemedText>
                  ) : null}
                </PressableCard>
              ))}
            </CardGrid>
          )}
          {round.hidden > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {round.hidden === 1 ? '1 athlete isn’t' : `${round.hidden} athletes aren’t`} listed because you are
              their parent or guardian.
            </ThemedText>
          ) : null}
        </>
      ) : null}

      {tab === 'report' ? <SelectionAuditReport roundId={round.id} /> : null}

      {tab === 'panel' ? (
        <>
          <ThemedText type="smallBold">Panel</ThemedText>
          {round.panel.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nobody is on the panel.
            </ThemedText>
          ) : (
            round.panel.map((person) => (
              <ThemedText key={`${person.name}-${person.added_at}`} type="small">
                {personHistoryLine(person)}
              </ThemedText>
            ))
          )}
          <ThemedText type="smallBold">Auditors</ThemedText>
          {round.auditors.map((person) => (
            <ThemedText key={`${person.name}-${person.added_at}`} type="small">
              {personHistoryLine(person)}
            </ThemedText>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
