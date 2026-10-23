/**
 * The report screens under src/app/admin/reports, for an admin (who can open
 * them is covered by the route tests). Section 10 of the user guide
 * ("Reports"): each report shows on screen with its totals, its filters
 * (period, squads and teams, season) change what it covers, and Export PDF
 * saves the same report, with the club's name, through the share sheet.
 *
 * Each export is read back with the PDF decoder in helpers/documents.ts, so
 * the tests check what the saved file actually holds.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import * as Sharing from 'expo-sharing';

import AffiliationReportScreen from '@/app/admin/reports/affiliation';
import AttendanceReportScreen from '@/app/admin/reports/attendance';
import AwardReportScreen from '@/app/admin/reports/award';
import AwardResultsScreen from '@/app/admin/reports/awards';
import ReportsScreen from '@/app/admin/reports/index';
import IntegrityReportScreen from '@/app/admin/reports/integrity';
import KpiReportScreen from '@/app/admin/reports/kpis';
import MedicalCheckReportScreen from '@/app/admin/reports/medical';
import SessionPlanReportScreen from '@/app/admin/reports/session-plans';
import Under18sReportScreen from '@/app/admin/reports/under-18s';
import WwccReportScreen from '@/app/admin/reports/wwcc';
import type { Affiliation } from '@/lib/affiliation';
import { formatDateString } from '@/lib/injuries';
import type { MedicalComplianceRow } from '@/lib/medical';
import { supabase } from '@/lib/supabase';
import type { Award, Team } from '@/lib/types';

import { readPdf } from './helpers/documents';
import { openScreen, resetClub, setClubFeatures, settle, type BackendOptions, type QueryInfo } from './helpers/harness';
import { NO_CHECK, noon, person, team } from './helpers/report-fixtures';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  useAdminPushNotifications: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
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

const written = (jest.requireMock('expo-file-system') as { File: { written: { uri: string; bytes: Uint8Array }[] } }).File
  .written;

/** Every query the screen made, by table or RPC. */
let seen: QueryInfo[] = [];

beforeEach(() => {
  resetClub();
  written.length = 0;
  seen = [];
  (Sharing.shareAsync as jest.Mock).mockClear();
});

const day = (d: string) => formatDateString(d);

