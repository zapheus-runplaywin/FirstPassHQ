import type { SessionKind, SessionLog } from '@/lib/types';

export const SESSION_LOG_COLUMNS = 'id, athlete_id, day, kind, minutes, rpe, updated_at';

/** The database's limits, so the form refuses what it would. */
export const MAX_MINUTES = 300;
export const MAX_SESSIONS_A_DAY = 6;
/** How far back a session can be logged: today and the past week. */
export const LOG_DAYS_BACK = 7;

export const SESSION_KINDS: { value: SessionKind; label: string }[] = [
  { value: 'training', label: 'Training' },
  { value: 'game', label: 'Game' },
  { value: 'gym', label: 'Gym' },
  { value: 'other', label: 'Other' },
];

/** How hard a session felt, 1 to 10 (a session RPE scale). */
export const RPE_LABELS: Record<number, string> = {
  1: 'Very easy',
  2: 'Easy',
  3: 'Moderate',
  4: 'Somewhat hard',
  5: 'Hard',
  6: 'Hard',
  7: 'Very hard',
  8: 'Very hard',
  9: 'Very, very hard',
  10: 'Maximal',
};

export function kindLabel(kind: SessionKind) {
  return SESSION_KINDS.find((k) => k.value === kind)?.label ?? 'Other';
}

/** A session's load: minutes times how hard it felt. */
export function sessionLoad(log: Pick<SessionLog, 'minutes' | 'rpe'>) {
  return log.minutes * log.rpe;
}

/** Such as "Training · 90 min · effort 6 · load 540". */
export function sessionLine(log: Pick<SessionLog, 'kind' | 'minutes' | 'rpe'>) {
  return `${kindLabel(log.kind)} · ${log.minutes} min · effort ${log.rpe} · load ${sessionLoad(log)}`;
}

/** A "2026-10-18" style day moved by whole days, whatever the time zone. */
function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type WeekLoad = {
  /** The first and last day of the week, "2026-10-17" style. */
  from: string;
  to: string;
  sessions: number;
  minutes: number;
  load: number;
};

/**
 * Totals for each of the last `weeks` seven-day weeks ending on `today`,
 * newest first. A session after today counts in the current week.
 */
export function weeklyLoads(logs: SessionLog[], today: string, weeks = 4): WeekLoad[] {
  return Array.from({ length: weeks }, (_, i) => {
    const to = addDays(today, -7 * i);
    const from = addDays(to, -6);
    const inWeek = logs.filter((l) => l.day >= from && (i === 0 || l.day <= to));
    return {
      from,
      to,
      sessions: inWeek.length,
      minutes: inWeek.reduce((n, l) => n + l.minutes, 0),
      load: inWeek.reduce((n, l) => n + sessionLoad(l), 0),
    };
  });
}

/**
 * This week's load against the average of the weeks before it, such as
 * "Up 40% on the 3 weeks before". Null with nothing to compare against.
 */
export function loadChange(weeks: WeekLoad[]) {
  const [current, ...before] = weeks;
  const earlier = before.filter((w) => w.sessions > 0);
  if (!current || earlier.length === 0) return null;
  const average = earlier.reduce((n, w) => n + w.load, 0) / earlier.length;
  const change = Math.round(((current.load - average) / average) * 100);
  const span = earlier.length === 1 ? 'the week before' : `the ${earlier.length} weeks before`;
  if (change === 0) return `The same as ${span}`;
  return `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on ${span}`;
}

/** The days a session can be logged for, newest first. */
export function loggableDays(today: string) {
  return Array.from({ length: LOG_DAYS_BACK + 1 }, (_, i) => addDays(today, -i));
}

/** Why a session can't be saved yet, or null when it can. */
export function sessionProblem(minutes: string, rpe: number | null) {
  const value = Number(minutes.trim());
  if (!minutes.trim() || !Number.isInteger(value) || value < 1 || value > MAX_MINUTES) {
    return `Enter the minutes, from 1 to ${MAX_MINUTES}.`;
  }
  if (rpe === null) return 'Choose how hard it felt, from 1 to 10.';
  return null;
}
