import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonthDateField } from '@/components/month-date-field';
import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { clubToday } from '@/lib/club-time';
import { formatDateString, toDateString } from '@/lib/injuries';
import { fetchAll, sessionPlanReport, type SessionPlanReportRow } from '@/lib/reports';
import { formatDate } from '@/lib/age';
import { supabase } from '@/lib/supabase';
import { currentSeason } from '@/lib/training';
import { teamLabel, teamsIn, topGroups, useTeams } from '@/lib/use-teams';

type Period = '4w' | '3m' | 'season' | 'custom';

const periodOptions: { value: Period; label: string }[] = [
  { value: '4w', label: 'Last 4 weeks' },
  { value: '3m', label: 'Last 3 months' },
  { value: 'season', label: 'This season' },
  { value: 'custom', label: 'Choose dates' },
];

const ALL = 'all';

/**
 * For admins: which squads and teams have a session plan for which days, and
 * who added it, for a period. Saves as a PDF.
 */
export default function SessionPlanReportScreen() {
  const teams = useTeams();
  const today = clubToday();
  const [period, setPeriod] = useState<Period>('3m');
  const [customFrom, setCustomFrom] = useState(() => monthsAgo(3));
  const [customTo, setCustomTo] = useState(today);
  const [selected, setSelected] = useState<string[]>([ALL]);
  const [rows, setRows] = useState<SessionPlanReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const seasonStart = `${currentSeason(teams.map((t) => t.season))}-05-01`;
  const [from, to] =
    period === '4w'
      ? [daysAgo(28), today]
      : period === '3m'
        ? [monthsAgo(3), today]
        : period === 'season'
          ? [seasonStart, today]
          : customFrom <= customTo
            ? [customFrom, customTo]
            : [customTo, customFrom];

  const load = useCallback(async () => {
    try {
      setRows(
        await fetchAll<SessionPlanReportRow>((start, stop) =>
          supabase.rpc('session_plan_report', { p_from: from, p_to: to }).range(start, stop),
        ),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The report didn’t load. Try again.');
    }
  }, [from, to]);

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

  // Squads (or teams, without squads) with their teams under them.
  const groups = topGroups(teams).flatMap((g) => [g, ...teamsIn(teams, g.id)]);
  const groupOptions = [
    { value: ALL, label: 'All' },
    ...groups.map((g) => ({ value: g.id, label: teamLabel(g, teams) })),
  ];

  function toggle(value: string) {
    if (value === ALL) {
      setSelected([ALL]);
      return;
    }
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected.filter((v) => v !== ALL), value];
    setSelected(next.length ? next : [ALL]);
  }

  // A squad includes the plans of the teams named from it.
  const all = selected.includes(ALL);
  const chosen = all
    ? groups
    : groups.filter(
        (g) => selected.includes(g.id) || (!!g.squad_id && selected.includes(g.squad_id)),
      );
  const chosenIds = new Set(chosen.map((g) => g.id));
  const shown = rows?.filter((r) => all || (!!r.team_id && chosenIds.has(r.team_id))) ?? [];
  const groupsLabel = all
    ? 'All squads and teams'
    : groupOptions
        .filter((o) => selected.includes(o.value))
        .map((o) => o.label)
        .join(', ');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ChipGroup
        label="Period"
        options={periodOptions}
        selected={[period]}
        onToggle={(value) => setPeriod(value)}
      />
      {period === 'custom' ? (
        <>
          <MonthDateField label="From" value={customFrom} onChange={setCustomFrom} />
          <MonthDateField label="To" value={customTo} onChange={setCustomTo} />
        </>
      ) : null}
      <ChipGroup
        label="Squads and teams"
        options={groupOptions}
        selected={selected}
        onToggle={toggle}
      />
      <ErrorText>{error}</ErrorText>
      {rows ? (
        <>
          <ReportView
            report={sessionPlanReport(
              `${formatDateString(from)} to ${formatDateString(to)}`,
              groupsLabel,
              shown,
              chosen.map((g) => ({ id: g.id, name: teamLabel(g, teams) })),
            )}
          />
          {shown.length > 0 ? (
            <View style={styles.list}>
              <ThemedText type="smallBold">Open a plan</ThemedText>
              {[...shown].reverse().map((r) => (
                <PressableCard
                  key={r.id}
                  onPress={() =>
                    router.push({ pathname: '/session-plans/[id]', params: { id: r.id } })
                  }>
                  <ThemedText type="small" numberOfLines={1}>
                    {formatDate(r.session_on)} · {r.team_name} · {r.title}
                  </ThemedText>
                </PressableCard>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateString(date);
}

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return toDateString(date);
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
});
