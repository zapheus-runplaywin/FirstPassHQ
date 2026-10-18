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
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { roleCombinationProblem } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  GroupCaptain,
  MyVolunteerExemption,
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
  | 'stoodDownCoach';

export type Persona = {
  session: Session | null;
  profile: Profile | null;
  memberships: TeamMembership[];
  captaincies?: GroupCaptain[];
  isClubCaptain?: boolean;
  isSafeguardingOfficer?: boolean;
  exemption?: MyVolunteerExemption | null;
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

function membership(team_role: TeamRole): TeamMembership {
  return {
    team_role,
    coach_title: team_role === 'coach' ? 'head_coach' : null,
    selection: team_role === 'athlete' ? 'touring' : null,
    team: TEAM,
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
    memberships: memberships.map(membership),
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
};

// ---------------------------------------------------------------------------
// The fake backend

type Backend = {
  session: Session | null;
  tables: Record<string, unknown[]>;
  rpcs: Record<string, unknown>;
};

let backend: Backend = { session: null, tables: {}, rpcs: {} };

type Result = { data: unknown; error: null; count: number | null; status: number };

/**
 * A query builder like supabase-js's: every filter returns the builder, and
 * awaiting it (or .single() / .maybeSingle()) gives the canned rows. Filters
 * are ignored; each test only seeds what its member would see.
 */
function query(resolve: () => unknown): unknown {
  const result = (): Result => {
    const data = resolve();
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
      return () => builder;
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
export function signInAs(persona: Persona, tables: Record<string, unknown[]> = {}) {
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
      is_safeguarding_officer: persona.isSafeguardingOfficer ?? false,
      committee_checks_from: null,
      ...persona.rpcs,
    },
  };
  const client = supabase as unknown as MockedClient;
  client.from.mockImplementation((table: string) => query(() => backend.tables[table] ?? []));
  client.rpc.mockImplementation((name: string) =>
    query(() => (name in backend.rpcs ? backend.rpcs[name] : null)),
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
  everyScreenAPlaceholder ??= placeholderScreens();
  jest.useFakeTimers({ now: TODAY });
  signInAs(personas[who]);
  renderRouter({ appDir: 'src/app', overrides: everyScreenAPlaceholder }, { initialUrl: url });
  // Let the session and the member's rows load (the layout shows nothing until then).
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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
