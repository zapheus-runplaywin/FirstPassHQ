/**
 * Who can do what, client side: every role hook in src/lib, for every kind of
 * member. The database applies the same rules (see supabase/tests/); these
 * decide which screens, cards and buttons a member gets.
 *
 * Each persona is the signed-in member as `useAuth` gives it: roles paused by
 * a lapsed check or a stand-down are already left out of `profile` and
 * `memberships`, as AuthProvider does (auth.test.tsx covers that step).
 *
 * The expected values come from the hooks' code and comments and the user
 * guide's role tables (docs/user-guide.md, sections 1 and 11).
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAbsencesToReview, useLeadsAGroup } from '@/lib/absences';
import { useAffiliationTodos } from '@/lib/affiliation';
import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { useAuth } from '@/lib/auth';
import { useAwardSlots } from '@/lib/awards';
import {
  useCanSeeCheckInOverview,
  useCanSeeCheckIns,
  useCheckInOverview,
  useCheckInSummary,
  useIsCheckInAthlete,
  useIsCheckInCoach,
  useMyCheckIn,
} from '@/lib/check-ins';
import type { Features } from '@/lib/club';
import { useConductTodos } from '@/lib/conduct';
import { useCanCommentOnTeamGoals, useIsGoalAthlete, useIsGoalCoach } from '@/lib/goals';
import { useCanSeeInjuries, useOpenInjuries } from '@/lib/injuries';
import { useKpiPeople, useKpiReviewTodos, useKpisOn } from '@/lib/kpis';
import {
  useCanMessageClub,
  useCanSendMessages,
  useCaptainedGroupIds,
  useGetsMessages,
  useLedGroups,
  useMessageGroups,
  useUnreadCount,
} from '@/lib/messages';
import { usePersonalTasks } from '@/lib/personal-tasks';
import { usePlanGroups, useSessionPlanSummary } from '@/lib/session-plans';
import { supabase } from '@/lib/supabase';
import {
  useCanManageSurveys,
  useCanSendSurveys,
  useCaptainedPollGroupIds,
  useMySurveys,
} from '@/lib/surveys';
import {
  useCanCheckTraining,
  useClubHasTraining,
  useMyTraining,
  useTrainingToReview,
} from '@/lib/training';
import type {
  AppRole,
  CoachTitle,
  GroupCaptain,
  Profile,
  Team,
  TeamMembership,
  TeamRole,
} from '@/lib/types';
import { usePendingRequests, useSafetyTodos } from '@/lib/use-pending-requests';

jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

// Club settings: every feature on unless a test turns one off.
const mockClub: { features: Features; affiliation: boolean } = {
  features: allFeatures(),
  affiliation: true,
};
jest.mock('@/lib/club', () => ({
  useClub: () => mockClub,
  useFeature: (key: keyof Features) => mockClub.features[key],
}));

// Screens' focus runs the hooks' loads once, like opening the screen.
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect(effect: () => void) {
      React.useEffect(effect, [effect]);
    },
  };
});

function allFeatures(): Features {
  return {
    messages: true,
    calendar: true,
    checkIns: true,
    trainingLoad: true,
    injuries: true,
    attendance: true,
    sessionPlans: true,
    surveys: true,
    captainPolls: true,
    awards: true,
    goals: true,
    integrity: true,
    kpis: true,
    registers: true,
  };
}

type Auth = ReturnType<typeof useAuth>;

// ---------------------------------------------------------------------------
// Sample squads, teams and people
// ---------------------------------------------------------------------------

const TEAM_A: Team = {
  id: 'team-a',
  name: 'Open A',
  sort_order: 1,
  kind: 'team',
  season: 2026,
  squad_id: 'squad-open',
  selections_completed_at: null,
};
const TEAM_B: Team = {
  id: 'team-b',
  name: '17 & Under A',
  sort_order: 2,
  kind: 'team',
  season: 2026,
  squad_id: 'squad-17u',
  selections_completed_at: null,
};
/** A squad whose squad phase an admin has marked complete. */
const DONE_SQUAD: Team = {
  id: 'squad-done',
  name: 'Mixed Open Squad',
  sort_order: 3,
  kind: 'squad',
  season: 2026,
  squad_id: null,
  selections_completed_at: '2026-09-01T00:00:00Z',
};
const TEAMS = [TEAM_A, TEAM_B, DONE_SQUAD];
const ALL_IDS = TEAMS.map((t) => t.id);

