import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { MonthDateField } from '@/components/month-date-field';
import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ChipGroup, ErrorText } from '@/components/ui';
import { formatDateString, parseDateString, toDateString } from '@/lib/injuries';
import {
  type AbsenceReportRow,
  attendanceReport,
  chunk,
  fetchAll,
  type AttendanceMarkRow,
  type AttendanceSessionRow,
} from '@/lib/reports';
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
const CLUB = 'club';

type Data = {
  absences: AbsenceReportRow[];
  sessions: AttendanceSessionRow[];
  marks: AttendanceMarkRow[];
  names: Map<string, string>;
};

/** Attendance for a period and chosen squads and teams, for admins. */
export default function AttendanceReportScreen() {
  const teams = useTeams();
  const today = toDateString(new Date());
  const [period, setPeriod] = useState<Period>('4w');
  const [customFrom, setCustomFrom] = useState(() => daysAgo(28));
  const [customTo, setCustomTo] = useState(today);
  const [selected, setSelected] = useState<string[]>([ALL]);
  const [data, setData] = useState<Data | null>(null);
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
      const end = parseDateString(to);
      end.setDate(end.getDate() + 1);
      const sessions = await fetchAll<AttendanceSessionRow>((start, stop) =>
        supabase
          .from('attendance_sessions')
          .select('id, club_wide, team_id, team_name, name, held_at, taken_by_name')
          .gte('held_at', parseDateString(from).toISOString())
          .lt('held_at', end.toISOString())
          .order('held_at')
          .range(start, stop),
      );
      const marks = (
        await Promise.all(
          chunk(sessions.map((s) => s.id)).map((ids) =>
            fetchAll<AttendanceMarkRow>((start, stop) =>
              supabase
                .from('attendance_marks')
                .select('session_id, profile_id, present')
                .in('session_id', ids)
                .range(start, stop),
            ),
          ),
        )
      ).flat();
      const absences = await fetchAll<AbsenceReportRow>((start, stop) =>
        supabase.rpc('absence_report', { p_from: from, p_to: to }).range(start, stop),
      );
      const people = (
        await Promise.all(
          chunk([...new Set(marks.map((m) => m.profile_id))]).map(async (ids) => {
            const { data: rows, error: namesError } = await supabase
              .from('profiles')
              .select('id, full_name, email')
              .in('id', ids);
            if (namesError) throw new Error(namesError.message);
            return (rows as { id: string; full_name: string | null; email: string | null }[]) ?? [];
          }),
        )
      ).flat();
      setData({
        absences,
        sessions,
        marks,
        names: new Map(people.map((p) => [p.id, p.full_name || p.email || 'Unnamed member'])),
      });
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
    { value: CLUB, label: 'Whole club events' },
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

  // A squad includes the sessions of the teams named from it.
  const all = selected.includes(ALL);
  const teamIds = new Set(
    selected.flatMap((id) => [id, ...teamsIn(teams, id).map((t) => t.id)]),
  );
  const sessions =
    data?.sessions.filter((s) =>
      all ? true : s.club_wide ? selected.includes(CLUB) : !!s.team_id && teamIds.has(s.team_id),
    ) ?? [];
  const sessionIds = new Set(sessions.map((s) => s.id));
  const marks = data?.marks.filter((m) => sessionIds.has(m.session_id)) ?? [];
  // For chosen groups, the absences of the athletes on their registers.
  const marked = new Set(marks.map((m) => m.profile_id));
  const absences = data?.absences.filter((a) => all || marked.has(a.athlete_id)) ?? [];
  const groupsLabel = all
    ? 'All squads, teams and club events'
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
      {data ? (
        <ReportView
          report={attendanceReport(
            `${formatDateString(from)} to ${formatDateString(to)}`,
            groupsLabel,
            sessions,
            marks,
            data.names,
            { rows: absences, from, to },
          )}
        />
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
