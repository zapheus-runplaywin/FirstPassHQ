/**
 * The policy and conflict-of-interest registers (customer review R9): the
 * menu (src/app/registers/index.tsx), the policy list, adding or changing a
 * policy, recording a review, the conflict register, an admin changing an
 * entry, and a member declaring (src/app/declare-conflicts.tsx).
 *
 * Who reads and changes them is the database's call (supabase/tests/
 * registers.sql): the committee and admins read both, only admins change
 * them, a policy's owner records its review, and committee members and
 * coaches declare. The screens keep to that: only admins see Add and Change,
 * and Record a review shows on the policies a member owns (every policy for
 * an admin). The route guards are in route-guards-roles.test.tsx.
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import DeclareConflictsScreen from '@/app/declare-conflicts';
import EditConflictScreen from '@/app/registers/conflict';
import ConflictsScreen from '@/app/registers/conflicts';
import RegistersScreen from '@/app/registers/index';
import PoliciesScreen from '@/app/registers/policies';
import EditPolicyScreen from '@/app/registers/policy';
import ReviewPolicyScreen from '@/app/registers/review';
import { formatDateString } from '@/lib/injuries';
import type { ConflictRow, MyConflictDeclaration, RegisterPolicy } from '@/lib/registers';
import type { Profile } from '@/lib/types';

import { clearCalls, fieldLabelled, onlyRpcCall, pushTo, rpcCalls, rpcNames } from './helpers/calls';
import {
  openScreen,
  personas,
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

type Who = PersonaName | Persona;

jest.setTimeout(20000);

beforeEach(() => {
  resetClub();
  setClubFeatures({ registers: true });
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

/** The day's square in a month calendar, such as 30 October 2026. */
const pickDay = async (year: number, month: number, day: number) => {
  await fireEvent.press(screen.getByLabelText(new Date(year, month - 1, day).toDateString()));
  await settle(2);
};

