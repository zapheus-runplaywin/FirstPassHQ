/**
 * Club logos on "Find your club" (src/lib/club-logos.ts), from "Belonging to
 * more than one club" in section 2 of docs/user-guide.md.
 *
 * Each club has its own project, so a logo must come from that club's own
 * address, never the connected club's, and only from settings this device
 * already saved: nothing is fetched before signing in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { clubInitials, clubLogoUrl, logoFromSaved, useSavedClubLogos } from '@/lib/club-logos';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const THUNDER = {
  code: 'THUNDER',
  name: 'West Coast Thunder',
  supabaseUrl: 'https://thunder.example.test',
  anonKey: 'thunder-key',
};
const DEMO = {
  code: 'DEMO',
  name: 'Perth Pumpkins',
  supabaseUrl: 'https://demo.example.test/',
  anonKey: 'demo-key',
};
const profile = (logo_path: string | null) => JSON.stringify({ club_name: 'x', logo_path });

describe('clubLogoUrl', () => {
  it('points at the club’s own project, as supabase-js would', () => {
    expect(clubLogoUrl(THUNDER, 'logo-1.png')).toBe(
      'https://thunder.example.test/storage/v1/object/public/club-branding/logo-1.png',
    );
  });

  it('copes with a trailing slash on the address and a leading one on the path', () => {
    expect(clubLogoUrl(DEMO, '/logo-2.jpg')).toBe(
      'https://demo.example.test/storage/v1/object/public/club-branding/logo-2.jpg',
    );
  });
});

describe('clubInitials', () => {
  it.each([
    ['Perth Pumpkins', 'PP'],
    ['West Coast Thunder', 'WCT'],
    ['Hawks Netball Club Incorporated', 'HNC'],
    ['  lightning   academy ', 'LA'],
    ['20 & Under', '2U'],
    ['Ōtautahi Owls', 'ŌO'],
    ['', '?'],
    ['&&', '?'],
  ])('%s → %s', (name, initials) => {
    expect(clubInitials(name)).toBe(initials);
  });
});

describe('logoFromSaved', () => {
  it('gives the saved logo at the club’s address', () => {
    expect(logoFromSaved(THUNDER, profile('logo-9.png'))).toBe(
      'https://thunder.example.test/storage/v1/object/public/club-branding/logo-9.png',
    );
  });

  it.each([
    ['nothing saved', null],
    ['no logo uploaded', profile(null)],
    ['a blank logo', profile('  ')],
    ['a damaged save', '{not json'],
    ['a saved null', 'null'],
    ['a logo that isn’t text', JSON.stringify({ logo_path: 42 })],
  ])('gives none for %s', (_label, saved) => {
    expect(logoFromSaved(THUNDER, saved)).toBeNull();
  });
});

describe('useSavedClubLogos', () => {
  beforeEach(() => AsyncStorage.clear());

  async function logosFor(clubs: (typeof THUNDER)[]) {
    const hook = await renderHook(() => useSavedClubLogos(clubs));
    await act(async () => {});
    return hook.result.current;
  }

  it('reads each club’s own saved settings, and none for a club never opened here', async () => {
    await AsyncStorage.setItem('club-profile:DEMO', profile('logo-demo.png'));
    expect(await logosFor([THUNDER, DEMO])).toEqual({
      THUNDER: null,
      DEMO: 'https://demo.example.test/storage/v1/object/public/club-branding/logo-demo.png',
    });
  });

  it('never shows one club’s logo for another', async () => {
    await AsyncStorage.setItem('club-profile:THUNDER', profile('logo-thunder.png'));
    const logos = await logosFor([THUNDER, DEMO]);
    expect(logos.DEMO).toBeNull();
    expect(logos.THUNDER).toContain('https://thunder.example.test/');
  });

  it('reads nothing when there are no clubs', async () => {
    const spy = jest.spyOn(AsyncStorage, 'multiGet');
    spy.mockClear();
    expect(await logosFor([])).toEqual({});
    expect(spy).not.toHaveBeenCalledWith([]);
    spy.mockRestore();
  });

  it('shows initials everywhere when the device’s storage can’t be read', async () => {
    const spy = jest.spyOn(AsyncStorage, 'multiGet').mockRejectedValueOnce(new Error('locked'));
    expect(await logosFor([THUNDER])).toEqual({ THUNDER: null });
    spy.mockRestore();
  });
});
