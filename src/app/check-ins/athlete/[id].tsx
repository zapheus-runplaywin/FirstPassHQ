import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { CheckInHistory } from '@/components/check-in-history';
import { AthleteLoadPanel } from '@/components/load-monitoring';
import { SessionLogList, WeeklyLoad } from '@/components/session-log';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { CHECK_IN_COLUMNS } from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import { logRecordView } from '@/lib/record-access';
import { supabase } from '@/lib/supabase';
import { SESSION_LOG_COLUMNS } from '@/lib/session-logs';
import type { CheckIn, SessionLog } from '@/lib/types';

/** How many days of an athlete's check-ins a coach sees. */
const HISTORY_DAYS = 28;
/** Sessions read for the load numbers and the adults' fitness chart. */
const LOAD_DAYS = 126;

/** The sessions in the last four weeks, for the list. */
function recent(logs: SessionLog[]) {
  const since = new Date();
  since.setDate(since.getDate() - HISTORY_DAYS);
  return logs.filter((l) => l.day >= toDateString(since));
}

export default function AthleteCheckInsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [checkIns, setCheckIns] = useState<CheckIn[] | null>(null);
  const [sessions, setSessions] = useState<SessionLog[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - HISTORY_DAYS);
    const loadSince = new Date();
    loadSince.setDate(loadSince.getDate() - LOAD_DAYS);
    const [checkInsResult, sessionsResult] = await Promise.all([
      supabase
        .from('check_ins')
        .select(CHECK_IN_COLUMNS)
        .eq('athlete_id', id)
        .gte('day', toDateString(since))
        .order('day', { ascending: false }),
      supabase
        .from('session_logs')
        .select(SESSION_LOG_COLUMNS)
        .eq('athlete_id', id)
        .gte('day', toDateString(loadSince))
        .order('day', { ascending: false })
        .order('updated_at', { ascending: false }),
    ]);
    setCheckIns((checkInsResult.data as CheckIn[] | null) ?? []);
    setSessions((sessionsResult.data as SessionLog[] | null) ?? []);
    logRecordView(id, 'check_ins');
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

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {name ? <Stack.Screen options={{ title: name }} /> : null}
      <ThemedText type="small" themeColor="textSecondary">
        The last four weeks. Scores are 1 (bad) to 5 (good).
      </ThemedText>
      {checkIns ? <CheckInHistory checkIns={checkIns} /> : null}
      <ThemedText type="smallBold">Training sessions</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Each session the athlete logged: minutes and how hard it felt, 1 (very easy) to 10
        (maximal). Load is minutes times effort.
      </ThemedText>
      {sessions ? (
        <>
          <WeeklyLoad logs={sessions} />
          <SessionLogList logs={recent(sessions)} />
          <AthleteLoadPanel athleteId={id} name={name ?? ''} logs={sessions} />
        </>
      ) : null}
    </Screen>
  );
}
