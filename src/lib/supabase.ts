import 'react-native-url-polyfill/auto';
import '@/lib/crypto-polyfill';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { ClubEntry } from '@/constants/clubs';

// AsyncStorage is unavailable during static web rendering.
const canStore = Platform.OS !== 'web' || typeof window !== 'undefined';

function makeClient(club: ClubEntry) {
  return createClient(club.supabaseUrl, club.anonKey, {
    auth: {
      // Sessions are saved under a key named after the club's project, so each
      // club keeps its own sign-in on this device.
      ...(canStore ? { storage: AsyncStorage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

type Client = ReturnType<typeof makeClient>;

const clients = new Map<string, Client>();
let current: Client | null = null;

/**
 * Points the app at a club's own Supabase project. Screens are remounted when the
 * club changes (see ClubChoiceProvider), so nothing from the last club stays on screen.
 */
export function connectToClub(club: ClubEntry) {
  let client = clients.get(club.code);
  if (!client) {
    client = makeClient(club);
    clients.set(club.code, client);
  }
  if (client === current) return;
  if (Platform.OS !== 'web') current?.auth.stopAutoRefresh();
  current = client;
  if (Platform.OS !== 'web' && AppState.currentState === 'active') current.auth.startAutoRefresh();
}

/** Whether this device has a saved sign-in for the club. */
export async function hasSavedSession(club: ClubEntry) {
  if (!canStore) return false;
  const ref = new URL(club.supabaseUrl).hostname.split('.')[0];
  const saved = await AsyncStorage.getItem(`sb-${ref}-auth-token`).catch(() => null);
  return !!saved;
}

/** The chosen club's database. Using it before a club is chosen is a bug, so it throws. */
export const supabase = new Proxy({} as Client, {
  get(_target, property) {
    if (!current) throw new Error('No club has been chosen yet.');
    const value = Reflect.get(current, property, current);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});

// Only refresh tokens while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      current?.auth.startAutoRefresh();
    } else {
      current?.auth.stopAutoRefresh();
    }
  });
}
