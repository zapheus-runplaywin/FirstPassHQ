/**
 * @jest-environment node
 */
// An athlete's own game stats for the game's goals page (item 8). These pin:
// only signed-in members and only POST; the database decides who may see
// (the events are never read when it says no); only the one athlete's figures
// come back, found by name whatever its case or spacing; figures follow the
// player through substitutions and a helper's corrections; Net Points only
// when the database says the caller coaches the athlete; and every "nothing
// to show" case answers the same.

import * as engine from '@firstpass/engine';

import { anonKey, athleteFigures, configOf, handleStats, plain, recordOf, type Access, type Deps, type EventRow } from '../stats';

const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const ATHLETE = '00000000-0000-0000-0000-000000000011';
const FIXTURE = '00000000-0000-0000-0000-0000000000f1';
const Q = 10 * 60_000;
const CONFIG = { us: 'Thunder', them: 'Storm', quarterMs: Q, q1AttackEnd: 'left', firstCentrePass: 'us' };

/** Ava plays GS all game; Mia plays GA until Zoe comes on at 6:00 left. */
function rows(): EventRow[] {
  let seq = 0;
  const T0 = Date.parse('2026-11-14T09:00:00Z');
  const ev = (type: string, payload: object, stream = 'primary', n?: number): EventRow => {
    const s = n ?? ++seq;
    return { id: `${stream}-${s}`, game_id: GAME, stream, seq: s, type, payload, recorded_at: new Date(T0 + (Q - ((payload as { clockMs?: number }).clockMs ?? Q)) + s).toISOString() };
  };
  const act = (player: string, action: string, clockMs: number, more: object = {}) => ev('action', { period: 1, clockMs, team: 'us', player, action, ...more });
  return [
    ev('period_start', { period: 1, clockMs: Q, attackEnd: 'left', centrePass: 'us', mode: 'full' }),
    ev('lineup_change', { period: 1, clockMs: Q, team: 'us', lineup: { GS: 'Ava Smith', GA: 'Mia  TRAN' }, bench: ['Zoe Hart'], detail: 'Starting seven' }),
    ev('clock_start', { period: 1, clockMs: Q }),
    act('GS', 'Goal', 590_000),
    act('GA', 'Miss', 580_000, { rebound: 'ours', rebounder: 'GS' }),
    act('GS', 'Goal', 575_000),
    act('GA', 'Won it', 500_000, { cause: 'Intercept' }),
    act('GA', 'Lost it', 480_000, { cause: 'Bad pass' }),
    act('GA', 'Feed', 470_000),
    ev('lineup_change', { period: 1, clockMs: 360_000, team: 'us', lineup: { GS: 'Ava Smith', GA: 'Zoe Hart' }, bench: ['Mia  TRAN'], detail: 'Zoe on at GA, Mia off' }),
    act('GA', 'Goal', 300_000),
    act('GA', 'Lost it', 200_000, { cause: 'Footwork' }),
    ev('action', { period: 1, clockMs: 150_000, team: 'them', player: null, action: 'Goal' }),
    ev('period_end', { period: 1, clockMs: 0 }),
  ];
}

const figuresFor = (names: string[], net = false, r = rows()) => athleteFigures(engine, configOf(CONFIG), recordOf(engine, r), names, net);

describe('athleteFigures', () => {
  it('gives the athlete their own shots, rebounds, time and positions', () => {
    expect(figuresFor(['ava smith'])).toEqual({
      goals: 2, shots: 2, gains: 0, turnovers: 0, feeds: 0, offensiveRebounds: 1, defensiveRebounds: 0, minutes: 10, positions: ['GS'],
    });
  });

  it('finds the athlete by name whatever its case or spacing, and under either of their names', () => {
    expect(plain('  Mia   TRAN ')).toBe('mia tran');
    expect(figuresFor(['mimi', 'Mia Tran'])).toMatchObject({ shots: 1, goals: 0, gains: 1, turnovers: 1, feeds: 1, minutes: 4, positions: ['GA'] });
  });

  it('follows the player, not the position, through a substitution', () => {
    // Zoe came on at GA with 6:00 left: the earlier GA figures are Mia's.
    expect(figuresFor(['Zoe Hart'])).toMatchObject({ shots: 1, goals: 1, gains: 0, turnovers: 1, feeds: 0, minutes: 6, positions: ['GA'] });
  });

  it("counts a helper statistician's corrections", () => {
    const r = rows();
    const lost = r.find((e) => e.type === 'action' && (e.payload as { cause?: string }).cause === 'Footwork')!;
    r.push({ id: 'h1', game_id: GAME, stream: 'helper:00000000-0000-0000-0000-000000000061', seq: 1, type: 'correction', payload: { target: lost.id, op: 'delete' }, recorded_at: '2026-11-14T09:30:00Z' });
    expect(figuresFor(['Zoe Hart'], false, r)?.turnovers).toBe(0);
    // A shadow statistician's record never counts.
    r.push({ id: 's1', game_id: GAME, stream: 'shadow:00000000-0000-0000-0000-000000000062', seq: 1, type: 'correction', payload: { target: r[3]!.id, op: 'delete' }, recorded_at: '2026-11-14T09:31:00Z' });
    expect(figuresFor(['Ava Smith'], false, r)?.goals).toBe(2);
  });

  it('adds Net Points only when asked, the same figure the engine gives', () => {
    expect(figuresFor(['Ava Smith'])).not.toHaveProperty('netPoints');
    const points = engine.netPoints(recordOf(engine, rows()));
    expect(figuresFor(['Ava Smith'], true)?.netPoints).toBe(Math.round(points.byPlayer['Ava Smith']! * 10) / 10);
    expect(figuresFor(['Mia Tran'], true)?.netPoints).toBe(Math.round(points.byPlayer['Mia  TRAN']! * 10) / 10);
  });

  it('has nothing for someone the lineup never held, or with no names to go by', () => {
    expect(figuresFor(['Nobody Here'])).toBeNull();
    expect(figuresFor([])).toBeNull();
    expect(figuresFor(['', '  '])).toBeNull();
  });

  it('gives a bench player who never came on their name but no minutes', () => {
    const r = rows().filter((e) => !(e.type === 'lineup_change' && (e.payload as { detail: string }).detail.startsWith('Zoe')));
    expect(figuresFor(['Zoe Hart'], false, r)).toBeNull();
  });
});

