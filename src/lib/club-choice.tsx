import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { findClub, type ClubEntry } from '@/constants/clubs';
import { connectToClub } from '@/lib/supabase';

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
  const [ready, setReady] = useState(!canStore);

  useEffect(() => {
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

  return (
    <ClubChoiceContext value={{ ready, club, recent, choose, switchClub }}>
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
