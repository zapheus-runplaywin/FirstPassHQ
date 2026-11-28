import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { findClub, type ClubEntry } from '@/constants/clubs';
import { clubProfileCacheKey } from '@/lib/club-logos';
import { connectToClub, signOutOfClub } from '@/lib/supabase';

type ClubChoice = {
  /** False while the saved choice loads. */
  ready: boolean;
  /** The club this device is connected to, or null until someone picks one. */
  club: ClubEntry | null;
  /** Clubs picked on this device before, most recent first, for one-tap switching. */
  recent: ClubEntry[];
  /** Connects to the club with this code. False when no club has it. */
  choose: (code: string) => boolean;
  /** Goes back to the club code screen. Every club's sign-in stays saved. */
  switchClub: () => void;
  /**
   * Takes a club off this device's list, signs out of it here and forgets the
   * look saved for it. Nothing changes at the club: entering its code adds it
   * back.
   */
  remove: (code: string) => void;
};

const CHOICE_KEY = 'club-code';
const RECENT_KEY = 'club-codes-used';
const ClubChoiceContext = createContext<ClubChoice | null>(null);

// AsyncStorage is unavailable during static web rendering.
const canStore = Platform.OS !== 'web' || typeof window !== 'undefined';

/**
 * Which club, and so which club's database, the app is using: the club picked
 * last time on this device, or none until someone enters a club code.
 */
export function ClubChoiceProvider({ children }: { children: ReactNode }) {
  const [club, setClub] = useState<ClubEntry | null>(null);
  const [recent, setRecent] = useState<ClubEntry[]>([]);
  // Not ready on the first render anywhere, including the static web render,
  // so the page the server sends matches the browser's first render (React
  // error #418 otherwise).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Effects don't run in the static render, so it stays on the blank page.
    if (!canStore) return;
    let cancelled = false;
    AsyncStorage.multiGet([CHOICE_KEY, RECENT_KEY])
      .catch(() => [] as [string, string | null][])
      .then((pairs) => {
        if (cancelled) return;
        const saved = new Map(pairs);
        const found = findClub(saved.get(CHOICE_KEY));
        if (found) {
          connectToClub(found);
          setClub(found);
        }
        setRecent(parseRecent(saved.get(RECENT_KEY)));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback((code: string) => {
    const found = findClub(code);
    if (!found) return false;
    connectToClub(found);
    setClub(found);
    setRecent((current) => {
      const next = [found, ...current.filter((c) => c.code !== found.code)];
      if (canStore) {
        AsyncStorage.multiSet([
          [CHOICE_KEY, found.code],
          [RECENT_KEY, JSON.stringify(next.map((c) => c.code))],
        ]).catch(() => {});
      }
      return next;
    });
    return true;
  }, []);

  const switchClub = useCallback(() => {
    setClub(null);
    if (canStore) AsyncStorage.removeItem(CHOICE_KEY).catch(() => {});
  }, []);

  const remove = useCallback((code: string) => {
    const found = findClub(code);
    if (!found) return;
    setClub((current) => {
      if (current?.code !== found.code) return current;
      if (canStore) AsyncStorage.removeItem(CHOICE_KEY).catch(() => {});
      return null;
    });
    setRecent((current) => {
      const next = current.filter((c) => c.code !== found.code);
      if (canStore) {
        AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next.map((c) => c.code))).catch(() => {});
      }
      return next;
    });
    if (canStore) {
      AsyncStorage.removeItem(clubProfileCacheKey(found.code)).catch(() => {});
      signOutOfClub(found).catch(() => {});
    }
  }, []);

  return (
    <ClubChoiceContext value={{ ready, club, recent, choose, switchClub, remove }}>
      {children}
    </ClubChoiceContext>
  );
}

/** Saved codes, keeping only clubs the app still knows. */
function parseRecent(saved: string | null | undefined): ClubEntry[] {
  try {
    const codes = JSON.parse(saved ?? '[]') as unknown;
    if (!Array.isArray(codes)) return [];
    return codes.map((code) => findClub(String(code))).filter((c): c is ClubEntry => !!c);
  } catch {
    return [];
  }
}

export function useClubChoice() {
  const value = use(ClubChoiceContext);
  if (!value) throw new Error('useClubChoice must be used inside ClubChoiceProvider');
  return value;
}
