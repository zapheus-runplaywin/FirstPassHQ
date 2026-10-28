import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LoadCaveat, WhyThisFlag } from '@/components/load-monitoring';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatShortDay } from '@/lib/format';
import { parseDateString } from '@/lib/injuries';
import { FLAG_WORDS, sourcesFor, type CoachLoadRow } from '@/lib/load-monitoring';
import { supabase } from '@/lib/supabase';

/**
 * A coach's training load prompts: their athletes with a flag this week, and
 * those they've talked with in the last 7 days. Tapping one opens the
 * athlete's check-ins, where the coach marks "Talked with them".
 */
export default function TrainingLoadScreen() {
  const [rows, setRows] = useState<CoachLoadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('coach_load_flags');
    if (loadError) {
      setError(loadError.message);
      setRows(null);
      return;
    }
    setError(null);
    setRows((data as CoachLoadRow[] | null) ?? []);
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

  const open = (rows ?? []).filter((r) => !r.reviewed_on);
  const talked = (rows ?? []).filter((r) => r.reviewed_on);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Athletes whose logged training this week may be worth a chat, from the sessions they log
        under their check-in. Athletes under 18 show once a parent or guardian gives consent.
      </ThemedText>
      {error ? (
        <ThemedText type="small" themeColor="textSecondary">
          {error}.
        </ThemedText>
      ) : null}
      {rows && rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No training load flags this week.
        </ThemedText>
      ) : null}
      {open.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Worth a chat</ThemedText>
          {open.map((r) => (
            <AthleteRow key={r.athlete_id} row={r} />
          ))}
        </View>
      ) : null}
      {talked.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Talked with this week</ThemedText>
          {talked.map((r) => (
            <AthleteRow key={r.athlete_id} row={r} />
          ))}
        </View>
      ) : null}
      <WhyThisFlag
        sources={sourcesFor(['ratio', 'hours', 'wellbeing'])}
        label="Where these flags come from"
      />
      <LoadCaveat />
    </Screen>
  );
}

function AthleteRow({ row }: { row: CoachLoadRow }) {
  return (
    <PressableCard
      onPress={() =>
        router.push({
          pathname: '/check-ins/athlete/[id]',
          params: { id: row.athlete_id, name: row.athlete_name },
        })
      }>
      <ThemedText type="smallBold">{row.athlete_name}</ThemedText>
      {row.flags.map((f) => (
        <ThemedText key={f} type="small">
          {FLAG_WORDS[f].coach}
        </ThemedText>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        {row.sessions_7d} {row.sessions_7d === 1 ? 'session' : 'sessions'} · {row.minutes_7d} min in
        the last 7 days
        {row.ratio === null ? '' : ` · ratio ${Number(row.ratio).toFixed(2)}`}
        {row.reviewed_on
          ? ` · ${row.reviewer_name} talked with them ${formatShortDay(parseDateString(row.reviewed_on))}`
          : ''}
      </ThemedText>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
