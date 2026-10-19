/**
 * Logging views of a child's records: the app asks the server to log each
 * view, and the server decides whether it counts (supabase/tests/record-access.sql).
 */
import { logRecordView, recordKindLabels, type RecordKind } from '@/lib/record-access';
import { supabase } from '@/lib/supabase';

const rpc = jest.mocked(supabase.rpc);

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null } as never);
});

describe('logRecordView', () => {
  it('logs the child, the kind of record and the record', () => {
    logRecordView('child-1', 'injury', 'injury-9');
    expect(rpc).toHaveBeenCalledWith('log_record_view', {
      p_subject_id: 'child-1',
      p_kind: 'injury',
      p_record_id: 'injury-9',
    });
  });

  it('logs a view of a whole kind of record with no record id', () => {
    logRecordView('child-1', 'check_ins');
    expect(rpc).toHaveBeenCalledWith('log_record_view', {
      p_subject_id: 'child-1',
      p_kind: 'check_ins',
      p_record_id: null,
    });
  });

  it('logs nothing before the child is known', () => {
    logRecordView(undefined, 'goals');
    logRecordView('', 'goals');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('recordKindLabels', () => {
  // What a parent reads on "Who has viewed their records".
  it.each<[RecordKind, string]>([
    ['injury', 'Opened an injury'],
    ['injury_document', 'Opened an injury document'],
    ['injury_document_shared', 'Shared an injury document'],
    ['check_ins', 'Read check-ins'],
    ['goals', 'Read game goals'],
    ['member_record', 'Opened their member record'],
    ['kpis', 'Read season KPIs'],
    ['survey_answers', 'Read their named survey answers'],
  ])('%s reads "%s"', (kind, label) => {
    expect(recordKindLabels[kind]).toBe(label);
  });

  it('labels every kind of record', () => {
    expect(Object.keys(recordKindLabels)).toHaveLength(8);
  });
});
