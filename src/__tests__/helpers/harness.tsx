/**
 * Shared set-up for the screen-level role tests: sample members (personas), a
 * fake Supabase backend behind the client that jest.setup.ts mocks, and a
 * club whose feature switches each test sets.
 *
 * The real AuthProvider runs on top of the fake backend, so paused and
 * stood-down roles and `isAdmin` are worked out by the app's own code, not
 * by the test. Only the club choice (which needs the build's env) and the
 * club's settings provider (which reads AsyncStorage) are replaced.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks its
 * own fixtures at the bottom, and only when Jest runs it directly.
 */
import type { Session } from '@supabase/supabase-js';
import type { ComponentType, ReactNode } from 'react';
import type { TestInstance } from 'test-renderer';
import { Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { roleCombinationProblem } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  GroupCaptain,
  MyVolunteerExemption,
  MyWwccApplication,
  Profile,
  TeamMembership,
  TeamRole,
} from '@/lib/types';

/** Every test runs on this day (CI runs in UTC). */
export const TODAY = new Date('2026-10-18T02:00:00Z');

// ---------------------------------------------------------------------------
// Sample members

export type PersonaName =
  | 'signedOut'
  | 'pending'
  | 'rejected'
  | 'athlete'
  | 'guardian'
  | 'guest'
  | 'volunteer'
  | 'coach'
  | 'manager'
  | 'physio'
  | 'committee'
  | 'admin'
  | 'stoodDownAdmin'
  | 'pendingAdmin'
  | 'adminExpiredCheck'
  | 'coachExpiredCheck'
  | 'stoodDownCoach'
  // More kinds of member, for the route tests (docs/testing-strategy.md).
  | 'minorAthlete'
  | 'captain'
  | 'clubCaptain'
  | 'guardianOfAdult'
  | 'assistantCoach'
  | 'doneSquadCoach'
  | 'headPhysio'
  | 'statistician'
  | 'safeguardingOfficer'
  | 'committeeExpiredCheck'
  | 'committeePastChecksDate'
  | 'committeeBeforeChecksDate'
  | 'committeeExempt'
  | 'committeeVolunteerExempt'
  | 'committeeNotChosen'
  | 'statisticianPastChecksDate'
  | 'statisticianBeforeChecksDate'
  | 'adminLapsedCheck'
  | 'physioExpiredCheck'
  | 'stoodDownAthlete'
  | 'coachGuardian'
  | 'athleteCoach'
  | 'adminGuardian'
  | 'adminLapsedCoach';

export type Persona = {
  session: Session | null;
  profile: Profile | null;
  memberships: TeamMembership[];
  captaincies?: GroupCaptain[];
  isClubCaptain?: boolean;
  isSafeguardingOfficer?: boolean;
  exemption?: MyVolunteerExemption | null;
  /** Their lodged Working With Children Check application, if an admin recorded one. */
  wwccApplication?: MyWwccApplication | null;
  /** Extra RPC results this member's backend returns. */
  rpcs?: Record<string, unknown>;
};

export const TEAM = {
  id: 'team-open-a',
  name: 'Open A',
  sort_order: 1,
  kind: 'team' as const,
  season: 2026,
  squad_id: null,
  selections_completed_at: null,
};

/** A second team, for members who play in one group and coach another. */
export const TEAM_B = {
  ...TEAM,
  id: 'team-17u-a',
  name: '17 & Under A',
  sort_order: 2,
};

/** A squad whose squad phase an admin has marked complete. */
export const DONE_SQUAD = {
  ...TEAM,
  id: 'squad-done',
  name: 'Mixed Open Squad',
  sort_order: 3,
  kind: 'squad' as const,
  selections_completed_at: '2026-09-01T00:00:00Z',
};

function membership(team_role: TeamRole, team: TeamMembership['team'] = TEAM): TeamMembership {
  return {
    team_role,
    coach_title: team_role === 'coach' ? 'head_coach' : null,
    selection: team_role === 'athlete' ? 'touring' : null,
    team,
  };
}

