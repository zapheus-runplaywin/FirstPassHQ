import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { Clubs, findClub, type ClubEntry } from '@/constants/clubs';
import { connectToClub, hasSavedSession } from '@/lib/supabase';

type ClubChoice = {
  /** False while the saved choice loads. */
  ready: boolean;
  /** The club this device is connected to, or null until someone picks one. */
  club: ClubEntry | null;
  /** Whether there's more than one club to pick from. */
  canSwitch: boolean;
  /** Connects to the club with this code. False when no club has it. */
  choose: (code: string) => boolean;
  /** Goes back to the club code screen. Every club's sign-in stays saved. */
  switchClub: () => void;
};

const CHOICE_KEY = 'club-code';
const ClubChoiceContext = createContext<ClubChoice | null>(null);

// AsyncStorage is unavailable during static web rendering.
const canStore = Platform.OS !== 'web' || typeof window !== 'undefined';
const onlyClub = Clubs.length === 1 ? Clubs[0] : null;

/**
 * Which club, and so which club's database, the app is using. With one club it
 * is always that club. Otherwise it's the club picked last time; on a device
 * signed in before there were other clubs, the club it's signed in to.
 */
export function ClubChoiceProvider({ children }: { children: ReactNode }) {
  const [club, setClub] = useState<ClubEntry | null>(() => {
    if (onlyClub) connectToClub(onlyClub);
    return onlyClub;
  });
  const [ready, setReady] = useState(!!onlyClub || !canStore);

  useEffect(() => {
    if (onlyClub || !canStore) return;
    let cancelled = false;
    (async () => {
      const saved = await AsyncStorage.getItem(CHOICE_KEY).catch(() => null);
      let found = findClub(saved);
      // Nothing saved yet: a device signed in before there were other clubs.
      // (After Switch club an empty choice is saved, so the code screen shows.)
      if (saved === null) {
        for (const candidate of Clubs) {
          if (await hasSavedSession(candidate)) {
            found = candidate;
            break;
          }
        }
      }
      if (cancelled) return;
      if (found) {
        connectToClub(found);
        setClub(found);
      }
      setReady(true);
    })();
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
    if (onlyClub) return;
    setClub(null);
    if (canStore) AsyncStorage.setItem(CHOICE_KEY, '').catch(() => {});
  }, []);

  return (
    <ClubChoiceContext value={{ ready, club, canSwitch: !onlyClub, choose, switchClub }}>
      {children}
    </ClubChoiceContext>
  );
}

export function useClubChoice() {
  const value = use(ClubChoiceContext);
  if (!value) throw new Error('useClubChoice must be used inside ClubChoiceProvider');
  return value;
}
