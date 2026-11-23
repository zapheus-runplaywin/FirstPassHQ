import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ErrorText } from '@/components/ui';
import {
  selectionAuditReport,
  type AdminFeedback,
  type AdminSummaries,
  type Milestone,
  type SelectionAudit,
} from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

/**
 * The Selection audit report for a round: how the selection work was done
 * (its dates, the panel, what each selector wrote and when, how much evidence there is
 * about each athlete, who signed their summaries, who was given feedback), never what was said. On screen (one section open at a time) and as a PDF.
 */
export default function SelectionAuditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [audit, setAudit] = useState<SelectionAudit | null>(null);
  const [dates, setDates] = useState<Milestone[]>([]);
  const [summaries, setSummaries] = useState<AdminSummaries | null>(null);
  const [feedback, setFeedback] = useState<AdminFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('admin_selection_audit', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    // The round's dates: when each was due, done and by whom.
    const { data: dateRows } = await supabase.rpc('admin_selection_milestones', { p_round_id: id });
    // Who has signed their summaries, and every reopening: counts and dates.
    const { data: signed } = await supabase.rpc('admin_selection_summaries', { p_round_id: id });
    // Who was given feedback, when, and whether it was read: never the words.
    const { data: shared } = await supabase.rpc('admin_selection_feedback', { p_round_id: id });
    setError(null);
    setFeedback((shared as AdminFeedback | null) ?? null);
    setDates((dateRows as Milestone[] | null) ?? []);
    setSummaries((signed as AdminSummaries | null) ?? null);
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
      {audit ? <ReportView folded report={selectionAuditReport(audit, dates, summaries, feedback)} /> : null}
    </Screen>
  );
}
