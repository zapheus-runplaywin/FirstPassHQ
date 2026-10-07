// Reads a PlayHQ competition season's teams and games for club admins.
//
// It uses PlayHQ's public GraphQL API, the one playhq.com uses, which needs no
// client ID. That API only answers requests that look like they come from
// playhq.com, which the app can't send from a web browser, so the app asks
// this function instead. Only admins can call it; the app then saves the
// games with save_playhq_fixtures.
//
// Deployed from .github/workflows/playhq-function.yml. Everything that
// depends on PlayHQ's schema is in this file.

import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.playhq.com/graphql';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SEASON_QUERY = `
  query season($id: String!) {
    discoverSeason(seasonID: $id) {
      id
      name
      competition { id name }
      grades { id name }
    }
  }
`;

const GRADE_QUERY = `
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
const TIMEZONES: Record<string, string> = {
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

type Round = {
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

async function query<T>(tenant: string, text: string, variables: Record<string, unknown>) {
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
  if (!response.ok) throw new Error(`PlayHQ answered ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length && !body.data) throw new Error(`PlayHQ: ${body.errors[0].message}`);
  if (!body.data) throw new Error('PlayHQ sent nothing back');
  return body.data;
}

function anonKey() {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return Deno.env.get('SUPABASE_ANON_KEY')!;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, anonKey(), {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) return json({ error: 'Only admins can read PlayHQ fixtures' }, 403);

  const { tenant, seasonCode } = (await request.json().catch(() => ({}))) as {
    tenant?: string;
    seasonCode?: string;
  };
  if (
    !tenant ||
    !/^[a-z0-9-]+$/.test(tenant) ||
    !seasonCode ||
    !/^[0-9a-f]{6,}$/i.test(seasonCode)
  ) {
    return json({ error: 'That isn’t a PlayHQ competition link' }, 400);
  }

  try {
    const { discoverSeason: season } = await query<{
      discoverSeason: {
        id: string;
        name: string;
        competition?: { name?: string };
        grades?: { id: string; name: string }[];
      } | null;
    }>(tenant, SEASON_QUERY, { id: seasonCode });
    if (!season) return json({ error: 'PlayHQ has no competition at that link' }, 404);

    const grades = await Promise.all(
      (season.grades ?? []).map(async (grade) => ({
        grade,
        rounds:
          (
            await query<{ discoverGradeFixture: Round[] | null }>(tenant, GRADE_QUERY, {
              gradeID: grade.id,
            })
          ).discoverGradeFixture ?? [],
      })),
    );

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

    return json({
      id: season.id,
      name: [season.competition?.name, season.name].filter(Boolean).join(' · '),
      teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
      games,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Couldn’t reach PlayHQ' }, 502);
  }
});
