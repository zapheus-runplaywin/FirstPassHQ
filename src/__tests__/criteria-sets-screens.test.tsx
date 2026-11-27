/**
 * Criteria sets (Matt, 27 November 2026). For admins: the Rounds and
 * Criteria sets tabs (src/app/admin/assessments/index.tsx), one criteria set
 * with its Criteria, Who it's for and History tabs (criteria.tsx), and
 * choosing a set when opening a round or before assessing starts (round.tsx).
 *
 * Which sets fit a group, the default, and when a set can be deleted or a
 * round's set changed are the database's call
 * (supabase/tests/selection-criteria-sets.sql). The screens show what each
 * function returns, send exactly what the admin chose, and show the
 * database's refusal.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AdminCriteriaScreen from '@/app/admin/assessments/criteria';
import AdminAssessmentsScreen from '@/app/admin/assessments/index';
import AdminRoundScreen from '@/app/admin/assessments/round';
import {
  makeCriteria,
  starterCriteria,
  type AdminRound,
  type CriteriaSet,
  type CriteriaSetSummary,
  type SetChoice,
} from '@/lib/assessments';
import { formatDateString as d } from '@/lib/injuries';

import { clearCalls, fieldLabelled, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import { openScreen, resetClub, setClubFeatures, settle, type BackendOptions } from './helpers/harness';

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

jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ selectionAssessments: true });
  clearCalls();
});

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

const CRITERIA = makeCriteria([
  { name: 'Technical ability', items: ['Passing', 'Catching'] },
  { name: 'Team focus', items: ['Supports teammates'] },
]);

// Squads and teams: a squad with one team, and a team with no squad.
const TEAMS = [
  { id: 't1', name: '17 & Under squad', sort_order: 1, kind: 'squad', season: 2027, squad_id: null, selections_completed_at: null },
  { id: 't3', name: '17 & Under Blue', sort_order: 2, kind: 'team', season: 2027, squad_id: 't1', selections_completed_at: null },
  { id: 't2', name: 'Open A', sort_order: 3, kind: 'team', season: 2027, squad_id: null, selections_completed_at: null },
];

function summary(extra: Partial<CriteriaSetSummary> = {}): CriteriaSetSummary {
  return {
    id: 's1',
    name: 'Junior criteria',
    version: 2,
    for_all: false,
    for_label: '17 & Under squad and its teams, Open A',
    groups: 9,
    items: 33,
    rounds: 2,
    archived_at: null,
    archived_by_name: null,
    updated_at: '2026-10-10T01:00:00Z',
    updated_by_name: 'Sample admin',
    ...extra,
  };
}

function fullSet(extra: Partial<CriteriaSet> = {}): CriteriaSet {
  return {
    id: 's1',
    name: 'Junior criteria',
    version: 3,
    criteria: CRITERIA,
    for_all: true,
    for: [],
    for_label: 'Every squad and team',
    rounds: [],
    archived_at: null,
    events: [
      { kind: 'saved', version: 3, detail: null, by_name: 'Matt', at: '2026-12-10T01:00:00Z' },
      { kind: 'for', version: null, detail: '17 & Under squad and its teams', by_name: 'Matt', at: '2026-12-10T01:00:00Z' },
      { kind: 'renamed', version: null, detail: 'From “Juniors” to “Junior criteria”', by_name: 'Matt', at: '2026-12-09T01:00:00Z' },
      { kind: 'archived', version: null, detail: null, by_name: 'Matt', at: '2026-12-08T01:00:00Z' },
      { kind: 'restored', version: null, detail: null, by_name: 'Matt', at: '2026-12-08T02:00:00Z' },
      { kind: 'created', version: 1, detail: 'Every squad and team', by_name: 'Matt', at: '2026-12-01T01:00:00Z' },
    ],
    ...extra,
  };
}

const USED_ROUND = {
  id: 'r1',
  name: '2027 selection phase',
  team_name: '17 & Under squad',
  starts_on: '2026-10-05',
  ends_on: '2026-11-29',
  criteria_set_version: 2,
};

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
    observations: 0,
    panel: [],
    criteria_set_id: 's1',
    criteria_set_name: 'Junior criteria',
    criteria_set_version: 3,
    can_change_criteria: true,
    ...extra,
  };
}

function choice(extra: Partial<SetChoice> = {}): SetChoice {
  return {
    set_id: 's1',
    name: 'Junior criteria',
    version: 3,
    groups: 6,
    items: 20,
    for_label: '17 & Under squad and its teams',
    is_default: true,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The list: Rounds and Criteria sets

describe('Club > Season > Selection rounds and criteria', () => {
  async function openList(rpcs: BackendOptions['rpcs'] = {}, options: BackendOptions = {}) {
    await openScreen(
      'admin',
      {
        'admin/assessments/index': AdminAssessmentsScreen,
        'admin/assessments/criteria': placeholder('admin/assessments/criteria'),
        'admin/assessments/round': placeholder('admin/assessments/round'),
      },
      '/admin/assessments',
      {},
      { rpcs: { admin_criteria_sets: [summary()], admin_selection_rounds: [adminRound()], ...rpcs }, ...options },
    );
  }

  it('tells the admin what they set up, and reads sets and rounds, never the old criteria', async () => {
    await openList();
    expect(screen.getByText(/Only a round’s panel reads them/)).toBeTruthy();
    const asked = rpcNames().filter((n) => /criteria|selection/.test(n));
    expect(asked.sort()).toEqual(['admin_criteria_sets', 'admin_selection_rounds']);
  });

  it('groups rounds under Running now, Coming up and a folded Finished, and names groups with no round', async () => {
    await openScreen(
      'admin',
      { 'admin/assessments/index': AdminAssessmentsScreen, 'admin/assessments/round': placeholder('admin/assessments/round') },
      '/admin/assessments',
      { teams: TEAMS },
      {
        rpcs: {
          admin_criteria_sets: [summary()],
          admin_selection_rounds: [
            adminRound({ id: 'now', name: 'Trials', phase: 1, round_number: 2 }),
            adminRound({ id: 'later', name: 'Phase 2, Round 1', phase: 2, round_number: 1, starts_on: '2026-12-01', ends_on: '2027-01-31', observations: 0 }),
            adminRound({ id: 'late', name: 'Unclosed', starts_on: '2026-09-01', ends_on: '2026-10-10' }),
            adminRound({ id: 'done', name: 'Done', starts_on: '2026-08-01', ends_on: '2026-08-30', closed_at: '2026-08-30T00:00:00Z' }),
          ],
        },
      },
    );
    expect(screen.getByText('Running now')).toBeTruthy();
    expect(screen.getByText('Phase 1, Round 2 · Trials')).toBeTruthy();
    expect(screen.getByText('17 & Under squad · 5 Oct to 29 Nov')).toBeTruthy();
    expect(screen.getByText('Coming up')).toBeTruthy();
    expect(screen.getByText('Phase 2, Round 1')).toBeTruthy();
    // No counts on a round that hasn't started.
    expect(screen.getAllByText(/selectors? on the panel/)).toHaveLength(1);
    expect(screen.queryByText('Unclosed')).toBeNull();
    await press('Finished (2)');
    expect(screen.getByText('Unclosed')).toBeTruthy();
    expect(screen.getByText('Ended 10 Oct · not closed yet')).toBeTruthy();
    expect(screen.getByText('Done (closed)')).toBeTruthy();
    expect(screen.getByText('No round this season: 17 & Under Blue, Open A')).toBeTruthy();
  });

  it('opens on Rounds, with each round’s set and version', async () => {
    await openList({
      admin_selection_rounds: [
        adminRound(),
        adminRound({ id: 'r0', name: 'Old round', criteria_set_name: 'Club criteria', criteria_set_version: null }),
      ],
    });
    expect(screen.getByText('Rounds (2)')).toBeTruthy();
    expect(screen.getByText('Criteria sets (1)')).toBeTruthy();
    expect(screen.getByText('Junior criteria, version 3')).toBeTruthy();
    // A round opened before sets shows the set's name alone.
    expect(screen.getByText('Club criteria')).toBeTruthy();
  });

  it('asks for a criteria set first, and offers no round until one has criteria', async () => {
    await openList({ admin_criteria_sets: [], admin_selection_rounds: [] });
    expect(screen.getByText('Add a criteria set first. A round takes its own copy when it opens.')).toBeTruthy();
    expect(screen.queryByText('Open a selection round')).toBeNull();
  });

  it('opens a round from Rounds', async () => {
    await openList();
    await press('Open a selection round');
    expect(screen.getByText('screen:admin/assessments/round')).toBeTruthy();
  });

  it('shows each set’s four lines, and folds archived ones', async () => {
    await openList({
      admin_criteria_sets: [
        summary(),
        summary({ id: 's2', name: 'Senior criteria', for_all: true, for_label: 'Every squad and team', groups: 1, items: 1, version: 1, rounds: 0 }),
        summary({ id: 's3', name: 'Old criteria', archived_at: '2026-10-01T00:00:00Z', rounds: 1 }),
      ],
    });
    await press('Criteria sets (2)');
    expect(screen.getByText('Junior criteria')).toBeTruthy();
    expect(screen.getByText('For 17 & Under squad and its teams, Open A')).toBeTruthy();
    expect(screen.getByText('9 groups, 33 items · version 2')).toBeTruthy();
    expect(screen.getByText('Used by 2 rounds')).toBeTruthy();
    expect(screen.getByText('For every squad and team')).toBeTruthy();
    expect(screen.getByText('1 group, 1 item · version 1')).toBeTruthy();
    expect(screen.getByText('Not used yet')).toBeTruthy();
    expect(screen.getByText('Archived (1)')).toBeTruthy();
  });

  it('opens a set from its card', async () => {
    await openList();
    await press('Criteria sets (1)');
    await press('Junior criteria');
    expect(screen.getByText('screen:admin/assessments/criteria')).toBeTruthy();
  });

  it('offers blank, the example, or a copy of each set in use for a new set', async () => {
    await openList({
      admin_criteria_sets: [summary(), summary({ id: 's3', name: 'Old criteria', archived_at: '2026-10-01T00:00:00Z' })],
    });
    await press('Criteria sets (1)');
    await press('New criteria set');
    expect(screen.getByText('Start blank')).toBeTruthy();
    expect(screen.getByText('Start from the netball example')).toBeTruthy();
    expect(screen.getByText('Copy “Junior criteria”')).toBeTruthy();
    expect(screen.queryByText('Copy “Old criteria”')).toBeNull();
    await press('Copy “Junior criteria”');
    expect(screen.getByText('screen:admin/assessments/criteria')).toBeTruthy();
  });

  it.each(['admin_criteria_sets', 'admin_selection_rounds'])('shows the database’s refusal of %s', async (fn) => {
    await openList({}, { rpcErrors: { [fn]: 'Only admins can see the criteria sets' } });
    expect(screen.getByText('Only admins can see the criteria sets')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One criteria set

describe('a criteria set', () => {
  async function openSet(url: string, rpcs: BackendOptions['rpcs'] = {}, options: BackendOptions = {}) {
    await openScreen(
      'admin',
      { index: placeholder('index'), 'admin/assessments/criteria': AdminCriteriaScreen },
      '/',
      { teams: TEAMS },
      { rpcs: { admin_criteria_set: fullSet(), admin_save_criteria_set: 'new-id', ...rpcs }, ...options },
    );
    await pushTo(url);
    await settle();
  }

  it('starts a new set from the example and saves exactly what was chosen', async () => {
    await openSet('/admin/assessments/criteria?start=example');
    expect(screen.getByText('No round has used this set yet.')).toBeTruthy();
    expect(screen.queryByText(/^History/)).toBeNull();
    await press('Save');
    expect(screen.getByText('Name the set, in up to 60 characters.')).toBeTruthy();
    expect(rpcCalls('admin_save_criteria_set')).toEqual([]);
    await fill('Name', 'Netball');
    await press('Save');
    expect(onlyRpcCall('admin_save_criteria_set')).toEqual({
      p_set_id: null,
      p_name: 'Netball',
      p_criteria: starterCriteria(),
      p_for_all: true,
      p_team_ids: [],
    });
  });

  it('folds each group to one row, and opens one at a time', async () => {
    await openSet('/admin/assessments/criteria?start=example');
    expect(screen.getByText('Technical ability · 4 items')).toBeTruthy();
    expect(screen.queryByDisplayValue('Technical ability')).toBeNull();
    await press('Technical ability · 4 items');
    expect(screen.getByDisplayValue('Technical ability')).toBeTruthy();
    await press(/^Coachability · /);
    expect(screen.queryByDisplayValue('Technical ability')).toBeNull();
    expect(screen.getByDisplayValue('Coachability')).toBeTruthy();
  });

  it('copies a set with its name, criteria and who it is for', async () => {
    await openSet('/admin/assessments/criteria?start=s1', {
      admin_criteria_set: fullSet({ for_all: false, for: [{ team_id: 't2', team_name: 'Open A' }] }),
    });
    expect(screen.getByDisplayValue('Junior criteria copy')).toBeTruthy();
    await press('Save');
    expect(onlyRpcCall('admin_save_criteria_set')).toEqual({
      p_set_id: null,
      p_name: 'Junior criteria copy',
      p_criteria: CRITERIA,
      p_for_all: false,
      p_team_ids: ['t2'],
    });
  });

  it('saves a name change as Save, and a criteria change as the next version', async () => {
    await openSet('/admin/assessments/criteria?id=s1');
    await fill('Name', 'Junior set');
    expect(screen.queryByText('Save as version 4')).toBeNull();
    await press('Technical ability · 2 items');
    await fill('Item 2 (group 1)', 'Catching the ball');
    await press('Save as version 4');
    const call = onlyRpcCall('admin_save_criteria_set');
    expect(call.p_set_id).toBe('s1');
    expect(call.p_name).toBe('Junior set');
  });

  it('keeps a typed change when the admin switches tabs', async () => {
    await openSet('/admin/assessments/criteria?id=s1');
    await fill('Name', 'Typed name');
    await press('Who it’s for');
    await press(/^Criteria \(/);
    expect(screen.getByDisplayValue('Typed name')).toBeTruthy();
  });

  it('offers Delete only on a set no round has used, and asks first', async () => {
    await openSet('/admin/assessments/criteria?id=s1');
    expect(screen.queryByText('Archive this set')).toBeNull();
    await press('Delete this set');
    expect(screen.getByText('Delete Junior criteria? This can’t be undone.')).toBeTruthy();
    await press('Delete set');
    expect(onlyRpcCall('admin_delete_criteria_set')).toEqual({ p_set_id: 's1' });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('offers Archive only on a used set, and says why', async () => {
    await openSet('/admin/assessments/criteria?id=s1', { admin_criteria_set: fullSet({ rounds: [USED_ROUND, USED_ROUND] }) });
    expect(screen.getByText(/^2 rounds opened with this set\. They keep the wording they opened with\./)).toBeTruthy();
    expect(screen.queryByText('Delete this set')).toBeNull();
    expect(screen.getByText(/so it is archived, not deleted/)).toBeTruthy();
    await press('Archive this set');
    expect(onlyRpcCall('admin_archive_criteria_set')).toEqual({ p_set_id: 's1', p_archived: true });
  });

  it('shows an archived set read-only, with Bring this set back', async () => {
    await openSet('/admin/assessments/criteria?id=s1', {
      admin_criteria_set: fullSet({ rounds: [USED_ROUND], archived_at: '2026-10-01T00:00:00Z' }),
    });
    expect(screen.queryByText(/^Save/)).toBeNull();
    expect(screen.queryByText('Add a group')).toBeNull();
    await press('Bring this set back');
    expect(onlyRpcCall('admin_archive_criteria_set')).toEqual({ p_set_id: 's1', p_archived: false });
  });

  it('chooses squads and teams: a squad covers its teams', async () => {
    await openSet('/admin/assessments/criteria?id=s1');
    await press('Who it’s for');
    expect(screen.queryByText('Open A')).toBeNull();
    await press('Only the ones I choose');
    expect(screen.getByText(/Choosing a squad covers its teams/)).toBeTruthy();
    await press('Save');
    expect(screen.getByText('Choose the squads or teams this set is for.')).toBeTruthy();
    await press('17 & Under squad');
    expect(screen.getByText('17 & Under squad and its teams')).toBeTruthy();
    const team = screen.getByRole('checkbox', { name: /17 & Under Blue/ });
    expect(team.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    await press('Open A');
    await press('Save');
    expect(onlyRpcCall('admin_save_criteria_set')).toMatchObject({ p_for_all: false, p_team_ids: ['t1', 't2'] });
  });

  it('lists the history, newest first', async () => {
    await openSet('/admin/assessments/criteria?id=s1');
    await press('History (6)');
    expect(screen.getByText(`Version 3 saved · ${d('2026-12-10')} · Matt`)).toBeTruthy();
    expect(screen.getByText(`Now for 17 & Under squad and its teams · ${d('2026-12-10')} · Matt`)).toBeTruthy();
    expect(screen.getByText(`Renamed from “Juniors” to “Junior criteria” · ${d('2026-12-09')} · Matt`)).toBeTruthy();
    expect(screen.getByText(`Archived · ${d('2026-12-08')} · Matt`)).toBeTruthy();
    expect(screen.getByText(`Brought back · ${d('2026-12-08')} · Matt`)).toBeTruthy();
    expect(screen.getByText(`Created · ${d('2026-12-01')} · Matt`)).toBeTruthy();
  });

  it('shows the database’s refusal and stays on the screen', async () => {
    await openSet('/admin/assessments/criteria?id=s1', {}, { rpcErrors: { admin_save_criteria_set: 'Another set is called “Junior criteria”' } });
    await press('Save');
    expect(screen.getByText('Another set is called “Junior criteria”')).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opening a round, and changing its set

/** The day's square in the nth month calendar on screen (Starts, then Ends). */
const pickDay = async (calendar: number, year: number, month: number, day: number) => {
  await fireEvent.press(screen.getAllByLabelText(new Date(year, month - 1, day).toDateString())[calendar]);
  await settle(2);
};