function profile(id: string, role: AppRole, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    email: `${id}@example.test`,
    full_name: `Sample ${id}`,
    preferred_name: null,
    title: null,
    head_physio: false,
    playhq_email: null,
    role,
    extra_roles: [],
    status: 'approved',
    requested_role: null,
    requested_team_id: null,
    join_requested_at: '2026-01-10T00:00:00Z',
    under_17: false,
    rejection_reason: null,
    verified_at: '2026-01-11T00:00:00Z',
    date_of_birth: '1990-05-05',
    declared_date_of_birth: null,
    guardian_email: null,
    // A current check, so no role pauses unless a persona says so.
    wwcc_number: '1234567A',
    wwcc_expires_on: '2029-06-30',
    wwcc_exempt_reason: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    stood_down_at: null,
    ...extra,
  };
}

function sessionFor(id: string): Session {
  return {
    access_token: 'test-token',
    refresh_token: 'test-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id,
      email: `${id}@example.test`,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-10T00:00:00Z',
    },
  } as Session;
}

function member(id: string, role: AppRole, extra: Partial<Profile> = {}, memberships: TeamRole[] = []) {
  return {
    session: sessionFor(id),
    profile: profile(id, role, extra),
    memberships: memberships.map((r) => membership(r)),
  };
}

export const CHILD_CONSENTS = [
  {
    athlete_id: 'child-1',
    full_name: 'Sample Child',
    data: false,
    health: false,
    can_consent: true,
  },
];

