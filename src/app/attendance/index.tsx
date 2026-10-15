import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { absenceDays, absenceWhy, type UpcomingAbsence } from '@/lib/absences';
import {
  percent,
  presentLabel,
  useCanTakeAttendance,
  useCanViewAttendance,
} from '@/lib/attendance';
import { formatSentAt } from '@/lib/format';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { AthleteAttendanceSummary, AttendanceSession } from '@/lib/types';

type Tab = 'sessions' | 'athletes';

/** How far back the athlete summary looks, in days. */
const periods = [
  { value: '28', label: '4 weeks' },
  { value: '91', label: '3 months' },
  { value: '365', label: '12 months' },
];

export default function AttendanceScreen() {
  const canTake = useCanTakeAttendance();
  const canView = useCanViewAttendance();
  const [tab, setTab] = useState<Tab>('sessions');
  const [days, setDays] = useState('91');
  const [sessions, setSessions] = useState<AttendanceSession[] | null>(null);
  const [athletes, setAthletes] = useState<AthleteAttendanceSummary[] | null>(null);
  const [away, setAway] = useState<UpcomingAbsence[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - Number(days));
    const [sessionsResult, awayResult, athletesResult] = await Promise.all([
      supabase.rpc('attendance_sessions_list'),
      supabase.rpc('upcoming_absences'),
      canView
        ? supabase.rpc('athlete_attendance_summary', { p_since: toDateString(since) })
        : Promise.resolve({ data: [] }),
    ]);
    setSessions((sessionsResult.data as AttendanceSession[] | null) ?? []);
    setAthletes((athletesResult.data as AthleteAttendanceSummary[] | null) ?? []);
    setAway((awayResult.data as UpcomingAbsence[] | null) ?? []);
  }, [canView, days]);

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
      {canTake ? (
        <Button title="Take attendance" onPress={() => router.push('/attendance/new')} />
      ) : null}

      {away.length > 0 ? <AwaySoon away={away} /> : null}

      {canView ? (
        <ChipGroup
          options={[
            { value: 'sessions', label: 'Sessions' },
            { value: 'athletes', label: 'Athletes' },
          ]}
          selected={[tab]}
          onToggle={setTab}
        />
      ) : null}

      {tab === 'sessions' ? (
        <Sessions sessions={sessions} />
      ) : (
        <>
          <ChipGroup options={periods} selected={[days]} onToggle={setDays} />
          <Athletes athletes={athletes} days={days} />
        </>
      )}
    </Screen>
  );
}

/** Athletes reported away in the next 4 weeks. */
function AwaySoon({ away }: { away: UpcomingAbsence[] }) {
  return (
    <View style={styles.list}>
      <ThemedText type="smallBold">Away in the next 4 weeks</ThemedText>
      <Card>
        {away.map((a) => (
          <View key={a.id} style={styles.away}>
            <ThemedText type="smallBold">{a.athlete_name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {absenceDays(a)}
              {absenceWhy(a) ? ` · ${absenceWhy(a)}` : ''}
              {a.reported_by_name ? ` · told by ${a.reported_by_name}` : ''}
            </ThemedText>
          </View>
        ))}
      </Card>
    </View>
  );
}

function Sessions({ sessions }: { sessions: AttendanceSession[] | null }) {
  if (sessions === null) return null;
  if (sessions.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No attendance has been taken yet.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      {sessions.map((s) => (
        <PressableCard
          key={s.id}
          onPress={() => router.push({ pathname: '/attendance/[id]', params: { id: s.id } })}>
          <View style={styles.row}>
            <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
              {s.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSentAt(new Date(s.held_at))}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {s.team_name}
            {s.taken_by_name ? ` · ${s.taken_by_name}` : ''}
          </ThemedText>
          <ThemedText type="small">{presentLabel(s.present_count, s.marked_count)}</ThemedText>
        </PressableCard>
      ))}
    </View>
  );
}

function Athletes({
  athletes,
  days,
}: {
  athletes: AthleteAttendanceSummary[] | null;
  days: string;
}) {
  const theme = useTheme();
  if (athletes === null) return null;
  if (athletes.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No attendance has been taken in this period.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      {athletes.map((a) => (
        <PressableCard
          key={a.profile_id}
          onPress={() =>
            router.push({
              pathname: '/attendance/athlete/[id]',
              params: { id: a.profile_id, name: a.full_name ?? '', days },
            })
          }>
          <View style={styles.row}>
            <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
              {a.full_name ?? 'Unnamed athlete'}
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {percent(a.present_count, a.session_count)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            At {a.present_count} of {a.session_count} sessions
            {a.last_present_at ? ` · Last there ${formatSentAt(new Date(a.last_present_at))}` : ''}
          </ThemedText>
        </PressableCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
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
  away: {
    gap: Spacing.half,
    paddingVertical: Spacing.one,
  },
});
