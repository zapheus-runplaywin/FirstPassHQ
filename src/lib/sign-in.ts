import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

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