export const personas: Record<PersonaName, Persona> = {
  signedOut: { session: null, profile: null, memberships: [] },
  pending: {
    ...member('pending', 'guest', {
      status: 'pending',
      requested_role: 'athlete',
      verified_at: null,
    }),
    rpcs: { my_verification_code: '123456' },
  },
  rejected: {
    ...member('rejected', 'guest', { status: 'rejected', rejection_reason: 'not_registered' }),
    rpcs: { my_verification_code: '123456' },
  },
  athlete: member('athlete', 'athlete', { wwcc_number: null, wwcc_expires_on: null }, ['athlete']),
  guardian: {
    ...member('guardian', 'guardian', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: { my_child_consents: CHILD_CONSENTS },
  },
  guest: member('guest', 'guest', { wwcc_number: null, wwcc_expires_on: null }),
  volunteer: member('volunteer', 'volunteer', {
    volunteer_task: 'Carnival canteen',
    volunteer_from: '2026-10-01',
    volunteer_until: '2026-10-31',
  }),
  coach: member('coach', 'coach', {}, ['coach']),
  manager: member('manager', 'manager', {}, ['manager']),
  physio: member('physio', 'physio', {}, ['physio']),
  committee: member('committee', 'committee'),
  admin: member('admin', 'admin'),
  stoodDownAdmin: member('stood-down-admin', 'admin', { stood_down_at: '2026-10-01T00:00:00Z' }),
  // Admin is only usable once approved.
  pendingAdmin: member('pending-admin', 'admin', { status: 'pending' }),
  // An expired check never pauses the admin role, so the club is never locked out.
  adminExpiredCheck: member('admin-expired', 'admin', { wwcc_expires_on: '2025-01-01' }),
  coachExpiredCheck: member('coach-expired', 'coach', { wwcc_expires_on: '2025-01-01' }, ['coach']),
  stoodDownCoach: member('stood-down-coach', 'coach', { stood_down_at: '2026-10-01T00:00:00Z' }, [
    'coach',
  ]),

  minorAthlete: member(
    'minor-athlete',
    'athlete',
    { date_of_birth: '2011-03-02', under_17: true, wwcc_number: null, wwcc_expires_on: null },
    ['athlete'],
  ),
  /** Captain of the team they play in: sends messages and polls to it. */
  captain: {
    ...member('captain', 'athlete', { wwcc_number: null, wwcc_expires_on: null }, ['athlete']),
    captaincies: [{ team_id: TEAM.id, profile_id: 'captain', captain_role: 'captain' }],
  },
  /** Messages the whole club. */
  clubCaptain: {
    ...member('club-captain', 'athlete', { wwcc_number: null, wwcc_expires_on: null }, ['athlete']),
    isClubCaptain: true,
  },
  /** Their only child has turned 18: still a guardian, with no child's cards on Home. */
  guardianOfAdult: {
    ...member('guardian-of-adult', 'guardian', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: { my_child_consents: [] },
  },
  assistantCoach: {
    ...member('assistant-coach', 'coach'),
    memberships: [{ ...membership('coach'), coach_title: 'assistant_coach' }],
  },
  /** Coaches only a squad whose squad phase is complete. */
  doneSquadCoach: {
    ...member('done-squad-coach', 'coach'),
    memberships: [membership('coach', DONE_SQUAD)],
  },
  /** Looks after every athlete, in no squad or team. */
  headPhysio: member('head-physio', 'physio', { head_physio: true }),
  statistician: member('statistician', 'statistician', { wwcc_number: null, wwcc_expires_on: null }),
  /** A manager named the club's Child Safety Officer. */
  safeguardingOfficer: {
    ...member('safeguarding-officer', 'manager', {}, ['manager']),
    isSafeguardingOfficer: true,
  },
  /** A recorded check that has expired pauses the committee role. */
  committeeExpiredCheck: member('committee-expired', 'committee', { wwcc_expires_on: '2025-01-01' }),
  /** No check, and the club's committee checks date has passed. */
  committeePastChecksDate: {
    ...member('committee-no-check', 'committee', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: { committee_checks_from: '2026-10-01' },
  },
  /** No check yet, before the club's committee checks date. */
  committeeBeforeChecksDate: {
    ...member('committee-due', 'committee', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: { committee_checks_from: '2099-01-21' },
  },
  /** Exempted from a check with a reason (a treasurer who never works with children). */
  committeeExempt: member('committee-exempt', 'committee', {
    wwcc_number: null,
    wwcc_expires_on: null,
    wwcc_exempt_reason: 'Treasurer, no contact with children',
  }),
  /** No check of their own, cleared by a parent volunteer exemption, before the committee checks date. */
  committeeVolunteerExempt: {
    ...member('committee-parent', 'committee', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: {
      committee_checks_from: '2099-01-21',
      my_volunteer_exemption: {
        basis: 'parent_volunteer',
        child_name: 'Sample Child',
        declared_at: '2026-09-01T00:00:00Z',
        declaration_text: 'Declared',
        valid: true,
        ends_on: null,
        starts_on: null,
      },
    },
  },
  /**
   * Checked, but the club chose which committee members see injuries and left
   * this one out (customer review R7).
   */
  committeeNotChosen: {
    ...member('committee-not-chosen', 'committee'),
    rpcs: { my_committee_sees_injuries: false },
  },
  /** No check, and the club's statistician checks date has passed. */
  statisticianPastChecksDate: {
    ...member('statistician-no-check', 'statistician', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: { statistician_checks_from: '2026-10-01' },
  },
  /** No check yet, before the club's statistician checks date. */
  statisticianBeforeChecksDate: {
    ...member('statistician-due', 'statistician', { wwcc_number: null, wwcc_expires_on: null }),
    rpcs: { statistician_checks_from: '2099-01-21' },
  },
  /** An admin whose check lapsed over 30 days ago: no under 18s' injuries. */
  adminLapsedCheck: {
    ...member('admin-lapsed', 'admin', { wwcc_expires_on: '2025-01-01' }),
    rpcs: { my_admin_sees_children_injuries: false },
  },
  physioExpiredCheck: member('physio-expired', 'physio', { wwcc_expires_on: '2025-01-01' }, ['physio']),
  stoodDownAthlete: member(
    'stood-down-athlete',
    'athlete',
    { wwcc_number: null, wwcc_expires_on: null, stood_down_at: '2026-10-01T00:00:00Z' },
    ['athlete'],
  ),
  /** Coaches Open A and is a parent of a child under 18. */
  coachGuardian: {
    ...member('coach-guardian', 'coach', { extra_roles: ['guardian'] }, ['coach']),
    rpcs: { my_child_consents: CHILD_CONSENTS },
  },
  /** Plays in Open A and coaches 17 & Under A. */
  athleteCoach: {
    ...member('athlete-coach', 'athlete', { extra_roles: ['coach'] }),
    memberships: [membership('athlete'), membership('coach', TEAM_B)],
  },
  adminGuardian: {
    ...member('admin-guardian', 'admin', { extra_roles: ['guardian'] }),
    rpcs: { my_child_consents: CHILD_CONSENTS },
  },
  /** An admin who also coaches, with an expired check: admin stays, coaching pauses. */
  adminLapsedCoach: member(
    'admin-lapsed-coach',
    'admin',
    { extra_roles: ['coach'], wwcc_expires_on: '2025-01-01' },
    ['coach'],
  ),
};

/**
 * More kinds of member, for screen tests. Kept apart from `personas`, which
 * the route tests sweep.
 */
export const morePersonas = {
  /** An athlete under 18 (born 2010), with no check. */
  under18Athlete: member(
    'u18-athlete',
    'athlete',
    { wwcc_number: null, wwcc_expires_on: null, date_of_birth: '2010-03-03' },
    ['athlete'],
  ),
  assistantCoach: {
    ...member('assistant-coach', 'coach'),
    memberships: [{ ...membership('coach'), coach_title: 'assistant_coach' as const }],
  },
  headPhysio: member('head-physio', 'physio', { head_physio: true }, ['physio']),
  coachGuardian: member('coach-guardian', 'coach', { extra_roles: ['guardian'] }, ['coach']),
  adminGuardian: member('admin-guardian', 'admin', { extra_roles: ['guardian'] }),
  /** An adult athlete in Open A who also coaches the Under 12s. */
  athleteCoach: {
    ...member('athlete-coach', 'athlete', { extra_roles: ['coach'] }, ['athlete']),
    memberships: [
      membership('athlete'),
      { ...membership('coach'), team: { ...TEAM, id: 'team-u12', name: 'Under 12' } },
    ],
  },
  /** A committee member whose recorded check has lapsed. */
  committeeExpiredCheck: member('committee-expired', 'committee', {
    wwcc_expires_on: '2025-01-01',
  }),
} satisfies Record<string, Persona>;

// ---------------------------------------------------------------------------
// The fake backend

type Backend = {
  session: Session | null;
  tables: Record<string, unknown[]>;
  rpcs: Record<string, unknown>;
};

let backend: Backend = { session: null, tables: {}, rpcs: {} };

type Result = {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
  status: number;
};

/** One call made while building a query, such as `eq('id', 'x')`. */
export type QueryCall = { method: string; args: unknown[] };

/** What a handler is told about the query it answers. */
export type QueryInfo = {
  /** The table, or the RPC's name. */
  name: string;
  calls: QueryCall[];
  /** The value of the query's `.eq(column, value)` filter, if it has one. */
  eq(column: string): unknown;
};

/** Rows for one query on a table; return undefined to use the seeded rows. */
export type TableHandler = (q: QueryInfo) => unknown;
/** An RPC's result from its arguments (and any filters chained on it). */
export type RpcHandler = (args: Record<string, unknown>, q: QueryInfo) => unknown;

/** Optional extras for a test's backend. */
export type BackendOptions = {
  /** More RPC results, on top of the persona's. */
  rpcs?: Record<string, unknown>;
  /** RPC results worked out from the call's arguments. */
  rpcHandlers?: Record<string, RpcHandler>;
  /** RPCs that fail with this message, as the database refusing them. */
  rpcErrors?: Record<string, string>;
  /** Rows worked out from the query's filters, asked before the seeded rows. */
  tableHandlers?: Record<string, TableHandler>;
};

/**
 * A query builder like supabase-js's: every filter returns the builder, and
 * awaiting it (or .single() / .maybeSingle()) gives the canned rows. Filters
 * are ignored unless a handler reads them; each test only seeds what its
 * member would see.
 */
function query(
  name: string,
  resolve: (q: QueryInfo) => unknown,
  error: string | null = null,
): unknown {
  const calls: QueryCall[] = [];
  const info: QueryInfo = {
    name,
    calls,
    eq: (column) => calls.find((c) => c.method === 'eq' && c.args[0] === column)?.args[1],
  };
  const result = (): Result => {
    if (error) return { data: null, error: { message: error }, count: null, status: 400 };
    const data = resolve(info);
    return { data, error: null, count: Array.isArray(data) ? data.length : 0, status: 200 };
  };
  const one = () => {
    const r = result();
    return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data });
  };
  const builder: object = new Proxy(function builder() {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (ok?: (r: Result) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(ok, fail);
      }
      if (prop === 'single' || prop === 'maybeSingle') return one;
      if (typeof prop === 'symbol') return undefined;
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return builder;
      };
    },
  });
  return builder;
}

type MockedClient = {
  rpc: jest.Mock;
  from: jest.Mock;
  auth: Record<string, unknown>;
  storage: { from: jest.Mock };
  functions?: unknown;
};

/**
 * Points the mocked Supabase client at a backend that holds this member, plus
 * any other tables' rows a test seeds.
 */
export function signInAs(
  persona: Persona,
  tables: Record<string, unknown[]> = {},
  options: BackendOptions = {},
) {
  const p = persona.profile;
  backend = {
    session: persona.session,
    tables: {
      ...tables,
      profiles: p ? [p] : [],
      team_members: persona.memberships,
      team_captains: persona.captaincies ?? [],
    },
    rpcs: {
      is_club_captain: persona.isClubCaptain ?? false,
      my_volunteer_exemption: persona.exemption ?? null,
      my_wwcc_application: persona.wwccApplication ?? null,
      is_safeguarding_officer: persona.isSafeguardingOfficer ?? false,
      committee_checks_from: null,
      statistician_checks_from: null,
      my_admin_sees_children_injuries: true,
      ...persona.rpcs,
      ...options.rpcs,
    },
  };
  const { tableHandlers = {}, rpcHandlers = {}, rpcErrors = {} } = options;
  const client = supabase as unknown as MockedClient;
  client.from.mockImplementation((table: string) =>
    query(table, (q) => {
      const handled = tableHandlers[table]?.(q);
      return handled !== undefined ? handled : (backend.tables[table] ?? []);
    }),
  );
  client.rpc.mockImplementation((name: string, args: Record<string, unknown> = {}) =>
    query(
      name,
      (q) => {
        if (rpcHandlers[name]) return rpcHandlers[name](args, q);
        return name in backend.rpcs ? backend.rpcs[name] : null;
      },
      rpcErrors[name] ?? null,
    ),
  );
  client.storage.from.mockImplementation(() => ({
    getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/logo.png' } }),
    createSignedUrl: async () => ({ data: null, error: null }),
  }));
  client.functions = { invoke: jest.fn(async () => ({ data: null, error: null })) };
  client.auth.getSession = jest.fn(async () => ({ data: { session: backend.session }, error: null }));
  client.auth.onAuthStateChange = jest.fn(() => ({
    data: { subscription: { unsubscribe: jest.fn() } },
  }));
  client.auth.signOut = jest.fn(async () => ({ error: null }));
}

// ---------------------------------------------------------------------------
// The chosen club and its settings

export const TEST_CLUB = {
  code: 'TESTCLUB',
  name: 'Sample Club',
  supabaseUrl: 'https://example.test',
  anonKey: 'anon',
};

let hasClub = true;
let clubValue: unknown = null;
let clubFeatures: Partial<Record<string, boolean>> = {};

/**
 * The club's saved feature switches, as an admin set them in Club settings.
 * Anything left out takes the app's default (on, except Season KPIs and
 * Affiliation records).
 */
export function setClubFeatures(features: Partial<Record<string, boolean>> = {}) {
  clubFeatures = features;
  clubValue = null;
}

/** Whether a club has been picked on this device. */
export function setClubChosen(chosen: boolean) {
  hasClub = chosen;
}

export function resetClub() {
  hasClub = true;
  setClubFeatures({});
}

/** Stands in for `@/lib/club`: the real feature rules, without AsyncStorage. */
export function clubModuleMock() {
  const actual = jest.requireActual('@/lib/club') as typeof import('@/lib/club');
  const current = () => {
    // One object per settings change, as the real provider memoises it.
    if (!clubValue) {
      clubValue = {
        ready: true,
        profile: null,
        reload: async () => {},
        ...actual.resolveClub({
          club_name: 'Sample Club',
          short_name: 'Sample',
          background_colour: null,
          text_colour: null,
          hero_colour: null,
          logo_path: null,
          features: clubFeatures,
          updated_at: null,
        }),
      };
    }
    return clubValue as ReturnType<typeof actual.useClub>;
  };
  return {
    ...actual,
    ClubProvider: ({ children }: { children: ReactNode }) => children,
    useClub: () => current(),
    useFeature: (key: keyof ReturnType<typeof actual.useClub>['features']) =>
      current().features[key],
    useSquads: () => current().squads,
    useClubColors: () => current().colors,
  };
}

/** Stands in for `@/lib/club-choice`, whose club list needs the build's env. */
export function clubChoiceModuleMock() {
  const value = () => ({
    ready: true,
    club: hasClub ? TEST_CLUB : null,
    recent: hasClub ? [TEST_CLUB] : [],
    choose: () => true,
    switchClub: () => {},
  });
  return {
    ClubChoiceProvider: ({ children }: { children: ReactNode }) => children,
    useClubChoice: () => value(),
  };
}

/**
 * Stands in for `@/constants/club`. Jest maps every `@/` import to src/, so
 * its `require('@/assets/images/...')` logos (which live in assets/, outside
 * src/) can't load under Jest, and the mapper refuses virtual mocks for them.
 * Same values as the real file, with numbers for the images.
 */
export function constantsClubMock() {
  const FirstPass = {
    name: 'FirstPass',
    appName: 'FirstPass HQ',
    navy: '#0F172A',
    orange: '#F75C03',
    blue: '#2274A5',
    gold: '#F1C40F',
    panel: '#1E293B',
    inkMuted: '#CBD5E1',
    hqOnDark: 1,
    hqOnLight: 2,
    splash: 3,
  };
  return {
    FirstPass,
    ClubDefaults: {
      name: FirstPass.appName,
      shortName: FirstPass.name,
      background: FirstPass.navy,
      text: '#FFFFFF',
      hero: FirstPass.orange,
    },
    DefaultLogo: { onDark: 4, onLight: 5 },
  };
}

// ---------------------------------------------------------------------------
// One screen on its own

// Loaded when first used, so this file's own checks don't need the app's providers.
const auth = () => jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');

/**
 * The root of a one-screen app: the real AuthProvider, and nothing until the
 * member has loaded, as the real root layout does. Leaves out the real
 * layout's guards, which the route tests cover.
 */
function ScreenTestLayout() {
  const { AuthProvider } = auth();
  return (
    <AuthProvider>
      <WhenLoaded />
    </AuthProvider>
  );
}

function WhenLoaded() {
  const { loading } = auth().useAuth();
  return loading ? null : <Stack />;
}

/**
 * Renders real screens (keyed by route, such as "injuries/[id]") for a member
 * on the fake backend, opened at `url`, and waits for their data to load.
 * Today is TODAY.
 */
export async function openScreen(
  who: PersonaName | Persona,
  screens: Record<string, ComponentType>,
  url: string,
  tables: Record<string, unknown[]> = {},
  options: BackendOptions = {},
) {
  jest.useFakeTimers({ now: TODAY });
  signInAs(typeof who === 'string' ? personas[who] : who, tables, options);
  await keepingRouterSpies(() => renderRouter({ _layout: ScreenTestLayout, ...screens }, { initialUrl: url }));
  await settle();
}

/**
 * Renders, keeping any jest spies already on the imperative `router`. Since
 * SDK 58 the router binds its methods in place when a screen first renders,
 * which would otherwise replace a spy a test set up beforehand.
 */
async function keepingRouterSpies(renderIt: () => Promise<unknown>) {
  const spies = Object.entries(router).filter(([, fn]) => jest.isMockFunction(fn));
  await renderIt();
  Object.assign(router, Object.fromEntries(spies));
}

/**
 * Presses an element without waiting for its handler to finish, for a test
 * that holds the backend's answer to look at the screen meanwhile.
 * fireEvent.press only returns once an async handler has finished, so with a
 * held answer it would never return. `done` settles when the handler does.
 */
export async function pressWithoutWaiting(element: TestInstance) {
  type Fiber = { memoizedProps?: { onPress?: unknown }; return: Fiber | null };
  let fiber = element.unstable_fiber as Fiber | null;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  if (!fiber) throw new Error('Nothing to press there');
  const onPress = fiber.memoizedProps!.onPress as (event: unknown) => unknown;
  let pending: unknown;
  await act(async () => {
    pending = onPress({ nativeEvent: {} });
  });
  return { done: Promise.resolve(pending) };
}

/** Lets pending loads and effects finish. */
export async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ---------------------------------------------------------------------------
// Routes, straight from the file system

// The project has no Node type definitions, so just what's used here.
type DirEntry = { name: string; isDirectory(): boolean };
const fs = jest.requireActual('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
};

/** Jest runs from the project root, as renderRouter's appDir assumes too. */
const APP_DIR = `${process.cwd()}/src/app`;

/** Every route file in src/app, such as "admin/reports/index", without _layout. */
export function routeFiles(dir = APP_DIR): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return routeFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      const route = full.slice(APP_DIR.length + 1).replace(/\.tsx?$/, '');
      return route === '_layout' ? [] : [route];
    })
    .sort();
}

