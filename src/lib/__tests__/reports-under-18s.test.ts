/**
 * The Under 18s and their guardians report (under18sReport in
 * src/lib/reports.ts). Section 10 of the user guide ("Reports"): every
 * approved athlete under 18 with their date of birth and age, squad or team,
 * parents or guardians and their emails, consent, this season's code of
 * conduct, and how often other people viewed their records in the last 12
 * months. Athletes with no guardian come first, and unverified guardians are
 * marked. Adults, athletes not approved, and the children's own contact
 * details are never in it.
 */
import { formatDateString } from '@/lib/injuries';
import type { ConductStatus } from '@/lib/conduct';
import { ageOn, under18sReport, type Guardianship, type Placement } from '@/lib/reports';

import { NO_CHECK, noon, person, REPORT_DAY, team } from '../../__tests__/helpers/report-fixtures';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers({ now: REPORT_DAY });
});

afterEach(() => {
  jest.useRealTimers();
});

const athlete = (id: string, name: string, dob: string | null, extra = {}) =>
  person(id, { full_name: name, role: 'athlete', date_of_birth: dob, ...NO_CHECK, ...extra });
const guardian = (id: string, name: string, extra = {}) =>
  person(id, { full_name: name, role: 'guardian', ...NO_CHECK, ...extra });

const U15 = team('t-u15', '15 & Under A', { sort_order: 2 });
const U17 = team('t-u17', '17 & Under A', { sort_order: 1 });

// Today is 18/10/2026.
const amy = athlete('amy', 'Amy Child', '2012-04-09', { email: 'amy-own@example.test' });
const ben = athlete('ben', 'Ben Child', '2008-10-19'); // 18 tomorrow
const cal = athlete('cal', 'Cal NoBirthday', null, { under_17: true });
const adultToday = athlete('dee', 'Dee Adult', '2008-10-18'); // turns 18 today
const adultFlagged = athlete('eve', 'Eve Adult', '2000-01-01', { under_17: true });
const pendingChild = athlete('fay', 'Fay Pending', '2013-01-01', { status: 'pending' });
const notAthlete = person('gil', { full_name: 'Gil Young Guardian', role: 'guardian', date_of_birth: '2010-01-01', ...NO_CHECK });

const mum = guardian('mum', 'Mia Parent', { email: 'mia@example.test' });
const dad = guardian('dad', 'Dan Parent', { email: null, playhq_email: 'dan-playhq@example.test', verified_at: null });
const gran = guardian('gran', 'Gwen Parent', { status: 'pending', email: 'gwen@example.test' });

const MEMBERS = [amy, ben, cal, adultToday, adultFlagged, pendingChild, notAthlete, mum, dad, gran];
const LINKS: Guardianship[] = [
  { guardian_id: mum.id, athlete_id: amy.id },
  { guardian_id: dad.id, athlete_id: amy.id },
  { guardian_id: gran.id, athlete_id: ben.id },
  // A guardian whose account has gone.
  { guardian_id: 'deleted', athlete_id: cal.id },
  { guardian_id: mum.id, athlete_id: adultToday.id },
];
const PLACES: Placement[] = [
  { team_id: U15.id, profile_id: amy.id, team_role: 'athlete' },
  { team_id: U17.id, profile_id: amy.id, team_role: 'athlete' },
  { team_id: U17.id, profile_id: ben.id, team_role: 'athlete' },
];
const conduct = (profile_id: string, accepted_at: string | null, accepted_by_name: string | null = null): ConductStatus =>
  ({ profile_id, full_name: null, role: 'athlete', under_18: true, accepted_at, accepted_by_name, waiting_for_guardian: false }) as ConductStatus;

const report = () =>
  under18sReport(
    MEMBERS,
    LINKS,
    PLACES,
    [U15, U17],
    [
      { athlete_id: amy.id, data: true, health: true },
      { athlete_id: ben.id, data: false, health: true },
      { athlete_id: adultToday.id, data: true, health: true },
    ],
    [
      // Numbers arrive as text from Postgres bigints.
      { subject_id: amy.id, views: '3' as unknown as number, viewers: '2' as unknown as number, last_viewed_at: noon('2026-10-01') },
      { subject_id: ben.id, views: 1, viewers: 1, last_viewed_at: noon('2026-10-02') },
      { subject_id: adultToday.id, views: 40, viewers: 9, last_viewed_at: noon('2026-10-02') },
    ],
    [conduct(amy.id, noon('2026-09-01'), 'Mia Parent'), conduct(ben.id, null)],
  );

const rowsOf = (title: string) => report().sections.find((s) => s.title === title)!.rows;

describe('ageOn', () => {
  it('counts whole years, turning over on the birthday', () => {
    expect(ageOn('2008-10-18')).toBe(18);
    expect(ageOn('2008-10-19')).toBe(17);
    expect(ageOn('2012-04-09')).toBe(14);
    expect(ageOn('2010-02-28', new Date(2026, 1, 27))).toBe(15);
    expect(ageOn('2010-02-28', new Date(2026, 1, 28))).toBe(16);
  });
});

