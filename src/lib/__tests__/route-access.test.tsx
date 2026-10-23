/**
 * useRouteAccess: which member screens the root layout lets each kind of
 * member open. The route tests (src/__tests__/route-guards-roles.test.tsx)
 * check the same rules through the real layout and AuthProvider; these check
 * the hook on its own, with members AuthProvider has already worked out
 * (paused roles left out), including cases the screen tests don't reach.
 */
import { renderHook } from '@testing-library/react-native';

import type { useAuth } from '@/lib/auth';
import type { Features } from '@/lib/club';
import { useRouteAccess, type RouteAccess } from '@/lib/route-access';
import type { AppRole, GroupCaptain, Profile, Team, TeamMembership, TeamRole } from '@/lib/types';

type Auth = ReturnType<typeof useAuth>;

let mockAuth: Auth;
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));

const mockClub: { features: Features } = { features: features() };
jest.mock('@/lib/club', () => ({
  useClub: () => mockClub,
  useFeature: (key: keyof Features) => mockClub.features[key],
}));

function features(overrides: Partial<Features> = {}): Features {
  return {
    messages: true,
    calendar: true,
    checkIns: true,
    injuries: true,
    attendance: true,
    sessionPlans: true,
    surveys: true,
    captainPolls: true,
    awards: true,
    goals: true,
    integrity: true,
    kpis: true,
    ...overrides,
  };
}

const TEAM: Team = {
  id: 'team-a',
  name: 'Open A',
  sort_order: 1,
  kind: 'team',
  season: 2026,
  squad_id: null,
  selections_completed_at: null,
};
const OTHER_TEAM: Team = { ...TEAM, id: 'team-b', name: '17 & Under A' };
const DONE_SQUAD: Team = {
  ...TEAM,
  id: 'squad-done',
  kind: 'squad',
  selections_completed_at: '2026-09-01T00:00:00Z',
};

