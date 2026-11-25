import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { ClubDefaults, DefaultLogo } from '@/constants/club';
import { Colors, contrastRatio, isHexColour, makeColors, type Palette } from '@/constants/theme';
import { useClubChoice } from '@/lib/club-choice';
import { clubProfileCacheKey } from '@/lib/club-logos';
import { DEFAULT_CLUB_TIME_ZONE, setClubTimeZone } from '@/lib/club-time';
import { supabase } from '@/lib/supabase';

/** Features an admin can turn on and off for the club. */
export const FEATURES = [
  { key: 'messages', label: 'Messages', detail: 'Group messages with read receipts' },
  {
    key: 'chatGroups',
    label: 'Chat groups',
    detail:
      'Groups in Messages where adults talk back and forth: automatic ones for each squad’s and team’s coaches, managers, captains and physios, and groups admins set up. Members under 18 read only, with parents copied.',
    offByDefault: true,
  },
  { key: 'calendar', label: 'Calendar', detail: 'Club, squad and team calendars and fixtures' },
  { key: 'checkIns', label: 'Daily check-ins', detail: 'Athletes’ wellbeing check-ins and trends' },
  {
    key: 'trainingLoad',
    label: 'Training load flags',
    detail:
      'Prompts for coaches from the sessions athletes log, each with its published source (needs Daily check-ins)',
    offByDefault: true,
  },
  { key: 'injuries', label: 'Injuries', detail: 'Injury reports, medical documents and clearances' },
  { key: 'attendance', label: 'Attendance', detail: 'Coaches take attendance at sessions' },
  {
    key: 'sessionPlans',
    label: 'Session plans',
    detail: 'Coaches keep and share a plan for each training session',
  },
  {
    key: 'surveys',
    label: 'Surveys',
    detail: 'Anonymous or named surveys from the committee, coaches and managers, and polls from captains',
  },
  {
    key: 'captainPolls',
    label: 'Captains’ polls',
    detail: 'Captains and vice captains send polls with choices to their own team (needs Surveys)',
  },
  { key: 'awards', label: 'Awards', detail: 'Award votes and results' },
  {
    key: 'liveStreams',
    label: 'Live streams',
    detail:
      'Games streamed with FirstPass Studio. Parents of athletes under 18 choose whether streams name their child with their own stats.',
  },
  { key: 'goals', label: 'Game goals', detail: 'Athletes’ goals and reflections for PlayHQ games' },
  {
    key: 'integrity',
    label: 'Integrity training',
    detail: 'Sports Integrity Australia courses and certificates',
  },
  {
    key: 'kpis',
    label: 'Season KPIs',
    detail: 'KPIs and OKRs for coaches, managers and athletes, with season reviews',
    offByDefault: true,
  },
  {
    key: 'registers',
    label: 'Policy and conflict registers',
    detail: 'Policy review dates and owners, and conflict-of-interest declarations each season',
    offByDefault: true,
  },
  {
    key: 'selectionAssessments',
    label: 'Selection assessments',
    detail:
      'Selectors build each athlete’s assessment over a selection round, against the club’s own criteria. Admins get an audit report, not the assessments.',
    offByDefault: true,
  },
] as const;

/** Whether a feature starts off until an admin turns it on. */
export function offByDefault(feature: (typeof FEATURES)[number]) {
  return 'offByDefault' in feature && feature.offByDefault;
}

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
  /** The club's time zone, such as "Australia/Perth". Missing from settings saved by older versions. */
  timezone?: string | null;
};

type ClubState = {
  /** False until the settings saved on this device have loaded. */
  ready: boolean;
  profile: ClubProfile | null;
  name: string;
  shortName: string;
  colors: Palette;
  logo: number | { uri: string };
  /** True once an admin has uploaded the club's own logo. */
  hasLogo: boolean;
  features: Features;
  /** Whether members join a squad before teams are named from it. */
  squads: boolean;
  /** The club's time zone, such as "Australia/Perth": the zone "today" is worked out in. */
  timeZone: string;
  reload: () => Promise<void>;
};

const ClubContext = createContext<ClubState | null>(null);

// AsyncStorage is unavailable during static web rendering.
const canCache = Platform.OS !== 'web' || typeof window !== 'undefined';

export function logoUrl(path: string) {
  return supabase.storage.from('club-branding').getPublicUrl(path).data.publicUrl;
}

function isDark(background: string) {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#000000');
}

/** The FirstPass mark that stands in for a club logo on this background. */
export function defaultLogo(background: string) {
  return isDark(background) ? DefaultLogo.onDark : DefaultLogo.onLight;
}

/** Turns saved settings into what screens use, falling back to the defaults. */
export function resolveClub(profile: ClubProfile | null) {
  const colour = (value: string | null | undefined, fallback: string) =>
    value && isHexColour(value) ? value.toUpperCase() : fallback;
  const colors = makeColors({
    background: colour(profile?.background_colour, ClubDefaults.background),
    text: colour(profile?.text_colour, ClubDefaults.text),
    hero: colour(profile?.hero_colour, ClubDefaults.hero),
  });
  return {
    name: profile?.club_name || ClubDefaults.name,
    shortName: profile?.short_name || ClubDefaults.shortName,
    colors,
    logo: profile?.logo_path ? { uri: logoUrl(profile.logo_path) } : defaultLogo(colors.background),
    hasLogo: !!profile?.logo_path,
    // Newer features that change how the club works start off; the rest start on.
    features: Object.fromEntries(
      FEATURES.map((f) => [
        f.key,
        offByDefault(f) ? profile?.features?.[f.key] === true : profile?.features?.[f.key] !== false,
      ]),
    ) as Features,
    // Stored with the features, but it shapes the club rather than adding a screen.
    squads: profile?.features?.squads !== false,
    timeZone: profile?.timezone || DEFAULT_CLUB_TIME_ZONE,
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
  const { club } = useClubChoice();
  // Before a club is picked there's nothing saved to show: the build's defaults.
  const cacheKey = club ? clubProfileCacheKey(club.code) : null;
  const [ready, setReady] = useState(!canCache || !cacheKey);
  const [profile, setProfile] = useState<ClubProfile | null>(null);

  useEffect(() => {
    if (!canCache || !cacheKey) return;
    AsyncStorage.getItem(cacheKey)
      .then((saved) => {
        if (!saved) return;
        setProfile((current) => {
          if (current) return current;
          const row = JSON.parse(saved) as ClubProfile;
          setClubTimeZone(row.timezone);
          return row;
        });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [cacheKey]);

  const save = useCallback(
    (row: ClubProfile | null) => {
      if (!row) return;
      // Before the screens render with it, so "today" is the club's day.
      setClubTimeZone(row.timezone);
      setProfile(row);
      if (canCache && cacheKey) {
        AsyncStorage.setItem(cacheKey, JSON.stringify(row)).catch(() => {});
      }
    },
    [cacheKey],
  );

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
