import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { flaggedAreas, scoresLine, today, useCheckInSummary } from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { CheckInBoardRow, CheckInScores } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

const days = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
];

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toDateString(date);
}

export default function CheckInsScreen() {
  const theme = useTheme();
  const { isAdmin } = useAuth();
  const teams = useTeams();
  const { checkInSummary, reloadCheckInSummary } = useCheckInSummary();
  // The groups the member coaches come first; admins can open any group.
  const coached = checkInSummary.map((s) => ({ value: s.team_id, label: s.team_name }));
  const others = isAdmin
    ? teams
        .filter((t) => !checkInSummary.some((s) => s.team_id === t.id))
        .map((t) => ({ value: t.id, label: t.name }))
    : [];
  const [choice, setChoice] = useState<string | null>(null);
  const [day, setDay] = useState('today');
  const [board, setBoard] = useState<CheckInBoardRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selected = choice ?? coached[0]?.value ?? null;
  const dayString = day === 'today' ? today() : yesterday();

  const load = useCallback(async () => {
    if (!selected) return;
    const { data } = await supabase.rpc('check_in_board', {
      p_team_id: selected,
      p_day: dayString,
    });
    setBoard((data as CheckInBoardRow[] | null) ?? []);
  }, [selected, dayString]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), reloadCheckInSummary()]);
    setRefreshing(false);
  }

  const done = (board ?? []).filter((r) => r.checked_in_at !== null);
  const flagged = done.filter((r) => flaggedAreas(r).length > 0);
  const fine = done.filter((r) => flaggedAreas(r).length === 0);
  const missing = (board ?? []).filter((r) => r.checked_in_at === null);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {coached.length > 0 ? (
        <ChipGroup
          label="Your squads and teams"
          options={coached}
          selected={selected ? [selected] : []}
          onToggle={(value) => {
            setChoice(value);
            setBoard(null);
          }}
        />
      ) : null}
      {others.length > 0 ? (
        <ChipGroup
          label={coached.length > 0 ? 'Other squads and teams' : 'Squads and teams'}
          options={others}
          selected={selected ? [selected] : []}
          onToggle={(value) => {
            setChoice(value);
            setBoard(null);
          }}
        />
      ) : null}

      {selected ? (
        <>
          <ChipGroup options={days} selected={[day]} onToggle={setDay} />

          {board === null ? null : board.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              There are no athletes in this group yet.
            </ThemedText>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {done.length} of {board.length} checked in
                {flagged.length > 0 ? ` · ${flagged.length} flagged` : ''}. A score of 2 or less
                flags an athlete.
              </ThemedText>

              {flagged.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    Check in with
                  </ThemedText>
                  {flagged.map((r) => (
                    <AthleteRow key={r.athlete_id} row={r} />
                  ))}
                </View>
              ) : null}

              {fine.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Feeling good</ThemedText>
                  {fine.map((r) => (
                    <AthleteRow key={r.athlete_id} row={r} />
                  ))}
                </View>
              ) : null}

              {missing.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Not checked in</ThemedText>
                  <Card>
                    <ThemedText type="small" themeColor="textSecondary">
                      {missing.map((r) => r.full_name ?? 'Unnamed athlete').join(', ')}
                    </ThemedText>
                  </Card>
                </View>
              ) : null}
            </>
          )}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          You don’t coach a squad or team yet.
        </ThemedText>
      )}
    </Screen>
  );
}

function AthleteRow({ row }: { row: CheckInBoardRow }) {
  const theme = useTheme();
  const flagged = flaggedAreas(row);
  return (
    <PressableCard
      onPress={() =>
        router.push({
          pathname: '/check-ins/athlete/[id]',
          params: { id: row.athlete_id, name: row.full_name ?? '' },
        })
      }>
      <View style={styles.rowHeader}>
        <ThemedText type="smallBold">{row.full_name ?? 'Unnamed athlete'}</ThemedText>
        {flagged.length > 0 ? (
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Low {flagged.join(', ').toLowerCase()}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {scoresLine(row as CheckInScores)}
      </ThemedText>
      {row.note ? <ThemedText type="small">“{row.note}”</ThemedText> : null}
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
