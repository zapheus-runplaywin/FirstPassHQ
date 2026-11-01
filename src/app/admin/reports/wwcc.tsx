import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Report } from '@/lib/pdf';
import { loadWwccData, type WwccData } from '@/lib/report-data';
import { wwccReport } from '@/lib/reports';
import { useTeams } from '@/lib/use-teams';

export default function WwccReportScreen() {
  const { committeeChecksFrom, statisticianChecksFrom } = useAuth();
  const teams = useTeams();
  const [data, setData] = useState<WwccData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await loadWwccData());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The report didn’t load. Try again.');
    }
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

  const report: Report | null = data
    ? wwccReport(
        data.members,
        data.placements,
        teams,
        data.standDowns,
        data.exemptions,
        data.notices,
        data.officerName,
        data.acknowledgements,
        committeeChecksFrom,
        data.applications,
        statisticianChecksFrom,
      )
    : null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{error}</ErrorText>
      {report ? <ReportView report={report} /> : null}
    </Screen>
  );
}