function member(team_role: TeamRole, team = TEAM): TeamMembership {
  return { team, team_role, coach_title: team_role === 'coach' ? 'head_coach' : null, selection: null };
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
    date_of_birth: '1990-05-01',
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

function auth(
  p: Profile | null,
  extra: {
    memberships?: TeamMembership[];
    captaincies?: GroupCaptain[];
    isClubCaptain?: boolean;
    isSafeguardingOfficer?: boolean;
  } = {},
): Auth {
  const roles = p ? [p.role, ...p.extra_roles] : [];
  return {
    loading: false,
    session: p ? ({ user: { id: p.id } } as Auth['session']) : null,
    profile: p,
    paused: null,
    exemption: null,
    memberships: extra.memberships ?? [],
    captaincies: extra.captaincies ?? [],
    isClubCaptain: extra.isClubCaptain ?? false,
    isAdmin: roles.includes('admin') && p?.status === 'approved',
    committeeChecksFrom: null,
    isSafeguardingOfficer: extra.isSafeguardingOfficer ?? false,
    refresh: jest.fn(),
    signOut: jest.fn(),
  };
}

const captainOf = (team: Team): GroupCaptain => ({
  team_id: team.id,
  profile_id: 'me',
  captain_role: 'captain',
});

type Key = keyof RouteAccess;
const KEYS: Key[] = [
  'readMessages',
  'sendMessages',
  'answerSurveys',
  'sendSurveys',
  'surveyResults',
  'injuries',
  'reportInjury',
  'logInjury',
  'attendance',
  'takeAttendance',
  'athleteAttendance',
  'familyAttendance',
  'readSessionPlans',
  'addSessionPlans',
  'checkIn',
  'checkIns',
  'athleteCheckIns',
  'awards',
  'gameGoals',
  'athleteGoals',
  'teamGoals',
  'kpis',
  'setKpis',
  'training',
  'checkTraining',
  'concerns',
  'family',
  'chooseCaptains',
];

/** Each member, and the screens they open: everything else is false. */
const CASES: [string, Auth, Key[]][] = [
  ['signed out', auth(null), []],
  ['waiting for approval as a coach', auth(profile('coach', { status: 'pending' }), { memberships: [member('coach')] }), []],
  ['turned down', auth(profile('guest', { status: 'rejected' })), []],
  ['a guest', auth(profile('guest')), []],
  ['a temporary helper', auth(profile('volunteer')), []],
  // AuthProvider shows a member whose every role is paused as a guest, with no groups.
  ['a coach whose check lapsed', auth(profile('guest', { wwcc_expires_on: '2026-10-01' })), []],
  [
    'an athlete',
    auth(profile('athlete'), { memberships: [member('athlete')] }),
    ['readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training'],
  ],
  [
    'a captain',
    auth(profile('athlete'), { memberships: [member('athlete')], captaincies: [captainOf(TEAM)] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training'],
  ],
  [
    'still listed as captain of a team they no longer play in',
    auth(profile('athlete'), { memberships: [member('athlete')], captaincies: [captainOf(OTHER_TEAM)] }),
    ['readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training'],
  ],
  [
    'a club captain',
    auth(profile('athlete'), { memberships: [member('athlete')], isClubCaptain: true }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training'],
  ],
  [
    'a guardian',
    auth(profile('guardian')),
    ['readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'athleteCheckIns', 'gameGoals', 'athleteGoals', 'kpis', 'training', 'family'],
  ],
  [
    'a coach',
    auth(profile('coach'), { memberships: [member('coach')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'athleteCheckIns', 'awards', 'gameGoals', 'athleteGoals', 'teamGoals', 'kpis', 'setKpis', 'training', 'chooseCaptains'],
  ],
  [
    'a coach of only a finished squad',
    auth(profile('coach'), { memberships: [member('coach', DONE_SQUAD)] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'awards', 'kpis', 'setKpis', 'training', 'chooseCaptains'],
  ],
  [
    'a manager',
    auth(profile('manager'), { memberships: [member('manager')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training'],
  ],
  [
    'a manager who is the Child Safety Officer',
    auth(profile('manager'), { memberships: [member('manager')], isSafeguardingOfficer: true }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training', 'concerns'],
  ],
  [
    'a physio',
    auth(profile('physio'), { memberships: [member('physio')] }),
    ['readMessages', 'answerSurveys', 'injuries', 'logInjury', 'checkIns', 'training'],
  ],
  [
    'a physio who is also a guardian',
    auth(profile('physio', { extra_roles: ['guardian'] })),
    ['readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'logInjury', 'familyAttendance', 'readSessionPlans', 'checkIns', 'athleteCheckIns', 'awards', 'gameGoals', 'athleteGoals', 'kpis', 'training', 'family'],
  ],
  ['a statistician', auth(profile('statistician')), ['readMessages', 'answerSurveys', 'awards', 'training']],
  [
    'the committee',
    auth(profile('committee')),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining'],
  ],
  [
    'an admin',
    auth(profile('admin')),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'awards', 'teamGoals', 'kpis', 'setKpis', 'training', 'checkTraining', 'concerns', 'family', 'chooseCaptains'],
  ],
  [
    'an athlete who coaches another team',
    auth(profile('athlete', { extra_roles: ['coach'] }), {
      memberships: [member('athlete'), member('coach', OTHER_TEAM)],
    }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'reportInjury', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'familyAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIn', 'checkIns', 'athleteCheckIns', 'awards', 'gameGoals', 'athleteGoals', 'teamGoals', 'kpis', 'setKpis', 'training', 'chooseCaptains'],
  ],
  // A role opens its screens before the member is placed in a squad or team.
  [
    'an athlete not yet in a team',
    auth(profile('athlete')),
    ['readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training'],
  ],
  [
    'a coach not yet in a team',
    auth(profile('coach')),
    ['readMessages', 'answerSurveys', 'attendance', 'takeAttendance', 'readSessionPlans', 'awards', 'kpis', 'training'],
  ],
  [
    'a manager not yet in a team',
    auth(profile('manager')),
    ['readMessages', 'answerSurveys', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training'],
  ],
  // And a place in a group opens that place's screens without the club role.
  [
    'a statistician placed in a team as an athlete',
    auth(profile('statistician'), { memberships: [member('athlete')] }),
    ['readMessages', 'answerSurveys', 'familyAttendance', 'readSessionPlans', 'awards', 'kpis', 'training'],
  ],
  [
    'a statistician placed in a team as a coach',
    auth(profile('statistician'), { memberships: [member('coach')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'athleteCheckIns', 'awards', 'gameGoals', 'athleteGoals', 'teamGoals', 'kpis', 'setKpis', 'training', 'chooseCaptains'],
  ],
  [
    'a statistician placed in a team as a manager',
    auth(profile('statistician'), { memberships: [member('manager')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training'],
  ],
];

describe.each(CASES)('%s', (_name, who, opens) => {
  beforeEach(() => {
    mockAuth = who;
    mockClub.features = features();
  });

  it.each(KEYS)('%s', (key) => {
    const { result } = renderHook(() => useRouteAccess());
    expect(result.current[key]).toBe(opens.includes(key));
  });
});

it('every case names real keys', () => {
  for (const [, , opens] of CASES) for (const key of opens) expect(KEYS).toContain(key);
  const { result } = renderHook(() => {
    mockAuth = auth(null);
    return useRouteAccess();
  });
  expect(Object.keys(result.current).sort()).toEqual([...KEYS].sort());
});

describe('feature switches', () => {
  it('Season KPIs off closes them for everyone', () => {
    mockAuth = auth(profile('admin'));
    mockClub.features = features({ kpis: false });
    const { result } = renderHook(() => useRouteAccess());
    expect(result.current.kpis).toBe(false);
    expect(result.current.setKpis).toBe(false);
  });

  it('captains’ polls off: a captain can’t send polls but keeps their polls’ results', () => {
    mockAuth = auth(profile('athlete'), {
      memberships: [member('athlete')],
      captaincies: [captainOf(TEAM)],
    });
    mockClub.features = features({ captainPolls: false });
    const { result } = renderHook(() => useRouteAccess());
    expect(result.current.sendSurveys).toBe(false);
    expect(result.current.surveyResults).toBe(true);
    expect(result.current.answerSurveys).toBe(true);
  });
});
