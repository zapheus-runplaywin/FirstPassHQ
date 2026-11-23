/**
 * Selection rounds, phase 2: a round's dates (what an admin and the panel
 * read under each), the attendance line on an assessment, the Dates section
 * of the Selection audit report, and what Home says to an athlete or parent.
 * Dates are passed in, so nothing here depends on today. The database's side
 * is in supabase/tests/selection-dates.sql.
 */
import {
  MAX_MILESTONE_TITLE,
  MILESTONE_SUGGESTIONS,
  attendanceLine,
  dueLabel,
  isOverdue,
  makeCriteria,
  milestoneLine,
  milestoneProblem,
  selectionAuditReport,
  selectionInfoLabel,
  selectionInfoOwner,
  type Milestone,
  type SelectionAudit,
  type SelectionInfo,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

// The module loads auth and club context, which need native storage.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useFeature: jest.fn() }));

const d = formatDateString;
const TODAY = '2026-11-23';

function milestone(extra: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    title: 'Teams named',
    due_on: '2026-12-01',
    shared: true,
    done_at: null,
    done_by_name: null,
    removed_at: null,
    removed_by_name: null,
    created_by_name: 'Alex Admin',
    created_at: '2026-11-16T01:00:00Z',
    days_late: 0,
    ...extra,
  };
}

describe('milestoneProblem', () => {
  it('passes a named date with a day', () => {
    expect(milestoneProblem('Teams named', '2026-12-01')).toBeNull();
    expect(milestoneProblem('x'.repeat(MAX_MILESTONE_TITLE), '2026-12-01')).toBeNull();
  });

  it('asks for a name, even when only spaces are typed', () => {
    expect(milestoneProblem('', '2026-12-01')).toBe('Name the date, such as Teams named.');
    expect(milestoneProblem('   ', '2026-12-01')).toBe('Name the date, such as Teams named.');
  });

  it('keeps the name to 60 characters, not counting spaces around it', () => {
    expect(milestoneProblem('x'.repeat(MAX_MILESTONE_TITLE + 1), '2026-12-01')).toBe('Keep the name to 60 characters.');
    expect(milestoneProblem(` ${'x'.repeat(MAX_MILESTONE_TITLE)} `, '2026-12-01')).toBeNull();
  });

  it('asks for the day', () => {
    expect(milestoneProblem('Teams named', null)).toBe('Choose the day.');
  });

  it('offers the usual steps as suggestions, each short enough to save', () => {
    expect(MILESTONE_SUGGESTIONS).toContain('Teams named');
    for (const s of MILESTONE_SUGGESTIONS) expect(milestoneProblem(s, '2026-12-01')).toBeNull();
  });
});

describe('dueLabel and isOverdue', () => {
  it.each<[string, boolean, string, boolean]>([
    ['2026-11-23', false, 'Today', false],
    ['2026-11-24', false, 'Tomorrow', false],
    ['2026-11-25', false, 'In 2 days', false],
    ['2026-12-01', false, 'In 8 days', false],
    ['2026-11-22', false, '1 day overdue', true],
    ['2026-11-18', false, '5 days overdue', true],
    ['2026-11-18', true, 'Done', false],
    ['2026-12-01', true, 'Done', false],
  ])('due %s, done %s: %s', (due_on, done, label, overdue) => {
    expect(dueLabel({ due_on, done }, TODAY)).toBe(label);
    expect(isOverdue({ due_on, done }, TODAY)).toBe(overdue);
  });
});

