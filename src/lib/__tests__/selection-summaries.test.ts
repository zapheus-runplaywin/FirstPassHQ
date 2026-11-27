/**
 * Selection rounds, phase 3 (Matt, 23 November 2026): each selector's own
 * summary of an athlete, signed at the end of a round; the completed sheet
 * the panel can save as a PDF; the recommendations a club sets; and the
 * Summaries part of the Selection audit report, which holds counts and dates
 * and nothing a summary says.
 */
import {
  MAX_RECOMMENDATION,
  MAX_RECOMMENDATIONS,
  MAX_SUMMARY_TEXT,
  STARTER_RECOMMENDATIONS,
  addGroup,
  addItem,
  criteriaProblem,
  makeCriteria,
  myObservationsLine,
  recommendationsProblem,
  removeGroup,
  renameGroup,
  selectionAuditReport,
  setRecommendation,
  setSummaryRating,
  starterCriteria,
  summariesAuditSections,
  summaryComparison,
  summaryCoverage,
  summaryProblem,
  summarySheetReport,
  summaryStart,
  summaryStatusLine,
  type AdminSummaries,
  type AssessmentSummary,
  type Criteria,
  type SelectionAudit,
  type SummaryDraft,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const d = formatDateString;

const GROUPS = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Coachability', scale: ['Developing', 'Meets standard', 'Exceeds standard'], items: ['Accepts feedback'] },
]);
const CRITERIA: Criteria = { ...GROUPS, recommendations: ['Select', 'Not selected this time'] };

function summary(extra: Partial<AssessmentSummary> = {}): AssessmentSummary {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    team_name: '17 & Under squad',
    closed: false,
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    criteria: CRITERIA,
    today: '2026-10-18',
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    my_name: 'Casey Coach',
    mine: null,
    prefill: [],
    my_observations: { total: 0, training: 0, game: 0, trial: 0, other: 0 },
    last_reopened: null,
    can_reopen: false,
    others_signed: 0,
    others: [],
    ...extra,
  };
}

const MINE = {
  id: 's1',
  ratings: [
    { item_key: 'passing', rating: 3 },
    { item_key: 'accepts-feedback', rating: 2 },
  ],
  recommendation: 'Select',
  strengths: 'Reads the play early',
  priorities: 'Left-hand pass',
  comments: null,
  signed_at: '2026-11-28T03:00:00Z',
  updated_at: '2026-11-28T03:00:00Z',
};

const OTHER = {
  id: 's2',
  author_name: 'Ola Selector',
  ratings: [
    { item_key: 'passing', rating: 2 },
    { item_key: 'catching', rating: 1 },
  ],
  recommendation: 'Not selected this time',
  strengths: null,
  priorities: 'Catching under pressure',
  comments: 'Seen at two trials only',
  signed_at: '2026-11-30T03:00:00Z',
};

