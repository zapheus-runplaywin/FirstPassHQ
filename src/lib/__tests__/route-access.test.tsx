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
    trainingLoad: true,
    injuries: true,
    attendance: true,
    sessionPlans: true,
    surveys: true,
    captainPolls: true,
    awards: true,
    liveStreams: true,
    goals: true,
    integrity: true,
    kpis: true,
    registers: true,
    selectionAssessments: true,
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
    committeeSeesInjuries?: boolean;
    exemption?: Auth['exemption'];
    wwccApplication?: Auth['wwccApplication'];
  } = {},
): Auth {
  const roles = p ? [p.role, ...p.extra_roles] : [];
  return {
    loading: false,
    session: p ? ({ user: { id: p.id } } as Auth['session']) : null,
    profile: p,
    paused: null,
    exemption: extra.exemption ?? null,
    wwccApplication: extra.wwccApplication ?? null,
    wwccSubmission: null,
    memberships: extra.memberships ?? [],
    captaincies: extra.captaincies ?? [],
    isClubCaptain: extra.isClubCaptain ?? false,
    isAdmin: roles.includes('admin') && p?.status === 'approved',
    committeeChecksFrom: null,
    statisticianChecksFrom: null,
    isSafeguardingOfficer: extra.isSafeguardingOfficer ?? false,
    safeguardingPosts: [],
    waitingForGuardian: null,
    isLocked: false,
    committeeSeesInjuries: extra.committeeSeesInjuries ?? true,
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
  'assessments',
  'selectionInfo',
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
  'trainingLoad',
  'awards',
  'gameGoals',
  'athleteGoals',
  'teamGoals',
  'kpis',
  'setKpis',
  'training',
  'checkTraining',
  'reports',
  'concerns',
  'family',
  'medical',
  'teamMedical',
  'chooseCaptains',
  'registers',
  'editRegisters',
  'reviewPolicy',
  'declareConflicts',
];

/** Each member, and the screens they open: everything else is false. */
const CASES: [string, Auth, Key[]][] = [
  ['signed out', auth(null), []],
  ['waiting for approval as a coach', auth(profile('coach', { status: 'pending' }), { memberships: [member('coach')] }), []],
  ['turned down', auth(profile('guest', { status: 'rejected' })), []],
  // A guest with a current check can be named an independent selector, so the
  // screen opens; it lists only the rounds whose panel they are on.
  ['a guest', auth(profile('guest')), ['assessments']],
  ['a guest with no check', auth(profile('guest', { wwcc_number: null, wwcc_expires_on: null })), []],
  [
    'a guest with no check and a volunteer exemption',
    auth(profile('guest', { wwcc_number: null, wwcc_expires_on: null }), { exemption: { valid: true } as Auth['exemption'] }),
    ['assessments'],
  ],
  [
    'a guest with no check and an application in force',
    auth(profile('guest', { wwcc_number: null, wwcc_expires_on: null }), { wwccApplication: { valid: true } as Auth['wwccApplication'] }),
    ['assessments'],
  ],
  ['a guest who is stood down', auth(profile('guest', { stood_down_at: '2026-10-01T00:00:00Z' })), []],
  ['a temporary helper', auth(profile('volunteer')), []],
  // AuthProvider shows a member whose every role is paused as a guest, with no groups.
  ['a coach whose check lapsed', auth(profile('guest', { wwcc_expires_on: '2026-10-01' })), []],
  [
    'an athlete',
    auth(profile('athlete'), { memberships: [member('athlete')] }),
    ['selectionInfo', 'readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training', 'medical'],
  ],
  [
    'a captain',
    auth(profile('athlete'), { memberships: [member('athlete')], captaincies: [captainOf(TEAM)] }),
    ['selectionInfo', 'readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training', 'medical'],
  ],
  [
    'still listed as captain of a team they no longer play in',
    auth(profile('athlete'), { memberships: [member('athlete')], captaincies: [captainOf(OTHER_TEAM)] }),
    ['selectionInfo', 'readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training', 'medical'],
  ],
  [
    'a club captain',
    auth(profile('athlete'), { memberships: [member('athlete')], isClubCaptain: true }),
    ['selectionInfo', 'readMessages', 'sendMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training', 'medical'],
  ],
  [
    'a guardian',
    auth(profile('guardian')),
    ['selectionInfo', 'readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'athleteCheckIns', 'gameGoals', 'athleteGoals', 'kpis', 'training', 'family', 'medical'],
  ],
  [
    'a coach',
    auth(profile('coach'), { memberships: [member('coach')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'athleteCheckIns', 'trainingLoad', 'awards', 'gameGoals', 'athleteGoals', 'teamGoals', 'kpis', 'setKpis', 'training', 'chooseCaptains', 'medical', 'teamMedical', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  [
    'a coach of only a finished squad',
    auth(profile('coach'), { memberships: [member('coach', DONE_SQUAD)] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'awards', 'kpis', 'setKpis', 'training', 'chooseCaptains', 'medical', 'teamMedical', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  [
    'a manager',
    auth(profile('manager'), { memberships: [member('manager')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training', 'medical', 'teamMedical', 'reviewPolicy'],
  ],
  [
    'a manager who is the Child Safety Officer',
    auth(profile('manager'), { memberships: [member('manager')], isSafeguardingOfficer: true }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training', 'concerns', 'medical', 'teamMedical', 'reviewPolicy'],
  ],
  [
    'a physio',
    auth(profile('physio'), { memberships: [member('physio')] }),
    ['readMessages', 'answerSurveys', 'injuries', 'logInjury', 'checkIns', 'training', 'medical', 'teamMedical', 'reviewPolicy'],
  ],
  [
    'a physio who is also a guardian',
    auth(profile('physio', { extra_roles: ['guardian'] })),
    ['selectionInfo', 'readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'logInjury', 'familyAttendance', 'readSessionPlans', 'checkIns', 'athleteCheckIns', 'awards', 'gameGoals', 'athleteGoals', 'kpis', 'training', 'family', 'medical', 'reviewPolicy'],
  ],
  ['a statistician', auth(profile('statistician')), ['readMessages', 'answerSurveys', 'awards', 'training', 'reviewPolicy']],
  [
    'the committee',
    auth(profile('committee')),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'reports', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  // The reports name children: a committee member reads them only when
  // screened to work with children (customer review C14).
  [
    'the committee, exempted with a reason',
    auth(profile('committee', { wwcc_number: null, wwcc_expires_on: null, wwcc_exempt_reason: 'Treasurer' })),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'the committee, before the committee checks date without a check',
    auth(profile('committee', { wwcc_number: null, wwcc_expires_on: null })),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'the committee, with a volunteer exemption',
    auth(profile('committee', { wwcc_number: null, wwcc_expires_on: null }), {
      exemption: { valid: true } as Auth['exemption'],
    }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'reports', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'the committee, with an ended volunteer exemption',
    auth(profile('committee', { wwcc_number: null, wwcc_expires_on: null }), {
      exemption: { valid: false } as Auth['exemption'],
    }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'the committee, with an application in force',
    auth(profile('committee', { wwcc_number: null, wwcc_expires_on: null }), {
      wwccApplication: { valid: true } as Auth['wwccApplication'],
    }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'reports', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'the committee, with a lapsed application',
    auth(profile('committee', { wwcc_number: null, wwcc_expires_on: null }), {
      wwccApplication: { valid: false } as Auth['wwccApplication'],
    }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  // A club can choose which committee members see injuries (customer review R7).
  [
    'the committee, left out of the members who see injuries',
    auth(profile('committee'), { committeeSeesInjuries: false }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'attendance', 'takeAttendance', 'athleteAttendance', 'checkIns', 'awards', 'kpis', 'setKpis', 'training', 'checkTraining', 'reports', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'the committee, left out of the members who see injuries, who is also a guardian',
    auth(profile('committee', { extra_roles: ['guardian'] }), { committeeSeesInjuries: false }),
    ['selectionInfo', 'readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'reportInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'familyAttendance', 'readSessionPlans', 'checkIns', 'athleteCheckIns', 'awards', 'gameGoals', 'athleteGoals', 'kpis', 'setKpis', 'training', 'checkTraining', 'family', 'medical', 'reports', 'registers', 'reviewPolicy', 'declareConflicts'],
  ],
  [
    'an admin on the committee, left out of the members who see injuries',
    auth(profile('admin', { extra_roles: ['committee'] }), { committeeSeesInjuries: false }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'awards', 'teamGoals', 'kpis', 'setKpis', 'training', 'checkTraining', 'reports', 'concerns', 'family', 'chooseCaptains', 'registers', 'editRegisters', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  [
    'a coach with a check who is not on the committee',
    auth(profile('coach'), { exemption: { valid: true } as Auth['exemption'] }),
    ['readMessages', 'answerSurveys', 'attendance', 'takeAttendance', 'readSessionPlans', 'awards', 'kpis', 'training', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  [
    'an admin',
    auth(profile('admin')),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'awards', 'teamGoals', 'kpis', 'setKpis', 'training', 'checkTraining', 'reports', 'concerns', 'family', 'chooseCaptains', 'registers', 'editRegisters', 'reviewPolicy', 'assessments'],
  ],
  [
    'an athlete who coaches another team',
    auth(profile('athlete', { extra_roles: ['coach'] }), {
      memberships: [member('athlete'), member('coach', OTHER_TEAM)],
    }),
    ['selectionInfo', 'readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'reportInjury', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'familyAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIn', 'checkIns', 'athleteCheckIns', 'trainingLoad', 'awards', 'gameGoals', 'athleteGoals', 'teamGoals', 'kpis', 'setKpis', 'training', 'chooseCaptains', 'medical', 'teamMedical', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  // A role opens its screens before the member is placed in a squad or team.
  [
    'an athlete not yet in a team',
    auth(profile('athlete')),
    ['selectionInfo', 'readMessages', 'answerSurveys', 'injuries', 'reportInjury', 'familyAttendance', 'readSessionPlans', 'checkIn', 'awards', 'gameGoals', 'kpis', 'training', 'medical'],
  ],
  [
    'a coach not yet in a team',
    auth(profile('coach')),
    ['readMessages', 'answerSurveys', 'attendance', 'takeAttendance', 'readSessionPlans', 'awards', 'kpis', 'training', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  [
    'a manager not yet in a team',
    auth(profile('manager')),
    ['readMessages', 'answerSurveys', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training', 'reviewPolicy'],
  ],
  // And a place in a group opens that place's screens without the club role.
  [
    'a statistician placed in a team as an athlete',
    auth(profile('statistician'), { memberships: [member('athlete')] }),
    ['selectionInfo', 'readMessages', 'answerSurveys', 'familyAttendance', 'readSessionPlans', 'awards', 'kpis', 'training', 'medical', 'reviewPolicy'],
  ],
  [
    'a statistician placed in a team as a coach',
    auth(profile('statistician'), { memberships: [member('coach')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'athleteAttendance', 'readSessionPlans', 'addSessionPlans', 'checkIns', 'athleteCheckIns', 'trainingLoad', 'awards', 'gameGoals', 'athleteGoals', 'teamGoals', 'kpis', 'setKpis', 'training', 'chooseCaptains', 'medical', 'teamMedical', 'reviewPolicy', 'declareConflicts', 'assessments'],
  ],
  [
    'a statistician placed in a team as a manager',
    auth(profile('statistician'), { memberships: [member('manager')] }),
    ['readMessages', 'sendMessages', 'answerSurveys', 'sendSurveys', 'surveyResults', 'injuries', 'logInjury', 'attendance', 'takeAttendance', 'awards', 'kpis', 'training', 'medical', 'teamMedical', 'reviewPolicy'],
  ],
];

describe.each(CASES)('%s', (_name, who, opens) => {
  beforeEach(() => {
    mockAuth = who;
    mockClub.features = features();
  });

  it.each(KEYS)('%s', async (key) => {
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current[key]).toBe(opens.includes(key));
  });
});

it('every case names real keys', async () => {
  for (const [, , opens] of CASES) for (const key of opens) expect(KEYS).toContain(key);
  const { result } = await renderHook(() => {
    mockAuth = auth(null);
    return useRouteAccess();
  });
  expect(Object.keys(result.current).sort()).toEqual([...KEYS, 'open', 'join'].sort());
});

describe('a child waiting for a parent or guardian', () => {
  const linkCode = { waiting: true, code: '7KQ4MD', expires_at: null, parents_waiting: [] };
  // AuthProvider shows a locked child as waiting for approval, with no groups.
  const locked: Auth = {
    ...auth(profile('athlete', { status: 'pending' })),
    waitingForGuardian: linkCode,
    isLocked: true,
  };
  const asking: Auth = { ...locked, isLocked: false };

  test.each([
    ['everyone else', auth(profile('athlete'), { memberships: [member('athlete')] }), true, true],
    ['someone waiting for approval', auth(profile('athlete', { status: 'pending' })), true, true],
    ['signed out', auth(null), true, true],
    ['a child asking to join', asking, false, true],
    ['a locked child', locked, false, false],
  ])('%s: open %s, join %s', async (_name, who, open, join) => {
    mockAuth = who;
    mockClub.features = features();
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current.open).toBe(open);
    expect(result.current.join).toBe(join);
  });

  it('opens nothing else for a locked child', async () => {
    mockAuth = locked;
    mockClub.features = features();
    const { result } = await renderHook(() => useRouteAccess());
    for (const key of KEYS) expect(result.current[key]).toBe(false);
  });
});

describe('feature switches', () => {
  it('Season KPIs off closes them for everyone', async () => {
    mockAuth = auth(profile('admin'));
    mockClub.features = features({ kpis: false });
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current.kpis).toBe(false);
    expect(result.current.setKpis).toBe(false);
  });

  it.each<[string, Auth]>([
    ['an admin', auth(profile('admin'))],
    ['the committee', auth(profile('committee'))],
    ['a coach', auth(profile('coach'), { memberships: [member('coach')] })],
  ])('Policy and conflict registers off closes them for %s', async (_name, who) => {
    mockAuth = who;
    mockClub.features = features({ registers: false });
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current.registers).toBe(false);
    expect(result.current.editRegisters).toBe(false);
    expect(result.current.reviewPolicy).toBe(false);
    expect(result.current.declareConflicts).toBe(false);
  });

  it.each<[string, Auth]>([
    ['an admin', auth(profile('admin'))],
    ['a coach', auth(profile('coach'), { memberships: [member('coach')] })],
    ['a guest', auth(profile('guest'))],
  ])('Selection assessments off closes them for %s', async (_name, who) => {
    mockAuth = who;
    mockClub.features = features({ selectionAssessments: false });
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current.assessments).toBe(false);
  });

  it.each<[string, Auth]>([
    ['an athlete', auth(profile('athlete'), { memberships: [member('athlete')] })],
    ['a guardian', auth(profile('guardian'))],
  ])('Selection assessments off closes the criteria and dates for %s', async (_name, who) => {
    mockAuth = who;
    mockClub.features = features();
    const on = await renderHook(() => useRouteAccess());
    expect(on.result.current.selectionInfo).toBe(true);
    mockClub.features = features({ selectionAssessments: false });
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current.selectionInfo).toBe(false);
  });

  it('captains’ polls off: a captain can’t send polls but keeps their polls’ results', async () => {
    mockAuth = auth(profile('athlete'), {
      memberships: [member('athlete')],
      captaincies: [captainOf(TEAM)],
    });
    mockClub.features = features({ captainPolls: false });
    const { result } = await renderHook(() => useRouteAccess());
    expect(result.current.sendSurveys).toBe(false);
    expect(result.current.surveyResults).toBe(true);
    expect(result.current.answerSurveys).toBe(true);
  });
});
