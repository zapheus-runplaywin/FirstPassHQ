import { logger } from '@/lib/log';
import { supabase } from '@/lib/supabase';

const log = logger('fixtures');

/**
 * PlayHQ competitions are read by the playhq function
 * (supabase/functions/playhq), which calls PlayHQ's public API for admins.
 */

/** The parts of a PlayHQ competition link the function needs. */
export type PlayhqLink = {
  /** Such as "netball-australia". */
  tenant: string;
  /** The season's short id at the end of the link, such as "ec69e46d". */
  seasonCode: string;
  url: string;
};

export type PlayhqTeam = { id: string; name: string; grade: string | null };

export type PlayhqGame = {
  id: string;
  date: string;
  /** Local to `timezone`; null when PlayHQ hasn't set one. */
  time: string | null;
  timezone: string | null;
  round: string | null;
  is_final: boolean;
  grade: string | null;
  venue: string | null;
  court: string | null;
  status: string | null;
  home: { id: string; name: string } | null;
  away: { id: string; name: string } | null;
};

export type PlayhqCompetition = {
  id: string;
  name: string;
  teams: PlayhqTeam[];
  games: PlayhqGame[];
};

/** How many games PlayHQ has either side of today, to show the link works. */
export type PlayhqSummary = {
  /** Games (not byes) dated in the 12 months before today. */
  pastCount: number;
  /** Games (not byes) dated from today to 12 months ahead. */
  upcomingCount: number;
  byeCount: number;
};

/** A looked-up competition, with its games counted and how long PlayHQ took. */
export type PlayhqLookup = PlayhqCompetition & {
  summary: PlayhqSummary;
  ms: number;
};

function isoDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Counts games in the last 12 months and the next 12 months. PlayHQ dates
 * are the venue's local day, so they're compared with today's date here.
 */
export function summarisePlayhqGames(
  games: Pick<PlayhqGame, 'date' | 'status'>[],
  now = new Date(),
): PlayhqSummary {
  const today = isoDay(now);
  const from = isoDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
  const to = isoDay(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
  const summary: PlayhqSummary = {
    pastCount: 0,
    upcomingCount: 0,
    byeCount: 0,
  };
  for (const game of games) {
    if (game.status === 'BYE') summary.byeCount++;
    else if (game.date >= from && game.date < today) summary.pastCount++;
    else if (game.date >= today && game.date <= to) summary.upcomingCount++;
  }
  return summary;
}

/**
 * Reads a link such as
 * https://www.playhq.com/netball-australia/org/<association>/<season-name>/ec69e46d,
 * with or without a page after it (/fixture, /teams and so on).
 */
export function parsePlayhqLink(text: string): PlayhqLink | null {
  const match = text
    .trim()
    .match(
      /^(?:https?:\/\/)?(?:www\.)?playhq\.com\/([a-z0-9-]+)\/org\/([^/]+)\/([^/]+)\/([0-9a-f]{6,})(?=[/?#]|$)/i,
    );
  if (!match) return null;
  const [, tenant, org, season, code] = match;
  return {
    tenant: tenant.toLowerCase(),
    seasonCode: code.toLowerCase(),
    url: `https://www.playhq.com/${tenant}/org/${org}/${season}/${code}`,
  };
}

/**
 * What to tell an admin when the playhq function fails. Its own errors come
 * back as { error }; anything else means the function didn't run, so say
 * which part failed rather than blaming PlayHQ.
 */
function lookupFailure(
  kind: string,
  status: number | null,
  body: { error?: string; message?: string } | null,
) {
  if (body?.error) return body.error;
  if (status === 404) {
    return 'The club’s PlayHQ service isn’t set up on this server (404). Run the “Deploy PlayHQ function” workflow.';
  }
  if (status === 401) return 'Your sign-in has expired (401). Sign out and in again.';
  if (kind === 'FunctionsFetchError') {
    return 'Couldn’t reach the club’s server. Check your connection and try again.';
  }
  const detail = [status, body?.message].filter(Boolean).join(': ');
  return `Couldn’t reach PlayHQ${detail ? ` (${detail})` : ''}`;
}

/** Every grade's teams and games in a PlayHQ competition season. */
export async function fetchPlayhqCompetition(link: PlayhqLink): Promise<PlayhqLookup> {
  const started = Date.now();
  log.info('Looking up PlayHQ competition', {
    tenant: link.tenant,
    season_id: link.seasonCode,
  });
  const { data, error } = await supabase.functions.invoke('playhq', {
    body: { tenant: link.tenant, seasonCode: link.seasonCode },
  });
  const ms = Date.now() - started;
  if (error) {
    // The function's own message says what went wrong.
    const context = (error as { context?: unknown }).context;
    const response = context instanceof Response ? context : null;
    const body = await response?.json().catch(() => null);
    const status = response?.status ?? null;
    log.error('PlayHQ lookup failed', {
      tenant: link.tenant,
      season_id: link.seasonCode,
      status,
      kind: error.name,
      reason: body?.error ?? body?.message ?? error.message,
      ms,
    });
    throw new Error(lookupFailure(error.name, status, body));
  }
  const competition = data as PlayhqCompetition;
  const summary = summarisePlayhqGames(competition.games ?? []);
  log.info('PlayHQ competition found', {
    season_id: link.seasonCode,
    competition_id: competition.id,
    competition: competition.name,
    team_count: competition.teams?.length ?? 0,
    game_count: competition.games?.length ?? 0,
    undated_count: competition.games?.filter((g) => !g.time).length ?? 0,
    past_12_months_count: summary.pastCount,
    next_12_months_count: summary.upcomingCount,
    bye_count: summary.byeCount,
    ms,
  });
  if (summary.pastCount + summary.upcomingCount === 0) {
    log.warn('PlayHQ competition has no games within 12 months', {
      competition_id: competition.id,
      game_count: competition.games?.length ?? 0,
    });
  }
  return {
    ...competition,
    teams: competition.teams ?? [],
    games: competition.games ?? [],
    summary,
    ms,
  };
}

/** One team's games, as save_playhq_fixtures takes them. */
export function gamesFor(competition: PlayhqCompetition, teamId: string) {
  return competition.games
    .filter((g) => g.home?.id === teamId || g.away?.id === teamId)
    .map((g) => {
      const home = g.home?.id === teamId;
      return {
        id: g.id,
        date: g.date,
        time: g.time,
        timezone: g.timezone,
        round: g.round,
        is_final: g.is_final,
        grade: g.grade,
        venue: g.venue,
        court: g.court,
        status: g.status,
        opponent: (home ? g.away?.name : g.home?.name) ?? null,
        is_home: g.away ? home : null,
      };
    });
}
