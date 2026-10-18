import { formatDateString } from '@/lib/injuries';
import { surveyReport, surveyWorkbook, type SurveyExport } from '@/lib/survey-reports';
import type { SurveyResults, SurveySummary } from '@/lib/surveys';

// The modules load auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));
jest.mock('@/lib/messages', () => ({ useCaptainedGroupIds: jest.fn() }));

function summary(overrides: Partial<SurveySummary> = {}): SurveySummary {
  return {
    id: 's1',
    title: 'Season survey',
    identity: 'anonymous',
    audience: 'group',
    audience_role: null,
    audience_label: 'Open A',
    opens_at: new Date(2026, 9, 1, 9).toISOString(),
    closes_at: new Date(2026, 9, 15).toISOString(),
    created_by_name: 'Coach Sam',
    sent_as: 'leader',
    everyone_answers: false,
    results_at_percent: null,
    results_to_group: false,
    ...overrides,
  };
}

const rating = { id: 'q1', kind: 'rating' as const, prompt: 'How was training?', options: null, rating_max: 5 };
const choice = { id: 'q2', kind: 'multi_choice' as const, prompt: 'Which days?', options: ['Mon', 'Tue', 'Thu'], rating_max: null };
const text = { id: 'q3', kind: 'text' as const, prompt: 'Anything else?', options: null, rating_max: null };

function results(overrides: Partial<SurveyResults> = {}): SurveyResults {
  return {
    survey: summary(),
    can_export: true,
    sent_to: 10,
    answered: 4,
    hidden: false,
    wait: null,
    closed: true,
    can_close: false,
    min_responses: 3,
    questions: [
      { ...rating, answered: 4, counts: [0, 1, 0, 2, 1], average: 3.8, texts: null },
      { ...choice, answered: 4, counts: [3, 1, 2], average: null, texts: null },
      {
        ...text,
        answered: 2,
        counts: null,
        average: null,
        texts: [
          { text: 'More drills', name: null },
          { text: 'Great season', name: null },
        ],
      },
    ],
    respondents: [],
    waiting: [],
    ...overrides,
  };
}

describe('surveyReport', () => {
  it('describes the survey and its response rate', () => {
    const report = surveyReport(results());
    expect(report.title).toBe('Season survey');
    expect(report.subtitle).toBe(
      `Anonymous · To Open A · From Coach Sam · ${formatDateString('2026-10-01')} to ${formatDateString('2026-10-14')}`,
    );
    expect(report.stats).toEqual([
      { label: 'Sent to', value: 10 },
      { label: 'Answered', value: 4 },
      { label: 'Response rate', value: '40%' },
    ]);
  });

  it('counts ratings and choices with their share', () => {
    const [ratings, choices] = surveyReport(results()).sections;
    expect(ratings.title).toBe('1. How was training?');
    expect(ratings.note).toBe('4 answered, average 3.8 out of 5');
    expect(ratings.rows.map((r) => r.cells)).toEqual([
      ['1', '0', '0%'],
      ['2', '1', '25%'],
      ['3', '0', '0%'],
      ['4', '2', '50%'],
      ['5', '1', '25%'],
    ]);
    expect(choices.note).toBe('4 answered, each could pick several');
    expect(choices.rows.map((r) => r.cells)).toEqual([
      ['Mon', '3', '75%'],
      ['Tue', '1', '25%'],
      ['Thu', '2', '50%'],
    ]);
  });

  it('never shows a name column for an anonymous survey', () => {
    const written = surveyReport(results()).sections[2];
    expect(written.columns).toEqual([{ label: 'Answer' }]);
    expect(written.rows.map((r) => r.cells)).toEqual([['More drills'], ['Great season']]);
    expect(written.note).toBe('2 written answers, in alphabetical order');
    expect(surveyReport(results()).footnote).toMatch(/^Anonymous survey/);
  });

  it('shows names where given for an optional survey', () => {
    const report = surveyReport(
      results({
        survey: summary({ identity: 'optional' }),
        questions: [
          {
            ...text,
            answered: 2,
            counts: null,
            average: null,
            texts: [
              { text: 'Thanks', name: 'Jo' },
              { text: 'Fine', name: null },
            ],
          },
        ],
      }),
    );
    expect(report.sections[0].rows.map((r) => r.cells)).toEqual([
      ['Thanks', 'Jo'],
      ['Fine', 'Not given'],
    ]);
    expect(report.footnote).toMatch(/^Name optional/);
  });

  it('lists who has not answered a named survey', () => {
    const report = surveyReport(
      results({ survey: summary({ identity: 'named', everyone_answers: true }), waiting: ['Alex', 'Sam'] }),
    );
    expect(report.subtitle).toContain('Everyone must answer');
    const last = report.sections[report.sections.length - 1];
    expect(last.title).toBe('Not answered yet');
    expect(last.rows.map((r) => r.cells)).toEqual([['Alex'], ['Sam']]);
    expect(report.footnote).toMatch(/^Named survey/);
  });

  it('copes with nobody sent it', () => {
    expect(surveyReport(results({ sent_to: 0, answered: 0 })).stats?.[2].value).toBe('0%');
  });
});

