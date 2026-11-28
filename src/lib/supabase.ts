import 'react-native-url-polyfill/auto';
import '@/lib/crypto-polyfill';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { ClubEntry } from '@/constants/clubs';
import { SecureSessionStore } from '@/lib/secure-session-store';

// AsyncStorage is unavailable during static web rendering.
const canStore = Platform.OS !== 'web' || typeof window !== 'undefined';
// On a phone the session is encrypted with a key in the keychain; the web
// keeps the browser's own storage.
const sessionStorage = Platform.OS === 'web' ? AsyncStorage : new SecureSessionStore();

function makeClient(club: ClubEntry) {
  return createClient(club.supabaseUrl, club.anonKey, {
    auth: {
      // Sessions are saved under a key named after the club's project, so each
      // club keeps its own sign-in on this device.
      ...(canStore ? { storage: sessionStorage } : {}),
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

/**
 * Forgets this device's sign-in to a club, as when the club is removed from
 * Find your club. Each club keeps its own session, so this signs out of that
 * club only ("local" scope: other phones stay signed in). A failure, such as
 * no signal, still clears the saved session on this device.
 */
export async function signOutOfClub(club: ClubEntry) {
  const client = clients.get(club.code) ?? makeClient(club);
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // supabase-js clears the saved session even when the server can't be told.
  }
  if (client !== current) {
    client.auth.stopAutoRefresh();
    clients.delete(club.code);
  }
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
