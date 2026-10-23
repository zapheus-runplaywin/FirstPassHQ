import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import type { MedicalComplianceRow } from '@/lib/medical';
import { medicalCheckReport } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

/** Admins: who has checked their medical and emergency details this year. */
export default function MedicalCheckReportScreen() {
  const [rows, setRows] = useState<MedicalComplianceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('medical_review_compliance');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setError(null);
    setRows((data as MedicalComplianceRow[] | null) ?? []);
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
      {rows ? <ReportView report={medicalCheckReport(rows)} /> : null}
    </Screen>
  );
}