// Born well over and well under 18 on 18 October 2026.
const ADULT = '1990-05-01';
const CHILD = '2011-03-02';

function member(team: Team, team_role: TeamRole, coach_title: CoachTitle | null = null): TeamMembership {
  return { team, team_role, coach_title, selection: null };
}

function captain(team: Team): GroupCaptain {
  return { team_id: team.id, profile_id: 'me', captain_role: 'captain' };
}

function profile(role: AppRole, overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'me',
    email: 'sam@example.com',
    full_name: 'Sam Sample',
    preferred_name: null,
    title: null,
    head_physio: false,
    playhq_email: null,
    role,
    extra_roles: [],
    status: 'approved',
    requested_role: null,
    requested_team_id: null,
    join_requested_at: null,
    under_17: false,
    date_of_birth: ADULT,
    declared_date_of_birth: null,
    guardian_email: null,
    wwcc_number: '123456A',
    wwcc_expires_on: '2029-01-01',
    wwcc_exempt_reason: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    rejection_reason: null,
    verified_at: '2026-01-01T00:00:00Z',
    stood_down_at: null,
    ...overrides,
  };
}

type PersonaInput = {
  profile: Profile | null;
  memberships?: TeamMembership[];
  captaincies?: GroupCaptain[];
  isClubCaptain?: boolean;
  /** Roles AuthProvider left out of `profile`, and whether it was a stand-down. */
  paused?: { roles: AppRole[]; stoodDown: boolean };
};

function persona({
  profile: p,
  memberships = [],
  captaincies = [],
  isClubCaptain = false,
  paused,
}: PersonaInput): Auth {
  const roles = p ? [p.role, ...p.extra_roles] : [];
  return {
    loading: false,
    session: p ? ({ user: { id: p.id } } as Auth['session']) : null,
    profile: p,
    paused: paused ? { ...paused, exemption: null, application: null } : null,
    exemption: null,
    wwccApplication: null,
    memberships,
    captaincies,
    isClubCaptain,
    // As AuthProvider works it out: an approved member who can use the admin role.
    isAdmin: roles.includes('admin') && p?.status === 'approved',
    committeeChecksFrom: null,
    statisticianChecksFrom: null,
    isSafeguardingOfficer: false,
    committeeSeesInjuries: true,
    refresh: jest.fn(),
    signOut: jest.fn(),
  };
}

