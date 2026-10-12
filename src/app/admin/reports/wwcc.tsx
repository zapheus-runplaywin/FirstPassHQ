import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { PROFILE_COLUMNS } from '@/lib/auth';
import type { Report } from '@/lib/pdf';
import { fetchAll, wwccReport, type Placement } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile, StandDown, VolunteerExemption } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function WwccReportScreen() {
  const teams = useTeams();
  const [data, setData] = useState<{
    members: Profile[];
    placements: Placement[];
    standDowns: StandDown[];
    exemptions: VolunteerExemption[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [members, placements, standDowns, exemptions] = await Promise.all([
        fetchAll<Profile>((from, to) =>
          supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').range(from, to),
        ),
        fetchAll<Placement>((from, to) =>
          supabase
            .from('team_members')
            .select('team_id, profile_id, team_role')
            .in('team_role', ['coach', 'manager', 'physio'])
            .range(from, to),
        ),
        fetchAll<StandDown>((from, to) =>
          supabase
            .from('stand_downs')
            .select('*')
            .order('started_at', { ascending: false })
            .range(from, to),
        ),
        fetchAll<VolunteerExemption>((from, to) =>
          supabase.rpc('admin_volunteer_exemptions').range(from, to),
        ),
      ]);
      setData({ members, placements, standDowns, exemptions });
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
    ? wwccReport(data.members, data.placements, teams, data.standDowns, data.exemptions)
    : null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{error}</ErrorText>
      {report ? <ReportView report={report} /> : null}
    </Screen>
  );
}