function placeholder(route: string) {
  function Placeholder() {
    return <Text>{`screen:${route}`}</Text>;
  }
  return Placeholder;
}

/**
 * renderRouter overrides that swap every screen but `keep` for a placeholder
 * naming its route, leaving the real _layout.tsx and its guards in place.
 */
export function placeholderScreens(...keep: string[]) {
  return Object.fromEntries(
    routeFiles()
      .filter((r) => !keep.includes(r))
      .map((r) => [r, placeholder(r)]),
  );
}

export const ROUTES = routeFiles();

/** The URL that opens a route file, with any [param] filled in. */
export function urlOf(route: string) {
  return '/' + route.replace(/\[[^\]]+\]/g, 'x1').replace(/(^|\/)index$/, '');
}

/** Screens anyone can open, signed in or not. */
export const PUBLIC = ['club/[code]', 'auth-callback'];
/** Screens only for someone not signed in. */
export const SIGNED_OUT_ONLY = ['sign-in', 'choose-club'];
export const ADMIN_ROUTES = ROUTES.filter((r) => r === 'administration' || r.startsWith('admin/'));
export const MEMBER_ROUTES = ROUTES.filter(
  (r) => !PUBLIC.includes(r) && !SIGNED_OUT_ONLY.includes(r) && !ADMIN_ROUTES.includes(r),
);