describe('surveyWorkbook', () => {
  const answers = (r: number, choices: number[], words: string | null) => [
    { question_id: 'q1', choices: null, rating: r, text: null },
    { question_id: 'q2', choices, rating: null, text: null },
    ...(words ? [{ question_id: 'q3', choices: null, rating: null, text: words }] : []),
  ];

  function exportData(overrides: Partial<SurveyExport> = {}): SurveyExport {
    return {
      survey: summary(),
      sent_to: 5,
      answered: 3,
      questions: [rating, choice, text],
      responses: [
        { name: null, submitted_at: null, answers: answers(4, [0, 2], 'Zebra drills') },
        { name: null, submitted_at: null, answers: answers(5, [0], 'Apples') },
        { name: null, submitted_at: null, answers: answers(3, [], null) },
      ],
      waiting: [],
      ...overrides,
    };
  }

  it('has a summary, all answers and a tab per question', () => {
    expect(surveyWorkbook(exportData()).map((s) => s.name)).toEqual([
      'Summary',
      'All answers',
      'Q1 How was training?',
      'Q2 Which days?',
      'Q3 Anything else?',
    ]);
  });

  it('counts answers on the summary, with the rating average', () => {
    const rows = surveyWorkbook(exportData())[0].rows;
    expect(rows.slice(0, 4)).toEqual([
      ['Season survey', null, null],
      [expect.stringMatching(/^Anonymous · To Open A/), null, null],
      ['Sent to', 5, null],
      ['Answered', 3, null],
    ]);
    expect(rows).toContainEqual(['5', 1, '33%']);
    expect(rows).toContainEqual(['Average', 4, null]);
    expect(rows).toContainEqual(['Mon', 2, '67%']);
    expect(rows).toContainEqual(['Tue', 0, '0%']);
    expect(rows).toContainEqual(['Written answers', 2, null]);
  });

  it('keeps names and times out of an anonymous survey', () => {
    const [, all, , , written] = surveyWorkbook(exportData());
    expect(all.rows[0]).toEqual(['1. How was training?', '2. Which days?', '3. Anything else?']);
    expect(all.rows[1]).toEqual([4, 'Mon, Thu', 'Zebra drills']);
    expect(all.rows[3]).toEqual([3, '', null]);
    // Written answers in alphabetical order, so the order gives nobody away.
    expect(written.rows).toEqual([['3. Anything else?'], ['Apples'], ['Zebra drills']]);
  });

  it('adds names and times for a named survey, in the order answered', () => {
    const sheets = surveyWorkbook(
      exportData({
        survey: summary({ identity: 'named' }),
        responses: [
          { name: 'Sam', submitted_at: null, answers: answers(4, [1], 'Zebra drills') },
          { name: 'Jo', submitted_at: null, answers: answers(2, [], 'Apples') },
        ],
        waiting: ['Alex'],
      }),
    );
    expect(sheets[1].rows[0].slice(0, 2)).toEqual(['Name', 'Answered']);
    expect(sheets[1].rows[1]).toEqual(['Sam', '', 4, 'Tue', 'Zebra drills']);
    expect(sheets[4].rows).toEqual([['Name', '3. Anything else?'], ['Sam', 'Zebra drills'], ['Jo', 'Apples']]);
    expect(sheets[sheets.length - 1]).toEqual({ name: 'Not answered yet', widths: [30], rows: [['Name'], ['Alex']] });
  });

  it('shows Not given for a member who kept their name back', () => {
    const sheets = surveyWorkbook(
      exportData({
        survey: summary({ identity: 'optional' }),
        responses: [
          { name: 'Sam', submitted_at: null, answers: answers(4, [], null) },
          { name: null, submitted_at: null, answers: answers(5, [], null) },
        ],
      }),
    );
    expect(sheets[1].rows[0][0]).toBe('Name');
    expect(sheets[1].rows.map((r) => r[0])).toEqual(['Name', 'Sam', 'Not given']);
  });
});
