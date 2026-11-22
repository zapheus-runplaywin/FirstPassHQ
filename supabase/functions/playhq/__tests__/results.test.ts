/**
 * @jest-environment node
 */
// The playhq function also reads a team's results in games nobody recorded,
// for FirstPass Vision's season view. These tests pin who gets them (the
// database decides, as the caller), what leaves the function (our side only,
// never a player PlayHQ hides), how names follow the lineup, and that the
// admins' competition lookup still answers as before.

import { API, CORS } from '../fixtures';
import {
  GAME_QUERY,
  MAX_RESULTS,
  handle,
  handleResults,
  plainName,
  readResult,
  type RawGame,
  type Unrecorded,
} from '../results';

const TOKEN = 'Bearer eyJ-member-token';
const TEAM = '00000000-0000-0000-0000-0000000000a2';

function fakeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function logged(logger: ReturnType<typeof fakeLogger>) {
  return (['info', 'warn', 'error'] as const).flatMap((level) =>
    logger[level].mock.calls.map(([line]) => JSON.parse(line as string)),
  );
}

const stat = (type: string, count: number) => ({ count, type: { value: type } });

const fixture = (over: Partial<Unrecorded> = {}): Unrecorded => ({
  fixture_id: 'f1',
  playhq_game_id: 'r1',
  tenant: 'netball-australia',
  starts_at: '2026-05-02T02:00:00+00:00',
  opponent: 'Swans',
  round_name: 'Round 1',
  is_home: true,
  ...over,
});

const person = (firstName: string, lastName: string, position: string, stats: ReturnType<typeof stat>[] = []) => ({
  player: { __typename: 'DiscoverParticipant', profile: { firstName, lastName } },
  statistics: stats,
  playerPosition: { shortName: position },
});

/** Sample people only. Home is our side unless the fixture says away. */
const GAME: RawGame = {
  id: 'r1',
  status: { value: 'FINAL' },
  result: { home: { score: 41 }, away: { score: 38 } },
  statistics: {
    home: {
      players: [
        person('Jordan', 'Junior', 'GS', [stat('1_POINT_SCORE', 25), stat('GOAL_ATTEMPT', 31)]),
        person('Kai', 'Senior', 'GA', [stat('1_POINT_SCORE', 16), stat('GOAL_ATTEMPT', 22)]),
        person('Robin', 'Centre', 'C'),
        { player: { __typename: 'DiscoverAnonymousParticipant', name: 'Hidden Player' }, statistics: [stat('1_POINT_SCORE', 3)], playerPosition: { shortName: 'WA' } },
        { player: { __typename: 'DiscoverRegularFillInPlayer', name: '  Fill   In ' }, statistics: [], playerPosition: { shortName: 'Bench' } },
      ],
      statistics: [stat('1_POINT_SCORE', 41)],
    },
    away: {
      players: [person('Their', 'Shooter', 'GS', [stat('1_POINT_SCORE', 38), stat('GOAL_ATTEMPT', 50)])],
      statistics: [],
    },
  },
};

const NAMES = [
  { registered: 'Jordan Junior', lineup: 'JJ Junior' },
  { registered: 'Kai Senior', lineup: 'Kai Senior' },
];

