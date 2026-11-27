/**
 * Selection rounds, part 6 (internal notes): a selector's note beside a
 * criterion in their summary. Read by the panel and the round's auditors;
 * never in a release, a PDF or anything an admin reads but one count.
 */
import {
  criteriaRecordSection,
  groupNotesCount,
  internalNotesLine,
  internalNotesRecordLine,
  makeCriteria,
  MAX_INTERNAL_NOTE,
  noteLines,
  notesToSave,
  releasePreview,
  setSummaryNote,
  summaryComparison,
  summaryProblem,
  summarySheetReport,
  summaryStart,
  type AssessmentSummary,
  type AthleteRelease,
  type RoundRecord,
  type SummaryDraft,
} from '@/lib/assessments';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const CRITERIA = {
  ...makeCriteria([
    { name: 'Technical ability', items: ['Passing', 'Catching'] },
    { name: 'Mental', items: ['Focus'] },
  ]),
  recommendations: ['Select'],
};
const [PASS, CATCH] = CRITERIA.groups[0].items;
const FOCUS = CRITERIA.groups[1].items[0];
const NOTE = 'NOTE-7f3a-never-released';

function summary(extra: Partial<AssessmentSummary> = {}): AssessmentSummary {
  return {
    round_id: 'r1', round_name: 'Trials', team_name: '17 & Under squad', closed: false, starts_on: '2026-10-05',
    ends_on: '2026-11-29', criteria: CRITERIA, today: '2026-10-18', athlete_id: 'a1', athlete_name: 'Mia Chen',
    my_name: 'Sam Rivera', mine: null, prefill: [], my_observations: { total: 0, training: 0, game: 0, trial: 0, other: 0 },
    last_reopened: null, can_reopen: false, others_signed: 0, others: [], ...extra,
  };
}
const SIGNED = {
  id: 's1', ratings: [{ item_key: PASS.key, rating: 2 }], recommendation: 'Select', strengths: 'Reads the play',
  priorities: 'Left hand', comments: 'Talks well', signed_at: '2026-10-17T03:00:00Z', updated_at: '2026-10-17T03:00:00Z',
  notes: [{ item_key: PASS.key, note: NOTE }],
};

describe('writing internal notes', () => {
  it('replaces or adds a note, keeping an empty one while its field is open', () => {
    expect(setSummaryNote([], PASS.key, '')).toEqual([{ item_key: PASS.key, note: '' }]);
    expect(setSummaryNote([{ item_key: PASS.key, note: 'a' }], PASS.key, 'b')).toEqual([{ item_key: PASS.key, note: 'b' }]);
    expect(setSummaryNote([{ item_key: PASS.key, note: 'a' }], CATCH.key, 'c')).toHaveLength(2);
  });

  it('saves notes trimmed, without the empty ones', () => {
    expect(notesToSave([{ item_key: PASS.key, note: '  a  ' }, { item_key: CATCH.key, note: '   ' }])).toEqual([{ item_key: PASS.key, note: 'a' }]);
  });

  it('starts from the saved notes, leaving out criteria the round no longer has', () => {
    const start = summaryStart(summary({ mine: { ...SIGNED, notes: [{ item_key: PASS.key, note: 'x' }, { item_key: 'gone', note: 'y' }] } }));
    expect(start.notes).toEqual([{ item_key: PASS.key, note: 'x' }]);
    expect(summaryStart(summary({ mine: { ...SIGNED, notes: undefined } })).notes).toEqual([]);
    expect(summaryStart(summary()).notes).toEqual([]);
  });

  it('allows 500 characters and refuses 501', () => {
    const draft = (note: string): SummaryDraft => ({
      ratings: [], recommendation: null, strengths: '', priorities: '', comments: '', notes: [{ item_key: PASS.key, note }],
    });
    expect(summaryProblem(draft('x'.repeat(MAX_INTERNAL_NOTE)), CRITERIA, false)).toBeNull();
    expect(summaryProblem(draft('x'.repeat(MAX_INTERNAL_NOTE + 1)), CRITERIA, false)).toBe('Keep each internal note to 500 characters.');
  });

  it('counts a group’s notes for its folded row', () => {
    const notes = [{ item_key: PASS.key, note: 'a' }, { item_key: CATCH.key, note: 'b' }, { item_key: FOCUS.key, note: ' ' }];
    expect(groupNotesCount(CRITERIA.groups[0], notes)).toBe('2 internal notes');
    expect(groupNotesCount(CRITERIA.groups[1], notes)).toBeNull();
  });
});

