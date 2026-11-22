// PlayHQ results for games nobody recorded, for FirstPass Vision's season view.
//
// A team's season view adds up its games recorded in FirstPass Vantage. For a
// game with no statistician, PlayHQ may still hold the score and each
// shooter's goals from the association's scorer, which the public can already
// read on playhq.com. This reads those games for the people who already see
// the team's recorded games, and for nobody else: the database decides
// (playhq_unrecorded_games), as the caller.
//
// Only our own team's side leaves here: the score both ways, and for each of
// our players their position and shooting. A player PlayHQ hides from the
// public is left out. Nothing is stored, and the logs hold ids and counts.
//
// Like fixtures.ts, this file is free of Deno globals so Jest can test it.

import { CORS, handlePlayhq, json, makeLog, query, type Fetch, type Logger } from './fixtures.ts';

/** The most games read from PlayHQ for one request, and how many at once. */
export const MAX_RESULTS = 40;
const AT_ONCE = 4;

const STATS = 'statistics { count type { value } }';
const LINEUP = `players {
    player {
      __typename
      ... on DiscoverParticipant { profile { firstName lastName } }
      ... on DiscoverParticipantFillInPlayer { profile { firstName lastName } }
      ... on DiscoverGamePermitFillInPlayer { profile { firstName lastName } }
      ... on DiscoverRegularFillInPlayer { name }
      ... on DiscoverAnonymousParticipant { name }
    }
    ${STATS}
    playerPosition { shortName }
  }`;

/** One game in detail: the request playhq.com's game page makes, cut to what the season view shows. */
export const GAME_QUERY = `
  query discoverGame($gameID: ID!) {
    discoverGame(gameID: $gameID) {
      id
      status { value }
      result { home { score ${STATS} } away { score ${STATS} } }
      statistics { home { ${LINEUP} ${STATS} } away { ${LINEUP} ${STATS} } }
    }
  }
`;

type Stat = { count?: number | null; type?: { value?: string | null } | null };

type RawPlayer = {
  player?: {
    __typename?: string;
    name?: string | null;
    profile?: { firstName?: string | null; lastName?: string | null } | null;
  } | null;
  statistics?: Stat[] | null;
  playerPosition?: { shortName?: string | null } | null;
};

type RawSide = { players?: RawPlayer[] | null; statistics?: Stat[] | null };

export type RawGame = {
  id: string;
  status?: { value?: string | null } | null;
  result?: Partial<Record<'home' | 'away', { score?: number | null; statistics?: Stat[] | null } | null>> | null;
  statistics?: Partial<Record<'home' | 'away', RawSide | null>> | null;
};

/** A fixture the database says nobody recorded. */
export type Unrecorded = {
  fixture_id: string;
  playhq_game_id: string;
  tenant: string;
  starts_at: string;
  opponent: string;
  round_name: string | null;
  is_home: boolean;
};

export type LineupName = { registered: string; lineup: string };

export type ResultPlayer = {
  /** The name the team's lineup uses when PlayHQ's name is one of its athletes, else PlayHQ's. */
  name: string;
  /** Netball positions PlayHQ gave them (GS to GK), often just where they started. */
  positions: string[];
  goals: number;
  /** Every attempt, or null when the scorer recorded goals only. */
  shots: number | null;
};

export type GameResult = {
  /** The fixture's id in HQ. */
  id: string;
  playedAt: string;
  opponent: string;
  round: string | null;
  us: number;
  them: number;
  players: ResultPlayer[];
};