describe('under18sReport', () => {
  it('is printed across the page, for approved athletes under 18 today', () => {
    const r = report();
    expect(r.title).toBe('Under 18s and their guardians');
    expect(r.subtitle).toBe('Approved athletes under 18 today');
    expect(r.landscape).toBe(true);
    expect(r.sections.map((s) => s.title)).toEqual(['No parent or guardian linked', 'With parents or guardians']);
  });

  it('includes only approved athletes under 18, by date of birth, or the admin’s choice without one', () => {
    const everyone = report().sections.flatMap((s) => s.rows.map((r) => r.cells[0]));
    expect(everyone.sort()).toEqual(['Amy Child', 'Ben Child', 'Cal NoBirthday']);
    // Turning 18 today, a recorded adult the old choice called under 18, pending, or not an athlete: never listed.
    for (const name of ['Dee Adult', 'Eve Adult', 'Fay Pending', 'Gil Young Guardian']) {
      expect(everyone).not.toContain(name);
    }
  });

  it('lists athletes with no guardian linked first, in red, including a guardian whose account has gone', () => {
    const rows = rowsOf('No parent or guardian linked');
    expect(rows.map((r) => r.cells)).toEqual([
      ['Cal NoBirthday', 'Not recorded', '', 'None linked', '', 'None given', 'Not asked', 'None'],
    ]);
    expect(rows[0].flag).toBe(true);
  });

  it('shows each child’s age, groups, guardians and their emails, consent, conduct and record views', () => {
    const rows = rowsOf('With parents or guardians');
    expect(rows.map((r) => r.cells)).toEqual([
      [
        'Amy Child',
        '09/04/2012 (14)',
        '17 & Under A\n15 & Under A',
        // In name order; an unverified guardian is marked.
        'Dan Parent (not verified)\nMia Parent',
        'dan-playhq@example.test\nmia@example.test',
        'Check-ins and injuries',
        `${formatDateString('2026-09-01')}\nby Mia Parent`,
        '3 by 2 people',
      ],
      [
        'Ben Child',
        '19/10/2008 (17)',
        '17 & Under A',
        'Gwen Parent (not approved)',
        'gwen@example.test',
        'Injuries only',
        'Not yet',
        '1 by 1 person',
      ],
    ]);
    expect(rows.map((r) => r.flag)).toEqual([false, false]);
  });

  it('never shows a child’s own email address', () => {
    const text = JSON.stringify(report());
    expect(text).not.toContain('amy-own@example.test');
    expect(text).not.toContain('ben@example.test');
  });

  it('names each kind of consent', () => {
    const one = (data: boolean, health: boolean) =>
      under18sReport([amy], [], [], [], [{ athlete_id: amy.id, data, health }]).sections[0].rows[0].cells[5];
    expect(one(true, true)).toBe('Check-ins and injuries');
    expect(one(true, false)).toBe('Check-ins only');
    expect(one(false, true)).toBe('Injuries only');
    expect(one(false, false)).toBe('None given');
  });

  it('shows a code of conduct accepted with no name recorded', () => {
    const [row] = under18sReport([amy], [], [], [], [], [], [conduct(amy.id, noon('2026-09-01'))]).sections[0].rows;
    expect(row.cells[6]).toBe(formatDateString('2026-09-01'));
  });

  it('shows no record views as None', () => {
    const [row] = under18sReport([amy], [], [], [], [], [{ subject_id: amy.id, views: 0, viewers: 0, last_viewed_at: noon('2026-10-01') }]).sections[0].rows;
    expect(row.cells[7]).toBe('None');
  });

  it('counts the children, guardians, consent, conduct and views of children only', () => {
    expect(Object.fromEntries(report().stats!.map((s) => [s.label, s.value]))).toEqual({
      'Athletes under 18': 3,
      'With a parent or guardian': 2,
      'No parent or guardian': 1,
      'No date of birth': 1,
      'Full consent given': 1,
      'Consent missing': 2,
      'Code of conduct to accept': 1,
      // An adult's 40 views aren't counted.
      'Record views (12 months)': 4,
    });
  });

  it('says so when there are no children, or none without a guardian', () => {
    const empty = under18sReport([], [], [], []);
    expect(empty.stats!.every((s) => s.value === 0)).toBe(true);
    expect(empty.sections.map((s) => s.empty)).toEqual([
      'Every athlete under 18 has a parent or guardian linked.',
      'No athletes under 18 have a parent or guardian linked yet.',
    ]);
  });

  it('includes an athlete who also holds another role', () => {
    const both = athlete('h', 'Hal Child', '2011-01-01', { role: 'guest', extra_roles: ['athlete'] });
    expect(under18sReport([both], [], [], []).sections[0].rows[0].cells[0]).toBe('Hal Child');
  });

  it('explains how under 18 and record views are worked out', () => {
    expect(report().footnote).toContain('Under 18 is worked out from the date of birth');
    expect(report().footnote).toContain('in the last 12 months');
  });
});