const PERSONAS = {
  signedOut: persona({ profile: null }),

  admin: persona({ profile: profile('admin') }),
  committee: persona({ profile: profile('committee', { title: 'Secretary' }) }),

  headCoach: persona({
    profile: profile('coach'),
    memberships: [member(TEAM_A, 'coach', 'head_coach')],
  }),
  assistantCoach: persona({
    profile: profile('coach'),
    memberships: [member(TEAM_A, 'coach', 'assistant_coach')],
  }),
  manager: persona({ profile: profile('manager'), memberships: [member(TEAM_A, 'manager')] }),
  squadPhysio: persona({ profile: profile('physio'), memberships: [member(TEAM_A, 'physio')] }),
  headPhysio: persona({ profile: profile('physio', { head_physio: true }) }),

  adultAthlete: persona({
    profile: profile('athlete', { wwcc_number: null, wwcc_expires_on: null }),
    memberships: [member(TEAM_A, 'athlete')],
  }),
  minorAthlete: persona({
    profile: profile('athlete', {
      date_of_birth: CHILD,
      under_17: true,
      wwcc_number: null,
      wwcc_expires_on: null,
    }),
    memberships: [member(TEAM_A, 'athlete')],
  }),
  /** Captain of the team they play in. */
  squadCaptain: persona({
    profile: profile('athlete', { wwcc_number: null, wwcc_expires_on: null }),
    memberships: [member(TEAM_A, 'athlete')],
    captaincies: [captain(TEAM_A)],
  }),
  /** Still listed as captain of a team they no longer play in. */
  formerCaptain: persona({
    profile: profile('athlete', { wwcc_number: null, wwcc_expires_on: null }),
    memberships: [member(TEAM_A, 'athlete')],
    captaincies: [captain(TEAM_B)],
  }),
  clubCaptain: persona({
    profile: profile('athlete', { wwcc_number: null, wwcc_expires_on: null }),
    memberships: [member(TEAM_A, 'athlete')],
    isClubCaptain: true,
  }),

  /** Parent of an athlete under 18 in team A. */
  guardian: persona({
    profile: profile('guardian', { wwcc_number: null, wwcc_expires_on: null }),
    memberships: [member(TEAM_A, 'guardian')],
  }),
  /** Their child has turned 18; the database stops showing the child's records. */
  guardianOfAdult: persona({
    profile: profile('guardian', { wwcc_number: null, wwcc_expires_on: null }),
    memberships: [member(TEAM_A, 'guardian')],
  }),

  guest: persona({ profile: profile('guest', { wwcc_number: null, wwcc_expires_on: null }) }),
  volunteer: persona({
    profile: profile('volunteer', {
      volunteer_task: 'Bench helper at the carnival',
      volunteer_from: '2026-10-17',
      volunteer_until: '2026-10-19',
    }),
  }),

  /** A coach whose check expired: the coach role and its team places are paused. */
  lapsedCoach: persona({
    profile: profile('guest', { wwcc_expires_on: '2026-10-01' }),
    paused: { roles: ['coach'], stoodDown: false },
  }),
  stoodDownCoach: persona({
    profile: profile('guest', { stood_down_at: '2026-10-10T00:00:00Z' }),
    paused: { roles: ['coach'], stoodDown: true },
  }),
  stoodDownAdmin: persona({
    profile: profile('guest', { stood_down_at: '2026-10-10T00:00:00Z' }),
    paused: { roles: ['admin'], stoodDown: true },
  }),
  /** No check by the club's committee checks date. */
  lapsedCommittee: persona({
    profile: profile('guest', { wwcc_number: null, wwcc_expires_on: null }),
    paused: { roles: ['committee'], stoodDown: false },
  }),

  /** Waiting for approval: nothing works yet, whatever their roles and groups. */
  pendingCoach: persona({
    profile: profile('coach', { status: 'pending', requested_role: 'coach' }),
    memberships: [member(TEAM_A, 'coach', 'head_coach')],
  }),
  pendingAdmin: persona({ profile: profile('admin', { status: 'pending' }) }),

  /** Coaches team A, parent of an athlete in team B. */
  coachGuardian: persona({
    profile: profile('coach', { extra_roles: ['guardian'] }),
    memberships: [member(TEAM_A, 'coach', 'head_coach'), member(TEAM_B, 'guardian')],
  }),
  /** Plays in team A, coaches team B. */
  athleteCoach: persona({
    profile: profile('athlete', { extra_roles: ['coach'] }),
    memberships: [member(TEAM_A, 'athlete'), member(TEAM_B, 'coach', 'assistant_coach')],
  }),
  /** Under 18, plays in team A and coaches team B: the one role they can add. */
  minorAthleteCoach: persona({
    profile: profile('athlete', { extra_roles: ['coach'], date_of_birth: CHILD, under_17: true }),
    memberships: [member(TEAM_A, 'athlete'), member(TEAM_B, 'coach', 'assistant_coach')],
  }),
  adminGuardian: persona({
    profile: profile('admin', { extra_roles: ['guardian'] }),
    memberships: [member(TEAM_B, 'guardian')],
  }),
  /** An admin who also coaches, with an expired check: admin stays, coaching pauses. */
  adminLapsedCoach: persona({
    profile: profile('admin', { wwcc_expires_on: '2026-10-01' }),
    paused: { roles: ['coach'], stoodDown: false },
  }),
  /** Coaches only a squad whose squad phase is complete. */
  doneSquadCoach: persona({
    profile: profile('coach'),
    memberships: [member(DONE_SQUAD, 'coach', 'head_coach')],
  }),
} satisfies Record<string, Auth>;

