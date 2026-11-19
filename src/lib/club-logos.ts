import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { ClubEntry } from '@/constants/clubs';
import type { ClubProfile } from '@/lib/club';

// AsyncStorage is unavailable during static web rendering.
const canRead = Platform.OS !== 'web' || typeof window !== 'undefined';

/**
 * Where this device keeps the settings it last saw for the club with this
 * code (ClubProvider in src/lib/club.tsx saves them). One key per club, so one
 * club's look never shows for another.
 */
export function clubProfileCacheKey(code: string) {
  return `club-profile:${code}`;
}

/**
 * The public address of a club's logo in its own project. Each club has its own
 * Supabase project, so this can't use the connected client: the club list shows
 * clubs the app isn't connected to. It matches the address supabase-js gives
 * (src/lib/club.tsx, logoUrl), so a logo already shown in the club is reused
 * from the image cache, including offline.
 */
export function clubLogoUrl(club: Pick<ClubEntry, 'supabaseUrl'>, logoPath: string) {
  const base = club.supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/club-branding/${logoPath.replace(/^\/+/, '')}`;
}

/** Up to three capitals from the club's name, for a club whose logo this device hasn't seen. */
export function clubInitials(name: string) {
  const letters = name
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 3)
    .join('')
    .toUpperCase();
  return letters || '?';
}

/** The logo saved with a club's settings on this device, if any. */
export function logoFromSaved(club: ClubEntry, saved: string | null | undefined) {
  if (!saved) return null;
  try {
    const path = (JSON.parse(saved) as Partial<ClubProfile> | null)?.logo_path;
    return typeof path === 'string' && path.trim() ? clubLogoUrl(club, path.trim()) : null;
  } catch {
    return null;
  }
}

/**
 * Each club's logo, from the settings this device saved the last time someone
 * opened that club. A club nobody has signed in to here has none. Nothing is
 * fetched: the club's settings are only for its signed-in members.
 */
export function useSavedClubLogos(clubs: readonly ClubEntry[]) {
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  const codes = clubs.map((c) => c.code).join(',');

  useEffect(() => {
    if (!canRead || clubs.length === 0) return;
    let cancelled = false;
    AsyncStorage.multiGet(clubs.map((c) => clubProfileCacheKey(c.code)))
      .catch(() => [] as readonly [string, string | null][])
      .then((pairs) => {
        if (cancelled) return;
        const saved = new Map(pairs);
        setLogos(
          Object.fromEntries(
            clubs.map((c) => [c.code, logoFromSaved(c, saved.get(clubProfileCacheKey(c.code)))]),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
    // The codes say when the list really changed; the array is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  return logos;
}
