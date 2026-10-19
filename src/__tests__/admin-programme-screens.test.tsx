/**
 * Administration's programme screens, as an admin uses them: Integrity
 * training (src/app/admin/training/index.tsx and edit.tsx), Season KPI
 * reviews (admin/kpi-reviews.tsx), Absence reasons (admin/absence-reasons.tsx)
 * and the Injury report (admin/injuries.tsx). Section 10 of the user guide
 * has the rules: training is set per season for chosen roles and groups, the
 * safeguarding induction is one tap and goes once the season has it, absence
 * reasons are switched off rather than deleted, and the injury report covers
 * a chosen number of months (3 by default) plus everything not yet cleared,
 * with no medical documents.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen, within } from 'expo-router/testing-library';
import { RefreshControl } from 'react-native';

import AbsenceReasonsScreen from '@/app/admin/absence-reasons';
import InjuryReportScreen from '@/app/admin/injuries';
import KpiReviewsScreen from '@/app/admin/kpi-reviews';
import EditTrainingScreen from '@/app/admin/training/edit';
import AdminTrainingScreen from '@/app/admin/training/index';
import { formatDateString, shareCsv } from '@/lib/injuries';
import { reportPdf } from '@/lib/pdf';
import { sharePdf } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { TrainingRequirement } from '@/lib/training';
import type { InjuryReportRow, Team } from '@/lib/types';

import { openScreen, resetClub, settle, TEAM, TEAM_B } from './helpers/harness';
import {
  failTableWrite,
  flip,
  input,
  isDisabled,
  isOn,
  isSelected,
  recordTables,
  type,
  writes,
  type TableQuery,
} from './helpers/settings-forms';

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

// Each test settles a whole screen several times; leave room on a busy machine.
jest.setTimeout(30000);
jest.mock('@/lib/injuries', () => ({ ...jest.requireActual('@/lib/injuries'), shareCsv: jest.fn(async () => {}) }));
jest.mock('@/lib/reports', () => ({ ...jest.requireActual('@/lib/reports'), sharePdf: jest.fn(async () => {}) }));
jest.mock('@/lib/pdf', () => ({ ...jest.requireActual('@/lib/pdf'), reportPdf: jest.fn(() => new Uint8Array([1])) }));

const rpc = () => supabase.rpc as jest.Mock;
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);

beforeEach(() => {
  resetClub();
  rpc().mockClear();
  (shareCsv as jest.Mock).mockClear();
  (sharePdf as jest.Mock).mockClear();
  (reportPdf as jest.Mock).mockClear();
});

function Placeholder() {
  return null;
}

const SQUAD: Team = { ...TEAM, id: 'squad-open', name: 'Open Squad', kind: 'squad', sort_order: 0 };
const OLD_TEAM: Team = { ...TEAM, id: 'team-2025', name: 'Old team', season: 2025 };
const TEAMS: Team[] = [TEAM, SQUAD, TEAM_B];

// ---------------------------------------------------------------------------
// Integrity training

function requirement(extra: Partial<TrainingRequirement>): TrainingRequirement {
  return {
    id: 'r1',
    season: 2026,
    name: 'Safeguarding in Sport',
    details: null,
    course_url: null,
    due_on: '2026-12-01',
    roles: ['coach'],
    all_teams: true,
    archived: false,
    training_requirement_teams: [],
    ...extra,
  };
}

const INDUCTION = 'Child Safeguarding in Sport Induction';

async function openTraining(requirements: TrainingRequirement[], options: { teams?: Team[]; rpcs?: Record<string, unknown>; rpcErrors?: Record<string, string> } = {}) {
  await openScreen(
    'admin',
    {
      'admin/training/index': AdminTrainingScreen,
      'admin/training/edit': Placeholder,
      'training/requirement/[id]': Placeholder,
    },
    '/admin/training',
    { training_requirements: requirements, teams: options.teams ?? TEAMS },
    {
      rpcs: {
        training_overview: [{ requirement_id: 'r1', required: 10, approved: 4, submitted: 2, outstanding: 4 }],
        admin_copy_training_requirements: 2,
        ...options.rpcs,
      },
      rpcErrors: options.rpcErrors,
    },
  );
}

describe('Integrity training', () => {
  it('lists this season’s training with who must do it and how many are done', async () => {
    await openTraining([
      requirement({}),
      requirement({ id: 'r2', name: 'Anti-doping', roles: ['athlete'], all_teams: false, training_requirement_teams: [{ team_id: TEAM.id }], archived: true }),
    ]);
    expect(callsTo('training_overview')).toEqual([{ p_season: 2026 }]);
    expect(screen.getByText('Safeguarding in Sport')).toBeTruthy();
    expect(screen.getByText('Coaches, all squads and teams')).toBeTruthy();
    expect(screen.getByText(`Due ${formatDateString('2026-12-01')} · 4 of 10 approved · 2 waiting to be checked`)).toBeTruthy();
    expect(screen.getByText('Anti-doping (archived)')).toBeTruthy();
    expect(screen.getByText('Athletes in Open A')).toBeTruthy();
  });

  it('says when the season has no training yet', async () => {
    await openTraining([]);
    expect(screen.getByText(/^No training set for 2026–27 yet\./)).toBeTruthy();
  });

  it('adds the safeguarding induction for the season in one tap', async () => {
    await openTraining([]);
    fireEvent.press(screen.getByText('Add the safeguarding induction'));
    await settle();
    expect(callsTo('admin_add_safeguarding_induction')).toEqual([{ p_season: 2026 }]);
    expect(screen.getByText(/^Added the Child Safeguarding in Sport Induction for coaches, managers, physios and the committee, due in 3 months\./)).toBeTruthy();
  });

  it('no longer offers the induction once the season has it, whatever its case', async () => {
    await openTraining([requirement({ name: INDUCTION.toUpperCase() })]);
    expect(screen.queryByText('Add the safeguarding induction')).toBeNull();
  });

  it('offers the induction again when the season’s copy is archived', async () => {
    await openTraining([requirement({ name: INDUCTION, archived: true })]);
    expect(screen.getByText('Add the safeguarding induction')).toBeTruthy();
  });

  it('shows a refused induction', async () => {
    await openTraining([], { rpcErrors: { admin_add_safeguarding_induction: 'Only admins can set training' } });
    fireEvent.press(screen.getByText('Add the safeguarding induction'));
    await settle();
    expect(screen.getByText('Only admins can set training')).toBeTruthy();
  });

  it('offers to copy last season’s courses the new season doesn’t have', async () => {
    await openTraining([
      requirement({ id: 'old1', season: 2025, name: 'Safeguarding in Sport' }),
      requirement({ id: 'old2', season: 2025, name: 'Anti-doping' }),
      requirement({ id: 'old3', season: 2025, name: 'Retired course', archived: true }),
      requirement({ id: 'r1', name: 'safeguarding in sport' }),
    ]);
    expect(screen.getByText('2025–26 had 1 course 2026–27 doesn’t: Anti-doping.')).toBeTruthy();
    fireEvent.press(screen.getByText('Copy 2025–26 training'));
    await settle();
    expect(callsTo('admin_copy_training_requirements')).toEqual([{ p_from: 2025, p_to: 2026 }]);
    expect(screen.getByText('Copied 2 courses with due dates a year on. Check each one’s squads and teams.')).toBeTruthy();
  });

  it('shows a refused copy', async () => {
    await openTraining([requirement({ id: 'old', season: 2025 })], { rpcErrors: { admin_copy_training_requirements: 'Copy refused' } });
    fireEvent.press(screen.getByText('Copy 2025–26 training'));
    await settle();
    expect(screen.getByText('Copy refused')).toBeTruthy();
  });

  it('switches to last season, offering no copy into it', async () => {
    await openTraining([requirement({ id: 'old', season: 2025, name: 'Old course' })]);
    fireEvent.press(screen.getByText('2025–26'));
    await settle();
    expect(screen.getByText('Old course')).toBeTruthy();
    expect(callsTo('training_overview').at(-1)).toEqual({ p_season: 2025 });
    expect(screen.queryByText(/^Copy /)).toBeNull();
  });

  it('opens Add training for the season shown, and a course’s page', async () => {
    await openTraining([requirement({})]);
    fireEvent.press(screen.getByText('Add training'));
    await settle();
    expect(screen).toHavePathnameWithParams('/admin/training/edit?season=2026');
    act(() => router.back());
    await settle();
    fireEvent.press(screen.getByText('Safeguarding in Sport'));
    await settle();
    expect(screen).toHavePathname('/training/requirement/r1');
  });
});

async function openTrainingForm(url: string, saved: TrainingRequirement | null = null, rpcErrors: Record<string, string> = {}, teams = [...TEAMS, OLD_TEAM]) {
  await openScreen(
    'admin',
    { 'admin/training/index': Placeholder, 'admin/training/edit': EditTrainingScreen, 'training/requirement/[id]': Placeholder },
    '/admin/training',
    { teams },
    {
      tableHandlers: { training_requirements: (q) => (saved && q.eq('id') === saved.id ? [saved] : []) },
      rpcs: { admin_save_training_requirement: 'r-new' },
      rpcErrors,
    },
  );
  act(() => router.push(url));
  await settle();
}

const pickDay = (y: number, m: number, d: number) =>
  fireEvent.press(screen.getByLabelText(new Date(y, m, d).toDateString()));

describe('adding and changing training', () => {
  it('says what is missing before saving anything', async () => {
    await openTrainingForm('/admin/training/edit?season=2026');
    fireEvent.press(screen.getByText('Athletes'));
    fireEvent.press(screen.getByText('Coaches'));
    flip('All squads and teams', false);
    fireEvent.press(screen.getAllByText('Add training').at(-1)!);
    await settle();
    expect(screen.getByText('Add a name, a due date, who must complete it, squads or teams.')).toBeTruthy();
    expect(callsTo('admin_save_training_requirement')).toEqual([]);
  });

  it('adds training for athletes and coaches in every group by default, then opens it', async () => {
    await openTrainingForm('/admin/training/edit?season=2026');
    expect(screen.getByText('2026–27 season')).toBeTruthy();
    expect(isSelected('Athletes')).toBe(true);
    expect(isSelected('Coaches')).toBe(true);
    expect(isOn('All squads and teams')).toBe(true);
    type('Course', 'Safeguarding in Sport');
    type('Details (optional)', 'About 90 minutes');
    type('Course link (optional)', 'https://elearning.example');
    pickDay(2026, 9, 30);
    fireEvent.press(screen.getAllByText('Add training').at(-1)!);
    await settle();
    expect(callsTo('admin_save_training_requirement')).toEqual([
      {
        p_id: null,
        p_season: 2026,
        p_name: 'Safeguarding in Sport',
        p_details: 'About 90 minutes',
        p_course_url: 'https://elearning.example',
        p_due_on: '2026-10-30',
        p_roles: ['athlete', 'coach'],
        p_team_ids: [],
      },
    ]);
    expect(screen).toHavePathname('/training/requirement/r-new');
  });

  it('offers only the season’s squads and teams, squads first, and saves the chosen ones and roles', async () => {
    await openTrainingForm('/admin/training/edit?season=2026');
    type('Course', 'Junior course');
    pickDay(2026, 9, 30);
    fireEvent.press(screen.getByText('Coaches'));
    fireEvent.press(screen.getByText('Guardians'));
    flip('All squads and teams', false);
    expect(screen.queryByText('Old team')).toBeNull();
    const chips = ['Open Squad', 'Open A', '17 & Under A'].map((n) => screen.getByText(n));
    expect(chips).toHaveLength(3);
    fireEvent.press(screen.getByText('Open Squad'));
    fireEvent.press(screen.getByText('17 & Under A'));
    fireEvent.press(screen.getAllByText('Add training').at(-1)!);
    await settle();
    expect(callsTo('admin_save_training_requirement')[0]).toMatchObject({
      p_roles: ['athlete', 'guardian'],
      p_team_ids: ['squad-open', TEAM_B.id],
    });
  });

  it('never offers guests as a role', async () => {
    await openTrainingForm('/admin/training/edit?season=2026');
    expect(screen.queryByText('Guests')).toBeNull();
    for (const label of ['Athletes', 'Coaches', 'Managers', 'Physios', 'Committee', 'Admins', 'Guardians']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('says when the season has no squads or teams to choose', async () => {
    await openTrainingForm('/admin/training/edit?season=2027');
    flip('All squads and teams', false);
    expect(screen.getByText('2027–28 has no squads or teams yet.')).toBeTruthy();
  });

  it('loads saved training and saves it under its id', async () => {
    const saved = requirement({ id: 'r1', details: 'Online', course_url: 'https://x.example', roles: ['manager'], all_teams: false, training_requirement_teams: [{ team_id: TEAM.id }] });
    await openTrainingForm('/admin/training/edit?id=r1', saved);
    expect(input('Course').props.value).toBe('Safeguarding in Sport');
    expect(isOn('All squads and teams')).toBe(false);
    expect(isSelected('Open A')).toBe(true);
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(callsTo('admin_save_training_requirement')).toEqual([
      {
        p_id: 'r1',
        p_season: 2026,
        p_name: 'Safeguarding in Sport',
        p_details: 'Online',
        p_course_url: 'https://x.example',
        p_due_on: '2026-12-01',
        p_roles: ['manager'],
        p_team_ids: [TEAM.id],
      },
    ]);
  });

  it('shows a refused save and stays', async () => {
    await openTrainingForm('/admin/training/edit?id=r1', requirement({}), { admin_save_training_requirement: 'Choose roles' });
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Choose roles')).toBeTruthy();
    expect(screen).toHavePathname('/admin/training/edit');
  });

  it('archives training and brings it back', async () => {
    await openTrainingForm('/admin/training/edit?id=r1', requirement({}));
    fireEvent.press(screen.getByText('Archive'));
    await settle();
    expect(callsTo('admin_set_training_archived')).toEqual([{ p_id: 'r1', p_archived: true }]);
    expect(screen.getByText('2026–27 season · archived')).toBeTruthy();
    fireEvent.press(screen.getByText('Bring it back'));
    await settle();
    expect(callsTo('admin_set_training_archived').at(-1)).toEqual({ p_id: 'r1', p_archived: false });
  });

  it('shows a refused archive and keeps it as it was', async () => {
    await openTrainingForm('/admin/training/edit?id=r1', requirement({}), { admin_set_training_archived: 'Not allowed' });
    fireEvent.press(screen.getByText('Archive'));
    await settle();
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.getByText('Archive')).toBeTruthy();
  });

  it('removes training after asking, then goes back to the list', async () => {
    await openTrainingForm('/admin/training/edit?id=r1', requirement({}));
    fireEvent.press(screen.getByText('Remove'));
    expect(screen.getByText('This removes the training for everyone. Training with certificates can only be archived.')).toBeTruthy();
    fireEvent.press(screen.getByText('Remove training'));
    await settle();
    expect(callsTo('admin_delete_training_requirement')).toEqual([{ p_id: 'r1' }]);
    expect(screen).toHavePathname('/admin/training');
  });

  it('shows why training with certificates can’t be removed', async () => {
    await openTrainingForm('/admin/training/edit?id=r1', requirement({}), {
      admin_delete_training_requirement: 'Training with certificates can only be archived',
    });
    fireEvent.press(screen.getByText('Remove'));
    fireEvent.press(screen.getByText('Remove training'));
    await settle();
    expect(screen.getByText('Training with certificates can only be archived')).toBeTruthy();
    expect(screen).toHavePathname('/admin/training/edit');
  });

  it('has no Archive or Remove for new training', async () => {
    await openTrainingForm('/admin/training/edit?season=2026');
    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Season KPI reviews

const POINTS = [
  { id: 'k1', season: 2026, name: 'Mid-season review', due_on: '2027-01-15' },
  { id: 'k2', season: 2026, name: 'End of season', due_on: '2027-04-30' },
];

async function openKpis(options: { points?: unknown[]; teams?: Team[]; rpcErrors?: Record<string, string> } = {}) {
  await openScreen('admin', { 'admin/kpi-reviews': KpiReviewsScreen }, '/admin/kpi-reviews', { teams: options.teams ?? TEAMS }, {
    rpcs: { kpi_review_points: options.points ?? POINTS },
    rpcErrors: options.rpcErrors,
  });
}

describe('Season KPI reviews', () => {
  it('lists the season’s review dates', async () => {
    await openKpis();
    expect(callsTo('kpi_review_points')).toEqual([{ p_season: 2026 }]);
    expect(screen.getByText('2026–27')).toBeTruthy();
    expect(screen.getByText('Mid-season review')).toBeTruthy();
    expect(screen.getByText(formatDateString('2027-01-15'))).toBeTruthy();
  });

  it('says when there are none yet', async () => {
    await openKpis({ points: [] });
    expect(screen.getByText('No review dates yet.')).toBeTruthy();
  });

  it('needs a name and a date, then adds the review date to the season shown', async () => {
    await openKpis({ points: [] });
    fireEvent.press(screen.getByText('Add a review date'));
    expect(isDisabled('Add review date')).toBe(true);
    type('Review', 'Mid-season review');
    expect(isDisabled('Add review date')).toBe(true);
    pickDay(2026, 9, 31);
    expect(isDisabled('Add review date')).toBe(false);
    rpc().mockClear();
    fireEvent.press(screen.getByText('Add review date'));
    await settle();
    expect(callsTo('admin_save_kpi_review_point')).toEqual([
      { p_id: null, p_season: 2026, p_name: 'Mid-season review', p_due_on: '2026-10-31' },
    ]);
    // Reloaded, and the form closed.
    expect(callsTo('kpi_review_points')).toHaveLength(1);
    expect(screen.getByText('Add a review date')).toBeTruthy();
  });

  it('changes a review date under its id', async () => {
    await openKpis();
    fireEvent.press(screen.getByText('Mid-season review'));
    type('Review', 'Mid-season check');
    fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(callsTo('admin_save_kpi_review_point')).toEqual([
      { p_id: 'k1', p_season: 2026, p_name: 'Mid-season check', p_due_on: '2027-01-15' },
    ]);
  });

  it('removes a review date after asking', async () => {
    await openKpis();
    fireEvent.press(screen.getByText('End of season'));
    fireEvent.press(screen.getByText('Remove review date'));
    expect(screen.getByText(/You can only remove it while no reviews have been written for it\./)).toBeTruthy();
    fireEvent.press(screen.getByText('Remove it'));
    await settle();
    expect(callsTo('admin_delete_kpi_review_point')).toEqual([{ p_id: 'k2' }]);
  });

  it('shows why a review date can’t be removed and keeps the form open', async () => {
    await openKpis({ rpcErrors: { admin_delete_kpi_review_point: 'Reviews have been written for this date' } });
    fireEvent.press(screen.getByText('End of season'));
    fireEvent.press(screen.getByText('Remove review date'));
    fireEvent.press(screen.getByText('Remove it'));
    await settle();
    expect(screen.getByText('Reviews have been written for this date')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('cancelling saves nothing', async () => {
    await openKpis();
    fireEvent.press(screen.getByText('Mid-season review'));
    fireEvent.press(screen.getByText('Cancel'));
    expect(callsTo('admin_save_kpi_review_point')).toEqual([]);
    expect(screen.getByText('Mid-season review')).toBeTruthy();
  });

  it('switches season and adds dates to that season', async () => {
    await openKpis({ teams: [...TEAMS, OLD_TEAM], points: [] });
    fireEvent.press(screen.getByText('2025–26'));
    await settle();
    expect(callsTo('kpi_review_points').at(-1)).toEqual({ p_season: 2025 });
    fireEvent.press(screen.getByText('Add a review date'));
    type('Review', 'Wrap-up');
    pickDay(2026, 9, 20);
    fireEvent.press(screen.getByText('Add review date'));
    await settle();
    expect(callsTo('admin_save_kpi_review_point')[0]).toMatchObject({ p_season: 2025 });
  });

  it('loads the dates again when pulled to refresh', async () => {
    await openKpis();
    rpc().mockClear();
    await act(async () => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    await settle();
    expect(callsTo('kpi_review_points')).toEqual([{ p_season: 2026 }]);
  });
});

// ---------------------------------------------------------------------------
// Absence reasons

const REASONS = [
  { id: 'ar1', name: 'Planned holidays', active: true, sort_order: 1 },
  { id: 'ar2', name: 'West Coast Fever', active: false, sort_order: 7 },
  { id: 'ar3', name: 'Other', active: true, sort_order: 10 },
];

let reasonLog: TableQuery[];

async function openReasons(reasons = REASONS) {
  const recorder = recordTables(['absence_categories']);
  reasonLog = recorder.log;
  await openScreen('admin', { 'admin/absence-reasons': AbsenceReasonsScreen }, '/admin/absence-reasons', {
    absence_categories: reasons,
  }, { tableHandlers: recorder.handlers });
}

async function addReason(name: string) {
  type('Reason', name);
  fireEvent.press(screen.getByText('Add reason'));
  await settle();
}

describe('Absence reasons', () => {
  it('lists every reason, on or off, with how many are on', async () => {
    await openReasons();
    expect(screen.getByText('Reasons (2 of 3 on)')).toBeTruthy();
    expect(isOn('Planned holidays')).toBe(true);
    expect(isOn('West Coast Fever')).toBe(false);
    // Off ones are listed too, so they can be switched back on.
    const read = reasonLog.find((q) => q.calls.some((c) => c.method === 'select'))!;
    expect(read.calls.some((c) => c.method === 'eq')).toBe(false);
  });

  it('switches a reason off without deleting it', async () => {
    await openReasons();
    flip('Planned holidays', false);
    await settle();
    expect(writes(reasonLog, 'absence_categories')).toEqual([
      { method: 'update', values: { active: false }, filters: [['id', 'ar1']] },
    ]);
  });

  it('switches a reason back on', async () => {
    await openReasons();
    flip('West Coast Fever', true);
    await settle();
    expect(writes(reasonLog, 'absence_categories')).toEqual([
      { method: 'update', values: { active: true }, filters: [['id', 'ar2']] },
    ]);
  });

  it('shows a refused switch', async () => {
    await openReasons();
    failTableWrite('absence_categories', 'update', 'Only admins can change absence reasons');
    flip('Other', false);
    await settle();
    expect(screen.getByText('Only admins can change absence reasons')).toBeTruthy();
  });

  it('says members report without a reason when every reason is off', async () => {
    await openReasons(REASONS.map((r) => ({ ...r, active: false })));
    expect(screen.getByText('Reasons (0 of 3 on)')).toBeTruthy();
    expect(screen.getByText('With every reason off, members report absences without one.')).toBeTruthy();
  });

  it('adds a reason at the end of the list, trimmed', async () => {
    await openReasons();
    await addReason('  State League final  ');
    expect(writes(reasonLog, 'absence_categories')).toEqual([
      { method: 'insert', values: { name: 'State League final', sort_order: 11 }, filters: [] },
    ]);
    expect(input('Reason').props.value).toBe('');
  });

  it('adds the first reason with sort order 1', async () => {
    await openReasons([]);
    await addReason('Exams');
    expect(writes(reasonLog, 'absence_categories')[0].values).toEqual({ name: 'Exams', sort_order: 1 });
  });

  it('needs a reason typed first', async () => {
    await openReasons();
    await addReason('   ');
    expect(screen.getByText('Type the reason first.')).toBeTruthy();
    expect(writes(reasonLog, 'absence_categories')).toEqual([]);
  });

  it('refuses a reason already on the list, whatever its case, even when it’s off', async () => {
    await openReasons();
    await addReason('west coast fever');
    expect(screen.getByText('That reason is already on the list. Switch it on instead.')).toBeTruthy();
    expect(writes(reasonLog, 'absence_categories')).toEqual([]);
  });

  it('keeps reasons to 40 characters', async () => {
    await openReasons();
    expect(input('Reason').props.maxLength).toBe(40);
  });

  it('shows a refused new reason and keeps it typed', async () => {
    await openReasons();
    failTableWrite('absence_categories', 'insert', 'duplicate key value');
    await addReason('Exams');
    expect(screen.getByText('duplicate key value')).toBeTruthy();
    expect(input('Reason').props.value).toBe('Exams');
  });
});

// ---------------------------------------------------------------------------
// Injury report

function injury(extra: Partial<InjuryReportRow>): InjuryReportRow {
  return {
    id: 'i1',
    athlete_name: 'Sample athlete',
    athlete_email: 'athlete@example.test',
    athlete_left_at: null,
    body_area: 'Left ankle',
    injured_on: '2026-10-01',
    reported_at: '2026-10-02T03:00:00Z',
    status: 'injured',
    restrictions: 'No jumping',
    expected_return: '2026-11-01',
    coach_endorsed_by_name: null,
    cleared_by_name: null,
    cleared_at: null,
    update_count: 2,
    document_count: 1,
    ...extra,
  };
}

const INJURIES = [
  injury({}),
  injury({
    id: 'i2',
    athlete_name: 'Left athlete',
    athlete_left_at: '2026-09-20T00:00:00Z',
    body_area: '=Knee',
    status: 'cleared',
    cleared_by_name: 'Sample physio',
    coach_endorsed_by_name: 'Sample coach',
    cleared_at: '2026-10-10T05:00:00Z',
    restrictions: null,
  }),
];

async function openInjuries(rows: InjuryReportRow[] | null = INJURIES, rpcErrors: Record<string, string> = {}) {
  await openScreen('admin', { 'admin/injuries': InjuryReportScreen, 'injuries/[id]': Placeholder }, '/admin/injuries', {}, {
    rpcs: { injury_report: rows },
    rpcErrors,
  });
}

describe('Injury report', () => {
  it('covers the last 3 months by default, with totals', async () => {
    await openInjuries();
    expect(callsTo('injury_report')).toEqual([{ p_since: '2026-07-18' }]);
    expect(input('Months to include').props.value).toBe('3');
    expect(screen.getByText(/^Injuries reported or cleared since .*, and every injury that hasn’t been cleared yet\.$/)).toBeTruthy();
    expect(screen.getByText('Sample athlete · Left ankle')).toBeTruthy();
    const stat = (label: string) => {
      let node = screen.getByText(label).parent;
      while (node && within(node).queryAllByText(/^\d+$/).length === 0) node = node.parent;
      return within(node!).getByText(/^\d+$/).props.children;
    };
    expect(stat('Injuries')).toBe(2);
    expect(stat('Not cleared')).toBe(1);
    expect(stat('Cleared')).toBe(1);
  });

  it.each([
    ['12', '2025-10-18'],
    ['200', '2016-10-18'],
    ['1', '2026-09-18'],
    ['6x', '2026-04-18'],
  ])('asks for “%s” months from %s, between 1 and 120 months', async (months, since) => {
    await openInjuries();
    rpc().mockClear();
    type('Months to include', months);
    await settle();
    expect(callsTo('injury_report').at(-1)).toEqual({ p_since: since });
  });

  it.each(['0', ''])('falls back to 3 months for “%s”', async (months) => {
    await openInjuries();
    type('Months to include', '12');
    await settle();
    rpc().mockClear();
    type('Months to include', months);
    await settle();
    expect(callsTo('injury_report')).toEqual([{ p_since: '2026-07-18' }]);
  });

  it('keeps only digits in the months', async () => {
    await openInjuries();
    type('Months to include', '1a2');
    expect(input('Months to include').props.value).toBe('12');
  });

  it('says when there are no injuries, and can’t export nothing', async () => {
    await openInjuries([]);
    expect(screen.getByText('No injuries in this period.')).toBeTruthy();
    expect(isDisabled('Export PDF')).toBe(true);
    expect(isDisabled('Export CSV')).toBe(true);
  });

  it('shows why the report didn’t load', async () => {
    await openInjuries(null, { injury_report: 'Only admins can see the injury report' });
    expect(screen.getByText('Only admins can see the injury report')).toBeTruthy();
  });

  it('exports a CSV of every injury, with counts of documents rather than the documents', async () => {
    await openInjuries();
    fireEvent.press(screen.getByText('Export CSV'));
    await settle();
    expect(shareCsv).toHaveBeenCalledTimes(1);
    const [name, csv] = (shareCsv as jest.Mock).mock.calls[0] as [string, string];
    expect(name).toBe('sample-injuries-2026-10-18.csv');
    const lines = csv.split(/\r?\n/);
    expect(lines[0]).toBe(
      '"Athlete","Email","Left club","Injury","Injured on","Reported","Status","Restrictions","Expected back","Endorsed by","Cleared by","Cleared on","Updates","Documents"',
    );
    expect(lines[1]).toBe(
      '"Sample athlete","athlete@example.test","","Left ankle","2026-10-01","2026-10-02","Injured","No jumping","2026-11-01","","","","2","1"',
    );
    // A formula-looking value is made safe for spreadsheets.
    expect(lines[2]).toContain('"\'=Knee"');
    expect(lines[2]).toContain('"2026-09-20"');
    expect(lines[2]).toContain('"Sample coach","Sample physio","2026-10-10"');
  });

  it('exports the PDF under the club’s name', async () => {
    await openInjuries();
    fireEvent.press(screen.getByText('Export PDF'));
    await settle();
    expect(reportPdf).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String) }), {
      clubName: 'Sample Club',
      accent: expect.any(String),
    });
    expect((sharePdf as jest.Mock).mock.calls[0][0]).toBe('sample-injuries-2026-10-18.pdf');
  });

  it('shows why an export failed', async () => {
    await openInjuries();
    (shareCsv as jest.Mock).mockRejectedValueOnce(new Error('Sharing isn’t available'));
    fireEvent.press(screen.getByText('Export CSV'));
    await settle();
    expect(screen.getByText('Sharing isn’t available')).toBeTruthy();
  });

  it('opens an injury', async () => {
    await openInjuries();
    fireEvent.press(screen.getByText('Sample athlete · Left ankle'));
    await settle();
    expect(screen).toHavePathname('/injuries/i1');
  });
});
