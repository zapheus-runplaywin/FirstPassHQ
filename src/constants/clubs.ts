/**
 * The clubs and associations this app can connect to. Each has its own Supabase
 * project, so they never share a database: the app connects to one at a time,
 * picked by its code, and a sign-in to one never reaches another. An association
 * is set up exactly like a club. See docs/new-club-setup.md.
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

/**
 * Every other club or association, each with its own Supabase project, from
 * the EAS environment (docs/environments.md "More clubs and associations").
 * Installed builds and updates take the live projects from the production
 * environment and the test ones from preview. Each value is read by name so
 * Expo can build it in.
 */
const OtherClubs = [
  {
    code: process.env.EXPO_PUBLIC_CLUB_2_CODE,
    name: process.env.EXPO_PUBLIC_CLUB_2_NAME,
    supabaseUrl: process.env.EXPO_PUBLIC_CLUB_2_URL,
    anonKey: process.env.EXPO_PUBLIC_CLUB_2_ANON_KEY,
  },
  {
    code: process.env.EXPO_PUBLIC_CLUB_3_CODE,
    name: process.env.EXPO_PUBLIC_CLUB_3_NAME,
    supabaseUrl: process.env.EXPO_PUBLIC_CLUB_3_URL,
    anonKey: process.env.EXPO_PUBLIC_CLUB_3_ANON_KEY,
  },
].filter(
  (club): club is ClubEntry => !!(club.code && club.name && club.supabaseUrl && club.anonKey),
);

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

const extraClubs = [...OtherClubs, ...TestClubs].map((club) => ({
  ...club,
  code: normaliseClubCode(club.code),
}));

/** The home club, then the others; a code that's already taken is skipped. */
export const Clubs: readonly ClubEntry[] = [
  HomeClub,
  ...extraClubs.filter(
    (club, i) =>
      club.code !== HomeClub.code && extraClubs.findIndex((c) => c.code === club.code) === i,
  ),
];

/** Club codes ignore case and spaces. */
export function normaliseClubCode(code: string) {
  return code.replace(/\s+/g, '').toUpperCase();
}

export function findClub(code: string | null | undefined) {
  if (!code) return null;
  const wanted = normaliseClubCode(code);
  return Clubs.find((club) => club.code === wanted) ?? null;
}