describe('opening a selection round', () => {
  async function openNew(choices: SetChoice[] = [choice()], options: BackendOptions = {}) {
    await openScreen(
      'admin',
      {
        index: placeholder('index'),
        'admin/assessments/round': AdminRoundScreen,
        'admin/assessments/index': placeholder('admin/assessments/index'),
      },
      '/',
      { teams: TEAMS },
      { rpcs: { admin_selection_round_set_choices: choices }, ...options },
    );
    await pushTo('/admin/assessments/round');
    await settle();
  }

  it('explains what a round copies, and asks for no set before a group is chosen', async () => {
    await openNew();
    expect(screen.getByText(/It takes a copy of the criteria set\s+you choose, as it is now/)).toBeTruthy();
    expect(screen.queryByText('Criteria')).toBeNull();
    expect(rpcNames()).not.toContain('admin_selection_round_set_choices');
  });

  it('names everything still to choose, and sends nothing', async () => {
    await openNew();
    await press('Open round');
    expect(screen.getByText('Choose a squad or team, a name, a start date, an end date.')).toBeTruthy();
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
  });

  it('refuses a round that ends before it starts', async () => {
    await openNew();
    await press('17 & Under squad');
    await fill('Name', '2027 selection phase');
    await pickDay(0, 2026, 10, 20);
    await pickDay(1, 2026, 10, 19);
    await press('Open round');
    expect(screen.getByText('The round ends before it starts.')).toBeTruthy();
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
  });

  it('chooses the default set for the group, and sends it', async () => {
    await openNew([choice(), choice({ set_id: 's2', name: 'Senior criteria', is_default: false, for_label: 'Every squad and team' })]);
    await press('17 & Under squad');
    expect(onlyRpcCall('admin_selection_round_set_choices')).toEqual({ p_team_id: 't1' });
    expect(screen.getByText('✓ Junior criteria')).toBeTruthy();
    expect(screen.getByText('Chosen for you: it is the set for 17 & Under squad and its teams.')).toBeTruthy();
    expect(screen.getByText('6 groups, 20 items · version 3')).toBeTruthy();
    await fill('Name', '2027 selection phase');
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 30);
    await press('Open round');
    expect(onlyRpcCall('admin_open_selection_round')).toEqual({
      p_team_id: 't1',
      p_name: '2027 selection phase',
      p_starts_on: '2026-10-19',
      p_ends_on: '2026-10-30',
      p_set_id: 's1',
      p_phase: 1,
      p_round_number: 1,
    });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('offers Choose another when more than one set fits', async () => {
    await openNew([choice(), choice({ set_id: 's2', name: 'Senior criteria', is_default: false })]);
    await press('17 & Under squad');
    await press('Choose another');
    expect(screen.getByText('Choose the criteria for this round')).toBeTruthy();
    await press('Senior criteria');
    expect(screen.getByText('✓ Senior criteria')).toBeTruthy();
    expect(screen.queryByText(/Chosen for you/)).toBeNull();
  });

  it('offers no Choose another when only one set fits', async () => {
    await openNew([choice({ is_default: false, for_label: 'Every squad and team' })]);
    await press('Open A');
    expect(screen.getByText('✓ Junior criteria')).toBeTruthy();
    expect(screen.getByText('Chosen for you: it is the only set for this group.')).toBeTruthy();
    expect(screen.queryByText('Choose another')).toBeNull();
  });

  it('asks for a choice when several fit and none is the default', async () => {
    await openNew([choice({ is_default: false }), choice({ set_id: 's2', name: 'Senior criteria', is_default: false })]);
    await press('17 & Under squad');
    await fill('Name', 'Trials');
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 19);
    await press('Open round');
    expect(screen.getByText('Choose the criteria for this round.')).toBeTruthy();
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
  });

  it('says when no set fits the group, and goes to Criteria sets', async () => {
    await openNew([]);
    await press('Open A');
    expect(screen.getByText('No criteria set is for Open A. Change who a set is for, or add one.')).toBeTruthy();
    await press('Criteria sets');
    expect(screen.getByText('screen:admin/assessments/index')).toBeTruthy();
  });

  it('shows the database’s refusal, such as dates that overlap another round', async () => {
    await openNew([choice()], {
      rpcErrors: {
        admin_open_selection_round:
          'These dates overlap “Trials” for Open A (2 Nov 2026 to 21 Dec 2026). The same athletes can’t be in two rounds at once.',
      },
    });
    await press('Open A');
    await fill('Name', 'Trials');
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 19);
    await press('Open round');
    expect(screen.getByText(/^These dates overlap “Trials” for Open A/)).toBeTruthy();
    expect(screen.queryByText('screen:index')).toBeNull();
  });

  it('preselects Phase 1, Round 1 for a group with no round, and sends it with no name needed', async () => {
    await openNew();
    await press('17 & Under squad');
    expect(screen.getByText('Shown as Phase 1, Round 1')).toBeTruthy();
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 30);
    await press('Open round');
    expect(onlyRpcCall('admin_open_selection_round')).toEqual({
      p_team_id: 't1',
      p_name: '',
      p_starts_on: '2026-10-19',
      p_ends_on: '2026-10-30',
      p_set_id: 's1',
      p_phase: 1,
      p_round_number: 1,
    });
  });

  it('preselects the next round number in the group’s highest phase, and More shows the rest', async () => {
    const earlier = { id: 'x', team_id: 't1', season: 2027, phase: 2, round_number: 6 };
    await openNew([choice()], { rpcs: { admin_selection_round_set_choices: [choice()], admin_selection_rounds: [earlier] } });
    await press('17 & Under squad');
    expect(screen.getByText('Shown as Phase 2, Round 7')).toBeTruthy();
    await fill('Name', 'Trials');
    expect(screen.getByText('Shown as Phase 2, Round 7 · Trials')).toBeTruthy();
    // The second "3" is the round's (the first is the phase's).
    await fireEvent.press(screen.getAllByText('3')[1]);
    await settle();
    expect(screen.getByText('Shown as Phase 2, Round 3 · Trials')).toBeTruthy();
  });

  it('warns about overlapping dates, holds Open round, and offers the first free day', async () => {
    const clash = {
      round_name: '2027 selection phase',
      team_name: '17 & Under squad',
      starts_on: '2026-10-01',
      last_day: '2026-10-21',
      criteria_set_name: 'Senior criteria',
      free_from: '2026-10-22',
    };
    await openNew([choice()], { rpcs: { admin_selection_round_set_choices: [choice()], admin_selection_round_clashes: [clash] } });
    await press('17 & Under squad');
    await pickDay(0, 2026, 10, 19);
    await pickDay(1, 2026, 10, 30);
    expect(rpcCalls('admin_selection_round_clashes').at(-1)).toEqual({
      p_team_id: 't1',
      p_starts_on: '2026-10-19',
      p_ends_on: '2026-10-30',
      p_round_id: null,
    });
    expect(screen.getByText('These dates overlap another round')).toBeTruthy();
    expect(screen.getByText('“2027 selection phase” runs 1 Oct to 21 Oct for 17 & Under squad, on Senior criteria.')).toBeTruthy();
    expect(screen.getByText('The same athletes can’t be in two rounds at once.')).toBeTruthy();
    await press('Open round');
    expect(rpcCalls('admin_open_selection_round')).toEqual([]);
    await press('Start on Thu 22 Oct instead');
    // Both dates move, eleven days apart as before, and are checked again.
    expect(rpcCalls('admin_selection_round_clashes').at(-1)).toEqual({
      p_team_id: 't1',
      p_starts_on: '2026-10-22',
      p_ends_on: '2026-11-02',
      p_round_id: null,
    });
  });
});

