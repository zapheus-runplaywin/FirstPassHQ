/**
 * Administration > Safeguarding > Concern times and escalation
 * (src/app/admin/concern-times.tsx), as an admin uses it: the club's times,
 * and each lead post's escalation chain. The database refuses the same things
 * (supabase/tests/concern-clocks-and-escalation.sql); the screen checks first
 * so the admin sees why straight away.
 */
import { act, fireEvent, screen, within } from 'expo-router/testing-library';

import ConcernTimesScreen from '@/app/admin/concern-times';
import SafeguardingScreen from '@/app/admin/safeguarding';
import { DEFAULT_CONCERN_TIMES } from '@/lib/concern-times';
import { supabase } from '@/lib/supabase';

import { openScreen, resetClub, settle } from './helpers/harness';
import { isDisabled, pickPerson, type } from './helpers/settings-forms';

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

jest.setTimeout(30000);

const rpc = () => supabase.rpc as jest.Mock;
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][]).filter(([n]) => n === name).map(([, args]) => args);

beforeEach(() => {
  resetClub();
  rpc().mockClear();
});

const CHAINS = [
  {
    lead_post: 'complaints_manager',
    step_no: 1,
    target_post: 'child_safety_officer',
    target_person: null,
    target_name: 'Child Safety Officer',
    wait_days: 7,
    can_act: true,
  },
  {
    lead_post: 'complaints_manager',
    step_no: 2,
    target_post: null,
    target_person: 'gale',
    target_name: 'Gale Committee',
    wait_days: 3,
    can_act: false,
  },
];

const PEOPLE = [
  { id: 'gale', name: 'Gale Committee' },
  { id: 'casey', name: 'Casey Coach' },
];

async function openTimes(rpcs: Record<string, unknown> = {}, rpcErrors: Record<string, string> = {}) {
  await openScreen('admin', { 'admin/concern-times': ConcernTimesScreen }, '/admin/concern-times', {}, {
    rpcs: {
      club_concern_times: { ...DEFAULT_CONCERN_TIMES, concern_important_days: 5 },
      admin_escalation_chains: CHAINS,
      admin_escalation_people: PEOPLE,
      admin_set_concern_times: null,
      admin_set_escalation_chain: null,
      ...rpcs,
    },
    rpcErrors,
  });
}

async function press(text: string | RegExp) {
  await fireEvent.press(screen.getByText(text));
  await settle();
}

describe('the times', () => {
  it('shows the club’s times', async () => {
    await openTimes();
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    expect(screen.getByText('A new concern: first step within (hours)')).toBeTruthy();
    expect(screen.getByText('A clearance to sign off: Important after (days)')).toBeTruthy();
  });

  it('saves every time, as numbers', async () => {
    await openTimes();
    await type('A new concern: first step within (hours)', '12');
    await press('Save times');
    expect(callsTo('admin_set_concern_times')).toEqual([
      {
        p_first_action_hours: 12,
        p_refer_hours: 48,
        p_important_days: 5,
        p_urgent_days: 14,
        p_escalate_days: 7,
        p_request_important_hours: 24,
        p_request_urgent_hours: 48,
        p_clearance_important_days: 3,
        p_clearance_urgent_days: 7,
      },
    ]);
    expect(screen.getByText('Times saved.')).toBeTruthy();
  });

  it('says why before saving when Urgent doesn’t come after Important', async () => {
    await openTimes();
    await type('An open concern with no step: Important after (days)', '20');
    await press('Save times');
    expect(screen.getByText('Urgent must come after Important')).toBeTruthy();
    expect(callsTo('admin_set_concern_times')).toEqual([]);
  });

  it('shows the database’s refusal', async () => {
    await openTimes({}, { admin_set_concern_times: 'Only admins can change these times' });
    await press('Save times');
    expect(screen.getByText('Only admins can change these times')).toBeTruthy();
    expect(screen.queryByText('Times saved.')).toBeNull();
  });
});

