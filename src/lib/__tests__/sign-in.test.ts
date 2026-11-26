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
  appleFullName,
  appleSignInAvailable,
  isHiddenAppleEmail,
  nameFromSignIn,
  REVOKE_TIMEOUT_MS,
  revokeAppleSignIn,
  signInWithApple,
  signInWithGoogle,
  signInMethod,
  usesAppleSignIn,
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
  updateUser: jest.Mock;
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
    auth.updateUser = jest.fn(async () => ({ data: {}, error: null }));
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

  describe('the name Apple gives on the first sign-in', () => {
    const name = { givenName: 'Sample', middleName: null, familyName: 'Member', namePrefix: null, nameSuffix: null, nickname: null };

    it('is saved to the sign-in after signing in, for the join form', async () => {
      appleSignIn.mockResolvedValue({ identityToken: 'apple.identity.token', fullName: name });
      await signInWithApple();
      expect(auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Sample Member' } });
      expect(auth.signInWithIdToken.mock.invocationCallOrder[0]).toBeLessThan(
        auth.updateUser.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['no name (every sign-in after the first)', null],
      ['an empty name', { givenName: null, middleName: null, familyName: '  ' }],
    ])('saves nothing when Apple sends %s', async (_label, fullName) => {
      appleSignIn.mockResolvedValue({ identityToken: 'apple.identity.token', fullName });
      await signInWithApple();
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it('is never saved when the sign-in fails', async () => {
      appleSignIn.mockResolvedValue({ identityToken: 'apple.identity.token', fullName: name });
      auth.signInWithIdToken.mockResolvedValue({ data: null, error: new Error('refused') });
      await expect(signInWithApple()).rejects.toThrow('refused');
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it.each([
      ['refuses', () => auth.updateUser.mockResolvedValue({ data: null, error: new Error('nope') })],
      ['throws', () => auth.updateUser.mockRejectedValue(new Error('offline'))],
      ['throws something odd', () => auth.updateUser.mockRejectedValue(null)],
    ])('still signs in when saving it %s', async (_label, arrange) => {
      arrange();
      appleSignIn.mockResolvedValue({ identityToken: 'apple.identity.token', fullName: name });
      await expect(signInWithApple()).resolves.toBeUndefined();
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

describe('names from a sign-in', () => {
  it.each([
    [{ givenName: 'Sample', middleName: 'Middle', familyName: 'Member' }, 'Sample Middle Member'],
    [{ givenName: ' Sample ', middleName: null, familyName: 'Member' }, 'Sample Member'],
    [{ givenName: null, middleName: null, familyName: 'Member' }, 'Member'],
    [{ givenName: '', middleName: '', familyName: '' }, null],
    [null, null],
    [undefined, null],
  ])('Apple’s %j is %p', (parts, expected) => {
    expect(appleFullName(parts as never)).toBe(expected);
  });

  it.each([
    [{ full_name: 'Sample Member', name: 'Other' }, 'Sample Member'],
    [{ name: ' Sample Google ' }, 'Sample Google'],
    [{ full_name: '  ', name: 'Fallback' }, 'Fallback'],
    [{ full_name: 7 }, null],
    [{}, null],
    [null, null],
    [undefined, null],
  ])('the sign-in’s %j is %p', (metadata, expected) => {
    expect(nameFromSignIn(metadata as never)).toBe(expected);
  });
});

describe('revoking Sign in with Apple when the account is deleted', () => {
  const realOS = Platform.OS;
  const functions = supabase as unknown as { functions: { invoke: jest.Mock } };

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    appleAvailable.mockReset().mockResolvedValue(true);
    appleSignIn.mockReset().mockResolvedValue({ user: 'apple-user-1', authorizationCode: 'fresh-code', identityToken: 'x' });
    functions.functions = { invoke: jest.fn(async () => ({ data: { revoked: true }, error: null })) };
  });
  afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

  it('asks Apple to confirm, asking for nothing about the person, and sends the fresh code to revoke-apple', async () => {
    await expect(revokeAppleSignIn()).resolves.toBe('revoked');
    expect(appleSignIn).toHaveBeenCalledWith({ requestedScopes: [] });
    expect(functions.functions.invoke).toHaveBeenCalledWith('revoke-apple', {
      body: { authorization_code: 'fresh-code' },
      // Bounded, so the delete button is never held for long.
      timeout: REVOKE_TIMEOUT_MS,
    });
    expect(REVOKE_TIMEOUT_MS).toBe(15_000);
  });

  it('says cancelled, and calls nothing, when the member cancels Apple’s sheet', async () => {
    appleSignIn.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(revokeAppleSignIn()).resolves.toBe('cancelled');
    expect(functions.functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['Apple fails', () => appleSignIn.mockRejectedValue(Object.assign(new Error('x'), { code: 'ERR_REQUEST_FAILED' }))],
    ['Apple fails with no code', () => appleSignIn.mockRejectedValue(null)],
    ['Apple returns no code', () => appleSignIn.mockResolvedValue({ user: 'u', authorizationCode: null })],
  ])('says failed, and calls nothing, when %s', async (_label, arrange) => {
    arrange();
    await expect(revokeAppleSignIn()).resolves.toBe('failed');
    expect(functions.functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['the club’s Apple key isn’t set', { name: 'FunctionsHttpError', context: new Response('{}', { status: 503 }) }],
    ['the function can’t be reached', { name: 'FunctionsFetchError', context: undefined }],
    ['the call times out', { name: 'FunctionsFetchError', context: new DOMException('aborted', 'AbortError') }],
  ])('says failed when %s', async (_label, error) => {
    functions.functions.invoke.mockResolvedValue({ data: null, error });
    await expect(revokeAppleSignIn()).resolves.toBe('failed');
  });

  it('says failed without asking Apple where Apple sign-in isn’t available', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    await expect(revokeAppleSignIn()).resolves.toBe('failed');
    expect(appleSignIn).not.toHaveBeenCalled();
  });
});

describe('who signed in with Apple', () => {
  it.each([
    [{ app_metadata: { provider: 'apple', providers: ['apple'] } }, true],
    [{ app_metadata: { provider: 'google', providers: ['google', 'apple'] } }, true],
    [{ app_metadata: { provider: 'apple' } }, true],
    [{ app_metadata: { provider: 'google', providers: ['google'] } }, false],
    [{ app_metadata: { provider: 'google', providers: 'apple' } }, false],
    [{ app_metadata: {} }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ])('%j: %p', (user, expected) => {
    expect(usesAppleSignIn(user as never)).toBe(expected);
  });
});

describe('which account a member signs in with, for My account', () => {
  it.each([
    [{ app_metadata: { provider: 'apple', providers: ['apple'] } }, 'Apple'],
    // Apple wins when both are linked: it is the one Apple asks about on delete.
    [{ app_metadata: { provider: 'google', providers: ['google', 'apple'] } }, 'Apple'],
    [{ app_metadata: { provider: 'google', providers: ['google'] } }, 'Google'],
    [{ app_metadata: { provider: 'google' } }, 'Google'],
    [{ app_metadata: { providers: ['google'] } }, 'Google'],
    [{ app_metadata: { provider: 'email', providers: ['email'] } }, null],
    [{ app_metadata: { provider: 'google', providers: 'google' } }, 'Google'],
    [{ app_metadata: { provider: 'email', providers: 'google' } }, null],
    [{ app_metadata: {} }, null],
    [{}, null],
    [null, null],
    [undefined, null],
  ])('%j: %p', (user, expected) => {
    expect(signInMethod(user as never)).toBe(expected);
  });
});