/** All the text on screen, one entry per text element, in order. */
function texts(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const el = node as { type: string; children: unknown[] | null };
    if (el.type === 'Text') {
      out.push((el.children ?? []).filter((c) => typeof c === 'string').join(''));
    }
    (el.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}

/** The figure shown above a stat's label. */
function stat(label: string) {
  const all = texts();
  const at = all.indexOf(label);
  if (at < 1) throw new Error(`No stat ${label}`);
  return all[at - 1];
}

/** Taps Export PDF and reads back the file it shared. */
async function exportPdf() {
  fireEvent.press(screen.getByText('Export PDF'));
  await settle();
  expect(written).toHaveLength(1);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(written[0].uri, expect.objectContaining({ mimeType: 'application/pdf' }));
  return { name: written[0].uri.replace('file:///cache/', ''), pdf: readPdf(written[0].bytes) };
}

const recordTable = (rows: unknown) => (q: QueryInfo) => {
  seen.push(q);
  return rows;
};
/** Taps a filter chip; chips come before the report, which may repeat the name. */
function chip(label: string) {
  fireEvent.press(screen.getAllByText(label)[0]);
}

const argOf = (q: QueryInfo, method: string) => q.calls.find((c) => c.method === method)?.args;

async function open(route: string, Component: React.ComponentType, tables: Record<string, unknown[]>, options: BackendOptions = {}, url = `/${route}`) {
  await openScreen('admin', { [route]: Component, 'session-plans/[id]': PlanPlaceholder, 'admin/reports/award': AwardReportScreen }, url, tables, options);
}

function PlanPlaceholder() {
  return <Text>screen:session-plan</Text>;
}

// ---------------------------------------------------------------------------

describe('Reports', () => {
  it('lists every report whose feature is on, and Affiliation only when its records are on', async () => {
    setClubFeatures({ kpis: true, affiliation: true });
    await open('admin/reports/index', ReportsScreen, {}, {}, '/admin/reports');
    for (const title of [
      'Working With Children Checks',
      'Under 18s and their guardians',
      'Medical details checks',
      'Integrity training',
      'Injuries',
      'Attendance',
      'Session plans',
      'Award results',
      'Season KPIs',
      'Affiliation',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it.each([
    ['Working With Children Checks', '/admin/reports/wwcc'],
    ['Under 18s and their guardians', '/admin/reports/under-18s'],
    ['Medical details checks', '/admin/reports/medical'],
    ['Integrity training', '/admin/reports/integrity'],
    ['Injuries', '/admin/injuries'],
    ['Attendance', '/admin/reports/attendance'],
    ['Session plans', '/admin/reports/session-plans'],
    ['Award results', '/admin/reports/awards'],
    ['Season KPIs', '/admin/reports/kpis'],
    ['Affiliation', '/admin/reports/affiliation'],
  ])('opens %s', async (title, path) => {
    setClubFeatures({ kpis: true, affiliation: true });
    const target = path.slice(1);
    await openScreen(
      'admin',
      { 'admin/reports/index': ReportsScreen, [target]: () => <Text>{`screen:${target}`}</Text> },
      '/admin/reports',
    );
    fireEvent.press(screen.getByText(title));
    await settle();
    expect(screen.getByText(`screen:${target}`)).toBeTruthy();
    expect(screen).toHavePathname(path);
  });

  it('leaves out reports for features that are off, but always has the child-safety reports', async () => {
    setClubFeatures({ integrity: false, injuries: false, attendance: false, sessionPlans: false, awards: false, kpis: false });
    await open('admin/reports/index', ReportsScreen, {}, {}, '/admin/reports');
    expect(screen.getByText('Working With Children Checks')).toBeTruthy();
    expect(screen.getByText('Under 18s and their guardians')).toBeTruthy();
    expect(screen.getByText('Medical details checks')).toBeTruthy();
    for (const title of ['Integrity training', 'Injuries', 'Attendance', 'Session plans', 'Award results', 'Season KPIs', 'Affiliation']) {
      expect(screen.queryByText(title)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Working With Children Checks', () => {
  const coach = person('c1', { full_name: 'Casey Coach', wwcc_expires_on: '2026-01-01' });
  const manager = person('m1', { full_name: 'Morgan Manager', role: 'manager' });
  const athlete = person('a1', { full_name: 'Ari Athlete', role: 'athlete', ...NO_CHECK });
  const OPEN_A = team('t1', 'Open A');

  async function openWwcc(options: BackendOptions = {}) {
    await open(
      'admin/reports/wwcc',
      WwccReportScreen,
      { teams: [OPEN_A], stand_downs: [], screening_notices: [], policy_acknowledgements: [] },
      {
        ...options,
        tableHandlers: {
          profiles: (q) => (q.eq('status') === 'approved' ? [coach, manager, athlete] : undefined),
          team_members: (q) =>
            q.eq('profile_id') === undefined ? [{ team_id: 't1', profile_id: 'c1', team_role: 'coach' }] : undefined,
          ...options.tableHandlers,
        },
        rpcs: { admin_volunteer_exemptions: [], admin_wwc_officer: [{ officer_name: 'Wren Officer' }], ...options.rpcs },
      },
    );
  }

  it('shows the totals, the officer and each check, problems first', async () => {
    await openWwcc();
    expect(screen.getByText(/WWC Registration Officer: Wren Officer$/)).toBeTruthy();
    expect(stat('Need a check')).toBe('2');
    expect(stat('Expired')).toBe('1');
    expect(stat('Current')).toBe('1');
    const all = texts();
    expect(all.indexOf('Casey Coach')).toBeLessThan(all.indexOf('Morgan Manager'));
    expect(all).toContain('Squads and teams: Open A');
    expect(all).toContain('Status: Expired');
    expect(all).not.toContain('Ari Athlete');
  });

  it('exports the same report as a PDF named for the club, report and day', async () => {
    await openWwcc();
    const { name, pdf } = await exportPdf();
    expect(name).toBe('sample-working-with-children-checks-2026-10-18.pdf');
    expect(pdf.info.title).toBe('Sample Club · Working With Children Checks');
    // Printed across the page.
    expect(pdf.pages[0].width).toBeGreaterThan(pdf.pages[0].height);
    expect(pdf.text).toContain('Casey Coach');
    expect(pdf.text).toContain('Morgan Manager');
    expect(pdf.text).not.toContain('Ari Athlete');
    const casey = pdf.pages[0].texts.find((t) => t.text === 'Casey Coach')!;
    expect(casey.colour).toEqual([0.7, 0.05, 0.1]);
    expect(screen.getByText('Export PDF')).toBeTruthy();
  });

  it('shows the database’s message when the report can’t load', async () => {
    await openWwcc({ rpcErrors: { admin_volunteer_exemptions: 'Only admins can see this' } });
    expect(screen.getByText('Only admins can see this')).toBeTruthy();
    expect(screen.queryByText('Export PDF')).toBeNull();
  });

  it('shows why the PDF didn’t save', async () => {
    await openWwcc();
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('Sharing isn’t available'));
    fireEvent.press(screen.getByText('Export PDF'));
    await settle();
    expect(screen.getByText('Sharing isn’t available')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('Under 18s and their guardians', () => {
  const child = person('kid', { full_name: 'Kit Child', role: 'athlete', date_of_birth: '2012-04-09', ...NO_CHECK });
  const lonely = person('kid2', { full_name: 'Lou Child', role: 'athlete', date_of_birth: '2011-01-01', ...NO_CHECK });
  const adult = person('adult', { full_name: 'Ada Adult', role: 'athlete', date_of_birth: '1999-01-01', ...NO_CHECK });
  const parent = person('par', { full_name: 'Pia Parent', role: 'guardian', email: 'pia@example.test', ...NO_CHECK });

  it('shows the totals and each child with their guardians, and exports them', async () => {
    await open(
      'admin/reports/under-18s',
      Under18sReportScreen,
      { teams: [team('t1', '15 & Under A')], guardianships: [{ guardian_id: 'par', athlete_id: 'kid' }] },
      {
        tableHandlers: {
          profiles: (q) => (q.eq('id') === undefined ? [child, lonely, adult, parent] : undefined),
          team_members: (q) =>
            q.eq('team_role') === 'athlete' ? [{ team_id: 't1', profile_id: 'kid', team_role: 'athlete' }] : undefined,
        },
        rpcs: {
          admin_child_consents: [{ athlete_id: 'kid', data: true, health: true }],
          admin_record_access_summary: [{ subject_id: 'kid', views: 2, viewers: 1, last_viewed_at: noon('2026-10-01') }],
          admin_conduct_status: [],
        },
      },
    );
    expect(stat('Athletes under 18')).toBe('2');
    expect(stat('No parent or guardian')).toBe('1');
    expect(stat('Full consent given')).toBe('1');
    const all = texts();
    expect(all.indexOf('Lou Child')).toBeLessThan(all.indexOf('Kit Child'));
    expect(all).toContain('Parents and guardians: Pia Parent');
    expect(all).toContain('Guardian email: pia@example.test');
    expect(all).toContain('Squad or team: 15 & Under A');
    expect(all).toContain('Record views (12 months): 2 by 1 person');
    expect(all).not.toContain('Ada Adult');

    const { name, pdf } = await exportPdf();
    expect(name).toBe('sample-under-18s-and-their-guardians-2026-10-18.pdf');
    expect(pdf.text).toContain('Kit Child');
    expect(pdf.text).toContain('pia@example.test');
    expect(pdf.text).not.toContain('Ada Adult');
    expect(pdf.text).not.toContain('kid@example.test');
  });
});

// ---------------------------------------------------------------------------

describe('Integrity training', () => {
  it('shows the newest season, and another season when chosen', async () => {
    const req = (id: string, season: number) => ({ id, name: `Course ${season}`, due_on: `${season}-12-01`, season, archived: false });
    await open(
      'admin/reports/integrity',
      IntegrityReportScreen,
      { teams: [team('t1', 'Open A', { season: 2026 })], training_requirements: [req('r26', 2026), req('r25', 2025)] },
      {
        rpcHandlers: {
          training_requirement_members: (args) => [
            {
              profile_id: 'p1',
              full_name: 'Sample member',
              status: args.p_requirement_id === 'r26' ? 'to_do' : 'approved',
              completed_on: null,
              reviewed_by_name: null,
              reviewed_at: null,
            },
          ],
        },
      },
    );
    expect(screen.getByText('Sports Integrity Australia courses for 2026–27')).toBeTruthy();
    expect(screen.getByText('Course 2026')).toBeTruthy();
    expect(stat('Still to finish')).toBe('1');

    chip('2025–26');
    await settle();
    expect(screen.getByText('Sports Integrity Australia courses for 2025–26')).toBeTruthy();
    expect(screen.getByText('Course 2025')).toBeTruthy();
    expect(screen.queryByText('Course 2026')).toBeNull();
    expect(stat('All done')).toBe('1');
  });
});

// ---------------------------------------------------------------------------

describe('Season KPIs', () => {
  const kpiRow = (season: number) => ({
    team_id: 't1',
    team_name: `Open A ${season}`,
    profile_id: 'c1',
    full_name: 'Casey Coach',
    team_role: 'coach',
    coach_title: 'head_coach',
    kpi_id: null,
    format: null,
    title: null,
    measures: [],
    result: null,
    result_note: null,
    set_by_name: null,
    reviews: [],
  });

  it('asks for the newest season, and the chosen one', async () => {
    await open('admin/reports/kpis', KpiReportScreen, { teams: [{ season: 2025 }, { season: 2026 }, { season: 2026 }] }, {
      rpcHandlers: {
        season_kpi_report: (args, q) => {
          seen.push(q);
          return [kpiRow(args.p_season as number)];
        },
      },
    });
    expect(screen.getByText('Coaches’ and managers’ KPIs and OKRs for 2026–27')).toBeTruthy();
    expect(screen.getByText('Open A 2026')).toBeTruthy();
    expect(stat('Without KPIs')).toBe('1');
    chip('2025–26');
    await settle();
    expect(screen.getByText('Open A 2025')).toBeTruthy();
  });

  it('shows the database’s message', async () => {
    await open('admin/reports/kpis', KpiReportScreen, { teams: [] }, { rpcErrors: { season_kpi_report: 'Admins only' } });
    expect(screen.getByText('Admins only')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('Affiliation', () => {
  const affiliation: Affiliation = {
    member_type: 'club',
    tier: null,
    incorporation_number: null,
    affiliated_with: 'Sample Association',
    registered_on: '2026-03-01',
    primary_contact_1_id: null,
    primary_contact_1_name: null,
    primary_contact_2_id: null,
    primary_contact_2_name: null,
    checks: {},
    notes: null,
    updated_at: null,
    updated_by_name: null,
    season: 2026,
    team_count: 2,
    registrations_total: 2,
    registered: 1,
    not_registered: 0,
  };

  it('loads this season’s registrations and exports the report', async () => {
    let asked: unknown = null;
    await open('admin/reports/affiliation', AffiliationReportScreen, {}, {
      rpcs: { admin_affiliation: [affiliation], admin_affiliation_officers: [] },
      rpcHandlers: {
        admin_playhq_registrations: (args) => {
          asked = args;
          return [
            { profile_id: 'p', name: 'Reg Sample', playhq_email: null, email: null, team_roles: ['athlete'], groups: ['Open A'], registered: null, checked_at: null, checked_by_name: null },
          ];
        },
      },
    });
    expect(asked).toEqual({ p_season: 2026 });
    expect(stat('Registered in PlayHQ 2026–27')).toBe('1 of 2');
    expect(stat('Still to check')).toBe('1');
    expect(screen.getByText('Reg Sample')).toBeTruthy();
    const { name, pdf } = await exportPdf();
    expect(name).toBe('sample-affiliation-2026-10-18.pdf');
    expect(pdf.text).toContain('Reg Sample');
    expect(pdf.text).toContain('Sample Association');
  });

  it('doesn’t ask for registrations without a season', async () => {
    const asked = jest.fn(() => []);
    await open('admin/reports/affiliation', AffiliationReportScreen, {}, {
      rpcs: { admin_affiliation: [{ ...affiliation, season: null }], admin_affiliation_officers: [] },
      rpcHandlers: { admin_playhq_registrations: asked },
    });
    expect(asked).not.toHaveBeenCalled();
    expect(screen.getByText('Nobody is in a squad or team this season.')).toBeTruthy();
  });

  it('shows why the report didn’t load', async () => {
    await open('admin/reports/affiliation', AffiliationReportScreen, {}, {
      rpcs: { admin_affiliation: [], admin_affiliation_officers: [] },
    });
    expect(screen.getByText('The report didn’t load. Try again.')).toBeTruthy();
    expect(screen.queryByText('Export PDF')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('Award results', () => {
  const award = (overrides: Partial<Award> = {}): Award => ({
    id: 'aw1',
    season: 2026,
    name: 'Best and Fairest',
    description: '',
    closes_at: noon('2026-10-10'),
    club_wide: false,
    per_group: true,
    voter_roles: ['athlete'],
    nominees: 'athletes',
    points: [3, 2, 1],
    by_match: false,
    match_vote_hours: 24,
    preseason_weight: 0,
    preseason_closes_at: null,
    annual: false,
    copied_from: null,
    nominee_min_age: null,
    nominee_max_age: null,
    nominee_age_on: null,
    award_groups: [{ team_id: 't1' }, { team_id: 't-gone' }],
    award_candidates: [],
    ...overrides,
  });

  it('lists awards that have closed, and opens one’s full results', async () => {
    await open('admin/reports/awards', AwardResultsScreen, {}, {
      tableHandlers: {
        awards: (q) => {
          if (q.eq('id') === 'aw1') return [award()];
          seen.push(q);
          return [{ id: 'aw1', name: 'Best and Fairest', season: 2026, closes_at: noon('2026-10-10') }];
        },
        teams: () => [team('t1', 'Open A')],
      },
      rpcs: {
        award_vote_breakdown: [
          { team_id: 't1', fixture_id: null, fixture_label: null, starts_at: null, preseason: false, nominee_key: 'n1', nominee_name: 'Nia Nominee', rank: 1, votes: 4, points: 12 },
        ],
        award_turnout: [{ team_id: 't1', fixture_id: null, fixture_label: null, starts_at: null, preseason: false, ballots: 4, voters: 10 }],
      },
    });
    // Only awards closed by now, newest first.
    expect(argOf(seen[0], 'lte')).toEqual(['closes_at', '2026-10-18T02:00:00.000Z']);
    expect(argOf(seen[0], 'order')).toEqual(['closes_at', { ascending: false }]);
    fireEvent.press(screen.getByText('Best and Fairest'));
    await settle();
    expect(screen).toHavePathname('/admin/reports/award');
    expect(screen.getByText('Standings · Open A')).toBeTruthy();
    expect(screen.getByText('4 of 10 who could vote cast a ballot.')).toBeTruthy();
    expect(screen.getByText('Standings · Removed group')).toBeTruthy();
    expect(stat('Ballots cast')).toBe('4');
    const { name, pdf } = await exportPdf();
    expect(name).toBe('sample-best-and-fairest-results-2026-10-18.pdf');
    expect(pdf.text).toContain('Nia Nominee');
  });

  it('says when no award has closed', async () => {
    await open('admin/reports/awards', AwardResultsScreen, { awards: [] });
    expect(screen.getByText('No awards have closed yet.')).toBeTruthy();
  });

  it('keeps the results hidden until voting closes', async () => {
    await open('admin/reports/award', AwardReportScreen, { teams: [] }, {
      tableHandlers: { awards: () => [award({ closes_at: noon('2026-10-30') })] },
      rpcs: { award_vote_breakdown: [], award_turnout: [] },
    }, '/admin/reports/award?id=aw1');
    expect(screen.getByText('Full results show once voting has closed.')).toBeTruthy();
    expect(screen.queryByText('Export PDF')).toBeNull();
  });

  it('shows the whole club’s standings for an award not run per group', async () => {
    await open('admin/reports/award', AwardReportScreen, { teams: [] }, {
      tableHandlers: { awards: () => [award({ per_group: false, club_wide: true, award_groups: [] })] },
      rpcs: { award_vote_breakdown: [], award_turnout: [] },
    }, '/admin/reports/award?id=aw1');
    expect(screen.getByText('Standings')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('Attendance', () => {
  const SQUAD = team('sq', '17 & Under Squad', { kind: 'squad', sort_order: 1 });
  const TEAM_A = team('ta', '17 & Under A', { squad_id: 'sq', sort_order: 2 });
  const U12 = team('tb', 'Under 12', { sort_order: 3 });
  const sessions = [
    { id: 's1', club_wide: false, team_id: 'ta', team_name: '17 & Under A', name: 'Training A', held_at: noon('2026-10-06'), taken_by_name: 'Sample coach' },
    { id: 's2', club_wide: false, team_id: 'tb', team_name: 'Under 12', name: 'Training B', held_at: noon('2026-10-07'), taken_by_name: null },
    { id: 'c1', club_wide: true, team_id: null, team_name: '', name: 'Club day', held_at: noon('2026-10-08'), taken_by_name: null },
  ];
  const marks = [
    { session_id: 's1', profile_id: 'amy', present: true, member_name: null },
    { session_id: 's1', profile_id: 'ben', present: false, member_name: null },
    { session_id: 's2', profile_id: 'cal', present: true, member_name: null },
    { session_id: 'c1', profile_id: 'amy', present: true, member_name: null },
  ];
  const absences = [
    { athlete_id: 'ben', from_day: '2026-10-06', to_day: '2026-10-06', category: 'Personal illness', category_order: 1 },
    { athlete_id: 'cal', from_day: '2026-10-01', to_day: '2026-10-02', category: 'Planned holidays', category_order: 2 },
  ];
  let absenceArgs: Record<string, unknown>[] = [];

  async function openAttendance() {
    absenceArgs = [];
    await open('admin/reports/attendance', AttendanceReportScreen, { teams: [SQUAD, TEAM_A, U12], attendance_marks: marks }, {
      tableHandlers: {
        attendance_sessions: recordTable(sessions),
        profiles: (q) =>
          q.eq('id') === undefined
            ? [
                { id: 'amy', full_name: 'Amy Sample', email: null },
                { id: 'ben', full_name: null, email: 'ben@example.test' },
                { id: 'cal', full_name: 'Cal Sample', email: null },
              ]
            : undefined,
      },
      rpcHandlers: {
        absence_report: (args) => {
          absenceArgs.push(args);
          return absences;
        },
      },
    });
  }

  const sessionWindow = () => {
    const last = seen.filter((q) => q.name === 'attendance_sessions').pop()!;
    return [argOf(last, 'gte'), argOf(last, 'lt')];
  };

  it('covers the last 4 weeks of every squad, team and club event to start', async () => {
    await openAttendance();
    expect(sessionWindow()).toEqual([
      ['held_at', new Date(2026, 8, 20).toISOString()],
      ['held_at', new Date(2026, 9, 19).toISOString()],
    ]);
    expect(absenceArgs[absenceArgs.length - 1]).toEqual({ p_from: '2026-09-20', p_to: '2026-10-18' });
    expect(screen.getByText(`${day('2026-09-20')} to ${day('2026-10-18')} · All squads, teams and club events`)).toBeTruthy();
    expect(stat('Sessions')).toBe('3');
    expect(stat('Athletes')).toBe('3');
    expect(stat('Times present')).toBe('3');
    expect(stat('Attendance')).toBe('75%');
    expect(stat('Reported absences')).toBe('2');
    // A member with no name is shown by their email.
    expect(texts()).toContain('ben@example.test');
  });

  it.each([
    ['Last 3 months', '2026-07-18'],
    ['This season', '2026-05-01'],
  ])('changes the period to %s', async (label, from) => {
    await openAttendance();
    chip(label);
    await settle();
    expect(absenceArgs[absenceArgs.length - 1]).toEqual({ p_from: from, p_to: '2026-10-18' });
    expect(sessionWindow()[0]).toEqual(['held_at', new Date(`${from}T00:00:00`).toISOString()]);
  });

  it('offers a from and to date when choosing dates', async () => {
    await openAttendance();
    chip('Choose dates');
    await settle();
    expect(screen.getByText('From')).toBeTruthy();
    expect(screen.getByText('To')).toBeTruthy();
    expect(absenceArgs[absenceArgs.length - 1]).toEqual({ p_from: '2026-09-20', p_to: '2026-10-18' });
  });

  it('counts only the chosen team, and the absences of athletes on its register', async () => {
    await openAttendance();
    chip('Under 12');
    await settle();
    expect(screen.getByText(`${day('2026-09-20')} to ${day('2026-10-18')} · Under 12`)).toBeTruthy();
    expect(stat('Sessions')).toBe('1');
    expect(stat('Athletes')).toBe('1');
    expect(stat('Reported absences')).toBe('1');
    expect(texts()).not.toContain('Session: Training A');
    expect(screen.getByText('Planned holidays')).toBeTruthy();
    expect(screen.queryByText('Personal illness')).toBeNull();
  });

  it('includes a squad’s teams, and club events only when chosen', async () => {
    await openAttendance();
    chip('17 & Under Squad');
    await settle();
    expect(stat('Sessions')).toBe('1');
    expect(texts()).toContain('Session: Training A');
    chip('Whole club events');
    await settle();
    expect(stat('Sessions')).toBe('2');
    expect(texts()).toContain('Session: Club day');
    expect(screen.getByText(`${day('2026-09-20')} to ${day('2026-10-18')} · Whole club events, 17 & Under Squad`)).toBeTruthy();
    // All starts over.
    chip('All');
    await settle();
    expect(stat('Sessions')).toBe('3');
  });

  it('goes back to All when the last chosen group is turned off', async () => {
    await openAttendance();
    chip('Under 12');
    await settle();
    chip('Under 12');
    await settle();
    expect(stat('Sessions')).toBe('3');
  });

  it('exports what is shown for the chosen groups', async () => {
    await openAttendance();
    chip('Under 12');
    await settle();
    const { name, pdf } = await exportPdf();
    expect(name).toBe('sample-attendance-2026-10-18.pdf');
    expect(pdf.text).toContain('Training B');
    expect(pdf.text).toContain('Cal Sample');
    expect(pdf.text).not.toContain('Training A');
    expect(pdf.text).not.toContain('Amy Sample');
  });
});

// ---------------------------------------------------------------------------

describe('Session plans', () => {
  const SQUAD = team('sq', '17 & Under Squad', { kind: 'squad', sort_order: 1 });
  const TEAM_A = team('ta', '17 & Under A', { squad_id: 'sq', sort_order: 2 });
  const U12 = team('tb', 'Under 12', { sort_order: 3 });
  const plan = (id: string, team_id: string, team_name: string, session_on: string) => ({
    id,
    team_id,
    team_name,
    title: `Plan ${id}`,
    session_on,
    starts_at: null,
    author_name: 'Sample coach',
    author_position: 'Head Coach',
    run_by: null,
    has_notes: true,
    file_count: 0,
    created_at: noon(session_on),
    edited_at: null,
  });
  let planArgs: Record<string, unknown>[] = [];

  async function openPlans(teams: Team[] = [SQUAD, TEAM_A, U12]) {
    planArgs = [];
    await open('admin/reports/session-plans', SessionPlanReportScreen, { teams }, {
      rpcHandlers: {
        session_plan_report: (args) => {
          planArgs.push(args);
          return [plan('p1', 'ta', '17 & Under A', '2026-10-06'), plan('p2', 'tb', 'Under 12', '2026-10-07')];
        },
      },
    });
  }

  it('covers the last 3 months of every squad and team to start, red for groups with none', async () => {
    await openPlans();
    expect(planArgs[planArgs.length - 1]).toEqual({ p_from: '2026-07-18', p_to: '2026-10-18' });
    expect(screen.getByText(`${day('2026-07-18')} to ${day('2026-10-18')} · All squads and teams`)).toBeTruthy();
    expect(stat('Plans')).toBe('2');
    expect(stat('Squads and teams with a plan')).toBe('2');
    // The squad itself has no plan of its own.
    expect(texts()).toContain('Plans: 0');
  });

  it('changes the period', async () => {
    await openPlans();
    chip('Last 4 weeks');
    await settle();
    expect(planArgs[planArgs.length - 1]).toEqual({ p_from: '2026-09-20', p_to: '2026-10-18' });
  });

  it('includes a squad’s teams when the squad is chosen, and nothing else', async () => {
    await openPlans();
    chip('17 & Under Squad');
    await settle();
    expect(stat('Plans')).toBe('1');
    expect(texts()).toContain('Session: Plan p1');
    expect(texts().join('\n')).not.toContain('Plan p2');
    const { pdf } = await exportPdf();
    expect(pdf.text).toContain('Plan p1');
    expect(pdf.text).toContain('17 & Under Squad');
    expect(pdf.text).not.toContain('Plan p2');
    expect(pdf.text).not.toContain('Under 12');
  });

  it('opens a plan from the list', async () => {
    await openPlans();
    fireEvent.press(screen.getByText('07/10/2026 · Under 12 · Plan p2'));
    await settle();
    expect(screen.getByText('screen:session-plan')).toBeTruthy();
    expect(screen).toHavePathname('/session-plans/p2');
  });
});

// ---------------------------------------------------------------------------

describe('Medical details checks', () => {
  const row = (id: string, extra: Partial<MedicalComplianceRow>): MedicalComplianceRow => ({
    athlete_id: id,
    athlete_name: id,
    minor: false,
    has_verified_guardian: false,
    teams: 'Open A',
    has_contacts: true,
    checked_at: '2026-03-01T02:00:00Z',
    checked_by_name: id,
    due_on: '2027-03-01',
    status: 'current',
    ...extra,
  });
  const ROWS = [
    row('Ada Adult', {}),
    row('Bo Overdue', { checked_at: '2025-09-01T02:00:00Z', due_on: '2026-09-01', status: 'overdue' }),
    row('Cam Child', { minor: true, has_verified_guardian: true, checked_by_name: 'Pia Parent', due_on: '2026-11-10', status: 'due_soon' }),
    row('Dee New', { minor: true, has_contacts: false, checked_at: null, checked_by_name: null, due_on: null, status: 'missing', teams: null }),
  ];

  it('loads the status from the database, and only that', async () => {
    await open('admin/reports/medical', MedicalCheckReportScreen, {}, { rpcs: { medical_review_compliance: ROWS } });
    expect((supabase.rpc as jest.Mock).mock.calls.map(([n]) => n)).toContain('medical_review_compliance');
    expect(screen.getByText('Checked in the last year')).toBeTruthy();
  });

  it('groups athletes overdue, with nothing saved, due soon and up to date, and counts them', async () => {
    await open('admin/reports/medical', MedicalCheckReportScreen, {}, { rpcs: { medical_review_compliance: ROWS } });
    const { name, pdf } = await exportPdf();
    expect(name).toMatch(/^sample-medical-details-checks-\d{4}-\d{2}-\d{2}\.pdf$/);
    for (const text of ['Overdue', 'Nothing saved', 'Due within 30 days', 'Up to date', 'Bo Overdue', 'Dee New', 'Pia Parent', 'Never', 'No verified parent or guardian', 'Parent or guardian']) {
      expect(pdf.text).toContain(text);
    }
    expect(pdf.text).toContain('Checked in the last year');
    expect(pdf.text).toContain('50%');
    expect(pdf.text).toContain(formatDateString('2026-09-01'));
    expect(pdf.text).toContain('This report shows no medical details');
  });

  it('shows the database’s refusal', async () => {
    await open('admin/reports/medical', MedicalCheckReportScreen, {}, {
      rpcErrors: { medical_review_compliance: 'Only admins can see the medical details check report' },
    });
    expect(screen.getByText(/Only admins can see the medical details check report/)).toBeTruthy();
  });
});
