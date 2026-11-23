/**
 * Selection rounds, phase 2 (Matt, 23 November 2026): the dates in a round's
 * process, for admins (who set them and mark them done), the panel (who read
 * them and get to-dos) and athletes and their parents (who see the shared
 * ones beside the criteria, on src/app/selection.tsx); the attendance counts
 * on an athlete's assessment; and the dates in the Selection audit report.
 *
 * Who may read or change what is the database's call
 * (supabase/tests/selection-dates.sql). The screens show what each function
 * returns, send exactly what the member chose, and show the database's
 * refusal. The route guards are in route-guards-roles.test.tsx and
 * route-guards-features.test.tsx.
 */
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import * as Sharing from 'expo-sharing';

import AdminAuditScreen from '@/app/admin/assessments/audit';
import MilestoneScreen from '@/app/admin/assessments/milestone';
import AdminRoundScreen from '@/app/admin/assessments/round';
import AthleteAssessmentScreen from '@/app/assessments/athlete';
import RoundScreen from '@/app/assessments/round';
import HomeScreen from '@/app/index';
import SelectionScreen from '@/app/selection';
import {
  makeCriteria,
  type AdminRound,
  type AthleteAssessment,
  type Milestone,
  type RoundDate,
  type RoundSheet,
  type SelectionAudit,
  type SelectionInfo,
  type SelectionTodo,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

import { clearCalls, fieldLabelled, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import { readPdf } from './helpers/documents';
import {
  openScreen,
  refreshControl,
  resetClub,
  setClubFeatures,
  settle,
  type BackendOptions,
  type Persona,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
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

type Who = PersonaName | Persona;

jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ selectionAssessments: true });
  clearCalls();
  written.length = 0;
  (Sharing.shareAsync as jest.Mock).mockClear();
});

const d = formatDateString;

const placeholder = (route: string) =>
  function Shown() {
    return <Text>{`screen:${route}`}</Text>;
  };

const press = async (text: string | RegExp, index = 0) => {
  await fireEvent.press(screen.getAllByText(text)[index]);
  await settle(6);
};

const fill = async (label: string, value: string) => {
  await fireEvent.changeText(fieldLabelled(label), value);
  await settle(2);
};

/** The selection functions a screen called, leaving out what signing in reads. */
const assessmentRpcs = () => rpcNames().filter((n) => /assessment|selection/.test(n));

/** Pulls the screen down to refresh it, and waits for it to finish. */
async function pullToRefresh() {
  await act(async () => {
    refreshControl().props.onRefresh();
  });
  await settle();
  expect(refreshControl().props.refreshing).toBe(false);
}

// The harness's today is 18 October 2026.
const TODAY = '2026-10-18';

const CRITERIA = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Coachability', scale: ['Developing', 'Meets standard', 'Exceeds standard'], items: ['Accepts feedback'] },
]);

function milestone(extra: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    title: 'Teams named',
    due_on: '2026-10-28',
    shared: true,
    done_at: null,
    done_by_name: null,
    removed_at: null,
    removed_by_name: null,
    created_by_name: 'Sample admin',
    created_at: '2026-10-04T01:00:00Z',
    days_late: 0,
    ...extra,
  };
}

const DATES: Milestone[] = [
  milestone({ id: 'm0', title: 'Criteria shared with athletes', due_on: '2026-10-06', done_at: '2026-10-07T02:00:00Z', done_by_name: 'Sample admin', days_late: 1 }),
  milestone({ id: 'm2', title: 'Panel meeting', due_on: '2026-10-15', shared: false, days_late: 3 }),
  milestone(),
  milestone({ id: 'm3', title: 'Trial day', due_on: '2026-10-10', removed_at: '2026-10-08T02:00:00Z', removed_by_name: 'Sample admin' }),
];

