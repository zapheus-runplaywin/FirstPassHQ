/**
 * The other governance reports in src/lib/reports.ts, and its helpers:
 * Integrity training, Attendance (with reported absences), Award results,
 * Affiliation and the affiliation return, Injuries, Session plans and Season
 * KPIs. What each must hold is in section 10 of the user guide ("Reports",
 * "Injury report" and "Affiliation"). The Working With Children Checks and
 * Under 18s reports have their own files.
 */
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { Affiliation, Officer, Registration } from '@/lib/affiliation';
import { formatDateString } from '@/lib/injuries';
import {
  absenceBreakdown,
  affiliationReport,
  affiliationReturn,
  attendanceReport,
  awardReport,
  chunk,
  fetchAll,
  fileSlug,
  injuryReport,
  integrityReport,
  kpiReport,
  localDay,
  memberName,
  rateLabel,
  sessionPlanReport,
  sharePdf,
  standings,
  type AttendanceMarkRow,
  type AttendanceSessionRow,
  type CourseProgress,
  type KpiReportRow,
  type SessionPlanReportRow,
  type TurnoutRow,
  type VoteBreakdownRow,
} from '@/lib/reports';
import type { InjuryReportRow } from '@/lib/types';

import { noon, REPORT_DAY } from '../../__tests__/helpers/report-fixtures';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => {
  class MockFile {
    static written: { uri: string; bytes: Uint8Array }[] = [];
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    write(bytes: Uint8Array) {
      MockFile.written.push({ uri: this.uri, bytes });
    }
  }
  return { File: MockFile, Paths: { cache: 'file:///cache' } };
});

beforeEach(() => {
  jest.useFakeTimers({ now: REPORT_DAY });
});

afterEach(() => {
  jest.useRealTimers();
});

const day = (d: string) => formatDateString(d);
const cellsOf = (section: { rows: { cells: string[] }[] }) => section.rows.map((r) => r.cells);
const stats = (report: { stats?: { label: string; value: string | number }[] }) =>
  Object.fromEntries((report.stats ?? []).map((s) => [s.label, s.value]));

// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('fileSlug makes a file-name-safe slug', () => {
    expect(fileSlug('West Coast Thunder')).toBe('west-coast-thunder');
    expect(fileSlug('  Under 18s & their guardians! ')).toBe('under-18s-their-guardians');
    expect(fileSlug('***')).toBe('report');
  });

  it('memberName falls back to the email, then a placeholder', () => {
    expect(memberName({ full_name: 'Alex', email: 'a@x' })).toBe('Alex');
    expect(memberName({ full_name: '', email: 'a@x' })).toBe('a@x');
    expect(memberName({ full_name: null, email: null })).toBe('Unnamed member');
  });

  it('localDay gives the local day of a time', () => {
    expect(localDay(noon('2026-10-07'))).toBe(day('2026-10-07'));
  });

  it('rateLabel rounds to a whole percentage, blank when nothing was marked', () => {
    expect(rateLabel(2, 3)).toBe('67%');
    expect(rateLabel(1, 8)).toBe('13%');
    expect(rateLabel(0, 4)).toBe('0%');
    expect(rateLabel(0, 0)).toBe('');
  });

  it('chunk splits a list into pieces of at most the size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([])).toEqual([]);
    expect(chunk(Array.from({ length: 301 }, (_, i) => i)).map((c) => c.length)).toEqual([150, 150, 1]);
  });

  describe('fetchAll', () => {
    it('asks for 1,000 rows at a time until a page comes back short', async () => {
      const asked: [number, number][] = [];
      const rows = await fetchAll<number>(async (from, to) => {
        asked.push([from, to]);
        const size = from < 2000 ? 1000 : 3;
        return { data: Array.from({ length: size }, (_, i) => from + i), error: null };
      });
      expect(asked).toEqual([
        [0, 999],
        [1000, 1999],
        [2000, 2999],
      ]);
      expect(rows).toHaveLength(2003);
      expect(rows[2002]).toBe(2002);
    });

    it('stops after an exactly full page followed by an empty one, and copes with null', async () => {
      let calls = 0;
      const rows = await fetchAll(async () => {
        calls += 1;
        return { data: calls === 1 ? Array.from({ length: 1000 }, () => 1) : null, error: null };
      });
      expect(calls).toBe(2);
      expect(rows).toHaveLength(1000);
    });

    it('fails with the database’s message', async () => {
      await expect(fetchAll(async () => ({ data: null, error: { message: 'permission denied' } }))).rejects.toThrow(
        'permission denied',
      );
    });
  });

  describe('sharePdf', () => {
    const written = (File as unknown as { written: { uri: string; bytes: Uint8Array }[] }).written;

    beforeEach(() => {
      written.length = 0;
      (Sharing.shareAsync as jest.Mock).mockClear();
    });

    it('on a phone, writes the file to the cache and opens the share sheet as a PDF', async () => {
      const bytes = new Uint8Array([37, 80, 68, 70]);
      await sharePdf('sample-report.pdf', bytes);
      expect(written).toEqual([{ uri: 'file:///cache/sample-report.pdf', bytes }]);
      expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/sample-report.pdf', {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'sample-report.pdf',
      });
    });

    it('on the web, downloads it instead', async () => {
      const os = jest.replaceProperty(Platform, 'OS', 'web');
      const link = { href: '', download: '', click: jest.fn() };
      const g = globalThis as unknown as { document?: unknown };
      const hadDocument = 'document' in g;
      const previous = g.document;
      g.document = { createElement: jest.fn(() => link) };
      const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
      const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      try {
        await sharePdf('sample-report.pdf', new Uint8Array([1]));
        expect(link).toMatchObject({ href: 'blob:report', download: 'sample-report.pdf' });
        expect(link.click).toHaveBeenCalled();
        expect(revoke).toHaveBeenCalledWith('blob:report');
        expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/pdf');
        expect(Sharing.shareAsync).not.toHaveBeenCalled();
        expect(written).toHaveLength(0);
      } finally {
        os.restore();
        create.mockRestore();
        revoke.mockRestore();
        if (hadDocument) g.document = previous;
        else delete g.document;
      }
    });
  });
});

