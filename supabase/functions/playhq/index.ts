// Reads a PlayHQ competition season's teams and games for club admins, and
// for the season view in FirstPass Vision, a team's results in games nobody
// recorded, for the people who already see that team's games (results.ts).
//
// It uses PlayHQ's public GraphQL API, the one playhq.com uses, which needs no
// client ID. That API only answers requests that look like they come from
// playhq.com, which the app can't send from a web browser, so the app asks
// this function instead. Only admins can read a competition; the app then
// saves the games with save_playhq_fixtures.
//
// Deployed from .github/workflows/playhq-function.yml. The logic, and
// everything that depends on PlayHQ's schema, is in fixtures.ts and results.ts,
// which Jest tests; this file only builds the real client and serves requests.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { anonKey } from './fixtures.ts';
import { handle } from './results.ts';

Deno.serve((request) =>
  handle(request, {
    fetch: (input, init) => fetch(input, init),
    logger: console,
    makeClient: (authorization) =>
      createClient(Deno.env.get('SUPABASE_URL')!, anonKey(Deno.env), {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  }),
);
