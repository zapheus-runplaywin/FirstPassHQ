/**
 * Selection rounds, part 5 (release an assessment): the head coach's ticks,
 * the lines they read, and the preview. The preview must follow the same
 * rules as my_released_assessments in the database: the example here is the
 * one supabase/tests/selection-release.sql checks ("What the athlete reads").
 */
import {
  defaultReleaseParts,
  releasedHeading,
  releasePartsLine,
  releasePartsProblem,
  releasePreview,
  releaseReaders,
  releasesAuditSection,
  releaseStatusLine,
  selectionAuditReport,
  selectionInfoLabel,
  type AthleteRelease,
  type Criteria,
  type ReleaseSummary,
  type SelectionAudit,
} from '@/lib/assessments';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

// The same criteria and summary as the database test.
const SCALE = ['Below standard', 'Meets standard', 'Exceeds standard'];
const CRITERIA: Criteria = {
  groups: [
    { key: 'technical', name: 'Technical ability', scale: SCALE, items: [{ key: 'passing', name: 'Passing ITEM-pass' }, { key: 'catching', name: 'Catching ITEM-catch' }] },
    { key: 'tactical', name: 'Tactical ITEM-group', scale: SCALE, items: [{ key: 'reading', name: 'Reading ITEM-read' }] },
    { key: 'mental', name: 'Mental ITEM-mental', scale: SCALE, items: [{ key: 'focus', name: 'Focus ITEM-focus' }] },
  ],
  recommendations: ['Select', 'Not this time'],
} as Criteria;
const SUMMARY: ReleaseSummary = {
  ratings: [
    { item_key: 'passing', rating: 2 },
    { item_key: 'reading', rating: 3 },
  ],
  recommendation: 'Select',
  strengths: 'STRENGTHS-abc',
  priorities: 'PRIORITIES-def',
  comments: 'COMMENTS-xyz',
};
const RELEASE: AthleteRelease = {
  round_id: 'r1',
  round_name: 'Release round',
  phase: 1,
  round_number: 1,
  team_name: 'Sample Squad',
  criteria_set_name: 'Release set',
  closed: false,
  criteria: CRITERIA,
  athlete_id: 'a1',
  athlete_name: 'Jordan Junior',
  is_minor: true,
  can_release: true,
  my_summary_signed: true,
  my_name: 'Casey Coach',
  summary: SUMMARY,
  release: null,
};

describe('the head coach’s ticks', () => {
  it('start with every rated group, strengths and priorities, never comments or the recommendation', () => {
    expect(defaultReleaseParts(CRITERIA, SUMMARY)).toEqual({
      groups: ['technical', 'tactical'],
      strengths: true,
      priorities: true,
      comments: false,
      recommendation: false,
    });
  });

  it('leave an empty part unticked', () => {
    expect(defaultReleaseParts(CRITERIA, { ...SUMMARY, strengths: '  ', ratings: [] })).toMatchObject({ groups: [], strengths: false });
  });

  it('need at least one part', () => {
    const none = { groups: [], strengths: false, priorities: false, comments: false, recommendation: false };
    expect(releasePartsProblem(none)).toBe('Tick at least one part to release');
    expect(releasePartsProblem({ ...none, comments: true })).toBeNull();
    expect(releasePartsProblem({ ...none, groups: ['x'] })).toBeNull();
  });

  it('read as a line', () => {
    const p = { groups: ['a', 'b', 'c', 'd', 'e', 'f'], strengths: true, priorities: true, comments: false, recommendation: false };
    expect(releasePartsLine(p, 9)).toBe('Ratings for 6 of 9 groups, strengths, development priorities');
    expect(releasePartsLine({ ...p, groups: Array.from({ length: 9 }, (_, n) => String(n)) }, 9)).toBe(
      'Ratings for all 9 groups, strengths, development priorities',
    );
    expect(releasePartsLine({ ...p, groups: [], strengths: false, comments: true, recommendation: true }, 9)).toBe(
      'Development priorities, comments, recommendation',
    );
  });

  it('say who reads it', () => {
    expect(releaseReaders(RELEASE)).toBe(
      'Jordan Junior is under 18. Their verified parents and guardians read this assessment at the same time, under Selection. Nobody can reply in the app.',
    );
    expect(releaseReaders({ ...RELEASE, is_minor: false, athlete_name: 'Kai Senior' })).toBe(
      'Kai Senior reads this assessment under Selection. Nobody can reply in the app.',
    );
  });

  it('show where a release stands', () => {
    expect(releaseStatusLine(undefined)).toBeNull();
    expect(releaseStatusLine({ seen: false })).toBe('Assessment released, not read yet');
    expect(releaseStatusLine({ seen: true })).toBe('Assessment released and read');
  });
});

