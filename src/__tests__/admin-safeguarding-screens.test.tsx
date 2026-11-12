/**
 * Administration > Safeguarding (src/app/admin/safeguarding.tsx), Code of
 * conduct (admin/conduct.tsx) and the Administration screen's members tile
 * and refresh (administration.tsx), as an admin uses them.
 *
 * The rules (section 10 of the user guide, "Safeguarding contacts"): the
 * Child Safety Officer and Complaints Manager are approved adults, not stood
 * down, with a current check or an exemption that applies; the WWC
 * Registration Officer is such an admin or committee member. The committee
 * checks date can be brought forward but never pushed back. Each setting goes
 * to its own database function, in order, stopping at the first refusal.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen, within } from 'expo-router/testing-library';

import AdministrationScreen from '@/app/administration';
import ConductStatusScreen from '@/app/admin/conduct';
import SafeguardingScreen from '@/app/admin/safeguarding';
import { formatDateString } from '@/lib/injuries';
import type { ConductStatus } from '@/lib/conduct';
import { supabase } from '@/lib/supabase';
import type { Profile, VolunteerExemption } from '@/lib/types';

import { openScreen, personas, pressWithoutWaiting, refreshControl, resetClub, settle } from './helpers/harness';
import { fieldGroup, flip, input, isDisabled, isOn, isSelected, pickPerson, type } from './helpers/settings-forms';

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

// Each test settles a whole screen several times; leave room on a busy machine.
jest.setTimeout(30000);

const rpc = () => supabase.rpc as jest.Mock;
const rpcNames = () => (rpc().mock.calls as [string][]).map(([n]) => n);
const callsTo = (name: string) =>
  (rpc().mock.calls as [string, Record<string, unknown>][])
    .filter(([n]) => n === name)
    .map(([, args]) => args);

beforeEach(() => {
  resetClub();
  rpc().mockClear();
});

// ---------------------------------------------------------------------------
// Safeguarding

const p = (name: keyof typeof personas) => personas[name].profile!;
const person = (id: string, extra: Partial<Profile>): Profile => ({ ...p('guest'), id, email: `${id}@example.test`, ...extra });

/** Everyone approved, as the database returns them. */
const ADMIN = p('admin');
const COMMITTEE = p('committee');
const COACH = p('coach');
const EXPIRING = person('expiring', { full_name: 'Sample expiring', role: 'committee', wwcc_number: '9', wwcc_expires_on: '2026-11-01' });
const EXEMPT = person('exempt', { full_name: 'Sample exempt', role: 'manager' });
const PEOPLE: Profile[] = [
  ADMIN,
  COMMITTEE,
  COACH,
  EXPIRING,
  EXEMPT,
  // Not eligible: no check, under 18, stood down, expired, ended or invalid exemption.
  p('athlete'),
  { ...p('minorAthlete'), wwcc_number: '5', wwcc_expires_on: '2029-01-01' },
  p('stoodDownCoach'),
  p('coachExpiredCheck'),
  person('ended', { full_name: 'Sample ended exemption', role: 'committee' }),
  person('invalid', { full_name: 'Sample invalid exemption', role: 'manager' }),
];

function exemption(profile_id: string, extra: Partial<VolunteerExemption> = {}): VolunteerExemption {
  return {
    id: `ex-${profile_id}`,
    profile_id,
    basis: 'parent_volunteer',
    child_id: null,
    child_name: null,
    set_by_name: 'Sample admin',
    set_at: '2026-09-01T00:00:00Z',
    declared_at: null,
    declaration_text: null,
    ended_at: null,
    ended_by_name: null,
    end_note: null,
    valid: true,
    ends_on: null,
    starts_on: null,
    ...extra,
  } as VolunteerExemption;
}

const EXEMPTIONS = [
  exemption('exempt'),
  exemption('ended', { ended_at: '2026-10-01T00:00:00Z' }),
  exemption('invalid', { valid: false }),
];

const SAVED_CONTACTS = {
  child_safety_officer_id: 'committee',
  child_safety_officer_name: 'Sample committee',
  complaints_manager_id: 'admin',
  complaints_manager_name: 'Sample admin',
  governing_body_name: 'Netball WA',
  governing_body_phone: '08 9000 0000',
  governing_body_url: 'https://netballwa.example/complaints',
  policy_url: 'https://club.example/safeguarding',
};