describe('reading internal notes', () => {
  it('lists each selector’s note under the criterion, and a criterion with only a note', () => {
    const groups = summaryComparison(
      summary({
        mine: SIGNED,
        others: [{ id: 's2', author_name: 'Jess Okafor', ratings: [], recommendation: null, strengths: null, priorities: null,
          comments: null, signed_at: '2026-10-16T03:00:00Z', notes: [{ item_key: FOCUS.key, note: 'Only a note' }] }],
      }),
    ).groups;
    expect(groups[0].rated[0].notes).toEqual([`Sam Rivera, internal note: ${NOTE}`]);
    expect(groups[1].rated).toEqual([{ key: FOCUS.key, name: 'Focus', steps: '', notes: ['Jess Okafor, internal note: Only a note'] }]);
    expect(groups[1].unrated).toEqual([]);
  });

  it('gives an auditor the notes in the criteria’s order', () => {
    expect(noteLines(CRITERIA, [{ item_key: FOCUS.key, note: 'b' }, { item_key: PASS.key, note: 'a' }])).toEqual([
      'Passing, internal note: a',
      'Focus, internal note: b',
    ]);
    expect(noteLines(CRITERIA, undefined)).toEqual([]);
  });

  it('tells the head coach their notes are never released', () => {
    expect(internalNotesLine(0)).toBeNull();
    expect(internalNotesLine(1)).toBe('Your internal note is never released.');
    expect(internalNotesLine(2)).toBe('Your 2 internal notes are never released.');
  });
});

describe('where internal notes never go', () => {
  it('leaves them out of the PDF and says so', () => {
    const report = summarySheetReport(summary({ mine: SIGNED, others: [{ ...SIGNED, id: 's2', author_name: 'Jess', notes: [{ item_key: CATCH.key, note: 'NOTE-2b9c' }] }] }));
    expect(JSON.stringify(report)).not.toContain(NOTE);
    expect(JSON.stringify(report)).not.toContain('NOTE-2b9c');
    expect(report.footnote).toContain('Internal notes are not in this copy.');
  });

  it('leaves them out of the release preview, with every part ticked', () => {
    const release = {
      round_id: 'r1', round_name: 'Trials', phase: 1, round_number: 2, team_name: '17 & Under squad', criteria_set_name: 'Junior',
      closed: false, criteria: CRITERIA, athlete_id: 'a1', athlete_name: 'Mia Chen', is_minor: true, can_release: true,
      my_summary_signed: true, my_name: 'Sam Rivera', summary: null, notes_count: 1, release: null,
    } as AthleteRelease;
    const withNotes = { ...SIGNED, notes: SIGNED.notes } as unknown as Parameters<typeof releasePreview>[1];
    const preview = releasePreview(release, withNotes, {
      groups: CRITERIA.groups.map((g) => g.key), strengths: true, priorities: true, comments: true, recommendation: true,
    });
    expect(JSON.stringify(preview)).not.toContain(NOTE);
    expect(JSON.stringify(preview)).toContain('Talks well');
  });

  it('gives admins one count for the round, never the words', () => {
    const record: RoundRecord = {
      criteria: { set_name: 'Junior', version: 1, saved_at: null, saved_by_name: null, for_label: null, groups: 2, items: 3,
        recommendations: 1, set_state: 'same', set_version: 1 },
      events: [],
      internal_notes: { notes: 14, selectors: 3, athletes: 6 },
    };
    expect(criteriaRecordSection(record).rows.at(-1)?.cells).toEqual([
      'Internal notes',
      '14 notes by 3 selectors about 6 athletes. Only the panel and this round’s auditors read them.',
    ]);
    expect(internalNotesRecordLine({ notes: 0, selectors: 0, athletes: 0 })).toBe('None');
    expect(internalNotesRecordLine({ notes: 1, selectors: 1, athletes: 1 })).toBe(
      '1 note by 1 selector about 1 athlete. Only the panel and this round’s auditors read them.',
    );
    const older = { ...record, internal_notes: undefined };
    expect(criteriaRecordSection(older).rows.some((r) => r.cells[0] === 'Internal notes')).toBe(false);
  });
});