describe('a round’s criteria, on its Details tab', () => {
  async function openRound(round: AdminRound, options: BackendOptions = {}) {
    await openScreen(
      'admin',
      { 'admin/assessments/round': AdminRoundScreen },
      '/admin/assessments/round?id=r1',
      { teams: TEAMS },
      {
        rpcs: {
          admin_selection_rounds: [round],
          admin_selection_round_set_choices: [choice(), choice({ set_id: 's2', name: 'Senior criteria', version: 1 })],
        },
        ...options,
      },
    );
    await press('Details');
  }

  it('names the set and changes it at once before assessing starts', async () => {
    await openRound(adminRound());
    expect(screen.getByText('Criteria: Junior criteria, version 3')).toBeTruthy();
    expect(screen.getByText('You can change this until the first observation or summary is written.')).toBeTruthy();
    await press('Change the criteria');
    expect(screen.queryByText('Junior criteria, version 3')).toBeNull();
    await press('Senior criteria, version 1');
    expect(onlyRpcCall('admin_set_selection_round_criteria')).toEqual({ p_round_id: 'r1', p_set_id: 's2' });
  });

  it('keeps the criteria once assessing has started', async () => {
    await openRound(adminRound({ can_change_criteria: false, observations: 3 }));
    expect(screen.getByText('Assessing has started, so this round keeps its criteria.')).toBeTruthy();
    expect(screen.queryByText('Change the criteria')).toBeNull();
  });

  it('shows the database’s refusal', async () => {
    await openRound(adminRound(), {
      rpcErrors: { admin_set_selection_round_criteria: 'Assessing has started, so this round keeps its criteria' },
    });
    await press('Change the criteria');
    await press('Senior criteria, version 1');
    expect(screen.getByText('Assessing has started, so this round keeps its criteria')).toBeTruthy();
  });
});
