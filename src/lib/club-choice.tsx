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
  /** Connects to the club with this code. False when no club has it. */
  choose: (code: string) => boolean;
  /** Goes back to the club code screen. Every club's sign-in stays saved. */
  switchClub: () => void;
};

const CHOICE_KEY = 'club-code';
const ClubChoiceContext = createContext<ClubChoice | null>(null);

// AsyncStorage is unavailable during static web rendering.
const canStore = Platform.OS !== 'web' || typeof window !== 'undefined';

/**
 * Which club, and so which club's database, the app is using: the club picked
 * last time on this device, or none until someone enters a club code.
 */
export function ClubChoiceProvider({ children }: { children: ReactNode }) {
  const [club, setClub] = useState<ClubEntry | null>(null);
  const [ready, setReady] = useState(!canStore);

  useEffect(() => {
    if (!canStore) return;
    let cancelled = false;
    AsyncStorage.getItem(CHOICE_KEY)
      .catch(() => null)
      .then((saved) => {
        if (cancelled) return;
        const found = findClub(saved);
        if (found) {
          connectToClub(found);
          setClub(found);
        }
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
    if (canStore) AsyncStorage.setItem(CHOICE_KEY, found.code).catch(() => {});
    return true;
  }, []);

  const switchClub = useCallback(() => {
    setClub(null);
    if (canStore) AsyncStorage.removeItem(CHOICE_KEY).catch(() => {});
  }, []);

  return (
    <ClubChoiceContext value={{ ready, club, choose, switchClub }}>
      {children}
    </ClubChoiceContext>
  );
}

export function useClubChoice() {
  const value = use(ClubChoiceContext);
  if (!value) throw new Error('useClubChoice must be used inside ClubChoiceProvider');
  return value;
}