const SAVED_POLICIES = {
  privacy_policy_url: 'https://club.example/privacy',
  safeguarding_policy_url: null,
  code_of_conduct_url: 'https://club.example/conduct',
  policy_version: '2026-1',
};

function Placeholder() {
  return null;
}

/** Opens Safeguarding from Administration, so saving can go back to it. */
async function openSafeguarding(
  rpcs: Record<string, unknown> = {},
  rpcErrors: Record<string, string> = {},
  people: Profile[] = PEOPLE,
) {
  await openScreen(
    'admin',
    { administration: Placeholder, 'admin/safeguarding': SafeguardingScreen },
    '/administration',
    {},
    {
      tableHandlers: { profiles: (q) => (q.eq('status') === 'approved' ? people : undefined) },
      rpcs: {
        safeguarding_contacts: SAVED_CONTACTS,
        admin_volunteer_exemptions: EXEMPTIONS,
        safeguarding_photo_setting: false,
        club_policies: SAVED_POLICIES,
        admin_wwc_officer: { officer_id: 'admin', officer_name: 'Sample admin' },
        conduct_each_season_setting: true,
        committee_checks_from: null,
        injury_rules: { physio_only_endorsement: false, concussion_min_days: 21 },
        ...rpcs,
      },
      rpcErrors,
    },
  );
  await act(() => router.push('/admin/safeguarding'));
  await settle();
  expect(screen).toHavePathname('/admin/safeguarding');
}

async function saveSafeguarding() {
  await fireEvent.press(screen.getByText('Save'));
  await settle();
}

/** The names a picker offers when searched for "Sample". */
async function offered(picker: string) {
  await type(picker, 'Sample');
  const group = fieldGroup(picker);
  return within(group)
    .getAllByRole('button')
    .map((b) => within(b).queryByText(/^Sample/)?.props.children as string | undefined)
    .filter((t): t is string => !!t && !t.endsWith('✕'))
    .sort();
}

