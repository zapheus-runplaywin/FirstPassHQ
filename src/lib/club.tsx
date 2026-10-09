import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { ClubDefaults, DefaultLogo } from '@/constants/club';
import { Colors, isHexColour, makeColors, type Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/** Features an admin can turn on and off for the club. */
export const FEATURES = [
  { key: 'messages', label: 'Messages', detail: 'Group messages with read receipts' },
  { key: 'calendar', label: 'Calendar', detail: 'Club, squad and team calendars and fixtures' },
  { key: 'checkIns', label: 'Daily check-ins', detail: 'Athletes’ wellbeing check-ins and trends' },
  { key: 'injuries', label: 'Injuries', detail: 'Injury reports, medical documents and clearances' },
  { key: 'attendance', label: 'Attendance', detail: 'Coaches take attendance at sessions' },
  { key: 'awards', label: 'Awards', detail: 'Award votes and results' },
  { key: 'goals', label: 'Game goals', detail: 'Athletes’ goals and reflections for PlayHQ games' },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];
export type Features = Record<FeatureKey, boolean>;

/** The club's settings as saved by an admin. Empty values use the build's defaults. */
export type ClubProfile = {
  club_name: string | null;
  short_name: string | null;
  background_colour: string | null;
  text_colour: string | null;
  hero_colour: string | null;
  logo_path: string | null;
  features: Partial<Record<string, boolean>>;
  updated_at: string | null;
};

type ClubState = {
  /** False until the settings saved on this device have loaded. */
  ready: boolean;
  profile: ClubProfile | null;
  name: string;
  shortName: string;
  colors: Palette;
  logo: number | { uri: string };
  features: Features;
  /** Whether members join a squad before teams are named from it. */
  squads: boolean;
  reload: () => Promise<void>;
};

const CACHE_KEY = 'club-profile';
const ClubContext = createContext<ClubState | null>(null);

// AsyncStorage is unavailable during static web rendering.
const canCache = Platform.OS !== 'web' || typeof window !== 'undefined';

export function logoUrl(path: string) {
  return supabase.storage.from('club-branding').getPublicUrl(path).data.publicUrl;
}

/** Turns saved settings into what screens use, falling back to the defaults. */
export function resolveClub(profile: ClubProfile | null) {
  const colour = (value: string | null | undefined, fallback: string) =>
    value && isHexColour(value) ? value.toUpperCase() : fallback;
  return {
    name: profile?.club_name || ClubDefaults.name,
    shortName: profile?.short_name || ClubDefaults.shortName,
    colors: makeColors({
      background: colour(profile?.background_colour, ClubDefaults.background),
      text: colour(profile?.text_colour, ClubDefaults.text),
      hero: colour(profile?.hero_colour, ClubDefaults.hero),
    }),
    logo: profile?.logo_path ? { uri: logoUrl(profile.logo_path) } : DefaultLogo,
    features: Object.fromEntries(
      FEATURES.map((f) => [f.key, profile?.features?.[f.key] !== false]),
    ) as Features,
    // Stored with the features, but it shapes the club rather than adding a screen.
    squads: profile?.features?.squads !== false,
  };
}

async function fetchClubProfile() {
  const { data, error } = await supabase.rpc('club_profile');
  if (error || !data) return null;
  return ((data as ClubProfile[])[0] ?? null) as ClubProfile | null;
}

/**
 * The club's name, colours, logo and features. Signed-out screens use what
 * this device saw last time (or the build's defaults); once a member signs
 * in, the latest settings load and are saved for next time.
 */
export function ClubProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(!canCache);
  const [profile, setProfile] = useState<ClubProfile | null>(null);

  useEffect(() => {
    if (!canCache) return;
    AsyncStorage.getItem(CACHE_KEY)
      .then((saved) => {
        if (saved) setProfile((current) => current ?? (JSON.parse(saved) as ClubProfile));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const save = useCallback((row: ClubProfile | null) => {
    if (!row) return;
    setProfile(row);
    if (canCache) AsyncStorage.setItem(CACHE_KEY, JSON.stringify(row)).catch(() => {});
  }, []);

  const reload = useCallback(() => fetchClubProfile().then(save), [save]);

  useEffect(() => {
    if (signedIn) fetchClubProfile().then(save);
  }, [signedIn, save]);

  const value = useMemo(
    () => ({ ready, profile, reload, ...resolveClub(profile) }),
    [ready, profile, reload],
  );

  return <ClubContext value={value}>{children}</ClubContext>;
}

export function useClub() {
  const club = use(ClubContext);
  if (!club) throw new Error('useClub must be used inside ClubProvider');
  return club;
}

/** Whether the club has a feature turned on. */
export function useFeature(key: FeatureKey) {
  return useClub().features[key];
}

/** Whether the club uses squads, or selects straight into teams. */
export function useSquads() {
  return useClub().squads;
}

/** The club's palette, or the build's default outside ClubProvider. */
export function useClubColors(): Palette {
  return use(ClubContext)?.colors ?? Colors;
}