describe('the recommendations a club sets', () => {
  it('starts the netball example with the usual four, and its own copy of them', () => {
    const starter = starterCriteria();
    expect(starter.recommendations).toEqual([
      'Select',
      'Select as a training partner',
      'Not selected this time',
      'More evidence needed',
    ]);
    expect(starter.recommendations).not.toBe(STARTER_RECOMMENDATIONS);
    expect(starter.groups).toHaveLength(9);
    expect(criteriaProblem(starter)).toBeNull();
  });

  it('allows none, or two to eight different names of up to 40 characters', () => {
    expect(recommendationsProblem([])).toBeNull();
    expect(recommendationsProblem(['Select', 'Not yet'])).toBeNull();
    expect(recommendationsProblem(Array.from({ length: MAX_RECOMMENDATIONS }, (_, i) => `Choice ${i}`))).toBeNull();
    expect(recommendationsProblem(['a'.repeat(MAX_RECOMMENDATION), 'b'])).toBeNull();
  });

  it('refuses one alone, an empty one, too many, one too long and two the same', () => {
    expect(recommendationsProblem(['Select'])).toBe(
      'Give selectors at least two recommendations to choose from, or none.',
    );
    expect(recommendationsProblem(['Select', '  '])).toBe('Name each recommendation, or remove the empty one.');
    expect(recommendationsProblem(Array.from({ length: MAX_RECOMMENDATIONS + 1 }, (_, i) => `Choice ${i}`))).toBe(
      'Keep the recommendations to 8.',
    );
    expect(recommendationsProblem(['a'.repeat(MAX_RECOMMENDATION + 1), 'b'])).toBe(
      'Keep each recommendation to 40 characters.',
    );
    expect(recommendationsProblem(['Select', ' select '])).toBe('Two recommendations are the same.');
  });

  it('checks them with the rest of the criteria, after the groups', () => {
    expect(criteriaProblem(GROUPS)).toBeNull();
    expect(criteriaProblem(CRITERIA)).toBeNull();
    expect(criteriaProblem({ ...GROUPS, recommendations: ['Select'] })).toBe(
      'Give selectors at least two recommendations to choose from, or none.',
    );
    expect(criteriaProblem({ groups: [], recommendations: ['Select'] })).toBe('Add at least one group of criteria.');
  });

  it('names, adds and removes one without touching the list it was given', () => {
    const renamed = setRecommendation(CRITERIA, 1, 'Not yet');
    expect(renamed.recommendations).toEqual(['Select', 'Not yet']);
    expect(CRITERIA.recommendations).toEqual(['Select', 'Not selected this time']);
    expect(setRecommendation(CRITERIA, 2, '').recommendations).toEqual(['Select', 'Not selected this time', '']);
    expect(setRecommendation(CRITERIA, 0, null).recommendations).toEqual(['Not selected this time']);
    expect(setRecommendation(GROUPS, 0, 'Select').recommendations).toEqual(['Select']);
    expect(renamed.groups).toBe(CRITERIA.groups);
  });

  it('keeps them when a group is added, renamed, given an item or removed', () => {
    const key = CRITERIA.groups[0].key;
    for (const changed of [
      addGroup(CRITERIA),
      renameGroup(CRITERIA, key, 'Skills'),
      addItem(CRITERIA, key),
      removeGroup(CRITERIA, key),
    ]) {
      expect(changed.recommendations).toEqual(['Select', 'Not selected this time']);
    }
  });
});

describe('starting a summary', () => {
  it('starts a new one from the selector’s own latest steps, with nothing else filled in', () => {
    expect(summaryStart(summary({ prefill: [{ item_key: 'passing', rating: 2 }] }))).toEqual({
      ratings: [{ item_key: 'passing', rating: 2 }],
      recommendation: null,
      strengths: '',
      priorities: '',
      comments: '',
      notes: [],
    });
  });

  it('starts a saved one as it was saved, and ignores the observations', () => {
    expect(summaryStart(summary({ mine: MINE, prefill: [{ item_key: 'catching', rating: 1 }] }))).toEqual({
      ratings: MINE.ratings,
      recommendation: 'Select',
      strengths: 'Reads the play early',
      priorities: 'Left-hand pass',
      comments: '',
      notes: [],
    });
  });

  it('leaves out a step for an item the round doesn’t have, and a recommendation it doesn’t list', () => {
    const start = summaryStart(
      summary({
        mine: { ...MINE, recommendation: 'Captain', ratings: [...MINE.ratings, { item_key: 'gone', rating: 1 }] },
      }),
    );
    expect(start.ratings).toEqual(MINE.ratings);
    expect(start.recommendation).toBeNull();
    expect(summaryStart(summary({ prefill: [{ item_key: 'gone', rating: 1 }] })).ratings).toEqual([]);
    expect(summaryStart(summary({ criteria: GROUPS, mine: MINE })).recommendation).toBeNull();
  });
});