describe('Safeguarding settings', () => {
  it('starts from the saved contacts, governing body, policies and switches', async () => {
    await openSafeguarding({ safeguarding_photo_setting: true });
    expect(within(fieldGroup('Child Safety Officer')).getByText('Sample committee  ✕')).toBeTruthy();
    expect(within(fieldGroup('Complaints Manager')).getByText('Sample admin  ✕')).toBeTruthy();
    expect(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕')).toBeTruthy();
    expect(input('Name').props.value).toBe('Netball WA');
    expect(input('Phone or hotline').props.value).toBe('08 9000 0000');
    expect(input('Complaints form link').props.value).toBe('https://netballwa.example/complaints');
    expect(input('Child safeguarding policy (link)').props.value).toBe('https://club.example/safeguarding');
    expect(input('Privacy policy (link)').props.value).toBe('https://club.example/privacy');
    expect(input('Code of conduct (link)').props.value).toBe('https://club.example/conduct');
    expect(input('Policy version').props.value).toBe('2026-1');
    expect(isOn('Ask every member to accept the code of conduct once a season')).toBe(true);
    expect(isOn('Allow photos of under 18s’ injuries')).toBe(true);
  });

  it('starts empty, with policy version 1 and both switches off, for a club that has set nothing', async () => {
    await openSafeguarding({
      safeguarding_contacts: null,
      club_policies: null,
      admin_wwc_officer: null,
      conduct_each_season_setting: null,
      safeguarding_photo_setting: null,
    });
    expect(screen.getAllByText('Nobody chosen.')).toHaveLength(3);
    expect(input('Name').props.value).toBe('');
    expect(input('Policy version').props.value).toBe('1');
    expect(isOn('Ask every member to accept the code of conduct once a season')).toBe(false);
    expect(isOn('Allow photos of under 18s’ injuries')).toBe(false);
  });

  it('offers as contacts only approved adults, not stood down, with a current check or an exemption in force', async () => {
    await openSafeguarding({ safeguarding_contacts: null });
    expect(await offered('Child Safety Officer')).toEqual(
      ['Sample admin', 'Sample coach', 'Sample committee', 'Sample exempt', 'Sample expiring'].sort(),
    );
  });

  it('counts a lodged check application in force as a check, but not one that lapsed', async () => {
    const application = (profile_id: string, status: string) => ({
      id: `a-${profile_id}`,
      profile_id,
      status,
      ended_at: null,
    });
    await openSafeguarding({
      safeguarding_contacts: null,
      admin_volunteer_exemptions: [],
      admin_wwcc_applications: [
        application('ended', 'in_force'),
        application('invalid', 'lapsed'),
        { ...application('athlete', 'in_force'), ended_at: '2026-10-01T00:00:00Z' },
      ],
    });
    expect(await offered('Child Safety Officer')).toEqual(
      ['Sample admin', 'Sample coach', 'Sample committee', 'Sample ended exemption', 'Sample expiring'].sort(),
    );
  });

  it('offers as WWC Registration Officer only eligible admins and committee members', async () => {
    await openSafeguarding({ admin_wwc_officer: null });
    expect(await offered('WWC Registration Officer')).toEqual(['Sample admin', 'Sample committee', 'Sample expiring']);
  });

  it('saves every setting in order, then goes back', async () => {
    await openSafeguarding();
    // Swap the contacts round and change the rest.
    await fireEvent.press(screen.getByText('Sample committee  ✕'));
    await pickPerson('Child Safety Officer', 'coach', 'Sample coach');
    await type('Name', 'Netball Australia');
    await type('Phone or hotline', '1800 000 000');
    await type('Complaints form link', 'https://netball.example/report');
    await type('Child safeguarding policy (link)', 'https://club.example/child-safe');
    await type('Privacy policy (link)', 'https://club.example/privacy-2');
    await type('Code of conduct (link)', 'https://club.example/conduct-2');
    await type('Policy version', '2026-2');
    await flip('Ask every member to accept the code of conduct once a season', false);
    await flip('Allow photos of under 18s’ injuries', true);
    await flip('Only physios endorse clearances', true);
    await fireEvent.press(screen.getByText('12 days (elite program)'));
    await saveSafeguarding();

    expect(callsTo('admin_set_safeguarding')).toEqual([
      {
        p_child_safety_officer_id: 'coach',
        p_complaints_manager_id: 'admin',
        p_governing_body_name: 'Netball Australia',
        p_governing_body_phone: '1800 000 000',
        p_governing_body_url: 'https://netball.example/report',
        p_policy_url: 'https://club.example/child-safe',
      },
    ]);
    expect(callsTo('admin_set_minor_injury_photos')).toEqual([{ p_allowed: true }]);
    expect(callsTo('admin_set_policies')).toEqual([
      {
        p_privacy_policy_url: 'https://club.example/privacy-2',
        p_code_of_conduct_url: 'https://club.example/conduct-2',
        p_policy_version: '2026-2',
      },
    ]);
    expect(callsTo('admin_set_conduct_each_season')).toEqual([{ p_on: false }]);
    expect(callsTo('admin_set_injury_rules')).toEqual([
      { p_physio_only_endorsement: true, p_concussion_min_days: 12 },
    ]);
    const saves = rpcNames().filter((n) => n.startsWith('admin_set_'));
    expect(saves).toEqual([
      'admin_set_safeguarding',
      'admin_set_minor_injury_photos',
      'admin_set_policies',
      'admin_set_conduct_each_season',
      'admin_set_injury_rules',
    ]);
    expect(screen).toHavePathname('/administration');
  });

  it('starts from the saved injury clearance rules', async () => {
    await openSafeguarding({ injury_rules: { physio_only_endorsement: true, concussion_min_days: 12 } });
    expect(isOn('Only physios endorse clearances')).toBe(true);
    expect(isSelected('12 days (elite program)')).toBe(true);
  });

  it('defaults to coaches or physios endorsing and 21 days after a concussion', async () => {
    await openSafeguarding({ injury_rules: null });
    expect(isOn('Only physios endorse clearances')).toBe(false);
    expect(isSelected('21 days')).toBe(true);
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_rules')).toEqual([
      { p_physio_only_endorsement: false, p_concussion_min_days: 21 },
    ]);
  });

  it('stops at a refused injury rule, before the WWC Registration Officer', async () => {
    await openSafeguarding({}, { admin_set_injury_rules: 'Choose 21 days, or 12 for an elite program' });
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await pickPerson('WWC Registration Officer', 'committee', 'Sample committee');
    await saveSafeguarding();
    expect(screen.getByText('Choose 21 days, or 12 for an elite program')).toBeTruthy();
    expect(callsTo('admin_set_wwc_officer')).toEqual([]);
    expect(screen).toHavePathname('/admin/safeguarding');
  });

  it('can leave a contact unnamed', async () => {
    await openSafeguarding();
    await fireEvent.press(screen.getByText('Sample committee  ✕'));
    expect(within(fieldGroup('Child Safety Officer')).getByText('Nobody chosen.')).toBeTruthy();
    await saveSafeguarding();
    expect(callsTo('admin_set_safeguarding')[0].p_child_safety_officer_id).toBeNull();
  });

  it('saves the WWC Registration Officer only when it changes', async () => {
    await openSafeguarding();
    await saveSafeguarding();
    expect(callsTo('admin_set_wwc_officer')).toEqual([]);
  });

  it('saves a new WWC Registration Officer last', async () => {
    await openSafeguarding();
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await pickPerson('WWC Registration Officer', 'committee', 'Sample committee');
    await saveSafeguarding();
    expect(callsTo('admin_set_wwc_officer')).toEqual([{ p_profile_id: 'committee' }]);
    expect(rpcNames().filter((n) => n.startsWith('admin_set_')).at(-1)).toBe('admin_set_wwc_officer');
  });

  it('keeps Save busy until the last call has finished, so a second tap can’t send them twice', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' });
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await pickPerson('WWC Registration Officer', 'committee', 'Sample committee');
    await fireEvent.press(screen.getByText('Today'));
    // Hold the last two calls until the test lets them answer.
    const rpc = supabase.rpc as jest.Mock;
    const answer = rpc.getMockImplementation()!;
    const held: (() => void)[] = [];
    rpc.mockImplementation((name: string, args: unknown) =>
      name === 'admin_set_wwc_officer' || name === 'admin_set_committee_checks_from'
        ? new Promise((resolve) => held.push(() => resolve(answer(name, args))))
        : answer(name, args),
    );
    const saving = await pressWithoutWaiting(screen.getByText('Save'));
    await settle();
    expect(callsTo('admin_set_wwc_officer')).toHaveLength(1);
    expect(screen.queryByText('Save')).toBeNull();
    await act(async () => held.shift()!());
    await settle();
    expect(callsTo('admin_set_committee_checks_from')).toHaveLength(1);
    expect(screen.queryByText('Save')).toBeNull();
    await act(async () => {
      held.shift()!();
      await saving.done;
    });
    await settle();
    expect(callsTo('admin_set_wwc_officer')).toHaveLength(1);
    expect(callsTo('admin_set_committee_checks_from')).toHaveLength(1);
    expect(screen).toHavePathname('/administration');
  });

  it('has no committee checks date until one is set', async () => {
    await openSafeguarding();
    expect(screen.queryByText('Committee checks required from')).toBeNull();
    await saveSafeguarding();
    expect(callsTo('admin_set_committee_checks_from')).toEqual([]);
  });

  it('brings the committee checks date forward to today', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' });
    expect(screen.getByText('Committee checks required from')).toBeTruthy();
    expect(screen.getByText(formatDateString('2026-12-01'))).toBeTruthy();
    await fireEvent.press(screen.getByText('Today'));
    await saveSafeguarding();
    expect(callsTo('admin_set_committee_checks_from')).toEqual([{ p_date: '2026-10-18' }]);
  });

  it('never lets the committee checks date move past the saved one', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' });
    expect(isDisabled('›')).toBe(true);
    await fireEvent.press(screen.getByLabelText('Day before'));
    expect(screen.getByText(formatDateString('2026-11-30'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Day after'));
    expect(isDisabled('›')).toBe(true);
    await saveSafeguarding();
    // Back on the saved day, so nothing to change.
    expect(callsTo('admin_set_committee_checks_from')).toEqual([]);
  });

  it('saves an earlier committee checks date', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' });
    await fireEvent.press(screen.getByLabelText('Day before'));
    await saveSafeguarding();
    expect(callsTo('admin_set_committee_checks_from')).toEqual([{ p_date: '2026-11-30' }]);
  });

  it.each([
    ['admin_set_safeguarding', 'Choose two different people, so a concern about one of them can go to the other', []],
    ['admin_set_minor_injury_photos', 'Photos refused', ['admin_set_safeguarding']],
    ['admin_set_policies', 'Links must start with https://', ['admin_set_safeguarding', 'admin_set_minor_injury_photos']],
    [
      'admin_set_conduct_each_season',
      'Conduct refused',
      ['admin_set_safeguarding', 'admin_set_minor_injury_photos', 'admin_set_policies'],
    ],
  ])('stops at a refused %s, shows why and stays on the screen', async (name, message, before) => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' }, { [name]: message });
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await fireEvent.press(screen.getByText('Today'));
    await saveSafeguarding();
    expect(screen.getByText(message)).toBeTruthy();
    expect(rpcNames().filter((n) => n.startsWith('admin_set_'))).toEqual([...before, name]);
    expect(screen).toHavePathname('/admin/safeguarding');
  });

  it('stops at a refused WWC Registration Officer before the committee checks date', async () => {
    await openSafeguarding(
      { committee_checks_from: '2026-12-01' },
      { admin_set_wwc_officer: 'The WWC Registration Officer must be an admin or committee member' },
    );
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await fireEvent.press(screen.getByText('Today'));
    await saveSafeguarding();
    expect(screen.getByText('The WWC Registration Officer must be an admin or committee member')).toBeTruthy();
    expect(callsTo('admin_set_committee_checks_from')).toEqual([]);
    expect(screen).toHavePathname('/admin/safeguarding');
  });

  it('shows a refused committee checks date', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' }, { admin_set_committee_checks_from: 'Not later' });
    await fireEvent.press(screen.getByText('Today'));
    await saveSafeguarding();
    expect(screen.getByText('Not later')).toBeTruthy();
    expect(screen).toHavePathname('/admin/safeguarding');
  });

  it('has no statistician checks date until one is set', async () => {
    await openSafeguarding();
    expect(screen.queryByText('Statistician checks required from')).toBeNull();
    await saveSafeguarding();
    expect(callsTo('admin_set_statistician_checks_from')).toEqual([]);
  });

  it('brings the statistician checks date forward to today, and explains it', async () => {
    await openSafeguarding({ statistician_checks_from: '2027-01-21' });
    expect(screen.getByText('Statistician checks required from')).toBeTruthy();
    expect(screen.getByText(formatDateString('2027-01-21'))).toBeTruthy();
    expect(screen.getByText(/their statistician role paused, in HQ and in Vantage/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Today'));
    await saveSafeguarding();
    expect(callsTo('admin_set_statistician_checks_from')).toEqual([{ p_date: '2026-10-18' }]);
    expect(callsTo('admin_set_committee_checks_from')).toEqual([]);
  });

  it('never lets the statistician checks date move past the saved one', async () => {
    await openSafeguarding({ statistician_checks_from: '2027-01-21' });
    expect(isDisabled('›')).toBe(true);
    await saveSafeguarding();
    expect(callsTo('admin_set_statistician_checks_from')).toEqual([]);
  });

  it('saves both dates, the committee one first', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01', statistician_checks_from: '2027-01-21' });
    const todays = screen.getAllByText('Today');
    expect(todays).toHaveLength(2);
    await fireEvent.press(todays[0]);
    await fireEvent.press(todays[1]);
    await saveSafeguarding();
    expect(rpcNames().filter((n) => n.endsWith('_checks_from') && n.startsWith('admin_set_'))).toEqual([
      'admin_set_committee_checks_from',
      'admin_set_statistician_checks_from',
    ]);
    expect(callsTo('admin_set_statistician_checks_from')).toEqual([{ p_date: '2026-10-18' }]);
  });

  it('doesn’t save the statistician date when the committee date is refused', async () => {
    await openSafeguarding(
      { committee_checks_from: '2026-12-01', statistician_checks_from: '2027-01-21' },
      { admin_set_committee_checks_from: 'Not later' },
    );
    const todays = screen.getAllByText('Today');
    await fireEvent.press(todays[0]);
    await fireEvent.press(todays[1]);
    await saveSafeguarding();
    expect(screen.getByText('Not later')).toBeTruthy();
    expect(callsTo('admin_set_statistician_checks_from')).toEqual([]);
  });

  it('shows a refused statistician checks date', async () => {
    await openSafeguarding(
      { statistician_checks_from: '2027-01-21' },
      { admin_set_statistician_checks_from: 'The date can only be brought forward' },
    );
    await fireEvent.press(screen.getByText('Today'));
    await saveSafeguarding();
    expect(screen.getByText('The date can only be brought forward')).toBeTruthy();
    expect(screen).toHavePathname('/admin/safeguarding');
  });

  it('tells admins when one without a check stops seeing under 18s’ injuries', async () => {
    await openSafeguarding({ committee_checks_from: '2026-12-01' });
    expect(screen.getByText(/stops seeing under 18s’ injuries 30 days after this day/)).toBeTruthy();
  });

  it('keeps the field limits', async () => {
    await openSafeguarding();
    expect(input('Name').props.maxLength).toBe(100);
    expect(input('Phone or hotline').props.maxLength).toBe(30);
    expect(input('Complaints form link').props.maxLength).toBe(500);
    expect(input('Policy version').props.maxLength).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Who on the committee sees injuries (customer review R7)

describe('Injuries are seen by', () => {
  const sees = (name: string) => `${name} sees injuries`;

  it('starts as the whole committee, with nobody to choose, and saves nothing unchanged', async () => {
    await openSafeguarding({ admin_injury_committee: null });
    expect(isSelected('Whole committee')).toBe(true);
    expect(screen.queryByLabelText(sees('Sample committee'))).toBeNull();
    expect(screen.queryByText(/With nobody chosen/)).toBeNull();
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([]);
    expect(screen).toHavePathname('/administration');
  });

  it('explains the choice, and that admins aren’t affected', async () => {
    await openSafeguarding();
    expect(screen.getByText(/Committee members left out don’t see injuries or sign off returns to play/)).toBeTruthy();
    expect(screen.getByText(/Admins see injuries as admins, whatever you choose here/)).toBeTruthy();
  });

  it('lists only committee members who aren’t admins, with their titles', async () => {
    await openSafeguarding({}, {}, [
      ...PEOPLE,
      person('treasurer', { full_name: 'Sample treasurer', preferred_name: 'Sam', role: 'coach', extra_roles: ['committee'], title: 'Treasurer' }),
      person('admin-committee', { full_name: 'Sample admin committee', role: 'admin', extra_roles: ['committee'] }),
    ]);
    await fireEvent.press(screen.getByText('Chosen committee members'));
    expect(screen.getByLabelText(sees('Sample committee'))).toBeTruthy();
    expect(screen.getByLabelText(sees('Sample expiring'))).toBeTruthy();
    expect(screen.getByLabelText(sees('Sam'))).toBeTruthy();
    expect(screen.getByText('Sam, Treasurer')).toBeTruthy();
    expect(screen.queryByLabelText(sees('Sample admin committee'))).toBeNull();
    expect(screen.queryByLabelText(sees('Sample admin'))).toBeNull();
    expect(screen.queryByLabelText(sees('Sample coach'))).toBeNull();
  });

  it('warns while nobody is chosen, and saves the members ticked after the injury rules', async () => {
    await openSafeguarding();
    await fireEvent.press(screen.getByText('Chosen committee members'));
    expect(screen.getByText(/With nobody chosen, no committee member sees injuries and only admins accept/)).toBeTruthy();
    await flip(sees('Sample committee'), true);
    await flip(sees('Sample expiring'), true);
    await flip(sees('Sample expiring'), false);
    expect(screen.queryByText(/With nobody chosen/)).toBeNull();
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await pickPerson('WWC Registration Officer', 'committee', 'Sample committee');
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([{ p_chosen: true, p_member_ids: ['committee'] }]);
    const saves = rpcNames().filter((n) => n.startsWith('admin_set_'));
    expect(saves.indexOf('admin_set_injury_committee')).toBe(saves.indexOf('admin_set_injury_rules') + 1);
    expect(saves.at(-1)).toBe('admin_set_wwc_officer');
    expect(screen).toHavePathname('/administration');
  });

  it('can save chosen members with nobody ticked', async () => {
    await openSafeguarding();
    await fireEvent.press(screen.getByText('Chosen committee members'));
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([{ p_chosen: true, p_member_ids: [] }]);
  });

  it('starts from the saved choice', async () => {
    await openSafeguarding({ admin_injury_committee: { chosen: true, member_ids: ['expiring'] } });
    expect(isSelected('Chosen committee members')).toBe(true);
    expect(isOn(sees('Sample expiring'))).toBe(true);
    expect(isOn(sees('Sample committee'))).toBe(false);
    expect(screen.queryByText(/With nobody chosen/)).toBeNull();
  });

  it('warns when the only one chosen has left the committee', async () => {
    await openSafeguarding({ admin_injury_committee: { chosen: true, member_ids: ['coach'] } });
    expect(screen.getByText(/With nobody chosen/)).toBeTruthy();
  });

  it('saves nothing when the same members end up ticked', async () => {
    await openSafeguarding({ admin_injury_committee: { chosen: true, member_ids: ['committee', 'expiring'] } });
    await flip(sees('Sample committee'), false);
    await flip(sees('Sample committee'), true);
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([]);
  });

  it('saves a different set of the same size', async () => {
    await openSafeguarding({ admin_injury_committee: { chosen: true, member_ids: ['committee'] } });
    await flip(sees('Sample committee'), false);
    await flip(sees('Sample expiring'), true);
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([{ p_chosen: true, p_member_ids: ['expiring'] }]);
  });

  it('keeps the list when switching back to the whole committee', async () => {
    await openSafeguarding({ admin_injury_committee: { chosen: true, member_ids: ['committee'] } });
    await fireEvent.press(screen.getByText('Whole committee'));
    expect(screen.queryByLabelText(sees('Sample committee'))).toBeNull();
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([{ p_chosen: false, p_member_ids: ['committee'] }]);
  });

  it('stops at a refusal, before the WWC Registration Officer', async () => {
    await openSafeguarding({}, { admin_set_injury_committee: 'Only approved committee members can be chosen to see injuries' });
    await fireEvent.press(screen.getByText('Chosen committee members'));
    await fireEvent.press(within(fieldGroup('WWC Registration Officer')).getByText('Sample admin  ✕'));
    await pickPerson('WWC Registration Officer', 'committee', 'Sample committee');
    await saveSafeguarding();
    expect(screen.getByText('Only approved committee members can be chosen to see injuries')).toBeTruthy();
    expect(callsTo('admin_set_wwc_officer')).toEqual([]);
    expect(screen).toHavePathname('/admin/safeguarding');
  });

  it('isn’t saved when an injury rule is refused', async () => {
    await openSafeguarding({}, { admin_set_injury_rules: 'Choose 21 days, or 12 for an elite program' });
    await fireEvent.press(screen.getByText('Chosen committee members'));
    await saveSafeguarding();
    expect(callsTo('admin_set_injury_committee')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Code of conduct

function conductRow(extra: Partial<ConductStatus>): ConductStatus {
  return {
    profile_id: 'x',
    full_name: 'Sample member',
    role: 'athlete',
    under_18: false,
    accepted_at: null,
    accepted_by_name: null,
    waiting_for_guardian: false,
    ...extra,
  };
}

const ROWS: ConductStatus[] = [
  conductRow({ profile_id: 'c1', full_name: 'Adult Coach', role: 'coach', accepted_at: '2026-10-02T02:00:00Z', accepted_by_name: 'Adult Coach' }),
  conductRow({ profile_id: 'c2', full_name: 'Young Athlete', under_18: true, accepted_at: '2026-10-03T02:00:00Z', accepted_by_name: 'Sample Guardian' }),
  conductRow({ profile_id: 'c3', full_name: 'Waiting Child', under_18: true, waiting_for_guardian: true }),
  conductRow({ profile_id: 'c4', full_name: 'Other Child', under_18: true }),
  conductRow({ profile_id: 'c5', full_name: null, role: 'manager' }),
  conductRow({ profile_id: 'c6', full_name: 'Odd Role', role: 'umpire' }),
];

async function openConduct(rows: ConductStatus[] | null, on: boolean) {
  await openScreen('admin', { 'admin/conduct': ConductStatusScreen, 'conduct/[id]': Placeholder }, '/admin/conduct', {}, {
    rpcs: { admin_conduct_status: rows, conduct_each_season_setting: on },
  });
}

describe('Code of conduct', () => {
  it('lists who still has to accept and who has, with the date and a child’s parent', async () => {
    await openConduct(ROWS, true);
    expect(screen.getByText('Still to accept (4)')).toBeTruthy();
    expect(screen.getByText('Accepted (2)')).toBeTruthy();
    expect(screen.getByText(`Coach · ${formatDateString('2026-10-02')}`)).toBeTruthy();
    expect(screen.getByText(`Athlete · ${formatDateString('2026-10-03')} by Sample Guardian`)).toBeTruthy();
    expect(screen.getByText('Athlete · under 18, waiting for a parent or guardian to be verified')).toBeTruthy();
    expect(screen.getByText('Athlete · under 18, a parent or guardian accepts')).toBeTruthy();
    expect(screen.getByText('Unnamed member')).toBeTruthy();
    expect(screen.getByText('Manager')).toBeTruthy();
    expect(screen.getByText('umpire')).toBeTruthy();
    expect(screen.getByText(/^Every member accepts the code of conduct once a season/)).toBeTruthy();
  });

  it('names who accepted only for an under 18', async () => {
    await openConduct(ROWS, true);
    expect(screen.queryByText(/ by Adult Coach$/)).toBeNull();
  });

  it('says members aren’t asked while the switch is off', async () => {
    await openConduct([], false);
    expect(screen.getByText(/^Members aren’t asked to accept the code of conduct\./)).toBeTruthy();
    expect(screen.queryByText(/^Still to accept/)).toBeNull();
    expect(screen.queryByText(/^Accepted/)).toBeNull();
  });

  it('says nobody is asked yet when the switch is on but nobody is listed', async () => {
    await openConduct(null, true);
    expect(screen.getByText(/^Nobody is asked yet\./)).toBeTruthy();
  });

  it('leaves out a heading with nobody under it', async () => {
    await openConduct([ROWS[0]], true);
    expect(screen.queryByText(/^Still to accept/)).toBeNull();
    expect(screen.getByText('Accepted (1)')).toBeTruthy();
  });

  it('opens a member’s acceptances', async () => {
    await openConduct(ROWS, true);
    await fireEvent.press(screen.getByText('Waiting Child'));
    await settle();
    expect(screen).toHavePathname('/conduct/c3');
  });
});

// ---------------------------------------------------------------------------
// Administration: the members tile and refreshing

async function openAdministration(pending: number) {
  const rows = Array.from({ length: pending }, (_, i) => ({ id: `p${i}` }));
  await openScreen('admin', { administration: AdministrationScreen }, '/administration', {}, {
    tableHandlers: {
      profiles: (q) =>
        q.eq('status') === 'pending' &&
        q.calls.some((c) => c.method === 'not' && c.args[0] === 'join_requested_at')
          ? rows
          : undefined,
    },
  });
}

describe('Administration', () => {
  it.each([
    [0, 'No requests waiting'],
    [1, '1 request waiting for approval'],
    [3, '3 requests waiting for approval'],
  ])('shows %i join requests on the Members tile', async (count, label) => {
    await openAdministration(count);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('counts join requests again when pulled to refresh', async () => {
    await openAdministration(0);
    const from = supabase.from as jest.Mock;
    const before = from.mock.calls.filter(([t]) => t === 'profiles').length;
    await act(async () => {
      refreshControl().props.onRefresh();
    });
    await settle();
    expect(from.mock.calls.filter(([t]) => t === 'profiles').length).toBe(before + 1);
    expect(refreshControl().props.refreshing).toBe(false);
  });
});
