// Revokes a member's Sign in with Apple when they delete their account, as
// Apple asks: apps "should use the Sign in with Apple REST API to revoke user
// tokens" (developer.apple.com/support/offering-account-deletion-in-your-app).
//
// The delete screen asks Apple to confirm once more, which gives the app a
// fresh authorization code (valid for five minutes, usable once). This swaps
// it for a refresh token at https://appleid.apple.com/auth/token and revokes
// that token straight away at /auth/revoke. Nothing is stored.
//
// Before revoking, it checks the code belongs to the member calling: the
// Apple id in the token Apple returns must be one of the member's own
// identities. Anyone else's code is refused and left alone.
//
// Apple needs a client secret: a short-lived JWT signed (ES256) with the
// club's Sign in with Apple key. The function reads these secrets:
//   APPLE_TEAM_ID      the Apple developer Team ID
//   APPLE_KEY_ID       the key's Key ID
//   APPLE_PRIVATE_KEY  the .p8 file's contents (PEM)
//   APPLE_CLIENT_ID    optional, the app's bundle ID (au.pivt.firstpass.hq)
// Until they are set it answers 503, and the app still deletes the account.
//
// Kept free of Deno globals and npm: imports so Jest can test it
// (__tests__/revoke.test.ts). index.ts is the Deno wrapper.

export const APPLE = 'https://appleid.apple.com';
export const DEFAULT_CLIENT_ID = 'au.pivt.firstpass.hq';
/** Apple allows up to 6 months; the secret is made per request, so 5 minutes is plenty. */
export const SECRET_SECONDS = 300;

/** Reads the function's secrets: Deno.env in the function, a stub in tests. */
export type Env = { get(name: string): string | undefined };
export type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

/**
 * The member calling, as Supabase Auth knows them: for each identity, every
 * value that might hold the provider's own id for the person (see
 * appleIdsOf, used by index.ts).
 */
export type Member = { id: string; identities: { provider: string; ids: string[] }[] };

/**
 * Where an identity might carry Apple's id for the person (Apple's "sub").
 * Supabase's Identities page (read 17 November 2026) says provider_id is "the
 * provider id returned by the provider" and id is "the unique id of the
 * identity", but auth-js's UserIdentity type has id and identity_id and no
 * provider_id, and Auth has returned the provider's id as id. identity_data
 * holds the provider's claims, including sub. So all of them are accepted:
 * a wrong guess would make every revoke a quiet 403 (the account is still
 * deleted, so nobody would notice). identity_id is Supabase's own uuid and
 * never Apple's, so it isn't used.
 */
export function appleIdsOf(identity: {
  id?: unknown;
  provider_id?: unknown;
  identity_data?: { [key: string]: unknown } | null;
}): string[] {
  const candidates = [
    identity.id,
    identity.provider_id,
    identity.identity_data?.sub,
    identity.identity_data?.provider_id,
  ];
  return [...new Set(candidates.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

export type Deps = {
  env: Env;
  logger: Logger;
  fetch: typeof fetch;
  /** Finds the member from the request's own JWT, or null if it isn't valid. */
  member(authorization: string): Promise<Member | null>;
  now?: () => number;
};

/** The project's public key, new style first (as the playhq function reads it). */
export function anonKey(env: Env) {
  const keys = env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return env.get('SUPABASE_ANON_KEY')!;
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

function base64url(bytes: Uint8Array | string) {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToBytes(pem: string) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The client secret Apple asks for: a JWT signed with the .p8 key, from the
 * team, about our app, for Apple. WebCrypto's ECDSA signature is already the
 * raw r||s that JWS expects.
 */
export async function clientSecret(
  config: { teamId: string; keyId: string; privateKey: string; clientId: string },
  nowSeconds: number,
) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(config.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId, typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: config.teamId,
      iat: nowSeconds,
      exp: nowSeconds + SECRET_SECONDS,
      aud: APPLE,
      sub: config.clientId,
    }),
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/** The Apple user id (sub) in an id_token that came straight from Apple over TLS. */
export function appleUserId(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

export async function handleRevoke(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });

  const member = await deps.member(request.headers.get('authorization') ?? '');
  if (!member) return json(401, { error: 'Sign in first.' });

  let code: unknown;
  try {
    code = ((await request.json()) as { authorization_code?: unknown }).authorization_code;
  } catch {
    code = undefined;
  }
  if (typeof code !== 'string' || !code.trim()) {
    return json(400, { error: 'No Apple authorization code was sent.' });
  }

  const teamId = deps.env.get('APPLE_TEAM_ID');
  const keyId = deps.env.get('APPLE_KEY_ID');
  const privateKey = deps.env.get('APPLE_PRIVATE_KEY');
  const clientId = deps.env.get('APPLE_CLIENT_ID') || DEFAULT_CLIENT_ID;
  if (!teamId || !keyId || !privateKey) {
    deps.logger.warn('Apple revoke is not set up: APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY are needed.');
    return json(503, { error: 'Revoking with Apple is not set up for this club.' });
  }

  const nowSeconds = Math.floor((deps.now ?? Date.now)() / 1000);
  let secret: string;
  try {
    secret = await clientSecret({ teamId, keyId, privateKey, clientId }, nowSeconds);
  } catch (e) {
    deps.logger.error('Apple revoke: the APPLE_PRIVATE_KEY secret could not be read.', (e as Error).message);
    return json(500, { error: 'Revoking with Apple is not set up correctly for this club.' });
  }

  const tokenResponse = await deps.fetch(`${APPLE}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok) {
    deps.logger.warn('Apple refused the authorization code.', tokenResponse.status, tokens.error ?? '');
    return json(502, { error: 'Apple refused the code.', apple_error: tokens.error ?? null });
  }

  const appleId = appleUserId(tokens.id_token);
  const own = member.identities.some((i) => i.provider === 'apple' && !!appleId && i.ids.includes(appleId));
  if (!appleId || !own) {
    deps.logger.warn('Apple revoke refused: the code is not for the member calling.', member.id);
    return json(403, { error: 'That Apple sign-in isn’t yours.' });
  }

  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return json(502, { error: 'Apple returned no token to revoke.' });
  const revokeResponse = await deps.fetch(`${APPLE}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      token,
      token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    }).toString(),
  });
  if (!revokeResponse.ok) {
    deps.logger.warn('Apple refused to revoke.', revokeResponse.status);
    return json(502, { error: 'Apple refused to revoke the sign-in.' });
  }
  deps.logger.log('Revoked Sign in with Apple for member', member.id);
  return json(200, { revoked: true });
}