function post(body: unknown, headers: Record<string, string> = { Authorization: TOKEN }) {
  return new Request('https://example.test/functions/v1/playhq', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function setup({
  list = { data: { games: [fixture()], names: NAMES }, error: null } as { data: unknown; error: { message: string; code?: string } | null },
  games = { r1: GAME } as Record<string, RawGame | null | 'fail'>,
}: { list?: { data: unknown; error: { message: string; code?: string } | null }; games?: Record<string, RawGame | null | 'fail'> } = {}) {
  const rpc = jest.fn(async (_fn: string, _args?: unknown) => list);
  const makeClient = jest.fn((_authorization: string) => ({ rpc }));
  const fetch = jest.fn(async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(init.body as string);
    const game = games[variables.gameID];
    if (game === 'fail') return new Response('blocked', { status: 403 });
    return new Response(JSON.stringify({ data: { discoverGame: game ?? null } }), { status: 200 });
  });
  const logger = fakeLogger();
  return { deps: { fetch, logger, makeClient }, rpc, makeClient, fetch, logger };
}

describe('readResult', () => {
  it('gives our side: the score both ways and each player with their shooting', () => {
    expect(readResult(fixture(), GAME, [])).toEqual({
      id: 'f1',
      playedAt: '2026-05-02T02:00:00+00:00',
      opponent: 'Swans',
      round: 'Round 1',
      us: 41,
      them: 38,
      players: [
        { name: 'Fill In', positions: [], goals: 0, shots: null },
        { name: 'Jordan Junior', positions: ['GS'], goals: 25, shots: 31 },
        { name: 'Kai Senior', positions: ['GA'], goals: 16, shots: 22 },
        { name: 'Robin Centre', positions: ['C'], goals: 0, shots: null },
      ],
    });
  });

  it('never names a player PlayHQ hides from the public', () => {
    const text = JSON.stringify(readResult(fixture(), GAME, []));
    expect(text).not.toContain('Hidden');
  });

  it('never sends the other team\'s players', () => {
    expect(JSON.stringify(readResult(fixture(), GAME, []))).not.toContain('Shooter');
    const away = readResult(fixture({ is_home: false }), GAME, []);
    expect(away).toMatchObject({ us: 38, them: 41 });
    expect(away?.players.map((p) => p.name)).toEqual(['Their Shooter']);
    expect(JSON.stringify(away)).not.toContain('Jordan');
  });

  it('uses the lineup\'s name for one of the team\'s athletes, whatever the case and spacing', () => {
    const game: RawGame = { ...GAME, statistics: { home: { players: [person(' jordan ', 'JUNIOR', 'GS', [stat('1_POINT_SCORE', 4)])] }, away: {} } };
    expect(readResult(fixture(), game, NAMES)?.players).toEqual([{ name: 'JJ Junior', positions: ['GS'], goals: 4, shots: null }]);
  });

  it('adds a player listed twice into one, and loses the attempts if either entry has none', () => {
    const game: RawGame = {
      ...GAME,
      statistics: {
        home: {
          players: [
            person('Jordan', 'Junior', 'GS', [stat('1_POINT_SCORE', 5), stat('GOAL_ATTEMPT', 8)]),
            person('Jordan', 'Junior', 'GA', [stat('1_POINT_SCORE', 2), stat('GOAL_ATTEMPT', 3)]),
            person('Kai', 'Senior', 'GA', [stat('1_POINT_SCORE', 1), stat('GOAL_ATTEMPT', 2)]),
            person('Kai', 'Senior', 'GA', [stat('1_POINT_SCORE', 1)]),
          ],
        },
        away: {},
      },
    };
    expect(readResult(fixture(), game, [])?.players).toEqual([
      { name: 'Jordan Junior', positions: ['GS', 'GA'], goals: 7, shots: 11 },
      { name: 'Kai Senior', positions: ['GA'], goals: 2, shots: null },
    ]);
  });

  it('counts a two-point goal as one goal, and two points in a score worked out from the counts', () => {
    const game: RawGame = {
      id: 'r1',
      statistics: {
        home: { players: [person('Jordan', 'Junior', 'GS', [stat('1_POINT_SCORE', 3), stat('2_POINT_SCORE', 2)])], statistics: [stat('1_POINT_SCORE', 3), stat('2_POINT_SCORE', 2)] },
        away: { statistics: [stat('TOTAL_SCORE', 9)] },
      },
    };
    const result = readResult(fixture(), game, []);
    expect(result).toMatchObject({ us: 7, them: 9 });
    expect(result?.players[0]).toMatchObject({ goals: 5 });
  });

  it('gives nothing for a game PlayHQ has no score for yet', () => {
    expect(readResult(fixture(), { id: 'r1', statistics: { home: { players: [person('Jordan', 'Junior', 'GS')] }, away: {} } }, [])).toBeNull();
    expect(readResult(fixture(), { id: 'r1', result: { home: { score: 10 } } }, [])).toBeNull();
  });

  it('keeps a score with no players, as when the scorer entered only the result', () => {
    expect(readResult(fixture(), { id: 'r1', result: { home: { score: 30 }, away: { score: 30 } } }, [])).toMatchObject({ us: 30, them: 30, players: [] });
  });

  it('matches names in lower case with single spaces', () => {
    expect(plainName('  Mia   CHEN ')).toBe('mia chen');
  });
});

describe('who gets a team\'s results', () => {
  it('asks the database as the caller, with their Authorization header and the team', async () => {
    const { deps, makeClient, rpc } = setup();
    const response = await handle(post({ teamId: TEAM }), deps);
    expect(response.status).toBe(200);
    expect(makeClient).toHaveBeenCalledWith(TOKEN);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('playhq_unrecorded_games', { p_team_id: TEAM });
  });

  it('refuses whoever the database refuses, without asking PlayHQ', async () => {
    const { deps, fetch, logger } = setup({ list: { data: null, error: { message: 'Only the team\'s coaches…', code: '42501' } } });
    const response = await handle(post({ teamId: TEAM }), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only the team’s coaches and managers, statisticians and admins can read its PlayHQ results' });
    expect(fetch).not.toHaveBeenCalled();
    expect(logged(logger)).toContainEqual(expect.objectContaining({ level: 'warn', team_id: TEAM, code: '42501' }));
  });

  it('checks a signed-out caller with an empty Authorization header', async () => {
    const { deps, makeClient } = setup({ list: { data: null, error: { message: 'permission denied' } } });
    const response = await handle(post({ teamId: TEAM }, {}), deps);
    expect(makeClient).toHaveBeenCalledWith('');
    expect(response.status).toBe(403);
  });

  it.each([[''], ['a2'], [42], [null], [`${TEAM}' or 1=1`]])('refuses the team %p before asking anything', async (teamId) => {
    const { deps, makeClient, fetch } = setup();
    const response = await handle(post({ teamId }), deps);
    expect(response.status).toBe(400);
    expect(makeClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the CORS headers with a refusal, a bad request and an answer', async () => {
    for (const [body, list, status] of [
      [{ teamId: TEAM }, { data: null, error: { message: 'no' } }, 403],
      [{ teamId: 'x' }, undefined, 400],
      [{ teamId: TEAM }, undefined, 200],
    ] as const) {
      const { deps } = setup(list ? { list } : {});
      const response = await handle(post(body), deps);
      expect(response.status).toBe(status);
      for (const [name, value] of Object.entries(CORS)) expect(response.headers.get(name)).toBe(value);
    }
  });
});

describe('reading the games from PlayHQ', () => {
  it('asks PlayHQ for each game on its own site, as playhq.com does', async () => {
    const { deps, fetch } = setup();
    await handleResults(TEAM, post({ teamId: TEAM }), deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(API);
    expect((init.headers as Record<string, string>).tenant).toBe('netball-australia');
    expect((init.headers as Record<string, string>).origin).toBe('https://www.playhq.com');
    expect(JSON.parse(init.body as string)).toEqual({ query: GAME_QUERY, variables: { gameID: 'r1' } });
  });

  it('answers the games with a result, in the database\'s order, with lineup names', async () => {
    const { deps } = setup({
      list: { data: { games: [fixture({ fixture_id: 'f3', playhq_game_id: 'r3', opponent: 'Kites' }), fixture()], names: NAMES }, error: null },
      games: { r1: GAME, r3: { ...GAME, id: 'r3', result: { home: { score: 50 }, away: { score: 20 } } } },
    });
    const body = await (await handleResults(TEAM, post({ teamId: TEAM }), deps)).json();
    expect(body.failed).toBe(0);
    expect(body.games.map((g: { id: string; us: number }) => [g.id, g.us])).toEqual([['f3', 50], ['f1', 41]]);
    expect(body.games[1].players.map((p: { name: string }) => p.name)).toEqual(['Fill In', 'JJ Junior', 'Kai Senior', 'Robin Centre']);
  });

  it('leaves out a game PlayHQ doesn\'t have or hasn\'t scored, and says how many it couldn\'t read', async () => {
    const { deps, logger } = setup({
      list: {
        data: {
          games: [fixture(), fixture({ fixture_id: 'f2', playhq_game_id: 'gone' }), fixture({ fixture_id: 'f3', playhq_game_id: 'blocked' }), fixture({ fixture_id: 'f4', playhq_game_id: 'unscored' })],
          names: [],
        },
        error: null,
      },
      games: { r1: GAME, gone: null, blocked: 'fail', unscored: { id: 'unscored' } },
    });
    const response = await handleResults(TEAM, post({ teamId: TEAM }), deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.games.map((g: { id: string }) => g.id)).toEqual(['f1']);
    expect(body.failed).toBe(1);
    expect(logged(logger)).toContainEqual(expect.objectContaining({ message: 'Results read', unrecorded: 4, with_result: 1, failed: 1 }));
  });

  it('answers 502 when PlayHQ gives none of the games', async () => {
    const { deps } = setup({ games: { r1: 'fail' } });
    const response = await handleResults(TEAM, post({ teamId: TEAM }), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Couldn’t reach PlayHQ' });
  });

  it('answers an empty list, without asking PlayHQ, when every game was recorded', async () => {
    const { deps, fetch } = setup({ list: { data: { games: [], names: NAMES }, error: null } });
    const response = await handleResults(TEAM, post({ teamId: TEAM }), deps);
    expect(await response.json()).toEqual({ games: [], failed: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it(`reads ${MAX_RESULTS} games at most, and skips rows that aren't games or name another site oddly`, async () => {
    const many = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => fixture({ fixture_id: `f${i}`, playhq_game_id: `g${i}` }));
    const { deps, fetch } = setup({
      list: { data: { games: [null, { fixture_id: 'x' }, fixture({ tenant: 'evil.example/..' }), ...many], names: 'nope' }, error: null },
      games: {},
    });
    const response = await handleResults(TEAM, post({ teamId: TEAM }), deps);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(MAX_RESULTS);
  });

  it('logs ids and counts, never a player\'s name', async () => {
    const { deps, logger } = setup();
    await handleResults(TEAM, post({ teamId: TEAM }), deps);
    const text = JSON.stringify(logged(logger));
    for (const name of ['Jordan', 'Junior', 'Kai', 'Hidden', 'Shooter']) expect(text).not.toContain(name);
  });
});

describe('the admins\' competition lookup', () => {
  it('still answers a body without teamId, checking is_admin', async () => {
    const rpc = jest.fn(async (_fn: string) => ({ data: false, error: null }));
    const { deps } = setup();
    const response = await handle(post({ tenant: 'netball-australia', seasonCode: 'abc123' }), { ...deps, makeClient: () => ({ rpc }) });
    expect(rpc).toHaveBeenCalledWith('is_admin');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only admins can read PlayHQ fixtures' });
  });

  it('answers OPTIONS with ok and the CORS headers, without checking anything', async () => {
    const { deps, makeClient } = setup();
    const response = await handle(new Request('https://example.test/functions/v1/playhq', { method: 'OPTIONS' }), deps);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('treats a body that isn\'t JSON as the competition lookup, which refuses it', async () => {
    const rpc = jest.fn(async (_fn: string) => ({ data: true, error: null }));
    const { deps } = setup();
    const request = new Request('https://example.test/functions/v1/playhq', { method: 'POST', headers: { Authorization: TOKEN }, body: 'not json' });
    const response = await handle(request, { ...deps, makeClient: () => ({ rpc }) });
    expect(response.status).toBe(400);
  });
});
