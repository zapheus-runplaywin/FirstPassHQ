// One athlete's own figures from a game recorded in FirstPass Vantage, for
// that game's goals page in HQ.
//
// The game's events hold the whole team, so athletes and guardians can't
// read them (row level security). This function is the only way one
// athlete's figures leave: it asks the database whether the caller coaches
// this athlete (goal_game_stats_access, run as the caller; the athlete and
// their guardians are told no), and only then reads the events with the service role, folds them
// with @firstpass/engine, the engine Vantage and Vision use, and answers with
// that athlete's figures alone. Net Points are added only when the database
// says so, which it does for every coach it answers. Nothing is stored.
//
// Actions record a position, not a person, and the lineup holds each
// player's name. The athlete is found by name (the names the database gives
// for them, compared without case or extra spaces). When a team mate shares
// the name the database gives no names and nobody is shown.
//
// Kept free of Deno globals and npm: imports so Jest can test it
// (__tests__/stats.test.ts). index.ts is the Deno wrapper, and hands in the
// engine.

import type * as EngineModule from '@firstpass/engine';
import type { GameConfig, GameEvent } from '@firstpass/schema';

export type Engine = Pick<typeof EngineModule, 'deriveGame' | 'netPoints' | 'courtTime' | 'lineupsAt' | 'liveEvents' | 'mergeStreams'>;
export type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

/** What goal_game_stats_access answers, or null when the caller may not see it or there is no finished recording. */
export type Access = { game_id: string; config: unknown; names: string[]; net_points: boolean } | null;

/** A row of game_events. */
export type EventRow = { id: string; game_id: string; stream: string; seq: number; type: string; payload: unknown; recorded_at: string };

export interface AthleteFigures {
  goals: number;
  shots: number;
  gains: number;
  turnovers: number;
  feeds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  /** Game-clock minutes on court, to one decimal place. */
  minutes: number;
  positions: string[];
  /** Only for the athlete's coaches. */
  netPoints?: number;
}

export interface Deps {
  engine: Engine;
  logger: Logger;
  /** Runs goal_game_stats_access as the caller. */
  access(authorization: string, athleteId: string, fixtureId: string): Promise<Access>;
  /** The game's primary and helper events, read with the service role. */
  events(gameId: string): Promise<EventRow[]>;
}

/** Reads the function's settings: Deno.env in the function, a stub in tests. */
export type Env = { get(name: string): string | undefined };

/** The project's public key, new style first (as the playhq and revoke-apple functions read it). */
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
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const plain = (name: string) => name.toLowerCase().trim().replace(/\s+/g, ' ');

/** The game's setup as the engine wants it, from what Vantage saved. */
export function configOf(saved: unknown): GameConfig {
  const c = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  return {
    us: typeof c.us === 'string' ? c.us : '',
    them: typeof c.them === 'string' ? c.them : '',
    quarterMs: typeof c.quarterMs === 'number' && c.quarterMs > 0 ? c.quarterMs : 10 * 60_000,
    q1AttackEnd: c.q1AttackEnd === 'right' ? 'right' : 'left',
    firstCentrePass: c.firstCentrePass === 'them' ? 'them' : 'us',
  };
}

/** The game's record: the primary stream with each helper's substitutions and corrections merged in. */
export function recordOf(engine: Engine, rows: EventRow[]): GameEvent[] {
  const events = rows
    .filter((r) => r.stream === 'primary' || r.stream.startsWith('helper:'))
    .map((r) => ({ id: r.id, gameId: r.game_id, stream: r.stream, seq: r.seq, type: r.type, payload: r.payload, recordedAt: r.recorded_at }) as unknown as GameEvent);
  return engine.mergeStreams(events);
}

/**
 * The figures of the athlete recorded under one of `names`, or null when the
 * lineup never held them (they didn't play, or were recorded under another
 * name).
 */
