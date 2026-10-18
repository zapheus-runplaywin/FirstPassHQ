import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Absence, absenceDays, absenceOn, absenceWhy } from '@/lib/absences';
import { percent } from '@/lib/attendance';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { AthleteAttendance } from '@/lib/types';

const ABSENT = '#FF8A8A';

const periods = [
  { value: '28', label: '4 weeks' },
  { value: '91', label: '3 months' },
  { value: '365', label: '12 months' },
];

/**
 * An athlete's own attendance and reported absences, for the athlete and
 * their parents or guardians. Other athletes on the register aren't shown.
 */
export default function FamilyAttendanceScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [days, setDays] = useState('91');
  const [sessions, setSessions] = useState<AthleteAttendance[] | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // The athlete or their parent or guardian, who report and withdraw absences
  // (the database's own rule). Anyone else the database shows the sessions
  // to sees them read-only.
  const [family, setFamily] = useState(false);
  const self = id === session?.user.id;
  const today = toDateString(new Date());

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - Number(days));
    const [attendance, reported, familyResult] = await Promise.all([
      supabase.rpc('athlete_attendance', { p_profile_id: id, p_since: toDateString(since) }),
      supabase.rpc('my_absences', { p_athlete_id: id }),
      supabase.rpc('is_athlete_or_guardian', { p_athlete_id: id }),
    ]);
    setFamily(familyResult.data === true);
    setSessions((attendance.data as AthleteAttendance[] | null) ?? []);
    setAbsences((reported.data as Absence[] | null) ?? []);
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

  async function withdraw(absenceId: string) {
    await supabase.rpc('withdraw_absence', { p_absence_id: absenceId });
    await load();
  }

  if (sessions === null) return null;
  const present = sessions.filter((s) => s.present).length;
  const active = absences.filter((a) => !a.withdrawn_at);
  const upcoming = active.filter((a) => a.to_day >= today);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <ThemedText type="subtitle">{self ? 'My attendance' : name || 'Attendance'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {!family
            ? `Whether ${name || 'they'} was marked present or absent at each session.`
            : self
              ? 'Whether your coaches marked you present or absent at each session. Your parents or guardians see this too.'
              : `Whether ${name || 'they'} was marked present or absent at each session. ${
                  name || 'They'
                } and their other parents or guardians see this too.`}
        </ThemedText>
      </View>

      {family ? (
        <>
          <Button
            title="Report an absence"
            onPress={() =>
              router.push({ pathname: '/attendance/absence', params: { id, name: name ?? '' } })
            }
          />

          <View style={styles.list}>
            <ThemedText type="smallBold">Reported absences</ThemedText>
            {upcoming.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                None coming up.
              </ThemedText>
            ) : (
              upcoming.map((a) => (
                <Card key={a.id}>
                  <ThemedText type="smallBold">{absenceDays(a)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {absenceWhy(a) ? `${absenceWhy(a)} · ` : ''}Reported by {a.reported_by_name ?? 'a member'}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => withdraw(a.id)}
                    hitSlop={8}
                    style={styles.withdraw}>
                    <ThemedText type="smallBold" style={{ color: theme.tint }}>
                      Withdraw
                    </ThemedText>
                  </Pressable>
                </Card>
              ))
            )}
          </View>
        </>
      ) : null}

      <View style={styles.list}>
        <ThemedText type="smallBold">Sessions</ThemedText>
        <ChipGroup options={periods} selected={[days]} onToggle={setDays} />
        <ThemedText themeColor="textSecondary">
          {sessions.length === 0
            ? 'No sessions in this period'
            : `At ${present} of ${sessions.length} sessions · ${percent(present, sessions.length)}`}
        </ThemedText>
        {sessions.map((s) => {
          const reported = !s.present && absenceOn(active, toDateString(new Date(s.held_at)));
          return (
            <Card key={s.session_id}>
              <View style={styles.row}>
                <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
                  {s.name}
                </ThemedText>
                <ThemedText type="small" style={{ color: s.present ? theme.tint : ABSENT }}>
                  {s.present ? 'Present' : reported ? 'Absent, reported' : 'Absent'}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {s.team_name} · {formatDateTime(new Date(s.held_at))}
              </ThemedText>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  list: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  withdraw: { alignSelf: 'flex-start', paddingTop: Spacing.one },
});
