/**
 * Signing in (src/lib/sign-in.ts), from "Signing in" in section 2 of
 * docs/user-guide.md.
 *
 * Google: the browser comes back to the app's auth-callback address with a
 * one-time code, which is swapped for a session. Anything else, such as an
 * error from Google or a missing code, must never sign anyone in.
 *
 * Apple (iPhone only): Apple signs an identity token carrying the SHA-256 of a
 * one-time value; Supabase gets the token and the value itself, so it can
 * check the two match. Cancelling is silent; anything else signs nobody in.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  appleSignInAvailable,
  isHiddenAppleEmail,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/sign-in';
import { supabase } from '@/lib/supabase';

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `firstpasshq://${path}`,
}));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'one-time-value'),
  digestStringAsync: jest.fn(async (algorithm: string, value: string) => `${algorithm}(${value})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const auth = supabase.auth as unknown as {
  signInWithOAuth: jest.Mock;
  exchangeCodeForSession: jest.Mock;
  signInWithIdToken: jest.Mock;
};
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const appleAvailable = AppleAuthentication.isAvailableAsync as jest.Mock;
const appleSignIn = AppleAuthentication.signInAsync as jest.Mock;

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

describe('Sign in with Apple', () => {
  const realOS = Platform.OS;
  function onPlatform(os: typeof Platform.OS) {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  }

  beforeEach(() => {
    onPlatform('ios');
    appleAvailable.mockReset().mockResolvedValue(true);
    appleSignIn.mockReset().mockResolvedValue({
      user: 'apple-user-1',
      identityToken: 'apple.identity.token',
      authorizationCode: 'short-lived-code',
      email: null,
      fullName: null,
      realUserStatus: 2,
      state: null,
    });
    auth.signInWithIdToken = jest.fn(async () => ({ data: {}, error: null }));
    (Crypto.randomUUID as jest.Mock).mockClear();
  });

  afterAll(() => onPlatform(realOS));

  describe('where it is offered', () => {
    it('on an iPhone where Apple says it is available', async () => {
      await expect(appleSignInAvailable()).resolves.toBe(true);
    });

    it('not on an iPhone where Apple says it is not', async () => {
      appleAvailable.mockResolvedValue(false);
      await expect(appleSignInAvailable()).resolves.toBe(false);
    });

    it('not when asking Apple fails', async () => {
      appleAvailable.mockRejectedValue(new Error('no module'));
      await expect(appleSignInAvailable()).resolves.toBe(false);
    });

    it.each(['android', 'web'] as const)('never on %s, without even asking Apple', async (os) => {
      onPlatform(os);
      await expect(appleSignInAvailable()).resolves.toBe(false);
      expect(appleAvailable).not.toHaveBeenCalled();
    });
  });

  it('asks Apple for name and email with the hash of a fresh one-time value, and gives Supabase the value itself', async () => {
    await signInWithApple();
    expect(appleSignIn).toHaveBeenCalledWith({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: 'SHA-256(one-time-value)',
    });
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple.identity.token',
      nonce: 'one-time-value',
    });
  });

  it('makes a new one-time value every time', async () => {
    (Crypto.randomUUID as jest.Mock).mockReturnValueOnce('first').mockReturnValueOnce('second');
    await signInWithApple();
    await signInWithApple();
    expect(auth.signInWithIdToken.mock.calls.map(([a]) => a.nonce)).toEqual(['first', 'second']);
    expect(appleSignIn.mock.calls.map(([a]) => a.nonce)).toEqual(['SHA-256(first)', 'SHA-256(second)']);
  });

  it('does nothing when the member cancels Apple’s sheet', async () => {
    appleSignIn.mockRejectedValue(Object.assign(new Error('The user canceled'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(signInWithApple()).resolves.toBeUndefined();
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('passes on any other error from Apple, and signs nobody in', async () => {
    const failed = Object.assign(new Error('The authorization attempt failed'), { code: 'ERR_REQUEST_FAILED' });
    appleSignIn.mockRejectedValue(failed);
    await expect(signInWithApple()).rejects.toBe(failed);
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('passes on a failure that isn’t an error object', async () => {
    appleSignIn.mockRejectedValue(null);
    await expect(signInWithApple()).rejects.toBeNull();
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('refuses an Apple answer with no identity token', async () => {
    appleSignIn.mockResolvedValue({ user: 'apple-user-1', identityToken: null });
    await expect(signInWithApple()).rejects.toThrow('Apple didn’t return a sign-in. Please try again.');
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('throws when Supabase refuses the token', async () => {
    const refused = new Error('Provider (issuer "https://appleid.apple.com") is not enabled');
    auth.signInWithIdToken.mockResolvedValue({ data: null, error: refused });
    await expect(signInWithApple()).rejects.toBe(refused);
  });
});

describe('Apple’s hidden email', () => {
  it.each([
    ['abc123xyz@privaterelay.appleid.com', true],
    ['ABC@PrivateRelay.AppleID.com', true],
    [' abc@privaterelay.appleid.com ', true],
    ['someone@icloud.com', false],
    ['someone@gmail.com', false],
    // Not a relay address, only a lookalike.
    ['privaterelay.appleid.com@example.test', false],
    ['abc@privaterelay.appleid.com.example.test', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%p is hidden: %p', (email, hidden) => {
    expect(isHiddenAppleEmail(email)).toBe(hidden);
  });
});
