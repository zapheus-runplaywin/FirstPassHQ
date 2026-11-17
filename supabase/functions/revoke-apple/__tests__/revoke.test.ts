/**
 * @jest-environment node
 */
// Revoking Sign in with Apple when a member deletes their account (W1b).
// These pin: only signed-in members, only POST, a code is needed, nothing
// happens until the club's Apple key is set, the client secret is a valid
// ES256 JWT from the team about our app, the code is swapped and then
// revoked, a code that isn't the caller's own is never revoked, and Apple's
// refusals come back as errors without anything being stored.

import { generateKeyPairSync, verify } from 'node:crypto';

import {
  anonKey,
  APPLE,
  appleIdsOf,
  appleUserId,
  clientSecret,
  DEFAULT_CLIENT_ID,
  handleRevoke,
  SECRET_SECONDS,
  type Deps,
  type Member,
} from '../revoke';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = Date.UTC(2026, 10, 17, 3, 0, 0);

function b64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
function idToken(sub: string) {
  return `${b64url({ alg: 'RS256' })}.${b64url({ iss: APPLE, sub, aud: DEFAULT_CLIENT_ID })}.sig`;
}
function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString());
}

const appleMember: Member = {
  id: 'member-1',
  identities: [
    { provider: 'google', ids: ['google-1'] },
    { provider: 'apple', ids: ['apple-sub-1'] },
  ],
};

type Call = { url: string; body: URLSearchParams };

function setup(options: {
  env?: Record<string, string | undefined>;
  member?: Member | null;
  token?: { status?: number; body?: unknown };
  revoke?: { status?: number };
} = {}) {
  const calls: Call[] = [];
  const logs: unknown[][] = [];
  const env: Record<string, string | undefined> = {
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: PEM,
    ...options.env,
  };
  const deps: Deps = {
    env: { get: (name) => env[name] },
    logger: {
      log: (...a: unknown[]) => logs.push(['log', ...a]),
      warn: (...a: unknown[]) => logs.push(['warn', ...a]),
      error: (...a: unknown[]) => logs.push(['error', ...a]),
    },
    now: () => NOW,
    member: jest.fn(async (authorization: string) =>
      authorization === 'Bearer member-jwt' ? (options.member === undefined ? appleMember : options.member) : null,
    ),
    fetch: (async (input: string, init: RequestInit) => {
      calls.push({ url: String(input), body: new URLSearchParams(String(init.body)) });
      if (String(input).endsWith('/auth/token')) {
        const t = options.token ?? {};
        return new Response(
          JSON.stringify(t.body ?? { refresh_token: 'refresh-1', access_token: 'access-1', id_token: idToken('apple-sub-1') }),
          { status: t.status ?? 200 },
        );
      }
      return new Response('', { status: options.revoke?.status ?? 200 });
    }) as typeof fetch,
  };
  return { deps, calls, logs };
}