function adminRound(extra: Partial<AdminRound> = {}): AdminRound {
  return {
    id: 'r1',
    team_id: 't1',
    team_name: '17 & Under squad',
    season: 2027,
    name: '2027 selection phase',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed_at: null,
    created_at: '2026-10-04T01:00:00Z',
    athletes: 14,
    observations: 22,
    panel: [],
    ...extra,
  };
}

const TEAMS = [
  { id: 't1', name: '17 & Under squad', sort_order: 1, kind: 'squad', season: 2027, squad_id: null, selections_completed_at: null },
];

// ---------------------------------------------------------------------------
// An admin: a round's dates

describe('a round’s dates, for an admin', () => {
  async function openRound(dates: Milestone[] | null = DATES, round: AdminRound | null = adminRound(), options: BackendOptions = {}) {
    await openScreen(
      'admin',
      { 'admin/assessments/round': AdminRoundScreen, 'admin/assessments/milestone': placeholder('admin/assessments/milestone') },
      '/admin/assessments/round?id=r1',
      { teams: TEAMS },
      { rpcs: { admin_selection_rounds: round ? [round] : [], admin_selection_milestones: dates }, ...options },
    );
  }

  it('asks for the round’s dates', async () => {
    await openRound();
    expect(onlyRpcCall('admin_selection_milestones')).toEqual({ p_round_id: 'r1' });
  });

  it('lists each standing date with when it is due, who marked it done and who sees it', async () => {
    await openRound();
    expect(screen.getByText('Criteria shared with athletes')).toBeTruthy();
    expect(
      screen.getByText(`${d('2026-10-06')} · Done ${d('2026-10-07')} by Sample admin, 1 day late · athletes and parents see it`),
    ).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-15')} · 3 days overdue · panel and admins only`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-28')} · In 10 days · athletes and parents see it`)).toBeTruthy();
  });

  it('keeps a date taken off out of the list, and says it stays in the audit report', async () => {
    await openRound();
    expect(screen.queryByText('Trial day')).toBeNull();
    expect(screen.getByText('Taken off: Trial day. They stay in the audit report.')).toBeTruthy();
  });

  it('says when there are none yet, and offers to add one', async () => {
    await openRound([]);
    expect(screen.getByText('No dates yet.')).toBeTruthy();
    expect(screen.queryByText(/^Taken off:/)).toBeNull();
    expect(screen.getByText('Add a date')).toBeTruthy();
  });

  it('treats no answer as no dates', async () => {
    await openRound(null);
    expect(screen.getByText('No dates yet.')).toBeTruthy();
  });

  it('opens a new date for the round', async () => {
    await openRound();
    await press('Add a date');
    expect(screen.getByText('screen:admin/assessments/milestone')).toBeTruthy();
  });

  it('offers no more once a round holds 12, or once it is closed', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => milestone({ id: `m${i}`, title: `Step ${i + 1}` }));
    await openRound(twelve);
    expect(screen.getByText('Step 12')).toBeTruthy();
    expect(screen.queryByText('Add a date')).toBeNull();
  });

  it('counts only standing dates towards the 12', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => milestone({ id: `m${i}`, title: `Step ${i + 1}` }));
    await openRound([...eleven, milestone({ id: 'gone', title: 'Gone', removed_at: '2026-10-08T02:00:00Z' })]);
    expect(screen.getByText('Add a date')).toBeTruthy();
  });

  it('offers no new date on a closed round, and still lists its dates', async () => {
    await openRound(DATES, adminRound({ closed_at: '2026-10-17T02:00:00Z' }));
    expect(screen.getByText('Panel meeting')).toBeTruthy();
    expect(screen.queryByText('Add a date')).toBeNull();
  });

  it('never asks for dates of a round that can’t be found', async () => {
    await openRound(DATES, null);
    expect(rpcCalls('admin_selection_milestones')).toEqual([]);
  });
});

describe('opening one of a round’s dates', () => {
  it('opens it with the round and its id', async () => {
    await openScreen(
      'admin',
      { 'admin/assessments/round': AdminRoundScreen, 'admin/assessments/milestone': MilestoneScreen },
      '/admin/assessments/round?id=r1',
      { teams: TEAMS },
      { rpcs: { admin_selection_rounds: [adminRound()], admin_selection_milestones: DATES } },
    );
    await press('Teams named');
    expect(fieldLabelled('What happens').props.value).toBe('Teams named');
    expect(rpcCalls('admin_selection_milestones').at(-1)).toEqual({ p_round_id: 'r1' });
  });
});

// ---------------------------------------------------------------------------
// An admin: adding and changing a date

/** The day's square in the month calendar on screen. */
const pickDay = async (year: number, month: number, day: number) => {
  await fireEvent.press(screen.getAllByLabelText(new Date(year, month - 1, day).toDateString())[0]);
  await settle(2);
};

describe('a date in a round, for an admin', () => {
  async function openDate(id: string | null, options: BackendOptions = {}, dates: Milestone[] | null = DATES) {
    await openScreen(
      'admin',
      { index: placeholder('index'), 'admin/assessments/milestone': MilestoneScreen },
      '/',
      {},
      { rpcs: { admin_selection_milestones: dates }, ...options },
    );
    await pushTo(`/admin/assessments/milestone?round=r1${id ? `&id=${id}` : ''}`);
    await settle();
  }

  it('starts a new date empty, shared with athletes and parents, and reads nothing', async () => {
    await openDate(null);
    expect(fieldLabelled('What happens').props.value).toBe('');
    expect(screen.getByText(/the verified parents of those under 18 see this date beside the criteria/)).toBeTruthy();
    expect(screen.getByText('Add date')).toBeTruthy();
    expect(screen.queryByText('Mark as done')).toBeNull();
    expect(screen.queryByText('Take this date off')).toBeNull();
    expect(assessmentRpcs()).toEqual([]);
  });

  it('asks for a name, then a day, and sends nothing until both are there', async () => {
    await openDate(null);
    await press('Add date');
    expect(screen.getByText('Name the date, such as Teams named.')).toBeTruthy();
    await press('Teams named');
    await press('Add date');
    expect(screen.getByText('Choose the day.')).toBeTruthy();
    expect(rpcCalls('admin_save_selection_milestone')).toEqual([]);
  });

  it('adds a suggested date for the round, shared, then goes back', async () => {
    await openDate(null);
    await press('Teams named');
    await pickDay(2026, 10, 28);
    await press('Add date');
    expect(onlyRpcCall('admin_save_selection_milestone')).toEqual({
      p_id: null,
      p_round_id: 'r1',
      p_title: 'Teams named',
      p_due_on: '2026-10-28',
      p_shared: true,
    });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('adds a date of the club’s own that only the panel and admins see', async () => {
    await openDate(null);
    await fill('What happens', '  Selectors’ dinner ');
    await pickDay(2026, 10, 30);
    await press('Panel and admins only');
    expect(screen.getByText('Only the panel and admins see this date.')).toBeTruthy();
    await press('Add date');
    expect(onlyRpcCall('admin_save_selection_milestone')).toEqual({
      p_id: null,
      p_round_id: 'r1',
      p_title: 'Selectors’ dinner',
      p_due_on: '2026-10-30',
      p_shared: false,
    });
  });

  it('shows the database’s refusal and stays on the screen', async () => {
    await openDate(null, { rpcErrors: { admin_save_selection_milestone: 'A round holds 12 dates at most' } });
    await press('Trials');
    await pickDay(2026, 10, 28);
    await press('Add date');
    expect(screen.getByText('A round holds 12 dates at most')).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });

  it('opens a saved date filled in, with no suggestions, and saves it under its id', async () => {
    await openDate('m2');
    expect(onlyRpcCall('admin_selection_milestones')).toEqual({ p_round_id: 'r1' });
    expect(fieldLabelled('What happens').props.value).toBe('Panel meeting');
    expect(screen.getByText('Only the panel and admins see this date.')).toBeTruthy();
    expect(screen.queryByText('Or choose one')).toBeNull();
    await fill('What happens', 'Panel meets');
    await press('Athletes and parents too');
    await press('Save');
    expect(onlyRpcCall('admin_save_selection_milestone')).toEqual({
      p_id: 'm2',
      p_round_id: 'r1',
      p_title: 'Panel meets',
      p_due_on: '2026-10-15',
      p_shared: true,
    });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('marks a date done, then goes back', async () => {
    await openDate('m1');
    await press('Mark as done');
    expect(onlyRpcCall('admin_set_selection_milestone_done')).toEqual({ p_id: 'm1', p_done: true });
    expect(rpcCalls('admin_save_selection_milestone')).toEqual([]);
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('takes a date off, saying it stays in the audit report', async () => {
    await openDate('m1');
    expect(screen.getByText('A date taken off stops reminding anyone and stays in the audit report.')).toBeTruthy();
    await press('Take this date off');
    expect(onlyRpcCall('admin_remove_selection_milestone')).toEqual({ p_id: 'm1' });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('shows why a date couldn’t be marked done', async () => {
    await openDate('m1', { rpcErrors: { admin_set_selection_milestone_done: 'Only admins can change a selection round’s dates' } });
    await press('Mark as done');
    expect(screen.getByText('Only admins can change a selection round’s dates')).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });

  it('shows a done date as it stands, with only Mark as not done', async () => {
    await openDate('m0');
    expect(screen.getByText('Criteria shared with athletes')).toBeTruthy();
    expect(screen.getByText(/Done .* by Sample admin, 1 day late/)).toBeTruthy();
    expect(screen.getByText(/A date that is done can’t be changed/)).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Take this date off')).toBeNull();
    await press('Mark as not done');
    expect(onlyRpcCall('admin_set_selection_milestone_done')).toEqual({ p_id: 'm0', p_done: false });
  });

  it('shows a date taken off as it was, with nothing to change', async () => {
    await openDate('m3');
    expect(screen.getByText('Trial day')).toBeTruthy();
    expect(screen.getByText('This date was taken off. It stays in the audit report.')).toBeTruthy();
    for (const button of ['Save', 'Mark as done', 'Mark as not done', 'Take this date off']) {
      expect(screen.queryByText(button)).toBeNull();
    }
  });

  it('says when the date can’t be found, or why it couldn’t load', async () => {
    await openDate('nope');
    expect(screen.getByText('This date can’t be found.')).toBeTruthy();
  });

  it('shows the database’s refusal to read a round’s dates', async () => {
    await openDate('m1', { rpcErrors: { admin_selection_milestones: 'Only admins can see a selection round’s dates' } }, null);
    expect(screen.getByText('Only admins can see a selection round’s dates')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The panel: dates on a round, attendance on an assessment

function sheet(extra: Partial<RoundSheet> = {}): RoundSheet {
  return {
    id: 'r1',
    name: '2027 selection phase',
    team_name: '17 & Under squad',
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    closed: false,
    criteria: CRITERIA,
    today: TODAY,
    hidden: 0,
    athletes: [],
    ...extra,
  };
}

describe('a round’s dates, for the panel', () => {
  const PANEL_DATES: RoundDate[] = [
    { id: 'm0', title: 'Criteria shared with athletes', due_on: '2026-10-06', done: true },
    { id: 'm2', title: 'Panel meeting', due_on: '2026-10-15', done: false },
    { id: 'm4', title: 'Trials', due_on: '2026-10-18', done: false },
    { id: 'm1', title: 'Teams named', due_on: '2026-10-28', done: false },
  ];

  async function openRound(dates: RoundDate[] | null, options: BackendOptions = {}) {
    await openScreen('coach', { 'assessments/round': RoundScreen }, '/assessments/round?id=r1', {}, {
      rpcs: { selection_round_sheet: sheet(), selection_round_dates: dates },
      ...options,
    });
  }

  it('asks for the round’s dates, and nothing an admin reads', async () => {
    await openRound(PANEL_DATES);
    expect(onlyRpcCall('selection_round_dates')).toEqual({ p_round_id: 'r1' });
    // Where feedback stands comes with it: a state for each athlete, never the words.
    expect(assessmentRpcs()).toEqual([
      'selection_round_sheet',
      'selection_round_dates',
      'selection_round_summaries',
      'selection_round_feedback',
    ]);
  });

  it('shows only the next date still to do until the card is tapped', async () => {
    await openRound(PANEL_DATES);
    expect(screen.getByText('Next: Panel meeting · 3 days overdue')).toBeTruthy();
    expect(screen.getByText('Tap to see all 4 dates')).toBeTruthy();
    expect(screen.queryByText('Dates')).toBeNull();
    expect(screen.queryByText(/Teams named/)).toBeNull();
    await press(/^Next: /);
    expect(screen.getByText('Dates')).toBeTruthy();
    await press('Dates');
    expect(screen.getByText('Next: Panel meeting · 3 days overdue')).toBeTruthy();
  });

  it('says when every date is done', async () => {
    await openRound(PANEL_DATES.map((date) => ({ ...date, done: true })));
    expect(screen.getByText('Every date is done')).toBeTruthy();
  });

  it('lists each date with how close it is', async () => {
    await openRound(PANEL_DATES);
    await press(/^Next: /);
    expect(screen.getByText('Dates')).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-06')} · Criteria shared with athletes · Done`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-15')} · Panel meeting · 3 days overdue`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-18')} · Trials · Today`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-28')} · Teams named · In 10 days`)).toBeTruthy();
  });

  it.each([[[] as RoundDate[]], [null]])('shows no Dates card when there are none (%j)', async (dates) => {
    await openRound(dates);
    expect(screen.getByText('2027 selection phase')).toBeTruthy();
    expect(screen.queryByText('Dates')).toBeNull();
  });

  it('reads the dates again on pull to refresh', async () => {
    await openRound(PANEL_DATES);
    await pullToRefresh();
    expect(rpcCalls('selection_round_dates')).toHaveLength(2);
  });

  it('never asks for dates when the round is refused', async () => {
    await openRound(PANEL_DATES, { rpcErrors: { selection_round_sheet: 'You are not on this round’s panel' } });
    expect(screen.getByText('You are not on this round’s panel')).toBeTruthy();
    expect(rpcCalls('selection_round_dates')).toEqual([]);
    expect(screen.queryByText('Dates')).toBeNull();
  });
});

