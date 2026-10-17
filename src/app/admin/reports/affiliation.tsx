import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import type { Affiliation, Officer, Registration } from '@/lib/affiliation';
import { affiliationReport } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

type Data = { affiliation: Affiliation; officers: Officer[]; registrations: Registration[] };

export default function AffiliationReportScreen() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [settingsResult, officersResult] = await Promise.all([
      supabase.rpc('admin_affiliation').maybeSingle(),
      supabase.rpc('admin_affiliation_officers'),
    ]);
    const affiliation = settingsResult.data as Affiliation | null;
    if (settingsResult.error || !affiliation) {
      setError(settingsResult.error?.message ?? 'The report didn’t load. Try again.');
      return;
    }
    const registrationsResult =
      affiliation.season === null
        ? { data: [], error: null }
        : await supabase.rpc('admin_playhq_registrations', { p_season: affiliation.season });
    if (registrationsResult.error) {
      setError(registrationsResult.error.message);
      return;
    }
    setData({
      affiliation,
      officers: (officersResult.data as Officer[] | null) ?? [],
      registrations: (registrationsResult.data as Registration[] | null) ?? [],
    });
    setError(null);
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
          report={affiliationReport(data.affiliation, data.officers, data.registrations)}
        />
      ) : null}
    </Screen>
  );
}