// ---------------------------------------------------------------------------

describe('integrityReport', () => {
  const member = (
    profile_id: string,
    status: CourseProgress['members'][number]['status'],
    extra: Partial<CourseProgress['members'][number]> = {},
  ) => ({
    profile_id,
    full_name: `Sample ${profile_id}`,
    status,
    completed_on: null,
    reviewed_by_name: null,
    reviewed_at: null,
    ...extra,
  });

  const courses: CourseProgress[] = [
    {
      name: 'Safeguarding Children',
      due_on: '2026-10-01',
      members: [
        member('cara', 'approved', { completed_on: '2026-09-10', reviewed_by_name: 'Sample admin', reviewed_at: noon('2026-09-12') }),
        member('ali', 'to_do'),
        member('bo', 'submitted', { completed_on: '2026-09-30', reviewed_by_name: 'Old reviewer' }),
      ],
    },
    {
      name: 'Anti-Doping',
      due_on: '2026-12-01',
      members: [
        member('cara', 'sent_back', { completed_on: '2026-10-02', reviewed_by_name: 'Sample admin', reviewed_at: noon('2026-10-03') }),
        member('dee', 'approved'),
        member('ali', 'to_do', { full_name: null }),
      ],
    },
  ];
  const report = integrityReport('2026–27', courses, '2026-10-18');

  it('names the season', () => {
    expect(report.title).toBe('Integrity training');
    expect(report.subtitle).toBe('Sports Integrity Australia courses for 2026–27');
  });

  it('lists everyone with a course not approved, in red once a due date has passed', () => {
    const [still] = report.sections;
    expect(still.title).toBe('Still to finish');
    expect(cellsOf(still)).toEqual([
      ['Sample ali', 'Safeguarding Children\nAnti-Doping'],
      ['Sample bo', 'Safeguarding Children (waiting to be checked)'],
      ['Sample cara', 'Anti-Doping (sent back)'],
    ]);
    // Cara's outstanding course isn't due yet.
    expect(still.rows.map((r) => r.flag)).toEqual([true, true, false]);
  });

  it('lists each course with where each member is up to and who checked it', () => {
    const [, safeguarding, antiDoping] = report.sections;
    expect(safeguarding.title).toBe('Safeguarding Children');
    expect(safeguarding.note).toBe(`Due ${day('2026-10-01')} · 1 of 3 approved`);
    expect(cellsOf(safeguarding)).toEqual([
      ['Sample ali', 'To do', '', ''],
      // Waiting to be checked: an earlier reviewer isn't shown.
      ['Sample bo', 'Waiting to be checked', '30/09/2026', ''],
      ['Sample cara', 'Approved', '10/09/2026', 'Sample admin, 12/09/2026'],
    ]);
    expect(safeguarding.rows.map((r) => r.flag)).toEqual([true, true, false]);
    expect(antiDoping.note).toBe(`Due ${day('2026-12-01')} · 1 of 3 approved`);
    expect(cellsOf(antiDoping)).toEqual([
      ['Unnamed member', 'To do', '', ''],
      ['Sample cara', 'Sent back', '02/10/2026', 'Sample admin, 03/10/2026'],
      ['Sample dee', 'Approved', '', ''],
    ]);
    expect(antiDoping.rows.every((r) => !r.flag)).toBe(true);
  });

  it('counts the courses, the members, who is done and who is overdue', () => {
    expect(stats(report)).toEqual({
      Courses: 2,
      'Members who must complete one': 4,
      'All done': 1,
      'Still to finish': 3,
      'Past a due date': 2,
    });
  });

  it('isn’t overdue on the due date itself', () => {
    const due = integrityReport('2026–27', [{ ...courses[0], due_on: '2026-10-18' }], '2026-10-18');
    expect(due.sections[0].rows.every((r) => !r.flag)).toBe(true);
    expect(stats(due)['Past a due date']).toBe(0);
  });

  it('says so when everyone has finished or nobody has to', () => {
    const empty = integrityReport('2026–27', [{ name: 'X', due_on: '2026-10-01', members: [] }], '2026-10-18');
    expect(empty.sections.map((s) => [s.rows.length, s.empty])).toEqual([
      [0, 'Everyone has finished their training.'],
      [0, 'Nobody has to complete it.'],
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('attendance', () => {
  const session = (id: string, held_at: string, extra: Partial<AttendanceSessionRow> = {}): AttendanceSessionRow => ({
    id,
    club_wide: false,
    team_id: 't-open-a',
    team_name: 'Open A',
    name: 'Training',
    held_at,
    taken_by_name: 'Sample coach',
    ...extra,
  });
  const sessions = [
    session('s2', noon('2026-10-08')),
    session('s1', noon('2026-10-01'), { name: 'Match prep' }),
    session('c1', noon('2026-10-04'), { club_wide: true, team_id: null, team_name: 'ignored', name: 'Club day', taken_by_name: null }),
  ];
  const mark = (session_id: string, profile_id: string, present: boolean, member_name: string | null = null): AttendanceMarkRow => ({
    session_id,
    profile_id,
    present,
    member_name,
  });
  const marks = [
    mark('s1', 'amy', true),
    mark('s2', 'amy', false),
    mark('s1', 'ben', true),
    mark('s2', 'ben', true),
    mark('s2', 'gone', true, 'Gail Left'),
    mark('c1', 'amy', true),
    mark('c1', 'nobody', false),
  ];
  const names = new Map([
    ['amy', 'Amy Sample'],
    ['ben', 'Ben Sample'],
  ]);

  describe('absenceBreakdown', () => {
    it('counts absences, athletes and the days inside the period, in the club’s order of reasons', () => {
      const rows = absenceBreakdown(
        [
          { athlete_id: 'amy', from_day: '2026-09-28', to_day: '2026-10-03', category: 'Personal illness', category_order: 2 },
          { athlete_id: 'amy', from_day: '2026-10-10', to_day: '2026-10-10', category: 'Personal illness', category_order: 2 },
          { athlete_id: 'ben', from_day: '2026-10-05', to_day: '2026-10-25', category: 'Planned holidays', category_order: 1 },
          { athlete_id: 'cal', from_day: '2026-10-02', to_day: '2026-10-02', category: null, category_order: null },
        ],
        '2026-10-01',
        '2026-10-18',
      );
      expect(rows).toEqual([
        { label: 'Planned holidays', absences: 1, athletes: 1, days: 14 },
        // 1 to 3 October, and 10 October.
        { label: 'Personal illness', absences: 2, athletes: 1, days: 4 },
        { label: 'Not given (reported before reasons)', absences: 1, athletes: 1, days: 1 },
      ]);
    });

    it('orders reasons with the same place by name', () => {
      const rows = absenceBreakdown(
        [
          { athlete_id: 'a', from_day: '2026-10-01', to_day: '2026-10-01', category: 'Work', category_order: 1 },
          { athlete_id: 'a', from_day: '2026-10-01', to_day: '2026-10-01', category: 'School', category_order: 1 },
        ],
        '2026-10-01',
        '2026-10-01',
      );
      expect(rows.map((r) => r.label)).toEqual(['School', 'Work']);
    });

    it('counts whole days across the start of daylight saving in early October', () => {
      // Days are counted from the dates alone, so a clock change inside the period doesn't matter.
      const [row] = absenceBreakdown(
        [{ athlete_id: 'a', from_day: '2026-09-30', to_day: '2026-10-10', category: 'Work', category_order: 1 }],
        '2026-09-01',
        '2026-10-31',
      );
      expect(row.days).toBe(11);
    });
  });

  const report = attendanceReport(
    `${day('2026-09-20')} to ${day('2026-10-18')}`,
    'All squads, teams and club events',
    sessions,
    marks,
    names,
    {
      rows: [{ athlete_id: 'amy', from_day: '2026-10-08', to_day: '2026-10-09', category: 'Personal illness', category_order: 1 }],
      from: '2026-09-20',
      to: '2026-10-18',
    },
  );

  it('names the period and groups', () => {
    expect(report.title).toBe('Attendance');
    expect(report.subtitle).toBe(`${day('2026-09-20')} to ${day('2026-10-18')} · All squads, teams and club events`);
  });

  it('totals the sessions, athletes, times present, rate and reported absences', () => {
    expect(stats(report)).toEqual({
      Sessions: 3,
      Athletes: 4,
      'Times present': 5,
      Attendance: '71%',
      'Reported absences': 1,
    });
  });

  it('gives each group its athletes’ attendance, by name, with a deleted member kept by name', () => {
    const [openA, club] = report.sections;
    expect(openA.title).toBe('Open A');
    expect(openA.note).toBe('2 sessions');
    expect(cellsOf(openA)).toEqual([
      ['Amy Sample', '1', '1', '50%'],
      ['Ben Sample', '2', '0', '100%'],
      ['Gail Left (deleted)', '1', '0', '100%'],
    ]);
    expect(club.title).toBe('Whole club');
    expect(club.note).toBe('1 session');
    expect(cellsOf(club)).toEqual([
      ['Amy Sample', '1', '0', '100%'],
      ['Unnamed member', '0', '1', '0%'],
    ]);
  });

  it('lists every session by date with who took it', () => {
    const sessionsSection = report.sections.find((s) => s.title === 'Sessions')!;
    expect(cellsOf(sessionsSection)).toEqual([
      [day('2026-10-01'), 'Open A', 'Match prep', '2', '0', '100%', 'Sample coach'],
      [day('2026-10-04'), 'Whole club', 'Club day', '1', '1', '50%', ''],
      [day('2026-10-08'), 'Open A', 'Training', '2', '1', '67%', 'Sample coach'],
    ]);
  });

  it('counts reported absences by reason, never their details', () => {
    const absences = report.sections[report.sections.length - 1];
    expect(absences.title).toBe('Reported absences by reason');
    expect(absences.columns.map((c) => c.label)).toEqual(['Reason', 'Absences', 'Athletes', 'Days away']);
    expect(cellsOf(absences)).toEqual([['Personal illness', '1', '1', '2']]);
  });

  it('leaves out the absences section when no absences are given, and shows a dash with nothing marked', () => {
    const empty = attendanceReport('p', 'g', [], [], new Map());
    expect(empty.sections.map((s) => s.title)).toEqual(['Sessions']);
    expect(empty.sections[0].empty).toBe('No attendance taken in this period.');
    expect(stats(empty)).toEqual({ Sessions: 0, Athletes: 0, 'Times present': 0, Attendance: '–' });
  });
});

// ---------------------------------------------------------------------------

describe('award results', () => {
  const vote = (
    nominee_key: string,
    rank: number,
    votes: number,
    points: number,
    extra: Partial<VoteBreakdownRow> = {},
  ): VoteBreakdownRow => ({
    team_id: null,
    fixture_id: null,
    fixture_label: null,
    starts_at: null,
    preseason: false,
    nominee_key,
    nominee_name: `Sample ${nominee_key}`,
    rank,
    votes,
    points,
    ...extra,
  });

  describe('standings', () => {
    it('adds the points, counts votes at each place and shares equal places', () => {
      const table = standings(
        [vote('a', 1, 2, 6), vote('a', 3, 1, 1), vote('b', 1, 1, 3), vote('b', 2, 2, 4), vote('c', 2, 1, 2), vote('d', 3, 2, 2)],
        3,
        0,
      );
      expect(table.map((t) => [t.place, t.name, t.score, t.votes, t.byRank])).toEqual([
        ['=1', 'Sample a', 7, 3, [2, 0, 1]],
        ['=1', 'Sample b', 7, 3, [1, 2, 0]],
        ['=3', 'Sample c', 2, 1, [0, 1, 0]],
        ['=3', 'Sample d', 2, 2, [0, 0, 2]],
      ]);
    });

    it('weighs the preseason vote and the matches by their shares of the points', () => {
      const table = standings(
        [
          vote('a', 1, 1, 3, { preseason: true }),
          vote('b', 2, 1, 1, { preseason: true }),
          vote('a', 1, 1, 1),
          vote('b', 1, 3, 3),
        ],
        1,
        40,
      );
      // a: 40 × 3/4 + 60 × 1/4 = 45; b: 40 × 1/4 + 60 × 3/4 = 55.
      expect(table.map((t) => [t.place, t.name, t.score, t.pre, t.main])).toEqual([
        ['1', 'Sample b', 55, 1, 3],
        ['2', 'Sample a', 45, 3, 1],
      ]);
    });

    it('rounds a weighted score to one decimal, and copes with no match points', () => {
      const table = standings([vote('a', 1, 1, 1, { preseason: true }), vote('b', 1, 2, 2, { preseason: true })], 1, 50);
      expect(table.map((t) => t.score)).toEqual([33.3, 16.7]);
    });
  });

  const award = { name: 'Best and Fairest', closes_at: noon('2026-10-10'), points: [3, 2, 1], by_match: true, preseason_weight: 0 };
  const turnout: TurnoutRow[] = [
    { team_id: 't1', fixture_id: 'f1', fixture_label: 'Round 1 v Sample Rivals', starts_at: noon('2026-09-05'), preseason: false, ballots: 2, voters: 3 },
    { team_id: 't1', fixture_id: 'f2', fixture_label: null, starts_at: null, preseason: false, ballots: 1, voters: 3 },
    { team_id: 't2', fixture_id: 'f9', fixture_label: 'Round 1', starts_at: noon('2026-09-06'), preseason: false, ballots: 0, voters: 4 },
  ];
  const breakdown = [
    vote('amy', 1, 2, 6, { team_id: 't1', fixture_id: 'f1' }),
    vote('ben', 2, 2, 4, { team_id: 't1', fixture_id: 'f1' }),
    vote('ben', 1, 1, 3, { team_id: 't1', fixture_id: 'f2' }),
    vote('amy', 3, 1, 1, { team_id: 't1', fixture_id: 'f2' }),
  ];
  const report = awardReport({
    award,
    seasonName: '2026–27',
    summary: 'Match award · Open A and Open B',
    groups: [
      { id: 't1', name: 'Open A' },
      { id: 't2', name: 'Open B' },
    ],
    breakdown,
    turnout,
  });

  it('names the award, season, closing day and what it was', () => {
    expect(report.title).toBe('Best and Fairest results');
    expect(report.subtitle).toBe(`2026–27 · Closed ${day('2026-10-10')} · Match award · Open A and Open B`);
    expect(report.landscape).toBe(false);
  });

  it('counts ballots, nominees and groups', () => {
    expect(stats(report)).toEqual({ 'Ballots cast': 3, 'Nominees voted for': 2, 'Squads and teams': 2 });
  });

  it('gives each group standings with points, votes and votes at each place', () => {
    const [standingsA, matchesA, standingsB] = report.sections;
    expect(standingsA.title).toBe('Standings · Open A');
    expect(standingsA.note).toBe('3 ballots over 2 matches.');
    expect(standingsA.columns.map((c) => c.label)).toEqual(['Place', 'Nominee', 'Points', 'Votes', '1st (3)', '2nd (2)', '3rd (1)']);
    // Equal points share the place.
    expect(cellsOf(standingsA)).toEqual([
      ['=1', 'Sample amy', '7', '3', '2', '0', '1'],
      ['=1', 'Sample ben', '7', '3', '1', '2', '0'],
    ]);
    expect(matchesA.title).toBe('Match by match · Open A');
    expect(cellsOf(matchesA)).toEqual([
      ['Round 1 v Sample Rivals', day('2026-09-05'), '2 of 3', 'Sample amy 6 · Sample ben 4'],
      ['Match', '', '1 of 3', 'Sample ben 3 · Sample amy 1'],
    ]);
    expect(standingsB.title).toBe('Standings · Open B');
    expect(standingsB.rows).toHaveLength(0);
    expect(standingsB.empty).toBe('No votes.');
    expect(cellsOf(report.sections[3])).toEqual([['Round 1', day('2026-09-06'), '0 of 4', 'No votes']]);
  });

  it('keeps ballots secret: no voter is named anywhere', () => {
    expect(report.footnote).toBe(
      'Ballots are secret: this shows how many votes each nominee got at each place, not who voted for whom.',
    );
    const shown = JSON.stringify(report.sections);
    expect(shown).not.toMatch(/voter|ballot_id|voted by/i);
  });

  it('shows the turnout of a one-off award, and a single Votes column when there is one place', () => {
    const once = awardReport({
      award: { ...award, by_match: false, points: [1] },
      seasonName: '2026–27',
      summary: 'Club award',
      groups: [{ id: null, name: 'Club' }],
      breakdown: [vote('amy', 1, 4, 4), vote('ben', 1, 2, 2)],
      turnout: [{ team_id: null, fixture_id: null, fixture_label: null, starts_at: null, preseason: false, ballots: 6, voters: 20 }],
    });
    expect(once.sections).toHaveLength(1);
    expect(once.sections[0].title).toBe('Standings');
    expect(once.sections[0].note).toBe('6 of 20 who could vote cast a ballot.');
    expect(once.sections[0].columns.map((c) => c.label)).toEqual(['Place', 'Nominee', 'Points', 'Votes']);
    expect(cellsOf(once.sections[0])).toEqual([
      ['1', 'Sample amy', '4', '4'],
      ['2', 'Sample ben', '2', '2'],
    ]);
    expect(stats(once)).toEqual({ 'Ballots cast': 6, 'Nominees voted for': 2 });
  });

  it('shows a weighted award’s score, both kinds of points and how it is worked out, across the page', () => {
    const weighted = awardReport({
      award: { ...award, preseason_weight: 40, points: [1] },
      seasonName: '2026–27',
      summary: 'Match award',
      groups: [{ id: null, name: 'Club' }],
      breakdown: [vote('a', 1, 3, 3, { preseason: true }), vote('b', 1, 1, 1, { preseason: true }), vote('a', 1, 1, 1, { fixture_id: 'f1' }), vote('b', 1, 3, 3, { fixture_id: 'f1' })],
      turnout: [
        { team_id: null, fixture_id: null, fixture_label: null, starts_at: null, preseason: true, ballots: 4, voters: 5 },
        { team_id: null, fixture_id: 'f1', fixture_label: 'Round 1', starts_at: null, preseason: false, ballots: 4, voters: 5 },
      ],
    });
    expect(weighted.landscape).toBe(true);
    const [table, matches] = weighted.sections;
    expect(table.note).toBe('8 ballots over 1 matches and the preseason vote.');
    expect(table.columns.map((c) => c.label)).toEqual(['Place', 'Nominee', 'Score', 'Preseason points', 'Match points', 'Votes']);
    expect(cellsOf(table)).toEqual([
      ['1', 'Sample b', '55.0%', '1', '3', '4'],
      ['2', 'Sample a', '45.0%', '3', '1', '4'],
    ]);
    expect(cellsOf(matches).map((r) => r[0])).toEqual(['Preseason vote', 'Round 1']);
    expect(cellsOf(matches)[0][3]).toBe('Sample a 3 · Sample b 1');
    expect(weighted.footnote).toMatch(/^Score is 40% the share of preseason points and 60% the share of match points\./);
  });

  it('prints across the page with more than three places', () => {
    expect(
      awardReport({ award: { ...award, points: [5, 4, 3, 2, 1] }, seasonName: 's', summary: 's', groups: [], breakdown: [], turnout: [] }).landscape,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('affiliation', () => {
  function affiliation(overrides: Partial<Affiliation> = {}): Affiliation {
    return {
      member_type: 'club',
      tier: null,
      incorporation_number: 'A1234567X',
      affiliated_with: 'Sample Netball Association',
      registered_on: '2026-03-01',
      primary_contact_1_id: 'p1',
      primary_contact_1_name: 'Pat Contact',
      primary_contact_2_id: null,
      primary_contact_2_name: null,
      checks: {},
      notes: null,
      updated_at: null,
      updated_by_name: null,
      season: 2026,
      team_count: 3,
      registrations_total: 5,
      registered: 2,
      not_registered: 1,
      ...overrides,
    };
  }
  const registration = (name: string, registered: boolean | null, extra: Partial<Registration> = {}): Registration => ({
    profile_id: name,
    name,
    playhq_email: null,
    email: null,
    team_roles: ['athlete'],
    groups: ['Open A'],
    registered,
    checked_at: null,
    checked_by_name: null,
    ...extra,
  });
  const registrations = [
    registration('Zed Registered', true, { checked_at: noon('2026-10-01'), checked_by_name: 'Sample admin' }),
    registration('Amy ToCheck', null, { team_roles: ['coach', 'manager'], groups: ['Open A', '17 & Under A'] }),
    registration('Bea Registered', true, { checked_at: noon('2026-10-02') }),
    registration('Cy NotRegistered', false, { team_roles: ['umpire'] }),
  ];

  describe('affiliationReport', () => {
    const report = affiliationReport(affiliation(), [], registrations);

    it('describes the club and the policy the criteria come from', () => {
      expect(report.title).toBe('Affiliation');
      expect(report.subtitle).toBe('Affiliated club. Criteria from Netball WA’s Membership Policy (NWA-POL-07).');
    });

    it('counts required items done and this season’s registrations', () => {
      const s = stats(report);
      expect(s['Required items done']).toMatch(/^\d+ of \d+$/);
      expect(s).toMatchObject({ 'Registered in PlayHQ 2026–27': '2 of 5', 'Not registered': 1, 'Still to check': 2 });
    });

    it('lists the details, flagging fewer than two primary contacts for a club', () => {
      const details = report.sections[0];
      expect(cellsOf(details)).toEqual([
        ['Incorporation number', 'A1234567X'],
        ['Affiliated with', 'Sample Netball Association'],
        ['Last registered', day('2026-03-01')],
        ['Primary contacts', 'Pat Contact'],
        ['Teams this season', '3 in 2026–27'],
      ]);
      expect(details.rows.map((r) => !!r.flag)).toEqual([false, false, false, true, false]);
    });

    it('flags a registration more than a year old, and records nothing as Not recorded', () => {
      const details = affiliationReport(
        affiliation({ registered_on: '2025-10-17', incorporation_number: null, affiliated_with: null, primary_contact_1_name: null, notes: 'Evidence in the shared drive' }),
        [],
        [],
      ).sections[0];
      expect(cellsOf(details)).toEqual([
        ['Incorporation number', 'Not recorded'],
        ['Affiliated with', 'Not recorded'],
        ['Last registered', day('2025-10-17')],
        ['Primary contacts', 'None named'],
        ['Teams this season', '3 in 2026–27'],
        ['Notes', 'Evidence in the shared drive'],
      ]);
      expect(details.rows[2].flag).toBe(true);
    });

    it('shows the checklist with required items not done in red, and no officers for a club', () => {
      const checklist = report.sections[1];
      expect(checklist.title).toBe('Checklist');
      expect(checklist.columns.map((c) => c.label)).toEqual(['Item', 'Need', 'Done', 'How it’s known']);
      for (const row of checklist.rows) {
        expect(row.flag).toBe(row.cells[1] === 'Required' && row.cells[2] === 'No');
        expect(['Ticked by an admin', 'From the app’s records']).toContain(row.cells[3]);
      }
      const missing = checklist.rows.filter((r) => r.flag).length;
      expect(checklist.note).toBe(missing ? `${missing} required ${missing === 1 ? 'item' : 'items'} not done yet, shown in red.` : undefined);
      expect(report.sections.map((s) => s.title)).toEqual(['Details', 'Checklist', 'PlayHQ registrations 2026–27']);
    });

    it('lists registrations not registered first, then to check, then registered, each by name', () => {
      const regs = report.sections[2];
      expect(cellsOf(regs)).toEqual([
        ['Cy NotRegistered', 'umpire', 'Open A', 'Not registered', ''],
        ['Amy ToCheck', 'Coach, Manager', 'Open A\n17 & Under A', 'To check', ''],
        ['Bea Registered', 'Athlete', 'Open A', 'Registered', day('2026-10-02')],
        ['Zed Registered', 'Athlete', 'Open A', 'Registered', `${day('2026-10-01')}\nSample admin`],
      ]);
      expect(regs.rows.map((r) => r.flag)).toEqual([true, true, false, false]);
    });

    it('for an association, names its tier and lists its officers and their induction', () => {
      const officers: Officer[] = [
        { office: 'president', profile_id: 'p', name: 'Pres Sample', inducted_on: '2026-05-01' },
        { office: 'ado', profile_id: 'a', name: 'Ado Sample', inducted_on: null },
      ];
      const assoc = affiliationReport(affiliation({ member_type: 'association', tier: 2 }), officers, []);
      expect(assoc.subtitle).toBe('Association, Tier 2 (250 to 449). Criteria from Netball WA’s Membership Policy (NWA-POL-07).');
      expect(cellsOf(assoc.sections[0])[2][0]).toBe('Annual agreement signed');
      // An association isn't flagged for primary contacts.
      expect(assoc.sections[0].rows[3].flag).toBe(false);
      const officerSection = assoc.sections.find((s) => s.title === 'Officers and safeguarding induction')!;
      expect(cellsOf(officerSection)).toEqual([
        ['President', 'Pres Sample', day('2026-05-01')],
        ['Association Development Officer', 'Ado Sample', 'Not recorded'],
        ['Association Umpire Development Officer', 'Nobody named', 'Not recorded'],
      ]);
      expect(officerSection.rows.map((r) => r.flag)).toEqual([false, true, true]);
    });

    it('has no season figures when there are no squads or teams', () => {
      const none = affiliationReport(affiliation({ season: null }), [], []);
      expect(Object.keys(stats(none))).toEqual(['Required items done']);
      expect(none.sections[none.sections.length - 1].title).toBe('PlayHQ registrations');
      expect(none.sections[none.sections.length - 1].empty).toBe('Nobody is in a squad or team this season.');
    });
  });

  describe('affiliationReturn', () => {
    const wwcc = [
      { label: 'Need a check', value: 12 },
      { label: 'Expired', value: 1 },
    ];
    const ret = affiliationReturn({
      clubName: 'Sample Club',
      affiliation: affiliation({ primary_contact_2_name: 'Sam Contact', primary_contact_2_id: 'p2' }),
      officers: [],
      contacts: [
        { name: 'Pat Contact', email: 'pat@example.test' },
        { name: 'Sam Contact', email: null },
      ],
      safeguarding: {
        contacts: {
          child_safety_officer_name: 'Cass Officer',
          complaints_manager_name: null,
          policy_url: 'https://example.test/old-policy',
        } as never,
        policies: { safeguarding_policy_url: null, code_of_conduct_url: 'https://example.test/conduct', privacy_policy_url: null, policy_version: '3' } as never,
        wwcOfficerName: null,
      },
      wwcc,
      training: { season: '2026–27', stats: [{ label: 'Courses', value: 2 }] },
      today: new Date(2026, 9, 18, 12),
    });

    it('names the club and the day, and says it holds counts only', () => {
      expect(ret.title).toBe('Affiliation return');
      expect(ret.subtitle).toBe(
        `Sample Club: affiliated club, as at ${day('2026-10-18')}. Criteria from Netball WA’s Membership Policy (NWA-POL-07).`,
      );
      expect(ret.footnote).toContain('It names no member under 18 and has no details about any child.');
    });

    it('holds the sections the guide lists, in order', () => {
      expect(ret.sections.map((s) => s.title)).toEqual([
        'Details',
        'Primary contacts',
        'Checklist',
        'PlayHQ registrations 2026–27',
        'Safeguarding',
        'Working With Children Checks',
        'Integrity training 2026–27',
      ]);
      expect(stats(ret)).toMatchObject({ 'Teams in 2026–27': 3, 'Registered in PlayHQ 2026–27': '2 of 5' });
    });

    it('lists the primary contacts with their emails', () => {
      expect(cellsOf(ret.sections[1])).toEqual([
        ['Pat Contact', 'pat@example.test'],
        ['Sam Contact', ''],
      ]);
    });

    it('gives registration figures only, never names', () => {
      const regs = ret.sections[3];
      expect(cellsOf(regs)).toEqual([
        ['People', '5'],
        ['Registered', '2'],
        ['Not registered', '1'],
        ['Still to check', '2'],
      ]);
      expect(regs.rows.map((r) => !!r.flag)).toEqual([false, false, true, false]);
    });

    it('shows the safeguarding set-up, flagging anything missing, using the older policy link when needed', () => {
      expect(cellsOf(ret.sections[4])).toEqual([
        ['Child Safety Officer', 'Cass Officer'],
        ['Complaints manager', 'Not named'],
        ['WWC Registration Officer', 'Not named'],
        ['Safeguarding policy', 'https://example.test/old-policy'],
        ['Code of conduct', 'https://example.test/conduct'],
        ['Privacy policy', 'Not linked'],
        ['Policy version members accept', '3'],
      ]);
      expect(ret.sections[4].rows.map((r) => !!r.flag)).toEqual([false, true, false, false, false, false, false]);
    });

    it('carries the check and training figures as counts only', () => {
      expect(cellsOf(ret.sections[5])).toEqual([
        ['Need a check', '12'],
        ['Expired', '1'],
      ]);
      expect(cellsOf(ret.sections[6])).toEqual([['Courses', '2']]);
    });

    it('leaves out the check and training counts when the admin turns them off', () => {
      const without = affiliationReturn({
        clubName: 'Sample Club',
        affiliation: affiliation({ incorporation_number: null }),
        officers: [],
        contacts: [],
        safeguarding: { contacts: null, policies: null, wwcOfficerName: 'Wes Officer' },
        wwcc: null,
        training: null,
        today: new Date(2026, 9, 18, 12),
      });
      expect(without.sections.map((s) => s.title)).not.toContain('Working With Children Checks');
      expect(without.sections.map((s) => s.title).join()).not.toContain('Integrity training');
      expect(cellsOf(without.sections[0])[0]).toEqual(['Incorporation number', 'Not incorporated']);
      expect(without.sections[1].empty).toBe('None named.');
      expect(cellsOf(without.sections[4])).toEqual([
        ['Child Safety Officer', 'Not named'],
        ['Complaints manager', 'Not named'],
        ['WWC Registration Officer', 'Wes Officer'],
        ['Safeguarding policy', 'Not linked'],
        ['Code of conduct', 'Not linked'],
        ['Privacy policy', 'Not linked'],
        ['Policy version members accept', '1'],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------

describe('injuryReport', () => {
  const injury = (id: string, extra: Partial<InjuryReportRow> = {}): InjuryReportRow => ({
    id,
    athlete_name: `Sample ${id}`,
    athlete_email: null,
    athlete_left_at: null,
    body_area: 'Left ankle',
    injured_on: '2026-10-01',
    reported_at: noon('2026-10-02'),
    status: 'injured',
    restrictions: null,
    expected_return: null,
    coach_endorsed_by_name: null,
    cleared_by_name: null,
    cleared_at: null,
    update_count: 4,
    document_count: 2,
    ...extra,
  });
  const report = injuryReport(
    [
      injury('old', { injured_on: '2026-08-01' }),
      injury('new', { injured_on: '2026-10-10', status: 'coach_endorsed', restrictions: 'No jumping', expected_return: '2026-11-01', coach_endorsed_by_name: 'Sample coach' }),
      injury('gone', { athlete_name: null, athlete_email: 'gone@example.test', athlete_left_at: noon('2026-09-01') }),
      injury('ok', { status: 'cleared', cleared_by_name: 'Sample physio', cleared_at: noon('2026-10-12'), coach_endorsed_by_name: 'Sample coach' }),
    ],
    '2026-07-18',
  );

  it('covers the period and every injury not yet cleared, across the page', () => {
    expect(report.subtitle).toBe(`Injuries reported or cleared since ${day('2026-07-18')}, and every injury not yet cleared`);
    expect(report.landscape).toBe(true);
    expect(stats(report)).toEqual({ Injuries: 4, 'Not cleared': 3, Cleared: 1 });
  });

  it('lists injuries not cleared first, newest first, then those cleared, with who signed them off', () => {
    const [open, cleared] = report.sections;
    expect(open.title).toBe('Not cleared');
    expect(cellsOf(open).map((r) => r[0])).toEqual(['Sample new', 'gone@example.test (left the club)', 'Sample old']);
    expect(cellsOf(open)[0]).toEqual([
      'Sample new',
      'Left ankle',
      '10/10/2026',
      '02/10/2026',
      'Waiting for the committee',
      'No jumping',
      '01/11/2026',
      'Endorsed: Sample coach',
    ]);
    expect(cellsOf(cleared)).toHaveLength(1);
    expect(cellsOf(cleared)[0][4]).toBe('Cleared to play');
    expect(cellsOf(open)[1][4]).toBe('Injured');
    expect(cellsOf(cleared)[0][7]).toBe('Endorsed: Sample coach\nCleared: Sample physio, 12/10/2026');
  });

  it('leaves out medical documents and updates', () => {
    expect(report.sections[0].columns.map((c) => c.label)).not.toContain('Documents');
    expect(report.footnote).toBe('Medical documents aren’t included. Open an injury in the app to see its updates and documents.');
  });
});

// ---------------------------------------------------------------------------

describe('sessionPlanReport', () => {
  const plan = (id: string, extra: Partial<SessionPlanReportRow> = {}): SessionPlanReportRow => ({
    id,
    team_id: 't1',
    team_name: 'Open A',
    title: 'Footwork',
    session_on: '2026-10-07',
    starts_at: '18:00:00',
    author_name: 'Sample coach',
    author_position: 'Head Coach',
    run_by: null,
    has_notes: true,
    file_count: 0,
    created_at: noon('2026-10-05'),
    edited_at: null,
    ...extra,
  });
  const rows = [
    plan('p3', { session_on: '2026-10-14', file_count: 1 }),
    plan('p1', { starts_at: '19:30:00', title: 'Late', has_notes: false, file_count: 3, edited_at: noon('2026-10-06') }),
    plan('p2', { title: 'Early', starts_at: '17:00:00', has_notes: false }),
    plan('p4', { team_id: 't2', team_name: '17 & Under A', title: 'Conditioning', starts_at: null, author_name: 'Sample admin', author_position: 'Admin', run_by: 'Sample S&C partner' }),
  ];
  const report = sessionPlanReport('Last 3 months', 'All squads and teams', rows, [
    { id: 't1', name: 'Open A' },
    { id: 't2', name: '17 & Under A' },
    { id: 't3', name: 'Under 12' },
  ]);

  it('counts plans, days and groups with a plan', () => {
    expect(report.subtitle).toBe('Last 3 months · All squads and teams');
    expect(stats(report)).toEqual({ Plans: 4, 'Days with a plan': 2, 'Squads and teams with a plan': 2 });
  });

  it('shows each group’s plans, days and latest session, in red with none', () => {
    const [byGroup] = report.sections;
    expect(cellsOf(byGroup)).toEqual([
      ['Open A', '3', '2', '14/10/2026'],
      ['17 & Under A', '1', '1', '07/10/2026'],
      ['Under 12', '0', '0', 'None'],
    ]);
    expect(byGroup.rows.map((r) => r.flag)).toEqual([false, false, true]);
  });

  it('lists every plan by day, group and time, with what it holds, empty plans in red', () => {
    const every = report.sections[1];
    expect(cellsOf(every)).toEqual([
      ['07/10/2026', '17 & Under A', 'Conditioning', 'Sample admin\nAdmin', 'Sample S&C partner', 'Written plan', '05/10/2026', ''],
      ['07/10/2026 17:00', 'Open A', 'Early', 'Sample coach\nHead Coach', '', 'Empty', '05/10/2026', ''],
      ['07/10/2026 19:30', 'Open A', 'Late', 'Sample coach\nHead Coach', '', '3 files', '05/10/2026', '06/10/2026'],
      ['14/10/2026 18:00', 'Open A', 'Footwork', 'Sample coach\nHead Coach', '', 'Written plan, 1 file', '05/10/2026', ''],
    ]);
    expect(every.rows.map((r) => r.flag)).toEqual([false, true, false, false]);
  });

  it('never includes the plans themselves', () => {
    expect(report.footnote).toContain('The plans themselves aren’t included');
    expect(report.sections[1].columns.map((c) => c.label)).toEqual([
      'Day',
      'Squad or team',
      'Session',
      'Added by',
      'Run by',
      'Holds',
      'Added',
      'Last changed',
    ]);
  });

  it('says so with no plans or no groups', () => {
    const empty = sessionPlanReport('p', 'g', [], []);
    expect(empty.sections.map((s) => s.empty)).toEqual(['No squads or teams chosen.', 'No session plans in this period.']);
  });
});

// ---------------------------------------------------------------------------

describe('kpiReport', () => {
  const row = (profile_id: string, extra: Partial<KpiReportRow> = {}): KpiReportRow => ({
    team_id: 't1',
    team_name: 'Open A',
    profile_id,
    full_name: `Sample ${profile_id}`,
    team_role: 'coach',
    coach_title: 'head_coach',
    left_at: null,
    kpi_id: `k-${profile_id}`,
    format: 'kpi',
    title: 'Win rate',
    measures: [{ title: null, kind: 'number', target: 60, unit: '%', lower_is_better: false, current_value: 55, done: false }],
    result: null,
    result_note: null,
    set_by_name: 'Sample admin',
    reviews: [
      { name: 'Mid-season', due_on: '2026-10-01', written: true, confirmed: true },
      { name: 'End of season', due_on: '2027-03-01', written: false, confirmed: false },
    ],
    ...extra,
  });
  const overdue = [
    { name: 'Mid-season', due_on: '2026-10-01', written: false, confirmed: false },
    { name: 'Pre-finals', due_on: '2026-11-01', written: true, confirmed: false },
  ];
  const rows = [
    row('hc', { result: 'met', result_note: 'Top of the ladder' }),
    row('hc', {
      kpi_id: 'k2',
      format: 'okr',
      title: 'Grow the squad',
      set_by_name: null,
      measures: [
        { title: 'New players', kind: 'number', target: 3, unit: null, lower_is_better: true, current_value: null, done: false },
        { title: 'Camp run', kind: 'yes_no', target: null, unit: null, lower_is_better: false, current_value: null, done: true },
      ],
      result: 'partly_met',
    }),
    row('ac', { coach_title: 'assistant_coach', reviews: overdue, result: 'not_met' }),
    row('mgr', { team_role: 'manager', coach_title: null, kpi_id: null, format: null, title: null, measures: [], set_by_name: null, reviews: overdue }),
    row('u12', { team_id: 't2', team_name: 'Under 12' }),
  ];
  const report = kpiReport('2026–27', rows, '2026-10-18');

  it('covers coaches and managers for the season, across the page', () => {
    expect(report.subtitle).toBe('Coaches’ and managers’ KPIs and OKRs for 2026–27');
    expect(report.landscape).toBe(true);
    expect(report.footnote).toContain('Athletes’ KPIs aren’t in this report.');
  });

  it('counts people, KPIs, results and overdue reviews', () => {
    expect(stats(report)).toEqual({
      'Coaches and managers': 4,
      'Without KPIs': 1,
      'KPIs and OKRs': 4,
      Met: 1,
      'Partly met': 1,
      'Not met': 1,
      'No result yet': 1,
      // A person with no KPIs is counted as without KPIs, not overdue.
      'With a review overdue': 1,
    });
  });

  it('gives each squad or team its people with each KPI, progress, result and reviews', () => {
    const [openA, u12] = report.sections;
    expect(report.sections.map((s) => s.title)).toEqual(['Open A', 'Under 12']);
    expect(cellsOf(openA)).toEqual([
      [
        'Sample hc\nHead Coach',
        'KPI: Win rate\nSet by Sample admin',
        '55% so far (target 60%)',
        'Met\nTop of the ladder',
        'Mid-season: done, confirmed\nEnd of season: due ' + day('2027-03-01'),
      ],
      [
        'Sample hc\nHead Coach',
        'OKR: Grow the squad',
        // The PDF's fonts have no tick, so "Done" is written out.
        'New players: No progress recorded yet (target 3 or fewer)\nCamp run: Done',
        'Partly met',
        'Mid-season: done, confirmed\nEnd of season: due ' + day('2027-03-01'),
      ],
      ['Sample ac\nAssistant Coach', 'KPI: Win rate\nSet by Sample admin', '55% so far (target 60%)', 'Not met', 'Mid-season: overdue\nPre-finals: written, not yet confirmed'],
      ['Sample mgr\nManager', 'No KPIs set', '', '', ''],
    ]);
    expect(openA.rows.map((r) => r.flag)).toEqual([false, false, true, true]);
    expect(cellsOf(u12)[0][3]).toBe('Not yet');
  });

  it('never shows a tick the PDF can’t draw', () => {
    expect(JSON.stringify(report)).not.toContain('✓');
  });
});
