import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { PROFILE_COLUMNS } from '@/lib/auth';
import {
  fetchAll,
  under18sReport,
  type Guardianship,
  type Placement,
} from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

type Data = { members: Profile[]; guardianships: Guardianship[]; placements: Placement[] };

export default function Under18sReportScreen() {
  const teams = useTeams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [members, guardianships, placements] = await Promise.all([
        // Guardians who aren't approved yet are still named against their child.
        fetchAll<Profile>((from, to) =>
          supabase.from('profiles').select(PROFILE_COLUMNS).range(from, to),
        ),
        fetchAll<Guardianship>((from, to) =>
          supabase.from('guardianships').select('guardian_id, athlete_id').range(from, to),
        ),
        fetchAll<Placement>((from, to) =>
          supabase
            .from('team_members')
            .select('team_id, profile_id, team_role')
            .eq('team_role', 'athlete')
            .range(from, to),
        ),
      ]);
      setData({ members, guardianships, placements });
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

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{error}</ErrorText>
      {data ? (
        <ReportView
          report={under18sReport(data.members, data.guardianships, data.placements, teams)}
        />
      ) : null}
    </Screen>
  );
}