describe('choosing steps in a summary', () => {
  const ratings = [{ item_key: 'passing', rating: 2 }];

  it('adds a step, changes it and takes it off, leaving the others', () => {
    expect(setSummaryRating(ratings, 'catching', 1)).toEqual([...ratings, { item_key: 'catching', rating: 1 }]);
    expect(setSummaryRating(ratings, 'passing', 3)).toEqual([{ item_key: 'passing', rating: 3 }]);
    expect(setSummaryRating(ratings, 'passing', undefined)).toEqual([]);
    expect(setSummaryRating(ratings, 'catching', undefined)).toEqual(ratings);
    expect(ratings).toEqual([{ item_key: 'passing', rating: 2 }]);
  });

  it('counts how many of the round’s criteria have a step', () => {
    expect(summaryCoverage(CRITERIA, [])).toBe('0 of 3 criteria');
    expect(summaryCoverage(CRITERIA, MINE.ratings)).toBe('2 of 3 criteria');
    expect(summaryCoverage(CRITERIA, [...MINE.ratings, { item_key: 'gone', rating: 1 }])).toBe('2 of 3 criteria');
  });
});

describe('what stops a summary', () => {
  const draft = (extra: Partial<SummaryDraft> = {}): SummaryDraft => ({
    ratings: [{ item_key: 'passing', rating: 2 }],
    recommendation: 'Select',
    strengths: '',
    priorities: '',
    comments: '',
    notes: [],
    ...extra,
  });

  it('saves an empty draft, and signs one with a step and a recommendation', () => {
    expect(summaryProblem(draft({ ratings: [], recommendation: null }), CRITERIA, false)).toBeNull();
    expect(summaryProblem(draft(), CRITERIA, true)).toBeNull();
  });

  it('won’t sign without a step', () => {
    expect(summaryProblem(draft({ ratings: [] }), CRITERIA, true)).toBe(
      'Choose a step for at least one of the criteria before you sign.',
    );
  });

  it('won’t sign without a recommendation, unless the round lists none', () => {
    expect(summaryProblem(draft({ recommendation: null }), CRITERIA, true)).toBe(
      'Choose a recommendation before you sign.',
    );
    expect(summaryProblem(draft({ recommendation: null }), GROUPS, true)).toBeNull();
    expect(summaryProblem(draft({ recommendation: null }), { ...GROUPS, recommendations: [] }, true)).toBeNull();
  });

  it.each(['strengths', 'priorities', 'comments'] as const)('keeps %s to 1,000 characters, draft or signed', (box) => {
    const long = 'x'.repeat(MAX_SUMMARY_TEXT + 1);
    expect(summaryProblem(draft({ [box]: long }), CRITERIA, false)).toBe('Keep each box to 1000 characters.');
    expect(summaryProblem(draft({ [box]: long }), CRITERIA, true)).toBe('Keep each box to 1000 characters.');
    expect(summaryProblem(draft({ [box]: 'x'.repeat(MAX_SUMMARY_TEXT) }), CRITERIA, true)).toBeNull();
    expect(summaryProblem(draft({ [box]: `${'x'.repeat(MAX_SUMMARY_TEXT)}  ` }), CRITERIA, true)).toBeNull();
  });
});

describe('the lines beside a summary', () => {
  it('counts the selector’s own observations by where they were made', () => {
    expect(myObservationsLine({ total: 0, training: 0, game: 0, trial: 0, other: 0 })).toBe(
      'You have written no observations about this athlete.',
    );
    expect(myObservationsLine({ total: 1, training: 1, game: 0, trial: 0, other: 0 })).toBe(
      'Your 1 observation: 1 training',
    );
    expect(myObservationsLine({ total: 7, training: 3, game: 2, trial: 1, other: 1 })).toBe(
      'Your 7 observations: 3 training, 2 game, 1 trial, 1 other',
    );
  });

  it('says where the selector’s own summary stands and how many are signed', () => {
    expect(summaryStatusLine(undefined)).toBeNull();
    expect(summaryStatusLine({ athlete_id: 'a1', mine: 'none', signed: 0 })).toBeNull();
    expect(summaryStatusLine({ athlete_id: 'a1', mine: 'none', signed: 2 })).toBe(
      'No summary from you yet · 2 signed in all',
    );
    expect(summaryStatusLine({ athlete_id: 'a1', mine: 'draft', signed: 0 })).toBe(
      'Your summary is a draft · 0 signed in all',
    );
    expect(summaryStatusLine({ athlete_id: 'a1', mine: 'signed', signed: 3 })).toBe(
      'Your summary is signed · 3 signed in all',
    );
  });
});