type PersonaName = keyof typeof PERSONAS;
const NAMES = Object.keys(PERSONAS) as PersonaName[];

// Groups of personas the rules below share.
const ADMINS: PersonaName[] = ['admin', 'adminGuardian', 'adminLapsedCoach'];
const COACHES: PersonaName[] = [
  'headCoach',
  'assistantCoach',
  'coachGuardian',
  'athleteCoach',
  'minorAthleteCoach',
  'doneSquadCoach',
];
const ATHLETES: PersonaName[] = [
  'adultAthlete',
  'minorAthlete',
  'squadCaptain',
  'formerCaptain',
  'clubCaptain',
  'athleteCoach',
  'minorAthleteCoach',
];
const PHYSIOS: PersonaName[] = ['squadPhysio', 'headPhysio'];
const GUARDIANS: PersonaName[] = ['guardian', 'guardianOfAdult', 'coachGuardian', 'adminGuardian'];
/** Approved and holding at least one role they can use, other than guest or temporary helper. */
const NOT_APPROVED: PersonaName[] = ['signedOut', 'pendingCoach', 'pendingAdmin'];
const APPROVED = NAMES.filter((n) => !NOT_APPROVED.includes(n));

const mockedUseAuth = jest.mocked(useAuth);

function as(name: PersonaName) {
  mockedUseAuth.mockReturnValue(PERSONAS[name]);
}

/** What a hook gives each persona, from the list of who gets true. */
function rows(yes: PersonaName[], skip: PersonaName[] = []) {
  return NAMES.filter((n) => !skip.includes(n)).map((n) => [n, yes.includes(n)] as const);
}

/** A chainable stand-in for a Supabase query that resolves with nothing. */
function query(): unknown {
  const result = { data: null, error: null, count: 0 };
  const q: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ['select', 'eq', 'neq', 'not', 'is', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
    q[method] = () => q;
  }
  return q;
}

beforeEach(() => {
  // Sunday 18 October 2026, local time.
  jest.useFakeTimers({ now: new Date(2026, 9, 18, 12) });
  mockClub.features = allFeatures();
  mockClub.affiliation = true;
  jest.mocked(supabase.rpc).mockReset().mockImplementation(() => query() as never);
  jest.mocked(supabase.from).mockReset().mockImplementation(() => query() as never);
});

afterEach(() => {
  jest.useRealTimers();
});

function hookValue<T>(name: PersonaName, hook: () => T): T {
  as(name);
  return renderHook(hook).result.current;
}

// ---------------------------------------------------------------------------
// The matrix: who each yes/no role hook says yes to
// ---------------------------------------------------------------------------

describe('attendance and absences', () => {
  // Guide: coaches and managers review their own groups' absences; the
  // committee and admins see every absence from the attendance screen.
  test.each(rows([...COACHES, 'manager']))('useLeadsAGroup: %s → %s', (name, expected) => {
    expect(hookValue(name, useLeadsAGroup)).toBe(expected);
  });

  // Guide: Take attendance — coach, manager, committee, admin.
  test.each(rows([...ADMINS, 'committee', ...COACHES, 'manager']))(
    'useCanTakeAttendance: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanTakeAttendance)).toBe(expected);
    },
  );

  // Guide: See athletes' attendance history — coach, committee, admin. Managers don't.
  test.each(rows([...ADMINS, 'committee', ...COACHES]))(
    'useCanViewAttendance: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanViewAttendance)).toBe(expected);
    },
  );
});

