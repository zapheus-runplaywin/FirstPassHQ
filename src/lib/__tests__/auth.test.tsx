/**
 * AuthProvider: what it works out from the signed-in member's rows. Roles a
 * lapsed check or a stand-down pauses are taken out of `profile` and
 * `memberships`, so every role hook (role-access.test.tsx) sees only the
 * roles a member can use right now. Same rule as `public.has_role`.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { AuthProvider, PROFILE_COLUMNS, useAuth } from '@/lib/auth';
import { useCanSeeCheckInOverview, useIsCheckInCoach } from '@/lib/check-ins';
import { useClubChoice } from '@/lib/club-choice';
import { useCanSeeInjuries } from '@/lib/injuries';
import { unregisterForPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  GroupCaptain,
  MyVolunteerExemption,
  MyWwccApplication,
  MyWwccSubmission,
  Profile,
  Team,
  TeamMembership,
  TeamRole,
} from '@/lib/types';

jest.mock('@/lib/club-choice', () => ({ useClubChoice: jest.fn() }));
jest.mock('@/lib/push', () => ({ unregisterForPush: jest.fn() }));

// ---------------------------------------------------------------------------
// The member's rows, as the club's database returns them
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
const TEAM_B: Team = { ...TEAM_A, id: 'team-b', name: '17 & Under A', squad_id: 'squad-17u' };

function member(team: Team, team_role: TeamRole): TeamMembership {
  return {
    team,
    team_role,
    coach_title: team_role === 'coach' ? 'head_coach' : null,
    selection: null,
  };
}

// Today is Sunday 18 October 2026, local time.
const CURRENT = '2029-01-01';
/** Within the 60 days' warning, which still counts as current. */
const EXPIRING = '2026-11-30';
const YESTERDAY = '2026-10-17';
const TODAY = '2026-10-18';

function profile(role: AppRole, overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
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
    wwcc_expires_on: CURRENT,
    wwcc_exempt_reason: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    rejection_reason: null,
    verified_at: '2026-01-01T00:00:00Z',
    stood_down_at: null,
    ...overrides,
  };
}

function application(overrides: Partial<MyWwccApplication> = {}): MyWwccApplication {
  return {
    id: 'application-1',
    application_number: 'APL 123',
    lodged_on: '2026-10-10',
    kind: 'new',
    declaration_text: 'I applied for a Working With Children Check.',
    declared_at: '2026-10-11T00:00:00Z',
    lapses_on: '2027-01-08',
    status: 'in_force',
    valid: true,
    ...overrides,
  };
}

function submission(): MyWwccSubmission {
  return {
    id: 'submission-1',
    card_number: 'WWC1234',
    expires_on: '2028-10-10',
    card_name: 'Casey Coach',
    submitted_at: '2026-10-17T00:00:00Z',
    status: 'waiting',
    decided_at: null,
    return_note: null,
  };
}

function exemption(overrides: Partial<MyVolunteerExemption> = {}): MyVolunteerExemption {
  return {
    basis: 'parent_volunteer',
    child_name: 'Alex Sample',
    declared_at: '2026-09-01T00:00:00Z',
    declaration_text: 'I am a parent volunteer.',
    valid: true,
    ends_on: '2027-09-01',
    starts_on: null,
    event_name: null,
    organiser: null,
    ...overrides,
  };
}

type Rows = {
  profile: Profile | null;
  memberships?: TeamMembership[];
  captaincies?: GroupCaptain[];
  isClubCaptain?: unknown;
  exemption?: MyVolunteerExemption | null;
  application?: MyWwccApplication | null;
  submission?: MyWwccSubmission | null;
  isSafeguardingOfficer?: unknown;
  safeguardingPosts?: unknown;
  committeeSeesInjuries?: unknown;
  committeeChecksFrom?: unknown;
  linkCode?: unknown;
  statisticianChecksFrom?: unknown;
};

let rows: Rows;
let sessionUserId: string | null;
let authListener: ((event: string, session: { user: { id: string } } | null) => void) | null;
const unsubscribe = jest.fn();

function session(userId: string) {
  return { user: { id: userId } };
}

