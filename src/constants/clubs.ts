/**
 * The clubs this app can connect to. Every club has its own Supabase project, so
 * clubs never share a database: the app connects to one club at a time, picked by
 * its club code. See docs/new-club-setup.md.
 */
export type ClubEntry = {
  /** What members type to find the club, and the end of its join link. Capitals and digits. */
  code: string;
  /** Shown before signing in, so members can check they found the right club. */
  name: string;
  supabaseUrl: string;
  /**
   * The project's public key (Project Settings > API). It's meant to be public:
   * it only reaches what the database's row-level security allows.
   */
  anonKey: string;
  /**
   * The demo club for store reviewers and testers: sample people only, on the
   * test project, signing in with an email and password. Only DemoClub below
   * sets it; see isDemoClub.
   */
  demo?: true;
};

const homeUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const homeKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!homeUrl || !homeKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.',
  );
}

/**
 * The club whose project this build is made with: the live project in installed
 * builds (from the EAS environment), the test project in Expo Go (from .env).
 */
const HomeClub: ClubEntry = {
  code: process.env.EXPO_PUBLIC_CLUB_CODE || 'THUNDER',
  name: process.env.EXPO_PUBLIC_CLUB_NAME || 'West Coast Thunder',
  supabaseUrl: homeUrl,
  anonKey: homeKey,
};

/** Every other club, each with its own Supabase project. */
const OtherClubs: ClubEntry[] = [];

/**
 * Extra test clubs for development, from .env only (docs/environments.md). Each
 * value is read by name so Expo can build it in; installed builds and updates
 * never have them, so these clubs only exist in Expo Go.
 */
const TestClubs = [
  {
    code: process.env.EXPO_PUBLIC_TEST_CLUB_2_CODE,
    name: process.env.EXPO_PUBLIC_TEST_CLUB_2_NAME,
    supabaseUrl: process.env.EXPO_PUBLIC_TEST_CLUB_2_URL,
    anonKey: process.env.EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY,
  },
  {
    code: process.env.EXPO_PUBLIC_TEST_CLUB_3_CODE,
    name: process.env.EXPO_PUBLIC_TEST_CLUB_3_NAME,
    supabaseUrl: process.env.EXPO_PUBLIC_TEST_CLUB_3_URL,
    anonKey: process.env.EXPO_PUBLIC_TEST_CLUB_3_ANON_KEY,
  },
].filter(
  (club): club is ClubEntry => !!(club.code && club.name && club.supabaseUrl && club.anonKey),
);

/** The demo club's code. Reviewers and testers type it on the first screen. */
export const DEMO_CLUB_CODE = 'DEMO';

/**
 * The demo club, only in builds given its two EAS variables, both pointing at
 * the test project (docs/environments.md, "The demo club"). It holds sample
 * people only and is the one club that signs in with an email and password.
 * A build without the variables has no demo club.
 */
export function demoClubFrom(env: {
  url?: string;
  anonKey?: string;
}): ClubEntry | null {
  if (!env.url || !env.anonKey) return null;
  return {
    code: DEMO_CLUB_CODE,
    name: 'FirstPass Demo Club',
    supabaseUrl: env.url,
    anonKey: env.anonKey,
    demo: true,
  };
}

const DemoClub = demoClubFrom({
  url: process.env.EXPO_PUBLIC_DEMO_CLUB_URL,
  anonKey: process.env.EXPO_PUBLIC_DEMO_CLUB_ANON_KEY,
});

/**
 * Every club the app lists: the home club first, then the others. A code
 * that's already taken is skipped, and only the demo entry keeps the demo
 * flag, so no other club, and never the home club, shows a password box. A
 * demo entry pointing at the home club's own project is left out, so a
 * mistyped variable can never open password sign-in on the live project.
 */
export function listClubs(
  home: ClubEntry,
  others: readonly ClubEntry[],
  demo: ClubEntry | null,
): ClubEntry[] {
  const homeClub: ClubEntry = { ...home, code: normaliseClubCode(home.code) };
  delete homeClub.demo;
  const extra = [
    ...others.map((club) => {
      const entry: ClubEntry = { ...club, code: normaliseClubCode(club.code) };
      delete entry.demo;
      return entry;
    }),
    ...(demo && demo.supabaseUrl !== homeClub.supabaseUrl
      ? [{ ...demo, code: DEMO_CLUB_CODE, demo: true as const }]
      : []),
  ];
  return [
    homeClub,
    ...extra.filter(
      (club, i) =>
        club.code !== homeClub.code && extra.findIndex((c) => c.code === club.code) === i,
    ),
  ];
}

export const Clubs: readonly ClubEntry[] = listClubs(
  HomeClub,
  [...OtherClubs, ...TestClubs],
  DemoClub,
);

/**
 * Whether a club signs in with an email and password: the demo club only,
 * and never the club this build is made for or its project.
 */
export function isDemoClub(club: ClubEntry | null | undefined): boolean {
  return (
    club?.demo === true &&
    club.code === DEMO_CLUB_CODE &&
    club.code !== Clubs[0].code &&
    club.supabaseUrl !== Clubs[0].supabaseUrl
  );
}

/** Club codes ignore case and spaces. */
export function normaliseClubCode(code: string) {
  return code.replace(/\s+/g, '').toUpperCase();
}

export function findClub(code: string | null | undefined) {
  if (!code) return null;
  const wanted = normaliseClubCode(code);
  return Clubs.find((club) => club.code === wanted) ?? null;
}