describe('milestoneLine', () => {
  it('says when a date is due and who sees it', () => {
    expect(milestoneLine(milestone(), TODAY)).toBe(`${d('2026-12-01')} · In 8 days · athletes and parents see it`);
    expect(milestoneLine(milestone({ shared: false, due_on: '2026-11-20' }), TODAY)).toBe(
      `${d('2026-11-20')} · 3 days overdue · panel and admins only`,
    );
  });

  it('says who marked it done and when, and how late', () => {
    const done = milestone({ done_at: '2026-12-01T03:00:00Z', done_by_name: 'Alex Admin' });
    expect(milestoneLine(done, TODAY)).toBe(
      `${d('2026-12-01')} · Done ${d('2026-12-01')} by Alex Admin · athletes and parents see it`,
    );
    expect(milestoneLine({ ...done, done_at: '2026-12-04T03:00:00Z', days_late: 3 }, TODAY)).toContain(
      `Done ${d('2026-12-04')} by Alex Admin, 3 days late`,
    );
    expect(milestoneLine({ ...done, done_by_name: null, days_late: 1 }, TODAY)).toContain(
      `Done ${d('2026-12-01')}, 1 day late`,
    );
  });
});

describe('attendanceLine', () => {
  it('gives two counts and nothing else', () => {
    expect(attendanceLine({ sessions: 6, attended: 5 })).toBe('Marked at 5 of 6 sessions in this round');
    expect(attendanceLine({ sessions: 1, attended: 0 })).toBe('Marked at 0 of 1 session in this round');
  });

  it('says nothing when no session was held, or the counts didn’t come', () => {
    expect(attendanceLine({ sessions: 0, attended: 0 })).toBeNull();
    expect(attendanceLine(null)).toBeNull();
  });
});

describe('the audit report’s dates', () => {
  const audit: SelectionAudit = {
    round: {
      id: 'r1',
      name: '2027 selection phase',
      team_name: '17 & Under squad',
      season: 2027,
      starts_on: '2026-11-16',
      ends_on: '2026-12-20',
      opened_at: '2026-11-15T01:00:00Z',
      opened_by_name: 'Alex Admin',
      closed_at: null,
      closed_by_name: null,
      criteria_groups: 9,
      criteria_items: 33,
      athletes: 0,
      observations: 0,
      today: TODAY,
    },
    panel: [],
    selectors: [],
    athletes: [],
  };
  const dates = (report = selectionAuditReport(audit)) => report.sections.find((s) => s.title === 'Dates')!;

  it('comes second, after the round', () => {
    expect(selectionAuditReport(audit).sections.map((s) => s.title)).toEqual([
      'The round',
      'Dates',
      'The panel',
      'What each selector wrote',
      'Evidence about each athlete',
    ]);
  });

  it('says when no dates were set, with or without the list', () => {
    expect(dates().rows).toEqual([]);
    expect(dates(selectionAuditReport(audit, [])).rows).toEqual([]);
    expect(dates().empty).toBe('No dates were set for this round.');
  });

  it('lists each date with when it was due, done and by whom, how late and who sees it', () => {
    const rows = dates(
      selectionAuditReport(audit, [
        milestone({ title: 'Criteria shared', due_on: '2026-11-17', done_at: '2026-11-17T02:00:00Z', done_by_name: 'Alex Admin' }),
        milestone({ id: 'm2', title: 'Trials', due_on: '2026-11-19', done_at: '2026-11-21T02:00:00Z', done_by_name: null, days_late: 2 }),
        milestone({ id: 'm3', title: 'Panel meeting', due_on: '2026-11-22', shared: false, days_late: 1 }),
        milestone({ id: 'm4' }),
      ]),
    ).rows;
    expect(rows).toEqual([
      { cells: ['Criteria shared', d('2026-11-17'), `${d('2026-11-17')} by Alex Admin`, '', 'Yes'], flag: false },
      { cells: ['Trials', d('2026-11-19'), d('2026-11-21'), '2 days', 'Yes'], flag: true },
      { cells: ['Panel meeting', d('2026-11-22'), 'Not yet', '1 day', 'No'], flag: true },
      { cells: ['Teams named', d('2026-12-01'), 'Not yet', '', 'Yes'], flag: false },
    ]);
  });

  it('keeps a date that was taken off, with who took it off, and never flags it', () => {
    const rows = dates(
      selectionAuditReport(audit, [
        milestone({ removed_at: '2026-11-20T02:00:00Z', removed_by_name: 'Alex Admin', due_on: '2026-11-19', days_late: 4 }),
        milestone({ id: 'm2', removed_at: '2026-11-20T02:00:00Z', removed_by_name: null }),
        milestone({
          id: 'm3',
          due_on: '2026-11-17',
          done_at: '2026-11-19T02:00:00Z',
          done_by_name: 'Alex Admin',
          days_late: 2,
          removed_at: '2026-11-20T02:00:00Z',
          removed_by_name: 'Alex Admin',
        }),
      ]),
    ).rows;
    expect(rows).toEqual([
      { cells: [`Teams named (taken off ${d('2026-11-20')} by Alex Admin)`, d('2026-11-19'), '', '', 'Yes'], flag: false },
      { cells: [`Teams named (taken off ${d('2026-11-20')})`, d('2026-12-01'), '', '', 'Yes'], flag: false },
      {
        cells: [
          `Teams named (taken off ${d('2026-11-20')} by Alex Admin)`,
          d('2026-11-17'),
          `${d('2026-11-19')} by Alex Admin`,
          '2 days',
          'Yes',
        ],
        flag: false,
      },
    ]);
  });
});