function request(body: unknown = { authorization_code: 'fresh-code' }, init: Partial<RequestInit> & { auth?: string } = {}) {
  return new Request('https://club.example.test/functions/v1/revoke-apple', {
    method: init.method ?? 'POST',
    headers: { authorization: init.auth ?? 'Bearer member-jwt', 'content-type': 'application/json' },
    body: init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function answer(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe('who may call it', () => {
  it('answers the browser’s preflight', async () => {
    const { deps, calls } = setup();
    const response = await handleRevoke(request(undefined, { method: 'OPTIONS' }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(calls).toEqual([]);
  });

  it('refuses anything but POST', async () => {
    const { deps, calls } = setup();
    expect((await handleRevoke(request(undefined, { method: 'GET' }), deps)).status).toBe(405);
    expect(calls).toEqual([]);
  });

  it.each([['no sign-in', ''], ['someone else’s sign-in', 'Bearer forged']])(
    'refuses %s and asks Apple nothing',
    async (_label, auth) => {
      const { deps, calls } = setup();
      expect(await answer(await handleRevoke(request(undefined, { auth }), deps))).toEqual({
        status: 401,
        body: { error: 'Sign in first.' },
      });
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ['no code', {}],
    ['an empty code', { authorization_code: '  ' }],
    ['a code that isn’t text', { authorization_code: 42 }],
    ['a body that isn’t JSON', 'not json'],
  ])('refuses %s', async (_label, body) => {
    const { deps, calls } = setup();
    expect(await answer(await handleRevoke(request(body), deps))).toEqual({
      status: 400,
      body: { error: 'No Apple authorization code was sent.' },
    });
    expect(calls).toEqual([]);
  });
});

describe('before the club’s Apple key is set', () => {
  it.each(['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'])('answers 503 without %s, and asks Apple nothing', async (missing) => {
    const { deps, calls, logs } = setup({ env: { [missing]: undefined } });
    expect(await answer(await handleRevoke(request(), deps))).toEqual({
      status: 503,
      body: { error: 'Revoking with Apple is not set up for this club.' },
    });
    expect(calls).toEqual([]);
    expect(logs[0][0]).toBe('warn');
  });

  it('answers 500 for a key that can’t be read', async () => {
    const { deps, calls } = setup({ env: { APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nnotakey\n-----END PRIVATE KEY-----' } });
    expect((await handleRevoke(request(), deps)).status).toBe(500);
    expect(calls).toEqual([]);
  });
});

describe('revoking', () => {
  it('swaps the code for a token, then revokes that token, and says so', async () => {
    const { deps, calls, logs } = setup();
    expect(await answer(await handleRevoke(request(), deps))).toEqual({ status: 200, body: { revoked: true } });
    expect(calls.map((c) => c.url)).toEqual([`${APPLE}/auth/token`, `${APPLE}/auth/revoke`]);
    expect(Object.fromEntries(calls[0].body)).toMatchObject({
      client_id: DEFAULT_CLIENT_ID,
      code: 'fresh-code',
      grant_type: 'authorization_code',
    });
    expect(Object.fromEntries(calls[1].body)).toMatchObject({
      client_id: DEFAULT_CLIENT_ID,
      token: 'refresh-1',
      token_type_hint: 'refresh_token',
    });
    // The same secret is used for both.
    expect(calls[1].body.get('client_secret')).toBe(calls[0].body.get('client_secret'));
    // Logs the member's id, never a token or code.
    expect(JSON.stringify(logs)).not.toMatch(/refresh-1|access-1|fresh-code/);
  });

  it('uses the client ID secret when set', async () => {
    const { deps, calls } = setup({ env: { APPLE_CLIENT_ID: 'au.pivt.firstpass.other' } });
    await handleRevoke(request(), deps);
    expect(calls.map((c) => c.body.get('client_id'))).toEqual(['au.pivt.firstpass.other', 'au.pivt.firstpass.other']);
  });

  it('revokes the access token when Apple returns no refresh token', async () => {
    const { deps, calls } = setup({ token: { body: { access_token: 'access-1', id_token: idToken('apple-sub-1') } } });
    expect((await handleRevoke(request(), deps)).status).toBe(200);
    expect(Object.fromEntries(calls[1].body)).toMatchObject({ token: 'access-1', token_type_hint: 'access_token' });
  });

  it('answers 502 when Apple returns no token at all', async () => {
    const { deps, calls } = setup({ token: { body: { id_token: idToken('apple-sub-1') } } });
    expect((await handleRevoke(request(), deps)).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it('passes on Apple’s refusal of the code, and revokes nothing', async () => {
    const { deps, calls } = setup({ token: { status: 400, body: { error: 'invalid_grant' } } });
    expect(await answer(await handleRevoke(request(), deps))).toEqual({
      status: 502,
      body: { error: 'Apple refused the code.', apple_error: 'invalid_grant' },
    });
    expect(calls).toHaveLength(1);
  });

  it('copes with a refusal that isn’t JSON', async () => {
    const { deps } = setup({ token: { status: 500, body: undefined } });
    deps.fetch = (async () => new Response('<html>', { status: 500 })) as typeof fetch;
    expect(await answer(await handleRevoke(request(), deps))).toEqual({
      status: 502,
      body: { error: 'Apple refused the code.', apple_error: null },
    });
  });

  it('answers 502 when Apple refuses to revoke', async () => {
    const { deps } = setup({ revoke: { status: 400 } });
    expect(await answer(await handleRevoke(request(), deps))).toEqual({
      status: 502,
      body: { error: 'Apple refused to revoke the sign-in.' },
    });
  });
});

describe('never revokes someone else’s Apple sign-in', () => {
  it.each([
    ['a different Apple user', { body: { refresh_token: 'r', id_token: idToken('apple-sub-OTHER') } }, appleMember],
    ['no id token', { body: { refresh_token: 'r' } }, appleMember],
    ['an id token that can’t be read', { body: { refresh_token: 'r', id_token: 'a.%%%.c' } }, appleMember],
    ['a member who never signed in with Apple', undefined, { id: 'member-2', identities: [{ provider: 'google', ids: ['apple-sub-1'] }] }],
  ])('refuses %s', async (_label, token, member) => {
    const { deps, calls } = setup({ token, member });
    expect(await answer(await handleRevoke(request(), deps))).toEqual({
      status: 403,
      body: { error: 'That Apple sign-in isn’t yours.' },
    });
    expect(calls.map((c) => c.url)).toEqual([`${APPLE}/auth/token`]);
  });
});

describe('finding Apple’s id on the member’s identities', () => {
  it.each([
    ['id', { id: 'apple-sub-1', identity_id: 'uuid-1' }],
    ['provider_id', { id: 'uuid-1', provider_id: 'apple-sub-1' }],
    ['identity_data.sub', { id: 'uuid-1', identity_id: 'uuid-2', identity_data: { sub: 'apple-sub-1' } }],
    ['identity_data.provider_id', { id: 'uuid-1', identity_data: { provider_id: 'apple-sub-1' } }],
  ])('revokes when Apple’s id is in %s', async (_label, identity) => {
    const member: Member = { id: 'member-1', identities: [{ provider: 'apple', ids: appleIdsOf(identity) }] };
    const { deps } = setup({ member });
    expect((await handleRevoke(request(), deps)).status).toBe(200);
  });

  it('never takes Supabase’s own identity_id for Apple’s', () => {
    expect(appleIdsOf({ identity_id: 'apple-sub-1' } as never)).toEqual([]);
  });

  it('drops empty and non-text values and repeats', () => {
    expect(appleIdsOf({ id: 'a', provider_id: 'a', identity_data: { sub: '', provider_id: 5 } })).toEqual(['a']);
    expect(appleIdsOf({ identity_data: null })).toEqual([]);
  });
});

describe('the client secret', () => {
  it('is an ES256 JWT from the team, about our app, for Apple, for 5 minutes, signed by the key', async () => {
    const jwt = await clientSecret(
      { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: PEM, clientId: DEFAULT_CLIENT_ID },
      1_800_000_000,
    );
    const [header, payload, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    expect(decode(payload)).toEqual({
      iss: 'TEAM123456',
      iat: 1_800_000_000,
      exp: 1_800_000_000 + SECRET_SECONDS,
      aud: APPLE,
      sub: DEFAULT_CLIENT_ID,
    });
    expect(SECRET_SECONDS).toBeLessThanOrEqual(15777000);
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
    expect(valid).toBe(true);
  });

  it('reads a key pasted with literal \\n instead of line breaks', async () => {
    const oneLine = PEM.trim().replace(/\n/g, '\\n');
    await expect(
      clientSecret({ teamId: 'T', keyId: 'K', privateKey: oneLine, clientId: DEFAULT_CLIENT_ID }, 0),
    ).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe('helpers', () => {
  it.each([
    [idToken('abc'), 'abc'],
    ['only-one-part', null],
    [`x.${b64url({ sub: 5 })}.y`, null],
    [null, null],
  ])('reads the Apple user id from %p', (token, id) => {
    expect(appleUserId(token)).toBe(id);
  });

  it('prefers the new publishable key, then the legacy anon key', () => {
    const env = (vars: Record<string, string>) => ({ get: (n: string) => vars[n] });
    expect(anonKey(env({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"pub"}', SUPABASE_ANON_KEY: 'anon' }))).toBe('pub');
    expect(anonKey(env({ SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_ANON_KEY: 'anon' }))).toBe('anon');
    expect(anonKey(env({ SUPABASE_ANON_KEY: 'anon' }))).toBe('anon');
  });
});
