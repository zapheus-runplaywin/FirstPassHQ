import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { percent } from '@/lib/attendance';
import { formatDateTime } from '@/lib/format';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { AthleteAttendance } from '@/lib/types';

const ABSENT = '#FF8A8A';

export default function AthleteAttendanceScreen() {
  const theme = useTheme();
  const {
    id,
    name,
    days = '91',
  } = useLocalSearchParams<{
    id: string;
    name?: string;
    days?: string;
  }>();
  const [sessions, setSessions] = useState<AthleteAttendance[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - Number(days));
    const { data } = await supabase.rpc('athlete_attendance', {
      p_profile_id: id,
      p_since: toDateString(since),
    });
    setSessions((data as AthleteAttendance[] | null) ?? []);
  }, [id, days]);

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

  if (sessions === null) return null;
  const present = sessions.filter((s) => s.present).length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <ThemedText type="subtitle">{name || 'Athlete'}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {sessions.length === 0
            ? 'No sessions in this period'
            : `At ${present} of ${sessions.length} sessions · ${percent(present, sessions.length)}`}
        </ThemedText>
      </View>
      <View style={styles.list}>
        {sessions.map((s) => (
          <PressableCard
            key={s.session_id}
            onPress={() =>
              router.push({ pathname: '/attendance/[id]', params: { id: s.session_id } })
            }>
            <View style={styles.row}>
              <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
                {s.name}
              </ThemedText>
              <ThemedText type="small" style={{ color: s.present ? theme.positive : ABSENT }}>
                {s.present ? 'Present' : 'Absent'}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {s.team_name} · {formatDateTime(new Date(s.held_at))}
            </ThemedText>
          </PressableCard>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
});
