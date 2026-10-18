// The purge's logic, kept free of Deno globals and npm: imports so Jest can
// test it (supabase/functions/purge-expired-injuries/__tests__). index.ts is
// the Deno wrapper that builds the real Supabase client and serves it.
//
// Documents go first, through the storage API (deleting storage rows in SQL
// would leave the files behind), then the records. A record is only removed
// once all its documents are gone, so a failed run is finished by the next.

export const BUCKET = 'injury-documents';
export const CERTIFICATES = 'training-certificates';
export const SESSION_PLANS = 'session-plans';
// The storage API removes up to 1000 files per call.
export const BATCH = 500;

/** Reads the function's secrets: Deno.env in the function, a stub in tests. */
export type Env = { get(name: string): string | undefined };

export type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

/** The parts of the Supabase client the purge uses. */
export interface PurgeClient {
  rpc(fn: string): PromiseLike<Result<unknown>>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export function serviceKey(env: Env) {
  const keys = env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const legacy = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No service key available to the function');
  return legacy;
}

/** True when the request carries the purge secret, or none is set yet. */
export function allowed(request: Request, env: Env, logger: Logger) {
  const secret = env.get('PURGE_SECRET');
  if (!secret) {
    logger.warn('PURGE_SECRET is not set, so anyone can run the purge. Set it with supabase secrets set.');
    return true;
  }
  const given = request.headers.get('x-purge-key') ?? '';
  // Compared byte by byte in constant time, so timing gives nothing away.
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(secret);
  let differ = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    differ |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return differ === 0;
}

export type PurgeDeps = {
  env: Env;
  logger: Logger;
  /** Builds the service-role client; only called once the caller is allowed. */
  makeClient: () => PurgeClient;
};

/** The whole request: method and secret checks, then the purge. */
export async function handlePurge(request: Request, deps: PurgeDeps): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!allowed(request, deps.env, deps.logger)) return new Response('Forbidden', { status: 403 });
  return runPurge(deps.makeClient(), deps.logger);
}

/** Removes expired files, then records, stopping at the first error. */
export async function runPurge(supabase: PurgeClient, logger: Logger): Promise<Response> {
  /** Logs the detail and tells the caller only that it failed. */
  function failed(step: string, message: string) {
    logger.error(`Purge failed while ${step}: ${message}`);
    return Response.json({ error: `Failed while ${step}` }, { status: 500 });
  }

  const { data: paths, error: listError } = await supabase.rpc('expired_injury_documents');
  if (listError) return failed('listing expired documents', listError.message);

  const names = (paths ?? []) as string[];
  for (let i = 0; i < names.length; i += BATCH) {
    const { error } = await supabase.storage.from(BUCKET).remove(names.slice(i, i + BATCH));
    if (error) return failed('removing documents', error.message);
  }

  const { data: purged, error: purgeError } = await supabase.rpc('purge_expired_injuries');
  if (purgeError) return failed('purging injuries', purgeError.message);

  // Files of cleared injuries past the club's keep period go too, while the
  // injury and the record of each document stay. Nothing is listed while
  // removal is switched off.
  const { data: clearedPaths, error: clearedError } = await supabase.rpc(
    'cleared_injury_documents',
  );
  if (clearedError) return failed('listing cleared injury documents', clearedError.message);
  const cleared = (clearedPaths ?? []) as string[];
  for (let i = 0; i < cleared.length; i += BATCH) {
    const { error } = await supabase.storage.from(BUCKET).remove(cleared.slice(i, i + BATCH));
    if (error) return failed('removing cleared injury documents', error.message);
  }
  const { data: marked, error: markError } = await supabase.rpc('mark_removed_injury_documents');
  if (markError) return failed('marking removed injury documents', markError.message);

  // Training certificate files past the club's keep period go before their
  // records, the same way. Nothing is listed while removal is switched off.
  const { data: certificatePaths, error: certificateError } = await supabase.rpc(
    'expired_certificate_documents',
  );
  if (certificateError) return failed('listing expired certificates', certificateError.message);
  const certificates = (certificatePaths ?? []) as string[];
  for (let i = 0; i < certificates.length; i += BATCH) {
    const { error } = await supabase.storage
      .from(CERTIFICATES)
      .remove(certificates.slice(i, i + BATCH));
    if (error) return failed('removing certificates', error.message);
  }

  // Session plan files past the attendance keep period go before their plans.
  const { data: planPaths, error: planError } = await supabase.rpc('expired_session_plan_files');
  // PGRST202: the migration adding session plans hasn't reached this project yet.
  if (planError && planError.code !== 'PGRST202') {
    return failed('listing expired session plan files', planError.message);
  }
  const planFiles = (planPaths ?? []) as string[];
  for (let i = 0; i < planFiles.length; i += BATCH) {
    const { error } = await supabase.storage
      .from(SESSION_PLANS)
      .remove(planFiles.slice(i, i + BATCH));
    if (error) return failed('removing session plan files', error.message);
  }

  const { data: records, error: recordsError } = await supabase.rpc('purge_expired_records');
  if (recordsError) return failed('removing old records', recordsError.message);

  const { data: surveys, error: surveysError } = await supabase.rpc('purge_expired_surveys');
  if (surveysError) return failed('removing old surveys', surveysError.message);

  // Counts go to the function's logs, not to whoever called it.
  logger.log(`Purged ${names.length} document(s) and ${purged} injury record(s)`);
  logger.log(`Removed ${cleared.length} cleared injury file(s); marked ${marked} document(s)`);
  logger.log(
    `Removed ${certificates.length} certificate file(s) and ${planFiles.length} session plan file(s); old records: ${JSON.stringify(records)}; old surveys: ${JSON.stringify(surveys)}`,
  );
  return Response.json({ ok: true });
}
