/**
 * Which club, and so which club's database, the app connects to
 * (src/lib/club-choice.tsx), from "Find your club" and "Belonging to more
 * than one club" in section 2 of docs/user-guide.md.
 *
 * Each club has its own Supabase project, so the choice decides whose
 * records the app can reach: an unknown code must never connect, and
 * switching club forgets the current choice but keeps the list of clubs used
 * on this device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ClubChoiceProvider, useClubChoice } from '@/lib/club-choice';
import { connectToClub } from '@/lib/supabase';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// The club list reads the build's env; this build knows two clubs.
jest.mock('@/constants/clubs', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://thunder.example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'thunder-key';
  process.env.EXPO_PUBLIC_CLUB_CODE = 'THUNDER';
  process.env.EXPO_PUBLIC_CLUB_NAME = 'West Coast Thunder';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_CODE = 'storm';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_NAME = 'Sample Storm';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_URL = 'https://storm.example.test';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY = 'storm-key';
  return jest.requireActual('@/constants/clubs');
});

const THUNDER = {
  code: 'THUNDER',
  name: 'West Coast Thunder',
  supabaseUrl: 'https://thunder.example.test',
  anonKey: 'thunder-key',
};
const STORM = {
  code: 'STORM',
  name: 'Sample Storm',
  supabaseUrl: 'https://storm.example.test',
  anonKey: 'storm-key',
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <ClubChoiceProvider>{children}</ClubChoiceProvider>
);

async function openWith(saved: Record<string, string> = {}) {
  await AsyncStorage.clear();
  if (Object.keys(saved).length > 0) await AsyncStorage.multiSet(Object.entries(saved));
  (connectToClub as jest.Mock).mockClear();
  const hook = renderHook(() => useClubChoice(), { wrapper });
  await act(async () => {});
  return hook;
}

const stored = async (key: string) => AsyncStorage.getItem(key);

describe('on first open', () => {
  it('has no club and connects to nothing until a code is entered', async () => {
    const { result } = await openWith();
    expect(result.current.ready).toBe(true);
    expect(result.current.club).toBeNull();
    expect(result.current.recent).toEqual([]);
    expect(connectToClub).not.toHaveBeenCalled();
  });
});

describe('a club picked before on this device', () => {
  it('connects straight to it, with the clubs used before', async () => {
    const { result } = await openWith({
      'club-code': 'STORM',
      'club-codes-used': JSON.stringify(['STORM', 'THUNDER']),
    });
    expect(result.current.club).toEqual(STORM);
    expect(connectToClub).toHaveBeenCalledTimes(1);
    expect(connectToClub).toHaveBeenCalledWith(STORM);
    expect(result.current.recent).toEqual([STORM, THUNDER]);
  });

  it('a saved club this build no longer knows connects to nothing', async () => {
    const { result } = await openWith({ 'club-code': 'GONE' });
    expect(result.current.ready).toBe(true);
    expect(result.current.club).toBeNull();
    expect(connectToClub).not.toHaveBeenCalled();
  });

  it('drops clubs this build no longer knows from the list', async () => {
    const { result } = await openWith({
      'club-codes-used': JSON.stringify(['GONE', 'THUNDER', 42]),
    });
    expect(result.current.recent).toEqual([THUNDER]);
  });

  it.each([
    ['not JSON', '{oops'],
    ['not a list', JSON.stringify({ code: 'THUNDER' })],
  ])('ignores a saved list that is %s', async (_l, saved) => {
    const { result } = await openWith({ 'club-codes-used': saved });
    expect(result.current.ready).toBe(true);
    expect(result.current.recent).toEqual([]);
  });

  it('still opens, with no club, when the device storage fails', async () => {
    await AsyncStorage.clear();
    (AsyncStorage.multiGet as jest.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error('disk')),
    );
    const { result } = renderHook(() => useClubChoice(), { wrapper });
    await act(async () => {});
    expect(result.current.ready).toBe(true);
    expect(result.current.club).toBeNull();
  });
});

describe('choosing a club', () => {
  it('ignores case and spaces in the code, connects and remembers it', async () => {
    const { result } = await openWith();
    let found = false;
    await act(async () => {
      found = result.current.choose(' st orm ');
    });
    expect(found).toBe(true);
    expect(connectToClub).toHaveBeenCalledWith(STORM);
    expect(result.current.club).toEqual(STORM);
    expect(result.current.recent).toEqual([STORM]);
    expect(await stored('club-code')).toBe('STORM');
    expect(JSON.parse((await stored('club-codes-used'))!)).toEqual(['STORM']);
  });

  it('a code no club has is refused and connects to nothing', async () => {
    const { result } = await openWith({ 'club-code': 'THUNDER' });
    (connectToClub as jest.Mock).mockClear();
    let found = true;
    await act(async () => {
      found = result.current.choose('NOTACLUB');
    });
    expect(found).toBe(false);
    expect(connectToClub).not.toHaveBeenCalled();
    expect(result.current.club).toEqual(THUNDER);
    expect(await stored('club-code')).toBe('THUNDER');
  });

  it.each(['', '   '])('a blank code %p is refused', async (code) => {
    const { result } = await openWith();
    expect(result.current.choose(code)).toBe(false);
    expect(connectToClub).not.toHaveBeenCalled();
  });

  it('puts the latest club first in the list, once', async () => {
    const { result } = await openWith({
      'club-code': 'THUNDER',
      'club-codes-used': JSON.stringify(['THUNDER', 'STORM']),
    });
    await act(async () => {
      result.current.choose('STORM');
    });
    expect(result.current.recent).toEqual([STORM, THUNDER]);
    expect(JSON.parse((await stored('club-codes-used'))!)).toEqual(['STORM', 'THUNDER']);
  });
});

describe('switching club', () => {
  it('forgets the current club but keeps the clubs used before', async () => {
    const { result } = await openWith({
      'club-code': 'THUNDER',
      'club-codes-used': JSON.stringify(['THUNDER']),
    });
    await act(async () => {
      result.current.switchClub();
    });
    expect(result.current.club).toBeNull();
    expect(result.current.recent).toEqual([THUNDER]);
    expect(await stored('club-code')).toBeNull();
    expect(await stored('club-codes-used')).toBe(JSON.stringify(['THUNDER']));
  });
});

it('is only usable inside ClubChoiceProvider', () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  function Bare() {
    useClubChoice();
    return null;
  }
  expect(() => render(<Bare />)).toThrow('useClubChoice must be used inside ClubChoiceProvider');
  error.mockRestore();
});
