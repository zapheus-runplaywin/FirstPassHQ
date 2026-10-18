// Removes injury records 12 months after the athlete left the club, the files
// of cleared injuries once they are past the club's keep period, and,
// once an admin has switched on "Remove old records" in Club settings, other
// records past the club's keep periods (public.purge_expired_records() and
// public.purge_expired_surveys()).
//
// Documents go first, through the storage API (deleting storage rows in SQL
// would leave the files behind), then the records. A record is only removed
// once all its documents are gone, so a failed run is finished by the next.
// Which records have expired is decided in the database, in
// public.expired_injury_documents() and public.purge_expired_injuries().
//
// Runs daily from .github/workflows/purge-expired-injuries.yml. It only
// removes records that are already past their 12 months, so an early call
// changes nothing. It is deployed without JWT verification (the workflow has
// no member's sign-in), so instead the workflow sends the PURGE_SECRET function
// secret in the x-purge-key header and anything else is refused. Until that
// secret is set (supabase secrets set PURGE_SECRET=...) the check is skipped,
// so the daily purge keeps working.
//
// The logic is in purge.ts, which Jest tests; this file only builds the real
// client and serves requests.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePurge, serviceKey } from './purge.ts';

Deno.serve((request) =>
  handlePurge(request, {
    env: Deno.env,
    logger: console,
    makeClient: () =>
      createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(Deno.env), {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  }),
);