describe('configOf', () => {
  it('reads what Vantage saved and falls back for anything missing', () => {
    expect(configOf(CONFIG)).toEqual(CONFIG);
    expect(configOf(null)).toEqual({ us: '', them: '', quarterMs: 600_000, q1AttackEnd: 'left', firstCentrePass: 'us' });
    expect(configOf({ quarterMs: -1, q1AttackEnd: 'right', firstCentrePass: 'them' })).toMatchObject({ quarterMs: 600_000, q1AttackEnd: 'right', firstCentrePass: 'them' });
  });
});

describe('anonKey', () => {
  it('prefers the new publishable key', () => {
    expect(anonKey({ get: (n) => ({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"pk"}', SUPABASE_ANON_KEY: 'anon' })[n] })).toBe('pk');
    expect(anonKey({ get: (n) => ({ SUPABASE_ANON_KEY: 'anon' })[n as 'SUPABASE_ANON_KEY'] })).toBe('anon');
  });
});

describe('handleStats', () => {
  const ALLOWED: Access = { game_id: GAME, config: CONFIG, names: ['ava smith'], net_points: false };
  function setup(access: Access | Error = ALLOWED) {
    const deps: Deps & { access: jest.Mock; events: jest.Mock; logger: { error: jest.Mock; log: jest.Mock; warn: jest.Mock } } = {
      engine,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      access: jest.fn(async () => {
        if (access instanceof Error) throw access;
        return access;
      }),
      events: jest.fn(async () => rows()),
    };
    return deps;
  }
  const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer member-token' }) =>
    new Request('https://example.test/game-stats', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const ask = { athleteId: ATHLETE, fixtureId: FIXTURE };

  it('answers a browser preflight and refuses anything but POST', async () => {
    const deps = setup();
    const pre = await handleStats(new Request('https://example.test/game-stats', { method: 'OPTIONS' }), deps);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect((await handleStats(new Request('https://example.test/game-stats', { method: 'GET' }), deps)).status).toBe(405);
    expect(deps.access).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not signed in before asking anything', async () => {
    const deps = setup();
    expect((await handleStats(post(ask, {}), deps)).status).toBe(401);
    expect((await handleStats(post(ask, { authorization: 'Basic abc' }), deps)).status).toBe(401);
    expect(deps.access).not.toHaveBeenCalled();
    expect(deps.events).not.toHaveBeenCalled();
  });

  it('refuses a body that is not two ids', async () => {
    const deps = setup();
    for (const body of ['not json', {}, { athleteId: ATHLETE }, { athleteId: 'me', fixtureId: FIXTURE }, { athleteId: ATHLETE, fixtureId: "x' or 1=1" }]) {
      expect((await handleStats(post(body), deps)).status).toBe(400);
    }
    expect(deps.access).not.toHaveBeenCalled();
  });

  it("asks the database as the caller, then answers with that athlete's figures only", async () => {
    const deps = setup();
    const res = await handleStats(post(ask), deps);
    expect(res.status).toBe(200);
    expect(deps.access).toHaveBeenCalledWith('Bearer member-token', ATHLETE, FIXTURE);
    expect(deps.events).toHaveBeenCalledWith(GAME);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ stats: { goals: 2, shots: 2, gains: 0, turnovers: 0, feeds: 0, offensiveRebounds: 1, defensiveRebounds: 0, minutes: 10, positions: ['GS'] } });
    // Nothing of anyone else, and no event, leaves the function.
    for (const leak of ['Mia', 'Zoe', 'Storm', 'lineup', 'clockMs', 'netPoints']) expect(text).not.toContain(leak);
  });

  it('adds Net Points for a coach of the athlete', async () => {
    const res = await handleStats(post(ask), setup({ ...ALLOWED!, net_points: true }));
    expect((await res.json()).stats).toHaveProperty('netPoints');
  });

  it('never reads the events when the database says no, and answers as if there were no game', async () => {
    for (const access of [null, { ...ALLOWED!, names: [] }, { ...ALLOWED!, names: undefined as unknown as string[] }]) {
      const deps = setup(access);
      const res = await handleStats(post(ask), deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ stats: null });
      expect(deps.events).not.toHaveBeenCalled();
    }
  });

  it('answers the same for an athlete who did not play', async () => {
    const res = await handleStats(post(ask), setup({ ...ALLOWED!, names: ['someone else'] }));
    expect(await res.json()).toEqual({ stats: null });
  });

  it('says only that it failed when the database does, and logs no names', async () => {
    const deps = setup(new Error('goal_game_stats_access: 42501'));
    const res = await handleStats(post(ask), deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't work out the game stats." });
    expect(deps.logger.error).toHaveBeenCalledWith('game-stats failed', 'goal_game_stats_access: 42501');
  });
});
