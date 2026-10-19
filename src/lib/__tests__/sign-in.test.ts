/**
 * Signing in with Google (src/lib/sign-in.ts), from "Sign in with Google" in
 * section 2 of docs/user-guide.md: Google is the only way in. The browser
 * comes back to the app's auth-callback address with a one-time code, which
 * is swapped for a session. Anything else, such as an error from Google or a
 * missing code, must never sign anyone in.
 */
import * as WebBrowser from 'expo-web-browser';

import { signInWithGoogle } from '@/lib/sign-in';
import { supabase } from '@/lib/supabase';

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `firstpasshq://${path}`,
}));

const auth = supabase.auth as unknown as {
  signInWithOAuth: jest.Mock;
  exchangeCodeForSession: jest.Mock;
};
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;

beforeEach(() => {
  auth.signInWithOAuth = jest.fn(async () => ({
    data: { url: 'https://example.test/auth/v1/authorize?provider=google' },
    error: null,
  }));
  auth.exchangeCodeForSession = jest.fn(async () => ({ data: {}, error: null }));
  openAuthSession.mockReset();
});

it('finishes any sign-in the browser hands back when the app opens', () => {
  expect(WebBrowser.maybeCompleteAuthSession).toHaveBeenCalled();
});

it('asks for Google, returning to the app’s auth-callback, and opens it in the browser itself', async () => {
  openAuthSession.mockResolvedValue({ type: 'success', url: 'firstpasshq://auth-callback?code=abc123' });
  await signInWithGoogle();
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: 'firstpasshq://auth-callback', skipBrowserRedirect: true },
  });
  expect(openAuthSession).toHaveBeenCalledWith(
    'https://example.test/auth/v1/authorize?provider=google',
    'firstpasshq://auth-callback',
  );
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
});

it('reads the code from the fragment too', async () => {
  openAuthSession.mockResolvedValue({ type: 'success', url: 'firstpasshq://auth-callback#code=frag9' });
  await signInWithGoogle();
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('frag9');
});

it.each(['cancel', 'dismiss'])('does nothing when the member closes the browser (%s)', async (kind) => {
  openAuthSession.mockResolvedValue({ type: kind });
  await expect(signInWithGoogle()).resolves.toBeUndefined();
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
});

it('throws Supabase’s error before opening any browser', async () => {
  const refused = new Error('Google sign-in is not enabled');
  auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: refused });
  await expect(signInWithGoogle()).rejects.toBe(refused);
  expect(openAuthSession).not.toHaveBeenCalled();
});

it('shows Google’s description of an error, and signs nobody in', async () => {
  openAuthSession.mockResolvedValue({
    type: 'success',
    url: 'firstpasshq://auth-callback?error=access_denied&error_description=The+user+denied+access&code=ignored',
  });
  await expect(signInWithGoogle()).rejects.toThrow('The user denied access');
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
});

it('falls back to the error code when there is no description', async () => {
  openAuthSession.mockResolvedValue({ type: 'success', url: 'firstpasshq://auth-callback#error=server_error' });
  await expect(signInWithGoogle()).rejects.toThrow('server_error');
});

it('refuses a return with no code', async () => {
  openAuthSession.mockResolvedValue({ type: 'success', url: 'firstpasshq://auth-callback' });
  await expect(signInWithGoogle()).rejects.toThrow('Sign-in did not return a code.');
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
});

it('throws when the code can’t be swapped for a session', async () => {
  openAuthSession.mockResolvedValue({ type: 'success', url: 'firstpasshq://auth-callback?code=old' });
  const expired = new Error('Code expired');
  auth.exchangeCodeForSession.mockResolvedValue({ data: null, error: expired });
  await expect(signInWithGoogle()).rejects.toBe(expired);
});
