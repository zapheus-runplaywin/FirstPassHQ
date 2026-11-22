import { logger } from '@/lib/log';
import { supabase } from '@/lib/supabase';

/**
 * One athlete's own figures from a game recorded in FirstPass Vantage, as the
 * club's game-stats function works them out (supabase/functions/game-stats).
 * Net Points come only to the athlete's coaches: the server decides.
 */
export type GameStats = {
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
  netPoints?: number;
};

/** A game in the Games list in Administration (the admin_games function). */
export type AdminGame = {
  id: string;
  team_name: string | null;
  us: string | null;
  them: string | null;
  round_name: string | null;
  status: 'setup' | 'live' | 'final';
  created_at: string;
  finished_at: string | null;
  recorder_name: string | null;
  events: number;
  from_fixture: boolean;
};

export const GAMES_PAGE = 50;

const log = logger('game-stats');

/**
 * The athlete's figures for the game, or null when there are none to show:
 * the game wasn't recorded, isn't finished, the athlete didn't play, or the
 * stats couldn't be reached. The goals page works without them, so a failure
 * is logged and shows nothing.
 */
export async function fetchGameStats(athleteId: string, fixtureId: string): Promise<GameStats | null> {
  try {
    const { data, error } = await supabase.functions.invoke('game-stats', {
      body: { athleteId, fixtureId },
    });
    if (error) {
      log.warn('Game stats not available', { kind: error.name, reason: error.message });
      return null;
    }
    const stats = (data as { stats?: GameStats | null } | null)?.stats;
    return stats && typeof stats === 'object' ? stats : null;
  } catch (err) {
    log.warn('Game stats not available', { reason: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Such as "38 min" or "7.5 min". */
export function minutesLabel(minutes: number) {
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}

/** Such as "+4.5", "−2" or "0". */
export function netPointsLabel(points: number) {
  if (points === 0) return '0';
  const size = Math.abs(points);
  return `${points > 0 ? '+' : '−'}${Number.isInteger(size) ? size : size.toFixed(1)}`;
}

export type StatLine = { label: string; value: string };

/**
 * The lines of the stats card, in the order a coach reads them. Shooting and
 * rebounds only show for an athlete who had some, so a defender's card isn't
 * a row of noughts.
 */
export function statLines(stats: GameStats): StatLine[] {
  const lines: StatLine[] = [
    {
      label: 'Time on court',
      value: stats.positions.length
        ? `${minutesLabel(stats.minutes)} · ${stats.positions.join(', ')}`
        : minutesLabel(stats.minutes),
    },
  ];
  if (stats.shots > 0) {
    lines.push({
      label: 'Shooting',
      value: `${stats.goals} from ${stats.shots} (${Math.round((stats.goals / stats.shots) * 100)}%)`,
    });
  }
  if (stats.feeds > 0) lines.push({ label: 'Feeds', value: String(stats.feeds) });
  lines.push({ label: 'Gains', value: String(stats.gains) });
  lines.push({ label: 'Turnovers', value: String(stats.turnovers) });
  const rebounds = stats.offensiveRebounds + stats.defensiveRebounds;
  if (rebounds > 0) {
    lines.push({
      label: 'Rebounds',
      value: `${rebounds} (${stats.offensiveRebounds} attacking, ${stats.defensiveRebounds} defending)`,
    });
  }
  if (typeof stats.netPoints === 'number') {
    lines.push({ label: 'Net Points', value: netPointsLabel(stats.netPoints) });
  }
  return lines;
}

/** Such as "Sample Thunder v Swans". */
export function adminGameTitle(game: Pick<AdminGame, 'us' | 'them' | 'team_name'>) {
  const us = game.us?.trim() || game.team_name?.trim() || 'Our team';
  const them = game.them?.trim() || 'Opponent';
  return `${us} v ${them}`;
}

export function adminGameStatus(status: AdminGame['status']) {
  return status === 'final' ? 'Finished' : status === 'live' ? 'Being recorded' : 'Set up, not started';
}

/** Such as "Recorded by Sample statistician · 212 events". */
export function adminGameDetail(game: Pick<AdminGame, 'recorder_name' | 'events'>) {
  const who = game.recorder_name?.trim();
  return `${who ? `Recorded by ${who}` : 'No recorder named'} · ${plural(game.events, 'event', 'events')}`;
}

/** One page of the club's recorded games, newest first. Admins only: everyone else gets none. */
export async function fetchAdminGames(offset = 0): Promise<AdminGame[]> {
  const { data, error } = await supabase.rpc('admin_games', { p_limit: GAMES_PAGE, p_offset: offset });
  if (error) throw new Error(error.message);
  return (data as AdminGame[] | null) ?? [];
}