/**
 * Deep-links a member straight to a URL through the real root layout, with
 * every screen a placeholder, as a notification or shared link would.
 */
let everyScreenAPlaceholder: ReturnType<typeof placeholderScreens> | null = null;

export async function openRoute(who: PersonaName, url: string) {
  const overrides = (everyScreenAPlaceholder ??= placeholderScreens());
  jest.useFakeTimers({ now: TODAY });
  signInAs(personas[who]);
  await keepingRouterSpies(() => renderRouter({ appDir: 'src/app', overrides }, { initialUrl: url }));
  // Let the session and the member's rows load (the layout shows nothing until then).
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * The screen's pull-to-refresh control. It is a prop of the scroll view, not
 * an element of its own, so this is the control as the screen passed it.
 */
export function refreshControl(): { props: { onRefresh(): void; refreshing: boolean } } {
  const found = screen.container.queryAll((n) => n.props.refreshControl != null);
  expect(found).toHaveLength(1);
  return found[0].props.refreshControl;
}

/** The route whose placeholder is showing. */
export function shownRoute() {
  const shown = screen.queryAllByText(/^screen:/);
  expect(shown).toHaveLength(1);
  return String(shown[0].props.children).replace(/^screen:/, '');
}

export async function expectReaches(who: PersonaName, route: string) {
  await openRoute(who, urlOf(route));
  expect(shownRoute()).toBe(route);
  expect(screen).toHavePathname(urlOf(route));
}

/** Opening the route shows `landing` instead, never the route. */
export async function expectTurnedAway(who: PersonaName, route: string, landing: string) {
  await openRoute(who, urlOf(route));
  expect(shownRoute()).toBe(landing);
  expect(screen).toHavePathname(urlOf(landing));
}

// expo-router/testing-library adds these matchers at run time but, in SDK 57,
// ships no types for them.
declare global {
  namespace jest {
    interface Matchers<R> {
      toHavePathname(pathname: string): R;
      toHavePathnameWithParams(pathname: string): R;
      toHaveSegments(segments: string[]): R;
      toHaveSearchParams(params: Record<string, string | string[]>): R;
    }
  }
}

// ---------------------------------------------------------------------------
// The fixtures' own checks, run only when Jest runs this file.

if (expect.getState().testPath?.endsWith('/__tests__/helpers/harness.tsx')) {
  describe('test personas', () => {
    it.each(Object.entries(personas).filter(([, p]) => p.profile))(
      '%s holds a role combination the app allows',
      (_name, p) => {
        const roles = [p.profile!.role, ...p.profile!.extra_roles];
        expect(roleCombinationProblem(roles, p.profile!.date_of_birth, p.profile!.under_17)).toBeNull();
      },
    );

    it.each(Object.entries(morePersonas))(
      '%s (screen tests) holds a role combination the app allows',
      (_name, p) => {
        const roles = [p.profile.role, ...p.profile.extra_roles];
        expect(roleCombinationProblem(roles, p.profile.date_of_birth, p.profile.under_17)).toBeNull();
      },
    );

    it('handlers see the filters and arguments, and errors come back as the database’s', async () => {
      signInAs(personas.coach, { notes: [{ id: 'n1' }] }, {
        tableHandlers: { profiles: (q) => (q.eq('id') === 'other' ? [{ id: 'other' }] : undefined) },
        rpcHandlers: { echo: (args) => args.p_value },
        rpcErrors: { refused: 'Not allowed' },
      });
      const other = await supabase.from('profiles').select('*').eq('id', 'other').single();
      expect(other.data).toEqual({ id: 'other' });
      const own = await supabase.from('profiles').select('*').eq('id', 'coach').single();
      expect(own.data).toEqual(personas.coach.profile);
      expect((await supabase.from('notes').select('*')).data).toEqual([{ id: 'n1' }]);
      expect((await supabase.rpc('echo', { p_value: 3 })).data).toBe(3);
      const refused = await supabase.rpc('refused');
      expect(refused.data).toBeNull();
      expect(refused.error).toEqual({ message: 'Not allowed' });
    });

    it('the fake backend answers queries and RPCs with the seeded rows', async () => {
      signInAs(personas.coach);
      const { data } = await supabase.from('profiles').select('*').eq('id', 'coach').single();
      expect(data).toEqual(personas.coach.profile);
      const members = await supabase.from('team_members').select('*').eq('profile_id', 'coach');
      expect(members.data).toEqual(personas.coach.memberships);
      expect((await supabase.rpc('unknown_rpc')).data).toBeNull();
    });
  });
}