describe('the preview, by the database’s rules', () => {
  it('matches what the athlete reads for strengths and one group (selection-release.sql)', () => {
    const preview = releasePreview(RELEASE, SUMMARY, {
      groups: ['technical', 'mental'],
      strengths: true,
      priorities: false,
      comments: false,
      recommendation: false,
    });
    expect(preview.strengths).toBe('STRENGTHS-abc');
    expect(preview.priorities).toBeNull();
    expect(preview.comments).toBeNull();
    expect(preview.recommendation).toBeNull();
    // The JSON the database test expects for "and one group".
    expect(preview.groups).toEqual([
      { name: 'Technical ability', items: [{ name: 'Passing ITEM-pass', step: 'Meets standard' }], scale: SCALE },
    ]);
    expect(preview.from_name).toBe('Casey Coach');
    expect(preview.criteria_set_name).toBe('Release set');
  });

  it('holds all five parts when everything is ticked, still without criteria with no step', () => {
    const preview = releasePreview(RELEASE, SUMMARY, {
      groups: ['technical', 'tactical', 'mental'],
      strengths: true,
      priorities: true,
      comments: true,
      recommendation: true,
    });
    expect([preview.strengths, preview.priorities, preview.comments, preview.recommendation, preview.groups.length]).toEqual([
      'STRENGTHS-abc',
      'PRIORITIES-def',
      'COMMENTS-xyz',
      'Select',
      2,
    ]);
    expect(JSON.stringify(preview)).not.toMatch(/ITEM-focus|ITEM-catch|item_key|rating/);
  });

  it('leaves out a ticked part that is empty', () => {
    expect(releasePreview(RELEASE, { ...SUMMARY, comments: ' ' }, { groups: [], strengths: false, priorities: false, comments: true, recommendation: false }).comments).toBeNull();
  });

  it('heads it for the athlete or a parent', () => {
    expect(releasedHeading({ is_me: true, athlete_name: 'Jordan' })).toBe('Your assessment');
    expect(releasedHeading({ is_me: false, athlete_name: 'Jordan' })).toBe('Jordan’s assessment');
  });
});

describe('the record and Today', () => {
  const RELEASES = {
    athletes: 14,
    released: [
      { athlete_name: 'Jordan Junior', released_at: '2026-12-14T01:00:00Z', released_by_name: 'Casey Coach', seen_at: null, withdrawn: 1, groups: 6, groups_total: 9, strengths: true, priorities: true, comments: false, recommendation: false },
      { athlete_name: 'Kai Senior', released_at: null, released_by_name: 'Casey Coach', seen_at: null, withdrawn: 1, groups: 0, groups_total: 9, strengths: true, priorities: false, comments: false, recommendation: false },
    ],
  };

  it('lists releases with their parts, never the words', () => {
    const section = releasesAuditSection(RELEASES);
    expect(section.title).toBe('Assessments released');
    expect(section.note).toMatch(/1 of 14 athletes have one released now\. What it says is not shown\.$/);
    expect(section.rows[0].cells).toEqual([
      'Jordan Junior',
      expect.any(String),
      'Casey Coach',
      'Ratings for 6 of 9 groups, strengths, development priorities',
      'Not yet',
      '1 time',
    ]);
    expect(section.rows[1].cells[1]).toBe('Taken back');
  });

  it('is the audit report’s last section', () => {
    const audit = {
      round: { id: 'r1', name: 'T', team_name: 'S', season: 2027, starts_on: '2026-10-01', ends_on: '2026-11-01', opened_at: '2026-09-30T00:00:00Z', opened_by_name: null, closed_at: null, closed_by_name: null, criteria_groups: 9, criteria_items: 20, athletes: 14, observations: 0, today: '2026-10-18' },
      panel: [],
      selectors: [],
      athletes: [],
    } as SelectionAudit;
    const titles = selectionAuditReport(audit, [], null, null, null, RELEASES).sections.map((s) => s.title);
    expect(titles[titles.length - 1]).toBe('Assessments released');
  });

  it('leads Today with a new release, before feedback', () => {
    const fresh = { is_new: true, is_me: false, athlete_name: 'Mia' };
    expect(selectionInfoLabel([], '2026-10-18', [{ round_id: 'r1' }], [fresh])).toBe('Mia’s assessment from the coach');
    expect(selectionInfoLabel([], '2026-10-18', [], [{ ...fresh, is_me: true }])).toBe('Your assessment from the coach');
    expect(selectionInfoLabel([], '2026-10-18', [{ round_id: 'r1' }], [{ ...fresh, is_new: false }])).toBe('Feedback from the coach');
  });
});