describe('what Home tells an athlete or parent', () => {
  function info(extra: Partial<SelectionInfo> = {}): SelectionInfo {
    return {
      round_id: 'r1',
      round_name: '2027 selection phase',
      team_name: '17 & Under squad',
      athlete_id: 'a1',
      athlete_name: 'Jordan Junior',
      is_me: true,
      starts_on: '2026-11-16',
      ends_on: '2026-12-20',
      criteria: makeCriteria([{ name: 'Technical ability', items: ['Passing'] }]),
      dates: [
        { title: 'Criteria shared', due_on: '2026-11-17', done: true },
        { title: 'Trials', due_on: '2026-11-23', done: false },
        { title: 'Teams named', due_on: '2026-12-01', done: false },
      ],
      ...extra,
    };
  }

  it('names the round and its next date, counting today', () => {
    expect(selectionInfoLabel([info()], TODAY)).toBe(`2027 selection phase · next: Trials, ${d('2026-11-23')}`);
    expect(selectionInfoLabel([info()], '2026-11-24')).toBe(`2027 selection phase · next: Teams named, ${d('2026-12-01')}`);
  });

  it('skips dates that are done or past', () => {
    const done = info({ dates: [{ title: 'Trials', due_on: '2026-11-25', done: true }, { title: 'Teams named', due_on: '2026-12-01', done: false }] });
    expect(selectionInfoLabel([done], TODAY)).toContain('next: Teams named');
    expect(selectionInfoLabel([info()], '2026-12-02')).toBe('2027 selection phase · criteria and dates');
    expect(selectionInfoLabel([info({ dates: [] })], TODAY)).toBe('2027 selection phase · criteria and dates');
  });

  it('takes the soonest date across a parent’s children, naming one round once', () => {
    const second = info({ athlete_id: 'a2', is_me: false });
    expect(selectionInfoLabel([info(), second], TODAY)).toBe(`2027 selection phase · next: Trials, ${d('2026-11-23')}`);
    const other = info({
      round_id: 'r2',
      round_name: 'Opens selection',
      dates: [{ title: 'Trial day', due_on: '2026-11-22', done: false }, { title: 'Squad named', due_on: '2026-11-28', done: false }],
    });
    expect(selectionInfoLabel([other, info({ dates: [{ title: 'Teams named', due_on: '2026-12-01', done: false }] })], TODAY)).toBe(
      `2 selection rounds · next: Squad named, ${d('2026-11-28')}`,
    );
  });

  it('says nothing with no round', () => {
    expect(selectionInfoLabel([], TODAY)).toBe('');
  });

  it('names whose round it is', () => {
    expect(selectionInfoOwner(info())).toBe('You');
    expect(selectionInfoOwner(info({ is_me: false }))).toBe('Jordan Junior');
    expect(selectionInfoOwner(info({ is_me: false, athlete_name: null }))).toBe('Your child');
  });
});
