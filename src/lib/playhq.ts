import { supabase } from '@/lib/supabase';

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

/** Every grade's teams and games in a PlayHQ competition season. */
export async function fetchPlayhqCompetition(link: PlayhqLink): Promise<PlayhqCompetition> {
  const { data, error } = await supabase.functions.invoke('playhq', {
    body: { tenant: link.tenant, seasonCode: link.seasonCode },
  });
  if (error) {
    // The function's own message says what went wrong.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'Couldn’t reach PlayHQ');
  }
  return data as PlayhqCompetition;
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
