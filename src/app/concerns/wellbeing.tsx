import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import {
  groupWellbeingFlags,
  REPEAT_FLAGS,
  WELLBEING_FLAG_DAYS,
  type FlaggedAthlete,
  type WellbeingFlag,
} from '@/lib/wellbeing-flags';

/**
 * Every athlete's check-in flags for the Child Safety Officer: the day and the
 * lowest score, never the answers or the note. Includes athletes who weren't
 * selected, who no coach sees once selections are done.
 */
export default function WellbeingFlagsScreen() {
  const [athletes, setAthletes] = useState<FlaggedAthlete[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('wellbeing_flags', {
      p_days: WELLBEING_FLAG_DAYS,
    });
    if (loadError) {
      setError(loadError.message);
      setAthletes(null);
      return;
    }
    setError(null);
    setAthletes(groupWellbeingFlags((data as WellbeingFlag[] | null) ?? []));
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

  if (error) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <ThemedText type="small" themeColor="textSecondary">
          {error}.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Athletes who scored 2 or less on a daily check-in in the last {WELLBEING_FLAG_DAYS} days,
        including those not selected, who no coach sees. You see the day and the lowest score only,
        never their answers or notes. An under 18 shows once a parent has given consent for
        check-ins, and each time you open this page it goes in their record access log. Anyone
        flagged on {REPEAT_FLAGS} days in 7 is on your to-do list.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Scores are 1 (bad) to 5 (good). If you’re worried, talk to them or their parent, or record
        a concern. Child abuse and serious crimes go to Police straight away.
      </ThemedText>
      <Button title="Raise a concern" variant="secondary" onPress={() => router.push('/concern/new')} />
      {athletes === null ? null : athletes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody has been flagged in the last {WELLBEING_FLAG_DAYS} days.
        </ThemedText>
      ) : (
        athletes.map((a) => (
          <Card key={a.id} style={styles.card}>
            <ThemedText type="smallBold">{a.name}</ThemedText>
            <ThemedText type="small" themeColor={a.repeated ? 'tint' : 'textSecondary'}>
              {a.inLast7Days === 0
                ? 'Not flagged in the last 7 days'
                : `Flagged on ${a.inLast7Days} ${a.inLast7Days === 1 ? 'day' : 'days'} in the last 7`}
            </ThemedText>
            <View style={styles.days}>
              {a.days.map((d) => (
                <ThemedText key={d.day} type="small">
                  {formatDateString(d.day)} · lowest score {d.lowestScore}
                </ThemedText>
              ))}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  days: { gap: Spacing.half },
});