describe('attendance on an athlete’s assessment', () => {
  const ASSESSMENT: AthleteAssessment = {
    round_id: 'r1',
    round_name: '2027 selection phase',
    closed: false,
    starts_on: '2026-10-05',
    criteria: CRITERIA,
    today: TODAY,
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    observations: [],
  };

  async function openAthlete(attendance: unknown, options: BackendOptions = {}) {
    await openScreen('coach', { 'assessments/athlete': AthleteAssessmentScreen }, '/assessments/athlete?round=r1&athlete=a1', {}, {
      rpcs: { athlete_assessment: ASSESSMENT, athlete_round_attendance: attendance },
      ...options,
    });
  }

  it('asks for the athlete’s counts in the round', async () => {
    await openAthlete([{ sessions: 6, attended: 5 }]);
    expect(onlyRpcCall('athlete_round_attendance')).toEqual({ p_round_id: 'r1', p_athlete_id: 'a1' });
  });

  it('shows two counts, and nothing about why a session was missed', async () => {
    await openAthlete([{ sessions: 6, attended: 5 }]);
    expect(screen.getByText('Marked at 5 of 6 sessions in this round')).toBeTruthy();
    expect(screen.queryByText(/absent|injur|sick|reason|%/i)).toBeNull();
  });

  it.each([[[{ sessions: 0, attended: 0 }]], [[]], [null]])('says nothing when no session was held (%j)', async (attendance) => {
    await openAthlete(attendance);
    expect(screen.getByText('Jordan Junior')).toBeTruthy();
    expect(screen.queryByText(/^Marked at/)).toBeNull();
  });

  it('never asks for attendance when the assessment is refused', async () => {
    await openAthlete([{ sessions: 6, attended: 5 }], {
      rpcErrors: { athlete_assessment: 'You can’t see this athlete’s assessment' },
    });
    expect(screen.getByText('You can’t see this athlete’s assessment')).toBeTruthy();
    expect(rpcCalls('athlete_round_attendance')).toEqual([]);
  });

  it('still shows the assessment when the counts are refused', async () => {
    await openAthlete(null, { rpcErrors: { athlete_round_attendance: 'boom' } });
    expect(screen.getByText('Jordan Junior')).toBeTruthy();
    expect(screen.getByText('Add an observation')).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The audit report

describe('dates in the Selection audit report', () => {
  const AUDIT: SelectionAudit = {
    round: {
      id: 'r1',
      name: '2027 selection phase',
      team_name: '17 & Under squad',
      season: 2027,
      starts_on: '2026-10-05',
      ends_on: '2026-11-29',
      opened_at: '2026-10-04T01:00:00Z',
      opened_by_name: 'Sample admin',
      closed_at: null,
      closed_by_name: null,
      criteria_groups: 2,
      criteria_items: 3,
      athletes: 0,
      observations: 0,
      today: TODAY,
    },
    panel: [],
    selectors: [],
    athletes: [],
  };

  async function openAudit(dates: Milestone[] | null, options: BackendOptions = {}) {
    await openScreen('admin', { 'admin/assessments/audit': AdminAuditScreen }, '/admin/assessments/audit?id=r1', {}, {
      rpcs: { admin_selection_audit: AUDIT, admin_selection_milestones: dates },
      ...options,
    });
  }

  it('lists each date with when it was done and by whom, and keeps the one taken off', async () => {
    await openAudit(DATES);
    expect(screen.getByText('Dates')).toBeTruthy();
    expect(screen.getByText(new RegExp(`${d('2026-10-07')} by Sample admin`))).toBeTruthy();
    expect(screen.getAllByText(/Not yet/)).toHaveLength(2);
    expect(screen.getByText(new RegExp(`Trial day \\(taken off ${d('2026-10-08')} by Sample admin\\)`))).toBeTruthy();
  });

  it('says when no dates were set', async () => {
    await openAudit(null);
    expect(screen.getByText('No dates were set for this round.')).toBeTruthy();
  });

  it('reads the dates again on pull to refresh', async () => {
    await openAudit(DATES);
    await pullToRefresh();
    expect(rpcCalls('admin_selection_milestones')).toHaveLength(2);
  });

  it('puts the dates in the PDF', async () => {
    await openAudit(DATES);
    await fireEvent.press(screen.getByText('Export PDF'));
    await settle();
    const pdf = readPdf(written[0].bytes);
    expect(pdf.text).toContain('Panel meeting');
    expect(pdf.text).toContain('Trial day (taken off');
    expect(pdf.text).not.toMatch(/Meets standard|Passing|Coachability/);
  });

  it('never asks for dates when the audit is refused', async () => {
    await openAudit(DATES, { rpcErrors: { admin_selection_audit: 'Only admins can build the audit report' } });
    expect(screen.getByText('Only admins can build the audit report')).toBeTruthy();
    expect(rpcCalls('admin_selection_milestones')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Athletes and parents: the criteria and the dates

function info(extra: Partial<SelectionInfo> = {}): SelectionInfo {
  return {
    round_id: 'r1',
    round_name: '2027 selection phase',
    team_name: '17 & Under squad',
    athlete_id: 'a1',
    athlete_name: 'Jordan Junior',
    is_me: true,
    starts_on: '2026-10-05',
    ends_on: '2026-11-29',
    criteria: CRITERIA,
    dates: [
      { title: 'Criteria shared with athletes', due_on: '2026-10-06', done: true },
      { title: 'Trials', due_on: '2026-10-12', done: false },
      { title: 'Teams named', due_on: '2026-10-28', done: false },
    ],
    ...extra,
  };
}

describe('Selection, for an athlete or a parent', () => {
  async function openSelection(who: Who, rows: SelectionInfo[] | null, options: BackendOptions = {}) {
    await openScreen(who, { selection: SelectionScreen }, '/selection', {}, { rpcs: { my_selection_info: rows }, ...options });
  }

  it('asks only for the member’s own selection information', async () => {
    await openSelection('athlete', [info()]);
    // And feedback the head coach shared with them, if any.
    expect(assessmentRpcs().sort()).toEqual(['my_selection_feedback', 'my_selection_info']);
    expect(rpcCalls('my_selection_info')).toEqual([{}]);
  });

  it('shows an athlete their round, its dates and what the selectors look for', async () => {
    await openSelection('athlete', [info()]);
    expect(screen.getByText('2027 selection phase')).toBeTruthy();
    expect(screen.getByText(`17 & Under squad · ${d('2026-10-05')} to ${d('2026-11-29')}`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-06')} · Criteria shared with athletes · Done`)).toBeTruthy();
    expect(screen.getByText(`${d('2026-10-28')} · Teams named · In 10 days`)).toBeTruthy();
    expect(screen.getByText('What the selectors look for')).toBeTruthy();
    expect(screen.getByText('Technical ability')).toBeTruthy();
    expect(screen.getByText('Passing, Catching')).toBeTruthy();
    expect(screen.getByText('Seen as: Developing, Meets standard, Exceeds standard')).toBeTruthy();
  });

  it('never calls a past date overdue to an athlete: it isn’t theirs to do', async () => {
    await openSelection('athlete', [info()]);
    expect(screen.getByText(`${d('2026-10-12')} · Trials`)).toBeTruthy();
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('says there is no score, and offers nothing to write, answer or open', async () => {
    await openSelection('athlete', [info()]);
    expect(screen.getByText(/There is no score or ranking/)).toBeTruthy();
    expect(screen.queryByText(/observation|Add|Reply|Comment/i)).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('names the child on a parent’s screen, one block per child', async () => {
    await openSelection('guardian', [
      info({ is_me: false }),
      info({ is_me: false, athlete_id: 'a2', athlete_name: null, round_id: 'r2', round_name: 'Opens selection', dates: [] }),
    ]);
    expect(screen.getByText('Jordan Junior: 2027 selection phase')).toBeTruthy();
    expect(screen.getByText('Your child: Opens selection')).toBeTruthy();
    expect(screen.getByText('The club hasn’t shared any dates yet.')).toBeTruthy();
  });

  it.each([[[] as SelectionInfo[]], [null]])('says when no round is open for them (%j)', async (rows) => {
    await openSelection('athlete', rows);
    expect(screen.getByText('There is no selection round open for you now.')).toBeTruthy();
    expect(screen.queryByText('What the selectors look for')).toBeNull();
  });

  it('reads it again on pull to refresh', async () => {
    await openSelection('athlete', [info()]);
    await pullToRefresh();
    expect(rpcCalls('my_selection_info')).toHaveLength(2);
  });

  it('shows nothing, and asks for nothing, while the feature is off', async () => {
    setClubFeatures({});
    await openSelection('athlete', [info()]);
    expect(rpcNames()).not.toContain('my_selection_info');
    expect(screen.queryByText('What the selectors look for')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Home

describe('Home', () => {
  const TODO: SelectionTodo = {
    kind: 'date',
    round_id: 'r1',
    round_name: '2027 selection phase',
    milestone_id: 'm1',
    title: 'Teams named',
    due_on: '2026-10-20',
    athletes: null,
    for_admin: false,
  };

  async function openHome(who: Who, rpcs: Record<string, unknown>) {
    await openScreen(
      who,
      {
        index: HomeScreen,
        selection: placeholder('selection'),
        'assessments/round': placeholder('assessments/round'),
        'admin/assessments/round': placeholder('admin/assessments/round'),
      },
      '/',
      {},
      { rpcs },
    );
  }

  it('gives an athlete in a round a Selection card with the next date, and opens it', async () => {
    await openHome('athlete', { my_selection_info: [info()] });
    expect(screen.getByText('Selection')).toBeTruthy();
    expect(screen.getByText(`2027 selection phase · next: Teams named, ${d('2026-10-28')}`)).toBeTruthy();
    await press('Selection');
    expect(screen.getByText('screen:selection')).toBeTruthy();
  });

  it('gives a parent the card for their child’s round', async () => {
    await openHome('guardian', { my_selection_info: [info({ is_me: false })] });
    expect(screen.getByText('Selection')).toBeTruthy();
  });

  it('shows no card to an athlete in no open round', async () => {
    await openHome('athlete', { my_selection_info: [] });
    expect(rpcNames()).toContain('my_selection_info');
    expect(screen.queryByText('Selection')).toBeNull();
  });

  it.each<PersonaName>(['coach', 'admin', 'manager', 'committee', 'physio'])(
    'never asks for selection information for %s',
    async (who) => {
      await openHome(who, { my_selection_info: [info()] });
      expect(rpcNames()).not.toContain('my_selection_info');
      expect(screen.queryByText('Selection')).toBeNull();
    },
  );

  it.each<PersonaName>(['athlete', 'guardian', 'manager', 'committee', 'physio'])(
    'never asks for selection to-dos for %s',
    async (who) => {
      await openHome(who, { my_selection_todos: [TODO] });
      expect(rpcNames()).not.toContain('my_selection_todos');
      expect(screen.queryByText('Teams named: 2027 selection phase')).toBeNull();
    },
  );

  it('gives a panel member a to-do as a date comes close, opening the round', async () => {
    await openHome('coach', { my_selection_todos: [TODO] });
    expect(screen.getByText('Teams named: 2027 selection phase')).toBeTruthy();
    expect(screen.getByText(new RegExp(`Due ${d('2026-10-20')}`))).toBeTruthy();
    await press('Teams named: 2027 selection phase');
    expect(screen.getByText('screen:assessments/round')).toBeTruthy();
  });

  it('gives an admin who isn’t on the panel the same date, opening the round’s set-up', async () => {
    await openHome('admin', { my_selection_todos: [{ ...TODO, for_admin: true }] });
    await press('Teams named: 2027 selection phase');
    expect(screen.getByText('screen:admin/assessments/round')).toBeTruthy();
  });

  it('tells a panel member how many athletes have nothing written as the round runs out', async () => {
    await openHome('coach', {
      my_selection_todos: [{ ...TODO, kind: 'thin', milestone_id: null, title: null, due_on: '2026-10-25', athletes: 3 }],
    });
    expect(screen.getByText('3 athletes have nothing written yet: 2027 selection phase')).toBeTruthy();
  });

  it('asks for neither while the feature is off', async () => {
    setClubFeatures({});
    await openHome('coach', { my_selection_todos: [TODO] });
    await openHome('athlete', { my_selection_info: [info()] });
    expect(rpcNames()).not.toContain('my_selection_todos');
    expect(rpcNames()).not.toContain('my_selection_info');
  });
});
