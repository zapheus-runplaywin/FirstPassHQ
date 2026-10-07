// Removes injury records 12 months after the athlete left the club.
//
// Documents go first, through the storage API (deleting storage rows in SQL
// would leave the files behind), then the records. A record is only removed
// once all its documents are gone, so a failed run is finished by the next.
// Which records have expired is decided in the database, in
// public.expired_injury_documents() and public.purge_expired_injuries().
//
// Runs daily from .github/workflows/purge-expired-injuries.yml. It only
// removes records that are already past their 12 months, so it is safe for
// anyone to call and is deployed without JWT verification.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'injury-documents';
// The storage API removes up to 1000 files per call.
const BATCH = 500;

function serviceKey() {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No service key available to the function');
  return legacy;
}

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: paths, error: listError } = await supabase.rpc('expired_injury_documents');
  if (listError) return Response.json({ error: listError.message }, { status: 500 });

  const names = (paths ?? []) as string[];
  for (let i = 0; i < names.length; i += BATCH) {
    const { error } = await supabase.storage.from(BUCKET).remove(names.slice(i, i + BATCH));
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  const { data: purged, error: purgeError } = await supabase.rpc('purge_expired_injuries');
  if (purgeError) return Response.json({ error: purgeError.message }, { status: 500 });

  return Response.json({ documents: names.length, injuries: purged });
});