describe('the completed sheet', () => {
  const report = summarySheetReport(summary({ mine: MINE, others: [OTHER] }));
  const section = (title: string) => report.sections.find((s) => s.title === title)!;

  it('is headed with the athlete, the round and its dates', () => {
    expect(report.title).toBe('Selection assessment');
    expect(report.subtitle).toBe(
      `Jordan Junior · 2027 selection phase · 17 & Under squad · ${d('2026-10-05')} to ${d('2026-11-29')}`,
    );
    expect(report.stats).toEqual([{ label: 'Signed summaries', value: 2 }]);
    expect(report.landscape).toBe(false);
  });

  it('puts each selector’s step for each of the criteria side by side, and a blank where they chose none', () => {
    expect(section('Technical ability').columns.map((c) => c.label)).toEqual([
      'Criteria',
      'Casey Coach',
      'Ola Selector',
    ]);
    expect(section('Technical ability').rows.map((r) => r.cells)).toEqual([
      ['Passing', 'Exceeds standard', 'Meets standard'],
      ['Catching', '', 'Below standard'],
    ]);
    expect(section('Technical ability').note).toBe(
      'Steps, lowest first: Below standard, Meets standard, Exceeds standard.',
    );
    expect(section('Coachability').rows.map((r) => r.cells)).toEqual([['Accepts feedback', 'Meets standard', '']]);
  });

  it('lists each recommendation, and the words of those who wrote any', () => {
    expect(section('Recommendation').rows.map((r) => r.cells)).toEqual([
      ['Casey Coach', 'Select'],
      ['Ola Selector', 'Not selected this time'],
    ]);
    expect(section('Strengths').rows.map((r) => r.cells)).toEqual([['Casey Coach', 'Reads the play early']]);
    expect(section('Development priorities').rows.map((r) => r.cells)).toEqual([
      ['Casey Coach', 'Left-hand pass'],
      ['Ola Selector', 'Catching under pressure'],
    ]);
    expect(section('Comments').rows.map((r) => r.cells)).toEqual([['Ola Selector', 'Seen at two trials only']]);
    expect(section('Comments').empty).toBe('Nothing written.');
  });

  it('ends with who signed and when, and says it is not a score', () => {
    expect(section('Signed').rows.map((r) => r.cells)).toEqual([
      ['Casey Coach', d('2026-11-28')],
      ['Ola Selector', d('2026-11-30')],
    ]);
    expect(report.sections[report.sections.length - 1].title).toBe('Signed');
    expect(report.footnote).toBe(
      'Each selector wrote and signed their own summary before seeing anyone else’s. There is no total or score, and nothing here puts athletes in order. Internal notes are not in this copy. Confidential to the selection panel: keep this copy as the club’s privacy policy says.',
    );
  });

  it('has no total, average or count of steps anywhere', () => {
    expect(JSON.stringify(report)).not.toMatch(/total(?! or score)|average|score:|rank|\d+ of \d+/i);
  });

  it('leaves out the recommendation when the round lists none', () => {
    const plain = summarySheetReport(summary({ criteria: GROUPS, mine: { ...MINE, recommendation: null } }));
    expect(plain.sections.map((s) => s.title)).toEqual([
      'Technical ability',
      'Coachability',
      'Strengths',
      'Development priorities',
      'Comments',
      'Signed',
    ]);
    expect(plain.stats).toEqual([{ label: 'Signed summary', value: 1 }]);
  });

  it('never shows the reader’s own draft, and names them “You” without a name', () => {
    const drafting = summarySheetReport(summary({ mine: { ...MINE, signed_at: null }, others: [OTHER] }));
    expect(drafting.sections[0].columns.map((c) => c.label)).toEqual(['Criteria', 'Ola Selector']);
    expect(drafting.stats).toEqual([{ label: 'Signed summary', value: 1 }]);
    const unnamed = summarySheetReport(summary({ mine: MINE, my_name: null, athlete_name: null }));
    expect(unnamed.sections[0].columns.map((c) => c.label)).toEqual(['Criteria', 'You']);
    expect(unnamed.subtitle).toMatch(/^Athlete · /);
  });

  it('prints across the page once more than two selectors have signed', () => {
    const three = summarySheetReport(
      summary({ mine: MINE, others: [OTHER, { ...OTHER, id: 's3', author_name: 'Morgan Coach-Parent' }] }),
    );
    expect(three.landscape).toBe(true);
    expect(three.sections[0].columns).toHaveLength(4);
  });

  it('shows a blank for a step the scale doesn’t have', () => {
    const odd = summarySheetReport(summary({ mine: { ...MINE, ratings: [{ item_key: 'passing', rating: 9 }] } }));
    expect(odd.sections[0].rows[0].cells).toEqual(['Passing', '']);
  });
});

