import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { SeasonChips } from '@/components/training-list';
import { ErrorText } from '@/components/ui';
import { toDateString } from '@/lib/injuries';
import { kpiReport, type KpiReportRow } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { currentSeason } from '@/lib/training';
import { seasonLabel } from '@/lib/use-teams';

/** Coaches' and managers' season KPIs, results and reviews, for the board. */
export default function KpiReportScreen() {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [rows, setRows] = useState<KpiReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const season = choice ?? currentSeason(seasons);

  const load = useCallback(async () => {
    // Every season with squads or teams, archived ones included.
    const [{ data: teams }, report] = await Promise.all([
      supabase.from('teams').select('season'),
      supabase.rpc('season_kpi_report', { p_season: season }),
    ]);
    setSeasons(
      [...new Set(((teams as { season: number }[] | null) ?? []).map((t) => t.season))].sort(
        (a, b) => b - a,
      ),
    );
    setRows((report.data as KpiReportRow[] | null) ?? []);
    setError(report.error ? report.error.message : null);
  }, [season]);

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
      <SeasonChips seasons={seasons} season={season} onChange={setChoice} />
      <ErrorText>{error}</ErrorText>
      {rows ? (
        <ReportView report={kpiReport(seasonLabel(season), rows, toDateString(new Date()))} />
      ) : null}
    </Screen>
  );
}
