/**
 * A child's page (src/app/child/[id].tsx), opened from the child's card in
 * the Family tab: "Your children" in section 5 of docs/user-guide.md.
 *
 * The page lists a child only when the database says the child is the
 * caller's own (my_child_consents answers for the caller only). So the tests
 * seed what it would return for each kind of member and check that a parent
 * sees their own child, and that nobody sees a child who isn't theirs: not
 * another parent, not an admin, not a coach, and not by typing an id.
 * src/__tests__/route-guards-roles.test.tsx covers who reaches the route.
 */
import { router } from 'expo-router';
import { act, fireEvent, screen } from 'expo-router/testing-library';

import ChildScreen from '@/app/child/[id]';

import { clearCalls, rpcNames } from './helpers/forms';
import {
  CHILD_CONSENTS,
  openScreen,
  personas,
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

let push: jest.SpyInstance;
let replace: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
});
afterEach(() => {
  push.mockRestore();
  replace.mockRestore();
});

const CHILD = { ...CHILD_CONSENTS[0], data: true, health: true };
const SIBLING = { ...CHILD, athlete_id: 'child-2', full_name: 'Second Child', health: false };

/** Every row a verified parent has, top to bottom. */
const ROWS = [
  'Attendance',
  'Game goals',
  'Check-ins',
  'Injuries',
  'Consent',
  'Medical and emergency',
  'What’s changed',
  'Who has viewed their records',
];

const NOT_THEIRS = 'This child isn’t linked to you';

async function open(who: PersonaName | Persona, id = 'child-1', options: BackendOptions = {}) {
  await openScreen(who, { 'child/[id]': ChildScreen }, `/child/${id}?name=Typed%20Name`, {}, options);
}

const shownRows = () => ROWS.filter((row) => screen.queryByText(row) !== null);

describe('a parent on their child’s page', () => {
  it('has everything for the child, in one order', async () => {
    await open('guardian', 'child-1', { rpcs: { my_child_consents: [CHILD] } });
    expect(shownRows()).toEqual(ROWS);
    expect(screen.queryByText(NOT_THEIRS)).toBeNull();
    expect(screen.getByText('Check-ins: yes · Injuries: yes')).toBeTruthy();
  });

  it.each([
    ['Attendance', { pathname: '/attendance/family/[id]', params: { id: 'child-1', name: 'Sample Child' } }],
    [
      'Game goals',
      { pathname: '/goals/athlete/[id]', params: { id: 'child-1', name: 'Sample Child', view: 'guardian' } },
    ],
    ['Check-ins', { pathname: '/check-ins/athlete/[id]', params: { id: 'child-1', name: 'Sample Child' } }],
    ['Injuries', '/injuries'],
    ['Consent', { pathname: '/consent/[id]', params: { id: 'child-1' } }],
    ['Medical and emergency', { pathname: '/medical/[id]', params: { id: 'child-1' } }],
    ['What’s changed', { pathname: '/activity/[id]', params: { id: 'child-1', name: 'Sample Child' } }],
    [
      'Who has viewed their records',
      { pathname: '/records/[id]', params: { id: 'child-1', name: 'Sample Child' } },
    ],
  ])('opens %s for that child', async (row, href) => {
    await open('guardian', 'child-1', { rpcs: { my_child_consents: [CHILD] } });
    await fireEvent.press(screen.getByText(row));
    expect(push).toHaveBeenCalledWith(href);
  });

  it('with two children, shows only the one whose page it is', async () => {
    await open('guardian', 'child-2', {
      rpcs: {
        my_child_consents: [CHILD, SIBLING],
        child_activity_new: [
          { athlete_id: 'child-1', new_count: 5 },
          { athlete_id: 'child-2', new_count: 2 },
        ],
        visible_injuries: [
          { id: 'i1', athlete_id: 'child-1', waiting_for_me: true },
          { id: 'i2', athlete_id: 'child-1', waiting_for_me: false },
        ],
      },
    });
    // Second Child's consent, their two changes, and none of the sibling's injuries.
    expect(screen.getByText('Check-ins: yes · Injuries: not given')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.getByText('No current injuries')).toBeTruthy();
    await fireEvent.press(screen.getByText('Consent'));
    expect(push).toHaveBeenCalledWith({ pathname: '/consent/[id]', params: { id: 'child-2' } });
  });

  it('sees the child’s current injuries and medical details that need them', async () => {
    await open('guardian', 'child-1', {
      rpcs: {
        my_child_consents: [CHILD],
        visible_injuries: [{ id: 'i1', athlete_id: 'child-1', waiting_for_me: true }],
        my_medical_reviews: [
          { athlete_id: 'child-1', athlete_name: 'Sample Child', status: 'missing', due_on: null },
        ],
      },
    });
    expect(screen.getByText('1 current injury · 1 waiting for you')).toBeTruthy();
    expect(screen.getByText('Medical details to add')).toBeTruthy();
  });

  it('who isn’t verified yet has no medical details or record views, and isn’t asked the database for them', async () => {
    await open(
      { ...personas.guardian, profile: { ...personas.guardian.profile!, verified_at: null } },
      'child-1',
      { rpcs: { my_child_consents: [{ ...CHILD, can_consent: false, data: false, health: false }] } },
    );
    expect(shownRows()).toEqual(['Attendance', 'Game goals', 'Check-ins', 'Injuries', 'Consent', 'What’s changed']);
    expect(screen.getByText('Waiting for an admin to verify you')).toBeTruthy();
    expect(rpcNames()).not.toContain('my_medical_reviews');
  });

  it.each([
    ['attendance', 'Attendance'],
    ['goals', 'Game goals'],
    ['checkIns', 'Check-ins'],
    ['injuries', 'Injuries'],
  ])('has no %s row while the club has it switched off', async (feature, row) => {
    setClubFeatures({ [feature]: false });
    await open('guardian', 'child-1', { rpcs: { my_child_consents: [CHILD] } });
    expect(shownRows()).toEqual(ROWS.filter((r) => r !== row));
  });

  it('reloads on pull to refresh', async () => {
    let consents = [CHILD];
    await open('guardian', 'child-1', { rpcHandlers: { my_child_consents: () => consents } });
    expect(screen.getByText('Check-ins: yes · Injuries: yes')).toBeTruthy();
    consents = [{ ...CHILD, health: false }];
    await act(async () => {
      refreshControl().props.onRefresh();
    });
    await settle();
    expect(screen.getByText('Check-ins: yes · Injuries: not given')).toBeTruthy();
  });
});

