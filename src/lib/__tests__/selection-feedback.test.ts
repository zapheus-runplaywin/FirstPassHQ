/**
 * Selection feedback (phase 4): the small rules the screens share. Who may
 * write or read feedback is the database's call
 * (supabase/tests/selection-feedback.sql).
 */
import {
  MAX_FEEDBACK_TEXT,
  feedbackAuditSection,
  feedbackHeading,
  feedbackProblem,
  feedbackReaders,
  feedbackStatusLine,
  nextForFeedback,
  selectionAuditReport,
  selectionInfoLabel,
  type FeedbackStatus,
  type SelectionAudit,
  type SelectionInfo,
  type SharedFeedback,
  type SheetAthlete,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const athletes = ['a1', 'a2', 'a3'].map((id) => ({ id, name: id }) as SheetAthlete);
const status = (athlete_id: string, state: 'draft' | 'shared'): FeedbackStatus => ({ athlete_id, state, seen: false });

describe('feedbackProblem', () => {
  it('lets a draft be empty', () => {
    expect(feedbackProblem('', '', false)).toBeNull();
  });

  it('needs something in one box to share', () => {
    expect(feedbackProblem('  ', '\n', true)).toBe('Write some feedback before you share it');
    expect(feedbackProblem('Good hands', '', true)).toBeNull();
    expect(feedbackProblem('', 'Footwork', true)).toBeNull();
  });

  it('keeps each box to the limit, draft or not', () => {
    const long = 'x'.repeat(MAX_FEEDBACK_TEXT + 1);
    expect(feedbackProblem(long, '', false)).toBe('Keep each box to 1000 characters');
    expect(feedbackProblem('', long, true)).toBe('Keep each box to 1000 characters');
    expect(feedbackProblem('x'.repeat(MAX_FEEDBACK_TEXT), 'x'.repeat(MAX_FEEDBACK_TEXT), true)).toBeNull();
  });
});

describe('feedbackStatusLine', () => {
  it('says nothing with no feedback', () => {
    expect(feedbackStatusLine(undefined)).toBeNull();
  });

  it('tells a draft from shared, and shared from read', () => {
    expect(feedbackStatusLine({ state: 'draft', seen: false })).toBe('Feedback is a draft');
    expect(feedbackStatusLine({ state: 'draft', seen: true })).toBe('Feedback is a draft');
    expect(feedbackStatusLine({ state: 'shared', seen: false })).toBe('Feedback shared, not read yet');
    expect(feedbackStatusLine({ state: 'shared', seen: true })).toBe('Feedback shared and read');
  });
});

describe('feedbackReaders', () => {
  it('names an under 18’s verified parents and guardians as readers', () => {
    expect(feedbackReaders({ athlete_name: 'Jordan', is_minor: true })).toMatch(
      /^Jordan and their verified parents and guardians will read this under Selection\. Nobody can reply/,
    );
  });

  it('names only an adult athlete', () => {
    const line = feedbackReaders({ athlete_name: 'Kai', is_minor: false });
    expect(line).toMatch(/^Kai will read this under Selection\. Nobody can reply/);
    expect(line).not.toMatch(/parents/);
  });

  it('copes with no name', () => {
    expect(feedbackReaders({ athlete_name: null, is_minor: false })).toMatch(/^The athlete will read this/);
  });
});

describe('nextForFeedback', () => {
  it('is the next athlete down the list with nothing shared', () => {
    expect(nextForFeedback(athletes, [], 'a1')?.id).toBe('a2');
    expect(nextForFeedback(athletes, [status('a2', 'shared')], 'a1')?.id).toBe('a3');
  });

  it('counts a draft as still to share', () => {
    expect(nextForFeedback(athletes, [status('a2', 'draft')], 'a1')?.id).toBe('a2');
  });

  it('wraps round to the top', () => {
    expect(nextForFeedback(athletes, [status('a1', 'draft')], 'a3')?.id).toBe('a1');
    expect(nextForFeedback(athletes, [status('a3', 'shared')], 'a2')?.id).toBe('a1');
  });

  it('is never the athlete on screen, and null when everyone else’s is shared', () => {
    expect(nextForFeedback(athletes, [status('a2', 'shared'), status('a3', 'shared')], 'a1')).toBeNull();
    expect(nextForFeedback([athletes[0]], [], 'a1')).toBeNull();
    expect(nextForFeedback([], [], 'a1')).toBeNull();
  });

  it('starts from the top for an athlete who isn’t on the list', () => {
    expect(nextForFeedback(athletes, [], 'gone')?.id).toBe('a1');
  });
});

describe('feedbackHeading', () => {
  const feedback = { is_me: true, athlete_name: 'Jordan' } as SharedFeedback;

  it('speaks to the athlete, and names a child to a parent', () => {
    expect(feedbackHeading(feedback)).toBe('Feedback for you');
    expect(feedbackHeading({ ...feedback, is_me: false })).toBe('Feedback for Jordan');
    expect(feedbackHeading({ ...feedback, is_me: false, athlete_name: null })).toBe('Feedback for your child');
  });
});

describe('selectionInfoLabel with feedback', () => {
  const info = {
    round_id: 'r1',
    round_name: 'Trials',
    dates: [{ title: 'Teams named', due_on: '2026-10-28', done: false }],
  } as SelectionInfo;

  it('leads with feedback from an open round, or with no round open', () => {
    expect(selectionInfoLabel([info], '2026-10-18', [{ round_id: 'r1' }])).toBe('Feedback from the coach');
    expect(selectionInfoLabel([], '2026-10-18', [{ round_id: 'r0' }])).toBe('Feedback from the coach');
  });

  it('keeps to the open round when the feedback is from an earlier one', () => {
    expect(selectionInfoLabel([info], '2026-10-18', [{ round_id: 'r0' }])).toBe(
      `Trials · next: Teams named, ${formatDateString('2026-10-28')}`,
    );
  });

  it('is as before with no feedback', () => {
    expect(selectionInfoLabel([], '2026-10-18')).toBe('');
    expect(selectionInfoLabel([info], '2026-10-18', [])).toMatch(/^Trials · next/);
  });
});

describe('feedbackAuditSection', () => {
  const record = {
    athletes: 1,
    shared: [
      { athlete_name: 'Jordan', shared_at: '2026-10-17T03:00:00Z', shared_by_name: 'Casey', seen_at: '2026-10-18T03:00:00Z', withdrawn: 0 },
      { athlete_name: null, shared_at: '2026-10-17T03:00:00Z', shared_by_name: null, seen_at: null, withdrawn: 1 },
      { athlete_name: 'Kai', shared_at: null, shared_by_name: 'Casey', seen_at: null, withdrawn: 2 },
    ],
  };

  it('has a row for each athlete ever given feedback: when, by whom, read, taken back', () => {
    const section = feedbackAuditSection(record);
    expect(section.rows.map((r) => r.cells)).toEqual([
      ['Jordan', formatDateString('2026-10-17'), 'Casey', formatDateString('2026-10-18'), ''],
      ['Athlete', formatDateString('2026-10-17'), '', 'Not yet', '1 time'],
      ['Kai', 'Taken back', 'Casey', '', '2 times'],
    ]);
  });

  it('counts only feedback shared now, with the right plural', () => {
    expect(feedbackAuditSection(record).note).toMatch(/2 of 1 athlete has feedback shared now/);
    expect(feedbackAuditSection({ athletes: 12, shared: [] }).note).toMatch(/0 of 12 athletes have feedback shared now/);
    expect(feedbackAuditSection({ athletes: 12, shared: [] }).empty).toBe('No feedback has been shared.');
  });

  it('joins the audit report only when the database gave a record, after everything else', () => {
    const audit = {
      round: { name: 'Trials', team_name: 'Squad', starts_on: '2026-10-05', ends_on: '2026-11-29', criteria_groups: 1, athletes: 1, observations: 0 },
      panel: [],
      selectors: [],
      athletes: [],
    } as unknown as SelectionAudit;
    const without = selectionAuditReport(audit).sections.map((s) => s.title);
    expect(without).not.toContain('Feedback shared');
    const withIt = selectionAuditReport(audit, [], null, record).sections.map((s) => s.title);
    expect(withIt).toEqual([...without, 'Feedback shared']);
    expect(JSON.stringify(selectionAuditReport(audit, [], null, record))).not.toMatch(/went_well|work_on/);
  });
});
