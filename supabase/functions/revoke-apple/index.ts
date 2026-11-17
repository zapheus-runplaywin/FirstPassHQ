// Revokes a member's Sign in with Apple as they delete their account. The
// logic is in revoke.ts, which Jest tests; this file only reads the member
// from their own sign-in and serves requests.
//
// Deployed with JWT verification on, so only signed-in members reach it, by
// .github/workflows/revoke-apple-function.yml (only when someone presses Run
// workflow). Its secrets (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY) and
// deploying to other clubs are in docs/new-club-setup.md.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { anonKey, appleIdsOf, handleRevoke } from './revoke.ts';

Deno.serve((request) =>
  handleRevoke(request, {
    env: Deno.env,
    logger: console,
    fetch,
    async member(authorization) {
      const client = createClient(Deno.env.get('SUPABASE_URL')!, anonKey(Deno.env), {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return null;
      return {
        id: data.user.id,
        identities: (data.user.identities ?? []).map((i) => ({ provider: i.provider, ids: appleIdsOf(i) })),
      };
    },
  }),
);
