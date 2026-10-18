/**
 * @jest-environment node
 */
// The playhq function reads a PlayHQ season for club admins. These tests pin
// who may call it, its request checks, how PlayHQ's rounds become teams and
// games, and how PlayHQ failures reach the app.

import {
  anonKey,
  API,
  collectFixtures,
  CORS,
  handlePlayhq,
  TIMEZONES,
  type AdminCheckClient,
  type Fetch,
  type Round,
} from '../fixtures';

const TOKEN = 'Bearer eyJ-member-token';

type AdminAnswer = { data: unknown; error: { message: string } | null };

function fakeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function logged(logger: ReturnType<typeof fakeLogger>) {
  return (['info', 'warn', 'error'] as const).flatMap((level) =>
    logger[level].mock.calls.map(([line]) => JSON.parse(line as string)),
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const SEASON = {
  id: 'season-1',
  name: 'Summer 2026',
  competition: { id: 'comp-1', name: 'State League' },
  grades: [
    { id: 'g-17', name: '17/U Girls' },
    { id: 'g-open', name: 'Open Women' },
  ],
};

/** A PlayHQ stand-in: answers the season query, then each grade query by id. */
function playhq(
  season: unknown = SEASON,
  grades: Record<string, Round[] | null> = {},
): jest.Mock<ReturnType<Fetch>, Parameters<Fetch>> {
  return jest.fn(async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(init.body as string);
    if (query.includes('discoverSeason')) return jsonResponse({ data: { discoverSeason: season } });
    return jsonResponse({ data: { discoverGradeFixture: grades[variables.gradeID] ?? [] } });
  });
}

function setup({
  admin = { data: true, error: null } as AdminAnswer,
  fetch = playhq(),
}: { admin?: AdminAnswer; fetch?: jest.Mock<ReturnType<Fetch>, Parameters<Fetch>> } = {}) {
  const rpc = jest.fn(async () => admin);
  const client: AdminCheckClient = { rpc };
  const makeClient = jest.fn((_authorization: string) => client);
  const logger = fakeLogger();
  return { deps: { fetch, logger, makeClient }, rpc, makeClient, logger, fetch };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: TOKEN }) {
  return new Request('https://example.test/functions/v1/playhq', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const GOOD = { tenant: 'netball-wa', seasonCode: 'ec69e46d' };

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-18T02:00:00Z') });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('CORS', () => {
  it('answers OPTIONS with ok and the CORS headers, without checking anything', async () => {
    const { deps, makeClient, fetch } = setup();
    const response = await handlePlayhq(
      new Request('https://example.test/functions/v1/playhq', { method: 'OPTIONS' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'authorization, x-client-info, apikey, content-type',
    );
    expect(makeClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['refusal', { data: false, error: null }, GOOD, 403],
    ['bad request', { data: true, error: null }, { tenant: 'x' }, 400],
    ['success', { data: true, error: null }, GOOD, 200],
  ])('sends the CORS headers with a %s', async (_label, admin, body, status) => {
    const { deps } = setup({ admin: admin as AdminAnswer });
    const response = await handlePlayhq(post(body), deps);
    expect(response.status).toBe(status);
    for (const [name, value] of Object.entries(CORS)) expect(response.headers.get(name)).toBe(value);
  });
});

describe('only admins', () => {
  it('checks is_admin as the caller, with their Authorization header', async () => {
    const { deps, makeClient, rpc } = setup();
    await handlePlayhq(post(GOOD), deps);
    expect(makeClient).toHaveBeenCalledWith(TOKEN);
    expect(rpc).toHaveBeenCalledWith('is_admin');
  });

  it('checks a signed-out caller with an empty Authorization header', async () => {
    const { deps, makeClient } = setup({ admin: { data: false, error: null } });
    const response = await handlePlayhq(post(GOOD, {}), deps);
    expect(makeClient).toHaveBeenCalledWith('');
    expect(response.status).toBe(403);
  });

  it.each([
    ['is_admin says false', { data: false, error: null }, null],
    ['is_admin returns null', { data: null, error: null }, null],
    ['the check fails', { data: null, error: { message: 'JWT expired' } }, 'JWT expired'],
    ['the check fails even with data', { data: false, error: { message: 'permission denied' } }, 'permission denied'],
  ])('refuses with 403 when %s, before reading the body or calling PlayHQ', async (_label, admin, reason) => {
    const { deps, fetch, logger } = setup({ admin: admin as AdminAnswer });
    const request = post(GOOD);
    const response = await handlePlayhq(request, deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only admins can read PlayHQ fixtures' });
    expect(request.bodyUsed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(logged(logger)).toEqual([{ level: 'warn', message: 'Refused: not an admin', check_failed: reason }]);
  });

  it('checks admins on any method other than OPTIONS', async () => {
    const { deps, rpc } = setup({ admin: { data: false, error: null } });
    const response = await handlePlayhq(
      new Request('https://example.test/functions/v1/playhq', { method: 'GET' }),
      deps,
    );
    expect(rpc).toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it('lets an admin through', async () => {
    const { deps } = setup();
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(200);
  });
});

describe('request checks', () => {
  it.each([
    ['no body', ''],
    ['a body that is not JSON', 'tenant=netball-wa'],
    ['a JSON null body', 'null'],
    ['an empty object', {}],
    ['no season code', { tenant: 'netball-wa' }],
    ['no tenant', { seasonCode: 'ec69e46d' }],
    ['an upper-case tenant', { tenant: 'Netball-WA', seasonCode: 'ec69e46d' }],
    ['a tenant with a slash', { tenant: 'netball/wa', seasonCode: 'ec69e46d' }],
    ['a tenant with a space', { tenant: 'netball wa', seasonCode: 'ec69e46d' }],
    ['an empty tenant', { tenant: '', seasonCode: 'ec69e46d' }],
    ['a season code of 5 characters', { tenant: 'netball-wa', seasonCode: 'ec69e' }],
    ['a season code that is not hex', { tenant: 'netball-wa', seasonCode: 'ec69e46z' }],
    ['a season code with a path', { tenant: 'netball-wa', seasonCode: 'ec69e46d/x' }],
  ])('refuses %s with 400 without calling PlayHQ', async (_label, body) => {
    const { deps, fetch, logger } = setup();
    const response = await handlePlayhq(post(body), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'That isn’t a PlayHQ competition link' });
    expect(fetch).not.toHaveBeenCalled();
    const [line] = logged(logger);
    expect(line.message).toBe('Refused: bad competition link');
    expect(line.level).toBe('warn');
  });

  it('logs what it was given, or null', async () => {
    const { deps, logger } = setup();
    await handlePlayhq(post({ tenant: 'Bad' }), deps);
    expect(logged(logger)).toEqual([
      { level: 'warn', message: 'Refused: bad competition link', tenant: 'Bad', seasonCode: null },
    ]);
  });

  it.each([
    ['a 6-character code', { tenant: 'netball-wa', seasonCode: 'abc123' }],
    ['an upper-case hex code', { tenant: 'netball-wa', seasonCode: 'EC69E46D' }],
    ['digits in the tenant', { tenant: 'basketball-vic-2', seasonCode: 'ec69e46d' }],
  ])('accepts %s', async (_label, body) => {
    const { deps, fetch } = setup();
    const response = await handlePlayhq(post(body), deps);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalled();
  });
});

describe('PlayHQ requests', () => {
  it('asks PlayHQ for the season, then each grade, looking like playhq.com', async () => {
    const { deps, fetch } = setup();
    await handlePlayhq(post(GOOD), deps);
    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(API);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      origin: 'https://www.playhq.com',
      referer: 'https://www.playhq.com/',
      tenant: 'netball-wa',
      'user-agent': 'WestCoastThunder/1.0',
    });
    expect(JSON.parse(init.body as string).variables).toEqual({ id: 'ec69e46d' });
    const gradeIds = fetch.mock.calls.slice(1).map(([, i]) => JSON.parse(i.body as string).variables.gradeID);
    expect(gradeIds.sort()).toEqual(['g-17', 'g-open']);
  });

  it('never sends the member token to PlayHQ or the logs', async () => {
    const { deps, fetch, logger } = setup();
    await handlePlayhq(post(GOOD), deps);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('eyJ');
    expect(JSON.stringify(logged(logger))).not.toContain('eyJ');
  });

  it('answers 404 when PlayHQ has no season at that link', async () => {
    const { deps, fetch, logger } = setup({ fetch: playhq(null) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'PlayHQ has no competition at that link' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logged(logger).map((l) => l.message)).toContain('No competition at that link');
  });

  it('returns an empty competition for a season with no grades', async () => {
    const { deps, fetch } = setup({ fetch: playhq({ id: 's', name: 'Winter 2026' }) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ id: 's', name: 'Winter 2026', teams: [], games: [] });
  });

  it('treats a grade with no fixture (null) as no rounds', async () => {
    const { deps } = setup({ fetch: playhq(SEASON, { 'g-17': null }) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).games).toEqual([]);
  });
});

describe('PlayHQ failures', () => {
  it('answers 502 when PlayHQ refuses, and logs the CloudFront headers', async () => {
    const fetch = jest.fn(async () =>
      new Response('<html>blocked</html>', {
        status: 403,
        headers: { server: 'CloudFront', 'x-cache': 'Error from cloudfront' },
      }),
    );
    const { deps, logger } = setup({ fetch });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'PlayHQ answered 403' });
    const lines = logged(logger);
    expect(lines).toContainEqual({
      level: 'error',
      message: 'PlayHQ request failed',
      query: 'season',
      variables: { id: 'ec69e46d' },
      status: 403,
      server: 'CloudFront',
      cache: 'Error from cloudfront',
      ms: 0,
    });
    expect(lines.at(-1)).toEqual({
      level: 'error',
      message: 'Lookup failed',
      tenant: 'netball-wa',
      seasonCode: 'ec69e46d',
      reason: 'PlayHQ answered 403',
      ms: 0,
    });
  });

  it('answers 502 with the first GraphQL error when PlayHQ sends no data', async () => {
    const fetch = jest.fn(async () =>
      jsonResponse({ errors: [{ message: 'Season not public' }, { message: 'b' }, { message: 'c' }, { message: 'd' }] }),
    );
    const { deps, logger } = setup({ fetch });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'PlayHQ: Season not public' });
    const line = logged(logger).find((l) => l.message === 'PlayHQ returned errors');
    expect(line.level).toBe('error');
    // At most three messages go to the logs.
    expect(line.errors).toEqual(['Season not public', 'b', 'c']);
  });

  it('carries on, with a warning, when PlayHQ sends data alongside errors', async () => {
    const fetch = jest.fn(async () =>
      jsonResponse({ data: { discoverSeason: { id: 's', name: 'Winter' } }, errors: [{ message: 'partial' }] }),
    );
    const { deps, logger } = setup({ fetch });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(200);
    expect(logged(logger).find((l) => l.message === 'PlayHQ returned errors')?.level).toBe('warn');
  });

  it('answers 502 when PlayHQ sends neither data nor errors', async () => {
    const { deps, logger } = setup({ fetch: jest.fn(async () => jsonResponse({})) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'PlayHQ sent nothing back' });
    expect(logged(logger).map((l) => l.message)).toContain('PlayHQ sent nothing back');
  });

  it('answers 502 when PlayHQ sends something that is not JSON', async () => {
    const fetch = jest.fn(async () => new Response('<html>maintenance</html>', { status: 200 }));
    const { deps, logger } = setup({ fetch });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    // Node's SyntaxError comes from another realm under Jest, so the message
    // the caller sees can differ from Deno's; the logged reason names it.
    expect(typeof (await response.json()).error).toBe('string');
    expect(logged(logger).at(-1)).toMatchObject({ message: 'Lookup failed', reason: expect.stringMatching(/JSON/) });
  });

  it('answers 502 with the reason when the request times out or the network fails', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const { deps, logger } = setup({ fetch: jest.fn(async () => Promise.reject(timeout)) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The operation was aborted due to timeout' });
    expect(logged(logger).at(-1)).toMatchObject({
      message: 'Lookup failed',
      reason: 'The operation was aborted due to timeout',
    });
  });

  it('answers 502 with a general message when the failure is not an Error', async () => {
    const { deps, logger } = setup({ fetch: jest.fn(async () => Promise.reject('socket hang up')) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Couldn’t reach PlayHQ' });
    expect(logged(logger).at(-1)).toMatchObject({ reason: 'socket hang up' });
  });

  it('fails the whole lookup when one grade fails', async () => {
    const ok = playhq();
    const fetch = jest.fn(async (url: string, init: RequestInit) => {
      if (JSON.parse(init.body as string).variables.gradeID === 'g-open') {
        return new Response('', { status: 500 });
      }
      return ok(url, init);
    });
    const { deps } = setup({ fetch });
    const response = await handlePlayhq(post(GOOD), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'PlayHQ answered 500' });
  });
});

// A round with a dated game at a WA venue, a bye, and a provisional team.
const ROUND_1: Round = {
  id: 'r1',
  name: 'Round 1',
  isFinalsRound: false,
  byes: [{ id: 't-bye', name: 'Bye Team' }],
  games: [
    {
      id: 'game-1',
      status: { value: 'UPCOMING' },
      date: '2026-10-24',
      home: { id: 't-thunder', name: 'Thunder' },
      away: { id: 't-storm', name: 'Storm' },
      allocation: {
        time: '09:30:00',
        court: { name: 'Court 2', venue: { name: 'State Netball Centre', suburb: 'Jolimont', state: 'WA' } },
      },
    },
  ],
};

describe('collectFixtures', () => {
  const grade = { id: 'g-17', name: '17/U Girls' };

  it('turns a dated game into a game with its venue, court, time and zone', () => {
    const { games, teams } = collectFixtures([{ grade, rounds: [{ ...ROUND_1, byes: [] }] }]);
    expect(games).toEqual([
      {
        id: 'game-1',
        date: '2026-10-24',
        time: '09:30:00',
        timezone: 'Australia/Perth',
        round: 'Round 1',
        is_final: false,
        grade: '17/U Girls',
        venue: 'State Netball Centre',
        court: 'Court 2',
        status: 'UPCOMING',
        home: { id: 't-thunder', name: 'Thunder' },
        away: { id: 't-storm', name: 'Storm' },
      },
    ]);
    expect([...teams.values()]).toEqual([
      { id: 't-thunder', name: 'Thunder', grade: '17/U Girls' },
      { id: 't-storm', name: 'Storm', grade: '17/U Girls' },
    ]);
  });

  it('adds a bye game on the round’s first game date, and the bye team', () => {
    const round: Round = {
      ...ROUND_1,
      games: [{ ...ROUND_1.games![0], id: 'undated', date: null }, ...ROUND_1.games!, { ...ROUND_1.games![0], id: 'later', date: '2026-10-25' }],
    };
    const { games, teams } = collectFixtures([{ grade, rounds: [round] }]);
    const bye = games.find((g) => g.status === 'BYE');
    expect(bye).toEqual({
      id: 'bye-r1-t-bye',
      date: '2026-10-24',
      time: null,
      timezone: 'Australia/Perth',
      round: 'Round 1',
      is_final: false,
      grade: '17/U Girls',
      venue: null,
      court: null,
      status: 'BYE',
      home: { id: 't-bye', name: 'Bye Team' },
      away: null,
    });
    // Byes come after the round's games.
    expect(games.at(-1)).toBe(bye);
    expect(teams.get('t-bye')).toEqual({ id: 't-bye', name: 'Bye Team', grade: '17/U Girls' });
  });

  it('skips the bye game, but keeps the team, when no game in the round has a date', () => {
    const round: Round = { ...ROUND_1, games: [{ ...ROUND_1.games![0], date: null }] };
    const { games, teams } = collectFixtures([{ grade, rounds: [round] }]);
    expect(games).toEqual([]);
    expect(teams.has('t-bye')).toBe(true);
  });

  it('skips the bye game in a round with no games at all', () => {
    const { games, teams } = collectFixtures([{ grade, rounds: [{ id: 'r9', byes: [{ id: 'b', name: 'B' }] }] }]);
    expect(games).toEqual([]);
    expect(teams.has('b')).toBe(true);
  });

  it('keeps the teams of an undated game but leaves the game out', () => {
    const round: Round = { id: 'r2', games: [{ ...ROUND_1.games![0], date: undefined }] };
    const { games, teams } = collectFixtures([{ grade, rounds: [round] }]);
    expect(games).toEqual([]);
    expect([...teams.keys()]).toEqual(['t-thunder', 't-storm']);
  });

  it('gives provisional teams (no id yet) no team and no entry in teams', () => {
    const round: Round = {
      id: 'gf',
      name: 'Grand Final',
      isFinalsRound: true,
      games: [
        {
          id: 'final',
          date: '2026-12-05',
          home: { name: 'Winner SF1' },
          away: { id: 't-storm', name: 'Storm' },
          allocation: null,
        },
        { id: 'final-2', date: '2026-12-05', home: null, away: { id: 't-x' } },
      ],
    };
    const { games, teams } = collectFixtures([{ grade, rounds: [round] }]);
    expect(games[0]).toMatchObject({ home: null, away: { id: 't-storm', name: 'Storm' }, is_final: true, round: 'Grand Final' });
    expect(games[1]).toMatchObject({ home: null, away: null });
    expect([...teams.keys()]).toEqual(['t-storm']);
  });

  it('fills in nulls when PlayHQ has no allocation, court, venue, status or round name', () => {
    const round: Round = {
      id: 'r3',
      games: [
        { id: 'a', date: '2026-11-01', allocation: null },
        { id: 'b', date: '2026-11-01', allocation: { time: '10:00:00', court: null } },
        { id: 'c', date: '2026-11-01', allocation: { court: { name: 'Court 1' } }, status: null },
        { id: 'd', date: '2026-11-01', allocation: { time: null, court: { venue: { name: 'Hall' } } }, status: {} },
      ],
    };
    const { games } = collectFixtures([{ grade, rounds: [round] }]);
    expect(games.map(({ id, time, timezone, venue, court, status, round: r, is_final }) => ({ id, time, timezone, venue, court, status, r, is_final }))).toEqual([
      { id: 'a', time: null, timezone: 'Australia/Perth', venue: null, court: null, status: null, r: null, is_final: false },
      { id: 'b', time: '10:00:00', timezone: 'Australia/Perth', venue: null, court: null, status: null, r: null, is_final: false },
      { id: 'c', time: null, timezone: 'Australia/Perth', venue: null, court: 'Court 1', status: null, r: null, is_final: false },
      { id: 'd', time: null, timezone: 'Australia/Perth', venue: 'Hall', court: null, status: null, r: null, is_final: false },
    ]);
  });

  it('marks every game and bye in a finals round as a final', () => {
    const { games } = collectFixtures([{ grade, rounds: [{ ...ROUND_1, isFinalsRound: true }] }]);
    expect(games.map((g) => g.is_final)).toEqual([true, true]);
  });

  it('labels each team with the grade it was last seen in', () => {
    const { teams } = collectFixtures([
      { grade, rounds: [{ ...ROUND_1, byes: [] }] },
      { grade: { id: 'g-open', name: 'Open Women' }, rounds: [{ id: 'r', byes: [{ id: 't-storm', name: 'Storm' }] }] },
    ]);
    expect(teams.get('t-storm')?.grade).toBe('Open Women');
    expect(teams.get('t-thunder')?.grade).toBe('17/U Girls');
  });
});

describe('the whole response', () => {
  it('names the competition, sorts teams by name and lists every grade’s games', async () => {
    const fetch = playhq(SEASON, {
      'g-17': [ROUND_1],
      'g-open': [
        {
          id: 'r1o',
          name: 'Round 1',
          games: [{ id: 'g2', date: '2026-10-25', home: { id: 't-aces', name: 'Aces' }, away: { id: 't-zeph', name: 'Zephyrs' } }],
        },
      ],
    });
    const { deps, logger } = setup({ fetch });
    const response = await handlePlayhq(post(GOOD), deps);
    const body = await response.json();
    expect(body.id).toBe('season-1');
    expect(body.name).toBe('State League · Summer 2026');
    expect(body.teams.map((t: { name: string }) => t.name)).toEqual(['Aces', 'Bye Team', 'Storm', 'Thunder', 'Zephyrs']);
    expect(body.games.map((g: { id: string }) => g.id)).toEqual(['game-1', 'bye-r1-t-bye', 'g2']);
    const read = logged(logger).find((l) => l.message === 'Competition read');
    expect(read).toEqual({
      level: 'info',
      message: 'Competition read',
      tenant: 'netball-wa',
      seasonCode: 'ec69e46d',
      season_id: 'season-1',
      grades: [
        { grade_id: 'g-17', rounds: 1, games: 1 },
        { grade_id: 'g-open', rounds: 1, games: 1 },
      ],
      team_count: 5,
      game_count: 3,
      undated_count: 0,
      ms: 0,
    });
  });

  it('uses just the season name when PlayHQ gives no competition name', async () => {
    const { deps } = setup({ fetch: playhq({ id: 's', name: 'Winter 2026', competition: {} }) });
    const response = await handlePlayhq(post(GOOD), deps);
    expect((await response.json()).name).toBe('Winter 2026');
  });
});

// PlayHQ gives the venue's local date and time with no zone; the function
// labels each game with its venue state's zone so the time can be placed.
describe('venue time zones', () => {
  function gameAt(state: string | undefined, date: string) {
    const { games } = collectFixtures([
      {
        grade: { id: 'g', name: 'G' },
        rounds: [
          {
            id: 'r',
            games: [
              {
                id: 'x',
                date,
                allocation: { time: '18:00:00', court: { name: 'C', venue: { name: 'V', state } } },
              },
            ],
          },
        ],
      },
    ]);
    return games[0];
  }

  /** The UTC instant of a local date and time in a zone, worked out with Intl. */
  function toUtc(date: string, time: string, timeZone: string) {
    const guess = new Date(`${date}T${time}Z`);
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(guess);
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
  }

  it.each([
    ['WA', 'Australia/Perth'],
    ['SA', 'Australia/Adelaide'],
    ['NT', 'Australia/Darwin'],
    ['QLD', 'Australia/Brisbane'],
    ['NSW', 'Australia/Sydney'],
    ['ACT', 'Australia/Sydney'],
    ['VIC', 'Australia/Melbourne'],
    ['TAS', 'Australia/Hobart'],
  ])('labels a %s venue %s', (state, zone) => {
    expect(gameAt(state, '2026-10-24').timezone).toBe(zone);
    expect(TIMEZONES[state]).toBe(zone);
  });

  it.each([['wa'], ['New South Wales'], [''], [undefined]])('falls back to Perth for an unknown state (%s)', (state) => {
    expect(gameAt(state, '2026-10-24').timezone).toBe('Australia/Perth');
  });

  // Daylight saving runs from 4 October 2026 to 4 April 2027 in NSW and VIC;
  // WA and QLD have none.
  it.each([
    ['NSW', '2026-10-24', '2026-10-24T07:00:00.000Z'], // AEDT, +11
    ['NSW', '2026-06-13', '2026-06-13T08:00:00.000Z'], // AEST, +10
    ['VIC', '2027-03-20', '2027-03-20T07:00:00.000Z'], // AEDT, +11
    ['VIC', '2027-05-01', '2027-05-01T08:00:00.000Z'], // AEST, +10
    ['WA', '2026-10-24', '2026-10-24T10:00:00.000Z'], // AWST, +8
    ['WA', '2026-06-13', '2026-06-13T10:00:00.000Z'],
    ['QLD', '2026-10-24', '2026-10-24T08:00:00.000Z'], // AEST, +10
    ['QLD', '2026-06-13', '2026-06-13T08:00:00.000Z'],
  ])('a 6 pm game at a %s venue on %s is %s', (state, date, utc) => {
    const game = gameAt(state, date);
    expect(toUtc(game.date, game.time!, game.timezone)).toBe(utc);
  });
});

describe('anonKey', () => {
  const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });

  it('prefers the default publishable key, then the legacy anon key', () => {
    expect(anonKey(env({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_1"}', SUPABASE_ANON_KEY: 'anon' }))).toBe(
      'sb_publishable_1',
    );
    expect(anonKey(env({ SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_ANON_KEY: 'anon' }))).toBe('anon');
    expect(anonKey(env({ SUPABASE_ANON_KEY: 'anon' }))).toBe('anon');
  });
});