describe('the signed summaries on screen', () => {
  const compared = summaryComparison(summary({ mine: MINE, others: [OTHER] }));

  it('gives each selector’s recommendation, words and signing day', () => {
    expect(compared.selectors).toEqual([
      {
        name: 'Casey Coach',
        recommendation: 'Select',
        strengths: 'Reads the play early',
        priorities: 'Left-hand pass',
        comments: null,
        signedOn: d('2026-11-28'),
      },
      {
        name: 'Ola Selector',
        recommendation: 'Not selected this time',
        strengths: null,
        priorities: 'Catching under pressure',
        comments: 'Seen at two trials only',
        signedOn: d('2026-11-30'),
      },
    ]);
  });

  it('puts every selector’s step for one of the criteria on a line, and names the rest', () => {
    expect(compared.groups).toEqual([
      {
        key: 'technical-ability',
        name: 'Technical ability',
        rated: [
          { key: 'passing', name: 'Passing', steps: 'Casey Coach: Exceeds standard · Ola Selector: Meets standard', notes: [] },
          { key: 'catching', name: 'Catching', steps: 'Ola Selector: Below standard', notes: [] },
        ],
        unrated: [],
      },
      {
        key: 'coachability',
        name: 'Coachability',
        rated: [{ key: 'accepts-feedback', name: 'Accepts feedback', steps: 'Casey Coach: Meets standard', notes: [] }],
        unrated: [],
      },
    ]);
    const alone = summaryComparison(summary({ mine: { ...MINE, ratings: [{ item_key: 'passing', rating: 9 }] } }));
    expect(alone.groups[0]).toMatchObject({ rated: [], unrated: ['Passing', 'Catching'] });
    expect(alone.groups[1].unrated).toEqual(['Accepts feedback']);
  });

  it('leaves out the reader’s own draft, and names them “You” without a name', () => {
    expect(summaryComparison(summary({ mine: { ...MINE, signed_at: null }, others: [OTHER] })).selectors.map((s) => s.name)).toEqual([
      'Ola Selector',
    ]);
    expect(summaryComparison(summary({ mine: MINE, my_name: null })).selectors[0].name).toBe('You');
    expect(summaryComparison(summary()).selectors).toEqual([]);
  });

  it('holds no total, count or order', () => {
    expect(JSON.stringify(compared)).not.toMatch(/total|average|score|rank/i);
  });
});

