import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ErrorText, PressableCard } from '@/components/ui';
import { athleteLine, roundDates, type RoundSheet } from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

/**
 * A round's athletes for a panel member: how much has been written about
 * each, and who has nothing yet or nothing lately. Tapping one opens their
 * assessment.
 */
export default function RoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sheet, setSheet] = useState<RoundSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('selection_round_sheet', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setSheet(data as RoundSheet);
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

  if (!sheet) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const groups = sheet.criteria.groups.length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="subtitle">{sheet.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {sheet.team_name} · {roundDates(sheet)}
        {sheet.closed ? ' · closed, so nothing more can be added' : ''}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {sheet.athletes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There are no athletes in {sheet.team_name} for you to assess.
        </ThemedText>
      ) : (
        sheet.athletes.map((athlete) => {
          const line = athleteLine(athlete, groups, sheet.today, sheet.closed);
          return (
            <PressableCard
              key={athlete.id}
              onPress={() =>
                router.push({ pathname: '/assessments/athlete', params: { round: sheet.id, athlete: athlete.id } })
              }>
              <ThemedText type="smallBold">{athlete.name ?? 'Athlete'}</ThemedText>
              <ThemedText type={line.nudge ? 'smallBold' : 'small'} themeColor={line.nudge ? 'text' : 'textSecondary'}>
                {line.text}
              </ThemedText>
            </PressableCard>
          );
        })
      )}
      {sheet.hidden > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {sheet.hidden === 1 ? '1 athlete isn’t' : `${sheet.hidden} athletes aren’t`} listed because
          you are their parent or guardian. The rest of the panel assesses them.
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        There is no score or ranking. The counts show where the evidence is thin, so nobody is
        judged on one session.
      </ThemedText>
    </Screen>
  );
}
