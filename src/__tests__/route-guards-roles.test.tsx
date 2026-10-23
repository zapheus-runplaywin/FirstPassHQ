/**
 * Who can open each member screen, through the real root layout's
 * `<Stack.Protected>` guards (src/app/_layout.tsx and src/lib/route-access.ts):
 * every screen outside Administration, for every kind of member, both ways.
 * Same set-up as route-guards.test.tsx; feature switches are in
 * route-guards-features.test.tsx.
 *
 * These are defence in depth: the database's row level security already
 * decides what each screen shows. A member turned away from a screen lands on
 * Home. A role paused by a lapsed check or a stand-down opens none of its
 * screens, and a member waiting for approval opens only the screens everyone
 * signed in has.
 *
 * Who is meant to reach each screen comes from the Home card or link that
 * leads to it, the access hooks in src/lib and the user guide's role tables
 * (docs/user-guide.md, sections 1 and 11).
 */
import {
  ADMIN_ROUTES,
  expectReaches,
  expectTurnedAway,
  MEMBER_ROUTES,
  personas,
  resetClub,
  ROUTES,
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

// Every feature on, Season KPIs included, so only the role guards decide.
beforeEach(() => {
  resetClub();
  setClubFeatures({ kpis: true });
});

// ---------------------------------------------------------------------------
// The kinds of member, by the roles they can use right now

const ATHLETES: PersonaName[] = [
  'athlete',
  'minorAthlete',
  'captain',
  'clubCaptain',
  'athleteCoach',
  // A stand-down pauses adult roles, never the athlete role.
  'stoodDownAthlete',
];
const GUARDIANS: PersonaName[] = ['guardian', 'guardianOfAdult', 'coachGuardian', 'adminGuardian'];
/** Coaches of a current squad or team. */
const GROUP_COACHES: PersonaName[] = ['coach', 'assistantCoach', 'coachGuardian', 'athleteCoach'];
/** Also a coach whose only squad has finished its squad phase. */
const COACHES: PersonaName[] = [...GROUP_COACHES, 'doneSquadCoach'];
const MANAGERS: PersonaName[] = ['manager', 'safeguardingOfficer'];
const PHYSIOS: PersonaName[] = ['physio', 'headPhysio'];
/**
 * The committee, including one exempted with a reason, one with no check
 * before the committee checks date and one cleared by a volunteer exemption:
 * the same member screens. (Only those screened to work with children also
 * read the reports, in route-guards.test.tsx.)
 */
const COMMITTEE: PersonaName[] = ['committee', 'committeeExempt', 'committeeBeforeChecksDate', 'committeeVolunteerExempt'];
// An expired check never pauses the admin role; a lapsed admin's coaching pauses.
const ADMINS: PersonaName[] = [
  'admin',
  'adminExpiredCheck',
  'adminGuardian',
  'adminLapsedCoach',
  // Over 30 days without a check: no under 18s' injuries, every admin screen still.
  'adminLapsedCheck',
];
/** Statisticians, including one with no check before the club's statistician checks date. */
const STATISTICIANS: PersonaName[] = ['statistician', 'statisticianBeforeChecksDate'];
const CAPTAINS: PersonaName[] = ['captain', 'clubCaptain'];

/** Approved, holding a role they can use other than guest or temporary helper. */
const CLUB_MEMBERS: PersonaName[] = [
  ...ATHLETES,
  ...GUARDIANS,
  ...COACHES,
  ...MANAGERS,
  ...PHYSIOS,
  ...COMMITTEE,
  ...ADMINS,
  ...STATISTICIANS,
];

/**
 * Members with no screen beyond the ones everyone has: waiting for approval,
 * turned down, guests, temporary helpers, and members whose every role is
 * paused (a lapsed check, the committee checks date passed, or a stand-down).
 */
const NO_ROLE_SCREENS: PersonaName[] = [
  'pending',
  'rejected',
  'pendingAdmin',
  'guest',
  'volunteer',
  'stoodDownAdmin',
  'coachExpiredCheck',
  'stoodDownCoach',
  'committeeExpiredCheck',
  'committeePastChecksDate',
  'statisticianPastChecksDate',
  'physioExpiredCheck',
];

const SIGNED_IN = (Object.keys(personas) as PersonaName[]).filter((p) => p !== 'signedOut');

const union = (...groups: PersonaName[][]) => [...new Set(groups.flat())];

// ---------------------------------------------------------------------------
// Who opens each screen

const MESSAGE_SENDERS = union(ADMINS, COMMITTEE, COACHES, MANAGERS, CAPTAINS);
const SURVEY_SENDERS = union(ADMINS, COMMITTEE, COACHES, MANAGERS, ['captain']);
// Coaches, managers and physios log injuries; managers open the injury
// screens only to do that, and see no records there.
const INJURY_LOGGERS = union(COACHES, MANAGERS, PHYSIOS);
const INJURIES = union(ATHLETES, GUARDIANS, COACHES, PHYSIOS, COMMITTEE, ADMINS, INJURY_LOGGERS);
const FAMILY_OF_ATHLETES = union(ATHLETES, GUARDIANS);
const ATTENDANCE_TAKERS = union(COACHES, MANAGERS, COMMITTEE, ADMINS);
const ATTENDANCE_VIEWERS = union(COACHES, COMMITTEE, ADMINS);
const PLAN_READERS = union(ADMINS, COACHES, ATHLETES, GUARDIANS);
const PLAN_AUTHORS = union(ADMINS, COACHES);
const CHECK_IN_VIEWERS = union(GROUP_COACHES, COMMITTEE, PHYSIOS, ADMINS);
const AWARD_VOTERS = union(ATHLETES, COACHES, MANAGERS, COMMITTEE, ADMINS, STATISTICIANS);
const KPI_READERS = union(ATHLETES, COACHES, MANAGERS, GUARDIANS, COMMITTEE, ADMINS);
const KPI_SETTERS = union(COMMITTEE, ADMINS, COACHES);
const CERTIFICATE_CHECKERS = union(COMMITTEE, ADMINS);
// Medical and emergency details: an athlete's own, a guardian's child's, and
// the coaches, managers and physios of a squad or team (a Head Physio in no
// group reaches them only from a link). Never admins or the committee as such.
const MEDICAL_READERS = union(ATHLETES, GUARDIANS, COACHES, MANAGERS, ['physio']);
const GROUP_STAFF = union(COACHES, MANAGERS, ['physio']);

const WHO_OPENS: Record<string, PersonaName[]> = {
  'messages/index': CLUB_MEMBERS,
  'messages/[id]': CLUB_MEMBERS,
  'messages/new': MESSAGE_SENDERS,

  'surveys/index': CLUB_MEMBERS,
  'surveys/[id]': CLUB_MEMBERS,
  'surveys/new': SURVEY_SENDERS,
  'surveys/results': SURVEY_SENDERS,

  'injuries/index': INJURIES,
  'injuries/[id]': INJURIES,
  'injuries/document': INJURIES,
  'injuries/new': FAMILY_OF_ATHLETES,
  'injuries/log': INJURY_LOGGERS,

  'attendance/index': ATTENDANCE_TAKERS,
  'attendance/[id]': ATTENDANCE_TAKERS,
  'attendance/new': ATTENDANCE_TAKERS,
  'attendance/athlete/[id]': ATTENDANCE_VIEWERS,
  'attendance/family/[id]': FAMILY_OF_ATHLETES,
  'attendance/absence': FAMILY_OF_ATHLETES,

  'session-plans/index': PLAN_READERS,
  'session-plans/[id]': PLAN_READERS,
  'session-plans/file': PLAN_READERS,
  'session-plans/edit': PLAN_AUTHORS,

  'check-in': ATHLETES,
  'check-ins/index': CHECK_IN_VIEWERS,
  'check-ins/athlete/[id]': union(GROUP_COACHES, GUARDIANS),

  'awards/index': AWARD_VOTERS,
  'awards/vote': AWARD_VOTERS,

  'goals/game': union(ATHLETES, GROUP_COACHES, GUARDIANS),
  'goals/athlete/[id]': union(GROUP_COACHES, GUARDIANS),
  // Admins read a team's goals (admin guide audit, 20 October).
  'goals/team': union(GROUP_COACHES, ADMINS),

  'kpis/index': KPI_READERS,
  'kpis/person': KPI_READERS,
  'kpis/edit': KPI_SETTERS,

  'training/index': CLUB_MEMBERS,
  'training/submit': CLUB_MEMBERS,
  'training/document': CLUB_MEMBERS,
  'training/review': CERTIFICATE_CHECKERS,
  'training/progress': CERTIFICATE_CHECKERS,
  'training/requirement/[id]': CERTIFICATE_CHECKERS,

  'concerns/index': union(ADMINS, ['safeguardingOfficer']),
  'concerns/[id]': union(ADMINS, ['safeguardingOfficer']),
  'concerns/report': union(ADMINS, ['safeguardingOfficer']),
  'concerns/wellbeing': union(ADMINS, ['safeguardingOfficer']),

  'consent/[id]': union(GUARDIANS, ADMINS),
  'records/[id]': union(GUARDIANS, ADMINS),
  'medical/[id]': MEDICAL_READERS,
  'medical/team/[id]': GROUP_STAFF,
  'activity/[id]': union(GUARDIANS, ADMINS),

  'team/captains/[id]': union(ADMINS, COACHES),
};

/** Screens every signed-in member has, including those waiting for approval. */
const EVERYONE_SIGNED_IN = [
  'index',
  'join',
  'team/[id]',
  'calendar',
  'event/[id]',
  'declaration',
  'wwcc-application',
  'concern/new',
  'conduct/[id]',
  'tasks/index',
  'tasks/new',
  'tasks/[id]',
  'my-details',
  'delete-account',
];

// ---------------------------------------------------------------------------

describe('the route table', () => {
  it('covers every member screen on disk, so a new screen must be placed in it', () => {
    const placed = [...Object.keys(WHO_OPENS), ...EVERYONE_SIGNED_IN].sort();
    expect(placed).toEqual([...MEMBER_ROUTES].sort());
  });

  it('names only real screens and sample members', () => {
    for (const [route, who] of Object.entries(WHO_OPENS)) {
      expect(ROUTES).toContain(route);
      expect(ADMIN_ROUTES).not.toContain(route);
      for (const p of who) expect(SIGNED_IN).toContain(p);
    }
  });

  it('gives no role screen to a member who can’t use a role', () => {
    for (const who of Object.values(WHO_OPENS)) {
      for (const p of NO_ROLE_SCREENS) expect(who).not.toContain(p);
    }
  });

  it('considers every kind of member', () => {
    // The kinds in docs/testing-strategy.md, all signed in.
    expect(SIGNED_IN).toEqual(
      expect.arrayContaining([
        ...ATHLETES,
        ...GUARDIANS,
        ...COACHES,
        ...MANAGERS,
        ...PHYSIOS,
        ...COMMITTEE,
        ...ADMINS,
        ...NO_ROLE_SCREENS,
        ...STATISTICIANS,
      ]),
    );
  });
});

describe.each(Object.entries(WHO_OPENS))('%s', (route, who) => {
  const reaches = SIGNED_IN.filter((p) => who.includes(p));
  const turnedAway = SIGNED_IN.filter((p) => !who.includes(p));

  it.each(reaches)('opens for %s', async (p) => {
    await expectReaches(p, route);
  });

  if (turnedAway.length > 0) {
    it.each(turnedAway)('sends %s home', async (p) => {
      await expectTurnedAway(p, route, 'index');
    });
  }
});

describe.each(EVERYONE_SIGNED_IN)('%s', (route) => {
  it.each(SIGNED_IN)('opens for %s', async (p) => {
    await expectReaches(p, route);
  });
});

describe('Season KPIs off', () => {
  it.each(['kpis/index', 'kpis/person', 'kpis/edit'])(
    'sends even the committee and coaches home from %s',
    async (route) => {
      setClubFeatures({});
      await expectTurnedAway('committee', route, 'index');
      await expectTurnedAway('coach', route, 'index');
    },
  );
});

describe('captains’ polls off', () => {
  it('a captain can no longer send polls, but keeps their polls’ results and still answers surveys', async () => {
    setClubFeatures({ kpis: true, captainPolls: false });
    await expectTurnedAway('captain', 'surveys/new', 'index');
    await expectReaches('captain', 'surveys/results');
    await expectReaches('captain', 'surveys/index');
  });
});
