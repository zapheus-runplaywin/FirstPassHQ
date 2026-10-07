import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export type Provider = 'google' | 'apple';

/** Native Sign in with Apple is only offered on iOS; other platforms use the browser flow. */
export function usesNativeApple() {
  return Platform.OS === 'ios';
}

/**
 * Where the sign-in browser returns to. Supabase only honours it when it is
 * listed under Authentication > URL Configuration > Redirect URLs; otherwise
 * it falls back to the Site URL. In Expo Go this is an exp:// address that
 * includes your computer's IP.
 */
export function authRedirectUrl() {
  return Linking.createURL('auth-callback');
}

export async function signIn(provider: Provider) {
  if (provider === 'apple' && usesNativeApple()) {
    return signInWithAppleNative();
  }
  return signInWithBrowser(provider);
}

async function signInWithBrowser(provider: Provider) {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
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

async function signInWithAppleNative() {
  // Apple receives a hash of the nonce; Supabase checks the raw value against it.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

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
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }
  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  // Apple only shares the user's name on their very first sign-in.
  const fullName = credential.fullName
    ? AppleAuthentication.formatFullName(credential.fullName).trim()
    : '';
  if (fullName && data.user) {
    await supabase.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
  }
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
