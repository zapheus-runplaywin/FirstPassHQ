import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import { selectionAuditReport, type SelectionAudit } from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

/**
 * The Selection audit report for a round: how the selection work was done
 * (the panel, what each selector wrote and when, how much evidence there is
 * about each athlete), never what was said. On screen and as a PDF.
 */
export default function SelectionAuditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [audit, setAudit] = useState<SelectionAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('admin_selection_audit', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setAudit(data as SelectionAudit);
  }, [id]);

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
      {audit ? <ReportView report={selectionAuditReport(audit)} /> : null}
    </Screen>
  );
}
