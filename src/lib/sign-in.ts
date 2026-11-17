import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { logger } from '@/lib/log';
import { supabase } from '@/lib/supabase';

const log = logger('sign-in');

WebBrowser.maybeCompleteAuthSession();

/**
 * Where the sign-in browser returns to. Supabase only honours it when it is
 * listed under Authentication > URL Configuration > Redirect URLs; otherwise
 * it falls back to the Site URL. In Expo Go this is an exp:// address that
 * includes your computer's IP.
 */
function authRedirectUrl() {
  return Linking.createURL('auth-callback');
}

/** Members sign in with their Google account, in the browser. */
export async function signInWithGoogle() {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return;

  const params = readUrlParams(result.url);
  if (params.error) {
    throw new Error(params.error_description ?? params.error);
  }
  if (!params.code) {
    throw new Error('Sign-in did not return a code.');
  }
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
  if (exchangeError) throw exchangeError;
}

/**
 * Whether to offer Sign in with Apple: only on an iPhone or iPad where Apple
 * says it is available. Android and the web stay Google only, because Apple
 * there needs a web flow with a secret key that expires every 6 months.
 */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Members on an iPhone can sign in with their Apple Account instead. Apple
 * signs an identity token for our app, carrying the hash of a one-time value
 * we make here; Supabase checks both before it finds or creates the user, so
 * a token can't be replayed. Cancelling Apple's sheet is not an error.
 */
export async function signInWithApple() {
  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }

  if (!credential.identityToken) {
    throw new Error('Apple didn’t return a sign-in. Please try again.');
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;

  // Apple gives the name only on the first sign-in, and never in the token,
  // so it's saved to the sign-in's details for the join form, as Supabase's
  // Apple guide recommends. A failed save never stops the sign-in.
  const fullName = appleFullName(credential.fullName);
  if (fullName) {
    try {
      const { error: saveError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
      if (saveError) log.warn('Could not save the name Apple gave', { kind: saveError.name });
    } catch (e) {
      log.warn('Could not save the name Apple gave', { kind: (e as Error | null)?.name ?? 'unknown' });
    }
  }
}

/** "Given Middle Family" from Apple's name parts, or null when Apple sent none. */
export function appleFullName(
  name: AppleAuthentication.AppleAuthenticationFullName | null | undefined,
): string | null {
  const parts = [name?.givenName, name?.middleName, name?.familyName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  return parts.length ? parts.join(' ') : null;
}

/** The name a sign-in carries (Google's, or the one saved from Apple), if any. */
export function nameFromSignIn(metadata: Record<string, unknown> | null | undefined): string | null {
  for (const key of ['full_name', 'name']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Apple's "Hide My Email" gives the app a relay address instead of the real
 * one. An admin can't match that to PlayHQ, so the join form then asks for
 * the PlayHQ email.
 */
export function isHiddenAppleEmail(email: string | null | undefined): boolean {
  return /@privaterelay\.appleid\.com$/i.test(email?.trim() ?? '');
}

function readUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const fragment = url.split('#')[1] ?? '';
  for (const part of [query, fragment]) {
    new URLSearchParams(part).forEach((value, key) => {
      params[key] = value;
    });
  }
  return params;
}
