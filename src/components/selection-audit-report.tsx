import { useCallback, useImperativeHandle, useState, type Ref } from 'react';
import { useFocusEffect } from 'expo-router';

import { ReportView } from '@/components/report-view';
import { ErrorText } from '@/components/ui';
import {
  selectionAuditReport,
  type AdminFeedback,
  type AdminReleases,
  type AdminSummaries,
  type Milestone,
  type RoundRecord,
  type SelectionAudit,
} from '@/lib/assessments';
import { supabase } from '@/lib/supabase';

export type SelectionAuditReportHandle = { reload: () => Promise<void> };

/**
 * The Selection audit report for a round: how the selection work was done
 * (its dates, the panel, what each selector wrote and when, how much evidence
 * there is about each athlete, who signed their summaries, who was given
 * feedback), never what was said. Admins and the round's auditors build it;
 * the database decides who may. On screen (one section open at a time) and as
 * a PDF.
 */
export function SelectionAuditReport({ roundId, ref }: { roundId: string; ref?: Ref<SelectionAuditReportHandle> }) {
  const [audit, setAudit] = useState<SelectionAudit | null>(null);
  const [dates, setDates] = useState<Milestone[]>([]);
  const [summaries, setSummaries] = useState<AdminSummaries | null>(null);
  const [feedback, setFeedback] = useState<AdminFeedback | null>(null);
  const [record, setRecord] = useState<RoundRecord | null>(null);
  const [releases, setReleases] = useState<AdminReleases | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('admin_selection_audit', { p_round_id: roundId });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    // The round's dates: when each was due, done and by whom.
    const { data: dateRows } = await supabase.rpc('admin_selection_milestones', { p_round_id: roundId });
    // Who has signed their summaries, and every reopening: counts and dates.
    const { data: signed } = await supabase.rpc('admin_selection_summaries', { p_round_id: roundId });
    // Who was given feedback, when, and whether it was read: never the words.
    const { data: shared } = await supabase.rpc('admin_selection_feedback', { p_round_id: roundId });
    // Which criteria the round used, every change to it: no athlete data.
    const { data: recordRow } = await supabase.rpc('admin_selection_round_record', { p_round_id: roundId });
    // Whose assessment was released, which parts and when: never the words (part 5).
    const { data: releaseRows } = await supabase.rpc('admin_selection_releases', { p_round_id: roundId });
    setError(null);
    setReleases((releaseRows as AdminReleases | null) ?? null);
    setRecord((recordRow as RoundRecord | null) ?? null);
    setFeedback((shared as AdminFeedback | null) ?? null);
    setDates((dateRows as Milestone[] | null) ?? []);
    setSummaries((signed as AdminSummaries | null) ?? null);
    setAudit(data as SelectionAudit);
  }, [roundId]);

  useImperativeHandle(ref, () => ({ reload: load }), [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <>
      <ErrorText>{error}</ErrorText>
      {audit ? <ReportView folded report={selectionAuditReport(audit, dates, summaries, feedback, record, releases)} /> : null}
    </>
  );
}