describe('the Summaries part of the Selection audit report', () => {
  const SUMMARIES: AdminSummaries = {
    ends_on: '2026-11-29',
    closed: false,
    selectors: [
      { name: 'Casey Coach', on_panel: true, athletes: 14, signed: 14, signed_late: 0, drafts: 0, reopened: 1 },
      { name: 'Ola Selector', on_panel: true, athletes: 14, signed: 9, signed_late: 2, drafts: 3, reopened: 0 },
      { name: 'Drew Lapsed', on_panel: false, athletes: 14, signed: 1, signed_late: 0, drafts: 0, reopened: 0 },
    ],
    signed: [],
    reopenings: [
      { selector_name: 'Casey Coach', athlete_name: 'Jordan Junior', by_name: 'Alex Admin', at: '2026-11-27T02:00:00Z' },
      { selector_name: 'Ola Selector', athlete_name: null, by_name: 'Casey Coach', at: '2026-11-28T02:00:00Z' },
    ],
  };
  const [counts, reopened] = summariesAuditSections(SUMMARIES);

  it('counts what each selector signed, signed late, left in draft and never started', () => {
    expect(counts.title).toBe('Summaries');
    expect(counts.columns.map((c) => c.label)).toEqual([
      'Selector',
      'Athletes',
      'Signed',
      'Signed late',
      'Drafts',
      'Still to start',
      'Reopened',
    ]);
    expect(counts.rows.map((r) => r.cells)).toEqual([
      ['Casey Coach', '14', '14', '0', '0', '0', '1'],
      ['Ola Selector', '14', '9', '2', '3', '2', '0'],
      ['Drew Lapsed (not on the panel now)', '14', '1', '0', '0', '', '0'],
    ]);
    expect(counts.empty).toBe('Nobody is on the panel.');
  });

  it('flags a panel member with summaries unsigned only once the round is closed', () => {
    expect(counts.rows.map((r) => r.flag)).toEqual([false, false, false]);
    const [closed] = summariesAuditSections({ ...SUMMARIES, closed: true });
    expect(closed.rows.map((r) => r.flag)).toEqual([false, true, false]);
  });

  it('never counts fewer than none still to start', () => {
    const [odd] = summariesAuditSections({
      ...SUMMARIES,
      selectors: [{ name: 'Casey Coach', on_panel: true, athletes: 2, signed: 2, signed_late: 0, drafts: 1, reopened: 0 }],
    });
    expect(odd.rows[0].cells[5]).toBe('0');
  });

  it('lists every reopening with who did it and when', () => {
    expect(reopened.title).toBe('Summaries reopened');
    expect(reopened.rows.map((r) => r.cells)).toEqual([
      ['Casey Coach', 'Jordan Junior', 'Alex Admin', d('2026-11-27')],
      ['Ola Selector', 'Athlete', 'Casey Coach', d('2026-11-28')],
    ]);
    expect(reopened.empty).toBe('No summary has been reopened.');
  });

  const AUDIT: SelectionAudit = {
    round: {
      id: 'r1',
      name: '2027 selection phase',
      team_name: '17 & Under squad',
      starts_on: '2026-10-05',
      ends_on: '2026-11-29',
      opened_at: '2026-10-04T01:00:00Z',
      opened_by_name: 'Alex Admin',
      closed_at: null,
      closed_by_name: null,
      criteria_groups: 2,
      criteria_items: 3,
      athletes: 14,
      observations: 0,
      today: '2026-10-18',
    },
    panel: [],
    selectors: [],
    athletes: [],
  } as unknown as SelectionAudit;

  it('comes last in the report when the app has it, and is left out when it hasn’t', () => {
    const titles = (report: ReturnType<typeof selectionAuditReport>) => report.sections.map((s) => s.title);
    expect(titles(selectionAuditReport(AUDIT, [], SUMMARIES)).slice(-3)).toEqual([
      'Evidence about each athlete',
      'Summaries',
      'Summaries reopened',
    ]);
    expect(titles(selectionAuditReport(AUDIT, [], null))).not.toContain('Summaries');
    expect(titles(selectionAuditReport(AUDIT))).not.toContain('Summaries');
  });

  it('says the report holds no recommendations', () => {
    expect(selectionAuditReport(AUDIT, [], SUMMARIES).footnote).toMatch(
      /it holds no ratings, evidence, recommendations or names of criteria/,
    );
  });
});
