import { Redirect } from 'expo-router';

// The sign-in browser returns here; the session is exchanged in lib/sign-in.ts.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
