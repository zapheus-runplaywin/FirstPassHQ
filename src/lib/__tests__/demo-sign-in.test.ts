/**
 * Signing in to the demo club (docs/environments.md, "The demo club"): an
 * email and password, for the demo club only, never for the club the build is
 * made for.
 */
import { findClub } from '@/constants/clubs';
import { signInToDemoClub } from '@/lib/demo-sign-in';
import { supabase } from '@/lib/supabase';

// This build is made for THUNDER and was given the demo club's variables.
jest.mock('@/constants/clubs', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://live.example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'live-key';
  process.env.EXPO_PUBLIC_CLUB_CODE = 'THUNDER';
  process.env.EXPO_PUBLIC_DEMO_CLUB_URL = 'https://test.example.test';
  process.env.EXPO_PUBLIC_DEMO_CLUB_ANON_KEY = 'test-key';
  return jest.requireActual('@/constants/clubs');
});

describe('signing in to the demo club', () => {
  const password = supabase.auth as unknown as { signInWithPassword: jest.Mock };
  const demo = () => findClub('DEMO');
  beforeEach(() => {
    password.signInWithPassword = jest.fn(async () => ({ data: {}, error: null }));
  });

  it('signs in with the demo account’s email, trimmed and in lower case, and its password', async () => {
    await signInToDemoClub(demo(), '  Coach@Demo.FirstPass.example ', 'pass word ');
    expect(password.signInWithPassword).toHaveBeenCalledWith({
      email: 'coach@demo.firstpass.example',
      password: 'pass word ',
    });
  });

  it.each([
    ['the home club', () => findClub('THUNDER')],
    ['the home club given the demo flag', () => ({ ...findClub('THUNDER')!, demo: true as const })],
    ['no club', () => null],
  ])('never signs in to %s with a password', async (_label, club) => {
    await expect(signInToDemoClub(club(), 'coach@demo.firstpass.example', 'secret')).rejects.toThrow(
      'Only the demo club signs in with a password.',
    );
    expect(password.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'secret'],
    ['   ', 'secret'],
    ['coach@demo.firstpass.example', ''],
  ])('asks for both the email and the password (%j, %j)', async (email, pass) => {
    await expect(signInToDemoClub(demo(), email, pass)).rejects.toThrow(
      'Enter the demo account’s email and password.',
    );
    expect(password.signInWithPassword).not.toHaveBeenCalled();
  });

  it('a wrong password gets a plain message', async () => {
    password.signInWithPassword.mockResolvedValue({
      data: {},
      error: Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400 }),
    });
    await expect(signInToDemoClub(demo(), 'coach@demo.firstpass.example', 'wrong')).rejects.toThrow(
      'That email and password don’t match a demo account.',
    );
  });

  it('anything else, such as the test project being paused, says to try again', async () => {
    password.signInWithPassword.mockResolvedValue({
      data: {},
      error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 }),
    });
    await expect(signInToDemoClub(demo(), 'coach@demo.firstpass.example', 'secret')).rejects.toThrow(
      'Couldn’t sign in to the demo club. Please try again.',
    );
  });
});
