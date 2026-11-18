/**
 * Signing in to the demo club (docs/environments.md, "The demo club"). Kept
 * apart from sign-in.ts so only the sign-in screen loads the club list here.
 */
import { isDemoClub, type ClubEntry } from '@/constants/clubs';
import { logger } from '@/lib/log';
import { supabase } from '@/lib/supabase';

const log = logger('demo-sign-in');

/**
 * Reviewers and testers sign in to the demo club with a demo account's email
 * and password (docs/environments.md, "The demo club"). Refused for any other
 * club, so a real club can never be signed in to with a password from here;
 * the live project's Email provider is off as well.
 */
export async function signInToDemoClub(
  club: ClubEntry | null | undefined,
  email: string,
  password: string,
) {
  if (!isDemoClub(club)) {
    throw new Error('Only the demo club signs in with a password.');
  }
  const address = email.trim().toLowerCase();
  if (!address || !password) {
    throw new Error('Enter the demo account’s email and password.');
  }
  const { error } = await supabase.auth.signInWithPassword({ email: address, password });
  if (error) {
    log.warn('Demo club sign-in failed', { kind: error.name, status: error.status ?? null });
    if (error.status === 400 || /invalid login credentials/i.test(error.message)) {
      throw new Error('That email and password don’t match a demo account.');
    }
    throw new Error('Couldn’t sign in to the demo club. Please try again.');
  }
}
