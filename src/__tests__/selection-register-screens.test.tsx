/**
 * Selection rounds, part 4 (reporting and governance): the Selection register
 * screen, its button on the admin's Rounds tab, and the audit report loading
 * the round record. What the report says is tested in
 * src/lib/__tests__/selection-register.test.ts; who may build it, in
 * supabase/tests/selection-register.sql.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AdminAssessmentsScreen from '@/app/admin/assessments/index';
import AdminAuditScreen from '@/app/admin/assessments/audit';
import RegisterScreen from '@/app/admin/assessments/register';
import type { SelectionRegister } from '@/lib/assessments';

import { clearCalls, rpcCalls, rpcNames } from './helpers/calls';
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

function register(extra: Partial<SelectionRegister> = {}): SelectionRegister {
  return {
    season: 2027,
    today: '2026-10-18',
    seasons: [2027],
    groups: [
      { id: 't1', name: '17 & Under squad', kind: 'squad', squad_id: null, athletes: 2 },
      { id: 't2', name: 'Open A', kind: 'team', squad_id: null, athletes: 3 },
    ],
    rounds: [
      {
        id: 'r1', team_id: 't1', team_name: '17 & Under squad', name: 'Trials', phase: 1, round_number: 1,
        starts_on: '2026-10-05', ends_on: '2026-11-29', last_day: '2026-11-29', closed_at: null,
        opened_at: '2026-10-04T01:00:00Z', opened_by_name: 'Sample admin', criteria_set_id: 'c1',
        criteria_set_name: 'Junior criteria', criteria_set_version: 2, set_fits: true,
        panel: [{ name: 'Casey Coach', independent: false }, { name: 'Indy Out', independent: true }],
        declared_conflicts: 0, auditors: [], athletes: 2, observations: 5, athletes_observed: 2,
        summaries_signed: 1, summaries_expected: 4, feedback_shared: 0, released: null, clashes: [],
      },
    ],
    sets: [],
    set_events: [],
    round_events: [],
    ...extra,
  };
}

async function openRegister(options: BackendOptions = {}) {
  await openScreen('admin', { 'admin/assessments/register': RegisterScreen }, '/admin/assessments/register', {}, {
    rpcs: { admin_selection_register: register() },
    ...options,
  });
}

describe('the Selection register', () => {
  it('asks for the newest season and shows the report, with things to check open', async () => {
    await openRegister();
    expect(rpcCalls('admin_selection_register')[0]).toEqual({ p_season: null });
    expect(screen.getAllByText(/Things to check/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Jordan|Kai/)).toBeNull();
  });

  it('shows season chips only with more than one season, and asks for the one chosen', async () => {
    await openRegister();
    expect(screen.queryByText('2026–27')).toBeNull();
    await openRegister({ rpcs: { admin_selection_register: register({ seasons: [2027, 2026] }) } });
    clearCalls();
    await fireEvent.press(screen.getByText('2026–27'));
    await settle(6);
    expect(rpcCalls('admin_selection_register').at(-1)).toEqual({ p_season: 2026 });
  });

  it('shows the database’s refusal', async () => {
    await openRegister({ rpcErrors: { admin_selection_register: 'Only admins can see the selection register' } });
    expect(screen.getByText('Only admins can see the selection register')).toBeTruthy();
  });
});

describe('reaching the register and the round record', () => {
  it('puts Season register on the Rounds tab and opens it', async () => {
    await openScreen(
      'admin',
      { 'admin/assessments/index': AdminAssessmentsScreen, 'admin/assessments/register': placeholder('register') },
      '/admin/assessments',
      {},
      {
        rpcs: {
          admin_criteria_sets: [],
          admin_selection_rounds: [
            {
              id: 'r1', team_id: 't1', team_name: '17 & Under squad', season: 2027, name: 'Trials', phase: 1, round_number: 1,
              starts_on: '2026-10-05', ends_on: '2026-11-29', closed_at: null, created_at: '2026-10-04T01:00:00Z',
              athletes: 2, observations: 5, panel: [], auditors: 1,
            },
          ],
        },
      },
    );
    await fireEvent.press(screen.getByText('Season register'));
    await settle(6);
    expect(screen.getByText('screen:register')).toBeTruthy();
  });

  it('has the audit report load the round record too', async () => {
    await openScreen('admin', { 'admin/assessments/audit': AdminAuditScreen }, '/admin/assessments/audit?id=r1', {}, {
      rpcs: { admin_selection_audit: null, admin_selection_round_record: null },
    });
    expect(rpcNames()).toContain('admin_selection_round_record');
    expect(rpcCalls('admin_selection_round_record')[0]).toEqual({ p_round_id: 'r1' });
  });
});