/** The parts of the Supabase client the results request uses. */
export interface ResultsClient {
  rpc(
    fn: 'playhq_unrecorded_games',
    args: { p_team_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type ResultsDeps = {
  fetch: Fetch;
  logger: Logger;
  makeClient: (authorization: string) => unknown;
};

const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function count(stats: Stat[] | null | undefined, type: string): number | null {
  const found = (stats ?? []).find((s) => s.type?.value === type);
  return typeof found?.count === 'number' ? found.count : null;
}

/** A name for matching: lower case, single spaces. */
export const plainName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

function score(game: RawGame, side: 'home' | 'away'): number | null {
  const result = game.result?.[side];
  const team = game.statistics?.[side]?.statistics;
  const total = result?.score ?? count(result?.statistics, 'TOTAL_SCORE') ?? count(team, 'TOTAL_SCORE');
  if (typeof total === 'number') return total;
  const ones = count(team, '1_POINT_SCORE');
  const twos = count(team, '2_POINT_SCORE');
  return ones === null && twos === null ? null : (ones ?? 0) + 2 * (twos ?? 0);
}

/**
 * Our side of one PlayHQ game, or null when PlayHQ has no score for it yet.
 * Two entries for one name (a player listed twice) are added together.
 */
export function readResult(fixture: Unrecorded, game: RawGame, names: readonly LineupName[]): GameResult | null {
  const ours = fixture.is_home ? 'home' : 'away';
  const us = score(game, ours);
  const them = score(game, fixture.is_home ? 'away' : 'home');
  if (us === null || them === null) return null;

  const lineup = new Map(names.map((n) => [plainName(n.registered), n.lineup] as const));
  const players = new Map<string, ResultPlayer>();
  for (const p of game.statistics?.[ours]?.players ?? []) {
    const who = p.player;
    // PlayHQ hides this player's name from the public, so it stays hidden here.
    if (!who || who.__typename === 'DiscoverAnonymousParticipant') continue;
    const given = who.profile
      ? `${who.profile.firstName ?? ''} ${who.profile.lastName ?? ''}`
      : (who.name ?? '');
    const key = plainName(given);
    if (!key) continue;
    const name = lineup.get(key) ?? given.trim().replace(/\s+/g, ' ');
    const goals = (count(p.statistics, '1_POINT_SCORE') ?? 0) + (count(p.statistics, '2_POINT_SCORE') ?? 0);
    const shots = count(p.statistics, 'GOAL_ATTEMPT');
    const position = (p.playerPosition?.shortName ?? '').toUpperCase();
    const held = players.get(plainName(name));
    if (held) {
      held.goals += goals;
      held.shots = held.shots === null || shots === null ? null : held.shots + shots;
      if (POSITIONS.includes(position) && !held.positions.includes(position)) held.positions.push(position);
    } else {
      players.set(plainName(name), { name, positions: POSITIONS.includes(position) ? [position] : [], goals, shots });
    }
  }
  return {
    id: fixture.fixture_id,
    playedAt: fixture.starts_at,
    opponent: fixture.opponent,
    round: fixture.round_name,
    us,
    them,
    players: [...players.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function unrecorded(data: unknown): { games: Unrecorded[]; names: LineupName[] } {
  const d = (data ?? {}) as { games?: unknown; names?: unknown };
  const games = (Array.isArray(d.games) ? d.games : []).filter(
    (g): g is Unrecorded =>
      !!g &&
      typeof g.fixture_id === 'string' &&
      typeof g.playhq_game_id === 'string' &&
      typeof g.tenant === 'string' &&
      /^[a-z0-9-]+$/.test(g.tenant) &&
      typeof g.starts_at === 'string' &&
      typeof g.opponent === 'string' &&
      typeof g.is_home === 'boolean',
  );
  const names = (Array.isArray(d.names) ? d.names : []).filter(
    (n): n is LineupName => !!n && typeof n.registered === 'string' && typeof n.lineup === 'string',
  );
  return { games: games.slice(0, MAX_RESULTS), names };
}

/** { teamId } from a signed-in member who sees the team's games: its unrecorded games from PlayHQ. */
export async function handleResults(teamId: unknown, request: Request, deps: ResultsDeps): Promise<Response> {
  const log = makeLog(deps.logger);
  const started = Date.now();
  if (typeof teamId !== 'string' || !UUID.test(teamId)) {
    log('warn', 'Refused: bad team', {});
    return json({ error: 'Choose a team' }, 400);
  }
  const supabase = deps.makeClient(request.headers.get('Authorization') ?? '') as ResultsClient;
  const { data, error } = await supabase.rpc('playhq_unrecorded_games', { p_team_id: teamId });
  if (error) {
    log('warn', 'Refused: may not see this team\'s games', { team_id: teamId, code: error.code ?? null });
    return json({ error: 'Only the team’s coaches and managers, statisticians and admins can read its PlayHQ results' }, 403);
  }

  const { games, names } = unrecorded(data);
  const results: (GameResult | null)[] = new Array(games.length).fill(null);
  let failed = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      const fixture = games[i];
      if (!fixture) return;
      try {
        const { discoverGame } = await query<{ discoverGame: RawGame | null }>(deps.fetch, log, fixture.tenant, GAME_QUERY, {
          gameID: fixture.playhq_game_id,
        });
        if (discoverGame) results[i] = readResult(fixture, discoverGame, names);
      } catch {
        // One game PlayHQ won't give doesn't hide the others; query() logged why.
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, games.length) }, worker));

  const read = results.filter((r): r is GameResult => r !== null);
  log('info', 'Results read', {
    team_id: teamId,
    unrecorded: games.length,
    with_result: read.length,
    failed,
    ms: Date.now() - started,
  });
  if (games.length && failed === games.length) return json({ error: 'Couldn’t reach PlayHQ' }, 502);
  return json({ games: read, failed });
}

/**
 * The whole function: a body with teamId asks for a team's unrecorded
 * results (above); anything else is the admins' competition lookup.
 */
export async function handle(request: Request, deps: ResultsDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const body = ((await request.clone().json().catch(() => null)) ?? {}) as { teamId?: unknown };
  if ('teamId' in body) return handleResults(body.teamId, request, deps);
  return handlePlayhq(request, deps as Parameters<typeof handlePlayhq>[1]);
}
