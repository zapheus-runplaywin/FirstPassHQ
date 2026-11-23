/**
 * Feature switches in the real root layout (src/app/_layout.tsx): a feature an
 * admin turns off in Club settings is gone for every role, admins included,
 * and its screens can't be opened even from a link. Same set-up as
 * route-guards.test.tsx.
 */
import {
  expectReaches,
  expectTurnedAway,
  resetClub,
  ROUTES,
  setClubFeatures,
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
jest.mock('@/lib/log', () => ({ ...jest.requireActual('@/lib/log'), startAppLog: jest.fn() }));
jest.mock('@/components/brand-intro', () => ({ BrandIntro: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

beforeEach(() => resetClub());

// ---------------------------------------------------------------------------
// Feature switches: a feature that's off is gone for every role, admins included.

type FeatureCase = {
  feature: string;
  routes: string[];
  /** Whether the feature starts off until an admin turns it on. */
  offByDefault?: boolean;
};

const FEATURE_ROUTES: FeatureCase[] = [
  { feature: 'calendar', routes: ['calendar', 'event/[id]', 'admin/calendars'] },
  { feature: 'messages', routes: ['messages/index', 'messages/new', 'messages/[id]'] },
  {
    feature: 'surveys',
    routes: ['surveys/index', 'surveys/new', 'surveys/[id]', 'surveys/results'],
  },
  {
    feature: 'injuries',
    routes: ['injuries/index', 'injuries/new', 'injuries/[id]', 'injuries/document', 'admin/injuries'],
  },
  {
    feature: 'attendance',
    routes: [
      'attendance/index',
      'attendance/new',
      'attendance/[id]',
      'attendance/athlete/[id]',
      'attendance/family/[id]',
      'attendance/absence',
      'admin/reports/attendance',
      'admin/absence-reasons',
    ],
  },
  {
    feature: 'sessionPlans',
    routes: [
      'session-plans/index',
      'session-plans/edit',
      'session-plans/[id]',
      'session-plans/file',
      'admin/reports/session-plans',
    ],
  },
  { feature: 'checkIns', routes: ['check-in', 'check-ins/index', 'check-ins/athlete/[id]'] },
  { feature: 'trainingLoad', offByDefault: true, routes: ['check-ins/load'] },
  {
    feature: 'awards',
    routes: [
      'awards/index',
      'awards/vote',
      'admin/awards/index',
      'admin/awards/edit',
      'admin/awards/[id]',
      'admin/reports/awards',
      'admin/reports/award',
    ],
  },
  { feature: 'goals', routes: ['goals/athlete/[id]', 'goals/game', 'goals/team'] },
  {
    feature: 'kpis',
    offByDefault: true,
    routes: ['kpis/index', 'kpis/person', 'kpis/edit', 'admin/reports/kpis', 'admin/kpi-reviews'],
  },
  {
    feature: 'integrity',
    routes: [
      'training/index',
      'training/submit',
      'training/review',
      'training/progress',
      'training/requirement/[id]',
      'training/document',
      'admin/training/index',
      'admin/training/edit',
      'admin/reports/integrity',
    ],
  },
  {
    feature: 'registers',
    offByDefault: true,
    routes: [
      'registers/index',
      'registers/policies',
      'registers/policy',
      'registers/review',
      'registers/conflicts',
      'registers/conflict',
      'declare-conflicts',
    ],
  },
  {
    feature: 'selectionAssessments',
    offByDefault: true,
    routes: [
      'assessments/index',
      'assessments/round',
      'assessments/athlete',
      'assessments/observe',
      'assessments/summary',
      'assessments/feedback',
      'admin/assessments/index',
      'admin/assessments/criteria',
      'admin/assessments/round',
      'admin/assessments/audit',
      'admin/assessments/milestone',
      'admin/assessments/summaries',
      'selection',
    ],
  },
];

/**
 * Member screens an admin doesn't use (route-guards-roles.test.tsx), with a
 * member who opens each one while its feature is on. Every other screen is
 * checked with an admin.
 */
const OPENED_BY: Record<string, PersonaName> = {
  'injuries/new': 'athlete',
  'attendance/family/[id]': 'athlete',
  'attendance/absence': 'athlete',
  'check-in': 'athlete',
  'check-ins/athlete/[id]': 'coach',
  'check-ins/load': 'coach',
  'goals/athlete/[id]': 'coach',
  'goals/game': 'athlete',
  'goals/team': 'coach',
  'declare-conflicts': 'committee',
  selection: 'athlete',
};
const openerOf = (route: string): PersonaName => OPENED_BY[route] ?? 'admin';

it('the feature table names real screens', () => {
  for (const { routes } of FEATURE_ROUTES) {
    for (const route of routes) expect(ROUTES).toContain(route);
  }
  for (const route of Object.keys(OPENED_BY)) expect(ROUTES).toContain(route);
});

describe.each(FEATURE_ROUTES)('the $feature switch', ({ feature, routes, offByDefault }) => {
  const cases = routes.map((route) => ({ route, who: openerOf(route) }));

  it.each(cases)('off: an admin can’t open $route', async ({ route }) => {
    setClubFeatures({ [feature]: false });
    await expectTurnedAway('admin', route, 'index');
  });

  const memberOnly = cases.filter(({ who }) => who !== 'admin');
  if (memberOnly.length > 0) {
    it.each(memberOnly)('off: the $who who uses $route can’t open it', async ({ route, who }) => {
      setClubFeatures({ [feature]: false });
      await expectTurnedAway(who, route, 'index');
    });
  }

  it.each(cases)('on: the $who opens $route', async ({ route, who }) => {
    setClubFeatures({ [feature]: true });
    await expectReaches(who, route);
  });

  const memberRoutes = cases.filter(({ route }) => !route.startsWith('admin/'));
  if (memberRoutes.length > 0) {
    it.each(memberRoutes)('off: a coach can’t open $route either', async ({ route }) => {
      setClubFeatures({ [feature]: false });
      await expectTurnedAway('coach', route, 'index');
    });
  }

  it(offByDefault ? 'starts off until an admin turns it on' : 'starts on', async () => {
    setClubFeatures({});
    if (offByDefault) await expectTurnedAway(openerOf(routes[0]), routes[0], 'index');
    else await expectReaches(openerOf(routes[0]), routes[0]);
  });
});

describe('fixtures', () => {
  it('can’t be opened once calendar, awards and game goals are all off', async () => {
    setClubFeatures({ calendar: false, awards: false, goals: false });
    await expectTurnedAway('admin', 'admin/fixtures', 'index');
  });

  it.each(['calendar', 'awards', 'goals'])('open while %s alone is on', async (feature) => {
    setClubFeatures({ calendar: false, awards: false, goals: false, [feature]: true });
    await expectReaches('admin', 'admin/fixtures');
  });

  it('stay admin-only while every feature is on', async () => {
    await expectTurnedAway('coach', 'admin/fixtures', 'index');
  });
});

describe('features that are off never open for anyone', () => {
  // Every feature off at once: these screens are gone for every role.
  const ALL_OFF = Object.fromEntries(FEATURE_ROUTES.map(({ feature }) => [feature, false]));
  const gated = FEATURE_ROUTES.flatMap(({ routes }) => routes).filter(
    (r) => !r.startsWith('admin/'),
  );
  // Admins and coaches are checked feature by feature above.
  const everyone: PersonaName[] = ['athlete', 'guardian', 'physio'];

  describe.each(everyone)('%s', (who) => {
    it.each(gated)('can’t open %s', async (route) => {
      setClubFeatures(ALL_OFF);
      await expectTurnedAway(who, route, 'index');
    });
  });

  it('still leaves the screens that no switch controls', async () => {
    setClubFeatures(ALL_OFF);
    for (const route of ['index', 'concern/new', 'tasks/index', 'my-details', 'administration']) {
      await expectReaches('admin', route);
    }
  });
});
