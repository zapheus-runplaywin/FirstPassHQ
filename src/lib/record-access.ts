import { supabase } from '@/lib/supabase';

/** The kinds of a child's record whose views are logged. */
export type RecordKind =
  | 'injury'
  | 'injury_document'
  | 'injury_document_shared'
  | 'check_ins'
  | 'goals'
  | 'member_record'
  | 'kpis'
  | 'survey_answers'
  | 'medical';

/** One time someone opened a child's record. */
export type RecordAccess = {
  id: string;
  viewer_name: string;
  viewer_role: string | null;
  kind: RecordKind;
  record_id: string | null;
  created_at: string;
};

export const recordKindLabels: Record<RecordKind, string> = {
  injury: 'Opened an injury',
  injury_document: 'Opened an injury document',
  injury_document_shared: 'Shared an injury document',
  check_ins: 'Read check-ins',
  goals: 'Read game goals',
  member_record: 'Opened their member record',
  kpis: 'Read season KPIs',
  survey_answers: 'Read their named survey answers',
  medical: 'Opened their medical and emergency details',
};

/**
 * Records that the signed-in member is looking at a child's record. The
 * server decides whether it counts: only views of under 18s by someone other
 * than the child or their parents and guardians are logged, and only of
 * records the viewer can actually see.
 */
export function logRecordView(subjectId: string | undefined, kind: RecordKind, recordId?: string) {
  if (!subjectId) return;
  supabase
    .rpc('log_record_view', {
      p_subject_id: subjectId,
      p_kind: kind,
      p_record_id: recordId ?? null,
    })
    .then(() => undefined);
}
