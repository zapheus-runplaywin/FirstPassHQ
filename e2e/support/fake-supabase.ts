// A fake Supabase backend for the browser smoke tests. The web build is made
// with EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co (the THUNDER club in
// src/constants/clubs.ts), so every request the app sends there is answered
// here from a test's handler, as the screenshot tooling's shoot.mjs does, and
// recorded so a test can check which database function was called and with what.
import type { BrowserContext, Route } from '@playwright/test';

export const SUPABASE_URL = 'https://example.supabase.co';
/** supabase-js saves the session under "sb-<project ref>-auth-token". */
const SESSION_KEY = 'sb-example-auth-token';

/** One request the app sent, as a handler and the assertions see it. */
export type FakeRequest = {
  method: string;
  /** The table, or "rpc/<function>", such as "profiles" or "rpc/save_attendance". */
  table: string;
  /** The database function's name, for an RPC call. */
  rpc: string | null;
  params: URLSearchParams;
  /** The JSON body: an RPC's arguments, or the rows of an insert or update. */
  body: any;
  /** The app asked for one row (`.single()` or `.maybeSingle()`). */
  single: boolean;
  /** A HEAD request, used to count rows. */
  head: boolean;
};

/** An answer that makes the database function refuse, as `raise exception` would. */
export type FakeError = { __error: string };

/**
 * Answers a request: rows, an object, a scalar, a FakeError, or undefined for
 * "nothing here" (an empty list, or null for a single row).
 */
export type Handler = (req: FakeRequest) => unknown;

/** The value of a PostgREST filter such as `id=eq.<uuid>`. */
export function eq(params: URLSearchParams, key: string) {
  const value = params.get(key);
  return value?.startsWith('eq.') ? value.slice(3) : null;
}

/** Thunder's saved Club settings, without the logo (sample branding only). */
export const thunderProfile = {
  club_name: 'West Coast Thunder',
  short_name: 'Thunder',
  background_colour: '#000000',
  text_colour: '#FFFFFF',
  hero_colour: '#FFCD00',
  logo_path: null,
  features: {},
  updated_at: '2026-10-08T03:00:00Z',
};

export class FakeSupabase {
  /** Every request the app sent to Supabase, in order. */
  readonly requests: FakeRequest[] = [];
  /** Requests no handler answered, to help when a screen changes. */
  readonly unhandled: string[] = [];

  constructor(private readonly handle: Handler) {}

  /** The arguments of each call to a database function, in order. */
  rpcCalls(name: string): any[] {
    return this.requests.filter((r) => r.rpc === name).map((r) => r.body);
  }

  /** Whether any request went to this table or "rpc/<function>". */
  called(table: string) {
    return this.requests.some((r) => r.table === table);
  }

  /** Answers every request to the fake Supabase URL in this browser context. */
  async install(context: BrowserContext) {
    await context.route(`${SUPABASE_URL}/**`, (route) => this.answer(route));
  }

  private async answer(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
      'access-control-expose-headers': 'content-range',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    // Auth: the session is already in storage; answer the user lookup in case a screen asks.
    if (url.pathname.startsWith('/auth/v1/')) {
      const answer = this.handle({
        method: request.method(),
        table: url.pathname,
        rpc: null,
        params: url.searchParams,
        body: parse(request.postData()),
        single: true,
        head: false,
      });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(answer ?? {}) });
    }

    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    const req: FakeRequest = {
      method: request.method(),
      table,
      rpc: table.startsWith('rpc/') ? table.slice(4) : null,
      params: url.searchParams,
      body: parse(request.postData()),
      single: (request.headers()['accept'] ?? '').includes('vnd.pgrst.object'),
      head: request.method() === 'HEAD',
    };
    this.requests.push(req);

    const data = table === 'rpc/club_profile' ? [thunderProfile] : this.handle(req);
    if (data && typeof data === 'object' && '__error' in data) {
      return route.fulfill({
        status: 400,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'P0001', message: (data as FakeError).__error }),
      });
    }
    if (data === undefined) this.unhandled.push(`${req.method} ${table}?${url.searchParams}`);
    const rows = data === undefined ? (req.single ? null : []) : data;
    const count = Array.isArray(rows) ? rows.length : rows === null ? 0 : 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...cors, 'content-range': count ? `0-${count - 1}/${count}` : '*/0' },
      body: req.head ? '' : JSON.stringify(req.single && Array.isArray(rows) ? (rows[0] ?? null) : rows),
    });
  }
}

function parse(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A signed-in session for this member, as supabase-js saves it. */
function sessionFor(user: { id: string; email: string | null }) {
  const payload = btoa(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return {
    access_token: `header.${payload}.sig`,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800,
    user: {
      id: user.id,
      email: user.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    },
  };
}

/**
 * Starts the browser as a device that has already picked a club (Thunder by
 * default) and, with a member, is signed in as them.
 */
export async function startDevice(
  context: BrowserContext,
  options: { club?: string | null; member?: { id: string; email: string | null } | null },
) {
  const club = options.club === undefined ? 'THUNDER' : options.club;
  if (club) await context.addInitScript((code) => localStorage.setItem('club-code', code), club);
  if (options.member) {
    await context.addInitScript(
      ([key, session]) => localStorage.setItem(key, JSON.stringify(session)),
      [SESSION_KEY, sessionFor(options.member)] as const,
    );
  }
}