/** A Supabase query that resolves with this result, however it's chained. */
function query(result: { data: unknown; error?: null }): unknown {
  const q: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ error: null, ...result }).then(resolve, reject),
  };
  for (const method of ['select', 'eq', 'single', 'maybeSingle']) q[method] = jest.fn(() => q);
  return q;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 18, 12) });
  rows = { profile: null };
  sessionUserId = 'user-1';
  authListener = null;
  unsubscribe.mockReset();

  jest.mocked(useClubChoice).mockReturnValue({
    ready: true,
    club: { code: 'thunder' } as ReturnType<typeof useClubChoice>['club'],
    recent: [],
    choose: jest.fn(),
    switchClub: jest.fn(),
  });
  jest.mocked(unregisterForPush).mockReset().mockResolvedValue(undefined);

  Object.assign(supabase.auth, {
    getSession: jest.fn(async () => ({
      data: { session: sessionUserId ? session(sessionUserId) : null },
    })),
    onAuthStateChange: jest.fn((callback: NonNullable<typeof authListener>) => {
      authListener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
    signOut: jest.fn(async () => ({ error: null })),
  });

  jest.mocked(supabase.from).mockReset().mockImplementation(((table: string) => {
    if (table === 'profiles') return query({ data: rows.profile });
    if (table === 'team_members') return query({ data: rows.memberships ?? [] });
    if (table === 'team_captains') return query({ data: rows.captaincies ?? [] });
    throw new Error(`Unexpected table ${table}`);
  }) as never);

  jest.mocked(supabase.rpc).mockReset().mockImplementation(((fn: string) => {
    if (fn === 'is_club_captain') return query({ data: rows.isClubCaptain ?? false });
    if (fn === 'my_volunteer_exemption') return query({ data: rows.exemption ?? null });
    if (fn === 'my_wwcc_application') return query({ data: rows.application ?? null });
    if (fn === 'my_wwcc_submission') return query({ data: rows.submission ?? null });
    if (fn === 'is_safeguarding_officer') return query({ data: rows.isSafeguardingOfficer ?? false });
    if (fn === 'my_safeguarding_posts') return query({ data: rows.safeguardingPosts ?? null });
    if (fn === 'my_committee_sees_injuries') return query({ data: rows.committeeSeesInjuries ?? true });
    if (fn === 'committee_checks_from') return query({ data: rows.committeeChecksFrom ?? null });
    if (fn === 'my_link_code') return query({ data: rows.linkCode ?? null });
    if (fn === 'statistician_checks_from') return query({ data: rows.statisticianChecksFrom ?? null });
    throw new Error(`Unexpected function ${fn}`);
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Signs in as a member with these rows and waits until AuthProvider has loaded them. */
async function signIn<T = ReturnType<typeof useAuth>>(
  given: Rows,
  hook: () => T = useAuth as unknown as () => T,
) {
  rows = given;
  const view = await renderHook(() => ({ auth: useAuth(), value: hook() }), { wrapper });
  await waitFor(() => expect(view.result.current.auth.loading).toBe(false));
  return view;
}

async function authFor(given: Rows) {
  return (await signIn(given)).result.current.auth;
}

// ---------------------------------------------------------------------------
// Loading the member
// ---------------------------------------------------------------------------

describe('loading the member', () => {
  it('can’t be used outside AuthProvider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renderHook(() => useAuth())).rejects.toThrow('useAuth must be used inside AuthProvider');
    jest.mocked(console.error).mockRestore();
  });

  it('signs nobody in until a club is picked', async () => {
    jest.mocked(useClubChoice).mockReturnValue({
      ready: true,
      club: null,
      recent: [],
      choose: jest.fn(),
      switchClub: jest.fn(),
    });
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('signs the member in once a club is picked, and listens again after a switch', async () => {
    const choice = (code: string | null) => ({
      ready: true,
      club: (code ? { code } : null) as ReturnType<typeof useClubChoice>['club'],
      recent: [],
      choose: jest.fn(),
      switchClub: jest.fn(),
    });
    rows = { profile: profile('athlete') };
    jest.mocked(useClubChoice).mockReturnValue(choice(null));
    const { result, rerender } = await renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    expect(supabase.auth.getSession).not.toHaveBeenCalled();

    jest.mocked(useClubChoice).mockReturnValue(choice('thunder'));
    await rerender({});
    await waitFor(() => expect(result.current.profile?.role).toBe('athlete'));
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    jest.mocked(useClubChoice).mockReturnValue(choice('warriors'));
    await rerender({});
    await act(async () => {});
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(2);
  });

  it('is empty when signed out, without asking for any member', async () => {
    sessionUserId = null;
    const auth = await authFor({ profile: profile('admin') });
    expect(auth.session).toBeNull();
    expect(auth.profile).toBeNull();
    expect(auth.memberships).toEqual([]);
    expect(auth.captaincies).toEqual([]);
    expect(auth.paused).toBeNull();
    expect(auth.isAdmin).toBe(false);
    expect(auth.isClubCaptain).toBe(false);
    expect(auth.isSafeguardingOfficer).toBe(false);
    expect(auth.safeguardingPosts).toEqual([]);
    expect(auth.committeeSeesInjuries).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('loads the signed-in member’s profile, current squads and teams, and captaincies', async () => {
    const captaincies: GroupCaptain[] = [
      { team_id: TEAM_A.id, profile_id: 'user-1', captain_role: 'vice_captain' },
    ];
    const auth = await authFor({
      profile: profile('athlete'),
      memberships: [member(TEAM_A, 'athlete')],
      captaincies,
    });
    expect(auth.session?.user.id).toBe('user-1');
    expect(auth.profile).toEqual(profile('athlete'));
    expect(auth.memberships).toEqual([member(TEAM_A, 'athlete')]);
    expect(auth.captaincies).toEqual(captaincies);

    const profiles = jest.mocked(supabase.from).mock.results[0].value as Record<string, jest.Mock>;
    expect(profiles.select).toHaveBeenCalledWith(PROFILE_COLUMNS);
    expect(profiles.eq).toHaveBeenCalledWith('id', 'user-1');
    // Past seasons are left out.
    const teamMembers = jest.mocked(supabase.from).mock.results[1].value as Record<string, jest.Mock>;
    expect(teamMembers.eq).toHaveBeenCalledWith('profile_id', 'user-1');
    expect(teamMembers.eq).toHaveBeenCalledWith('team.archived', false);
  });

  it('loads the safeguarding posts the member holds', async () => {
    const auth = await authFor({
      profile: profile('statistician'),
      safeguardingPosts: {
        child_safety_officer: true,
        complaints_manager: false,
        wwc_registration_officer: true,
      },
    });
    expect(auth.safeguardingPosts).toEqual(['child_safety_officer', 'wwc_registration_officer']);
    expect(supabase.rpc).toHaveBeenCalledWith('my_safeguarding_posts');
  });

  it('holds no safeguarding posts when the club has none set', async () => {
    const auth = await authFor({ profile: profile('coach'), safeguardingPosts: null });
    expect(auth.safeguardingPosts).toEqual([]);
  });

  it('shows no member, groups or safeguarding contacts while loading', async () => {
    rows = {
      profile: profile('coach'),
      memberships: [member(TEAM_A, 'coach')],
      isClubCaptain: true,
      isSafeguardingOfficer: true,
      safeguardingPosts: { child_safety_officer: true },
      committeeSeesInjuries: false,
      exemption: exemption(),
      committeeChecksFrom: '2027-01-11',
    };
    // The session waits until the loading state has been checked: render now
    // finishes every update it can before handing back.
    const getSession = supabase.auth.getSession as jest.Mock;
    const signedIn = getSession.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    getSession.mockImplementationOnce(async () => {
      await held;
      return signedIn();
    });
    const { result } = await renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);
    // The club's default, the whole committee, until the member loads.
    expect(result.current.committeeSeesInjuries).toBe(true);
    expect(result.current.profile).toBeNull();
    expect(result.current.memberships).toEqual([]);
    expect(result.current.captaincies).toEqual([]);
    expect(result.current.isClubCaptain).toBe(false);
    expect(result.current.isSafeguardingOfficer).toBe(false);
    expect(result.current.safeguardingPosts).toEqual([]);
    expect(result.current.exemption).toBeNull();
    expect(result.current.committeeChecksFrom).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('asks for the member’s team places with their teams, and their captaincies', async () => {
    await authFor({ profile: profile('athlete') });
    const teamMembers = jest.mocked(supabase.from).mock.results[1].value as Record<string, jest.Mock>;
    expect(teamMembers.select).toHaveBeenCalledWith(
      expect.stringMatching(/^team_role, coach_title, selection, team:teams!inner \(.*\bid\b.*\)$/),
    );
    const captains = jest.mocked(supabase.from).mock.results[2].value as Record<string, jest.Mock>;
    expect(jest.mocked(supabase.from).mock.calls[2][0]).toBe('team_captains');
    expect(captains.select).toHaveBeenCalledWith('team_id, profile_id, captain_role');
    expect(captains.eq).toHaveBeenCalledWith('profile_id', 'user-1');
  });

  it('copes with no rows coming back', async () => {
    rows = { profile: null };
    jest.mocked(supabase.from).mockImplementation(() => query({ data: null }) as never);
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.memberships).toEqual([]);
    expect(result.current.captaincies).toEqual([]);
    expect(result.current.isAdmin).toBe(false);
  });

  it('loads the new member when someone else signs in, and clears them on sign out', async () => {
    const { result } = await signIn({ profile: profile('admin') });
    expect(result.current.auth.isAdmin).toBe(true);

    rows = { profile: profile('athlete', { id: 'user-2' }), memberships: [member(TEAM_A, 'athlete')] };
    await act(async () => {
      authListener?.('SIGNED_IN', session('user-2'));
      jest.runAllTimers();
    });
    await waitFor(() => expect(result.current.auth.profile?.id).toBe('user-2'));
    expect(result.current.auth.session?.user.id).toBe('user-2');
    expect(result.current.auth.isAdmin).toBe(false);
    expect(result.current.auth.memberships).toEqual([member(TEAM_A, 'athlete')]);

    await act(async () => {
      authListener?.('SIGNED_OUT', null);
      jest.runAllTimers();
    });
    await waitFor(() => expect(result.current.auth.profile).toBeNull());
    expect(result.current.auth.session).toBeNull();
    expect(result.current.auth.memberships).toEqual([]);
    expect(result.current.auth.isAdmin).toBe(false);
  });

  it('forgets the last member’s exemption, application and the club’s committee date on sign out', async () => {
    const { result } = await signIn({
      profile: profile('coach'),
      isClubCaptain: true,
      isSafeguardingOfficer: true,
      safeguardingPosts: { complaints_manager: true },
      committeeSeesInjuries: false,
      exemption: exemption(),
      application: application(),
      submission: submission(),
      committeeChecksFrom: '2027-01-11',
    });
    expect(result.current.auth.committeeSeesInjuries).toBe(false);
    expect(result.current.auth.exemption).toEqual(exemption());
    expect(result.current.auth.wwccApplication).toEqual(application());
    expect(result.current.auth.wwccSubmission).toEqual(submission());
    expect(result.current.auth.committeeChecksFrom).toBe('2027-01-11');
    expect(result.current.auth.safeguardingPosts).toEqual(['complaints_manager']);

    await act(async () => {
      authListener?.('SIGNED_OUT', null);
      jest.runAllTimers();
    });
    await waitFor(() => expect(result.current.auth.profile).toBeNull());
    expect(result.current.auth.exemption).toBeNull();
    expect(result.current.auth.wwccApplication).toBeNull();
    expect(result.current.auth.wwccSubmission).toBeNull();
    expect(result.current.auth.committeeChecksFrom).toBeNull();
    expect(result.current.auth.isClubCaptain).toBe(false);
    expect(result.current.auth.isSafeguardingOfficer).toBe(false);
    expect(result.current.auth.safeguardingPosts).toEqual([]);
    expect(result.current.auth.committeeSeesInjuries).toBe(true);
  });

  it('refreshes to nobody when signed out', async () => {
    sessionUserId = null;
    const { result } = await signIn({ profile: profile('admin') });
    await act(async () => {
      await result.current.auth.refresh();
    });
    expect(result.current.auth.profile).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('stops listening for sign-ins when it unmounts', async () => {
    const { unmount } = await signIn({ profile: profile('coach') });
    await unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('reloads the member on refresh, so a role change shows straight away', async () => {
    const { result } = await signIn({ profile: profile('athlete') });
    expect(result.current.auth.isAdmin).toBe(false);
    rows = { profile: profile('admin') };
    await act(async () => {
      await result.current.auth.refresh();
    });
    expect(result.current.auth.isAdmin).toBe(true);
  });

  it('turns push notifications off before signing out, even if that fails', async () => {
    const { result } = await signIn({ profile: profile('admin') });
    jest.mocked(unregisterForPush).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.auth.signOut();
    });
    expect(unregisterForPush).toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isAdmin
// ---------------------------------------------------------------------------

describe('isAdmin', () => {
  test.each([
    ['an approved admin', true, profile('admin')],
    ['an approved member with admin as another role', true, profile('coach', { extra_roles: ['admin'] })],
    ['an admin waiting for approval', false, profile('admin', { status: 'pending' })],
    ['a turned-down admin', false, profile('admin', { status: 'rejected' })],
    ['an admin whose check has expired', true, profile('admin', { wwcc_expires_on: YESTERDAY })],
    ['an admin with no check recorded', true, profile('admin', { wwcc_number: null, wwcc_expires_on: null })],
    ['a stood-down admin', false, profile('admin', { stood_down_at: '2026-10-10T00:00:00Z' })],
    [
      'a stood-down member with admin as another role',
      false,
      profile('guardian', { extra_roles: ['admin'], stood_down_at: '2026-10-10T00:00:00Z' }),
    ],
    ['the committee', false, profile('committee')],
    ['a coach', false, profile('coach')],
    ['a guest', false, profile('guest')],
    ['a temporary helper', false, profile('volunteer')],
  ] as const)('%s → %s', async (_who, expected, given) => {
    const auth = await authFor({ profile: given });
    expect(auth.isAdmin).toBe(expected);
  });

  it('isn’t given to anyone through a team place', async () => {
    const auth = await authFor({
      profile: profile('athlete'),
      memberships: [member(TEAM_A, 'coach'), member(TEAM_B, 'manager')],
    });
    expect(auth.isAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Paused roles
// ---------------------------------------------------------------------------

describe('roles paused by the Working With Children Check', () => {
  test.each([
    ['coach', 'coach'],
    ['manager', 'manager'],
    ['physio', 'physio'],
  ] as const)('pauses a %s whose check expired, with their team places', async (role, teamRole) => {
    const auth = await authFor({
      profile: profile(role, { wwcc_expires_on: YESTERDAY }),
      memberships: [member(TEAM_A, teamRole)],
    });
    // Left with no role they can use, they show as a guest.
    expect(auth.profile?.role).toBe('guest');
    expect(auth.profile?.extra_roles).toEqual([]);
    expect(auth.memberships).toEqual([]);
    expect(auth.paused).toEqual({
      roles: [role],
      stoodDown: false,
      exemption: null,
      application: null,
    });
  });

  test.each([
    ['no check recorded', { wwcc_number: null, wwcc_expires_on: null }],
    ['a check with no expiry date', { wwcc_expires_on: null }],
    ['a blank check number', { wwcc_number: '   ' }],
  ] as const)('pauses a coach with %s', async (_what, overrides) => {
    const auth = await authFor({
      profile: profile('coach', overrides),
      memberships: [member(TEAM_A, 'coach')],
    });
    expect(auth.paused?.roles).toEqual(['coach']);
    expect(auth.memberships).toEqual([]);
  });

  test.each([
    ['a current check', CURRENT],
    ['a check expiring soon', EXPIRING],
    ['a check that expires today', TODAY],
  ])('keeps a coach with %s', async (_what, expires) => {
    const auth = await authFor({
      profile: profile('coach', { wwcc_expires_on: expires }),
      memberships: [member(TEAM_A, 'coach')],
    });
    expect(auth.profile?.role).toBe('coach');
    expect(auth.memberships).toEqual([member(TEAM_A, 'coach')]);
    expect(auth.paused).toBeNull();
  });

  it('pauses a coach the day after the check expires', async () => {
    jest.setSystemTime(new Date(2026, 9, 19, 9));
    const auth = await authFor({
      profile: profile('coach', { wwcc_expires_on: TODAY }),
      memberships: [member(TEAM_A, 'coach')],
    });
    expect(auth.paused?.roles).toEqual(['coach']);
  });

  it('keeps a coach with no check whose volunteer exemption applies', async () => {
    const auth = await authFor({
      profile: profile('coach', { wwcc_number: null, wwcc_expires_on: null }),
      memberships: [member(TEAM_A, 'coach')],
      exemption: exemption(),
    });
    expect(auth.profile?.role).toBe('coach');
    expect(auth.memberships).toEqual([member(TEAM_A, 'coach')]);
    expect(auth.paused).toBeNull();
    expect(auth.exemption).toEqual(exemption());
  });

  it('pauses a coach whose exemption no longer applies, and says which exemption', async () => {
    const ended = exemption({ valid: false });
    const auth = await authFor({
      profile: profile('coach', { wwcc_number: null, wwcc_expires_on: null }),
      memberships: [member(TEAM_A, 'coach')],
      exemption: ended,
    });
    expect(auth.memberships).toEqual([]);
    expect(auth.paused).toEqual({
      roles: ['coach'],
      stoodDown: false,
      exemption: ended,
      application: null,
    });
  });

  it('pauses a coach whose exemption is still waiting for the declaration', async () => {
    const auth = await authFor({
      profile: profile('coach', { wwcc_number: null, wwcc_expires_on: null }),
      memberships: [member(TEAM_A, 'coach')],
      exemption: exemption({ declared_at: null, valid: false }),
    });
    expect(auth.paused?.roles).toEqual(['coach']);
  });

  test.each(['coach', 'manager', 'physio'] as const)(
    'keeps a %s with no check whose lodged application is in force',
    async (role) => {
      const auth = await authFor({
        profile: profile(role, { wwcc_number: null, wwcc_expires_on: null }),
        memberships: [member(TEAM_A, role)],
        application: application(),
      });
      expect(auth.profile?.role).toBe(role);
      expect(auth.memberships).toEqual([member(TEAM_A, role)]);
      expect(auth.paused).toBeNull();
      expect(auth.wwccApplication).toEqual(application());
    },
  );

  it('keeps a coach whose check expired while their renewal is assessed', async () => {
    const auth = await authFor({
      profile: profile('coach', { wwcc_expires_on: YESTERDAY }),
      application: application({ kind: 'renewal' }),
    });
    expect(auth.paused).toBeNull();
  });

  test.each([
    ['still waiting for the declaration', { declared_at: null, status: 'waiting_for_declaration', valid: false }],
    ['lapsed', { status: 'lapsed', valid: false }],
    ['stopped by a notice', { status: 'stopped', valid: false }],
  ] as const)('pauses a coach whose application is %s, and says why', async (_what, overrides) => {
    const open = application(overrides);
    const auth = await authFor({
      profile: profile('coach', { wwcc_number: null, wwcc_expires_on: null }),
      memberships: [member(TEAM_A, 'coach')],
      application: open,
    });
    expect(auth.memberships).toEqual([]);
    expect(auth.paused).toEqual({
      roles: ['coach'],
      stoodDown: false,
      exemption: null,
      application: open,
    });
  });

  it('keeps the other roles of a coach who is also a guardian, and the guardian’s team place', async () => {
    const auth = await authFor({
      profile: profile('coach', { extra_roles: ['guardian'], wwcc_expires_on: YESTERDAY }),
      memberships: [member(TEAM_A, 'coach'), member(TEAM_B, 'guardian')],
    });
    expect(auth.profile?.role).toBe('guardian');
    expect(auth.profile?.extra_roles).toEqual([]);
    expect(auth.memberships).toEqual([member(TEAM_B, 'guardian')]);
    expect(auth.paused?.roles).toEqual(['coach']);
  });

  it('keeps an athlete who coaches playing, but stops their coaching', async () => {
    const auth = await authFor({
      profile: profile('athlete', { extra_roles: ['coach'], wwcc_expires_on: YESTERDAY }),
      memberships: [member(TEAM_A, 'athlete'), member(TEAM_B, 'coach')],
    });
    expect(auth.profile?.role).toBe('athlete');
    expect(auth.memberships).toEqual([member(TEAM_A, 'athlete')]);
    expect(auth.paused?.roles).toEqual(['coach']);
  });

  it('keeps an admin who coaches an admin, without their coaching', async () => {
    const auth = await authFor({
      profile: profile('coach', { extra_roles: ['admin', 'guardian'], wwcc_expires_on: YESTERDAY }),
      memberships: [member(TEAM_A, 'coach'), member(TEAM_B, 'guardian')],
    });
    expect(auth.profile?.role).toBe('admin');
    expect(auth.profile?.extra_roles).toEqual(['guardian']);
    expect(auth.memberships).toEqual([member(TEAM_B, 'guardian')]);
    expect(auth.isAdmin).toBe(true);
    expect(auth.paused?.roles).toEqual(['coach']);
  });

  it('pauses every role that needs a check at once', async () => {
    const auth = await authFor({
      profile: profile('coach', { extra_roles: ['manager', 'physio'], wwcc_expires_on: YESTERDAY }),
      memberships: [member(TEAM_A, 'coach'), member(TEAM_B, 'manager'), member(TEAM_B, 'physio')],
    });
    expect(auth.paused?.roles).toEqual(['coach', 'manager', 'physio']);
    expect(auth.profile?.role).toBe('guest');
    expect(auth.memberships).toEqual([]);
  });

  test.each(['athlete', 'guardian', 'guest'] as const)(
    'never pauses a %s for having no check',
    async (role) => {
      const auth = await authFor({
        profile: profile(role, { wwcc_number: null, wwcc_expires_on: null }),
        memberships: role === 'guest' ? [] : [member(TEAM_A, role)],
      });
      expect(auth.profile?.role).toBe(role);
      expect(auth.paused).toBeNull();
    },
  );

  it('never pauses a temporary helper for their check: admins screen them before approval', async () => {
    const auth = await authFor({
      profile: profile('volunteer', { wwcc_number: null, wwcc_expires_on: null }),
    });
    expect(auth.profile?.role).toBe('volunteer');
    expect(auth.paused).toBeNull();
  });

  it('doesn’t pause a member who isn’t approved yet: nothing works for them anyway', async () => {
    const auth = await authFor({
      profile: profile('coach', { status: 'pending', wwcc_expires_on: YESTERDAY }),
      memberships: [member(TEAM_A, 'coach')],
    });
    expect(auth.paused).toBeNull();
    expect(auth.profile?.status).toBe('pending');
  });
});

describe('committee checks', () => {
  const noCheck = { wwcc_number: null, wwcc_expires_on: null };

  it('keeps a committee member with no check before the club’s committee checks date', async () => {
    const auth = await authFor({
      profile: profile('committee', noCheck),
      committeeChecksFrom: '2027-01-11',
    });
    expect(auth.profile?.role).toBe('committee');
    expect(auth.paused).toBeNull();
    expect(auth.committeeChecksFrom).toBe('2027-01-11');
  });

  it('keeps a committee member with no check when the club has no committee checks date', async () => {
    const auth = await authFor({ profile: profile('committee', noCheck) });
    expect(auth.paused).toBeNull();
    expect(auth.committeeChecksFrom).toBeNull();
  });

  test.each([
    ['on the day', TODAY],
    ['after it', '2026-09-01'],
  ])('pauses a committee member with no check %s', async (_when, from) => {
    const auth = await authFor({ profile: profile('committee', noCheck), committeeChecksFrom: from });
    expect(auth.profile?.role).toBe('guest');
    expect(auth.paused).toEqual({
      roles: ['committee'],
      stoodDown: false,
      exemption: null,
      application: null,
    });
  });

  it('keeps a committee member with no check after the date while their application is in force', async () => {
    const auth = await authFor({
      profile: profile('committee', noCheck),
      committeeChecksFrom: '2026-09-01',
      application: application(),
    });
    expect(auth.profile?.role).toBe('committee');
    expect(auth.paused).toBeNull();
  });

  it('keeps a committee member whose recorded check expired while their renewal is assessed', async () => {
    const auth = await authFor({
      profile: profile('committee', { wwcc_expires_on: YESTERDAY }),
      application: application({ kind: 'renewal' }),
    });
    expect(auth.paused).toBeNull();
  });

  it('pauses a committee member after the date whose application lapsed', async () => {
    const auth = await authFor({
      profile: profile('committee', noCheck),
      committeeChecksFrom: '2026-09-01',
      application: application({ status: 'lapsed', valid: false }),
    });
    expect(auth.paused?.roles).toEqual(['committee']);
  });

  it('keeps an exempt committee member with no check after the date', async () => {
    const auth = await authFor({
      profile: profile('committee', { ...noCheck, wwcc_exempt_reason: 'Board member only' }),
      committeeChecksFrom: '2026-09-01',
    });
    expect(auth.paused).toBeNull();
  });

  it('pauses a committee member whose recorded check expired, even before the date', async () => {
    const auth = await authFor({
      profile: profile('committee', { wwcc_expires_on: YESTERDAY }),
      committeeChecksFrom: '2027-01-11',
    });
    expect(auth.paused?.roles).toEqual(['committee']);
  });

  it('keeps a committee member with a current check after the date', async () => {
    const auth = await authFor({
      profile: profile('committee'),
      committeeChecksFrom: '2026-09-01',
    });
    expect(auth.paused).toBeNull();
  });

  it('leaves an admin on the committee an admin when the committee role pauses', async () => {
    const auth = await authFor({
      profile: profile('admin', { ...noCheck, extra_roles: ['committee'] }),
      committeeChecksFrom: '2026-09-01',
    });
    expect(auth.profile?.role).toBe('admin');
    expect(auth.profile?.extra_roles).toEqual([]);
    expect(auth.isAdmin).toBe(true);
    expect(auth.paused?.roles).toEqual(['committee']);
  });

  test.each([42, true, ''])('ignores a committee checks date that isn’t a date string: %j', async (value) => {
    const auth = await authFor({ profile: profile('committee'), committeeChecksFrom: value });
    expect(auth.committeeChecksFrom).toBe(typeof value === 'string' ? value : null);
  });
});

describe('statistician checks', () => {
  const noCheck = { wwcc_number: null, wwcc_expires_on: null };

  it('keeps a statistician with no check before the club’s statistician checks date', async () => {
    const auth = await authFor({
      profile: profile('statistician', noCheck),
      statisticianChecksFrom: '2027-01-21',
    });
    expect(auth.profile?.role).toBe('statistician');
    expect(auth.paused).toBeNull();
    expect(auth.statisticianChecksFrom).toBe('2027-01-21');
  });

  it('keeps a statistician with no check when the club has no statistician checks date', async () => {
    const auth = await authFor({ profile: profile('statistician', noCheck) });
    expect(auth.paused).toBeNull();
    expect(auth.statisticianChecksFrom).toBeNull();
  });

  test.each([
    ['on the day', TODAY],
    ['after it', '2026-09-01'],
  ])('pauses a statistician with no check %s', async (_when, from) => {
    const auth = await authFor({
      profile: profile('statistician', noCheck),
      statisticianChecksFrom: from,
    });
    expect(auth.profile?.role).toBe('guest');
    expect(auth.paused).toEqual({
      roles: ['statistician'],
      stoodDown: false,
      exemption: null,
      application: null,
    });
  });

  it('uses the statistician date, not the committee date', async () => {
    const auth = await authFor({
      profile: profile('statistician', noCheck),
      committeeChecksFrom: '2026-09-01',
      statisticianChecksFrom: '2027-01-21',
    });
    expect(auth.paused).toBeNull();
  });

  it('pauses a statistician whose recorded check expired, even before the date', async () => {
    const auth = await authFor({
      profile: profile('statistician', { wwcc_expires_on: YESTERDAY }),
      statisticianChecksFrom: '2027-01-21',
    });
    expect(auth.paused?.roles).toEqual(['statistician']);
  });

  it('keeps an exempt statistician with no check after the date', async () => {
    const auth = await authFor({
      profile: profile('statistician', { ...noCheck, wwcc_exempt_reason: 'Opens games only' }),
      statisticianChecksFrom: '2026-09-01',
    });
    expect(auth.paused).toBeNull();
  });

  it('keeps a statistician with a current check after the date', async () => {
    const auth = await authFor({
      profile: profile('statistician'),
      statisticianChecksFrom: '2026-09-01',
    });
    expect(auth.paused).toBeNull();
  });

  it('keeps a statistician after the date while their application is in force', async () => {
    const auth = await authFor({
      profile: profile('statistician', noCheck),
      statisticianChecksFrom: '2026-09-01',
      application: application(),
    });
    expect(auth.paused).toBeNull();
  });

  it('keeps a parent statistician after the date with a volunteer exemption that applies', async () => {
    const auth = await authFor({
      profile: profile('statistician', noCheck),
      statisticianChecksFrom: '2026-09-01',
      exemption: exemption(),
    });
    expect(auth.paused).toBeNull();
  });

  it('pauses a statistician after the date whose exemption no longer applies', async () => {
    const auth = await authFor({
      profile: profile('statistician', noCheck),
      statisticianChecksFrom: '2026-09-01',
      exemption: exemption({ valid: false }),
    });
    expect(auth.paused?.roles).toEqual(['statistician']);
  });

  it('leaves an athlete an athlete when their statistician role pauses', async () => {
    const auth = await authFor({
      profile: profile('athlete', { ...noCheck, extra_roles: ['statistician'] }),
      statisticianChecksFrom: '2026-09-01',
    });
    expect(auth.profile?.role).toBe('athlete');
    expect(auth.profile?.extra_roles).toEqual([]);
    expect(auth.paused?.roles).toEqual(['statistician']);
  });

  test.each([42, true, ''])(
    'ignores a statistician checks date that isn’t a date string: %j',
    async (value) => {
      const auth = await authFor({ profile: profile('statistician'), statisticianChecksFrom: value });
      expect(auth.statisticianChecksFrom).toBe(typeof value === 'string' ? value : null);
    },
  );
});

describe('stand-downs', () => {
  const stoodDown = { stood_down_at: '2026-10-10T00:00:00Z' };

  test.each(['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer', 'statistician'] as const)(
    'pause the %s role, whatever the check says',
    async (role) => {
      const auth = await authFor({ profile: profile(role, stoodDown) });
      expect(auth.profile?.role).toBe('guest');
      expect(auth.paused).toEqual({
      roles: [role],
      stoodDown: true,
      exemption: null,
      application: null,
    });
      expect(auth.isAdmin).toBe(false);
    },
  );

  it('pause a coach even with a volunteer exemption', async () => {
    const auth = await authFor({
      profile: profile('coach', { ...stoodDown, wwcc_number: null, wwcc_expires_on: null }),
      memberships: [member(TEAM_A, 'coach')],
      exemption: exemption(),
    });
    expect(auth.memberships).toEqual([]);
    expect(auth.paused?.stoodDown).toBe(true);
  });

  it('pause an exempt committee member', async () => {
    const auth = await authFor({
      profile: profile('committee', { ...stoodDown, wwcc_exempt_reason: 'Board member only' }),
    });
    expect(auth.paused?.roles).toEqual(['committee']);
  });

  it('keep the roles that aren’t child-related work, and their team places', async () => {
    const auth = await authFor({
      profile: profile('admin', { ...stoodDown, extra_roles: ['coach', 'committee', 'guardian'] }),
      memberships: [member(TEAM_A, 'coach'), member(TEAM_B, 'guardian')],
    });
    expect(auth.profile?.role).toBe('guardian');
    expect(auth.profile?.extra_roles).toEqual([]);
    expect(auth.memberships).toEqual([member(TEAM_B, 'guardian')]);
    expect(auth.isAdmin).toBe(false);
    expect(auth.paused).toEqual({
      roles: ['admin', 'coach', 'committee'],
      stoodDown: true,
      exemption: null,
      application: null,
    });
  });

  it('leave a stood-down athlete playing', async () => {
    const auth = await authFor({
      profile: profile('athlete', stoodDown),
      memberships: [member(TEAM_A, 'athlete')],
    });
    expect(auth.profile?.role).toBe('athlete');
    expect(auth.memberships).toEqual([member(TEAM_A, 'athlete')]);
    expect(auth.paused).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Club captains and safeguarding contacts
// ---------------------------------------------------------------------------

describe('club captains and safeguarding contacts', () => {
  test.each([
    [true, true],
    [false, false],
    [null, false],
    ['true', false],
    [1, false],
  ])('isSafeguardingOfficer when the database says %j → %s', async (value, expected) => {
    const auth = await authFor({ profile: profile('committee'), isSafeguardingOfficer: value });
    expect(auth.isSafeguardingOfficer).toBe(expected);
  });

  test.each([
    [true, true],
    [false, false],
    [null, false],
    ['true', false],
  ])('isClubCaptain when the database says %j → %s', async (value, expected) => {
    const auth = await authFor({ profile: profile('athlete'), isClubCaptain: value });
    expect(auth.isClubCaptain).toBe(expected);
  });

  // The club's choice of committee members who see injuries (customer review
  // R7): only a plain false leaves the member out, so a failed call keeps the
  // screen and the database still decides what's in it.
  test.each([
    [true, true],
    [false, false],
    [null, true],
    ['false', true],
    [0, true],
  ])('committeeSeesInjuries when the database says %j → %s', async (value, expected) => {
    const auth = await authFor({ profile: profile('committee'), committeeSeesInjuries: value });
    expect(auth.committeeSeesInjuries).toBe(expected);
  });

  it('asks the database whether the committee member sees injuries', async () => {
    await authFor({ profile: profile('committee') });
    expect(supabase.rpc).toHaveBeenCalledWith('my_committee_sees_injuries');
  });

  it('isn’t a safeguarding officer when signed out', async () => {
    sessionUserId = null;
    const auth = await authFor({ profile: profile('committee'), isSafeguardingOfficer: true });
    expect(auth.isSafeguardingOfficer).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// From the database rows to the role hooks
// ---------------------------------------------------------------------------

describe('role hooks see only the roles a member can use', () => {
  const useAccess = () => ({
    takeAttendance: useCanTakeAttendance(),
    viewAttendance: useCanViewAttendance(),
    checkInCoach: useIsCheckInCoach(),
    checkInOverview: useCanSeeCheckInOverview(),
    injuries: useCanSeeInjuries(),
  });

  it('gives a coach with a current check their coaching', async () => {
    const { result } = await signIn(
      { profile: profile('coach'), memberships: [member(TEAM_A, 'coach')] },
      useAccess,
    );
    expect(result.current.value).toEqual({
      takeAttendance: true,
      viewAttendance: true,
      checkInCoach: true,
      checkInOverview: false,
      injuries: true,
    });
  });

  it('gives a coach whose check expired nothing', async () => {
    const { result } = await signIn(
      { profile: profile('coach', { wwcc_expires_on: YESTERDAY }), memberships: [member(TEAM_A, 'coach')] },
      useAccess,
    );
    expect(result.current.value).toEqual({
      takeAttendance: false,
      viewAttendance: false,
      checkInCoach: false,
      checkInOverview: false,
      injuries: false,
    });
  });

  it('leaves a lapsed coach who is a guardian only the guardian’s injuries screen', async () => {
    const { result } = await signIn(
      {
        profile: profile('coach', { extra_roles: ['guardian'], wwcc_expires_on: YESTERDAY }),
        memberships: [member(TEAM_A, 'coach'), member(TEAM_B, 'guardian')],
      },
      useAccess,
    );
    expect(result.current.value).toEqual({
      takeAttendance: false,
      viewAttendance: false,
      checkInCoach: false,
      checkInOverview: false,
      injuries: true,
    });
  });

  it('gives a stood-down admin nothing an admin has', async () => {
    const { result } = await signIn(
      { profile: profile('admin', { stood_down_at: '2026-10-10T00:00:00Z' }) },
      useAccess,
    );
    expect(result.current.value).toEqual({
      takeAttendance: false,
      viewAttendance: false,
      checkInCoach: false,
      checkInOverview: false,
      injuries: false,
    });
  });

  it('gives an admin with an expired check their admin access, but not a lapsed coach’s', async () => {
    const { result } = await signIn(
      {
        profile: profile('admin', { extra_roles: ['coach'], wwcc_expires_on: YESTERDAY }),
        memberships: [member(TEAM_A, 'coach')],
      },
      useAccess,
    );
    expect(result.current.value).toEqual({
      takeAttendance: true,
      viewAttendance: true,
      checkInCoach: false,
      checkInOverview: true,
      injuries: true,
    });
  });

  it('gives a member waiting for approval nothing', async () => {
    const { result } = await signIn(
      { profile: profile('admin', { status: 'pending' }), memberships: [member(TEAM_A, 'coach')] },
      useAccess,
    );
    expect(result.current.value).toEqual({
      takeAttendance: false,
      viewAttendance: false,
      checkInCoach: false,
      checkInOverview: false,
      injuries: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Children waiting for a parent or guardian (public.my_link_code)
// ---------------------------------------------------------------------------

describe('a child waiting for a parent or guardian', () => {
  const child = (overrides: Partial<Profile> = {}) =>
    profile('athlete', { date_of_birth: '2012-03-04', wwcc_number: null, ...overrides });
  const waiting = {
    waiting: true,
    code: '7KQ4MD',
    expires_at: '2026-10-25T12:00:00Z',
    parents_waiting: [],
  };

  it('asks for the member’s link code with the rest of their rows', async () => {
    await authFor({ profile: profile('athlete') });
    expect(supabase.rpc).toHaveBeenCalledWith('my_link_code');
  });

  it('shows an approved child with no verified parent as waiting, with no squads or teams, and locked', async () => {
    const auth = await authFor({
      profile: child(),
      memberships: [member(TEAM_A, 'athlete')],
      linkCode: waiting,
    });
    expect(auth.waitingForGuardian).toEqual(waiting);
    expect(auth.isLocked).toBe(true);
    expect(auth.profile?.status).toBe('pending');
    expect(auth.profile?.full_name).toBe('Sam Sample');
    expect(auth.memberships).toEqual([]);
    expect(auth.paused).toBeNull();
    expect(auth.isAdmin).toBe(false);
  });

  it('shows a child asking to join as waiting, but not locked: they aren’t approved yet', async () => {
    const auth = await authFor({ profile: child({ status: 'pending' }), linkCode: waiting });
    expect(auth.waitingForGuardian).toEqual(waiting);
    expect(auth.isLocked).toBe(false);
    expect(auth.profile?.status).toBe('pending');
  });

  test.each([
    ['no link code row', null],
    ['a row saying they aren’t waiting', { waiting: false, code: null, expires_at: null, parents_waiting: [] }],
  ])('leaves a member with %s approved, with their places', async (_, linkCode) => {
    const auth = await authFor({
      profile: child(),
      memberships: [member(TEAM_A, 'athlete')],
      linkCode,
    });
    expect(auth.waitingForGuardian).toBeNull();
    expect(auth.isLocked).toBe(false);
    expect(auth.profile?.status).toBe('approved');
    expect(auth.memberships).toEqual([member(TEAM_A, 'athlete')]);
  });

  it('gives a locked child nothing a squad place would give', async () => {
    const { result } = await signIn(
      { profile: child(), memberships: [member(TEAM_A, 'athlete')], linkCode: waiting },
      () => ({ injuries: useCanSeeInjuries(), checkInCoach: useIsCheckInCoach() }),
    );
    expect(result.current.value).toEqual({ injuries: false, checkInCoach: false });
  });

  it('forgets the link code on sign out', async () => {
    const { result } = await signIn({ profile: child(), linkCode: waiting });
    expect(result.current.auth.waitingForGuardian).not.toBeNull();
    await act(async () => {
      authListener?.('SIGNED_OUT', null);
      jest.runAllTimers();
    });
    await waitFor(() => expect(result.current.auth.waitingForGuardian).toBeNull());
    expect(result.current.auth.isLocked).toBe(false);
  });
});