describe('daily check-ins', () => {
  // Guide: Daily check-in — athletes only.
  test.each(rows(ATHLETES))('useIsCheckInAthlete: %s → %s', (name, expected) => {
    expect(hookValue(name, useIsCheckInAthlete)).toBe(expected);
  });

  // Guide: Check-ins of others — coaches, their own athletes. Not a coach whose
  // only squad has finished its squad phase, the same as the database.
  test.each(rows(COACHES.filter((n) => n !== 'doneSquadCoach')))('useIsCheckInCoach: %s → %s', (name, expected) => {
    expect(hookValue(name, useIsCheckInCoach)).toBe(expected);
  });

  // Guide: committee, physios and admins see averages only.
  test.each(rows([...ADMINS, 'committee', ...PHYSIOS]))(
    'useCanSeeCheckInOverview: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanSeeCheckInOverview)).toBe(expected);
    },
  );

  test.each(rows([...ADMINS, 'committee', ...PHYSIOS, ...COACHES.filter((n) => n !== 'doneSquadCoach')]))(
    'useCanSeeCheckIns: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanSeeCheckIns)).toBe(expected);
    },
  );
});

describe('game goals', () => {
  test.each(rows(ATHLETES))('useIsGoalAthlete: %s → %s', (name, expected) => {
    expect(hookValue(name, useIsGoalAthlete)).toBe(expected);
  });

  // Coaches of a current squad or team; a completed squad's coaches stop.
  test.each(rows(COACHES.filter((n) => n !== 'doneSquadCoach')))(
    'useIsGoalCoach: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useIsGoalCoach)).toBe(expected);
    },
  );

  // Guide: team goals — the team's athletes and coaches comment; guardians,
  // admins, managers and physios don't.
  test.each(
    rows([
      'headCoach',
      'assistantCoach',
      'coachGuardian',
      'adultAthlete',
      'minorAthlete',
      'squadCaptain',
      'formerCaptain',
      'clubCaptain',
      'athleteCoach',
      'minorAthleteCoach',
    ]),
  )('useCanCommentOnTeamGoals(team A): %s → %s', (name, expected) => {
    expect(hookValue(name, () => useCanCommentOnTeamGoals(TEAM_A.id))).toBe(expected);
  });

  test.each(rows(['athleteCoach', 'minorAthleteCoach']))(
    'useCanCommentOnTeamGoals(team B), where only these coach and the others are guardians: %s → %s',
    (name, expected) => {
      expect(hookValue(name, () => useCanCommentOnTeamGoals(TEAM_B.id))).toBe(expected);
    },
  );

  test.each(NAMES)('useCanCommentOnTeamGoals with no team is false: %s', (name) => {
    expect(hookValue(name, () => useCanCommentOnTeamGoals(null))).toBe(false);
    expect(hookValue(name, () => useCanCommentOnTeamGoals(undefined))).toBe(false);
    expect(hookValue(name, () => useCanCommentOnTeamGoals('another-team'))).toBe(false);
  });
});

describe('injuries', () => {
  // Guide: athletes, guardians, coaches, physios, the committee and admins;
  // never managers, guests or temporary helpers. The database picks which.
  test.each(rows([...ADMINS, 'committee', ...COACHES, ...PHYSIOS, ...ATHLETES, ...GUARDIANS]))(
    'useCanSeeInjuries: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanSeeInjuries)).toBe(expected);
    },
  );
});

describe('messages', () => {
  // Guide: admins, the committee and club captains message the whole club.
  test.each(rows([...ADMINS, 'committee', 'clubCaptain']))(
    'useCanMessageClub: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanMessageClub)).toBe(expected);
    },
  );

  // Guide: Send messages — captains, coaches, managers, committee, admin.
  test.each(rows([...ADMINS, 'committee', 'clubCaptain', 'squadCaptain', ...COACHES, 'manager']))(
    'useCanSendMessages: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanSendMessages)).toBe(expected);
    },
  );

  // Guide: guests and temporary helpers don't get messages; a member whose
  // only role is paused shows as a guest.
  test.each(
    rows(
      APPROVED.filter(
        (n) =>
          ![
            'guest',
            'volunteer',
            'lapsedCoach',
            'stoodDownCoach',
            'stoodDownAdmin',
            'lapsedCommittee',
          ].includes(n),
      ),
    ),
  )('useGetsMessages: %s → %s', (name, expected) => {
    expect(hookValue(name, useGetsMessages)).toBe(expected);
  });
});

