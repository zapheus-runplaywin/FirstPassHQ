import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import type { Affiliation, Registration } from '@/lib/affiliation';
import { affiliationReport } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

type Data = { affiliation: Affiliation; registrations: Registration[] };

export default function AffiliationReportScreen() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const settingsResult = await supabase.rpc('admin_affiliation').maybeSingle();
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
          report={affiliationReport(data.affiliation, data.registrations)}
        />
      ) : null}
    </Screen>
  );
}