describe('a child who isn’t theirs', () => {
  it('a parent who types another child’s id sees nothing of that child', async () => {
    await open('guardian', 'someone-elses-child', { rpcs: { my_child_consents: [CHILD] } });
    expect(screen.getByText(NOT_THEIRS)).toBeTruthy();
    expect(shownRows()).toEqual([]);
    // Not even the name the link carried.
    expect(screen.queryByText('Typed Name')).toBeNull();
    await fireEvent.press(screen.getByText('Your children'));
    expect(replace).toHaveBeenCalledWith('/children');
  });

  it('a parent with no child linked yet sees nothing', async () => {
    await open('guardian', 'child-1', { rpcs: { my_child_consents: [] } });
    expect(screen.getByText(NOT_THEIRS)).toBeTruthy();
    expect(shownRows()).toEqual([]);
  });

  // Everyone who isn't a parent or guardian: the page asks the database for
  // nothing and shows nothing, whatever id is in the link. (Only parents and
  // admins reach the route at all; an admin who isn't a parent has no child.)
  it.each<PersonaName>([
    'admin',
    'committee',
    'coach',
    'manager',
    'physio',
    'athlete',
    'minorAthlete',
    'guest',
    'statistician',
    'safeguardingOfficer',
    'pending',
  ])('%s sees no child, and the database isn’t asked', async (who) => {
    await open(who, 'child-1', { rpcs: { my_child_consents: [CHILD] } });
    expect(screen.getByText(NOT_THEIRS)).toBeTruthy();
    expect(shownRows()).toEqual([]);
    expect(rpcNames()).not.toContain('my_child_consents');
    expect(rpcNames()).not.toContain('my_medical_reviews');
  });

  it.each<PersonaName>(['coachGuardian', 'adminGuardian'])(
    '%s, who is also a parent, sees their own child',
    async (who) => {
      await open(who, 'child-1', { rpcs: { my_child_consents: [CHILD] } });
      expect(screen.queryByText(NOT_THEIRS)).toBeNull();
      expect(shownRows()).toContain('Consent');
    },
  );
});
