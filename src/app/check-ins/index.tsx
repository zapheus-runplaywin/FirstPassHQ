import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { CheckInTrends } from '@/components/trend-chart';
import { Card, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSquads } from '@/lib/club';
import {
  checkInQuestions,
  flaggedAreas,
  scoresLine,
  today,
  useCanSeeCheckInOverview,
  useCheckInOverview,
  useCheckInSummary,
  useIsCheckInCoach,
} from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type {
  CheckInBoardRow,
  CheckInOverviewRow,
  CheckInScores,
  CheckInTrendDay,
} from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';

const views = [
  { value: 'today', label: 'Day by day' },
  { value: 'trends', label: 'Trends' },
];

const periods = [
  { value: '14', label: '2 weeks' },
  { value: '28', label: '4 weeks' },
  { value: '91', label: '3 months' },
];

/** The whole club, in the trends group chips. */
const CLUB = 'club';

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
  const teams = useTeams();
  const usesSquads = useSquads();
  const isCoach = useIsCheckInCoach();
  const canSeeOverview = useCanSeeCheckInOverview();
  const { checkInSummary, reloadCheckInSummary } = useCheckInSummary();
  const coached = checkInSummary.map((s) => ({ value: s.team_id, label: s.team_name }));
  const [choice, setChoice] = useState<string | null>(null);
  const [day, setDay] = useState('today');
  const [view, setView] = useState('today');
  const [board, setBoard] = useState<CheckInBoardRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selected = choice ?? checkInSummary[0]?.team_id ?? null;
  const dayString = day === 'today' ? today() : yesterday();
  const { checkInOverview, reloadCheckInOverview } = useCheckInOverview(dayString);

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
    await Promise.all([load(), reloadCheckInSummary(), reloadCheckInOverview()]);
    setRefreshing(false);
  }

  const done = (board ?? []).filter((r) => r.checked_in_at !== null);
  const flagged = done.filter((r) => flaggedAreas(r).length > 0);
  const fine = done.filter((r) => flaggedAreas(r).length === 0);
  const missing = (board ?? []).filter((r) => r.checked_in_at === null);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ChipGroup options={views} selected={[view]} onToggle={setView} />
      {view === 'trends' ? (
        <Trends
          groups={[
            ...(canSeeOverview ? [{ value: CLUB, label: 'Whole club' }] : []),
            ...coached,
            ...(checkInOverview ?? [])
              .filter((g) => !coached.some((c) => c.value === g.team_id))
              .map((g) => {
                const team = teams.find((t) => t.id === g.team_id);
                return { value: g.team_id, label: team ? teamLabel(team, teams) : g.team_name };
              }),
          ]}
        />
      ) : (
        <>
          <ChipGroup options={days} selected={[day]} onToggle={setDay} />

          {canSeeOverview ? (
            <View style={styles.section}>
              <ThemedText type="smallBold">Club overview</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {usesSquads
                  ? 'Average scores out of 5 for each squad, then for each team once the squad phase is complete.'
                  : 'Average scores out of 5 for each team.'}{' '}
                Scores show once 3 athletes have checked in, so they can’t point to one person.
              </ThemedText>
              {checkInOverview?.map((g) => {
                const team = teams.find((t) => t.id === g.team_id);
                return (
                  <OverviewRow
                    key={g.team_id}
                    row={g}
                    label={team ? teamLabel(team, teams) : g.team_name}
                  />
                );
              })}
            </View>
          ) : null}

          {isCoach ? (
            coached.length > 0 ? (
              <>
                <ChipGroup
                  label="Your squads and teams"
                  options={coached}
                  selected={selected ? [selected] : []}
                  onToggle={(value) => {
                    setChoice(value);
                    setBoard(null);
                  }}
                />

                {board === null ? null : board.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    There are no athletes in this group yet.
                  </ThemedText>
                ) : (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {done.length} of {board.length} checked in
                      {flagged.length > 0 ? ` · ${flagged.length} flagged` : ''}. A score of 2 or
                      less flags an athlete.
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
                {usesSquads
                  ? 'You don’t coach a squad that’s still in its squad phase, or a team named from one.'
                  : 'You don’t coach a team yet.'}
              </ThemedText>
            )
          ) : null}
        </>
      )}
    </Screen>
  );
}

/** Daily averages over time for one group, or the whole club. */
function Trends({ groups }: { groups: { value: string; label: string }[] }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [period, setPeriod] = useState('28');
  const [trend, setTrend] = useState<CheckInTrendDay[] | null>(null);
  const selected = choice ?? groups[0]?.value ?? null;

  useEffect(() => {
    if (!selected) return;
    let current = true;
    const since = new Date();
    since.setDate(since.getDate() - Number(period) + 1);
    supabase
      .rpc('check_in_trend', {
        p_team_id: selected === CLUB ? null : selected,
        p_since: toDateString(since),
        p_until: today(),
      })
      .then(({ data }) => {
        if (current) setTrend((data as CheckInTrendDay[] | null) ?? []);
      });
    return () => {
      current = false;
    };
  }, [selected, period]);

  if (groups.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        There’s no squad or team to show yet.
      </ThemedText>
    );
  }

  return (
    <>
      <ChipGroup
        options={groups}
        selected={selected ? [selected] : []}
        onToggle={(value) => {
          setChoice(value);
          setTrend(null);
        }}
      />
      <ChipGroup
        options={periods}
        selected={[period]}
        onToggle={(value) => {
          setPeriod(value);
          setTrend(null);
        }}
      />
      {trend ? <CheckInTrends days={trend} /> : null}
    </>
  );
}

/** One squad or team's averages in the committee overview. */
function OverviewRow({ row, label }: { row: CheckInOverviewRow; label: string }) {
  const theme = useTheme();
  const hasScores = row.avg_sleep !== null;
  return (
    <Card>
      <View style={styles.rowHeader}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {row.flagged_count ? (
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {row.flagged_count} flagged
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {row.team_kind === 'squad' ? 'Squad' : 'Team'} · {row.checked_in_count} of{' '}
        {row.athlete_count} checked in
      </ThemedText>
      <ThemedText type="small" themeColor={hasScores ? 'text' : 'textSecondary'}>
        {hasScores
          ? checkInQuestions
              .map((q) => `${q.label} ${Number(row[`avg_${q.key}`]).toFixed(1)}`)
              .join(' · ')
          : 'Scores show once 3 athletes have checked in'}
      </ThemedText>
    </Card>
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
