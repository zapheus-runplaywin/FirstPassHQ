// The playhq function's logic, kept free of Deno globals and npm: imports so
// Jest can test it (supabase/functions/playhq/__tests__). index.ts is the Deno
// wrapper that builds the real Supabase client and serves it. Everything that
// depends on PlayHQ's schema is in this file.

export const API = 'https://api.playhq.com/graphql';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

/** Reads the function's secrets: Deno.env in the function, a stub in tests. */
export type Env = { get(name: string): string | undefined };

/** The parts of the Supabase client the function uses. */
export interface AdminCheckClient {
  rpc(fn: 'is_admin'): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type PlayhqDeps = {
  fetch: Fetch;
  logger: Logger;
  /** Builds a client that acts as the caller, from their Authorization header. */
  makeClient: (authorization: string) => AdminCheckClient;
};

// One JSON line per event in the function's logs (Supabase dashboard, Edge
// Functions, playhq, Logs). No tokens or people: ids, counts and timings only.
export function makeLog(logger: Logger) {
  return (level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown> = {}) => {
    logger[level](JSON.stringify({ level, message, ...data }));
  };
}
export type Log = ReturnType<typeof makeLog>;

export const SEASON_QUERY = `
  query season($id: String!) {
    discoverSeason(seasonID: $id) {
      id
      name
      competition { id name }
      grades { id name }
    }
  }
`;

export const GRADE_QUERY = `
  query grade($gradeID: ID!) {
    discoverGradeFixture(gradeID: $gradeID) {
      id
      name
      isFinalsRound
      byes { id name }
      games {
        id
        status { value }
        date
        home { ... on DiscoverTeam { id name } ... on ProvisionalTeam { name } }
        away { ... on DiscoverTeam { id name } ... on ProvisionalTeam { name } }
        allocation {
          time
          court { name venue { name suburb state } }
        }
      }
    }
  }
`;

// PlayHQ gives game times in the venue's local time, without the time zone.
export const TIMEZONES: Record<string, string> = {
  WA: 'Australia/Perth',
  SA: 'Australia/Adelaide',
  NT: 'Australia/Darwin',
  QLD: 'Australia/Brisbane',
  NSW: 'Australia/Sydney',
  ACT: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  TAS: 'Australia/Hobart',
};

type Team = { id?: string; name?: string } | null;

export type Round = {
  id: string;
  name?: string;
  isFinalsRound?: boolean;
  byes?: { id: string; name: string }[];
  games?: {
    id: string;
    status?: { value?: string } | null;
    date?: string | null;
    home?: Team;
    away?: Team;
    allocation?: {
      time?: string | null;
      court?: { name?: string; venue?: { name?: string; suburb?: string; state?: string } } | null;
    } | null;
  }[];
};

export type Grade = { id: string; name: string };

export type Season = {
  id: string;
  name: string;
  competition?: { name?: string };
  grades?: Grade[];
};

export async function query<T>(
  fetch: Fetch,
  log: Log,
  tenant: string,
  text: string,
  variables: Record<string, unknown>,
) {
  const started = Date.now();
  const name = text.match(/query (\w+)/)?.[1] ?? 'query';
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.playhq.com',
      referer: 'https://www.playhq.com/',
      tenant,
      'user-agent': 'WestCoastThunder/1.0',
    },
    body: JSON.stringify({ query: text, variables }),
  });
  const ms = Date.now() - started;
  if (!response.ok) {
    log('error', 'PlayHQ request failed', {
      query: name,
      variables,
      status: response.status,
      // CloudFront blocks show up here rather than as GraphQL errors.
      server: response.headers.get('server'),
      cache: response.headers.get('x-cache'),
      ms,
    });
    throw new Error(`PlayHQ answered ${response.status}`);
  }
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    log(body.data ? 'warn' : 'error', 'PlayHQ returned errors', {
      query: name,
      variables,
      errors: body.errors.slice(0, 3).map((e) => e.message),
      ms,
    });
  }
  if (body.errors?.length && !body.data) throw new Error(`PlayHQ: ${body.errors[0].message}`);
  if (!body.data) {
    log('error', 'PlayHQ sent nothing back', { query: name, variables, ms });
    throw new Error('PlayHQ sent nothing back');
  }
  log('info', 'PlayHQ request', { query: name, variables, ms });
  return body.data;
}