function policy(extra: Partial<RegisterPolicy> = {}): RegisterPolicy {
  return {
    id: 'p1',
    title: 'Child Safeguarding Policy',
    owner_id: 'committee',
    owner_name: 'Sample committee',
    version: '2.1',
    link: 'https://club.example/safeguarding.pdf',
    review_on: '2027-03-01',
    notes: null,
    last_reviewed_at: null,
    last_reviewed_by_name: null,
    updated_at: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

function conflict(extra: Partial<ConflictRow> = {}): ConflictRow {
  return {
    profile_id: 'coach',
    name: 'Sample coach',
    roles: ['coach'],
    declared: true,
    has_conflict: false,
    details: null,
    declared_at: '2026-10-05T00:00:00Z',
    changed_by_name: null,
    ...extra,
  };
}

const POLICIES = [
  policy({ id: 'p-over', title: 'Privacy Policy', review_on: '2026-10-01', owner_id: 'coach', owner_name: 'Sample coach' }),
  policy({ id: 'p-due', title: 'Code of Conduct', review_on: '2026-11-10', link: null }),
  policy(),
];

const CONFLICTS = [
  conflict({ profile_id: 'c1', name: 'Casey Coach', has_conflict: true, details: 'My daughter plays in 17 and under A' }),
  conflict({ profile_id: 'c2', name: 'Dana Committee', roles: ['committee'] }),
  conflict({ profile_id: 'c3', name: 'Eli Coach', declared: false, has_conflict: null, declared_at: null }),
];

// ---------------------------------------------------------------------------
// The menu

async function openMenu(who: Who, options: BackendOptions['rpcs'] = {}) {
  await openScreen(
    who,
    {
      'registers/index': RegistersScreen,
      'registers/policies': placeholder('registers/policies'),
      'registers/conflicts': placeholder('registers/conflicts'),
    },
    '/registers',
    {},
    { rpcs: { conduct_season: 2026, policy_register_list: POLICIES, conflict_register: CONFLICTS, ...options } },
  );
}

describe('the registers menu', () => {
  it('counts policies overdue and due within 30 days, and who has declared this season', async () => {
    await openMenu('committee');
    expect(screen.getByText('3 policies · 1 overdue for review · 1 due within 30 days')).toBeTruthy();
    expect(screen.getByText('1 declared this season · 1 still to declare')).toBeTruthy();
    expect(rpcCalls('conflict_register')).toEqual([{ p_season: 2026 }]);
  });

  it('tells the committee they read the registers and admins that they change them', async () => {
    await openMenu('committee');
    expect(screen.getByText(/You can read them; admins make the changes/)).toBeTruthy();
    await openMenu('admin');
    expect(screen.getByText(/You add and change them; the committee reads them/)).toBeTruthy();
  });

  it('says when there are no policies yet and everyone has declared', async () => {
    await openMenu('admin', { policy_register_list: [], conflict_register: [conflict()] });
    expect(screen.getByText('No policies yet')).toBeTruthy();
    expect(screen.getByText('0 declared this season · everyone has declared')).toBeTruthy();
  });

  it('opens the policy register', async () => {
    await openMenu('committee');
    await press('Policies');
    expect(screen.getByText('screen:registers/policies')).toBeTruthy();
  });

  it('opens the conflict register', async () => {
    await openMenu('committee');
    await press('Conflicts of interest');
    expect(screen.getByText('screen:registers/conflicts')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The policy list

async function openPolicies(who: Who, policies: RegisterPolicy[] = POLICIES) {
  await openScreen(
    who,
    {
      'registers/policies': PoliciesScreen,
      'registers/policy': placeholder('registers/policy'),
      'registers/review': placeholder('registers/review'),
    },
    '/registers/policies',
    {},
    { rpcs: { policy_register_list: policies } },
  );
}

describe('the policy list', () => {
  it('shows each policy’s review state, owner and version, soonest first', async () => {
    await openPolicies('committee');
    expect(screen.getByText(`Overdue for review: ${formatDateString('2026-10-01')}`)).toBeTruthy();
    expect(screen.getByText(`Review due within 30 days: ${formatDateString('2026-11-10')}`)).toBeTruthy();
    expect(screen.getByText(`Next review: ${formatDateString('2027-03-01')}`)).toBeTruthy();
    expect(screen.getByText('Owner: Sample coach')).toBeTruthy();
    expect(screen.getAllByText('Child Safeguarding Policy · version 2.1')).toHaveLength(1);
  });

  it('says who last reviewed it, its notes, and when nobody owns it', async () => {
    await openPolicies('committee', [
      policy({
        owner_id: null,
        owner_name: null,
        notes: 'Approved by the board',
        last_reviewed_at: '2026-03-01T03:00:00Z',
        last_reviewed_by_name: 'Sample admin',
      }),
    ]);
    expect(screen.getByText('Owner: nobody yet')).toBeTruthy();
    expect(screen.getByText(`Last reviewed ${formatDateString('2026-03-01')} by Sample admin`)).toBeTruthy();
    expect(screen.getByText('Approved by the board')).toBeTruthy();
  });

  it('gives an admin Add, Change and Record a review on every policy', async () => {
    await openPolicies('admin');
    expect(screen.getByText('Add a policy')).toBeTruthy();
    expect(screen.getAllByText('Change')).toHaveLength(3);
    expect(screen.getAllByText('Record a review')).toHaveLength(3);
    await press('Add a policy');
    expect(screen.getByText('screen:registers/policy')).toBeTruthy();
  });

  it('lets an admin change a policy', async () => {
    await openPolicies('admin');
    await press('Change', 2);
    expect(screen.getByText('screen:registers/policy')).toBeTruthy();
  });

  it('gives the committee Record a review only on the policies they own, and never Add or Change', async () => {
    await openPolicies('committee');
    expect(screen.queryByText('Add a policy')).toBeNull();
    expect(screen.queryByText('Change')).toBeNull();
    expect(screen.getAllByText('Record a review')).toHaveLength(2);
    await press('Record a review');
    expect(screen.getByText('screen:registers/review')).toBeTruthy();
  });

  it('gives a coach who owns a policy Record a review on it', async () => {
    await openPolicies('coach', [POLICIES[0]]);
    expect(screen.getAllByText('Record a review')).toHaveLength(1);
  });

  it('offers to open the policy only when it has a link', async () => {
    await openPolicies('committee');
    expect(screen.getAllByText('Open')).toHaveLength(2);
  });

  it('says how to start when the register is empty', async () => {
    await openPolicies('admin', []);
    expect(screen.getByText(/No policies yet. Add the club’s policies/)).toBeTruthy();
    await openPolicies('committee', []);
    expect(screen.getByText('No policies yet. Admins add them.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Adding or changing a policy

const PEOPLE: Profile[] = [
  personas.committee.profile!,
  personas.coach.profile!,
  { ...personas.athlete.profile!, full_name: 'Sample athlete' },
  { ...personas.coach.profile!, id: 'minor-coach', full_name: 'Young Coach', date_of_birth: '2010-01-01' },
  { ...personas.committee.profile!, id: 'gone', full_name: 'Gone Committee', stood_down_at: '2026-10-01T00:00:00Z' },
];

async function openEdit(url = '/registers/policy', options: BackendOptions = {}) {
  await openScreen(
    'admin',
    { 'registers/policy': EditPolicyScreen, 'registers/policies': placeholder('registers/policies') },
    '/registers/policies',
    {},
    {
      rpcs: { policy_register_list: POLICIES },
      tableHandlers: { profiles: (q) => (q.eq('status') === 'approved' ? PEOPLE : undefined) },
      ...options,
    },
  );
  await pushTo(url);
  clearCalls();
}

describe('adding a policy', () => {
  it('asks for a name and review date first', async () => {
    await openEdit();
    await press('Add policy');
    expect(screen.getByText('Add a name and a review date.')).toBeTruthy();
    expect(rpcNames()).not.toContain('admin_save_policy');
  });

  it('refuses a link that isn’t a web address', async () => {
    await openEdit();
    await fill('Policy', 'Privacy Policy');
    await pickDay(2026, 10, 30);
    await fireEvent.changeText(screen.getByPlaceholderText('https:// on the club website or shared drive'), 'club drive');
    await press('Add policy');
    expect(screen.getByText('The link must start with https://')).toBeTruthy();
    expect(rpcNames()).not.toContain('admin_save_policy');
  });

  it('offers only approved adult club officials as owner', async () => {
    await openEdit();
    await fireEvent.changeText(screen.getByPlaceholderText('Name or email'), 'Sample');
    await settle(2);
    expect(screen.getByText('Sample committee')).toBeTruthy();
    expect(screen.getByText('Sample coach')).toBeTruthy();
    expect(screen.queryByText('Sample athlete')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('Name or email'), 'o');
    await settle(2);
    expect(screen.queryByText('Young Coach')).toBeNull();
    expect(screen.queryByText('Gone Committee')).toBeNull();
  });

  it('saves the policy with its owner and goes back', async () => {
    await openEdit();
    await fill('Policy', 'Privacy Policy');
    await fireEvent.changeText(screen.getByPlaceholderText('Name or email'), 'coach');
    await settle(2);
    await press('Sample coach');
    await fill('Version (optional)', '1.0');
    await fireEvent.changeText(screen.getByPlaceholderText('https:// on the club website or shared drive'), 'https://club.example/privacy');
    await pickDay(2026, 10, 30);
    await fill('Notes (optional)', 'From the state association template');
    await press('Add policy');
    expect(onlyRpcCall('admin_save_policy')).toEqual({
      p_id: null,
      p_title: 'Privacy Policy',
      p_owner_id: 'coach',
      p_version: '1.0',
      p_link: 'https://club.example/privacy',
      p_review_on: '2026-10-30',
      p_notes: 'From the state association template',
    });
    expect(screen.getByText('screen:registers/policies')).toBeTruthy();
  });

  it('shows the database’s refusal and stays put', async () => {
    await openEdit('/registers/policy', { rpcErrors: { admin_save_policy: 'Choose a review date within 5 years' } });
    await fill('Policy', 'Privacy Policy');
    await pickDay(2026, 10, 30);
    await press('Add policy');
    expect(screen.getByText('Choose a review date within 5 years')).toBeTruthy();
  });
});

describe('changing a policy', () => {
  it('loads the policy and saves changes to it', async () => {
    await openEdit('/registers/policy?id=p1');
    expect(screen.getByDisplayValue('Child Safeguarding Policy')).toBeTruthy();
    expect(screen.getByDisplayValue('2.1')).toBeTruthy();
    expect(screen.getByText('Sample committee  ✕')).toBeTruthy();
    await fill('Version (optional)', '2.2');
    await press('Save');
    expect(onlyRpcCall('admin_save_policy')).toMatchObject({
      p_id: 'p1',
      p_title: 'Child Safeguarding Policy',
      p_owner_id: 'committee',
      p_version: '2.2',
      p_review_on: '2027-03-01',
    });
  });

  it('removes a policy after asking once more', async () => {
    await openEdit('/registers/policy?id=p1');
    await press('Remove');
    expect(rpcNames()).not.toContain('admin_delete_policy');
    await press('Remove policy');
    expect(onlyRpcCall('admin_delete_policy')).toEqual({ p_id: 'p1' });
    expect(screen.getByText('screen:registers/policies')).toBeTruthy();
  });

  it('has no Remove while adding', async () => {
    await openEdit();
    expect(screen.queryByText('Remove')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recording a review

async function openReview(who: Who, options: BackendOptions = {}, id = 'p1') {
  await openScreen(
    who,
    { 'registers/review': ReviewPolicyScreen, 'registers/policies': placeholder('registers/policies') },
    '/registers/policies',
    {},
    { rpcs: { policy_register_list: POLICIES }, ...options },
  );
  await pushTo(`/registers/review?id=${id}`);
  clearCalls();
}

describe('recording a review', () => {
  it('suggests the next review a year from today and keeps the version and link', async () => {
    await openReview('committee');
    expect(screen.getByText('Child Safeguarding Policy')).toBeTruthy();
    expect(screen.getByText(formatDateString('2027-10-18'))).toBeTruthy();
    await press('Record review');
    expect(onlyRpcCall('review_policy')).toEqual({
      p_id: 'p1',
      p_version: '2.1',
      p_link: 'https://club.example/safeguarding.pdf',
      p_next_review_on: '2027-10-18',
    });
    expect(screen.getByText('screen:registers/policies')).toBeTruthy();
  });

  it('records a new version and a chosen review date', async () => {
    await openReview('committee');
    await fill('Version (optional)', '3.0');
    await pickDay(2027, 10, 1);
    await press('Record review');
    expect(onlyRpcCall('review_policy')).toMatchObject({ p_version: '3.0', p_next_review_on: '2027-10-01' });
  });

  it('refuses a bad link before asking the database', async () => {
    await openReview('committee');
    await fireEvent.changeText(screen.getByDisplayValue('https://club.example/safeguarding.pdf'), 'www.club.example');
    await settle(2);
    await press('Record review');
    expect(screen.getByText('The link must start with https://')).toBeTruthy();
    expect(rpcNames()).not.toContain('review_policy');
  });

  it('shows the database’s refusal', async () => {
    await openReview('coach', { rpcErrors: { review_policy: 'Only the policy’s owner or an admin can record a review' } });
    await press('Record review');
    expect(screen.getByText('Only the policy’s owner or an admin can record a review')).toBeTruthy();
  });

  it('says when the policy has gone', async () => {
    await openReview('committee', {}, 'gone');
    expect(screen.getByText('This policy isn’t on the register any more.')).toBeTruthy();
    expect(screen.queryByText('Record review')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The conflict register

async function openConflicts(who: Who, options: BackendOptions = {}) {
  await openScreen(
    who,
    { 'registers/conflicts': ConflictsScreen, 'registers/conflict': placeholder('registers/conflict') },
    '/registers/conflicts',
    {},
    { rpcs: { conflict_register_seasons: [2026], conflict_register: CONFLICTS }, ...options },
  );
}

describe('the conflict register', () => {
  it('groups this season’s entries: conflicts, none, and still to declare', async () => {
    await openConflicts('committee');
    expect(screen.getByText('Declared a conflict (1)')).toBeTruthy();
    expect(screen.getByText('My daughter plays in 17 and under A')).toBeTruthy();
    expect(screen.getByText('Declared none (1)')).toBeTruthy();
    expect(screen.getByText('Dana Committee')).toBeTruthy();
    expect(screen.getByText('Still to declare (1)')).toBeTruthy();
    expect(screen.getByText('Eli Coach')).toBeTruthy();
    expect(screen.getAllByText(`Declared ${formatDateString('2026-10-05')}`)).toHaveLength(2);
    expect(rpcCalls('conflict_register')).toEqual([{ p_season: 2026 }]);
  });

  it('shows when an admin changed an entry', async () => {
    await openConflicts('committee', {
      rpcs: { conflict_register_seasons: [2026], conflict_register: [conflict({ changed_by_name: 'Sample admin' })] },
    });
    expect(screen.getByText(`Declared ${formatDateString('2026-10-05')} · changed by Sample admin`)).toBeTruthy();
  });

  it('gives the committee no way to change an entry', async () => {
    await openConflicts('committee');
    expect(screen.queryByText(/Tap someone to change their entry/)).toBeNull();
    await press('Eli Coach');
    expect(screen.queryByText('screen:registers/conflict')).toBeNull();
  });

  it('lets an admin open an entry', async () => {
    await openConflicts('admin');
    expect(screen.getByText(/Tap someone to change their entry/)).toBeTruthy();
    await press('Eli Coach');
    expect(screen.getByText('screen:registers/conflict')).toBeTruthy();
  });

  it('shows past seasons, without a still-to-declare list', async () => {
    await openConflicts('committee', {
      rpcHandlers: {
        conflict_register: (args) => (args.p_season === 2025 ? [conflict({ name: 'Old Coach' })] : CONFLICTS),
      },
      rpcs: { conflict_register_seasons: [2026, 2025] },
    });
    await press('2025–26');
    expect(rpcCalls('conflict_register')).toContainEqual({ p_season: 2025 });
    expect(screen.getByText('Old Coach')).toBeTruthy();
    expect(screen.queryByText(/Still to declare/)).toBeNull();
  });

  it('says when a list is empty', async () => {
    await openConflicts('committee', { rpcs: { conflict_register_seasons: [2026], conflict_register: [] } });
    expect(screen.getByText('Nobody declared a conflict.')).toBeTruthy();
    expect(screen.getByText('Everyone has declared this season.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Declaring, and an admin changing an entry

async function openDeclare(declaration: Partial<MyConflictDeclaration> = {}, options: BackendOptions = {}) {
  await openScreen(
    'coach',
    { 'declare-conflicts': DeclareConflictsScreen, index: placeholder('index') },
    '/',
    {},
    {
      rpcs: {
        my_conflict_declaration: [
          { required: true, season: 2026, has_conflict: null, details: null, declared_at: null, ...declaration },
        ],
      },
      ...options,
    },
  );
  await pushTo('/declare-conflicts');
  clearCalls();
}

describe('declaring conflicts of interest', () => {
  it('asks for an answer first', async () => {
    await openDeclare();
    expect(screen.getByText('2026–27 season')).toBeTruthy();
    await press('Declare');
    expect(screen.getByText('Say whether you have a conflict of interest.')).toBeTruthy();
    expect(rpcNames()).not.toContain('declare_conflicts');
  });

  it('declares none and goes back', async () => {
    await openDeclare();
    await press('No conflicts of interest');
    await press('Declare');
    expect(onlyRpcCall('declare_conflicts')).toEqual({ p_has_conflict: false, p_details: '' });
    expect(screen.getByText('screen:index')).toBeTruthy();
  });

  it('asks what the conflict is, then declares it', async () => {
    await openDeclare();
    await press('A conflict to declare');
    await press('Declare');
    expect(screen.getByText('Describe the conflict of interest.')).toBeTruthy();
    await fill('The conflict', 'My son plays in Open A');
    await press('Declare');
    expect(onlyRpcCall('declare_conflicts')).toEqual({ p_has_conflict: true, p_details: 'My son plays in Open A' });
  });

  it('drops the details when they change to none', async () => {
    await openDeclare({ has_conflict: true, details: 'My son plays in Open A', declared_at: '2026-10-05T00:00:00Z' });
    expect(screen.getByText(`2026–27 season · declared ${formatDateString('2026-10-05')}`)).toBeTruthy();
    expect(screen.getByDisplayValue('My son plays in Open A')).toBeTruthy();
    await press('No conflicts of interest');
    await press('Save changes');
    expect(onlyRpcCall('declare_conflicts')).toEqual({ p_has_conflict: false, p_details: '' });
  });

  it('shows the database’s refusal', async () => {
    await openDeclare({}, { rpcErrors: { declare_conflicts: 'Only committee members and coaches declare conflicts of interest' } });
    await press('No conflicts of interest');
    await press('Declare');
    expect(screen.getByText('Only committee members and coaches declare conflicts of interest')).toBeTruthy();
  });
});

async function openAdminEdit(rows: ConflictRow[] = CONFLICTS, options: BackendOptions = {}) {
  await openScreen(
    'admin',
    { 'registers/conflict': EditConflictScreen, 'registers/conflicts': placeholder('registers/conflicts') },
    '/registers/conflicts',
    {},
    { rpcs: { conflict_register: rows }, ...options },
  );
  await pushTo('/registers/conflict?profile=c1&season=2026&name=Casey%20Coach');
  clearCalls();
}

describe('an admin changing an entry', () => {
  it('loads the entry and saves the change for that member and season', async () => {
    await openAdminEdit();
    expect(screen.getByText('Casey Coach')).toBeTruthy();
    expect(screen.getByDisplayValue('My daughter plays in 17 and under A')).toBeTruthy();
    await fill('The conflict', 'My daughter plays in 17 and under A; I step out of its selection');
    await press('Save');
    expect(onlyRpcCall('admin_set_conflict_declaration')).toEqual({
      p_profile_id: 'c1',
      p_season: 2026,
      p_has_conflict: true,
      p_details: 'My daughter plays in 17 and under A; I step out of its selection',
    });
    expect(screen.getByText('screen:registers/conflicts')).toBeTruthy();
  });

  it('records a declaration given on paper for someone still to declare', async () => {
    await openAdminEdit([conflict({ profile_id: 'c1', name: 'Casey Coach', declared: false, has_conflict: null, declared_at: null })]);
    await press('Save');
    expect(screen.getByText('Say whether you have a conflict of interest.')).toBeTruthy();
    await press('No conflicts of interest');
    await press('Save');
    expect(onlyRpcCall('admin_set_conflict_declaration')).toMatchObject({ p_has_conflict: false, p_details: '' });
  });

  it('shows the database’s refusal', async () => {
    await openAdminEdit(CONFLICTS, { rpcErrors: { admin_set_conflict_declaration: 'Member not found' } });
    await press('Save');
    expect(screen.getByText('Member not found')).toBeTruthy();
  });
});
