import { logger } from '@/lib/log';
import { supabase } from '@/lib/supabase';

/**
 * One athlete's own figures from a game recorded in FirstPass Vantage, as the
 * club's game-stats function works them out (supabase/functions/game-stats).
 * Only the athlete's coaches are answered: the server decides, and the athlete
 * and their guardians get none.
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

/**
 * One thing the athlete did in a recorded game, and when on the game clock:
 * the club's game-stats function gives them with the stats to the same
 * people. It holds no name and nothing about anyone else.
 */
export type GameMoment = {
  quarter: number;
  /** Seconds left on the quarter clock. */
  left: number;
  kind: MomentKind;
  position: string;
  detail?: string;
};

export type MomentKind = 'goal' | 'miss' | 'gain' | 'turnover' | 'feed' | 'centre pass' | 'touch' | 'penalty' | 'rebound';

/** The kinds, in the order their chips show, each with the word for several of them. */
export const MOMENT_KINDS: readonly { kind: MomentKind; label: string }[] = [
  { kind: 'goal', label: 'Goals' },
  { kind: 'miss', label: 'Misses' },
  { kind: 'feed', label: 'Feeds' },
  { kind: 'gain', label: 'Gains' },
  { kind: 'turnover', label: 'Turnovers' },
  { kind: 'rebound', label: 'Rebounds' },
  { kind: 'centre pass', label: 'Centre passes' },
  { kind: 'penalty', label: 'Penalties' },
  { kind: 'touch', label: 'Touches' },
];

const KINDS = new Set<string>(MOMENT_KINDS.map((k) => k.kind));

/** Only moments shaped as expected, so an answer from a newer function can't break the screen. */
function momentsOf(value: unknown): GameMoment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is GameMoment =>
      !!m &&
      typeof m === 'object' &&
      Number.isFinite((m as GameMoment).quarter) &&
      Number.isFinite((m as GameMoment).left) &&
      KINDS.has((m as GameMoment).kind) &&
      typeof (m as GameMoment).position === 'string',
  );
}

/**
 * The athlete's figures and their own moments in the game, for a selector
 * looking at a game in a selection round. Either is empty when there is
 * nothing to show, and the moments are empty until the club's game-stats
 * function is one that sends them.
 */
export async function fetchGameEvidence(
  athleteId: string,
  fixtureId: string,
): Promise<{ stats: GameStats | null; moments: GameMoment[] }> {
  try {
    const { data, error } = await supabase.functions.invoke('game-stats', {
      body: { athleteId, fixtureId, moments: true },
    });
    if (error) {
      log.warn('Game stats not available', { kind: error.name, reason: error.message });
      return { stats: null, moments: [] };
    }
    const answer = data as { stats?: GameStats | null; moments?: unknown } | null;
    const stats = answer?.stats && typeof answer.stats === 'object' ? answer.stats : null;
    return { stats, moments: stats ? momentsOf(answer?.moments) : [] };
  } catch (err) {
    log.warn('Game stats not available', { reason: err instanceof Error ? err.message : 'unknown' });
    return { stats: null, moments: [] };
  }
}

/** Such as "Q2 · 4:05 left". */
export function momentTime(moment: Pick<GameMoment, 'quarter' | 'left'>) {
  const left = Math.max(0, Math.round(moment.left));
  return `Q${moment.quarter} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
}

/** Such as "Gain (intercept) at GD" or "Rebound (defensive) at GK". */
export function momentLabel(moment: Pick<GameMoment, 'kind' | 'position' | 'detail'>) {
  const what = moment.kind === 'turnover' ? 'Turnover' : moment.kind.charAt(0).toUpperCase() + moment.kind.slice(1);
  const detail = moment.detail?.trim();
  return `${what}${detail ? ` (${detail.toLowerCase()})` : ''} at ${moment.position}`;
}

/** The kinds this athlete has moments of, in chip order, each with how many. */
export function momentChips(moments: GameMoment[]): { kind: MomentKind; label: string; count: number }[] {
  return MOMENT_KINDS.map((k) => ({ ...k, count: moments.filter((m) => m.kind === k.kind).length })).filter(
    (k) => k.count > 0,
  );
}

/**
 * How an observation about a moment starts, so the selector only adds what
 * they saw: such as "v Stars, Q2 4:05 left, gain (intercept) at GD: ".
 */
export function momentEvidence(opponent: string | null | undefined, moment: GameMoment) {
  const game = opponent?.trim() ? `v ${opponent.trim()}, ` : '';
  const label = momentLabel(moment);
  return `${game}${momentTime(moment).replace(' · ', ' ')}, ${label.charAt(0).toLowerCase()}${label.slice(1)}: `;
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