export function athleteFigures(engine: Engine, config: GameConfig, events: GameEvent[], names: string[], withNetPoints: boolean): AthleteFigures | null {
  const wanted = new Set(names.map(plain).filter(Boolean));
  if (!wanted.size) return null;
  const mine = (label: string | undefined) => !!label && wanted.has(plain(label));

  const state = engine.deriveGame(config, events);
  const time = engine.courtTime(events, config.quarterMs);
  const lineups = engine.lineupsAt(events);

  const figures: AthleteFigures = { goals: 0, shots: 0, gains: 0, turnovers: 0, feeds: 0, offensiveRebounds: 0, defensiveRebounds: 0, minutes: 0, positions: [] };
  const positions = new Set<string>();
  let seen = false;

  for (const [label, s] of Object.entries(state.shotsByPlayer)) {
    if (!mine(label)) continue;
    seen = true;
    figures.goals += s.goals;
    figures.shots += s.attempts;
  }
  for (const [label, r] of Object.entries(state.reboundsByPlayer)) {
    if (!mine(label)) continue;
    seen = true;
    figures.offensiveRebounds += r.offensive;
    figures.defensiveRebounds += r.defensive;
  }
  let ms = 0;
  for (const [label, t] of Object.entries(time)) {
    if (!mine(label)) continue;
    seen = true;
    ms += t.totalMs;
    for (const p of Object.keys(t.byPosition)) positions.add(p);
  }
  // Gains, turnovers and feeds are recorded by position: they go to whoever held the position then.
  for (const e of engine.liveEvents(events)) {
    if (e.type !== 'action' || e.payload.team !== 'us' || !e.payload.player || e.payload.player === '?') continue;
    if (!mine(lineups.get(e.id)?.[e.payload.player])) continue;
    seen = true;
    positions.add(e.payload.player);
    if (e.payload.action === 'Won it') figures.gains++;
    else if (e.payload.action === 'Lost it') figures.turnovers++;
    else if (e.payload.action === 'Feed') figures.feeds++;
  }
  if (!seen) return null;

  figures.minutes = Math.round(ms / 6000) / 10;
  const order = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
  figures.positions = [...positions].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (withNetPoints) {
    const points = engine.netPoints(events);
    figures.netPoints = Math.round(Object.entries(points.byPlayer).reduce((sum, [label, v]) => (mine(label) ? sum + v : sum), 0) * 10) / 10;
  }
  return figures;
}

/**
 * POST { athleteId, fixtureId } as a signed-in member. Answers { stats } with
 * the athlete's figures, or { stats: null } when there is nothing the caller
 * may see: no finished recording, not their athlete, the athlete didn't play,
 * or a shared name. The same answer for each, so it says nothing about games
 * the caller can't see.
 */
export async function handleStats(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json(405, { error: 'Send a POST.' });
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer \S+/i.test(authorization)) return json(401, { error: 'Sign in first.' });

  let body: { athleteId?: unknown; fixtureId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Send { athleteId, fixtureId }.' });
  }
  const { athleteId, fixtureId } = body ?? {};
  if (typeof athleteId !== 'string' || typeof fixtureId !== 'string' || !UUID.test(athleteId) || !UUID.test(fixtureId)) {
    return json(400, { error: 'Send { athleteId, fixtureId }.' });
  }

  try {
    const access = await deps.access(authorization, athleteId, fixtureId);
    if (!access || !Array.isArray(access.names) || access.names.length === 0) return json(200, { stats: null });
    const events = recordOf(deps.engine, await deps.events(access.game_id));
    const stats = athleteFigures(deps.engine, configOf(access.config), events, access.names, access.net_points === true);
    return json(200, { stats });
  } catch (err) {
    // Counts and ids only: never an event or a name.
    deps.logger.error('game-stats failed', err instanceof Error ? err.message : 'unknown error');
    return json(500, { error: "Couldn't work out the game stats." });
  }
}
