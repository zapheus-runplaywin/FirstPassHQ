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
 * Every other club, each with its own Supabase project. While this is empty the
 * app never asks for a club code.
 */
const OtherClubs: ClubEntry[] = [];

export const Clubs: readonly ClubEntry[] = [
  HomeClub,
  ...OtherClubs.filter((club) => club.code !== HomeClub.code),
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

export function isHomeClub(club: ClubEntry) {
  return club.code === HomeClub.code;
}
