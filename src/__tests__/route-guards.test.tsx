/**
 * Who can open which screen, through the real root layout's
 * `<Stack.Protected>` guards (src/app/_layout.tsx): signed-out members, the
 * admin screens, and the screens only signed-out members get.
 *
 * Every route file in src/app is mounted from disk, so a new screen is
 * covered as soon as it's added; each screen is swapped for a placeholder
 * that names its route, so no screen's own data loading runs. The real
 * AuthProvider works out each member's usable roles (and `isAdmin`) from the
 * fake backend, so paused and stood-down roles are the app's own rules.
 *
 * Each test deep-links straight to a URL, as a notification, a shared link
 * or a typed web address would, and checks where the member ends up.
 * Feature switches are in route-guards-features.test.tsx.
 */
import {
  ADMIN_ROUTES,
  expectReaches,
  expectTurnedAway,
  MEMBER_ROUTES,
  PUBLIC,
  resetClub,
  ROUTES,
  setClubChosen,
  setClubFeatures,
  type PersonaName,
} from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  useAdminPushNotifications: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@/lib/log', () => ({ ...jest.requireActual('@/lib/log'), startAppLog: jest.fn() }));
jest.mock('@/components/brand-intro', () => ({ BrandIntro: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

beforeEach(() => resetClub());

// ---------------------------------------------------------------------------

it('finds the app’s screens on disk', () => {
  // Guards against the file walk silently finding nothing and every sweep passing.
  expect(ROUTES).toEqual(expect.arrayContaining(['index', 'administration', 'admin/club', 'sign-in']));
  expect(ADMIN_ROUTES.length).toBeGreaterThan(30);
  expect(MEMBER_ROUTES.length).toBeGreaterThan(50);
});

// The reports a committee member screened to work with children reads, and
// nothing else under admin (customer review C14). Under 18s, injuries,
// session plans, Season KPIs and affiliation stay with admins.
const COMMITTEE_REPORTS = [
  'admin/reports/index',
  'admin/reports/wwcc',
  'admin/reports/medical',
  'admin/reports/integrity',
  'admin/reports/attendance',
  'admin/reports/awards',
  'admin/reports/award',
];

describe('admin screens', () => {
  const REPRESENTATIVE = [
    'administration',
    'admin/index',
    'admin/[id]',
    'admin/club',
    'admin/safeguarding',
    'admin/reports/index',
    'admin/reports/wwcc',
    'admin/reports/under-18s',
    'admin/injuries',
    'admin/awards/index',
    'admin/training/index',
  ];

  const turnedAway: PersonaName[] = [
    'pending',
    'rejected',
    'pendingAdmin',
    'athlete',
    'guardian',
    'guest',
    'volunteer',
    'coach',
    'manager',
    'physio',
    'committeeExempt',
    'committeeBeforeChecksDate',
    'committeeExpiredCheck',
    'stoodDownAdmin',
  ];

  describe.each(turnedAway)('%s', (who) => {
    it.each(REPRESENTATIVE)('never lands on %s, and is sent home', async (route) => {
      await expectTurnedAway(who, route, 'index');
    });
  });

  describe('signed out', () => {
    it.each(REPRESENTATIVE)('never lands on %s, and is sent to sign-in', async (route) => {
      await expectTurnedAway('signedOut', route, 'sign-in');
    });
  });

  describe.each(['admin', 'adminExpiredCheck'] as PersonaName[])('%s', (who) => {
    it.each(REPRESENTATIVE)('opens %s', async (route) => {
      await expectReaches(who, route);
    });
  });

  // Every admin screen, not just the sample above: a new admin screen that
  // isn't inside the isAdmin guard fails here.
  describe('every admin screen on disk', () => {
    beforeEach(() => setClubFeatures({ kpis: true, affiliation: true }));

    it.each(ADMIN_ROUTES.filter((r) => !COMMITTEE_REPORTS.includes(r)))(
      'the committee can’t open %s',
      async (route) => {
        await expectTurnedAway('committee', route, 'index');
      },
    );

    it.each(ADMIN_ROUTES)('a stood-down admin can’t open %s', async (route) => {
      await expectTurnedAway('stoodDownAdmin', route, 'index');
    });

    it.each(ADMIN_ROUTES)('an admin opens %s with every feature on', async (route) => {
      await expectReaches('admin', route);
    });
  });
});

describe('committee reports', () => {
  beforeEach(() => setClubFeatures({ kpis: true, affiliation: true }));

  it('names real screens', () => {
    for (const route of COMMITTEE_REPORTS) expect(ADMIN_ROUTES).toContain(route);
  });

  describe.each(['committee', 'committeeVolunteerExempt', 'committeeNotChosen'] as PersonaName[])('%s', (who) => {
    it.each(COMMITTEE_REPORTS)('opens %s', async (route) => {
      await expectReaches(who, route);
    });

    it.each(['admin/reports/under-18s', 'admin/injuries', 'admin/reports/session-plans', 'admin/reports/kpis', 'admin/reports/affiliation', 'admin/index', 'admin/club'])(
      'never lands on %s, and is sent home',
      async (route) => {
        await expectTurnedAway(who, route, 'index');
      },
    );
  });

  // The reports name children: no check, no reports.
  describe.each(['committeeExempt', 'committeeBeforeChecksDate', 'committeeExpiredCheck', 'committeePastChecksDate', 'coach', 'guardian'] as PersonaName[])(
    '%s',
    (who) => {
      it.each(COMMITTEE_REPORTS)('never lands on %s, and is sent home', async (route) => {
        await expectTurnedAway(who, route, 'index');
      });
    },
  );

  it('a committee member reads a report only while its feature is on', async () => {
    setClubFeatures({ attendance: false, awards: false, integrity: false });
    for (const route of ['admin/reports/attendance', 'admin/reports/awards', 'admin/reports/integrity']) {
      await expectTurnedAway('committee', route, 'index');
    }
    await expectReaches('committee', 'admin/reports/wwcc');
  });
});

describe('signed-out members', () => {
  it.each([...MEMBER_ROUTES, ...ADMIN_ROUTES])(
    'can’t open %s and are sent to sign-in',
    async (route) => {
      await expectTurnedAway('signedOut', route, 'sign-in');
    },
  );

  it('only see choose-club before a club is picked, never sign-in or the home screen', async () => {
    setClubChosen(false);
    for (const route of ['index', 'sign-in', 'administration', 'messages/index']) {
      await expectTurnedAway('signedOut', route, 'choose-club');
    }
  });

  it.each(PUBLIC)('can open %s', async (route) => {
    await expectReaches('signedOut', route);
  });

  it('see sign-in once a club is picked', async () => {
    await expectReaches('signedOut', 'sign-in');
  });
});

describe('signed-in members', () => {
  it.each(['sign-in', 'choose-club'])('are sent home from %s', async (route) => {
    await expectTurnedAway('athlete', route, 'index');
  });

  it('a member waiting for approval has the home and join screens, never admin ones', async () => {
    await expectReaches('pending', 'index');
    await expectReaches('pending', 'join');
    await expectTurnedAway('pending', 'administration', 'index');
  });
});