export function anonKey(env: Env) {
  const keys = env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return env.get('SUPABASE_ANON_KEY')!;
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

/** Turns each grade's rounds into the teams and games the app saves. */
export function collectFixtures(grades: { grade: Grade; rounds: Round[] }[]) {
  const teams = new Map<string, { id: string; name: string; grade: string }>();
  const games = [];
  for (const { grade, rounds } of grades) {
    for (const round of rounds) {
      for (const bye of round.byes ?? []) {
        teams.set(bye.id, { id: bye.id, name: bye.name, grade: grade.name });
      }
      for (const game of round.games ?? []) {
        // Finals between teams not decided yet have no team ids.
        const home =
          game.home?.id && game.home.name ? { id: game.home.id, name: game.home.name } : null;
        const away =
          game.away?.id && game.away.name ? { id: game.away.id, name: game.away.name } : null;
        for (const team of [home, away]) {
          if (team) teams.set(team.id, { ...team, grade: grade.name });
        }
        if (!game.date) continue;
        const venue = game.allocation?.court?.venue;
        games.push({
          id: game.id,
          date: game.date,
          time: game.allocation?.time ?? null,
          timezone: TIMEZONES[venue?.state ?? ''] ?? 'Australia/Perth',
          round: round.name ?? null,
          is_final: !!round.isFinalsRound,
          grade: grade.name,
          venue: venue?.name ?? null,
          court: game.allocation?.court?.name ?? null,
          status: game.status?.value ?? null,
          home,
          away,
        });
      }
      // A bye is a round with no game for that team.
      for (const bye of round.byes ?? []) {
        const date = (round.games ?? []).find((g) => g.date)?.date;
        if (!date) continue;
        games.push({
          id: `bye-${round.id}-${bye.id}`,
          date,
          time: null,
          timezone: 'Australia/Perth',
          round: round.name ?? null,
          is_final: !!round.isFinalsRound,
          grade: grade.name,
          venue: null,
          court: null,
          status: 'BYE',
          home: { id: bye.id, name: bye.name },
          away: null,
        });
      }
    }
  }
  return { teams, games };
}

/** The whole request: CORS, the admin check, validation, then PlayHQ. */
export async function handlePlayhq(request: Request, deps: PlayhqDeps): Promise<Response> {
  const log = makeLog(deps.logger);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = deps.makeClient(request.headers.get('Authorization') ?? '');
  const started = Date.now();
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin');
  if (!isAdmin) {
    log('warn', 'Refused: not an admin', { check_failed: adminError?.message ?? null });
    return json({ error: 'Only admins can read PlayHQ fixtures' }, 403);
  }

  // A body of null is valid JSON, so it falls back to {} too.
  const { tenant, seasonCode } = ((await request.json().catch(() => ({}))) ?? {}) as {
    tenant?: string;
    seasonCode?: string;
  };
  if (
    !tenant ||
    !/^[a-z0-9-]+$/.test(tenant) ||
    !seasonCode ||
    !/^[0-9a-f]{6,}$/i.test(seasonCode)
  ) {
    log('warn', 'Refused: bad competition link', { tenant: tenant ?? null, seasonCode: seasonCode ?? null });
    return json({ error: 'That isn’t a PlayHQ competition link' }, 400);
  }

  try {
    const { discoverSeason: season } = await query<{ discoverSeason: Season | null }>(
      deps.fetch,
      log,
      tenant,
      SEASON_QUERY,
      { id: seasonCode },
    );
    if (!season) {
      log('warn', 'No competition at that link', { tenant, seasonCode });
      return json({ error: 'PlayHQ has no competition at that link' }, 404);
    }
    log('info', 'Competition found', {
      tenant,
      seasonCode,
      season_id: season.id,
      grade_count: season.grades?.length ?? 0,
    });

    const grades = await Promise.all(
      (season.grades ?? []).map(async (grade) => ({
        grade,
        rounds:
          (
            await query<{ discoverGradeFixture: Round[] | null }>(deps.fetch, log, tenant, GRADE_QUERY, {
              gradeID: grade.id,
            })
          ).discoverGradeFixture ?? [],
      })),
    );

    const { teams, games } = collectFixtures(grades);

    log('info', 'Competition read', {
      tenant,
      seasonCode,
      season_id: season.id,
      grades: grades.map(({ grade, rounds }) => ({
        grade_id: grade.id,
        rounds: rounds.length,
        games: rounds.reduce((n, r) => n + (r.games?.length ?? 0), 0),
      })),
      team_count: teams.size,
      game_count: games.length,
      undated_count: grades.reduce(
        (n, { rounds }) =>
          n + rounds.reduce((m, r) => m + (r.games ?? []).filter((g) => !g.date).length, 0),
        0,
      ),
      ms: Date.now() - started,
    });
    return json({
      id: season.id,
      name: [season.competition?.name, season.name].filter(Boolean).join(' · '),
      teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
      games,
    });
  } catch (e) {
    log('error', 'Lookup failed', {
      tenant,
      seasonCode,
      reason: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
    });
    return json({ error: e instanceof Error ? e.message : 'Couldn’t reach PlayHQ' }, 502);
  }
}
