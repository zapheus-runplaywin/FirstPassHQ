import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { PROFILE_COLUMNS } from '@/lib/auth';
import type { Report } from '@/lib/pdf';
import { fetchAll, wwccReport, type Acknowledgement, type Placement } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile, ScreeningNotice, StandDown, VolunteerExemption } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function WwccReportScreen() {
  const teams = useTeams();
  const [data, setData] = useState<{
    members: Profile[];
    placements: Placement[];
    standDowns: StandDown[];
    exemptions: VolunteerExemption[];
    notices: ScreeningNotice[];
    officerName: string | null;
    acknowledgements: Acknowledgement[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [members, placements, standDowns, exemptions, notices, officer, acknowledgements] =
        await Promise.all([
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
        fetchAll<ScreeningNotice>((from, to) =>
          supabase
            .from('screening_notices')
            .select('*')
            .order('received_on', { ascending: false })
            .range(from, to),
        ),
        supabase.rpc('admin_wwc_officer').maybeSingle(),
        fetchAll<Acknowledgement>((from, to) =>
          supabase
            .from('policy_acknowledgements')
            .select('profile_id, policy_version, acknowledged_at')
            .order('acknowledged_at', { ascending: false })
            .range(from, to),
        ),
      ]);
      const officerName = (officer.data as { officer_name: string } | null)?.officer_name ?? null;
      setData({ members, placements, standDowns, exemptions, notices, officerName, acknowledgements });
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
      )
    : null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{error}</ErrorText>
      {report ? <ReportView report={report} /> : null}
    </Screen>
  );
}
