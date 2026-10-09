import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { PROFILE_COLUMNS } from '@/lib/auth';
import type { Report } from '@/lib/pdf';
import { fetchAll, wwccReport, type Placement } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function WwccReportScreen() {
  const teams = useTeams();
  const [data, setData] = useState<{ members: Profile[]; placements: Placement[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [members, placements] = await Promise.all([
        fetchAll<Profile>((from, to) =>
          supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').range(from, to),
        ),
        fetchAll<Placement>((from, to) =>
          supabase
            .from('team_members')
            .select('team_id, profile_id, team_role')
            .in('team_role', ['coach', 'manager'])
            .range(from, to),
        ),
      ]);
      setData({ members, placements });
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

  const report: Report | null = data ? wwccReport(data.members, data.placements, teams) : null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{error}</ErrorText>
      {report ? <ReportView report={report} /> : null}
    </Screen>
  );
}