describe('the escalation chains', () => {
  it('shows the Complaints Manager’s chain in order, ending at Admins', async () => {
    await openTimes();
    await press('Complaints Manager chain');
    expect(
      screen.getByText(
        'A concern the Complaints Manager leads, once Urgent: Child Safety Officer after 7 days, then Gale Committee after 3 days, then Admins after 7 days.',
      ),
    ).toBeTruthy();
    expect(within(screen.getByTestId('chain-step-1')).getByText('Step 1 · after 7 days')).toBeTruthy();
    expect(within(screen.getByTestId('chain-step-2')).getByText(/Gale Committee · can’t act/)).toBeTruthy();
    // Nothing changed yet.
    expect(isDisabled('Save chain')).toBe(true);
  });

  it('never offers a chain’s own post, or one already in it', async () => {
    await openTimes();
    await press('Complaints Manager chain');
    const add = within(screen.getByText('Add step 3').parent!);
    expect(add.queryByText('Complaints Manager')).toBeNull();
    expect(add.queryByText('Child Safety Officer')).toBeNull();
    expect(add.getByText('Admins')).toBeTruthy();
    expect(add.getByText('A person')).toBeTruthy();
  });

  it('adds a person and saves the chain', async () => {
    await openTimes();
    await press('Complaints Manager chain');
    await press('A person');
    // Gale is in the chain already, so only Casey is offered.
    await type('Search members', 'Gale');
    expect(screen.queryByText('+ Gale Committee')).toBeNull();
    await pickPerson('Who', 'Casey', 'Casey Coach');
    await type('Wait (days, 1 to 30)', '2');
    await press('Add step');
    await press('Save chain');
    expect(callsTo('admin_set_escalation_chain')).toEqual([
      {
        p_lead_post: 'complaints_manager',
        p_steps: [
          { post: 'child_safety_officer', wait_days: 7 },
          { person: 'gale', wait_days: 3 },
          { person: 'casey', wait_days: 2 },
        ],
      },
    ]);
    expect(screen.getByText('Chain saved.')).toBeTruthy();
  });

  it('takes a step off', async () => {
    await openTimes();
    await press('Complaints Manager chain');
    await fireEvent.press(within(screen.getByTestId('chain-step-1')).getByText('Take off'));
    await press('Save chain');
    expect(callsTo('admin_set_escalation_chain')).toEqual([
      { p_lead_post: 'complaints_manager', p_steps: [{ person: 'gale', wait_days: 3 }] },
    ]);
  });

  it('lets the Child Safety Officer’s chain name the Complaints Manager as backup', async () => {
    await openTimes();
    await press('Child Safety Officer chain');
    expect(screen.getByText('A concern the Child Safety Officer leads, once Urgent: Admins after 7 days.')).toBeTruthy();
    await press('Complaints Manager');
    await press('Add step');
    await press('Save chain');
    expect(callsTo('admin_set_escalation_chain')).toEqual([
      { p_lead_post: 'child_safety_officer', p_steps: [{ post: 'complaints_manager', wait_days: 7 }] },
    ]);
  });

  it('offers nothing after Admins', async () => {
    await openTimes();
    await press('Child Safety Officer chain');
    await press('Admins');
    await press('Add step');
    expect(screen.queryByText(/^Add step 2/)).toBeNull();
  });

  it('won’t add a step with a wait outside 1 to 30 days', async () => {
    await openTimes();
    await press('Child Safety Officer chain');
    await press('Admins');
    await type('Wait (days, 1 to 30)', '45');
    expect(isDisabled('Add step')).toBe(true);
  });

  it('shows the database’s refusal and reloads the saved chain', async () => {
    await openTimes({}, {
      admin_set_escalation_chain: 'They already hold the post this chain starts from, so it would come back to them',
    });
    await press('Complaints Manager chain');
    await fireEvent.press(within(screen.getByTestId('chain-step-2')).getByText('Take off'));
    await press('Save chain');
    expect(
      screen.getByText('They already hold the post this chain starts from, so it would come back to them'),
    ).toBeTruthy();
    expect(screen.getByTestId('chain-step-2')).toBeTruthy();
  });
});

describe('getting there', () => {
  it('opens from Administration > Safeguarding', async () => {
    await openScreen('admin', { 'admin/safeguarding': SafeguardingScreen, 'admin/concern-times': ConcernTimesScreen }, '/admin/safeguarding', {}, {
      rpcs: { admin_safeguarding_posts: [], admin_volunteer_exemptions: [] },
    });
    await act(() => fireEvent.press(screen.getByText('Concern times and escalation')));
    await settle();
    expect(screen).toHavePathname('/admin/concern-times');
  });
});