describe('surveys', () => {
  test.each(rows([...ADMINS, 'committee']))('useCanManageSurveys: %s → %s', (name, expected) => {
    expect(hookValue(name, useCanManageSurveys)).toBe(expected);
  });

  // Guide: club captains message the club but send no polls; squad captains
  // poll their own squad or team.
  test.each(rows([...ADMINS, 'committee', 'squadCaptain', ...COACHES, 'manager']))(
    'useCanSendSurveys: %s → %s',
    (name, expected) => {
      expect(hookValue(name, useCanSendSurveys)).toBe(expected);
    },
  );
});

describe('integrity training', () => {
  // Guide: Check training certificates — committee and admins.
  test.each(rows([...ADMINS, 'committee']))('useCanCheckTraining: %s → %s', (name, expected) => {
    expect(hookValue(name, useCanCheckTraining)).toBe(expected);
  });
});

describe('season KPIs', () => {
  // The switch for the feature: approved members only; the database picks whose KPIs.
  test.each(rows(APPROVED))('useKpisOn: %s → %s', (name, expected) => {
    expect(hookValue(name, useKpisOn)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Which squads and teams each member acts for
// ---------------------------------------------------------------------------

/** Squads and teams each persona coaches or manages (every one for admins). */
const LED: Partial<Record<PersonaName, string[]>> = {
  admin: ALL_IDS,
  adminGuardian: ALL_IDS,
  adminLapsedCoach: ALL_IDS,
  headCoach: [TEAM_A.id],
  assistantCoach: [TEAM_A.id],
  coachGuardian: [TEAM_A.id],
  manager: [TEAM_A.id],
  athleteCoach: [TEAM_B.id],
  minorAthleteCoach: [TEAM_B.id],
  doneSquadCoach: [DONE_SQUAD.id],
};

const ids = (teams: Team[]) => teams.map((t) => t.id);

describe('groups a member leads', () => {
  test.each(NAMES.map((n) => [n, LED[n] ?? []] as const))(
    'useLedGroups (attendance): %s → %j',
    (name, expected) => {
      expect(ids(hookValue(name, () => useLedGroups(TEAMS)))).toEqual(expected);
    },
  );

  // Guide: session plans — coaches add them for their groups, admins for any.
  // Managers don't.
  test.each(NAMES.map((n) => [n, n === 'manager' ? [] : (LED[n] ?? [])] as const))(
    'usePlanGroups (session plans): %s → %j',
    (name, expected) => {
      expect(ids(hookValue(name, () => usePlanGroups(TEAMS)))).toEqual(expected);
    },
  );

  // Captains message the squad or team they captain while they play in it.
  test.each(NAMES.map((n) => [n, n === 'squadCaptain' ? [TEAM_A.id] : (LED[n] ?? [])] as const))(
    'useMessageGroups: %s → %j',
    (name, expected) => {
      expect(ids(hookValue(name, () => useMessageGroups(TEAMS)))).toEqual(expected);
    },
  );

  test.each(NAMES.map((n) => [n, n === 'squadCaptain' ? [TEAM_A.id] : []] as const))(
    'useCaptainedGroupIds: %s → %j',
    (name, expected) => {
      expect([...hookValue(name, useCaptainedGroupIds)]).toEqual(expected);
    },
  );

  it('only offers the squads and teams it was given, such as the current season', () => {
    expect(ids(hookValue('admin', () => useLedGroups([TEAM_B])))).toEqual([TEAM_B.id]);
    expect(ids(hookValue('headCoach', () => useLedGroups([TEAM_B])))).toEqual([]);
    expect(ids(hookValue('admin', () => usePlanGroups([])))).toEqual([]);
    expect(ids(hookValue('squadCaptain', () => useMessageGroups([TEAM_B])))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Club feature switches
// ---------------------------------------------------------------------------

describe('feature switches', () => {
  it('stops absence reviews when attendance is off', () => {
    mockClub.features.attendance = false;
    for (const name of NAMES) expect(hookValue(name, useLeadsAGroup)).toBe(false);
  });

  it('stops captains’ polls when the club turns them off, but not coaches’ surveys', () => {
    mockClub.features.captainPolls = false;
    expect(hookValue('squadCaptain', useCanSendSurveys)).toBe(false);
    expect([...hookValue('squadCaptain', useCaptainedPollGroupIds)]).toEqual([]);
    expect(hookValue('headCoach', useCanSendSurveys)).toBe(true);
    expect(hookValue('manager', useCanSendSurveys)).toBe(true);
    expect(hookValue('committee', useCanSendSurveys)).toBe(true);
    // Messages from captains don't depend on polls.
    expect(hookValue('squadCaptain', useCanSendMessages)).toBe(true);
  });

  test.each(NAMES.map((n) => [n, n === 'squadCaptain' ? [TEAM_A.id] : []] as const))(
    'useCaptainedPollGroupIds with captains’ polls on: %s → %j',
    (name, expected) => {
      expect([...hookValue(name, useCaptainedPollGroupIds)]).toEqual(expected);
    },
  );

  it('turns season KPIs off for everyone when the club hasn’t turned them on', () => {
    mockClub.features.kpis = false;
    for (const name of NAMES) expect(hookValue(name, useKpisOn)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Data a hook fetches only for the members allowed it
// ---------------------------------------------------------------------------

type Fetch = { rpc: string } | { from: string };

function fetched(call: Fetch) {
  if ('rpc' in call) return jest.mocked(supabase.rpc).mock.calls.some(([fn]) => fn === call.rpc);
  return jest.mocked(supabase.from).mock.calls.some(([table]) => table === call.from);
}

const GATED: [string, () => unknown, Fetch, PersonaName[], PersonaName[]?][] = [
  // Admins only.
  ['usePendingRequests', usePendingRequests, { from: 'profiles' }, ADMINS],
  ['useSafetyTodos', useSafetyTodos, { rpc: 'admin_safety_todos' }, ADMINS],
  ['useSafetyTodos (clearances nobody can endorse)', useSafetyTodos, { rpc: 'admin_unendorsable_clearances' }, ADMINS],
  ['useSafetyTodos (check applications to confirm)', useSafetyTodos, { rpc: 'admin_wwcc_applications' }, ADMINS],
  ['useAffiliationTodos', useAffiliationTodos, { rpc: 'admin_affiliation' }, ADMINS],
  // The committee and admins.
  ['useTrainingToReview', useTrainingToReview, { rpc: 'training_to_review' }, [...ADMINS, 'committee']],
  ['useClubHasTraining', useClubHasTraining, { from: 'training_requirements' }, [...ADMINS, 'committee']],
  [
    'useCheckInOverview',
    () => useCheckInOverview('2026-10-18'),
    { rpc: 'check_in_overview' },
    [...ADMINS, 'committee', ...PHYSIOS],
  ],
  // Coaches of their own athletes.
  [
    'useCheckInSummary',
    useCheckInSummary,
    { rpc: 'check_in_summary' },
    COACHES.filter((n) => n !== 'doneSquadCoach'),
    ['doneSquadCoach'],
  ],
  // Athletes.
  ['useMyCheckIn', useMyCheckIn, { from: 'check_ins' }, ATHLETES],
  // Everyone with an injuries screen.
  [
    'useOpenInjuries',
    useOpenInjuries,
    { rpc: 'visible_injuries' },
    [...ADMINS, 'committee', ...COACHES, ...PHYSIOS, ...ATHLETES, ...GUARDIANS],
  ],
  // Approved members; the database decides what each gets.
  ['useUnreadCount', useUnreadCount, { from: 'message_recipients' }, APPROVED],
  ['useConductTodos', useConductTodos, { rpc: 'my_conduct_todos' }, APPROVED],
  ['useAwardSlots', useAwardSlots, { rpc: 'award_slots' }, APPROVED],
  ['useMySurveys', useMySurveys, { rpc: 'my_surveys' }, APPROVED],
  ['useMyTraining', useMyTraining, { rpc: 'my_training' }, APPROVED],
  ['usePersonalTasks', usePersonalTasks, { from: 'personal_tasks' }, APPROVED],
  ['useSessionPlanSummary', useSessionPlanSummary, { rpc: 'session_plan_summary' }, APPROVED],
  ['useKpiPeople', useKpiPeople, { rpc: 'season_kpi_people' }, APPROVED],
  ['useKpiReviewTodos', useKpiReviewTodos, { rpc: 'kpi_review_todos' }, APPROVED],
];

describe.each(GATED)('%s fetches only for the members allowed it', (_hook, hook, call, yes, skip) => {
  test.each(rows(yes, skip))('%s → %s', async (name, expected) => {
    as(name);
    renderHook(hook);
    await act(async () => {});
    expect(fetched(call)).toBe(expected);
  });
});

describe('feature switches stop the fetches', () => {
  it('fetches no affiliation follow-ups when the club keeps no affiliation records', async () => {
    mockClub.affiliation = false;
    as('admin');
    renderHook(useAffiliationTodos);
    await act(async () => {});
    expect(fetched({ rpc: 'admin_affiliation' })).toBe(false);
  });

  it.each([
    ['integrity', useTrainingToReview, { rpc: 'training_to_review' }],
    ['integrity', useClubHasTraining, { from: 'training_requirements' }],
    ['integrity', useMyTraining, { rpc: 'my_training' }],
    ['surveys', useMySurveys, { rpc: 'my_surveys' }],
    ['sessionPlans', useSessionPlanSummary, { rpc: 'session_plan_summary' }],
    ['kpis', useKpiPeople, { rpc: 'season_kpi_people' }],
  ] as [keyof Features, () => unknown, Fetch][])(
    'fetches nothing for an admin with %s off',
    async (feature, hook, call) => {
      mockClub.features[feature] = false;
      as('admin');
      renderHook(hook);
      await act(async () => {});
      expect(fetched(call)).toBe(false);
    },
  );

  it('leaves absences to review empty unless asked for', async () => {
    as('headCoach');
    const { result } = renderHook(() => useAbsencesToReview(false));
    await act(async () => {});
    expect(result.current.absencesToReview).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What the results hold back from members not allowed them
// ---------------------------------------------------------------------------

describe('results for members not allowed them', () => {
  it('gives no safety to-dos to anyone but admins', async () => {
    for (const name of NAMES.filter((n) => !ADMINS.includes(n))) {
      as(name);
      const { result } = renderHook(useSafetyTodos);
      await act(async () => {});
      expect(result.current.safetyTodos).toBeNull();
    }
  });

  it('gives no check-in overview to coaches, managers, athletes or guardians', async () => {
    for (const name of ['headCoach', 'manager', 'adultAthlete', 'guardian', 'guest'] as const) {
      as(name);
      const { result } = renderHook(() => useCheckInOverview('2026-10-18'));
      await act(async () => {});
      expect(result.current.checkInOverview).toBeNull();
    }
  });

  it('gives no check-in of their own to members who aren’t athletes', async () => {
    for (const name of ['headCoach', 'guardian', 'admin', 'pendingCoach'] as const) {
      as(name);
      const { result } = renderHook(useMyCheckIn);
      await act(async () => {});
      expect(result.current.myCheckIn).toBeUndefined();
    }
  });
});
